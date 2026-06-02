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

/** Safety belt: refuse to follow more than this many `nextCursor` pages. */
const MAX_LIST_TOOLS_PAGES = 50;

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

/**
 * Parse an `mcp://<server>/<tool>` target.
 *
 * Note: server names cannot contain `/` (we split on the first `/`). Tool
 * names may be percent-encoded; `%2F` is allowed (it decodes to `/`) and the
 * `..` traversal check is performed AFTER percent-decoding, so encoded
 * traversal attempts (`%2e%2e/`) are also rejected.
 */
export function parseMcpTarget(target: string): {
  server: string;
  tool: string;
} {
  if (!target.startsWith('mcp://')) {
    throw new Error(`Invalid MCP target: ${target}`);
  }
  const rest = target.slice('mcp://'.length);
  // Split on first '/' — server names cannot contain '/'.
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(
      `Invalid MCP target "${target}". Expected "mcp://<server>/<tool>".`
    );
  }
  const server = rest.slice(0, slash);
  const rawTool = rest.slice(slash + 1);
  let tool: string;
  try {
    tool = decodeURIComponent(rawTool);
  } catch {
    throw new Error(`Invalid MCP tool name (malformed escape): ${rawTool}`);
  }
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
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        {
          signal: composeSignal(signal, this.timeoutMs),
        }
      );
    } catch (err) {
      // A throw from `callTool` is a transport-level failure (server reset,
      // closed socket, abort). A tool that returns `isError: true` does NOT
      // throw — that path lives below. Drop the cached client so the next
      // invocation reconnects.
      this.invalidate();
      throw err;
    }

    if (result.isError) {
      const text = joinTextParts(result.content);
      throw new Error(
        `MCP server "${this.serverName}" tool "${toolName}" reported an error: ${text || 'unknown error'}`
      );
    }

    // Priority 1: typed structured content (MCP 2025-03 spec).
    if (
      result.structuredContent &&
      typeof result.structuredContent === 'object'
    ) {
      return result.structuredContent as Record<string, unknown>;
    }

    const content = Array.isArray(result.content) ? result.content : [];
    const textParts = content.filter(
      (p): p is { type: 'text'; text: string } =>
        !!p &&
        typeof p === 'object' &&
        (p as { type?: unknown }).type === 'text' &&
        typeof (p as { text?: unknown }).text === 'string'
    );

    // Priority 2: exactly one text part that parses as JSON.
    if (textParts.length === 1) {
      try {
        const parsed = JSON.parse(textParts[0].text);
        if (parsed !== null && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
        // Primitive JSON (string/number/bool/null) — fall through to text path.
      } catch {
        // Not JSON — fall through.
      }
    }

    // Priority 3: any text parts → joined `text` plus original content.
    if (textParts.length > 0) {
      const joined = textParts.map(p => p.text).join('\n');
      return { text: joined, content: result.content };
    }

    // Priority 4: no text parts (images, resource_links, embedded resources).
    return { content: result.content };
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDef[]> {
    const client = await this.connect();
    const tools: McpToolDef[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      let page: Awaited<ReturnType<Client['listTools']>>;
      try {
        page = await client.listTools(
          cursor === undefined ? undefined : { cursor },
          { signal: composeSignal(signal, this.timeoutMs) }
        );
      } catch (err) {
        this.invalidate();
        throw err;
      }
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        });
      }
      cursor = page.nextCursor;
      pages++;
      if (pages > MAX_LIST_TOOLS_PAGES) {
        throw new Error(
          `MCP server "${this.serverName}" listTools exceeded ${MAX_LIST_TOOLS_PAGES} pages`
        );
      }
    } while (cursor !== undefined);

    return tools;
  }

  async close(): Promise<void> {
    if (!this.connectPromise) return;
    const client = await this.connectPromise.catch(() => null);
    this.connectPromise = null;
    if (client) await client.close();
  }

  /**
   * Tear down a (presumed-broken) cached client and clear the connect
   * promise so the next call reconnects. Safe to call concurrently.
   */
  private invalidate(): void {
    const pending = this.connectPromise;
    this.connectPromise = null;
    if (pending) {
      void pending.then(
        client => client.close().catch(() => {}),
        () => {}
      );
    }
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

/**
 * Compose an optional user signal with a per-call timeout signal so EITHER
 * one can cancel the request. Node 20+ provides `AbortSignal.any` natively.
 */
function composeSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeout;
  return AbortSignal.any([userSignal, timeout]);
}

/**
 * Concatenate every `type === 'text'` content part with newlines. Returns
 * `undefined` when there are none. Used by the error-message extractor.
 */
function joinTextParts(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}
