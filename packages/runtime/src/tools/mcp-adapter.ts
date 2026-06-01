/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { ToolAdapter, ToolAdapterInvocation } from './registry.js';
import {
  MCP_DEFAULT_TIMEOUT_MS,
  type McpServerSettings,
  type McpToolDef,
} from './mcp-types.js';

const CLIENT_INFO = { name: 'agentscript', version: '0.1.0' } as const;

/**
 * Multi-server MCP adapter — wraps the official `@modelcontextprotocol/sdk`
 * `Client` for each registered server. Registered against the `mcp://` scheme,
 * so a target `mcp://<server>/<tool>` routes to the matching connection.
 *
 * The adapter takes already-resolved settings (URL, headers, optional
 * transport/factory). Env-var resolution happens in the server package
 * before construction.
 *
 * Extending transports is a one-line change in {@link createTransport}.
 */
export class McpAdapter implements ToolAdapter {
  private readonly connections = new Map<string, McpConnection>();

  constructor(servers: Record<string, McpServerSettings>) {
    for (const [name, settings] of Object.entries(servers)) {
      this.connections.set(name, new McpConnection(name, settings));
    }
  }

  async invoke({
    target,
    args,
    signal,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    const parsed = parseMcpTarget(target);
    const connection = this.connections.get(parsed.server);
    if (!connection) {
      throw new Error(
        `No MCP server registered as "${parsed.server}" (target "${target}")`
      );
    }
    return connection.callTool(parsed.tool, args, signal);
  }

  /** List tools exposed by a specific MCP server. */
  async listTools(server: string, signal?: AbortSignal): Promise<McpToolDef[]> {
    const connection = this.connections.get(server);
    if (!connection) {
      throw new Error(`No MCP server registered as "${server}"`);
    }
    return connection.listTools(signal);
  }

  /** Names of all registered MCP servers. */
  servers(): string[] {
    return [...this.connections.keys()];
  }

  /** Close every underlying transport. Idempotent. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(c => c.close().catch(() => {}))
    );
  }
}

export function parseMcpTarget(target: string): {
  server: string;
  tool: string;
} {
  if (!target.startsWith('mcp://')) {
    throw new Error(`Invalid MCP target: ${target}`);
  }
  const rest = target.slice('mcp://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(
      `Invalid MCP target "${target}". Expected "mcp://<server>/<tool>".`
    );
  }
  const server = rest.slice(0, slash);
  const tool = rest.slice(slash + 1);
  if (tool.includes('..')) {
    throw new Error(`Invalid MCP tool name: ${tool}`);
  }
  return { server, tool };
}

/**
 * Strategy seam: returns a `Transport` for the given resolved server
 * settings. Today: streamable HTTP (also supports plain JSON HTTP). Add new
 * transports (SSE, stdio, custom) by branching on `settings.transport` here.
 */
function createTransport(settings: McpServerSettings): Transport {
  return new StreamableHTTPClientTransport(new URL(settings.url), {
    requestInit: {
      headers: settings.headers,
    },
  });
}

class McpConnection {
  private connectPromise: Promise<Client> | null = null;
  private readonly timeoutMs: number;

  constructor(
    private readonly serverName: string,
    private readonly settings: McpServerSettings
  ) {
    this.timeoutMs = settings.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const client = await this.connect();
    const result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal: signal ?? AbortSignal.timeout(this.timeoutMs) }
    );

    if (result.isError) {
      const text = extractText(result.content);
      throw new Error(
        `MCP server "${this.serverName}" tool "${toolName}" reported an error: ${text || 'unknown error'}`
      );
    }

    const text = extractText(result.content);
    if (text !== undefined) {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { text };
      }
    }
    // Fallback: pass the raw result through (callers can inspect content).
    return result as unknown as Record<string, unknown>;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDef[]> {
    const client = await this.connect();
    const result = await client.listTools(undefined, {
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    return result.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  async close(): Promise<void> {
    if (!this.connectPromise) return;
    const client = await this.connectPromise.catch(() => null);
    this.connectPromise = null;
    if (client) await client.close();
  }

  private connect(): Promise<Client> {
    if (this.connectPromise === null) {
      this.connectPromise = (async () => {
        const transport = createTransport(this.settings);
        const client = new Client(CLIENT_INFO);
        try {
          await client.connect(transport);
        } catch (err) {
          this.connectPromise = null;
          throw new Error(
            `Failed to connect to MCP server "${this.serverName}": ${(err as Error).message}`
          );
        }
        return client;
      })();
    }
    return this.connectPromise;
  }
}

function extractText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      return (part as { text: string }).text;
    }
  }
  return undefined;
}
