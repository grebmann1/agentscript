/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { generateText, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  FnAdapter,
  MockToolAdapter,
  ToolRegistry,
  type ToolAdapter,
} from '@agentscript/runtime';
import {
  compileSource,
  createAgent,
  type AgentScriptAgent,
  type GenerateTextFn,
} from '@agentscript/runtime-vercel';
import type { LlmSettings } from '~/store/llmSettings';
import type { ToolMock } from '~/store/agentStore';

/**
 * Build a default tool registry containing generic-purpose fn:// adapters
 * that satisfy the tools referenced by the built-in example scripts.
 * Handlers are intentionally mocked — no network calls — so the playground
 * runs end-to-end without any real APIs or secrets. Anything not registered
 * surfaces as a tool-error row in the stream, which is informative rather
 * than fatal.
 */
export function buildDefaultTools(): ToolRegistry {
  const fn = new FnAdapter();
  seedDefaultFnHandlers(fn);
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

/** Populate an FnAdapter with the seeded demo handlers. */
function seedDefaultFnHandlers(fn: FnAdapter): void {
  // ---- Generic demo tools ------------------------------------------------
  fn.register('lookup_order', args => {
    const { order_number } = args as { order_number?: string };
    return {
      status:
        order_number === 'ORD-42' || order_number === '42'
          ? 'shipped'
          : 'processing',
      order_id: String(order_number ?? 'unknown'),
    };
  });

  fn.register('verify_customer', args => {
    const { email } = args as { email?: string };
    return {
      verified: Boolean(email && email.includes('@')),
      customer_name: email ? email.split('@')[0] : 'guest',
    };
  });

  fn.register('echo', args => ({ result: args }));

  // ---- Travel Concierge playground example -------------------------------
  fn.register('search_flights', args => {
    const { destination } = args as { destination?: string };
    const seed = hashCode(destination ?? 'somewhere');
    const carriers = ['Acme Air', 'Horizon', 'Orbit', 'Skyline'];
    return {
      flight_number: `${carriers[seed % carriers.length][0]}A-${
        500 + (seed % 500)
      }`,
      price_usd: 180 + (seed % 820),
      carrier: carriers[seed % carriers.length],
    };
  });

  fn.register('search_hotels', args => {
    const { destination, max_price_usd } = args as {
      destination?: string;
      max_price_usd?: number;
    };
    const seed = hashCode(destination ?? 'downtown');
    const names = [
      'The Grand',
      'Harbor View',
      'Lantern Inn',
      'Skyline Suites',
      'The Orchid',
    ];
    const nightly = 90 + (seed % 260);
    const cap =
      typeof max_price_usd === 'number' && max_price_usd > 0
        ? Math.min(nightly, max_price_usd)
        : nightly;
    return {
      hotel_name: `${names[seed % names.length]} ${destination ?? ''}`.trim(),
      nightly_usd: cap,
      rating: 3.5 + (seed % 15) / 10,
    };
  });

  fn.register('get_weather', args => {
    const { city } = args as { city?: string };
    const seed = hashCode(city ?? 'anywhere');
    const summaries = [
      'Sunny with light clouds',
      'Overcast and mild',
      'Scattered showers',
      'Clear and breezy',
      'Hot and humid',
      'Crisp and cool',
    ];
    return {
      summary: `${summaries[seed % summaries.length]} in ${city ?? 'the area'}`,
      temp_c: 8 + (seed % 24),
    };
  });

  fn.register('confirm_booking', args => {
    const { flight_number, hotel_name } = args as {
      flight_number?: string;
      hotel_name?: string;
    };
    const seed = hashCode(`${flight_number}-${hotel_name}`);
    return {
      confirmation_code: `BK-${seed.toString(36).toUpperCase().slice(-6)}`,
      total_usd: 500 + (seed % 2500),
    };
  });
}

function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export interface BuildAgentResult {
  agent: AgentScriptAgent;
  /** Diagnostics from compile — non-fatal warnings included. */
  diagnostics: Array<{ severity: number; message: string; code?: string }>;
  /** Which user-supplied mocks had invalid JSON and were skipped. */
  invalidMocks: Array<{ id: string; target: string; error: string }>;
}

/**
 * Wrap a scheme-keyed ToolRegistry so every scheme's adapter is preceded by
 * a MockToolAdapter consulting the given exact-target → response map. Unmocked
 * targets fall through to the original adapter (or a new FnAdapter stub for
 * schemes that didn't have one).
 */
export function buildToolsFromMocks(
  mocks: ToolMock[],
  base: ToolRegistry = buildDefaultTools()
): { tools: ToolRegistry; invalidMocks: BuildAgentResult['invalidMocks'] } {
  const invalidMocks: BuildAgentResult['invalidMocks'] = [];
  const parsed = new Map<string, Record<string, unknown>>();
  const schemes = new Set<string>();

  for (const mock of mocks) {
    if (!mock.enabled) continue;
    if (!mock.target.includes('://')) {
      invalidMocks.push({
        id: mock.id,
        target: mock.target,
        error: 'target must be a full URI like "fn://name"',
      });
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(mock.responseJson);
    } catch (err) {
      invalidMocks.push({
        id: mock.id,
        target: mock.target,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      invalidMocks.push({
        id: mock.id,
        target: mock.target,
        error: 'response must be a JSON object (e.g. {"status":"ok"})',
      });
      continue;
    }
    parsed.set(mock.target, value as Record<string, unknown>);
    schemes.add(mock.target.slice(0, mock.target.indexOf('://')));
  }

  if (parsed.size === 0) {
    return { tools: base, invalidMocks };
  }

  // Read back the adapters we need from the base registry by probing it.
  // The registry doesn't expose a getter, so we keep a parallel map while we
  // build — callers always go through buildDefaultTools() which we re-create
  // here to access its adapters.
  const wrapped = new ToolRegistry();
  const defaults = buildDefaultAdapters();

  // Copy over every scheme currently in the base registry. We can't enumerate
  // it, so instead we re-register both (a) the defaults, (b) a mock adapter
  // per scheme that mocks reference.
  for (const [scheme, adapter] of defaults) {
    const mockForScheme = new MockToolAdapter(
      scopeMocks(parsed, scheme),
      adapter
    );
    wrapped.register(scheme, mockForScheme);
  }

  // Schemes referenced by mocks but missing from defaults: register with no
  // fallback (the user wants only mocked targets for that scheme to work).
  for (const scheme of schemes) {
    if (defaults.has(scheme)) continue;
    wrapped.register(scheme, new MockToolAdapter(scopeMocks(parsed, scheme)));
  }

  // Intentionally ignore `base` on this path: we've rebuilt defaults ourselves
  // so the wrapped registry is self-consistent. If a caller ever needs to pass
  // a custom base, we can thread its adapters through instead.
  void base;

  return { tools: wrapped, invalidMocks };
}

/** Subset of the parsed mock map scoped to a single URI scheme. */
function scopeMocks(
  parsed: Map<string, Record<string, unknown>>,
  scheme: string
): Map<string, Record<string, unknown>> {
  const prefix = `${scheme}://`;
  const out = new Map<string, Record<string, unknown>>();
  for (const [target, value] of parsed) {
    if (target.startsWith(prefix)) out.set(target, value);
  }
  return out;
}

/**
 * Canonical list of (scheme, adapter) pairs that buildDefaultTools provides.
 * Kept as an array so buildToolsFromMocks can inspect it; buildDefaultTools
 * remains the only exposed factory for backwards compatibility.
 */
function buildDefaultAdapters(): Map<string, ToolAdapter> {
  const adapters = new Map<string, ToolAdapter>();
  // buildDefaultTools builds a single FnAdapter registered under "fn".
  // Recreating that here means the wrapped registry shares semantics.
  const fn = new FnAdapter();
  seedDefaultFnHandlers(fn);
  adapters.set('fn', fn);
  return adapters;
}

/**
 * Compile an .agent source and wire it to an OpenAI-compatible endpoint.
 * Returns the ready-to-stream AgentScriptAgent plus any compile diagnostics.
 * Throws if compile emits hard errors (severity=1 with unrecognized code) or
 * if the settings aren't configured.
 */
export function buildAgent(
  agentSource: string,
  settings: LlmSettings,
  mocks: ToolMock[] = []
): BuildAgentResult {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error(
      'LLM endpoint not configured. Open Settings → LLM Endpoint.'
    );
  }

  const { output, diagnostics } = compileSource(agentSource);

  // Filter out the "invalid-action-target" lint that fires for non-Salesforce
  // schemes (fn://, http://). The runtime accepts any registered scheme.
  const hardErrors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (hardErrors.length > 0) {
    throw new Error(
      'Agent script has errors:\n' +
        hardErrors.map(d => `  • ${d.message}`).join('\n')
    );
  }

  const { tools, invalidMocks } = buildToolsFromMocks(mocks);

  const openai = createOpenAI({
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
  });

  const agent = createAgent({
    doc: output,
    llm: {
      model: openai.chat(settings.model),
      generateText: generateText as unknown as GenerateTextFn,
      // Wrap our raw JSON Schema tool definitions into the FlexibleSchema
      // shape AI SDK v5 expects on `inputSchema`. Without this, the SDK
      // silently drops every tool and the model can't call any of them.
      jsonSchema: jsonSchema as unknown as (
        schema: Record<string, unknown>
      ) => unknown,
    },
    tools,
  });

  return { agent, diagnostics, invalidMocks };
}
