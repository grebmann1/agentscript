/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';
import type { AgentDSLAuthoringWithDeployment } from '../src/types.js';

const HEADER = `config:
    agent_name: "TestBot"
`;
const FOOTER = `
start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;

function compileWithDeployment(deploymentBlock: string) {
  const { output, diagnostics } = compile(
    parseSource(HEADER + deploymentBlock + FOOTER)
  );
  return {
    deployment: (output as AgentDSLAuthoringWithDeployment).deployment,
    diagnostics,
  };
}

describe('deployment block — IR plumbing', () => {
  it('omits deployment field when no block is present', () => {
    const { output } = compile(parseSource(HEADER + FOOTER));
    const deployment = (output as AgentDSLAuthoringWithDeployment).deployment;
    expect(deployment).toBeUndefined();
  });

  it('compiles llm provider/model/api_key with env-ref', () => {
    const { deployment, diagnostics } = compileWithDeployment(`
deployment:
    llm:
        provider: "anthropic"
        model: "claude-opus-4-5"
        api_key: "env(ANTHROPIC_API_KEY)"
`);
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    expect(deployment?.llm).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      api_key: { kind: 'env', name: 'ANTHROPIC_API_KEY' },
    });
  });

  it('compiles llm fallback', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    llm:
        provider: "anthropic"
        model: "claude-opus-4-5"
        api_key: "env(ANTHROPIC_API_KEY)"
        fallback:
            provider: "openai"
            model: "gpt-4o-mini"
            api_key: "env(OPENAI_API_KEY)"
`);
    expect(deployment?.llm?.fallback).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      api_key: { kind: 'env', name: 'OPENAI_API_KEY' },
    });
  });

  it('errors on unknown llm provider', () => {
    const { diagnostics } = compileWithDeployment(`
deployment:
    llm:
        provider: "bogus"
        model: "x"
`);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.some(e => e.message.includes('provider'))).toBe(true);
  });

  it('compiles mcp servers as a record', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"
        slack:
            transport: "http"
            url: "env(SLACK_MCP_URL)"
`);
    expect(deployment?.mcp?.github).toEqual({
      transport: 'streamable-http',
      url: 'https://mcp.github.com',
    });
    expect(deployment?.mcp?.slack).toEqual({
      transport: 'http',
      url: { kind: 'env', name: 'SLACK_MCP_URL' },
    });
  });

  it('compiles mcp auth.api_key', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"
            auth:
                strategy: "api_key"
                key: "env(GITHUB_MCP_TOKEN)"
`);
    expect(deployment?.mcp?.github.auth).toEqual({
      strategy: 'api_key',
      key: { kind: 'env', name: 'GITHUB_MCP_TOKEN' },
    });
  });

  it('compiles mcp auth.bearer + headers', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"
            headers:
                "x-trace-id": "agentscript"
                "x-tenant": "env(TENANT_ID)"
            auth:
                strategy: "bearer"
                key: "env(GH_TOKEN)"
`);
    expect(deployment?.mcp?.github.auth).toEqual({
      strategy: 'bearer',
      key: { kind: 'env', name: 'GH_TOKEN' },
    });
    expect(deployment?.mcp?.github.headers).toEqual({
      'x-trace-id': 'agentscript',
      'x-tenant': { kind: 'env', name: 'TENANT_ID' },
    });
  });

  it('compiles mcp auth.none (no key)', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    mcp:
        public:
            transport: "http"
            url: "https://mcp.public.example"
            auth:
                strategy: "none"
`);
    expect(deployment?.mcp?.public.auth).toEqual({ strategy: 'none' });
  });

  it('errors on unknown auth.strategy', () => {
    const { diagnostics } = compileWithDeployment(`
deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"
            auth:
                strategy: "oauth2"
                key: "irrelevant"
`);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(
      errors.some(
        e => e.message.includes('strategy') && e.message.includes('oauth2')
      )
    ).toBe(true);
  });

  it('errors on stdio transport (not yet implemented)', () => {
    const { diagnostics } = compileWithDeployment(`
deployment:
    mcp:
        local:
            transport: "stdio"
            url: "ignored"
`);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(
      errors.some(
        e =>
          e.message.includes('stdio') &&
          e.message.includes('not yet implemented')
      )
    ).toBe(true);
  });

  it('compiles server config', () => {
    const { deployment } = compileWithDeployment(`
deployment:
    server:
        auth_token: "env(API_TOKEN)"
        session_store: "memory"
`);
    expect(deployment?.server).toEqual({
      auth_token: { kind: 'env', name: 'API_TOKEN' },
      session_store: 'memory',
    });
  });

  it('warns when secret-shaped field has a literal value', () => {
    const { diagnostics } = compileWithDeployment(`
deployment:
    llm:
        provider: "anthropic"
        model: "claude-opus-4-5"
        api_key: "sk-not-a-secret"
`);
    const warnings = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Warning
    );
    expect(warnings.some(w => w.message.includes('api_key'))).toBe(true);
  });

  it('errors when mcp:// action target references an undeclared server', () => {
    const source = `config:
    agent_name: "TestBot"

deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"

start_agent test:
    description: "Test"
    actions:
        do_thing:
            description: "Lookup"
            target: "mcp://slack/post_message"
            inputs:
                msg: string
    reasoning:
        instructions: ->
            | hello
`;
    const { diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.some(e => e.message.includes('slack'))).toBe(true);
  });

  it('accepts mcp:// action target when server is declared', () => {
    const source = `config:
    agent_name: "TestBot"

deployment:
    mcp:
        github:
            transport: "streamable-http"
            url: "https://mcp.github.com"

start_agent test:
    description: "Test"
    actions:
        do_thing:
            description: "Action"
            target: "mcp://github/create_issue"
            inputs:
                title: string
    reasoning:
        instructions: ->
            | hello
`;
    const { diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toEqual([]);
  });
});
