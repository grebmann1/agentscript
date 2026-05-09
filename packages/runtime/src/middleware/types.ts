/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg, ToolCall, ToolDef } from '../llm/types.js';
import type { RuntimeEvent } from '../events/types.js';
import type { Guardrail } from '../guardrails/types.js';

export interface Middleware {
  name: string;
  priority?: number;
  failOpen?: boolean;
  beforeTurn?(
    ctx: BeforeTurnContext
  ): Promise<BeforeTurnResult | void> | BeforeTurnResult | void;
  afterTurn?(
    ctx: AfterTurnContext
  ): Promise<AfterTurnResult | void> | AfterTurnResult | void;
  beforeToolCall?(
    ctx: BeforeToolCallContext
  ): Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
  afterToolCall?(
    ctx: AfterToolCallContext
  ): Promise<AfterToolCallResult | void> | AfterToolCallResult | void;
  beforeLlmStep?(
    ctx: BeforeLlmStepContext
  ): Promise<BeforeLlmStepResult | void> | BeforeLlmStepResult | void;
  afterLlmStep?(
    ctx: AfterLlmStepContext
  ): Promise<AfterLlmStepResult | void> | AfterLlmStepResult | void;
  onError?(
    ctx: OnErrorContext
  ): Promise<OnErrorResult | void> | OnErrorResult | void;
}

export interface BeforeTurnContext {
  userInput: string;
  node: string;
  state: Readonly<Record<string, unknown>>;
}

export interface BeforeTurnResult {
  userInput?: string;
  abort?: { assistantText: string };
}

export interface AfterTurnContext {
  assistantText: string;
  finalNode: string;
  state: Readonly<Record<string, unknown>>;
  events: readonly RuntimeEvent[];
}

export interface AfterTurnResult {
  assistantText?: string;
}

export interface BeforeToolCallContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  target: string;
  toolName: string;
  args: Record<string, unknown>;
  toolCall: Readonly<ToolCall>;
}

export interface BeforeToolCallResult {
  args?: Record<string, unknown>;
  abort?: { result: Record<string, unknown> };
  skip?: boolean;
}

export interface AfterToolCallContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  target: string;
  toolName: string;
  args: Readonly<Record<string, unknown>>;
  result: Record<string, unknown>;
  error?: unknown;
}

export interface AfterToolCallResult {
  result?: Record<string, unknown>;
}

export interface BeforeLlmStepContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  system: string;
  messages: readonly Msg[];
  tools: readonly ToolDef[];
}

export interface BeforeLlmStepResult {
  system?: string;
  appendMessages?: Msg[];
  tools?: ToolDef[];
  guardrails?: Guardrail[];
}

export interface AfterLlmStepContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  text: string;
  toolCalls: readonly ToolCall[];
}

export interface AfterLlmStepResult {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface OnErrorContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  error: unknown;
  phase: 'tool-call' | 'llm-step' | 'turn';
  toolName?: string;
  target?: string;
}

export interface OnErrorResult {
  suppress?: boolean;
  fallbackResult?: Record<string, unknown>;
}
