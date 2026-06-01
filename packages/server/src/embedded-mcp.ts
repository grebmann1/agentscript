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
 * Tools are deterministic — the demo's value is in the integration path,
 * not the responses themselves.
 */

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

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'agentscript-demo-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'search_repos',
    {
      title: 'Search repositories',
      description:
        'Search a small in-memory catalog of demo repositories by query.',
      inputSchema: {
        query: z
          .string()
          .describe(
            'Free-text query; matched case-insensitively against name and description.'
          ),
      },
    },
    ({ query }) => {
      const q = String(query ?? '').toLowerCase();
      const matches = DEMO_REPOS.filter(
        r =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              query,
              matches: matches.map(r => r.name),
              count: matches.length,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    'get_repo_info',
    {
      title: 'Get repository info',
      description: 'Return metadata for a single repository by exact name.',
      inputSchema: {
        name: z
          .string()
          .describe('Exact repository name (e.g. "agentscript").'),
      },
    },
    ({ name }) => {
      const repo = DEMO_REPOS.find(
        r => r.name.toLowerCase() === String(name ?? '').toLowerCase()
      );
      const payload = repo ? { ...repo, found: true } : { name, found: false };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload),
          },
        ],
      };
    }
  );

  return server;
}

const DEMO_REPOS = [
  {
    name: 'agentscript',
    description: 'AgentScript runtime and OSS server',
    stars: 1240,
    language: 'TypeScript',
  },
  {
    name: 'salesforce-cli',
    description: 'Salesforce CLI tooling',
    stars: 980,
    language: 'TypeScript',
  },
  {
    name: 'lwc-dev',
    description: 'Lightning Web Components developer tools',
    stars: 425,
    language: 'JavaScript',
  },
];
