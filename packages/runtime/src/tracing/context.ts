/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, SpanExporter, SpanStatus } from './types.js';
import { generateTraceId, generateSpanId } from './ids.js';

/**
 * Stack-based tracing context that manages a tree of spans for a single trace.
 * Spans are started/ended in LIFO order (the most recently started span is
 * always the "current" one). Completed spans are buffered internally until
 * `flush()` or `drainAll()` is called.
 */
export class TracingContext {
  private readonly traceId: string;
  private readonly stack: Span[] = [];
  private readonly completed: Span[] = [];
  private readonly exporter: SpanExporter | undefined;

  constructor(opts?: { traceId?: string; exporter?: SpanExporter }) {
    this.traceId = opts?.traceId ?? generateTraceId();
    this.exporter = opts?.exporter;
  }

  getTraceId(): string {
    return this.traceId;
  }

  /** The currently-active (top of stack) span, or undefined if empty. */
  current(): Span | undefined {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Start a new child span. If there's a current span on the stack, it becomes
   * the parent. Returns the newly created span.
   */
  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const parent = this.current();
    const span: Span = {
      name,
      traceId: this.traceId,
      spanId: generateSpanId(),
      parentSpanId: parent?.spanId,
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes ?? {},
      events: [],
    };
    this.stack.push(span);
    return span;
  }

  /**
   * End the current (top of stack) span. Sets its endTime and status, then
   * moves it to the completed buffer.
   */
  endSpan(status?: SpanStatus): Span | undefined {
    const span = this.stack.pop();
    if (!span) return undefined;
    span.endTime = Date.now();
    span.status = status ?? 'ok';
    this.completed.push(span);
    return span;
  }

  /**
   * End all remaining spans on the stack with the given status (used on
   * abort/error to close unclosed spans).
   */
  drainAll(status: SpanStatus = 'error'): Span[] {
    const drained: Span[] = [];
    while (this.stack.length > 0) {
      const span = this.endSpan(status);
      if (span) drained.push(span);
    }
    return drained;
  }

  /** Flush completed spans to the exporter (if configured). */
  async flush(): Promise<Span[]> {
    const spans = [...this.completed];
    this.completed.length = 0;
    if (this.exporter && spans.length > 0) {
      await this.exporter.export(spans);
    }
    return spans;
  }

  /**
   * Start a child span with an explicit parent (bypasses the stack).
   * Used for parallel operations where multiple spans share a parent
   * but don't nest sequentially.
   */
  startChildSpan(
    parentSpanId: string,
    name: string,
    attributes?: Record<string, unknown>
  ): Span {
    const span: Span = {
      name,
      traceId: this.traceId,
      spanId: generateSpanId(),
      parentSpanId,
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes ?? {},
      events: [],
    };
    this.stack.push(span);
    return span;
  }

  /** Get completed spans without flushing. */
  getCompleted(): ReadonlyArray<Span> {
    return this.completed;
  }

  /** True if all spans have been ended. */
  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}
