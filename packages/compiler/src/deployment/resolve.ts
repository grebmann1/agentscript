/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  DeploymentValue,
  EnvRef,
  LlmConfig,
  McpServerConfig,
} from '../types.js';

/** Source of environment variables. Mirrors `process.env` for testability. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Resolve a `DeploymentValue` (string or `env(NAME)` ref) into a string.
 * Throws when an env var is unset and no `default` is declared.
 */
export function resolveDeploymentValue(
  value: DeploymentValue | undefined,
  env: EnvSource,
  fieldPath: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return resolveEnvRef(value, env, fieldPath);
}

function resolveEnvRef(ref: EnvRef, env: EnvSource, fieldPath: string): string {
  const raw = env[ref.name];
  if (raw === undefined || raw === '') {
    if (ref.default !== undefined) {
      return ref.prefix ? ref.prefix + ref.default : ref.default;
    }
    throw new Error(
      `Environment variable "${ref.name}" required by ${fieldPath} is not set.`
    );
  }
  return ref.prefix ? ref.prefix + raw : raw;
}

/** Concrete strings produced from a `LlmConfig` after env resolution. */
export interface ResolvedLlmConfig {
  provider: LlmConfig['provider'];
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fallback?: Omit<ResolvedLlmConfig, 'fallback'>;
}

export function resolveLlmConfig(
  llm: LlmConfig,
  env: EnvSource
): ResolvedLlmConfig {
  const resolved: ResolvedLlmConfig = {
    provider: llm.provider,
    model: llm.model,
    apiKey: resolveDeploymentValue(llm.api_key, env, 'deployment.llm.api_key'),
    baseUrl: resolveDeploymentValue(
      llm.base_url,
      env,
      'deployment.llm.base_url'
    ),
  };
  if (llm.fallback) {
    resolved.fallback = {
      provider: llm.fallback.provider,
      model: llm.fallback.model,
      apiKey: resolveDeploymentValue(
        llm.fallback.api_key,
        env,
        'deployment.llm.fallback.api_key'
      ),
      baseUrl: resolveDeploymentValue(
        llm.fallback.base_url,
        env,
        'deployment.llm.fallback.base_url'
      ),
    };
  }
  return resolved;
}

/**
 * Walk a deployment block and collect every `env(NAME)` reference along with
 * the path where it appears. Used by the CLI to emit `.env.example`.
 */
export function walkEnvRefs(deployment: {
  llm?: LlmConfig;
  mcp?: Record<string, McpServerConfig>;
  server?: { auth_token?: DeploymentValue; rate_limit_rpm?: DeploymentValue };
}): Array<{ name: string; path: string }> {
  const refs: Array<{ name: string; path: string }> = [];
  const collect = (value: DeploymentValue | undefined, path: string) => {
    if (value && typeof value === 'object' && value.kind === 'env') {
      refs.push({ name: value.name, path });
    }
  };

  if (deployment.llm) {
    collect(deployment.llm.api_key, 'deployment.llm.api_key');
    collect(deployment.llm.base_url, 'deployment.llm.base_url');
    if (deployment.llm.fallback) {
      collect(
        deployment.llm.fallback.api_key,
        'deployment.llm.fallback.api_key'
      );
      collect(
        deployment.llm.fallback.base_url,
        'deployment.llm.fallback.base_url'
      );
    }
  }
  if (deployment.mcp) {
    for (const [name, server] of Object.entries(deployment.mcp)) {
      collect(server.url, `deployment.mcp.${name}.url`);
      if (server.auth && server.auth.strategy !== 'none') {
        collect(server.auth.key, `deployment.mcp.${name}.auth.key`);
      }
      if (server.headers) {
        for (const [headerName, headerValue] of Object.entries(
          server.headers
        )) {
          collect(headerValue, `deployment.mcp.${name}.headers.${headerName}`);
        }
      }
    }
  }
  if (deployment.server) {
    collect(deployment.server.auth_token, 'deployment.server.auth_token');
    collect(
      deployment.server.rate_limit_rpm,
      'deployment.server.rate_limit_rpm'
    );
  }
  return refs;
}
