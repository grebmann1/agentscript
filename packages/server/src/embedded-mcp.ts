/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * In-process MCP server exposed at `/mcp` on the agent server. Demonstrates
 * `deployment.mcp` end-to-end without requiring a separate process: agents
 * declared with `mcp://demo/<tool>` action targets pointing at
 * `http://127.0.0.1:$PORT/mcp` round-trip through the official
 * `@modelcontextprotocol/sdk` client + server, exercising the full
 * Streamable HTTP wire format.
 *
 * Tools are deterministic — including `book_trip`, whose confirmation
 * number is derived from a SHA-256 hash of the inputs so the demo is
 * reproducible. The demo's value is in the integration path, not the
 * responses themselves.
 */

import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

export function createEmbeddedMcpRouter(): Hono {
  const router = new Hono();

  router.all('/', async c => {
    // Stateless mode: a fresh server + transport per request. The official
    // SDK pattern — keeps the route reentrant and safe under Heroku's dyno
    // model where there's no shared state to leak.
    //
    // `enableJsonResponse: true` tells the SDK to return a single JSON
    // response (rather than starting an SSE stream), which fits this
    // stateless single-request/response shape and removes any lifecycle
    // race between handleRequest's stream and our cleanup.
    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return router;
}

const flightSchema = z.object({
  id: z.string(),
  airline: z.string(),
  origin: z.string(),
  destination: z.string(),
  depart: z.string(),
  arrive: z.string(),
  duration_h: z.number(),
  price_usd: z.number(),
});

const hotelSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  rating: z.number(),
  price_per_night_usd: z.number(),
});

const searchFlightsOutputSchema = {
  origin: z.string(),
  destination: z.string(),
  depart_date: z.string(),
  flights: z.array(flightSchema),
  count: z.number(),
};

const searchHotelsOutputSchema = {
  city: z.string(),
  check_in: z.string(),
  check_out: z.string(),
  hotels: z.array(hotelSchema),
  count: z.number(),
};

