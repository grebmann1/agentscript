#!/usr/bin/env npx tsx
/*
 * Fake MCP server for testing the UI Providers panel.
 * Run:  npx tsx apps/ui/test-mcp-server.ts
 * Listens on port 3001 (matches the Vite proxy in vite.config.ts).
 */

import * as http from 'node:http';

const PORT = 3001;

const tools = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
  },
  {
    name: 'calculate',
    description: 'Evaluate a math expression',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Math expression like "2+2"',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'search',
    description: 'Search for information',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
];

// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = http.createServer(async (req, res) => {
  // CORS headers for direct browser access (without proxy)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let rpc: {
    jsonrpc: string;
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
  };
  try {
    rpc = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end('Invalid JSON');
    return;
  }

  console.log(
    `← ${rpc.method}`,
    rpc.params ? JSON.stringify(rpc.params).slice(0, 100) : ''
  );

  let result: unknown;

  switch (rpc.method) {
    case 'initialize':
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp-server', version: '1.0.0' },
      };
      break;

    case 'tools/list':
      result = { tools };
      break;

    case 'tools/call': {
      const { name, arguments: args } = rpc.params as {
        name: string;
        arguments: Record<string, unknown>;
      };

      // Simulate a small delay
      await new Promise(r => setTimeout(r, 50));

      let content: string;
      switch (name) {
        case 'get_weather': {
          const city = (args.city as string) || 'Unknown';
          const temp = Math.round(10 + Math.random() * 25);
          const conditions = ['sunny', 'cloudy', 'rainy', 'windy'][
            Math.floor(Math.random() * 4)
          ];
          content = JSON.stringify({
            city,
            temperature: temp,
            unit: 'celsius',
            conditions,
          });
          break;
        }
        case 'calculate': {
          const expr = (args.expression as string) || '0';
          const safe = expr.replace(/[^0-9+\-*/().  ]/g, '');
          let num: number;
          try {
            num = Function(`"use strict"; return (${safe})`)() as number;
          } catch {
            num = NaN;
          }
          content = JSON.stringify({ expression: expr, result: num });
          break;
        }
        case 'search': {
          const query = (args.query as string) || '';
          content = JSON.stringify({
            query,
            results: [
              {
                title: `Result 1 for "${query}"`,
                snippet: 'Lorem ipsum dolor sit amet...',
              },
              {
                title: `Result 2 for "${query}"`,
                snippet: 'Consectetur adipiscing elit...',
              },
            ],
            total: 42,
          });
          break;
        }
        default:
          content = JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      console.log(`  → ${name}:`, content.slice(0, 80));
      result = { content: [{ type: 'text', text: content }] };
      break;
    }

    default:
      result = {
        error: { code: -32601, message: `Method not found: ${rpc.method}` },
      };
  }

  const response = { jsonrpc: '2.0', id: rpc.id, result };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🔧 Fake MCP server running on http://127.0.0.1:${PORT}`);
  console.log(`   Tools: ${tools.map(t => t.name).join(', ')}`);
  console.log(`   Vite proxy: /mcp-proxy → http://127.0.0.1:${PORT}\n`);
});
