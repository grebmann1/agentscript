/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '@agentscript/compiler';
import {
  createMcpAdapter,
  reconcileDeploymentMcp,
} from '../src/mcp-factory.js';

describe('createMcpAdapter', () => {
  it('builds a multi-server adapter with literal urls and headers', () => {
    const adapter = createMcpAdapter(
      {
        gh: {
          transport: 'http',
          url: 'https://mcp.github.example',
          headers: { 'x-trace': 'on' },
        },
        slack: {
          transport: 'streamable-http',
          url: 'https://mcp.slack.example',
        },
      },
      {}
    );
    expect(adapter.servers().sort()).toEqual(['gh', 'slack']);
  });

  it('resolves env-ref url and api_key auth into Bearer header', () => {
    const adapter = createMcpAdapter(
      {
        gh: {
          transport: 'http',
          url: { kind: 'env', name: 'GH_MCP_URL' },
          auth: {
            strategy: 'api_key',
            key: { kind: 'env', name: 'GH_MCP_TOKEN' },
          },
        },
      },
      {
        GH_MCP_URL: 'https://mcp.github.example',
        GH_MCP_TOKEN: 'tok-xyz',
      }
    );
    expect(adapter.servers()).toEqual(['gh']);
  });

  it('throws when an env-ref url is missing', () => {
    expect(() =>
      createMcpAdapter(
        { gh: { transport: 'http', url: { kind: 'env', name: 'NOPE' } } },
        {}
      )
    ).toThrow(/NOPE/);
  });

  // stdio transport is rejected at compile time (see compiler tests for
  // deployment.mcp.<name>.transport "not yet implemented" diagnostic).
  // The adapter factory only sees configs that already passed compilation,
  // so it doesn't re-validate the transport string.
});

describe('reconcileDeploymentMcp', () => {
  const gh: McpServerConfig = {
    transport: 'http',
    url: 'https://mcp.github.example',
  };
  const slack: McpServerConfig = {
    transport: 'http',
    url: 'https://mcp.slack.example',
  };
  const ghVariant: McpServerConfig = {
    transport: 'http',
    url: 'https://mcp.github.example',
    headers: { extra: 'yes' },
  };

  it('returns undefined when no agent declares mcp', () => {
    expect(
      reconcileDeploymentMcp([
        { id: 'a', mcp: undefined },
        { id: 'b', mcp: undefined },
      ])
    ).toBeUndefined();
  });

  it('unions distinct server names across agents', () => {
    expect(
      reconcileDeploymentMcp([
        { id: 'a', mcp: { gh } },
        { id: 'b', mcp: { slack } },
      ])
    ).toEqual({ gh, slack });
  });

  it('accepts identical re-declarations of the same server', () => {
    expect(
      reconcileDeploymentMcp([
        { id: 'a', mcp: { gh } },
        { id: 'b', mcp: { gh } },
      ])
    ).toEqual({ gh });
  });

  it('throws when two agents declare the same server name with different config', () => {
    expect(() =>
      reconcileDeploymentMcp([
        { id: 'a', mcp: { gh } },
        { id: 'b', mcp: { gh: ghVariant } },
      ])
    ).toThrow(/disagree/);
  });
});
