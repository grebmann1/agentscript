/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, jsonSchema } from 'ai';
import {
  resolveLlmConfig,
  type EnvSource,
  type LlmConfig,
  type ResolvedLlmConfig,
} from '@agentscript/compiler';
import type {
  GenerateTextFn,
  VercelDriverOptions,
} from '@agentscript/runtime-vercel';
import type { ServerConfig } from './types.js';

/**
 * Build runtime LLM driver options from a parsed `deployment.llm` block.
 *
 * The provider strings come from the dialect schema and have already been
 * validated by the compiler. We dispatch to the matching `@ai-sdk/*` factory.
 */
export function createLlmOptionsFromDeployment(
  llm: LlmConfig,
  env: EnvSource = process.env
): VercelDriverOptions {
  const resolved = resolveLlmConfig(llm, env);
  return {
    model: instantiateModel(resolved),
    generateText: generateText as unknown as GenerateTextFn,
    jsonSchema: jsonSchema as unknown as (
      schema: Record<string, unknown>
    ) => unknown,
  };
}

/**
 * Legacy path: build options from env-var-driven `ServerConfig`. Used when no
 * `.agent` file declares `deployment.llm`.
 */
export function createLlmOptionsFromServerConfig(
  config: ServerConfig
): VercelDriverOptions {
  if (!config.llmBaseUrl || !config.llmApiKey || !config.llmModel) {
    throw new Error(
      'No LLM configured. Either declare `deployment.llm:` in a .agent file ' +
        'or set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL environment variables.'
    );
  }
  const openai = createOpenAI({
    baseURL: config.llmBaseUrl,
    apiKey: config.llmApiKey,
  });
  return {
    model: openai.chat(config.llmModel),
    generateText: generateText as unknown as GenerateTextFn,
    jsonSchema: jsonSchema as unknown as (
      schema: Record<string, unknown>
    ) => unknown,
  };
}

function instantiateModel(resolved: ResolvedLlmConfig) {
  switch (resolved.provider) {
    case 'anthropic': {
      const factory = createAnthropic({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return factory(resolved.model);
    }
    case 'openai': {
      const factory = createOpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return factory.chat(resolved.model);
    }
    case 'google': {
      const factory = createGoogleGenerativeAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return factory(resolved.model);
    }
    case 'openai-compatible': {
      if (!resolved.baseUrl) {
        throw new Error(
          'deployment.llm.base_url is required when provider is "openai-compatible".'
        );
      }
      const factory = createOpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return factory.chat(resolved.model);
    }
    default: {
      const exhaustive: never = resolved.provider;
      throw new Error(`Unknown LLM provider: ${exhaustive as string}`);
    }
  }
}

/**
 * Pick a single `LlmConfig` shared by every loaded agent. Returns `undefined`
 * when no agent declares one. Throws when agents disagree.
 */
export function reconcileDeploymentLlm(
  perAgent: Array<{ id: string; llm?: LlmConfig }>
): LlmConfig | undefined {
  const declared = perAgent.filter(e => e.llm) as Array<{
    id: string;
    llm: LlmConfig;
  }>;
  if (declared.length === 0) return undefined;
  const [first, ...rest] = declared;
  for (const other of rest) {
    if (!llmEqual(first.llm, other.llm)) {
      throw new Error(
        `Conflicting deployment.llm blocks: agents "${first.id}" and "${other.id}" disagree. ` +
          `All loaded .agent files must declare the same llm config or none at all.`
      );
    }
  }
  return first.llm;
}

function llmEqual(a: LlmConfig, b: LlmConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
