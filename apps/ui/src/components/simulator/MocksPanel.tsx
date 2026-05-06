/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Switch } from '~/components/ui/switch';
import { Textarea } from '~/components/ui/textarea';
import { cn } from '~/lib/utils';
import { useAgentStore, type ToolMock } from '~/store/agentStore';

const DEFAULT_JSON = '{\n  \n}';

interface MocksPanelProps {
  agentId: string | undefined;
  mocks: ToolMock[];
}

/**
 * Per-agent mock editor. Users add rows of (target URI, JSON response) that
 * the Simulator uses to short-circuit real tool calls. Writes back through
 * useAgentStore.updateAgent so mocks persist in localStorage alongside the
 * rest of the agent's state.
 */
export function MocksPanel({ agentId, mocks }: MocksPanelProps) {
  const updateAgent = useAgentStore(state => state.updateAgent);

  const write = (next: ToolMock[]) => {
    if (!agentId) return;
    updateAgent(agentId, { mocks: next });
  };

  const addMock = () => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    write([
      ...mocks,
      {
        id,
        target: '',
        responseJson: DEFAULT_JSON,
        enabled: true,
      },
    ]);
  };

  const updateMock = (id: string, patch: Partial<ToolMock>) => {
    write(mocks.map(m => (m.id === id ? { ...m, ...patch } : m)));
  };

  const deleteMock = (id: string) => {
    write(mocks.filter(m => m.id !== id));
  };

  if (!agentId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Open an agent to manage its mocks.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Tool mocks</div>
          <div className="text-xs text-muted-foreground">
            Short-circuit tool calls with a fixed JSON response. Matches the
            full target URI (e.g. <code>fn://search_flights</code>).
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={addMock}>
          <Plus />
          Add mock
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {mocks.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No mocks yet. Add one to override the built-in demo handlers or to
            stub out tools the simulator doesn&apos;t know about.
          </div>
        ) : (
          <ul className="space-y-3">
            {mocks.map(mock => (
              <MockRow
                key={mock.id}
                mock={mock}
                onUpdate={patch => updateMock(mock.id, patch)}
                onDelete={() => deleteMock(mock.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface MockRowProps {
  mock: ToolMock;
  onUpdate: (patch: Partial<ToolMock>) => void;
  onDelete: () => void;
}

function MockRow({ mock, onUpdate, onDelete }: MockRowProps) {
  const jsonError = validateJson(mock.responseJson);

  return (
    <li
      className={cn(
        'rounded-md border p-3 space-y-2',
        !mock.enabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <Switch
          checked={mock.enabled}
          onCheckedChange={enabled => onUpdate({ enabled })}
          aria-label="Enable mock"
        />
        <Input
          value={mock.target}
          onChange={e => onUpdate({ target: e.target.value })}
          placeholder="fn://search_flights"
          className="font-mono text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label="Delete mock"
        >
          <Trash2 />
        </Button>
      </div>

      <Textarea
        value={mock.responseJson}
        onChange={e => onUpdate({ responseJson: e.target.value })}
        placeholder='{"status":"shipped"}'
        rows={5}
        spellCheck={false}
        className={cn(
          'font-mono text-xs resize-y',
          jsonError && 'border-red-500 focus-visible:ring-red-500'
        )}
      />
      {jsonError && (
        <p className="text-xs text-red-600 dark:text-red-400">{jsonError}</p>
      )}
    </li>
  );
}

function validateJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'JSON required';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return 'Response must be a JSON object.';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid JSON';
  }
}
