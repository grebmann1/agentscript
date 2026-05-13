/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDSLAuthoring, SubAgentNode } from '@agentscript/compiler';
import { loadGraph, type LoadedGraph } from '../graph/load.js';
import { StateStore } from '../state/store.js';
import {
  EventBus,
  type EventListener,
  type RuntimeEvent,
} from '../events/types.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  runSteps,
  makeScope,
  evalBoundValue,
  isEnabled,
  type Step,
} from '../steps/run-steps.js';
import { renderTemplate } from '../template/render.js';
import type {
  LlmDriver,
  LlmStepInput,
  Msg,
  ToolCall,
  ToolDef,
} from '../llm/types.js';
import { AbortError } from '../errors.js';
import { MiddlewarePipeline } from '../middleware/pipeline.js';
import type { Middleware } from '../middleware/types.js';
import {
  CHECKPOINT_SCHEMA_VERSION,
  type Checkpoint,
} from '../checkpoint/types.js';
import { CheckpointVersionError } from '../checkpoint/errors.js';
import { TracingContext } from '../tracing/context.js';
import type { SpanExporter } from '../tracing/types.js';
import type { Guardrail, ExhaustionPolicy } from '../guardrails/types.js';
import { GuardrailExhaustionError } from '../guardrails/types.js';
import { jsonSchemaGuardrail } from '../guardrails/validators.js';
import type {
  DelegationOptions,
  DelegationFrame,
  DelegationResult,
} from '../delegation/types.js';
import {
  DelegationTimeoutError,
  DelegationDepthError,
  StateConflictError,
} from '../delegation/errors.js';
import type { ParallelDelegationOptions } from '../parallel/types.js';
import type {
  StructuredOutputOptions,
  ParsedStructuredOutput,
} from '../structured-output/types.js';
import {
  buildResponseFormat,
  parseStructuredOutput,
} from '../structured-output/enforce.js';
import type { ParallelDispatchOptions } from '../parallel/types.js';

export interface ToolUsageLimit {
  /** Maximum number of times this tool may be invoked per scope. */
  maxCalls: number;
  /** If true, counter resets at the start of each turn(). Default: false (per-session). */
  resetPerTurn?: boolean;
}

export interface TracingOptions {
  /** Enable tracing instrumentation. Default: false. */
  enabled: boolean;
  /** Span exporter to receive completed spans. */
  exporter?: SpanExporter;
  /** Sample rate between 0 and 1. 0 = never trace, 1 = always trace. Default: 1. */
  sampleRate?: number;
}

export interface RuntimeOptions {
  doc: AgentDSLAuthoring;
  llm: LlmDriver;
  tools: ToolRegistry;
  /** Seed values for linked (Context) variables. */
  context?: Record<string, unknown>;
  /** Guard against infinite tool-call/handoff loops. */
  maxStepsPerTurn?: number;
  /** Default abort signal applied to every turn unless overridden. */
  signal?: AbortSignal;
  /** Per-tool invocation budgets, keyed by tool name (as exposed to the LLM). */
  toolLimits?: Record<string, ToolUsageLimit>;
  /** Middleware stack. Applied in priority order. */
  middleware?: Middleware[];
  /** Guardrails to validate LLM output before acting on it. */
  guardrails?: Guardrail[];
  /** What to do when guardrail retries are exhausted. Default: 'throw'. */
  exhaustionPolicy?: ExhaustionPolicy;
  /** Tracing / observability configuration. */
  tracing?: TracingOptions;
  /** Default options for delegations. */
  delegation?: DelegationOptions;
  /** Structured output enforcement configuration. */
  structuredOutput?: StructuredOutputOptions;
  /** Parallel tool dispatch configuration. */
  parallel?: ParallelDispatchOptions;
}

export interface TurnOptions {
  /** Abort signal for this specific turn. Overrides the runtime-level signal. */
  signal?: AbortSignal;
}

export interface TurnResult {
  /** Accumulated assistant text for this turn. */
  assistantText: string;
  /** The node the agent ended the turn on. */
  finalNode: string;
  /** All events emitted during the turn (also streamed via `on`). */
  events: RuntimeEvent[];
  /** Parsed structured output (populated when structuredOutput is configured). */
  parsed?: ParsedStructuredOutput;
}

export class Runtime {
  readonly graph: LoadedGraph;
  readonly state: StateStore;
  readonly bus = new EventBus();
  private readonly history: Msg[] = [];
  private currentNode: string;
  private readonly maxSteps: number;
  private readonly toolCallCounts = new Map<string, number>();
  private readonly pipeline: MiddlewarePipeline;
  private _inTurn = false;
  private _tracingCtx: TracingContext | null = null;
  private delegationStack: DelegationFrame[] = [];

  constructor(private readonly opts: RuntimeOptions) {
    this.graph = loadGraph(opts.doc);
    this.state = new StateStore(
      this.graph.stateVars,
      opts.context ?? {},
      this.bus
    );
    this.currentNode = this.graph.initialNode;
    this.maxSteps = opts.maxStepsPerTurn ?? 8;
    this.pipeline = new MiddlewarePipeline(opts.middleware);
  }

