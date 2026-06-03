/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpAdapter } from '@agentscript/runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createEmbeddedMcpRouter } from '../src/embedded-mcp.js';

/**
 * Drives the real `createEmbeddedMcpRouter()` over the wire with the official
 * MCP SDK client (via `McpAdapter`). Doubles as a sanity check that our
 * in-test mocks elsewhere agree with the real `McpServer` wire format.
 *
 * For wire-shape assertions (structuredContent + content fallback,
 * annotations) we also drive the SDK `Client` directly so we can inspect
 * the raw CallToolResult — `McpAdapter.invoke()` peels structuredContent
 * out and returns it unwrapped.
 */
describe('embedded MCP server', () => {
  let httpServer: ServerType;
  let adapter: McpAdapter;
  let baseUrl: string;
  let rawClient: Client;

  beforeAll(async () => {
    const app = new Hono();
    app.route('/mcp', createEmbeddedMcpRouter());
    httpServer = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>(resolve => {
      const tryRead = () => {
        const addr = httpServer.address() as AddressInfo | null;
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
          resolve();
          return;
        }
        setImmediate(tryRead);
      };
      tryRead();
    });
    adapter = new McpAdapter({ demo: { url: baseUrl } });

    rawClient = new Client({ name: 'embedded-mcp-test', version: '0.0.0' });
    await rawClient.connect(
      new StreamableHTTPClientTransport(new URL(baseUrl))
    );
  });

  afterAll(async () => {
    await rawClient.close();
    await adapter.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close(err => (err ? reject(err) : resolve()))
    );
  });

  it('lists the demo tools', async () => {
    const tools = await adapter.listTools('demo');
    expect(tools.map(t => t.name).sort()).toEqual([
      'book_trip',
      'get_order_tracking',
      'lookup_order',
      'search_flights',
      'search_hotels',
    ]);
  });

  it('search_flights returns the seeded SF→NY catalog', async () => {
    const result = await adapter.invoke({
      target: 'mcp://demo/search_flights',
      args: {
        origin: 'San Francisco',
        destination: 'New York',
        depart_date: '2026-07-15',
      },
    });
    expect(result).toMatchObject({ count: expect.any(Number) });
    expect((result as { count: number }).count).toBeGreaterThanOrEqual(1);
    const flights = (result as { flights: Array<{ id: string }> }).flights;
    expect(flights.map(f => f.id)).toContain('FL-101');
  });

  it('book_trip returns a structured error for an unknown flight_id', async () => {
    const result = (await adapter.invoke({
      target: 'mcp://demo/book_trip',
      args: { traveler_name: 'Test User', flight_id: 'FL-XXX' },
    })) as { booked: boolean; error: string };
    // Error semantics live inside the JSON payload, not the JSON-RPC envelope.
    expect(result).toMatchObject({ booked: false });
    expect(result.error).toMatch(/Unknown flight_id/);
  });

  describe('wire shape: structuredContent + text fallback', () => {
    it('search_flights returns both structuredContent and a JSON text fallback', async () => {
      const raw = await rawClient.callTool({
        name: 'search_flights',
        arguments: {
          origin: 'San Francisco',
          destination: 'New York',
          depart_date: '2026-07-15',
        },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        origin: 'San Francisco',
        destination: 'New York',
        depart_date: '2026-07-15',
        count: expect.any(Number),
        flights: expect.any(Array),
      });
      const content = raw.content as Array<{ type: string; text?: string }>;
      expect(Array.isArray(content)).toBe(true);
      const textParts = content.filter(p => p.type === 'text');
      expect(textParts.length).toBe(1);
      const parsed = JSON.parse(textParts[0].text!);
      expect(parsed).toEqual(raw.structuredContent);
    });

    it('search_hotels returns both structuredContent and a JSON text fallback', async () => {
      const raw = await rawClient.callTool({
        name: 'search_hotels',
        arguments: {
          city: 'New York',
          check_in: '2026-07-15',
          check_out: '2026-07-18',
        },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        city: 'New York',
        check_in: '2026-07-15',
        check_out: '2026-07-18',
        count: expect.any(Number),
        hotels: expect.any(Array),
      });
      const content = raw.content as Array<{ type: string; text?: string }>;
      const textParts = content.filter(p => p.type === 'text');
      expect(textParts.length).toBe(1);
      expect(JSON.parse(textParts[0].text!)).toEqual(raw.structuredContent);
    });

    it('book_trip success returns both structuredContent and a JSON text fallback', async () => {
      const raw = await rawClient.callTool({
        name: 'book_trip',
        arguments: {
          traveler_name: 'Ada Lovelace',
          flight_id: 'FL-101',
          hotel_id: 'HT-NYC-1',
        },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        booked: true,
        traveler_name: 'Ada Lovelace',
        confirmation_number: expect.any(String),
        total_usd: expect.any(Number),
      });
      const content = raw.content as Array<{ type: string; text?: string }>;
      const textParts = content.filter(p => p.type === 'text');
      expect(textParts.length).toBe(1);
      expect(JSON.parse(textParts[0].text!)).toEqual(raw.structuredContent);
    });

    it('lookup_order returns the seeded ORD-42 record with a tracking number', async () => {
      const raw = await rawClient.callTool({
        name: 'lookup_order',
        arguments: { order_number: 'ORD-42' },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        found: true,
        order_id: 'ORD-42',
        status: 'shipped',
        tracking_number: '1Z-DEMO-42',
        total_usd: expect.any(Number),
      });
    });

    it('lookup_order returns found:false for unknown order numbers', async () => {
      const raw = await rawClient.callTool({
        name: 'lookup_order',
        arguments: { order_number: 'ORD-NOPE' },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        found: false,
        order_id: 'ORD-NOPE',
        status: 'not_found',
      });
    });

    it('get_order_tracking returns a multi-event history for the seeded number', async () => {
      const raw = await rawClient.callTool({
        name: 'get_order_tracking',
        arguments: { tracking_number: '1Z-DEMO-42' },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        found: true,
        carrier: 'AgentExpress',
        last_location: 'Reno, NV',
        history: expect.any(Array),
      });
      const structured = raw.structuredContent as {
        history: Array<{ at: string; location: string; description: string }>;
      };
      expect(structured.history.length).toBeGreaterThan(0);
    });

    it('book_trip error returns both structuredContent and a JSON text fallback', async () => {
      const raw = await rawClient.callTool({
        name: 'book_trip',
        arguments: { traveler_name: 'Test User', flight_id: 'FL-XXX' },
      });
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toMatchObject({
        booked: false,
        error: expect.stringMatching(/Unknown flight_id/),
      });
      const content = raw.content as Array<{ type: string; text?: string }>;
      const textParts = content.filter(p => p.type === 'text');
      expect(textParts.length).toBe(1);
      expect(JSON.parse(textParts[0].text!)).toEqual(raw.structuredContent);
    });
  });

  it('book_trip is deterministic across calls with the same inputs', async () => {
    const args = {
      traveler_name: 'Ada Lovelace',
      flight_id: 'FL-101',
      hotel_id: 'HT-NYC-1',
    };
    const a = (await adapter.invoke({
      target: 'mcp://demo/book_trip',
      args,
    })) as { confirmation_number: string };
    const b = (await adapter.invoke({
      target: 'mcp://demo/book_trip',
      args,
    })) as { confirmation_number: string };
    expect(a.confirmation_number).toBe(b.confirmation_number);
    // Sanity-check the format: BK-<TRAVELER_PREFIX>-<6-hex-uppercase>.
    expect(a.confirmation_number).toMatch(/^BK-[A-Z]+-[0-9A-F]{6}$/);
  });

  it('tools/list carries the expected MCP annotations', async () => {
    const listed = await rawClient.listTools();
    const byName = new Map(listed.tools.map(t => [t.name, t]));

    const flights = byName.get('search_flights');
    expect(flights?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });

    const hotels = byName.get('search_hotels');
    expect(hotels?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });

    const book = byName.get('book_trip');
    expect(book?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });

    // outputSchema is advertised on the search tools (flat shapes); book_trip
    // intentionally omits one because the success/error union doesn't fit the
    // SDK's object-shaped schema requirement.
    expect(flights?.outputSchema).toBeTruthy();
    expect(hotels?.outputSchema).toBeTruthy();
  });
});
