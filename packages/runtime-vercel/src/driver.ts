/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  Msg,
  ToolDef,
} from '@agentscript/runtime';

/**
 * Minimal structural shapes for the Vercel AI SDK. We import them as types
 * only so the runtime-vercel package doesn't hard-depend on a specific major
 * version of `ai` — users bring their own.
 */
export interface AiSdkModelLike {
  specificationVersion?: unknown;
  modelId?: string;
  provider?: string;
}

export interface VercelDriverOptions {
  /** A LanguageModel instance from `ai` (e.g. `anthropic("claude-4-5")`). */
  model: AiSdkModelLike;
  /**
   * `generateText` from `ai`. Injected to avoid a hard import so this package
   * compiles without `ai` installed.
   */
  generateText: GenerateTextFn;
  /**
   * `jsonSchema` from `@ai-sdk/provider-utils` (re-exported by `ai`). Injected
   * for the same reason. Used to wrap our internal JSON-Schema-shaped tool
   * definitions into a `FlexibleSchema` the AI SDK's `tool({ inputSchema })`
   * accepts. If omitted, we pass the raw schema through — which works on
   * some builds of `ai` but fails on others.
   */
  jsonSchema?: (schema: Record<string, unknown>) => unknown;
  /** Additional options forwarded verbatim (temperature, maxTokens, etc.). */
  providerOptions?: Record<string, unknown>;
}

export type GenerateTextFn = (opts: {
  model: AiSdkModelLike;
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Record<string, unknown>;
  [key: string]: unknown;
}) => Promise<{
  text: string;
  /**
   * Tool calls on v5+: `{ toolCallId, toolName, input }`.
   * Some older v4 builds used `args` instead of `input`; we handle both.
   */
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
    args?: unknown;
  }>;
  finishReason?: string;
}>;

/**
 * Turns AgentScript runtime LLM requests into Vercel AI SDK `generateText`
 * calls. The runtime treats the LLM as a single, non-streaming step — tool
 * execution is owned by the runtime, not the SDK, so we configure the SDK
 * with tool *definitions* (no `execute`) and feed returned tool calls back
 * to the runtime.
 */
export class VercelAiSdkDriver implements LlmDriver {
  constructor(private readonly opts: VercelDriverOptions) {}

  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    const res = await this.opts.generateText({
      model: this.opts.model,
      system: input.system,
      messages: input.messages.map(toAiSdkMessage),
      tools: buildToolsObject(input.tools, this.opts.jsonSchema),
      ...(input.signal ? { abortSignal: input.signal } : {}),
      ...(this.opts.providerOptions ?? {}),
    });

    if (res.text) yield { kind: 'text-delta', text: res.text };
    for (const call of res.toolCalls ?? []) {
      const rawInput = call.input !== undefined ? call.input : call.args;
      yield {
        kind: 'tool-call',
        call: {
          id: call.toolCallId,
          name: call.toolName,
          arguments: coerceArgs(rawInput),
        },
      };
    }
    yield {
      kind: 'finish',
      reason: mapFinishReason(res.finishReason),
    };
  }
}

function coerceArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty
    }
  }
  return {};
}

function toAiSdkMessage(m: Msg): { role: string; content: unknown } {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: m.tool_call_id,
          toolName: m.tool_name,
          // v5's LanguageModelV2ToolResultOutput is a tagged union. All
          // providers we care about accept { type: "json", value: ... }.
          output: {
            type: 'json',
            value: safeParseJson(m.content),
          },
        },
      ],
    };
  }
  if (m.role === 'assistant') {
    if ('tool_calls' in m && m.tool_calls.length > 0) {
      // v5 assistant with tool calls: content is an array of tool-call parts.
      // Our Msg shape forces content to "" in this variant, so no text part.
      const parts: Array<Record<string, unknown>> = m.tool_calls.map(call => ({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.arguments,
      }));
      return { role: 'assistant', content: parts };
    }
    return { role: 'assistant', content: m.content };
  }
  return { role: m.role, content: m.content };
}

function buildToolsObject(
  tools: ToolDef[],
  jsonSchemaFn?: (s: Record<string, unknown>) => unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of tools) {
    out[t.name] = {
      description: t.description,
      // v5: field is `inputSchema` and value must be a FlexibleSchema.
      // Wrap our raw JSON Schema in `jsonSchema()` when available so the
      // SDK can validate model output against it.
      inputSchema: jsonSchemaFn ? jsonSchemaFn(t.inputSchema) : t.inputSchema,
    };
  }
  return out;
}

function mapFinishReason(
  r: string | undefined
): StepEvent extends { kind: 'finish'; reason: infer R } ? R : never {
  switch (r) {
    case 'stop':
      return 'stop' as never;
    case 'tool-calls':
      return 'tool-calls' as never;
    case 'length':
      return 'length' as never;
    default:
      return 'other' as never;
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
