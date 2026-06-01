/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpAdapter } from '@agentscript/runtime';
import { mcpToolsForVercel } from '../src/mcp-tools.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Minimal in-process MCP server for tests. Mirrors the shape used in
 * `packages/runtime/test/mcp-adapter.test.ts` so the round-trip exercises
 * the same wire format the official SDK speaks.
 */
function startMockMcp(
  tools: Record<string, (args: Record<string, unknown>) => unknown>
): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise(resolve => {
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        let parsed: JsonRpcRequest;
        try {
          parsed = JSON.parse(body) as JsonRpcRequest;
        } catch {
          res.statusCode = 400;
          res.end('invalid json');
          return;
        }
        if (parsed.id === undefined) {
          res.statusCode = 202;
          res.end();
          return;
        }
        const reply = (result: Record<string, unknown>) => {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
        };
        if (parsed.method === 'initialize') {
          reply({
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'mock', version: '0.0.0' },
          });
          return;
        }
        if (parsed.method === 'tools/list') {
          reply({
            tools: Object.keys(tools).map(name => ({
              name,
              description: `mock ${name}`,
              inputSchema: {
                type: 'object' as const,
                properties: { name: { type: 'string' } },
              },
            })),
          });
          return;
        }
        if (parsed.method === 'tools/call') {
          const params = (parsed.params ?? {}) as {
            name?: string;
            arguments?: Record<string, unknown>;
          };
          const handler = params.name ? tools[params.name] : undefined;
          if (!handler) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                error: { code: -32601, message: `unknown ${params.name}` },
              })
            );
            return;
          }
          const out = handler(params.arguments ?? {});
          const text = typeof out === 'string' ? out : JSON.stringify(out);
          reply({ content: [{ type: 'text', text }] });
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32601, message: 'unknown method' },
          })
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
      });
    });
  });
}

/** Minimal `tool()`/`jsonSchema()` shims modeling the Vercel AI SDK surface. */
interface CapturedTool {
  description: string;
  inputSchema: unknown;
  execute: (
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal }
  ) => Promise<Record<string, unknown>>;
}
function makeFactory() {
  const builtTools: CapturedTool[] = [];
  const jsonSchemaCalls: Array<Record<string, unknown>> = [];
  const factory = {
    tool: (config: CapturedTool) => {
      builtTools.push(config);
      return { __captured: true, ...config };
    },
    jsonSchema: (schema: Record<string, unknown>) => {
      jsonSchemaCalls.push(schema);
      return { __wrapped: true, schema };
    },
  };
  return { factory, builtTools, jsonSchemaCalls };
}

describe('mcpToolsForVercel', () => {
  let mock: Awaited<ReturnType<typeof startMockMcp>>;
  let adapter: McpAdapter;

  beforeEach(async () => {
    mock = await startMockMcp({
      greet: args => ({ greeting: `hello ${args.name ?? 'world'}` }),
      add: args => ({ sum: Number(args.a ?? 0) + Number(args.b ?? 0) }),
    });
    adapter = new McpAdapter({ demo: { url: mock.url } });
  });

  afterEach(async () => {
    await adapter.close();
    await mock.stop();
  });

  it('builds one ToolSet entry per server/tool, keyed `<server>__<tool>`', async () => {
    const { factory, builtTools, jsonSchemaCalls } = makeFactory();

    const tools = await mcpToolsForVercel(adapter, factory);

    expect(Object.keys(tools).sort()).toEqual(['demo__add', 'demo__greet']);
    expect(builtTools).toHaveLength(2);
    // jsonSchema injector is invoked once per tool with the raw MCP schema.
    expect(jsonSchemaCalls).toHaveLength(2);
    expect(jsonSchemaCalls[0]).toMatchObject({ type: 'object' });
  });

  it('execute() round-trips through the same McpAdapter', async () => {
    const { factory, builtTools } = makeFactory();
    await mcpToolsForVercel(adapter, factory);

    const greet = builtTools.find(t => t.description.includes('greet'));
    expect(greet).toBeDefined();

    const result = await greet!.execute({ name: 'agentscript' });
    expect(result).toEqual({ greeting: 'hello agentscript' });
  });

  it('falls back to the raw MCP schema when jsonSchema is omitted', async () => {
    const { factory, builtTools } = makeFactory();
    const factoryNoJsonSchema = { tool: factory.tool };

    await mcpToolsForVercel(adapter, factoryNoJsonSchema);

    const first = builtTools[0];
    // Without jsonSchema(), the raw MCP schema flows through verbatim.
    expect(first.inputSchema).toMatchObject({ type: 'object' });
  });
});
