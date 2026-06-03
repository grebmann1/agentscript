/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@agentscript/compiler';
import {
  createLlmOptionsFromDeployment,
  createLlmOptionsFromServerConfig,
} from '../src/llm-factory.js';
import type { ServerConfig } from '../src/types.js';

const baseServerConfig: ServerConfig = {
  port: 8080,
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  agentsDir: '/tmp',
  sessionTtlMs: 1000,
  maxSessions: 10,
  sessionStoreBackend: 'memory',
  authTokens: [],
  mcpAuthTokens: [],
  corsAllowedOrigins: ['*'],
  maxRequestBytes: 1000,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 60,
  turnTimeoutMs: 30_000,
  llmCircuitFailures: 5,
  llmCircuitOpenMs: 30_000,
};

describe('createLlmOptionsFromDeployment', () => {
  it('builds anthropic driver options from env-ref api_key', () => {
    const llm: LlmConfig = {
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      api_key: { kind: 'env', name: 'ANTHROPIC_API_KEY' },
    };
    const opts = createLlmOptionsFromDeployment(llm, {
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(opts.model).toBeDefined();
    expect(typeof opts.generateText).toBe('function');
  });

  it('builds openai driver options', () => {
    const llm: LlmConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      api_key: { kind: 'env', name: 'OPENAI_API_KEY' },
    };
    const opts = createLlmOptionsFromDeployment(llm, {
      OPENAI_API_KEY: 'sk-test',
    });
    expect(opts.model).toBeDefined();
  });

  it('builds google driver options', () => {
    const llm: LlmConfig = {
      provider: 'google',
      model: 'gemini-2.0-flash',
      api_key: { kind: 'env', name: 'GOOGLE_API_KEY' },
    };
    const opts = createLlmOptionsFromDeployment(llm, {
      GOOGLE_API_KEY: 'g-test',
    });
    expect(opts.model).toBeDefined();
  });

  it('requires base_url for openai-compatible provider', () => {
    const llm: LlmConfig = {
      provider: 'openai-compatible',
      model: 'custom',
      api_key: { kind: 'env', name: 'KEY' },
    };
    expect(() => createLlmOptionsFromDeployment(llm, { KEY: 'k' })).toThrow(
      /base_url/
    );
  });

  it('throws when env var is missing', () => {
    const llm: LlmConfig = {
      provider: 'anthropic',
      model: 'm',
      api_key: { kind: 'env', name: 'NOT_SET' },
    };
    expect(() => createLlmOptionsFromDeployment(llm, {})).toThrow(/NOT_SET/);
  });

  it('uses literal api_key when given (no env-ref)', () => {
    const llm: LlmConfig = {
      provider: 'anthropic',
      model: 'm',
      api_key: 'sk-literal',
    };
    const opts = createLlmOptionsFromDeployment(llm, {});
    expect(opts.model).toBeDefined();
  });
});

describe('createLlmOptionsFromServerConfig', () => {
  it('throws when LLM env vars are unset', () => {
    expect(() => createLlmOptionsFromServerConfig(baseServerConfig)).toThrow(
      /No LLM configured/
    );
  });

  it('builds openai driver from ServerConfig', () => {
    const opts = createLlmOptionsFromServerConfig({
      ...baseServerConfig,
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-x',
      llmModel: 'gpt-4o-mini',
    });
    expect(opts.model).toBeDefined();
  });
});
