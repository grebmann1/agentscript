/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  DeploymentConfig,
  DeploymentValue,
  LlmConfig,
  McpServerConfig,
  ServerConfig,
} from '../types.js';
import { extractStringValue, getCstRange } from '../ast-helpers.js';
import { parseDeploymentValue, isSecretField } from './env-ref.js';
import { parseMcpUri } from '../utils.js';

const VALID_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'openai-compatible',
]);

const VALID_TRANSPORTS = new Set(['http', 'streamable-http']);
const PLANNED_TRANSPORTS = new Set(['stdio', 'sse']);
const VALID_AUTH_STRATEGIES = new Set(['api_key', 'bearer', 'none']);

/**
 * Compile the optional `deployment:` block to typed IR. Validates env-ref
 * shape, lints secret-shaped fields with literal values, and validates that
 * `mcp://server/tool` action targets reference a declared server.
 *
 * Returns undefined when no deployment block is present.
 */
export function compileDeployment(
  deploymentBlock: unknown,
  ctx: CompilerContext,
  actionTargets: string[] = []
): DeploymentConfig | undefined {
  if (!deploymentBlock || typeof deploymentBlock !== 'object') return undefined;
  const block = deploymentBlock as Record<string, unknown>;

  const result: DeploymentConfig = {};

  if (block.llm) {
    const llm = compileLlm(block.llm, ctx);
    if (llm) result.llm = llm;
  }

  if (block.mcp) {
    const mcp = compileMcp(block.mcp, ctx);
    if (mcp && Object.keys(mcp).length > 0) result.mcp = mcp;
  }

  if (block.server) {
    const server = compileServer(block.server, ctx);
    if (server && Object.keys(server).length > 0) result.server = server;
  }

  // Cross-check: every mcp:// action target must reference a declared server.
  for (const target of actionTargets) {
    const parsed = parseMcpUri(target);
    if (!parsed) continue;
    if (!result.mcp || !(parsed.server in result.mcp)) {
      ctx.error(
        `mcp action target "${target}" references undeclared MCP server "${parsed.server}". Declare it under deployment.mcp.${parsed.server}.`
      );
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function compileLlm(
  llmBlock: unknown,
  ctx: CompilerContext
): LlmConfig | undefined {
  if (!llmBlock || typeof llmBlock !== 'object') return undefined;
  const b = llmBlock as Record<string, unknown>;

  const provider = extractStringValue(b.provider);
  const model = extractStringValue(b.model);
  if (!provider || !model) {
    ctx.error(
      'deployment.llm requires both `provider` and `model`.',
      getCstRange(llmBlock)
    );
    return undefined;
  }
  if (!VALID_PROVIDERS.has(provider)) {
    ctx.error(
      `deployment.llm.provider must be one of ${[...VALID_PROVIDERS].join(', ')} (got "${provider}").`,
      getCstRange(b.provider)
    );
    return undefined;
  }

  const llm: LlmConfig = {
    provider: provider as LlmConfig['provider'],
    model,
  };

  const apiKey = compileValue(b.api_key, 'api_key', ctx);
  if (apiKey !== undefined) llm.api_key = apiKey;

  const baseUrl = compileValue(b.base_url, 'base_url', ctx);
  if (baseUrl !== undefined) llm.base_url = baseUrl;

  if (b.fallback) {
    const fbBlock = b.fallback as Record<string, unknown>;
    const fbProvider = extractStringValue(fbBlock.provider);
    const fbModel = extractStringValue(fbBlock.model);
    if (
      fbProvider &&
      fbModel &&
      VALID_PROVIDERS.has(fbProvider) &&
      fbProvider !== provider
    ) {
      llm.fallback = {
        provider: fbProvider as LlmConfig['provider'],
        model: fbModel,
      };
      const fbKey = compileValue(fbBlock.api_key, 'api_key', ctx);
      if (fbKey !== undefined) llm.fallback.api_key = fbKey;
      const fbBase = compileValue(fbBlock.base_url, 'base_url', ctx);
      if (fbBase !== undefined) llm.fallback.base_url = fbBase;
    }
  }

  return llm;
}

function compileMcp(
  mcpBlock: unknown,
  ctx: CompilerContext
): Record<string, McpServerConfig> | undefined {
  const result: Record<string, McpServerConfig> = {};

  // The block is a NamedCollectionBlock — values are keyed by server name.
  // Either a Map or a record-shaped object depending on parse path.
  const entries = mcpToEntries(mcpBlock);
  for (const [serverName, serverBlockRaw] of entries) {
    if (!serverBlockRaw || typeof serverBlockRaw !== 'object') continue;
    const sb = serverBlockRaw as Record<string, unknown>;

    const transport = extractStringValue(sb.transport);
    const url = compileValue(sb.url, 'url', ctx);
    if (!transport || url === undefined) {
      ctx.error(
        `deployment.mcp.${serverName} requires both \`transport\` and \`url\`.`,
        getCstRange(serverBlockRaw)
      );
      continue;
    }
    if (!VALID_TRANSPORTS.has(transport)) {
      if (PLANNED_TRANSPORTS.has(transport)) {
        ctx.error(
          `deployment.mcp.${serverName}.transport "${transport}" is not yet implemented. Supported transports: ${[...VALID_TRANSPORTS].join(', ')}.`,
          getCstRange(sb.transport)
        );
      } else {
        ctx.error(
          `deployment.mcp.${serverName}.transport must be one of ${[...VALID_TRANSPORTS].join(', ')} (got "${transport}").`,
          getCstRange(sb.transport)
        );
      }
      continue;
    }

    const server: McpServerConfig = {
      transport: transport as McpServerConfig['transport'],
      url,
    };

    if (sb.headers) {
      const headers: Record<string, DeploymentValue> = {};
      for (const [headerName, headerRaw] of objectEntries(sb.headers)) {
        const v = compileValue(headerRaw, headerName, ctx);
        if (v !== undefined) headers[headerName] = v;
      }
      if (Object.keys(headers).length > 0) {
        server.headers = headers;
      }
    }

    if (sb.auth && typeof sb.auth === 'object') {
      const ab = sb.auth as Record<string, unknown>;
      const strategy = extractStringValue(ab.strategy);
      if (strategy === undefined) {
        ctx.error(
          `deployment.mcp.${serverName}.auth requires a \`strategy\` field.`,
          getCstRange(sb.auth)
        );
      } else if (!VALID_AUTH_STRATEGIES.has(strategy)) {
        ctx.error(
          `deployment.mcp.${serverName}.auth.strategy must be one of ${[...VALID_AUTH_STRATEGIES].join(', ')} (got "${strategy}").`,
          getCstRange(ab.strategy)
        );
      } else if (strategy === 'none') {
        server.auth = { strategy: 'none' };
      } else {
        const key = compileValue(ab.key, 'key', ctx);
        if (key === undefined) {
          ctx.error(
            `deployment.mcp.${serverName}.auth.key is required for strategy "${strategy}".`,
            getCstRange(sb.auth)
          );
        } else {
          server.auth = { strategy: strategy as 'api_key' | 'bearer', key };
        }
      }
    }

    result[serverName] = server;
  }

  return result;
}

function compileServer(
  serverBlock: unknown,
  ctx: CompilerContext
): ServerConfig | undefined {
  if (!serverBlock || typeof serverBlock !== 'object') return undefined;
  const b = serverBlock as Record<string, unknown>;
  const result: ServerConfig = {};

  const authToken = compileValue(b.auth_token, 'auth_token', ctx);
  if (authToken !== undefined) result.auth_token = authToken;

  const rateLimit = compileValue(b.rate_limit_rpm, 'rate_limit_rpm', ctx);
  if (rateLimit !== undefined) result.rate_limit_rpm = rateLimit;

  const sessionStore = extractStringValue(b.session_store);
  if (sessionStore === 'memory' || sessionStore === 'postgres') {
    result.session_store = sessionStore;
  }

  return result;
}

function compileValue(
  raw: unknown,
  fieldName: string,
  ctx: CompilerContext
): DeploymentValue | undefined {
  const s = extractStringValue(raw);
  if (s === undefined) return undefined;
  const parsed = parseDeploymentValue(s);
  if (typeof parsed === 'string' && isSecretField(fieldName)) {
    ctx.warning(
      `Secret-shaped field "${fieldName}" should use env(NAME) to keep credentials out of source. Got literal value.`,
      getCstRange(raw)
    );
  }
  return parsed;
}

function mcpToEntries(mcpBlock: unknown): Array<[string, unknown]> {
  return objectEntries(mcpBlock);
}

function objectEntries(block: unknown): Array<[string, unknown]> {
  if (!block) return [];
  if (block instanceof Map) return Array.from(block.entries());
  if (isNamedMap(block)) return Array.from(block.entries());
  if (typeof block === 'object') {
    return Object.entries(block as Record<string, unknown>).filter(
      ([k]) => !k.startsWith('__')
    );
  }
  return [];
}
