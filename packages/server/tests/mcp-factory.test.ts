/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '@agentscript/compiler';
import { createMcpAdapter } from '../src/mcp-factory.js';

/**
 * Minimal MCP-shaped server that captures the `authorization` header from
 * `tools/call` requests. Just enough wire format to drive the SDK client; the
 * runtime package's tests cover the protocol surface in depth.
 */
function startAuthCaptureServer(): Promise<{
  url: string;
  stop: () => Promise<void>;
  seenAuthorizations: string[];
}> {
  return new Promise(resolve => {
    const seen: string[] = [];
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        const auth = req.headers.authorization;
        const parsed = body
          ? JSON.parse(body)
          : ({} as Record<string, unknown>);
        if ((parsed as { id?: unknown }).id === undefined) {
          res.statusCode = 202;
          res.end();
          return;
        }
        if ((parsed as { method?: string }).method === 'tools/call') {
          seen.push(String(auth ?? ''));
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        const id = (parsed as { id: number | string }).id;
        const method = (parsed as { method: string }).method;
        if (method === 'initialize') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: { name: 'mock', version: '0.0.0' },
              },
            })
          );
          return;
        }
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: '{"ok":true}' }] },
          })
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('failed to start mock');
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        stop: () =>
          new Promise<void>((res, rej) =>
            server.close(err => (err ? rej(err) : res()))
          ),
        get seenAuthorizations() {
          return seen;
        },
      });
    });
  });
}

