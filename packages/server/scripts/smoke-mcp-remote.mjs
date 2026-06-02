import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url =
  process.argv[2] ??
  'https://agentscript-runner-demo-43272b107f3c.herokuapp.com/mcp';

const fail = msg => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const client = new Client({ name: 'mcp-smoke-remote', version: '0.0.1' });
const transport = new StreamableHTTPClientTransport(new URL(url));
await client.connect(transport);
console.log(`✓ connected to ${url}`);

const list = await client.listTools();
const byName = Object.fromEntries(list.tools.map(t => [t.name, t]));
for (const n of ['search_flights', 'search_hotels', 'book_trip']) {
  if (!byName[n]) fail(`tools/list missing ${n}`);
}
if (!byName.search_flights.annotations?.readOnlyHint)
  fail('search_flights missing readOnlyHint');
if (byName.book_trip.annotations?.readOnlyHint !== false)
  fail('book_trip annotation wrong');
if (!byName.search_flights.outputSchema)
  fail('search_flights missing outputSchema');
console.log(
  `✓ tools/list returned ${list.tools.length} tools with annotations + outputSchemas`
);

const sf = await client.callTool({
  name: 'search_flights',
  arguments: {
    origin: 'San Francisco',
    destination: 'New York',
    depart_date: '2026-07-15',
  },
});
if (sf.isError) fail('search_flights returned isError');
if (!sf.structuredContent?.flights?.length)
  fail('search_flights structuredContent missing flights');
const flightId = sf.structuredContent.flights[0].id;
console.log(
  `✓ search_flights -> ${sf.structuredContent.flights.length} flights, picked ${flightId}`
);

const sh = await client.callTool({
  name: 'search_hotels',
  arguments: {
    city: 'New York',
    check_in: '2026-07-15',
    check_out: '2026-07-18',
  },
});
if (!sh.structuredContent?.hotels?.length) fail('search_hotels missing hotels');
const hotelId = sh.structuredContent.hotels[0].id;
console.log(
  `✓ search_hotels -> ${sh.structuredContent.hotels.length} hotels, picked ${hotelId}`
);

const bt1 = await client.callTool({
  name: 'book_trip',
  arguments: {
    traveler_name: 'Ada Lovelace',
    flight_id: flightId,
    hotel_id: hotelId,
  },
});
const sc1 = bt1.structuredContent;
if (!sc1) fail('book_trip missing structuredContent');
if (sc1.result !== undefined)
  fail(`book_trip wrapped under .result: ${JSON.stringify(sc1)}`);
if (sc1.booked !== true) fail('book_trip booked !== true');
if (!/^BK-[A-Z]+-[0-9A-F]{6}$/.test(sc1.confirmation_number))
  fail(`book_trip confirmation format wrong: ${sc1.confirmation_number}`);
console.log(
  `✓ book_trip flat shape, confirmation ${sc1.confirmation_number}, total $${sc1.total_usd}`
);

const bt2 = await client.callTool({
  name: 'book_trip',
  arguments: {
    traveler_name: 'Ada Lovelace',
    flight_id: flightId,
    hotel_id: hotelId,
  },
});
if (bt2.structuredContent.confirmation_number !== sc1.confirmation_number)
  fail('book_trip not deterministic');
console.log('✓ book_trip deterministic');

const bte = await client.callTool({
  name: 'book_trip',
  arguments: { traveler_name: 'Test', flight_id: 'FL-XXX' },
});
if (bte.isError) fail('book_trip error path used JSON-RPC isError');
if (bte.structuredContent?.booked !== false)
  fail(
    `book_trip error structuredContent wrong: ${JSON.stringify(bte.structuredContent)}`
  );
if (!bte.structuredContent.error) fail('book_trip error message missing');
console.log(
  `✓ book_trip error path: { booked: false, error: "${bte.structuredContent.error}" }`
);

await client.close();
console.log('\n✅ Live MCP smoke passed');
