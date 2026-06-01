/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpAdapter } from '../src/index.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MockMcpOptions {
  /** Tool table: name → handler that receives args and returns content. */
  tools: Record<
    string,
    (
      args: Record<string, unknown>
    ) =>
      | Record<string, unknown>
      | string
      | { error: { code: number; message: string } }
  >;
  /** Optional header check; throws to reject the request. */
  expectHeaders?: (headers: Record<string, string | undefined>) => void;
}

/** Spin up an in-process Hono-free MCP-shaped HTTP server using node:http. */
function startMockMcp(opts: MockMcpOptions): Promise<{
  url: string;
  stop: () => Promise<void>;
  notifications: string[];
  initializeCalls: number;
}> {
  return new Promise(resolve => {
    const notifications: string[] = [];
    let initializeCalls = 0;

    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        try {
          opts.expectHeaders?.(req.headers as Record<string, string>);
        } catch (err) {
          res.statusCode = 400;
          res.end((err as Error).message);
          return;
        }
        let parsed: JsonRpcRequest;
        try {
          parsed = JSON.parse(body) as JsonRpcRequest;
        } catch {
          res.statusCode = 400;
          res.end('invalid json');
          return;
        }
        // Notifications have no `id` and expect no body back.
        if (parsed.id === undefined) {
          notifications.push(parsed.method);
          res.statusCode = 202;
          res.end();
          return;
        }

        if (parsed.method === 'initialize') {
          initializeCalls++;
          respond(res, parsed.id, {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'mock', version: '0.0.0' },
          });
          return;
        }
        if (parsed.method === 'tools/list') {
          respond(res, parsed.id, {
            tools: Object.keys(opts.tools).map(name => ({
              name,
              description: `mock ${name}`,
              inputSchema: { type: 'object' as const },
            })),
          });
          return;
        }
        if (parsed.method === 'tools/call') {
          const params = (parsed.params ?? {}) as {
            name?: string;
            arguments?: Record<string, unknown>;
          };
          const handler = params.name ? opts.tools[params.name] : undefined;
          if (!handler) {
            respondError(res, parsed.id, -32601, `Unknown tool ${params.name}`);
            return;
          }
          const out = handler(params.arguments ?? {});
          if (
            out &&
            typeof out === 'object' &&
            'error' in out &&
            out.error &&
            typeof out.error === 'object'
          ) {
            const e = out.error;
            respondError(res, parsed.id, e.code, e.message);
            return;
          }
          const text = typeof out === 'string' ? out : JSON.stringify(out);
          respond(res, parsed.id, {
            content: [{ type: 'text', text }],
          });
          return;
        }
        respondError(
          res,
          parsed.id,
          -32601,
          `Method not found: ${parsed.method}`
        );
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('failed to start mock MCP server');
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        stop: () =>
          new Promise<void>((res, rej) =>
            server.close(err => (err ? rej(err) : res()))
          ),
        get notifications() {
          return notifications;
        },
        get initializeCalls() {
          return initializeCalls;
        },
      });
    });
  });
}

function respond(
  res: import('node:http').ServerResponse,
  id: number | string,
  result: Record<string, unknown>
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function respondError(
  res: import('node:http').ServerResponse,
  id: number | string | undefined,
  code: number,
  message: string
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  );
}

describe('McpAdapter', () => {
  let mock: Awaited<ReturnType<typeof startMockMcp>>;

  beforeEach(async () => {
    mock = await startMockMcp({
      tools: {
        echo: args => ({ ok: true, args }),
        plain_text: () => 'just a string',
        boom: () => ({ error: { code: -32000, message: 'kaboom' } }),
      },
    });
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('routes calls to the matching server, parses JSON text content', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    const result = await adapter.invoke({
      target: 'mcp://default/echo',
      args: { hello: 'world' },
    });

    expect(result).toEqual({ ok: true, args: { hello: 'world' } });
  });

  it('returns { text } when the text content is not JSON', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    const result = await adapter.invoke({
      target: 'mcp://default/plain_text',
      args: {},
    });

    expect(result).toEqual({ text: 'just a string' });
  });

  it('throws when the MCP server returns a JSON-RPC error', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://default/boom', args: {} })
    ).rejects.toThrow(/kaboom/);
  });

  it('initializes once per server and sends notifications/initialized', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await adapter.invoke({ target: 'mcp://default/echo', args: { n: 1 } });
    await adapter.invoke({ target: 'mcp://default/echo', args: { n: 2 } });

    expect(mock.initializeCalls).toBe(1);
    expect(mock.notifications).toContain('notifications/initialized');
  });

  it('rejects targets without a server segment', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://only_tool', args: {} })
    ).rejects.toThrow(/Expected "mcp:\/\/<server>\/<tool>"/);
  });

  it('rejects unknown server names', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://other/echo', args: {} })
    ).rejects.toThrow(/No MCP server registered as "other"/);
  });

  it('routes calls to multiple registered servers', async () => {
    const second = await startMockMcp({
      tools: {
        ping: () => ({ from: 'server-b' }),
      },
    });
    try {
      const adapter = new McpAdapter({
        a: { url: mock.url },
        b: { url: second.url },
      });

      const fromA = await adapter.invoke({
        target: 'mcp://a/echo',
        args: { x: 1 },
      });
      const fromB = await adapter.invoke({
        target: 'mcp://b/ping',
        args: {},
      });

      expect(fromA).toEqual({ ok: true, args: { x: 1 } });
      expect(fromB).toEqual({ from: 'server-b' });
      expect(adapter.servers().sort()).toEqual(['a', 'b']);
    } finally {
      await second.stop();
    }
  });

  it('lists tools from a server', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });
    const tools = await adapter.listTools('default');
    expect(tools.map(t => t.name).sort()).toEqual([
      'boom',
      'echo',
      'plain_text',
    ]);
  });

  it('forwards configured headers', async () => {
    const seenAuth: string[] = [];
    const headerMock = await startMockMcp({
      tools: { echo: () => ({ ok: true }) },
      expectHeaders: headers => {
        const auth = headers.authorization;
        if (auth) seenAuth.push(String(auth));
      },
    });
    try {
      const adapter = new McpAdapter({
        gh: {
          url: headerMock.url,
          headers: { authorization: 'Bearer secret' },
        },
      });
      await adapter.invoke({ target: 'mcp://gh/echo', args: {} });
      expect(seenAuth).toContain('Bearer secret');
    } finally {
      await headerMock.stop();
    }
  });

  it('rejects targets that do not start with mcp://', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });
    await expect(
      adapter.invoke({ target: 'http://wat/echo', args: {} })
    ).rejects.toThrow(/Invalid MCP target/);
  });
});