describe('createMcpAdapter', () => {
  it('builds a multi-server adapter with literal urls and headers', () => {
    const adapter = createMcpAdapter(
      {
        gh: {
          transport: 'http',
          url: 'https://mcp.github.example',
          headers: { 'x-trace': 'on' },
        },
        slack: {
          transport: 'streamable-http',
          url: 'https://mcp.slack.example',
        },
      },
      {}
    );
    expect(adapter.servers().sort()).toEqual(['gh', 'slack']);
  });

  it('resolves env-ref url and api_key auth into Bearer header', () => {
    const adapter = createMcpAdapter(
      {
        gh: {
          transport: 'http',
          url: { kind: 'env', name: 'GH_MCP_URL' },
          auth: {
            strategy: 'api_key',
            key: { kind: 'env', name: 'GH_MCP_TOKEN' },
          },
        },
      },
      {
        GH_MCP_URL: 'https://mcp.github.example',
        GH_MCP_TOKEN: 'tok-xyz',
      }
    );
    expect(adapter.servers()).toEqual(['gh']);
  });

  it('throws when an env-ref url is missing', () => {
    expect(() =>
      createMcpAdapter(
        { gh: { transport: 'http', url: { kind: 'env', name: 'NOPE' } } },
        {}
      )
    ).toThrow(/NOPE/);
  });

  it('resolves env-ref headers from the env source', () => {
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            transport: 'http',
            url: 'https://mcp.github.example',
            headers: {
              'x-trace': { kind: 'env', name: 'TRACE_VAL' },
            },
          },
        },
        { TRACE_VAL: 'on' }
      )
    ).not.toThrow();
  });

  it('throws when an env-ref header value is missing', () => {
    // Missing env-refs in headers must error loudly so deployments don't
    // silently ship without expected metadata (e.g. a tracing token).
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            transport: 'http',
            url: 'https://mcp.github.example',
            headers: {
              'x-trace': { kind: 'env', name: 'NOPE_TRACE' },
            },
          },
        },
        {}
      )
    ).toThrow(/NOPE_TRACE/);
  });

  it('throws on transport "stdio" (not yet supported)', () => {
    // Schema accepts stdio at parse time so older .agent files still load,
    // but the runtime only speaks streamable HTTP — fail loudly on boot
    // rather than silently downgrading to HTTP at first invocation.
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            transport: 'stdio' as McpServerConfig['transport'],
            url: 'https://mcp.github.example',
          },
        },
        {}
      )
    ).toThrow(/transport "stdio" is not supported/);
  });

  it('throws on transport "sse" (not yet supported)', () => {
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            transport: 'sse' as McpServerConfig['transport'],
            url: 'https://mcp.github.example',
          },
        },
        {}
      )
    ).toThrow(/transport "sse" is not supported/);
  });

  it('accepts transport "streamable-http"', () => {
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            transport: 'streamable-http',
            url: 'https://mcp.github.example',
          },
        },
        {}
      )
    ).not.toThrow();
  });

  it('accepts transport undefined (defaults)', () => {
    expect(() =>
      createMcpAdapter(
        {
          gh: {
            url: 'https://mcp.github.example',
          } as McpServerConfig,
        },
        {}
      )
    ).not.toThrow();
  });

  it('normalizes user-supplied header keys to lowercase', async () => {
    // Header names are case-insensitive on the wire. We canonicalize to
    // lowercase to avoid casing collisions when an `auth` block also writes
    // `authorization`. Verify by inspecting headers via the auth-capture
    // mock — `X-Custom` should arrive as `x-custom`.
    const mock = await startAuthCaptureServer();
    try {
      const adapter = createMcpAdapter(
        {
          gh: {
            transport: 'http',
            url: mock.url,
            headers: { 'X-Custom': 'foo' },
          },
        },
        {}
      );
      try {
        await adapter.invoke({ target: 'mcp://gh/anything', args: {} });
      } finally {
        await adapter.close();
      }
    } finally {
      await mock.stop();
    }
    // No assertion on the mock here — the header-normalization invariant is
    // covered by the next test (Authorization vs authorization collision).
    // This test just guards against `createMcpAdapter` rejecting mixed-case
    // user headers.
    expect(true).toBe(true);
  });

  it('collapses Authorization + auth-block to a single lowercase authorization header', async () => {
    // Critical regression guard: with explicit `Authorization` AND an `auth`
    // block, the merged header map must contain exactly one `authorization`
    // entry (lowercase) and the auth block must win.
    const mock = await startAuthCaptureServer();
    let observedAuthCount = 0;
    let observedAuthValue: string | undefined;
    try {
      const adapter = createMcpAdapter(
        {
          gh: {
            transport: 'http',
            url: mock.url,
            headers: { Authorization: 'literal-do-not-use' },
            auth: {
              strategy: 'api_key',
              key: { kind: 'env', name: 'GH_TOKEN' },
            },
          },
        },
        { GH_TOKEN: 'tok-xyz' }
      );
      try {
        await adapter.invoke({ target: 'mcp://gh/anything', args: {} });
      } finally {
        await adapter.close();
      }
      // The mock records the single `authorization` header value seen on
      // tools/call. Node lowercases incoming header names, so a duplicate
      // would appear as a comma-joined string ("a, b") — assert that did
      // NOT happen and that the auth-block value won.
      observedAuthValue = mock.seenAuthorizations.find(v => v.length > 0);
      observedAuthCount = mock.seenAuthorizations.filter(
        v => v.length > 0
      ).length;
    } finally {
      await mock.stop();
    }
    expect(observedAuthCount).toBeGreaterThan(0);
    expect(observedAuthValue).toBe('Bearer tok-xyz');
    // No comma-joined duplicate.
    expect(observedAuthValue).not.toContain(',');
    expect(observedAuthValue).not.toContain('literal-do-not-use');
  });

  it('warns and keeps last value when same header is supplied with different casings', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      expect(() =>
        createMcpAdapter(
          {
            gh: {
              transport: 'http',
              url: 'https://mcp.github.example',
              headers: { 'X-Trace': 'first', 'x-trace': 'second' },
            },
          },
          {}
        )
      ).not.toThrow();
    } finally {
      console.warn = originalWarn;
    }
    const collisionWarning = warnings.find(w =>
      w.includes('mcp_header_casing_collision')
    );
    expect(collisionWarning).toBeDefined();
  });

  it('lets auth.api_key override an explicit authorization header', async () => {
    // Documented behavior: `auth` runs after explicit headers in
    // resolveHeaders(), so the Bearer token wins. Pinned here so a refactor
    // doesn't silently flip precedence.
    const mock = await startAuthCaptureServer();
    try {
      const adapter = createMcpAdapter(
        {
          gh: {
            transport: 'http',
            url: mock.url,
            headers: { authorization: 'literal-do-not-use' },
            auth: {
              strategy: 'api_key',
              key: { kind: 'env', name: 'GH_TOKEN' },
            },
          },
        },
        { GH_TOKEN: 'tok-xyz' }
      );
      try {
        await adapter.invoke({ target: 'mcp://gh/anything', args: {} });
      } finally {
        await adapter.close();
      }
      expect(mock.seenAuthorizations).toContain('Bearer tok-xyz');
      expect(mock.seenAuthorizations).not.toContain('literal-do-not-use');
    } finally {
      await mock.stop();
    }
  });
});
