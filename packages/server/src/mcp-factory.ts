/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  resolveDeploymentValue,
  type EnvSource,
  type McpServerConfig,
} from '@agentscript/compiler';
import { McpAdapter, type McpServerSettings } from '@agentscript/runtime';

/**
 * Resolve a parsed `deployment.mcp` map into runtime adapter settings (env-refs
 * applied), then build a single multi-server `McpAdapter`.
 */
export function createMcpAdapter(
  servers: Record<string, McpServerConfig>,
  env: EnvSource = process.env
): McpAdapter {
  const resolved: Record<string, McpServerSettings> = {};
  for (const [name, server] of Object.entries(servers)) {
    const url = resolveDeploymentValue(
      server.url,
      env,
      `deployment.mcp.${name}.url`
    );
    if (!url) {
      throw new Error(`deployment.mcp.${name}.url is required.`);
    }
    const headers = resolveHeaders(server, name, env);
    resolved[name] = headers ? { url, headers } : { url };
  }
  return new McpAdapter(resolved);
}

function resolveHeaders(
  server: McpServerConfig,
  name: string,
  env: EnvSource
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (server.headers) {
    for (const [key, value] of Object.entries(server.headers)) {
      const resolved = resolveDeploymentValue(
        value,
        env,
        `deployment.mcp.${name}.headers.${key}`
      );
      if (resolved !== undefined) out[key] = resolved;
    }
  }
  if (server.auth && server.auth.strategy !== 'none') {
    // Both `api_key` and `bearer` strategies emit `Authorization: Bearer …` —
    // the wire format is identical; the strategy name is just an authoring hint.
    const key = resolveDeploymentValue(
      server.auth.key,
      env,
      `deployment.mcp.${name}.auth.key`
    );
    if (key) {
      out.authorization = `Bearer ${key}`;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pick the union of `deployment.mcp` blocks across loaded agents. When two
 * agents declare the same server name, their configs must match exactly —
 * otherwise we'd silently bind one to a stale URL or token.
 */
export function reconcileDeploymentMcp(
  perAgent: Array<{ id: string; mcp?: Record<string, McpServerConfig> }>
): Record<string, McpServerConfig> | undefined {
  const merged: Record<string, McpServerConfig> = {};
  const owners: Record<string, string> = {};
  let anyDeclared = false;
  for (const entry of perAgent) {
    if (!entry.mcp) continue;
    anyDeclared = true;
    for (const [name, server] of Object.entries(entry.mcp)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = server;
        owners[name] = entry.id;
        continue;
      }
      if (!mcpServerEqual(existing, server)) {
        throw new Error(
          `Conflicting deployment.mcp."${name}" blocks: agents "${owners[name]}" and "${entry.id}" disagree. ` +
            `Servers sharing a name across .agent files must declare identical config.`
        );
      }
    }
  }
  return anyDeclared ? merged : undefined;
}

function mcpServerEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  // Canonical (key-order-independent) comparison so re-loading agents whose
  // YAML maps come back with different key ordering doesn't trigger spurious
  // adapter rebuilds or "conflicting blocks" errors.
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') +
    '}'
  );
}
