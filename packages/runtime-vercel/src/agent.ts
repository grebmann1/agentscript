/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Runtime,
  ToolRegistry,
  type RuntimeEvent,
  type LlmDriver,
  type TurnResult,
} from '@agentscript/runtime';
import type { AgentDSLAuthoring } from '@agentscript/compiler';

import { VercelAiSdkDriver, type VercelDriverOptions } from './driver.js';

/**
 * Typed stream parts, modeled on the Vercel AI SDK `fullStream` shape.
 *
 * We use kebab-case `type` discriminators to match `streamText`'s
 * conventions (text-delta, tool-call, tool-result, start-step, finish-step,
 * finish, error). AgentScript-specific parts are added as additional
 * variants (node-enter, state-change, turn-end). Consumers switch on
 * `part.type` exactly as they would with `ai`'s `fullStream`.
 */
export type AgentStreamPart =
  | { type: 'start-step'; node: string }
  | { type: 'finish-step'; node: string; to?: string }
  | {
      type: 'phase-start';
      node: string;
      phase:
        | 'before_reasoning'
        | 'before_reasoning_iteration'
        | 'reasoning'
        | 'after_all_tool_calls'
        | 'after_reasoning';
    }
  | {
      type: 'phase-end';
      node: string;
      phase:
        | 'before_reasoning'
        | 'before_reasoning_iteration'
        | 'reasoning'
        | 'after_all_tool_calls'
        | 'after_reasoning';
    }
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call';
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'tool-result'; toolName: string; result: unknown }
  | { type: 'tool-error'; toolName: string; error: string }
  | {
      type: 'state-change';
      name: string;
      before: unknown;
      after: unknown;
    }
  | { type: 'finish'; finalNode: string; assistantText: string }
  | { type: 'error'; error: unknown };

/**
 * Result of `agent.run()` — both the final turn payload and a set of
 * lifecycle callbacks fired during execution. Shape mirrors what Vercel's
 * `generateText` returns: a plain value you can await and use.
 */
export interface AgentRunResult {
  /** Accumulated assistant text for this turn. */
  assistantText: string;
  /** Node the agent ended the turn on. */
  finalNode: string;
  /** Raw runtime events, in order. */
  events: RuntimeEvent[];
}

export interface AgentStepInfo {
  node: string;
  /** Assistant text produced at this node, if any. */
  text?: string;
  /** Destination node if this step ended in a handoff. */
  handoffTo?: string;
}

export interface AgentRunOptions {
  /** Fired once per node entry/exit. */
  onStepFinish?: (step: AgentStepInfo) => void | Promise<void>;
  /** Fired when the entire turn completes (success or swallowed error). */
  onFinish?: (result: AgentRunResult) => void | Promise<void>;
  /** Fired on uncaught errors during the turn. */
  onError?: (error: unknown) => void | Promise<void>;
}

/**
 * Stream returned by `agent.stream()`. Provides two async-iterable views
 * (Vercel idiom): `fullStream` for typed parts, `textStream` for text only.
 * Awaiting `.result` yields the final turn payload after the stream drains.
 */
export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamPart>;
  textStream: AsyncIterable<string>;
  /** Resolves once streaming completes. */
  result: Promise<AgentRunResult>;
}

export interface CreateAgentOptions {
  /** Compiled AgentDSL — produced by `compileSource(agentSource).output`. */
  doc: AgentDSLAuthoring;
  /** Vercel AI SDK model + `generateText` injection. */
  llm: VercelDriverOptions;
  /** Scheme-keyed tool registry. Pre-populate with `FnAdapter`/`HttpAdapter`/etc. */
  tools?: ToolRegistry;
  /** Seed values for linked (Context) variables. */
  context?: Record<string, unknown>;
  /** Guard against runaway tool-call / handoff loops. */
  maxStepsPerTurn?: number;
}

/**
 * High-level AgentScript agent, Vercel-style.
 *
 * ```ts
 * const agent = createAgent({
 *   doc: compileSource(src).output,
 *   llm: { model: anthropic('claude-haiku-4-5'), generateText },
 *   tools,
 * });
 *
 * // Promise-style
 * const { assistantText } = await agent.run('hello', {
 *   onStepFinish: step => console.log(step.node),
 * });
 *
 * // Stream-style
 * const stream = agent.stream('hello');
 * for await (const part of stream.fullStream) {
 *   if (part.type === 'text-delta') process.stdout.write(part.text);
 * }
 * const { assistantText } = await stream.result;
 * ```
 */
export class AgentScriptAgent {
  private readonly runtime: Runtime;

  constructor(opts: CreateAgentOptions) {
    const driver: LlmDriver = new VercelAiSdkDriver(opts.llm);
    this.runtime = new Runtime({
      doc: opts.doc,
      llm: driver,
      tools: opts.tools ?? new ToolRegistry(),
      context: opts.context,
      maxStepsPerTurn: opts.maxStepsPerTurn,
    });
  }

  /** Direct read access to runtime state — useful for introspection between turns. */
  get state() {
    return this.runtime.state;
  }

