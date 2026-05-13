/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ToolAdapter, ToolAdapterInvocation } from '@agentscript/runtime';

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * MCP adapter that speaks JSON-RPC 2.0 over HTTP — runs entirely in the browser
 * via fetch(). Targets MCP servers that expose a streamable-HTTP or plain HTTP
 * transport (no stdio, no WebSocket).
 */
export class McpBrowserAdapter implements ToolAdapter {
  private initPromise: Promise<void> | null = null;
  private nextId = 1;

  constructor(
    private readonly serverUrl: string,
    private readonly headers: Record<string, string> = {}
  ) {}

  async invoke({
    target,
    args,
    signal,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    if (!target.startsWith('mcp://')) {
      throw new Error(`Invalid MCP target: ${target}`);
    }
    const toolName = target.slice('mcp://'.length);
    if (!toolName || toolName.includes('/') || toolName.includes('..')) {
      throw new Error(`Invalid MCP tool name: ${toolName}`);
    }

    await this.ensureInitialized(signal);
    const result = await this.rpc(
      'tools/call',
      { name: toolName, arguments: args },
      signal
    );

    const content = result.content as
      | Array<{ type: string; text: string }>
      | undefined;
    const textContent = content?.find((c) => c.type === 'text');
    if (textContent) {
      try {
        return JSON.parse(textContent.text) as Record<string, unknown>;
      } catch {
        return { text: textContent.text };
      }
    }
    return result;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDef[]> {
    await this.ensureInitialized(signal);
    const result = await this.rpc('tools/list', undefined, signal);
    return (result.tools as McpToolDef[]) ?? [];
  }

  private ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize(signal).catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInitialize(signal?: AbortSignal): Promise<void> {
    await this.rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentscript-playground', version: '0.1.0' },
      },
      signal
    );
    // MCP spec requires notifications/initialized after successful handshake
    await fetch(this.serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
      signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  }

  private async rpc(
    method: string,
    params?: unknown,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const effectiveSignal = signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const requestId = this.nextId++;

    const res = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method,
        params: params ?? {},
      }),
      signal: effectiveSignal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '').then((t) => t.slice(0, 500));
      throw new Error(`MCP server returned ${res.status}: ${body}`);
    }
    const json = (await res.json()) as McpRpcResponse;
    if (json.jsonrpc !== '2.0') {
      throw new Error(`Invalid JSON-RPC response: missing jsonrpc "2.0" field`);
    }
    if (json.id !== requestId) {
      throw new Error(`JSON-RPC id mismatch: expected ${requestId}, got ${json.id}`);
    }
    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    return (json.result as Record<string, unknown>) ?? {};
  }
}