// `book_trip` intentionally has no `outputSchema`: the MCP SDK's
// schema validator only accepts an object-shaped ZodRawShape, but the
// success/error shapes legitimately diverge on the `booked` discriminator.
// Wrapping a union under a `{ result }` envelope just to satisfy the SDK
// would force every consumer (including the demo agent which declares flat
// outputs) to unwrap. Returning `structuredContent` without an
// `outputSchema` is permitted by the spec.

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'agentscript-demo-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'search_flights',
    {
      title: 'Search flights',
      description:
        'Search a small in-memory catalog of flights between two cities on a given date.',
      inputSchema: {
        origin: z.string().describe('Origin city (e.g. "San Francisco").'),
        destination: z.string().describe('Destination city (e.g. "New York").'),
        depart_date: z
          .string()
          .describe('Departure date in ISO format (YYYY-MM-DD).'),
      },
      outputSchema: searchFlightsOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    ({ origin, destination, depart_date }) => {
      const o = String(origin ?? '').toLowerCase();
      const d = String(destination ?? '').toLowerCase();
      const matches = DEMO_FLIGHTS.filter(
        f =>
          f.origin.toLowerCase().includes(o) &&
          f.destination.toLowerCase().includes(d)
      );
      const structured = {
        origin,
        destination,
        depart_date,
        flights: matches,
        count: matches.length,
      };
      return {
        structuredContent: structured,
        // Fallback for clients that don't yet read `structuredContent`.
        // Per MCP spec, tools with an `outputSchema` must still emit a
        // serialized form in `content`.
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(structured),
          },
        ],
      };
    }
  );

  server.registerTool(
    'search_hotels',
    {
      title: 'Search hotels',
      description:
        'Search a small in-memory catalog of hotels in a given city.',
      inputSchema: {
        city: z.string().describe('City to search hotels in.'),
        check_in: z.string().describe('Check-in date (YYYY-MM-DD).'),
        check_out: z.string().describe('Check-out date (YYYY-MM-DD).'),
      },
      outputSchema: searchHotelsOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    ({ city, check_in, check_out }) => {
      const c = String(city ?? '').toLowerCase();
      const matches = DEMO_HOTELS.filter(h => h.city.toLowerCase().includes(c));
      const structured = {
        city,
        check_in,
        check_out,
        hotels: matches,
        count: matches.length,
      };
      return {
        structuredContent: structured,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(structured),
          },
        ],
      };
    }
  );

  server.registerTool(
    'book_trip',
    {
      title: 'Book a trip',
      description:
        'Book a flight and/or hotel by id. Returns a confirmation number.',
      inputSchema: {
        traveler_name: z.string().describe('Full name of the traveler.'),
        flight_id: z
          .string()
          .optional()
          .describe('Flight id from search_flights (optional).'),
        hotel_id: z
          .string()
          .optional()
          .describe('Hotel id from search_hotels (optional).'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ traveler_name, flight_id, hotel_id }) => {
      const flight = flight_id
        ? DEMO_FLIGHTS.find(f => f.id === flight_id)
        : undefined;
      const hotel = hotel_id
        ? DEMO_HOTELS.find(h => h.id === hotel_id)
        : undefined;

      if (flight_id && !flight) {
        const err = {
          booked: false as const,
          error: `Unknown flight_id "${flight_id}".`,
        };
        return {
          structuredContent: err,
          content: [{ type: 'text' as const, text: JSON.stringify(err) }],
        };
      }
      if (hotel_id && !hotel) {
        const err = {
          booked: false as const,
          error: `Unknown hotel_id "${hotel_id}".`,
        };
        return {
          structuredContent: err,
          content: [{ type: 'text' as const, text: JSON.stringify(err) }],
        };
      }

      const flightCost = flight?.price_usd ?? 0;
      const hotelCost = hotel?.price_per_night_usd ?? 0;
      // Deterministic confirmation number: SHA-256 of the inputs so a
      // re-run of the demo produces the same booking record.
      const hash = createHash('sha256')
        .update(`${traveler_name}|${flight_id ?? ''}|${hotel_id ?? ''}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
      const travelerPrefix = (traveler_name || 'guest')
        .replace(/\s+/g, '')
        .toUpperCase()
        .slice(0, 6);
      const confirmation = `BK-${travelerPrefix}-${hash}`;

      const success = {
        booked: true as const,
        confirmation_number: confirmation,
        traveler_name,
        flight: flight ?? null,
        hotel: hotel ?? null,
        total_usd: flightCost + hotelCost,
      };
      return {
        structuredContent: success,
        content: [{ type: 'text' as const, text: JSON.stringify(success) }],
      };
    }
  );

  return server;
}

const DEMO_FLIGHTS = [
  {
    id: 'FL-101',
    airline: 'Skyline',
    origin: 'San Francisco',
    destination: 'New York',
    depart: '08:30',
    arrive: '17:05',
    duration_h: 5.5,
    price_usd: 312,
  },
  {
    id: 'FL-102',
    airline: 'Coastal Air',
    origin: 'San Francisco',
    destination: 'New York',
    depart: '13:15',
    arrive: '21:55',
    duration_h: 5.7,
    price_usd: 289,
  },
  {
    id: 'FL-201',
    airline: 'Skyline',
    origin: 'New York',
    destination: 'London',
    depart: '21:00',
    arrive: '09:15',
    duration_h: 7.3,
    price_usd: 642,
  },
  {
    id: 'FL-301',
    airline: 'Pacific Wings',
    origin: 'San Francisco',
    destination: 'Tokyo',
    depart: '11:00',
    arrive: '15:40',
    duration_h: 11.7,
    price_usd: 980,
  },
];

const DEMO_HOTELS = [
  {
    id: 'HT-NYC-1',
    name: 'The Grand Midtown',
    city: 'New York',
    rating: 4.6,
    price_per_night_usd: 245,
  },
  {
    id: 'HT-NYC-2',
    name: 'Riverside Boutique',
    city: 'New York',
    rating: 4.3,
    price_per_night_usd: 189,
  },
  {
    id: 'HT-LON-1',
    name: 'Kensington House',
    city: 'London',
    rating: 4.7,
    price_per_night_usd: 298,
  },
  {
    id: 'HT-TYO-1',
    name: 'Shibuya Sky',
    city: 'Tokyo',
    rating: 4.8,
    price_per_night_usd: 220,
  },
];
