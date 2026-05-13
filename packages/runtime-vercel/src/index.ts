/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// High-level, Vercel-idiomatic API. Start here.
export { createAgent, AgentScriptAgent } from './agent.js';
export type {
  CreateAgentOptions,
  AgentRunOptions,
  AgentRunResult,
  AgentStepInfo,
  AgentStream,
  AgentStreamPart,
} from './agent.js';

// Low-level driver — exposed for users who want to plug directly into
// `@agentscript/runtime` without going through `createAgent`.
export { VercelAiSdkDriver } from './driver.js';
export type {
  VercelDriverOptions,
  AiSdkModelLike,
  GenerateTextFn,
} from './driver.js';

/**
 * Re-export the compile pipeline so consumers of this package don't need to
 * separately depend on @agentscript/agentforce. We intentionally narrow the
 * surface to just the entry point most adapter users need.
 *
 * **Dialect note:** `compileSource` uses the Agentforce dialect exclusively.
 * This is intentional — the majority of runtime-vercel consumers target
 * Agentforce agents. If you need a different dialect (e.g.
 * `@agentscript/agentscript-dialect` or `@agentscript/agentfabric-dialect`),
 * compile your source separately using `@agentscript/compiler`'s `compile()`
 * and pass the resulting `AgentDSLAuthoring` directly to `createAgent({ doc })`.
 * The runtime is dialect-agnostic — only the compile step is dialect-specific.
 */
export { compileSource } from '@agentscript/agentforce';
export type { AgentforceCompileResult } from '@agentscript/agentforce';
