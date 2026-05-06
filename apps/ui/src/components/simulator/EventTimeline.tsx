/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useMemo, useRef } from 'react';
import type { AgentStreamPart } from '@agentscript/runtime-vercel';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export interface TimelineEntry {
  /** Milliseconds since turn started. */
  t: number;
  part: AgentStreamPart;
}

interface EventTimelineProps {
  entries: TimelineEntry[];
  onClear?: () => void;
}

/**
 * Compact, auto-scrolling list of fullStream parts emitted by the simulator.
 * Consecutive text-delta parts collapse into a single accumulating row per
 * node so the timeline doesn't drown in token chunks.
 */
export function EventTimeline({ entries, onClear }: EventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Collapse consecutive text-delta parts into one aggregated row.
  const rows = useMemo(() => collapseTextDeltas(entries), [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, rows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">Event stream</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {entries.length} event{entries.length === 1 ? '' : 's'}
          </span>
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-xs">
        {rows.length === 0 ? (
          <div className="p-4 text-muted-foreground">
            Run a turn to see fullStream parts emitted by the agent.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row, i) => (
              <TimelineRow key={i} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CollapsedRow {
  t: number;
  type: AgentStreamPart['type'];
  summary: string;
  detail?: string;
}

function TimelineRow({ row }: { row: CollapsedRow }) {
  return (
    <li className="flex items-start gap-3 px-3 py-1.5">
      <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
        {row.t.toFixed(0)}ms
      </span>
      <span className={cn('w-26 shrink-0 font-semibold', colorFor(row.type))}>
        {row.type}
      </span>
      <span className="min-w-0 flex-1 break-words">
        <span>{row.summary}</span>
        {row.detail && (
          <span className="ml-2 text-muted-foreground">{row.detail}</span>
        )}
      </span>
    </li>
  );
}

function colorFor(type: AgentStreamPart['type']): string {
  switch (type) {
    case 'tool-call':
    case 'tool-result':
      return 'text-sky-600 dark:text-sky-400';
    case 'tool-error':
    case 'error':
      return 'text-red-600 dark:text-red-400';
    case 'state-change':
      return 'text-amber-600 dark:text-amber-400';
    case 'start-step':
    case 'finish-step':
      return 'text-muted-foreground';
    case 'phase-start':
    case 'phase-end':
      return 'text-violet-600 dark:text-violet-400';
    case 'text-delta':
      return 'text-foreground';
    case 'finish':
      return 'text-emerald-600 dark:text-emerald-400';
    default:
      return 'text-foreground';
  }
}

function collapseTextDeltas(entries: TimelineEntry[]): CollapsedRow[] {
  const out: CollapsedRow[] = [];
  for (const entry of entries) {
    const { part, t } = entry;
    const last = out[out.length - 1];
    if (part.type === 'text-delta' && last?.type === 'text-delta') {
      last.summary += part.text;
      continue;
    }
    out.push(toRow(t, part));
  }
  return out;
}

function toRow(t: number, part: AgentStreamPart): CollapsedRow {
  switch (part.type) {
    case 'start-step':
      return { t, type: part.type, summary: part.node };
    case 'finish-step':
      return {
        t,
        type: part.type,
        summary: part.node,
        detail: part.to ? `→ ${part.to}` : undefined,
      };
    case 'text-delta':
      return { t, type: part.type, summary: part.text };
    case 'tool-call':
      return {
        t,
        type: part.type,
        summary: part.toolName,
        detail: compactJson(part.args),
      };
    case 'tool-result':
      return {
        t,
        type: part.type,
        summary: part.toolName,
        detail: compactJson(part.result),
      };
    case 'tool-error':
      return { t, type: part.type, summary: part.toolName, detail: part.error };
    case 'phase-start':
      return {
        t,
        type: part.type,
        summary: `▶ ${part.phase}`,
        detail: part.node,
      };
    case 'phase-end':
      return {
        t,
        type: part.type,
        summary: `■ ${part.phase}`,
        detail: part.node,
      };
    case 'state-change':
      return {
        t,
        type: part.type,
        summary: part.name,
        detail: `= ${compactJson(part.after)}`,
      };
    case 'finish':
      return {
        t,
        type: part.type,
        summary: part.finalNode,
        detail: part.assistantText
          ? `"${truncate(part.assistantText, 60)}"`
          : undefined,
      };
    case 'error':
      return { t, type: part.type, summary: String(part.error) };
  }
}

function compactJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
