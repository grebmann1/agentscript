/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDeploymentValue,
  resolveLlmConfig,
  walkEnvRefs,
} from '../src/deployment/resolve.js';
import type { LlmConfig } from '../src/types.js';

describe('resolveDeploymentValue', () => {
  it('returns string literals unchanged', () => {
    expect(resolveDeploymentValue('hello', {}, 'x')).toBe('hello');
  });

  it('reads env-ref values from the env source', () => {
    const v = resolveDeploymentValue(
      { kind: 'env', name: 'API_KEY' },
      { API_KEY: 'sk-123' },
      'deployment.llm.api_key'
    );
    expect(v).toBe('sk-123');
  });

  it('applies prefix when present', () => {
    const v = resolveDeploymentValue(
      { kind: 'env', name: 'TOKEN', prefix: 'Bearer ' },
      { TOKEN: 'abc' },
      'h.Authorization'
    );
    expect(v).toBe('Bearer abc');
  });

  it('falls back to default when env is unset', () => {
    const v = resolveDeploymentValue(
      { kind: 'env', name: 'MISSING', default: 'fallback' },
      {},
      'x'
    );
    expect(v).toBe('fallback');
  });

  it('combines prefix with default', () => {
    const v = resolveDeploymentValue(
      { kind: 'env', name: 'MISSING', prefix: 'Bearer ', default: 'def' },
      {},
      'x'
    );
    expect(v).toBe('Bearer def');
  });

  it('throws when env is unset and no default is given', () => {
    expect(() =>
      resolveDeploymentValue(
        { kind: 'env', name: 'NOPE' },
        {},
        'deployment.llm.api_key'
      )
    ).toThrow(/NOPE.*deployment\.llm\.api_key/);
  });

  it('treats empty-string env as unset', () => {
    expect(() =>
      resolveDeploymentValue({ kind: 'env', name: 'X' }, { X: '' }, 'p')
    ).toThrow(/X/);
  });
});

describe('resolveLlmConfig', () => {
  it('resolves provider, model, api_key, base_url', () => {
    const llm: LlmConfig = {
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      api_key: { kind: 'env', name: 'ANTHROPIC_API_KEY' },
    };
    const r = resolveLlmConfig(llm, { ANTHROPIC_API_KEY: 'sk-ant' });
    expect(r).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      apiKey: 'sk-ant',
      baseUrl: undefined,
    });
  });

  it('resolves fallback', () => {
    const llm: LlmConfig = {
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      api_key: { kind: 'env', name: 'A' },
      fallback: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: { kind: 'env', name: 'O' },
      },
    };
    const r = resolveLlmConfig(llm, { A: 'a-val', O: 'o-val' });
    expect(r.fallback).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'o-val',
      baseUrl: undefined,
    });
  });
});

describe('walkEnvRefs', () => {
  it('collects every env-ref with its path', () => {
    const refs = walkEnvRefs({
      llm: {
        provider: 'anthropic',
        model: 'm',
        api_key: { kind: 'env', name: 'API_KEY' },
        fallback: {
          provider: 'openai',
          model: 'm2',
          api_key: { kind: 'env', name: 'FALLBACK_KEY' },
        },
      },
      mcp: {
        github: {
          transport: 'streamable-http',
          url: { kind: 'env', name: 'GH_URL' },
          auth: { strategy: 'api_key', key: { kind: 'env', name: 'GH_TOKEN' } },
        },
      },
      server: {
        auth_token: { kind: 'env', name: 'API_TOKEN' },
      },
    });
    expect(refs.map(r => r.name).sort()).toEqual([
      'API_KEY',
      'API_TOKEN',
      'FALLBACK_KEY',
      'GH_TOKEN',
      'GH_URL',
    ]);
  });

  it('returns [] when no env-refs are used', () => {
    expect(
      walkEnvRefs({
        llm: { provider: 'anthropic', model: 'm', api_key: 'literal' },
      })
    ).toEqual([]);
  });
});
