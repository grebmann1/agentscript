/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DelegationResult } from '../delegation/types.js';

/**
 * Named lifecycle phases emitted around each subagent execution. Hosts can
 * use these to group events in a timeline or to show which hook produced a
 * given side-effect.
 */
export type Phase =
  | 'before_reasoning'
  | 'before_reasoning_iteration'
  | 'reasoning'
  | 'after_all_tool_calls'
  | 'after_reasoning';

export type RuntimeEvent =
  | { kind: 'turn-start'; node: string }
  | { kind: 'turn-end'; node: string }
  | { kind: 'node-enter'; node: string }
  | { kind: 'node-exit'; node: string; to?: string }
  | { kind: 'phase-start'; node: string; phase: Phase }
  | { kind: 'phase-end'; node: string; phase: Phase }
  | { kind: 'state-change'; name: string; before: unknown; after: unknown }
  | { kind: 'tool-call'; name: string; args: Record<string, unknown> }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'tool-error'; name: string; error: string }
  | { kind: 'llm-text'; text: string }
  | { kind: 'action-skipped'; name: string; reason: string }
  | { kind: 'abort'; reason?: unknown }
  | { kind: 'tool-limit-reached'; name: string; limit: number }
  | { kind: 'end-session' }
  | { kind: 'guardrail-pass'; name: string }
  | { kind: 'guardrail-fail'; name: string; error: string; attempt: number }
  | {
      kind: 'guardrail-exhausted';
      name: string;
      error: string;
      attempts: number;
    }
  | {
      kind: 'delegation-start';
      parentNode: string;
      childNode: string;
      depth: number;
    }
  | {
      kind: 'delegation-end';
      parentNode: string;
      childNode: string;
      result: DelegationResult;
    }
  | {
      kind: 'delegation-error';
      parentNode: string;
      childNode: string;
      error: string;
    }
  | {
      kind: 'span-start';
      traceId: string;
      spanId: string;
      name: string;
      parentSpanId?: string;
    }
  | {
      kind: 'span-end';
      traceId: string;
      spanId: string;
      name: string;
      status: string;
    };

export type EventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RuntimeEvent): void {
    for (const l of this.listeners) l(event);
  }
}
