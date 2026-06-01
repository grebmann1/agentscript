/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool description returned by an MCP server's `tools/list` call.
 * Mirrors the MCP 2024-11-05 schema.
 */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Resolved MCP server settings consumed by the Node adapter. The compiler IR
 * uses `EnvRef | string` for `url` / `headers`; the server package resolves
 * env-vars before handing values to the runtime, so the runtime stays free of
 * compiler / env-ref types.
 */
export interface McpServerSettings {
  /** Endpoint URL — already env-resolved. */
  url: string;
  /** Extra HTTP headers — already env-resolved. */
  headers?: Record<string, string>;
  /** Per-call timeout in milliseconds (defaults to 30s). */
  timeoutMs?: number;
}

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
