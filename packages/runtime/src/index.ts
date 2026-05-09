/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export { Runtime } from './turn/runtime.js';
export type {
  RuntimeOptions,
  TurnOptions,
  TurnResult,
  ToolUsageLimit,
} from './turn/runtime.js';

export { AbortError } from './errors.js';

export { StateStore } from './state/store.js';
export type { StateVarSpec } from './state/store.js';

export { EventBus } from './events/types.js';
export type { RuntimeEvent, EventListener } from './events/types.js';

export { ToolRegistry, STATE_UPDATE_TARGET } from './tools/registry.js';
export type { ToolAdapter, ToolAdapterInvocation } from './tools/registry.js';
export { FnAdapter } from './tools/fn-adapter.js';
export type { FnHandler } from './tools/fn-adapter.js';
export { HttpAdapter } from './tools/http-adapter.js';
export type { HttpAdapterOptions } from './tools/http-adapter.js';
export { MockToolAdapter } from './tools/mock-adapter.js';

export { loadGraph } from './graph/load.js';
export type { LoadedGraph } from './graph/load.js';

export { evalExpr, compileExpr } from './expr/eval.js';
export type { EvalScope } from './expr/eval.js';
export { renderTemplate, isTemplate } from './template/render.js';

export type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  Msg,
  TextMsg,
  ToolCallMsg,
  ToolResultMsg,
  ToolCall,
  ToolDef,
} from './llm/types.js';

export { MiddlewarePipeline } from './middleware/pipeline.js';
export type {
  Middleware,
  BeforeTurnContext,
  BeforeTurnResult,
  AfterTurnContext,
  AfterTurnResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeLlmStepContext,
  BeforeLlmStepResult,
  AfterLlmStepContext,
  AfterLlmStepResult,
  OnErrorContext,
  OnErrorResult,
} from './middleware/types.js';

export { CHECKPOINT_SCHEMA_VERSION } from './checkpoint/types.js';
export type { Checkpoint, CheckpointStore } from './checkpoint/types.js';
export { MemoryCheckpointStore } from './checkpoint/memory-store.js';
export {
  CheckpointVersionError,
  CheckpointIncompatibleError,
} from './checkpoint/errors.js';

export { GuardrailExhaustionError } from './guardrails/types.js';
export type {
  Guardrail,
  GuardrailInput,
  GuardrailContext,
  GuardrailResult,
  GuardrailError,
  GuardrailTarget,
  ExhaustionPolicy,
} from './guardrails/types.js';
export {
  jsonSchemaGuardrail,
  regexGuardrail,
  contentPolicyGuardrail,
  customGuardrail,
  composeGuardrails,
} from './guardrails/validators.js';

export { TracingContext } from './tracing/context.js';
export { generateTraceId, generateSpanId } from './tracing/ids.js';
export type {
  Span,
  SpanExporter,
  SpanStatus,
  SpanEvent,
} from './tracing/types.js';
export { MultiSpanExporter } from './tracing/types.js';
export { InMemorySpanExporter } from './tracing/exporters/memory.js';
export { ConsoleSpanExporter } from './tracing/exporters/console.js';
export {
  OtlpJsonSpanExporter,
  type OtlpJsonSpanExporterOptions,
} from './tracing/exporters/otlp-json.js';
export type { TracingOptions } from './turn/runtime.js';

export type {
  DelegationOptions,
  DelegationFrame,
  DelegationResult,
} from './delegation/types.js';
export {
  DelegationTimeoutError,
  DelegationDepthError,
} from './delegation/errors.js';
