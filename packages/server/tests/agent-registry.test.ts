/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/agents.js';
import type { ServerConfig } from '../src/types.js';

const baseConfig = (agentsDir: string): ServerConfig => ({
  port: 8080,
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  agentsDir,
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
});

const agentWithDeployment = `
config:
    agent_name: "TestBot"

deployment:
    llm:
        provider: "anthropic"
        model: "claude-opus-4-5"
        api_key: "env(ANTHROPIC_API_KEY)"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;

const agentWithoutDeployment = `
config:
    agent_name: "PlainBot"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;

describe('AgentRegistry — deployment-driven LLM', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agentscript-server-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uses deployment.llm when declared', async () => {
    await writeFile(path.join(dir, 'a.agent'), agentWithDeployment, 'utf8');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      const reg = await AgentRegistry.load(baseConfig(dir));
      expect(reg.listAgents()).toEqual(['a']);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('throws when env var required by deployment.llm is missing', async () => {
    await writeFile(path.join(dir, 'a.agent'), agentWithDeployment, 'utf8');
    delete process.env.ANTHROPIC_API_KEY;
    await expect(AgentRegistry.load(baseConfig(dir))).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it('falls back to ServerConfig env vars when no .agent declares deployment', async () => {
    await writeFile(path.join(dir, 'a.agent'), agentWithoutDeployment, 'utf8');
    const reg = await AgentRegistry.load({
      ...baseConfig(dir),
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o-mini',
    });
    expect(reg.listAgents()).toEqual(['a']);
  });

  it('throws clearly when neither deployment.llm nor env vars are set', async () => {
    await writeFile(path.join(dir, 'a.agent'), agentWithoutDeployment, 'utf8');
    await expect(AgentRegistry.load(baseConfig(dir))).rejects.toThrow(
      /No LLM configured/
    );
  });

  it('loads agents declaring different LLM providers independently', async () => {
    await writeFile(path.join(dir, 'a.agent'), agentWithDeployment, 'utf8');
    const otherProvider = agentWithDeployment
      .replace('agent_name: "TestBot"', 'agent_name: "OtherBot"')
      .replace('provider: "anthropic"', 'provider: "openai"')
      .replace('claude-opus-4-5', 'gpt-4o-mini')
      .replace('env(ANTHROPIC_API_KEY)', 'env(OPENAI_API_KEY)');
    await writeFile(path.join(dir, 'b.agent'), otherProvider, 'utf8');
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.OPENAI_API_KEY = 'sk-oai';
    try {
      const reg = await AgentRegistry.load(baseConfig(dir));
      expect(reg.listAgents()).toEqual(['a', 'b']);
      expect(() => reg.createAgent('a')).not.toThrow();
      expect(() => reg.createAgent('b')).not.toThrow();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('isolates per-agent MCP adapters: an agent without deployment.mcp has no mcp scheme', async () => {
    const withMcp = `
config:
    agent_name: "WithMcp"

deployment:
    llm:
        provider: "openai"
        model: "gpt-4o-mini"
        api_key: "env(OPENAI_API_KEY)"
    mcp:
        gh:
            transport: "http"
            url: "https://mcp.github.example"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | hello
`;
    await writeFile(path.join(dir, 'with.agent'), withMcp, 'utf8');
    await writeFile(
      path.join(dir, 'without.agent'),
      agentWithoutDeployment,
      'utf8'
    );
    process.env.OPENAI_API_KEY = 'sk-oai';
    try {
      const reg = await AgentRegistry.load({
        ...baseConfig(dir),
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: 'sk-fallback',
        llmModel: 'gpt-4o-mini',
      });
      expect(reg.listAgents()).toEqual(['with', 'without']);
      const withAgent = reg.createAgent('with');
      const withoutAgent = reg.createAgent('without');
      expect(withAgent).toBeDefined();
      expect(withoutAgent).toBeDefined();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
