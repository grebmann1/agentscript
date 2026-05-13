/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Play, Settings } from 'lucide-react';
import type {
  AgentScriptAgent,
  AgentStreamPart,
} from '@agentscript/runtime-vercel';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '~/components/ui/resizable';
import { Button } from '~/components/ui/button';
import { useAppStore } from '~/store';
import { useAgentStore, type ToolMock } from '~/store/agentStore';
import { useLlmSettingsStore } from '~/store/llmSettings';
import { buildAgent } from '~/lib/simulator';
import {
  Transcript,
  type TranscriptMessage,
} from '~/components/simulator/Transcript';
import {
  EventTimeline,
  type TimelineEntry,
} from '~/components/simulator/EventTimeline';
import { MocksPanel } from '~/components/simulator/MocksPanel';
import { ProvidersPanel } from '~/components/simulator/ProvidersPanel';
import { RightPane } from '~/components/simulator/RightPane';
import { SnippetPanel } from '~/components/simulator/SnippetPanel';
import { SettingsDialog } from '~/components/SettingsDialog';
import { useToolProviderStore } from '~/store/toolProviderStore';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';

function nextId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Stable empty array so the mocks selector below returns the same reference
 * on every render when the current agent has no mocks yet. Without this,
 * `?? []` would build a fresh `[]` per call and useSyncExternalStore would
 * loop forever.
 */
const EMPTY_MOCKS: ToolMock[] = [];

