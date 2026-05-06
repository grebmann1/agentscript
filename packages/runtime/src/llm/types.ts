/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export type MsgRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolCallMsg {
  role: 'assistant';
  content: '';
  tool_calls: ToolCall[];
}

export interface ToolResultMsg {
  role: 'tool';
  tool_call_id: string;
  /** Name of the tool this result belongs to. Required by AI SDK v5. */
  tool_name: string;
  content: string;
}

export type Msg = TextMsg | ToolCallMsg | ToolResultMsg;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description?: string;
  /** JSON-Schema for the tool's input. The driver is responsible for adapting to the SDK. */
  inputSchema: Record<string, unknown>;
}

export type StepEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-call'; call: ToolCall }
  | { kind: 'finish'; reason: 'stop' | 'tool-calls' | 'length' | 'other' };

export interface LlmStepInput {
  system: string;
  messages: Msg[];
  tools: ToolDef[];
}

export interface LlmDriver {
  step(input: LlmStepInput): AsyncIterable<StepEvent>;
}
