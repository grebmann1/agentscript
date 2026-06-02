import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const port = Number(process.env.PORT ?? 5430);
const url = `http://127.0.0.1:${port}/mcp`;
// Smoke always exercises the auth gate so a bypass regression breaks the
// build, not the live deploy. The token is local-only (process env var
// confined to this child).
const mcpToken = process.env.MCP_AUTH_TOKEN ?? 'smoke-mcp-token';

const server = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    AGENTS_DIR: 'agents',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-smoke-not-used',
    MCP_INTERNAL_URL: url,
    MCP_AUTH_TOKENS: mcpToken,
    NODE_ENV: 'production',
  },
  stdio: 'inherit',
});

const fail = msg => {
  console.error(`✗ ${msg}`);
  server.kill('SIGTERM');
  process.exit(1);
};

try {
  await sleep(1500);

  // Verify the auth gate first — without a bearer, /mcp must reject with 401.
  const unauth = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    }),
  });
  if (unauth.status !== 401) {
    fail(`/mcp without bearer expected 401, got ${unauth.status}`);
  }
  console.log('✓ /mcp rejects unauthenticated request (401)');

  const client = new Client({ name: 'mcp-smoke', version: '0.0.1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } },
  });
  await client.connect(transport);

  console.log('✓ connected to /mcp with bearer token');

  // tools/list — verify all three demo tools and annotations
  const list = await client.listTools();
  const byName = Object.fromEntries(list.tools.map(t => [t.name, t]));
  const expected = ['search_flights', 'search_hotels', 'book_trip'];
  for (const name of expected) {
    if (!byName[name]) fail(`tools/list missing ${name}`);
  }
  if (!byName.search_flights.annotations?.readOnlyHint) {
    fail('search_flights missing readOnlyHint annotation');
  }
  if (byName.book_trip.annotations?.readOnlyHint !== false) {
    fail('book_trip readOnlyHint annotation wrong');
  }
  if (!byName.search_flights.outputSchema) {
    fail('search_flights missing outputSchema');
  }
  console.log('✓ tools/list returned 3 tools with annotations + outputSchemas');

  // search_flights — expect structuredContent + JSON text fallback
  const sf = await client.callTool({
    name: 'search_flights',
    arguments: {
      origin: 'San Francisco',
      destination: 'New York',
      depart_date: '2026-07-15',
    },
  });
  if (sf.isError) fail('search_flights returned isError');
  if (!sf.structuredContent) fail('search_flights missing structuredContent');
  const sfStruct = sf.structuredContent;
  if (sfStruct.origin !== 'San Francisco') fail('search_flights wrong origin');
  if (!Array.isArray(sfStruct.flights) || sfStruct.flights.length === 0) {
    fail('search_flights returned empty flights');
  }
  const sfText = JSON.parse(sf.content[0].text);
  if (JSON.stringify(sfText) !== JSON.stringify(sfStruct)) {
    fail('search_flights text fallback diverges from structuredContent');
  }
  const flightId = sfStruct.flights[0].id;
  console.log(
    `✓ search_flights structuredContent + text-fallback match (${sfStruct.flights.length} flights, picked ${flightId})`
  );

  // search_hotels
  const sh = await client.callTool({
    name: 'search_hotels',
    arguments: {
      city: 'New York',
      check_in: '2026-07-15',
      check_out: '2026-07-18',
    },
  });
  if (!sh.structuredContent?.hotels?.length)
    fail('search_hotels returned empty');
  const hotelId = sh.structuredContent.hotels[0].id;
  console.log(
    `✓ search_hotels (${sh.structuredContent.hotels.length} hotels, picked ${hotelId})`
  );

  // book_trip success — flat structuredContent (no { result } wrapper)
  const bt1 = await client.callTool({
    name: 'book_trip',
    arguments: {
      traveler_name: 'Ada Lovelace',
      flight_id: flightId,
      hotel_id: hotelId,
    },
  });
  if (!bt1.structuredContent)
    fail('book_trip success missing structuredContent');
  const sc1 = bt1.structuredContent;
  if (sc1.result !== undefined)
    fail(`book_trip still wrapped under .result: ${JSON.stringify(sc1)}`);
  if (sc1.booked !== true) fail('book_trip success: booked !== true');
  if (!/^BK-[A-Z]+-[0-9A-F]{6}$/.test(sc1.confirmation_number)) {
    fail(`book_trip confirmation format wrong: ${sc1.confirmation_number}`);
  }
  console.log(
    `✓ book_trip success: flat shape, confirmation ${sc1.confirmation_number}, total $${sc1.total_usd}`
  );

  // determinism
  const bt2 = await client.callTool({
    name: 'book_trip',
    arguments: {
      traveler_name: 'Ada Lovelace',
      flight_id: flightId,
      hotel_id: hotelId,
    },
  });
  if (bt2.structuredContent.confirmation_number !== sc1.confirmation_number) {
    fail('book_trip not deterministic');
  }
  console.log('✓ book_trip is deterministic across calls');

  // book_trip error — flat error shape
  const bte = await client.callTool({
    name: 'book_trip',
    arguments: { traveler_name: 'Test', flight_id: 'FL-XXX' },
  });
  if (bte.isError)
    fail(
      'book_trip error path returned JSON-RPC isError instead of payload error'
    );
  if (bte.structuredContent?.booked !== false) {
    fail(
      `book_trip error structuredContent wrong: ${JSON.stringify(bte.structuredContent)}`
    );
  }
  if (!bte.structuredContent.error) fail('book_trip error message missing');
  console.log(
    `✓ book_trip error: { booked: false, error: "${bte.structuredContent.error}" }`
  );

  await client.close();
  console.log('\n✅ MCP smoke test passed');
  server.kill('SIGTERM');
  process.exit(0);
} catch (e) {
  fail(`unexpected error: ${e?.stack ?? e}`);
}