  /** Whether tracing is active for this turn. */
  private shouldTrace(): boolean {
    const t = this.opts.tracing;
    if (!t || !t.enabled) return false;
    const rate = t.sampleRate ?? 1;
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  private traceStart(name: string, attributes?: Record<string, unknown>): void {
    if (!this._tracingCtx) return;
    const span = this._tracingCtx.startSpan(name, attributes);
    this.bus.emit({
      kind: 'span-start',
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      parentSpanId: span.parentSpanId,
    });
  }

  private traceEnd(status?: 'ok' | 'error' | 'unset'): void {
    if (!this._tracingCtx) return;
    const span = this._tracingCtx.endSpan(status);
    if (span) {
      this.bus.emit({
        kind: 'span-end',
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        status: span.status,
      });
    }
  }

  on(listener: EventListener): () => void {
    return this.bus.on(listener);
  }

  get currentNodeName(): string {
    return this.currentNode;
  }

  get delegationDepth(): number {
    return this.delegationStack.length;
  }

  /** Reset usage counters. Pass a tool name to reset one, or omit to reset all. */
  resetToolUsage(toolName?: string): void {
    if (toolName) {
      this.toolCallCounts.delete(toolName);
    } else {
      this.toolCallCounts.clear();
    }
  }

  /**
   * Resolve the effective signal for a turn — per-turn takes precedence over
   * runtime-level, returning `undefined` when neither is set.
   */
  private resolveSignal(turnSignal?: AbortSignal): AbortSignal | undefined {
    return turnSignal ?? this.opts.signal;
  }

  /** Throw an AbortError if the signal is already aborted. */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new AbortError(signal.reason);
    }
  }

  /** Drive one user turn through the ReAct loop. */
  async turn(userInput: string, options?: TurnOptions): Promise<TurnResult> {
    const signal = this.resolveSignal(options?.signal);
    const collected: RuntimeEvent[] = [];
    const off = this.bus.on(e => collected.push(e));

    // Reset per-turn tool counters
    if (this.opts.toolLimits) {
      for (const [name, limit] of Object.entries(this.opts.toolLimits)) {
        if (limit.resetPerTurn) this.toolCallCounts.delete(name);
      }
    }

    try {
      this._inTurn = true;

      // Initialize tracing context for this turn if sampling says yes.
      if (this.shouldTrace()) {
        this._tracingCtx = new TracingContext({
          exporter: this.opts.tracing?.exporter,
        });
      } else {
        this._tracingCtx = null;
      }

      // CP-1: Check abort before committing to the turn.
      this.throwIfAborted(signal);

      // Root "turn" span
      this.traceStart('turn');

      this.history.push({ role: 'user', content: userInput });

      if (!this.pipeline.isEmpty) {
        const beforeResult = await this.pipeline.runBeforeTurn({
          userInput,
          node: this.currentNode,
          state: this.state.snapshot(),
        });
        if (beforeResult?.abort) {
          this.bus.emit({ kind: 'turn-start', node: this.currentNode });
          this.bus.emit({ kind: 'turn-end', node: this.currentNode });
          return {
            assistantText: beforeResult.abort.assistantText,
            finalNode: this.currentNode,
            events: collected,
          };
        }
        if (beforeResult?.userInput !== undefined) {
          userInput = beforeResult.userInput;
          this.history[this.history.length - 1] = {
            role: 'user',
            content: userInput,
          };
        }
      }

      this.bus.emit({ kind: 'turn-start', node: this.currentNode });

      let assistantText = '';
      let steps = 0;

      // Outer loop: one iteration per node-entry. A handoff (from
      // before_reasoning, after_all_tool_calls, after_reasoning, or an
      // after_reasoning transition) swaps `currentNode` and continues.
      outer: while (true) {
        // CP-2: Check abort at top of outer loop.
        this.throwIfAborted(signal);
        const node = this.requireNode(this.currentNode);
        this.traceStart('node', { 'node.name': node.developer_name });
        this.bus.emit({ kind: 'node-enter', node: node.developer_name });

        // Per-node resolution of tools + action refs (compiled IR stores tool
        // targets as action developer_names; the full `scheme://name` URI lives
        // on the matching action_definition). Hook steps and tool-slot bindings
        // both route through this resolver.
        const actionUris = buildActionUriMap(node);
        const nodeTools = this.buildToolDefs(node, actionUris);
        const resolveTarget = (ref: string): string => {
          if (ref.includes('://') || ref === '__state_update_action__')
            return ref;
          return actionUris.get(ref) ?? ref;
        };
        const baseStepOpts = {
          state: this.state,
          tools: this.opts.tools,
          bus: this.bus,
          resolveTarget,
        };

        // 1. before_reasoning (runs once per node entry)
        const preSteps = node.before_reasoning as Step[] | null;
        if (preSteps && preSteps.length > 0) {
          this.traceStart('phase:before_reasoning', {
            'node.name': node.developer_name,
          });
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'before_reasoning',
          });
        }
        const preOutcome = await runSteps(preSteps, baseStepOpts);
        if (preSteps && preSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'before_reasoning',
          });
          this.traceEnd('ok');
        }
        if (preOutcome.handoffTo) {
          this.traceEnd('ok'); // end node span
          this.currentNode = preOutcome.handoffTo;
          if (++steps > this.maxSteps) break;
          continue;
        }

        // 2. Reasoning loop: LLM step -> (tool calls? dispatch then loop)
        //                              -> (no tool calls? done, run after_*)
        let loopHandoff: string | undefined;
        reasoning: while (true) {
          // CP-3: Check abort at top of reasoning loop.
          this.throwIfAborted(signal);

          // before_reasoning_iteration — runs at the top of each LLM iteration
          const iterSteps = node.before_reasoning_iteration as Step[] | null;
          if (iterSteps && iterSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-start',
              node: node.developer_name,
              phase: 'before_reasoning_iteration',
            });
          }
          await runSteps(iterSteps, baseStepOpts);
          if (iterSteps && iterSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-end',
              node: node.developer_name,
              phase: 'before_reasoning_iteration',
            });
          }

          const system = this.buildSystemPrompt(node);
          // Filter tools by their `enabled` guard (the compiler's
          // `available when` clause). This is what prevents the LLM from
          // seeing, e.g., a transition whose preconditions aren't met yet.
          const enableScope = makeScope(this.state);
          const visibleTools = nodeTools
            .filter(t => isEnabled(t.enabled, enableScope))
            .filter(t => {
              if (!this.opts.toolLimits) return true;
              const limit = this.opts.toolLimits[t.name];
              if (!limit) return true;
              return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
            });
          for (const skipped of nodeTools) {
            if (!isEnabled(skipped.enabled, enableScope)) {
              this.bus.emit({
                kind: 'action-skipped',
                name: skipped.name,
                reason: `available-when guard failed: ${String(skipped.enabled)}`,
              });
            }
          }
          // Every tool slot — including `__state_update_action__`-backed
          // transitions and setVariables — must be exposed to the LLM.
          // That sentinel tells the runtime "no real adapter call, apply
          // state_updates inline", NOT "hide from the model". The LLM has
          // to see these tools to emit the tool-call that fires them.
          let effectiveSystem = system;
          let effectiveTools: ToolDef[] = visibleTools.map(stripInternal);
          let middlewareGuardrails: Guardrail[] | undefined;
          if (!this.pipeline.isEmpty) {
            const beforeLlm = await this.pipeline.runBeforeLlmStep({
              node: this.currentNode,
              state: this.state.snapshot(),
              system,
              messages: [...this.history],
              tools: effectiveTools,
            });
            if (beforeLlm) {
              if (beforeLlm.system !== undefined)
                effectiveSystem = beforeLlm.system;
              if (beforeLlm.tools) effectiveTools = beforeLlm.tools;
              if (beforeLlm.appendMessages) {
                for (const m of beforeLlm.appendMessages) this.history.push(m);
              }
              if (beforeLlm.guardrails)
                middlewareGuardrails = beforeLlm.guardrails;
            }
          }

          this.traceStart('llm-step', { 'node.name': node.developer_name });
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'reasoning',
          });
          const turn = await this.runLlmStepWithGuardrails(
            effectiveSystem,
            effectiveTools,
            signal,
            middlewareGuardrails
          );
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'reasoning',
          });
          this.traceEnd('ok');

          if (!this.pipeline.isEmpty) {
            const afterLlm = await this.pipeline.runAfterLlmStep({
              node: this.currentNode,
              state: this.state.snapshot(),
              text: turn.text,
              toolCalls: turn.toolCalls,
            });
            if (afterLlm) {
              if (afterLlm.text !== undefined) turn.text = afterLlm.text;
              if (afterLlm.toolCalls) turn.toolCalls = afterLlm.toolCalls;
            }
          }

          assistantText += turn.text;

          if (turn.toolCalls.length === 0) {
            // LLM is done talking -> push a plain assistant message and exit.
            if (turn.text)
              this.history.push({ role: 'assistant', content: turn.text });
            break reasoning;
          }

          // The model emitted tool calls. Push a single assistant message
          // that carries both the text (if any) and the tool_calls, so the
          // provider sees a valid tool_calls -> tool_result handshake.
          this.history.push({
            role: 'assistant',
            content: '',
            tool_calls: turn.toolCalls,
          });

          let sessionEnded = false;
          if (this.shouldDispatchParallel(turn.toolCalls, nodeTools)) {
            this.throwIfAborted(signal);
            const parallel = await this.dispatchToolCallsParallel(
              turn.toolCalls,
              nodeTools,
              signal
            );
            steps += parallel.steps;
            sessionEnded = parallel.endSession;
            if (steps > this.maxSteps) break outer;
          } else {
            for (const call of turn.toolCalls) {
              // CP-4: Check abort before each tool dispatch.
              this.throwIfAborted(signal);
              this.traceStart(`tool-call:${call.name}`, {
                'tool.name': call.name,
              });
              const outcome = await this.dispatchToolCall(
                call,
                nodeTools,
                signal
              );
              this.traceEnd('ok');
              if (outcome.endSession) {
                sessionEnded = true;
                break;
              }
              if (++steps > this.maxSteps) break outer;
            }
          }
          if (sessionEnded) {
            // @utils.end_session fired — stop everything for this turn.
            break outer;
          }

          // Escalation: @utils.escalate sets AgentScriptInternal_next_topic
          // to '__human__'. Surface as a terminal event and stop the turn.
          if (
            this.state.get('AgentScriptInternal_next_topic') === '__human__'
          ) {
            this.bus.emit({ kind: 'end-session' });
            break outer;
          }

          // after_all_tool_calls fires after each tool-call round. A handoff
          // here preempts further reasoning on this node.
          const afterAllSteps = node.after_all_tool_calls as Step[] | null;
          if (afterAllSteps && afterAllSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-start',
              node: node.developer_name,
              phase: 'after_all_tool_calls',
            });
          }
          const afterAll = await runSteps(afterAllSteps, baseStepOpts);
          if (afterAllSteps && afterAllSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-end',
              node: node.developer_name,
              phase: 'after_all_tool_calls',
            });
          }
          if (afterAll.handoffTo) {
            loopHandoff = afterAll.handoffTo;
            break reasoning;
          }

          if (++steps > this.maxSteps) break outer;
          // Otherwise: loop back into the LLM so it can observe the tool
          // results in chat history and produce the final response.
        }

        if (loopHandoff) {
          this.traceEnd('ok'); // end node span
          this.currentNode = loopHandoff;
          if (++steps > this.maxSteps) break outer;
          continue;
        }

        // 3. after_reasoning (runs once per node exit)
        const afterSteps = node.after_reasoning as Step[] | null;
        if (afterSteps && afterSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'after_reasoning',
          });
        }
        const after = await runSteps(afterSteps, baseStepOpts);
        if (afterSteps && afterSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'after_reasoning',
          });
        }
        if (after.handoffTo) {
          this.traceEnd('ok'); // end node span
          this.currentNode = after.handoffTo;
          if (++steps > this.maxSteps) break outer;
          continue;
        }

        // No handoff -> turn ends on this node.
        this.traceEnd('ok'); // end node span
        break outer;
      }

      this.bus.emit({ kind: 'turn-end', node: this.currentNode });

      // End root "turn" span
      this.traceEnd('ok');

      // Flush tracing spans to exporter
      if (this._tracingCtx) {
        await this._tracingCtx.flush();
      }

      if (!this.pipeline.isEmpty) {
        const afterResult = await this.pipeline.runAfterTurn({
          assistantText,
          finalNode: this.currentNode,
          state: this.state.snapshot(),
          events: collected,
        });
        if (afterResult?.assistantText !== undefined) {
          assistantText = afterResult.assistantText;
        }
      }

      // Parse structured output if configured
      let parsed: ParsedStructuredOutput | undefined;
      if (this.opts.structuredOutput && assistantText) {
        parsed = parseStructuredOutput(
          assistantText,
          this.opts.structuredOutput.schema
        );
      }

      return {
        assistantText,
        finalNode: this.currentNode,
        events: collected,
        parsed,
      };
    } catch (err) {
      if (err instanceof AbortError) {
        // Drain unclosed spans with error status
        if (this._tracingCtx) {
          this._tracingCtx.drainAll('error');
          await this._tracingCtx.flush();
        }
        this.bus.emit({ kind: 'abort', reason: err.reason });
      }
      throw err;
    } finally {
      this._inTurn = false;
      off();
    }
  }

  // -----------------------------------------------------------------------
  // Checkpoint / Restore
  // -----------------------------------------------------------------------

  checkpoint(opts?: {
    id?: string;
    metadata?: Record<string, unknown>;
  }): Checkpoint {
    if (this._inTurn) {
      throw new Error(
        'Cannot checkpoint mid-turn. Wait for turn() to resolve.'
      );
    }
    return {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      id: opts?.id ?? crypto.randomUUID(),
      currentNode: this.currentNode,
      history: structuredClone(this.history),
      stateValues: this.state.snapshot(),
      metadata: opts?.metadata,
    };
  }

  static fromCheckpoint(opts: RuntimeOptions, checkpoint: Checkpoint): Runtime {
    if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
      throw new CheckpointVersionError(
        checkpoint.schemaVersion,
        CHECKPOINT_SCHEMA_VERSION
      );
    }
    const rt = new Runtime(opts);
    rt.currentNode = checkpoint.currentNode;
    rt.history.length = 0;
    rt.history.push(...structuredClone(checkpoint.history));
    for (const [key, value] of Object.entries(checkpoint.stateValues)) {
      rt.state._restoreValue(key, value);
    }
    return rt;
  }

  // -----------------------------------------------------------------------

  private requireNode(name: string): SubAgentNode {
    const node = this.graph.nodes.get(name);
    if (!node) throw new Error(`Subagent "${name}" not found`);
    return node;
  }

  private buildSystemPrompt(node: SubAgentNode): string {
    const scope = makeScope(this.state);
    const pieces: string[] = [];
    if (node.instructions) pieces.push(node.instructions);
    if (node.focus_prompt)
      pieces.push(renderTemplate(node.focus_prompt, scope));
    return pieces.filter(Boolean).join('\n\n');
  }

  private buildToolDefs(
    node: SubAgentNode,
    actionUris: Map<string, string>
  ): Array<
    ToolDef & {
      /** Raw target as written in the IR tool slot — usually an action developer_name. */
      actionRef: string;
      /** Fully-resolved `scheme://name` URI (or sentinel for state-update). */
      target: string;
      /** Raw `enabled` guard expression; evaluated each turn to gate the tool. */
      enabled?: unknown;
      bound?: Record<string, unknown>;
      stateUpdates?: Array<Record<string, unknown>> | null;
    }
  > {
    const tools = node.tools ?? [];
    // Action definition inputs (for schema).
    const inputs = new Map<string, unknown[] | undefined>();
    for (const def of node.action_definitions ?? []) {
      const d = def as unknown as {
        developer_name: string;
        input_type?: unknown[];
      };
      inputs.set(d.developer_name, d.input_type);
    }
    return tools.map(t => {
      const asTool = t as unknown as {
        name?: string;
        description?: string;
        target: string;
        enabled?: unknown;
        input_parameters?: unknown[];
        bound_inputs?: Record<string, unknown> | null;
        state_updates?: Array<Record<string, unknown>> | null;
      };
      const name = asTool.name ?? asTool.target;
      // `target` in a tool slot is the action's developer_name, unless it's
      // the state-update sentinel or already has a scheme (handoff, etc.).
      const resolvedTarget =
        asTool.target.includes('://') ||
        asTool.target === '__state_update_action__'
          ? asTool.target
          : (actionUris.get(asTool.target) ?? asTool.target);
      const inputParams = asTool.input_parameters ?? inputs.get(asTool.target);
      return {
        name,
        description: asTool.description ?? '',
        inputSchema: inputSchemaFromParams(inputParams),
        actionRef: asTool.target,
        target: resolvedTarget,
        enabled: asTool.enabled,
        bound: asTool.bound_inputs ?? undefined,
        stateUpdates: asTool.state_updates,
      };
    });
  }

  private async runLlmStep(
    system: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    responseFormat?: LlmStepInput['responseFormat']
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const input: LlmStepInput = {
      system,
      messages: [...this.history],
      tools,
      signal,
    };
    if (responseFormat) {
      input.responseFormat = responseFormat;
    }
    const iter = this.opts.llm.step(input);
    let text = '';
    const toolCalls: ToolCall[] = [];
    for await (const ev of iter) {
      // CP-5: Check abort after each streamed event.
      this.throwIfAborted(signal);
      if (ev.kind === 'text-delta') {
        text += ev.text;
        this.bus.emit({ kind: 'llm-text', text: ev.text });
      } else if (ev.kind === 'tool-call') {
        toolCalls.push(ev.call);
      }
    }
    return { text, toolCalls };
  }

  /**
   * Run an LLM step with guardrail validation and retry logic.
   * If no guardrails are configured, delegates directly to runLlmStep.
   */
  private async runLlmStepWithGuardrails(
    system: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    middlewareGuardrails?: Guardrail[]
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    // Determine responseFormat and additional guardrails from structured output config
    let responseFormat: LlmStepInput['responseFormat'] | undefined;
    const structuredGuardrails: Guardrail[] = [];
    if (this.opts.structuredOutput) {
      const strategy = this.opts.structuredOutput.strategy ?? 'auto';
      if (strategy === 'native' || strategy === 'auto') {
        responseFormat = buildResponseFormat(this.opts.structuredOutput);
      }
      if (strategy === 'guardrail' || strategy === 'auto') {
        structuredGuardrails.push(
          jsonSchemaGuardrail({
            schema: this.opts.structuredOutput.schema,
            name: 'structured-output',
            maxRetries: this.opts.structuredOutput.maxRetries ?? 2,
          })
        );
      }
    }

    const guardrails = this.getActiveGuardrails(
      middlewareGuardrails,
      structuredGuardrails
    );
    if (guardrails.length === 0) {
      return this.runLlmStep(system, tools, signal, responseFormat);
    }

    const DEFAULT_FEEDBACK =
      'Your response failed validation: {error}. Please try again.';

    let lastResult = await this.runLlmStep(
      system,
      tools,
      signal,
      responseFormat
    );

    for (const guardrail of guardrails) {
      const maxRetries = guardrail.maxRetries ?? 2;
      let attempt = 0;
      let lastError = '';

      while (true) {
        this.throwIfAborted(signal);

        // Determine if this guardrail should fire based on target filtering
        const target = guardrail.target ?? 'both';
        const hasText = lastResult.text.length > 0;
        const hasToolCalls = lastResult.toolCalls.length > 0;

        if (target === 'text' && !hasText && hasToolCalls) {
          // text-only guardrail, but LLM returned only tool calls — skip
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }
        if (target === 'tool-calls' && !hasToolCalls && hasText) {
          // tool-calls-only guardrail, but LLM returned only text — skip
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }

        const validationResult = await guardrail.validate(
          { text: lastResult.text, toolCalls: lastResult.toolCalls },
          {
            node: this.currentNode,
            state: this.state.snapshot(),
            attempt,
            maxRetries,
            messages: [...this.history],
          }
        );

        if (validationResult.valid) {
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }

        // Validation failed
        lastError = validationResult.reason ?? 'validation failed';
        attempt++;
        this.bus.emit({
          kind: 'guardrail-fail',
          name: guardrail.name,
          error: lastError,
          attempt,
        });

        if (attempt > maxRetries) {
          // Exhausted retries
          this.bus.emit({
            kind: 'guardrail-exhausted',
            name: guardrail.name,
            error: lastError,
            attempts: attempt,
          });

          const policy = this.opts.exhaustionPolicy ?? 'throw';
          if (policy === 'throw') {
            throw new GuardrailExhaustionError(
              guardrail.name,
              lastError,
              attempt
            );
          }
          // 'last-response' policy: return the last (invalid) response
          break;
        }

        // Push the failed response + feedback into history for retry
        const template = guardrail.feedbackTemplate ?? DEFAULT_FEEDBACK;
        const feedback = template.replace('{error}', lastError);

        // Push the failed assistant message so the LLM sees what it said wrong
        if (lastResult.text) {
          this.history.push({
            role: 'assistant',
            content: lastResult.text,
          });
        }
        this.history.push({ role: 'user', content: feedback });

        // Retry the LLM step
        lastResult = await this.runLlmStep(
          system,
          tools,
          signal,
          responseFormat
        );
      }
    }

    return lastResult;
  }

  /**
   * Get the active guardrails — combines static guardrails from options
   * with structured output guardrails and any dynamically added via middleware.
   */
  private getActiveGuardrails(
    middlewareGuardrails?: Guardrail[],
    structuredGuardrails?: Guardrail[]
  ): Guardrail[] {
    const base = this.opts.guardrails ?? [];
    const structured = structuredGuardrails ?? [];
    const middleware = middlewareGuardrails ?? [];
    if (structured.length === 0 && middleware.length === 0) {
      return base;
    }
    return [...structured, ...base, ...middleware];
  }

  /**
   * Delegate control to a child node. The child runs a separate reasoning loop
   * and returns its result. State IS shared (child mutations are visible to parent),
   * but conversation history is isolated.
   */
  private async delegate(
    childNodeName: string,
    context?: string,
    signal?: AbortSignal
  ): Promise<DelegationResult> {
    // 1. Resolve the child node
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Delegation target node "${childNodeName}" not found`);
    }

    // 2. Check depth limit
    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }

    // 3. Create frame
    const maxSteps = defaultOpts.maxSteps ?? 10;
    const shareHistory = defaultOpts.shareHistory ?? false;
    const frame: DelegationFrame = {
      parentNode: this.currentNode,
      childNode: childNodeName,
      parentHistory: Object.freeze([...this.history]),
      depth: this.delegationStack.length + 1,
      options: {
        maxSteps,
        maxDepth,
        context: context ?? defaultOpts.context ?? '',
        shareHistory,
      },
    };

    // 4. Push frame
    this.delegationStack.push(frame);

    // 5. Emit delegation-start
    this.bus.emit({
      kind: 'delegation-start',
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
    });

    // Save parent state
    const savedNode = this.currentNode;
    const savedHistory = [...this.history];

    // Take a state snapshot before delegation to compute changes afterwards
    const stateBefore = this.state.snapshot();

    try {
      // 6. Swap to child context
      this.currentNode = childNodeName;
      this.history.length = 0;
      if (shareHistory) {
        this.history.push(...savedHistory);
      }
      if (context) {
        this.history.push({
          role: 'user',
          content: `[Delegation context: ${context}]`,
        });
      }

      // 7. Mini reasoning loop for the child
      this.traceStart(`delegation:${childNodeName}`, {
        'delegation.child': childNodeName,
        'delegation.depth': frame.depth,
      });

      let assistantText = '';
      let steps = 0;

      const node = this.requireNode(this.currentNode);
      const actionUris = buildActionUriMap(node);
      const nodeTools = this.buildToolDefs(node, actionUris);
      const resolveTarget = (ref: string): string => {
        if (ref.includes('://') || ref === '__state_update_action__')
          return ref;
        return actionUris.get(ref) ?? ref;
      };
      const baseStepOpts = {
        state: this.state,
        tools: this.opts.tools,
        bus: this.bus,
        resolveTarget,
      };

      // Run before_reasoning for the child node
      const preSteps = node.before_reasoning as Step[] | null;
      await runSteps(preSteps, baseStepOpts);

      // Reasoning loop
      while (true) {
        this.throwIfAborted(signal);

        if (steps >= maxSteps) {
          throw new DelegationTimeoutError(childNodeName, maxSteps, steps);
        }

        const system = this.buildSystemPrompt(node);
        const enableScope = makeScope(this.state);
        const visibleTools = nodeTools
          .filter(t => isEnabled(t.enabled, enableScope))
          .filter(t => {
            if (!this.opts.toolLimits) return true;
            const limit = this.opts.toolLimits[t.name];
            if (!limit) return true;
            return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
          });
        const effectiveTools: ToolDef[] = visibleTools.map(stripInternal);

        const turn = await this.runLlmStep(system, effectiveTools, signal);
        steps++;

        assistantText += turn.text;

        if (turn.toolCalls.length === 0) {
          // Child is done — text-only response
          if (turn.text) {
            this.history.push({ role: 'assistant', content: turn.text });
          }
          break;
        }

        // Process tool calls
        this.history.push({
          role: 'assistant',
          content: '',
          tool_calls: turn.toolCalls,
        });

        let sessionEnded = false;
        for (const call of turn.toolCalls) {
          this.throwIfAborted(signal);
          const outcome = await this.dispatchToolCall(call, nodeTools, signal);
          if (outcome.endSession) {
            sessionEnded = true;
            break;
          }
        }
        if (sessionEnded) {
          break;
        }

        // Escalation: @utils.escalate sets AgentScriptInternal_next_topic
        // to '__human__'. Surface as a terminal event and stop the child loop.
        if (this.state.get('AgentScriptInternal_next_topic') === '__human__') {
          this.bus.emit({ kind: 'end-session' });
          break;
        }
      }

      // Run after_reasoning for the child node
      const afterSteps = node.after_reasoning as Step[] | null;
      await runSteps(afterSteps, baseStepOpts);

      this.traceEnd('ok');

      // 8. Collect state changes
      const stateAfter = this.state.snapshot();
      const stateChanges: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(stateAfter)) {
        if (stateBefore[key] !== value) {
          stateChanges[key] = value;
        }
      }

      const result: DelegationResult = {
        assistantText,
        stateChanges,
        finalNode: this.currentNode,
        steps,
      };

      // 9. Pop frame
      this.delegationStack.pop();

      // 10. Restore parent
      this.currentNode = savedNode;
      this.history.length = 0;
      this.history.push(...savedHistory);

      // 11. Emit delegation-end
      this.bus.emit({
        kind: 'delegation-end',
        parentNode: savedNode,
        childNode: childNodeName,
        result,
      });

      // 12. Return result
      return result;
    } catch (err) {
      // Emit delegation-error, restore parent state, re-throw
      this.traceEnd('error');
      this.delegationStack.pop();
      this.currentNode = savedNode;
      this.history.length = 0;
      this.history.push(...savedHistory);
      this.bus.emit({
        kind: 'delegation-error',
        parentNode: savedNode,
        childNode: childNodeName,
        error: String(err),
      });
      throw err;
    }
  }

  /**
   * Delegate to multiple child nodes in parallel. Each child runs an isolated
   * reasoning loop. State changes are merged after all children settle.
   */
  async delegateMultiple(
    children: Array<{ nodeName: string; context?: string }>,
    signal?: AbortSignal
  ): Promise<DelegationResult[]> {
    const parallelOpts: ParallelDelegationOptions =
      this.opts.delegation?.parallel ?? {};
    const failurePolicy = parallelOpts.failurePolicy ?? 'wait-all';
    const stateMerge = parallelOpts.stateMerge ?? 'last-wins';

    // Pre-validate: check all child nodes exist and depth is within limit
    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }
    for (const child of children) {
      if (!this.graph.nodes.get(child.nodeName)) {
        throw new Error(`Delegation target node "${child.nodeName}" not found`);
      }
    }

    this.bus.emit({
      kind: 'parallel-delegation-start',
      parentNode: this.currentNode,
      childNodes: children.map(c => c.nodeName),
    });

    const stateBefore = this.state.snapshot();
    const childController = new AbortController();
    const onParentAbort = () => childController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const promises = children.map(child =>
        this.runIsolatedDelegation(
          child.nodeName,
          child.context,
          stateBefore,
          childController.signal
        )
      );

      const settled = await Promise.allSettled(promises);

      const delegationResults: DelegationResult[] = [];
      const allChanges: Array<Record<string, unknown>> = [];

      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
          delegationResults.push(outcome.value);
          allChanges.push(outcome.value.stateChanges);
        } else {
          if (failurePolicy === 'fail-fast') {
            childController.abort();
            throw outcome.reason;
          }
          delegationResults.push({
            assistantText: '',
            stateChanges: {},
            finalNode: children[i].nodeName,
            steps: 0,
          });
          allChanges.push({});
        }
      }

      // Merge state changes
      const merged = this.mergeStateChanges(allChanges, stateMerge, parallelOpts.mergeFn);
      for (const [key, value] of Object.entries(merged)) {
        this.state.set(key, value);
      }

      this.bus.emit({
        kind: 'parallel-delegation-end',
        parentNode: this.currentNode,
        childNodes: children.map(c => c.nodeName),
        results: delegationResults.map(r => ({
          finalNode: r.finalNode,
          steps: r.steps,
        })),
      });

      return delegationResults;
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private async runIsolatedDelegation(
    childNodeName: string,
    context: string | undefined,
    _parentStateBefore: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<DelegationResult> {
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Delegation target node "${childNodeName}" not found`);
    }

    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }

    const maxSteps = defaultOpts.maxSteps ?? 10;
    const shareHistory = defaultOpts.shareHistory ?? false;

    const frame: DelegationFrame = {
      parentNode: this.currentNode,
      childNode: childNodeName,
      parentHistory: Object.freeze([...this.history]),
      depth: this.delegationStack.length + 1,
      options: {
        maxSteps,
        maxDepth,
        context: context ?? defaultOpts.context ?? '',
        shareHistory,
      },
    };

    this.bus.emit({
      kind: 'delegation-start',
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
    });

    // Each parallel child gets its own isolated history
    const childHistory: Msg[] = [];
    if (shareHistory) {
      childHistory.push(...this.history);
    }
    if (context) {
      childHistory.push({
        role: 'user',
        content: `[Delegation context: ${context}]`,
      });
    }

    this.traceStart(`delegation:${childNodeName}`, {
      'delegation.child': childNodeName,
      'delegation.depth': frame.depth,
      'delegation.parallel': true,
    });

    let assistantText = '';
    let steps = 0;
    let currentNode = childNodeName;

    const node = this.requireNode(childNodeName);
    const actionUris = buildActionUriMap(node);
    const nodeTools = this.buildToolDefs(node, actionUris);
    const resolveTarget = (ref: string): string => {
      if (ref.includes('://') || ref === '__state_update_action__') return ref;
      return actionUris.get(ref) ?? ref;
    };
    const baseStepOpts = {
      state: this.state,
      tools: this.opts.tools,
      bus: this.bus,
      resolveTarget,
    };

    try {
      const preSteps = node.before_reasoning as Step[] | null;
      await runSteps(preSteps, baseStepOpts);

      // Take a per-child snapshot right before reasoning to track this child's mutations
      const childStateBefore = this.state.snapshot();

      while (true) {
        if (signal?.aborted) {
          throw new AbortError(signal.reason);
        }
        if (steps >= maxSteps) {
          throw new DelegationTimeoutError(childNodeName, maxSteps, steps);
        }

        const system = this.buildSystemPrompt(node);
        const enableScope = makeScope(this.state);
        const visibleTools = nodeTools
          .filter(t => isEnabled(t.enabled, enableScope))
          .filter(t => {
            if (!this.opts.toolLimits) return true;
            const limit = this.opts.toolLimits[t.name];
            if (!limit) return true;
            return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
          });
        const effectiveTools: ToolDef[] = visibleTools.map(stripInternal);

        // Use child's isolated history for the LLM step
        const stepInput: LlmStepInput = {
          system,
          messages: childHistory,
          tools: effectiveTools,
        };
        const turn = await this.collectLlmStep(stepInput, signal);
        steps++;

        assistantText += turn.text;

        if (turn.toolCalls.length === 0) {
          if (turn.text) {
            childHistory.push({ role: 'assistant', content: turn.text });
          }
          break;
        }

        childHistory.push({
          role: 'assistant',
          content: '',
          tool_calls: turn.toolCalls,
        });

        let sessionEnded = false;
        for (const call of turn.toolCalls) {
          if (signal?.aborted) throw new AbortError(signal.reason);
          const outcome = await this.dispatchToolCallForHistory(
            call,
            nodeTools,
            childHistory,
            signal
          );
          if (outcome.endSession) {
            sessionEnded = true;
            break;
          }
        }
        if (sessionEnded) break;

        if (this.state.get('AgentScriptInternal_next_topic') === '__human__') {
          break;
        }
      }

      const afterSteps = node.after_reasoning as Step[] | null;
      await runSteps(afterSteps, baseStepOpts);

      this.traceEnd('ok');

      // Compute state changes relative to this child's pre-reasoning snapshot
      const stateAfter = this.state.snapshot();
      const stateChanges: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(stateAfter)) {
        if (childStateBefore[key] !== value) {
          stateChanges[key] = value;
        }
      }

      const result: DelegationResult = {
        assistantText,
        stateChanges,
        finalNode: currentNode,
        steps,
      };

      this.bus.emit({
        kind: 'delegation-end',
        parentNode: this.currentNode,
        childNode: childNodeName,
        result,
      });

      return result;
    } catch (err) {
      this.traceEnd('error');
      this.bus.emit({
        kind: 'delegation-error',
        parentNode: this.currentNode,
        childNode: childNodeName,
        error: String(err),
      });
      throw err;
    }
  }

  /**
   * Run an LLM step and collect the full turn result (text + tool calls).
   * Similar to runLlmStep but separated for parallel delegation use.
   */
  private async collectLlmStep(
    input: LlmStepInput,
    signal?: AbortSignal
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    let text = '';
    const toolCalls: ToolCall[] = [];
    for await (const event of this.opts.llm.step(input)) {
      if (signal?.aborted) throw new AbortError(signal.reason);
      if (event.kind === 'text-delta') text += event.text;
      else if (event.kind === 'tool-call') toolCalls.push(event.call);
      else if (event.kind === 'finish') break;
    }
    return { text, toolCalls };
  }

  /**
   * Dispatch a single tool call and push the result to the provided history
   * array (instead of this.history). Used by parallel delegation.
   */
  private async dispatchToolCallForHistory(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >,
    history: Msg[],
    signal?: AbortSignal
  ): Promise<{ endSession: boolean }> {
    const def = tools.find(t => t.name === call.name);
    if (!def) {
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        tool_name: call.name,
        content: JSON.stringify({ error: 'unknown tool' }),
      });
      return { endSession: false };
    }

    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    let result: Record<string, unknown>;
    let endSession = false;

    if (def.target === '__state_update_action__') {
      result = args;
    } else if (def.target === '__end_session_action__') {
      result = args;
      endSession = true;
    } else {
      try {
        result = await this.opts.tools.invoke(def.target, args, { signal });
      } catch (err) {
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify({ error: String(err) }),
        });
        return { endSession: false };
      }
    }

    // Apply state_updates
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          this.state.set(name, evalBoundValue(raw, resultScope));
        }
      }
    }

    history.push({
      role: 'tool',
      tool_call_id: call.id,
      tool_name: call.name,
      content: JSON.stringify(result),
    });

    if (endSession) {
      this.bus.emit({ kind: 'end-session' });
    }
    return { endSession };
  }

  private mergeStateChanges(
    changes: Array<Record<string, unknown>>,
    strategy: 'last-wins' | 'error-on-conflict' | 'custom',
    mergeFn?: (changes: Array<Record<string, unknown>>) => Record<string, unknown>
  ): Record<string, unknown> {
    if (strategy === 'custom') {
      if (!mergeFn) throw new Error('mergeFn required when stateMerge is "custom"');
      return mergeFn(changes);
    }

    if (strategy === 'error-on-conflict') {
      const merged: Record<string, unknown> = {};
      const seen = new Map<string, number>();
      for (let i = 0; i < changes.length; i++) {
        for (const [key, value] of Object.entries(changes[i])) {
          if (seen.has(key)) {
            const prevIdx = seen.get(key)!;
            if (changes[prevIdx][key] !== value) {
              throw new StateConflictError(key, prevIdx, i);
            }
          }
          seen.set(key, i);
          merged[key] = value;
        }
      }
      return merged;
    }

    // 'last-wins'
    const merged: Record<string, unknown> = {};
    for (const change of changes) {
      Object.assign(merged, change);
    }
    return merged;
  }

  private shouldDispatchParallel(
    calls: ToolCall[],
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >
  ): boolean {
    const strategy = this.opts.parallel?.strategy ?? 'auto';
    if (strategy === 'never') return false;
    if (strategy === 'always') return calls.length > 1;
    // 'auto': parallel only when safe
    if (calls.length <= 1) return false;
    const sequential = new Set(this.opts.parallel?.sequentialTools ?? []);
    for (const call of calls) {
      if (sequential.has(call.name)) return false;
      const def = tools.find(t => t.name === call.name);
      if (!def) continue;
      if (
        def.target === '__state_update_action__' ||
        def.target === '__end_session_action__' ||
        def.target.startsWith('delegate://') ||
        def.target === '__delegate_action__'
      ) {
        return false;
      }
    }
    return true;
  }

  private async dispatchToolCallsParallel(
    calls: ToolCall[],
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >,
    signal?: AbortSignal
  ): Promise<{ endSession: boolean; steps: number }> {
    const failurePolicy = this.opts.parallel?.failurePolicy ?? 'wait-all';

    this.bus.emit({
      kind: 'parallel-dispatch-start',
      node: this.currentNode,
      toolNames: calls.map(c => c.name),
    });

    // Start a parent tracing span for the parallel batch
    let parentSpanId: string | undefined;
    if (this._tracingCtx) {
      const parentSpan = this._tracingCtx.startSpan('parallel-tool-dispatch', {
        'parallel.count': calls.length,
      });
      parentSpanId = parentSpan.spanId;
    }

    // Pre-check tool limits for all calls before dispatching any
    const limitChecked: Array<{ call: ToolCall; blocked: boolean }> = [];
    for (const call of calls) {
      let blocked = false;
      if (this.opts.toolLimits) {
        const limit = this.opts.toolLimits[call.name];
        if (limit) {
          const count = this.toolCallCounts.get(call.name) ?? 0;
          if (count >= limit.maxCalls) {
            blocked = true;
          }
        }
      }
      limitChecked.push({ call, blocked });
    }

    // Create a child abort controller linked to the parent
    const childController = new AbortController();
    const onParentAbort = () => childController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const promises = limitChecked.map(({ call, blocked }) => {
        if (blocked) {
          this.bus.emit({
            kind: 'tool-limit-reached',
            name: call.name,
            limit: this.opts.toolLimits![call.name].maxCalls,
          });
          return Promise.resolve({
            call,
            endSession: false,
            historyEntry: {
              role: 'tool' as const,
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({
                error: `Tool "${call.name}" has reached its usage limit. Choose a different approach.`,
              }),
            },
            stateWrites: [] as Array<[string, unknown]>,
            error: false,
          });
        }
        return this.dispatchToolCallIsolated(
          call,
          tools,
          childController.signal,
          parentSpanId
        );
      });

      const results = await Promise.allSettled(promises);

      let endSession = false;
      let stepCount = 0;

      // Apply results in order for deterministic history
      for (let i = 0; i < results.length; i++) {
        const settled = results[i];
        stepCount++;
        if (settled.status === 'rejected') {
          const call = calls[i];
          this.bus.emit({
            kind: 'tool-error',
            name: call.name,
            error: String(settled.reason),
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({ error: String(settled.reason) }),
          });
          if (failurePolicy === 'fail-fast') {
            childController.abort();
            break;
          }
        } else {
          const outcome = settled.value;
          // Apply state writes in order
          for (const [key, value] of outcome.stateWrites) {
            this.state.set(key, value);
          }
          this.history.push(outcome.historyEntry as Msg);
          // Increment tool usage counter
          if (!outcome.error) {
            this.toolCallCounts.set(
              outcome.call.name,
              (this.toolCallCounts.get(outcome.call.name) ?? 0) + 1
            );
          }
          if (outcome.endSession) {
            endSession = true;
            this.bus.emit({ kind: 'end-session' });
          }
        }
      }

      // End parent tracing span
      if (this._tracingCtx && parentSpanId) {
        this._tracingCtx.endSpan('ok');
      }

      this.bus.emit({
        kind: 'parallel-dispatch-end',
        node: this.currentNode,
        toolNames: calls.map(c => c.name),
      });

      return { endSession, steps: stepCount };
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private async dispatchToolCallIsolated(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >,
    signal?: AbortSignal,
    parentSpanId?: string
  ): Promise<{
    call: ToolCall;
    endSession: boolean;
    historyEntry: { role: string; tool_call_id: string; tool_name: string; content: string };
    stateWrites: Array<[string, unknown]>;
    error: boolean;
  }> {
    // Start a child span for this tool call
    if (this._tracingCtx && parentSpanId) {
      this._tracingCtx.startChildSpan(parentSpanId, `tool-call:${call.name}`, {
        'tool.name': call.name,
      });
    }

    const makeResult = (
      endSession: boolean,
      content: string,
      stateWrites: Array<[string, unknown]> = [],
      isError = false
    ) => {
      if (this._tracingCtx && parentSpanId) {
        this._tracingCtx.endSpan(isError ? 'error' : 'ok');
      }
      return {
        call,
        endSession,
        historyEntry: {
          role: 'tool' as const,
          tool_call_id: call.id,
          tool_name: call.name,
          content,
        },
        stateWrites,
        error: isError,
      };
    };

    const def = tools.find(t => t.name === call.name);
    if (!def) {
      this.bus.emit({ kind: 'tool-error', name: call.name, error: 'unknown tool' });
      return makeResult(false, JSON.stringify({ error: 'unknown tool' }), [], true);
    }

    // Merge compiler-bound args with LLM-provided args
    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    // beforeToolCall middleware
    if (!this.pipeline.isEmpty) {
      const beforeTc = await this.pipeline.runBeforeToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args: { ...args },
        toolCall: call,
      });
      if (beforeTc?.skip) return makeResult(false, JSON.stringify({}));
      if (beforeTc?.abort) {
        return makeResult(false, JSON.stringify(beforeTc.abort.result));
      }
      if (beforeTc?.args) Object.assign(args, beforeTc.args);
    }

    this.bus.emit({ kind: 'tool-call', name: def.target, args });

    let result: Record<string, unknown>;
    let endSession = false;

    // For isolated dispatch, we don't handle sentinels (they're filtered out
    // by shouldDispatchParallel), but handle external tools
    try {
      result = await this.opts.tools.invoke(def.target, args, { signal });
    } catch (err) {
      if (!this.pipeline.isEmpty) {
        const errorResult = await this.pipeline.runOnError({
          node: this.currentNode,
          state: this.state.snapshot(),
          error: err,
          phase: 'tool-call',
          toolName: call.name,
          target: def.target,
        });
        if (errorResult?.suppress && errorResult.fallbackResult) {
          result = errorResult.fallbackResult;
        } else if (errorResult?.suppress) {
          return makeResult(false, JSON.stringify({}));
        } else {
          this.bus.emit({ kind: 'tool-error', name: def.target, error: String(err) });
          return makeResult(false, JSON.stringify({ error: String(err) }), [], true);
        }
      } else {
        this.bus.emit({ kind: 'tool-error', name: def.target, error: String(err) });
        return makeResult(false, JSON.stringify({ error: String(err) }), [], true);
      }
    }

    // afterToolCall middleware
    if (!this.pipeline.isEmpty) {
      const afterTc = await this.pipeline.runAfterToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args,
        result: result!,
      });
      if (afterTc?.result) result = afterTc.result;
    }

    this.bus.emit({ kind: 'tool-result', name: def.target, result: result! });

    // Collect state writes (deferred)
    const stateWrites: Array<[string, unknown]> = [];
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          stateWrites.push([name, evalBoundValue(raw, resultScope)]);
        }
      }
    }

    return makeResult(endSession, JSON.stringify(result), stateWrites);
  }

  private async dispatchToolCall(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >,
    signal?: AbortSignal
  ): Promise<{ endSession: boolean }> {
    const def = tools.find(t => t.name === call.name);
    if (!def) {
      this.bus.emit({
        kind: 'tool-error',
        name: call.name,
        error: 'unknown tool',
      });
      this.history.push({
        role: 'tool',
        tool_call_id: call.id,
        tool_name: call.name,
        content: JSON.stringify({ error: 'unknown tool' }),
      });
      return { endSession: false };
    }

    // Per-tool usage limit check
    if (this.opts.toolLimits) {
      const limit = this.opts.toolLimits[call.name];
      if (limit) {
        const count = this.toolCallCounts.get(call.name) ?? 0;
        if (count >= limit.maxCalls) {
          this.bus.emit({
            kind: 'tool-limit-reached',
            name: call.name,
            limit: limit.maxCalls,
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({
              error: `Tool "${call.name}" has reached its usage limit of ${limit.maxCalls} calls. Choose a different approach.`,
            }),
          });
          return { endSession: false };
        }
      }
    }

    // Merge compiler-bound args (expression strings that need evaluating)
    // with LLM-provided args (already literal). Only the bound half goes
    // through the expression evaluator.
    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    // --- beforeToolCall middleware hook ---
    if (!this.pipeline.isEmpty) {
      const beforeTc = await this.pipeline.runBeforeToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args: { ...args },
        toolCall: call,
      });
      if (beforeTc?.skip) return { endSession: false };
      if (beforeTc?.abort) {
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify(beforeTc.abort.result),
        });
        return { endSession: false };
      }
      if (beforeTc?.args) Object.assign(args, beforeTc.args);
    }

    this.bus.emit({ kind: 'tool-call', name: def.target, args });

    // Compiler-emitted sentinel targets:
    // - __state_update_action__    @utils.setVariables, transitions, if/set
    // - __end_session_action__     @utils.end_session
    // For these the LLM's arguments ARE the payload (there's no adapter
    // to call), and `end_session` additionally signals turn termination.
    let result: Record<string, unknown>;
    let endSession = false;
    if (def.target === '__state_update_action__') {
      result = args;
    } else if (def.target === '__end_session_action__') {
      result = args;
      endSession = true;
    } else if (
      def.target.startsWith('delegate://') ||
      def.target === '__delegate_action__'
    ) {
      // Delegation: call-return to a child node
      const nodeName = def.target.startsWith('delegate://')
        ? def.target.slice('delegate://'.length)
        : (args.node as string);
      const delegationContext = (args.context as string) ?? undefined;
      try {
        const delegationResult = await this.delegate(
          nodeName,
          delegationContext,
          signal
        );
        result = delegationResult as unknown as Record<string, unknown>;
      } catch (err) {
        this.bus.emit({
          kind: 'tool-error',
          name: def.target,
          error: String(err),
        });
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify({ error: String(err) }),
        });
        return { endSession: false };
      }
    } else {
      try {
        result = await this.opts.tools.invoke(def.target, args, { signal });
      } catch (err) {
        if (!this.pipeline.isEmpty) {
          const errorResult = await this.pipeline.runOnError({
            node: this.currentNode,
            state: this.state.snapshot(),
            error: err,
            phase: 'tool-call',
            toolName: call.name,
            target: def.target,
          });
          if (errorResult?.suppress && errorResult.fallbackResult) {
            result = errorResult.fallbackResult;
          } else if (errorResult?.suppress) {
            this.history.push({
              role: 'tool',
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({}),
            });
            return { endSession: false };
          } else {
            this.bus.emit({
              kind: 'tool-error',
              name: def.target,
              error: String(err),
            });
            this.history.push({
              role: 'tool',
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({ error: String(err) }),
            });
            return { endSession: false };
          }
        } else {
          this.bus.emit({
            kind: 'tool-error',
            name: def.target,
            error: String(err),
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({ error: String(err) }),
          });
          return { endSession: false };
        }
      }
    }

    // --- afterToolCall middleware hook ---
    if (!this.pipeline.isEmpty) {
      const afterTc = await this.pipeline.runAfterToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args,
        result: result!,
      });
      if (afterTc?.result) result = afterTc.result;
    }

    this.bus.emit({ kind: 'tool-result', name: def.target, result: result! });

    // Increment per-tool usage counter after successful invocation
    this.toolCallCounts.set(
      call.name,
      (this.toolCallCounts.get(call.name) ?? 0) + 1
    );

    // Apply state_updates against the result (so `result.*` refs resolve).
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          this.state.set(name, evalBoundValue(raw, resultScope));
        }
      }
    }

    this.history.push({
      role: 'tool',
      tool_call_id: call.id,
      tool_name: call.name,
      content: JSON.stringify(result),
    });

    if (endSession) {
      this.bus.emit({ kind: 'end-session' });
    }
    return { endSession };
  }
}