export function Simulate() {
  const { agentId } = useParams<{ agentId: string }>();
  const agentSource = useAppStore(state => state.source.agentscript);
  const mocks = useAgentStore(state =>
    agentId ? (state.agents[agentId]?.mocks ?? EMPTY_MOCKS) : EMPTY_MOCKS
  );
  const agentName = useAgentStore(state =>
    agentId ? state.agents[agentId]?.name : undefined
  );
  const enabledProviderCount = useToolProviderStore(
    (s) => s.providers.filter((p) => p.enabled).length
  );
  const baseUrl = useLlmSettingsStore(state => state.baseUrl);
  const apiKey = useLlmSettingsStore(state => state.apiKey);
  const model = useLlmSettingsStore(state => state.model);
  const provider = useLlmSettingsStore(state => state.provider);
  const settings = useMemo(
    () => ({ baseUrl, apiKey, model, provider }) as const,
    [baseUrl, apiKey, model, provider]
  );
  const isConfigured = Boolean(baseUrl && apiKey && model);

  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * We keep a single AgentScriptAgent alive across turns so chat history
   * and state persist. Rebuild when settings or source change.
   */
  const agentRef = useRef<{
    agent: AgentScriptAgent;
    sourceHash: string;
    settingsHash: string;
    mocksHash: string;
    providersHash: string;
  } | null>(null);

  const settingsHash = useMemo(
    () => `${settings.baseUrl}|${settings.apiKey}|${settings.model}`,
    [settings.baseUrl, settings.apiKey, settings.model]
  );
  const mocksHash = useMemo(() => JSON.stringify(mocks), [mocks]);

  const getAgent = useCallback((): AgentScriptAgent => {
    const providers = useToolProviderStore.getState().providers;
    const providersHash = JSON.stringify(
      providers.map((p) => ({ id: p.id, type: p.type, url: p.url, headers: p.headers, enabled: p.enabled }))
    );
    const sourceHash = agentSource;
    const cached = agentRef.current;
    if (
      cached &&
      cached.sourceHash === sourceHash &&
      cached.settingsHash === settingsHash &&
      cached.mocksHash === mocksHash &&
      cached.providersHash === providersHash
    ) {
      return cached.agent;
    }
    const { agent } = buildAgent(agentSource, settings, mocks, providers);
    agentRef.current = { agent, sourceHash, settingsHash, mocksHash, providersHash };
    return agent;
  }, [agentSource, settings, settingsHash, mocks, mocksHash]);

  const handleSend = useCallback(
    async (userText: string) => {
      if (sending) return;

      const userMsgId = nextId();
      const assistantMsgId = nextId();
      setMessages(prev => [
        ...prev,
        { role: 'user', text: userText, id: userMsgId },
        {
          role: 'assistant',
          text: '',
          id: assistantMsgId,
          streaming: true,
        },
      ]);
      setSending(true);

      let agent: AgentScriptAgent;
      try {
        agent = getAgent();
      } catch (err) {
        setMessages(prev => [
          ...prev.filter(m => m.id !== assistantMsgId),
          {
            role: 'system',
            tone: 'error',
            text: err instanceof Error ? err.message : String(err),
            id: nextId(),
          },
        ]);
        setSending(false);
        return;
      }

      const startedAt = performance.now();
      try {
        const stream = agent.stream(userText);

        let assistantText = '';
        for await (const part of stream.fullStream as AsyncIterable<AgentStreamPart>) {
          const t = performance.now() - startedAt;
          setTimeline(prev => [...prev, { t, part }]);

          if (part.type === 'text-delta') {
            assistantText += part.text;
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId ? { ...m, text: assistantText } : m
              )
            );
          } else if (part.type === 'error') {
            setMessages(prev => [
              ...prev.filter(m => m.id !== assistantMsgId),
              {
                role: 'system',
                tone: 'error',
                text:
                  part.error instanceof Error
                    ? part.error.message
                    : String(part.error),
                id: nextId(),
              },
            ]);
          }
        }
        await stream.result;

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  text: assistantText || '(no response)',
                  streaming: false,
                }
              : m
          )
        );
      } catch (err) {
        setMessages(prev => [
          ...prev.filter(m => m.id !== assistantMsgId),
          {
            role: 'system',
            tone: 'error',
            text: err instanceof Error ? err.message : String(err),
            id: nextId(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [getAgent, sending]
  );

  if (!isConfigured) {
    return (
      <>
        <div className="flex h-full w-full items-center justify-center p-8">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Play />
              </EmptyMedia>
              <EmptyTitle>Simulator</EmptyTitle>
              <EmptyDescription>
                Configure an OpenAI-compatible LLM endpoint to run the agent in
                your browser. The key stays in localStorage.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setSettingsOpen(true)}>
                <Settings /> Configure endpoint
              </Button>
            </EmptyContent>
          </Empty>
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Simulator</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono text-xs text-muted-foreground">
            {settings.model}
          </span>
          <span className="text-muted-foreground">·</span>
          <span
            className="text-xs text-muted-foreground"
            title="This is a light TypeScript runtime that only covers the graph-execution parts of AgentScript (subagents, hooks, transitions, tools, state). Apex/Flow adapters, router / external_agent / BYON nodes, confirmation pause/resume, and telemetry are not implemented."
          >
            light TS runtime · graph only
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMessages([]);
              setTimeline([]);
              agentRef.current = null;
            }}
          >
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
            Settings
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={55} minSize={30}>
          <Transcript
            messages={messages}
            onSend={text => {
              void handleSend(text);
            }}
            sending={sending}
            disabled={!agentSource.trim()}
            placeholder={
              !agentSource.trim()
                ? 'Open an agent first — Simulator runs the current script.'
                : undefined
            }
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={45} minSize={20}>
          <RightPane
            tabs={[
              {
                id: 'events',
                label: 'Events',
                content: (
                  <EventTimeline
                    entries={timeline}
                    onClear={() => setTimeline([])}
                  />
                ),
              },
              {
                id: 'mocks',
                label: 'Mocks',
                badge: mocks.filter(m => m.enabled).length,
                content: <MocksPanel agentId={agentId} mocks={mocks} />,
              },
              {
                id: 'providers',
                label: 'Providers',
                badge: enabledProviderCount || undefined,
                content: <ProvidersPanel />,
              },
              {
                id: 'snippet',
                label: 'Snippet',
                content: (
                  <SnippetPanel
                    agentName={agentName}
                    model={settings.model}
                    mocks={mocks}
                  />
                ),
              },
            ]}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