  /**
   * Run a single turn and return the result when complete. Lifecycle callbacks
   * fire in real time as events are emitted by the underlying runtime.
   */
  async run(
    userInput: string,
    opts: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    const stepCtx: { node: string; text: string; handoffTo?: string } = {
      node: '',
      text: '',
    };

    const unsubscribe = this.runtime.on(e => {
      if (e.kind === 'node-enter') {
        stepCtx.node = e.node;
        stepCtx.text = '';
        stepCtx.handoffTo = undefined;
      } else if (e.kind === 'llm-text') {
        stepCtx.text += e.text;
      } else if (e.kind === 'node-exit' || e.kind === 'turn-end') {
        if (e.kind === 'node-exit') stepCtx.handoffTo = e.to;
        void opts.onStepFinish?.({
          node: stepCtx.node,
          text: stepCtx.text || undefined,
          handoffTo: stepCtx.handoffTo,
        });
      }
    });

    try {
      const turn: TurnResult = await this.runtime.turn(userInput);
      const result: AgentRunResult = {
        assistantText: turn.assistantText,
        finalNode: turn.finalNode,
        events: turn.events,
      };
      await opts.onFinish?.(result);
      return result;
    } catch (err) {
      await opts.onError?.(err);
      throw err;
    } finally {
      unsubscribe();
    }
  }

  /**
   * Stream a single turn. Returns two async iterables (`fullStream` of typed
   * parts, `textStream` of text deltas) plus a `result` promise — matching
   * the Vercel AI SDK `streamText` ergonomics.
   */
  stream(userInput: string): AgentStream {
    const parts: AgentStreamPart[] = [];
    let resolveDone!: () => void;
    const donePromise = new Promise<void>(r => {
      resolveDone = r;
    });

    // Buffered async iterable — if the consumer is slow, we queue parts.
    const waiters: Array<(v: IteratorResult<AgentStreamPart>) => void> = [];
    let done = false;

    const push = (part: AgentStreamPart) => {
      if (done) return;
      if (waiters.length > 0) {
        waiters.shift()!({ value: part, done: false });
      } else {
        parts.push(part);
      }
    };
    const close = () => {
      if (done) return;
      done = true;
      while (waiters.length > 0) {
        waiters.shift()!({ value: undefined, done: true });
      }
      resolveDone();
    };

    const unsubscribe = this.runtime.on(e => {
      const part = runtimeEventToStreamPart(e);
      if (part) push(part);
    });

    let finalResult: AgentRunResult | undefined;
    let streamError: unknown;

    const driving = (async () => {
      try {
        const turn = await this.runtime.turn(userInput);
        finalResult = {
          assistantText: turn.assistantText,
          finalNode: turn.finalNode,
          events: turn.events,
        };
        push({
          type: 'finish',
          finalNode: turn.finalNode,
          assistantText: turn.assistantText,
        });
      } catch (err) {
        streamError = err;
        push({ type: 'error', error: err });
      } finally {
        unsubscribe();
        close();
      }
    })();

    const fullStream: AsyncIterable<AgentStreamPart> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AgentStreamPart>> {
            if (parts.length > 0) {
              return Promise.resolve({ value: parts.shift()!, done: false });
            }
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise(resolve => waiters.push(resolve));
          },
        };
      },
    };

    const textStream: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        for await (const part of fullStream) {
          if (part.type === 'text-delta') yield part.text;
        }
      },
    };

    const result: Promise<AgentRunResult> = (async () => {
      await driving;
      await donePromise;
      if (streamError) throw streamError;
      return finalResult!;
    })();

    return { fullStream, textStream, result };
  }
}

/** Ergonomic factory — mirrors `createAnthropic()` / `createOpenAI()` style. */
export function createAgent(opts: CreateAgentOptions): AgentScriptAgent {
  return new AgentScriptAgent(opts);
}

// ---------------------------------------------------------------------------

function runtimeEventToStreamPart(e: RuntimeEvent): AgentStreamPart | null {
  switch (e.kind) {
    case 'node-enter':
      return { type: 'start-step', node: e.node };
    case 'node-exit':
      return { type: 'finish-step', node: e.node, to: e.to };
    case 'llm-text':
      return { type: 'text-delta', text: e.text };
    case 'tool-call':
      return { type: 'tool-call', toolName: e.name, args: e.args };
    case 'tool-result':
      return { type: 'tool-result', toolName: e.name, result: e.result };
    case 'tool-error':
      return { type: 'tool-error', toolName: e.name, error: e.error };
    case 'state-change':
      return {
        type: 'state-change',
        name: e.name,
        before: e.before,
        after: e.after,
      };
    case 'phase-start':
      return { type: 'phase-start', node: e.node, phase: e.phase };
    case 'phase-end':
      return { type: 'phase-end', node: e.node, phase: e.phase };
    // turn-start, turn-end, end-session, action-skipped: not surfaced as
    // stream parts — `finish` covers the end-of-turn signal.
    default:
      return null;
  }
}