/**
 * Build `developer_name -> scheme://name` map from a node's action_definitions.
 * Same resolution logic used for tool-slot bindings and hook-invoked actions.
 */
function buildActionUriMap(node: SubAgentNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const def of node.action_definitions ?? []) {
    const d = def as unknown as {
      developer_name: string;
      invocation_target_type?: string;
      invocation_target_name?: string;
    };
    const scheme = d.invocation_target_type ?? 'fn';
    const path = d.invocation_target_name ?? d.developer_name;
    out.set(d.developer_name, `${scheme}://${path}`);
  }
  return out;
}

function stripInternal<T extends { target?: string }>(t: T): T {
  // Strip runtime-only fields before handing to the LLM driver.
  const { target: _target, ...rest } = t as unknown as {
    target?: string;
  } & Record<string, unknown>;
  void _target;
  return rest as T;
}

function inputSchemaFromParams(params: unknown): Record<string, unknown> {
  if (!Array.isArray(params)) return { type: 'object', properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const raw of params) {
    const p = raw as {
      developer_name?: string;
      description?: string;
      data_type?: string;
      required?: boolean;
    };
    if (!p.developer_name) continue;
    properties[p.developer_name] = {
      type: dataTypeToJsonType(p.data_type),
      description: p.description,
    };
    if (p.required) required.push(p.developer_name);
  }
  return required.length
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

function dataTypeToJsonType(t?: string): string {
  switch ((t ?? '').toLowerCase()) {
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'long':
      return 'integer';
    case 'double':
    case 'number':
      return 'number';
    default:
      return 'string';
  }
}
