/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpAdapter } from '@agentscript/runtime';

/**
 * Convert every tool exposed by the registered MCP servers into a Vercel AI
 * SDK `ToolSet`, keyed as `<server>__<tool>`. Each tool's `execute()` routes
 * back through the same {@link McpAdapter}, so credentials and the underlying
 * MCP transport are reused — no separate connection is opened per tool.
 *
 * Designed for use inside `runtime-vercel`'s driver, but exposed publicly so
 * callers can hand the resulting tools directly to `streamText` /
 * `generateText` from `ai`.
 *
 * @example
 *   const tools = await mcpToolsForVercel(adapter, { tool, jsonSchema });
 *   const result = await streamText({ model, messages, tools });
 */
export async function mcpToolsForVercel(
  adapter: McpAdapter,
  factory: VercelToolFactories
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const server of adapter.servers()) {
    const defs = await adapter.listTools(server);
    for (const def of defs) {
      const toolName = `${server}__${def.name}`;
      const inputSchema =
        def.inputSchema && factory.jsonSchema
          ? factory.jsonSchema(def.inputSchema)
          : (def.inputSchema ?? { type: 'object' });
      out[toolName] = factory.tool({
        description: def.description ?? `MCP tool ${def.name} on ${server}`,
        inputSchema,
        execute: (
          args: Record<string, unknown>,
          opts?: { signal?: AbortSignal }
        ) =>
          adapter.invoke({
            target: `mcp://${server}/${def.name}`,
            args,
            signal: opts?.signal,
          }),
      });
    }
  }
  return out;
}

/**
 * Vercel AI SDK builders required to materialize MCP tools. Injected so this
 * package doesn't hard-depend on a specific `ai` major version (mirrors the
 * pattern used by {@link VercelAiSdkDriver}).
 */
export interface VercelToolFactories {
  /** `tool` from the `ai` package. */
  tool: (config: {
    description: string;
    inputSchema: unknown;
    execute: (
      args: Record<string, unknown>,
      opts?: { signal?: AbortSignal }
    ) => Promise<Record<string, unknown>>;
  }) => unknown;
  /**
   * `jsonSchema` from `@ai-sdk/provider-utils` (re-exported by `ai`). Optional
   * — when omitted, the raw JSON Schema is passed through, which works on some
   * builds of `ai` and not others.
   */
  jsonSchema?: (schema: Record<string, unknown>) => unknown;
}
