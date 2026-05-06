/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import type { ToolMock } from '~/store/agentStore';

interface SnippetPanelProps {
  agentName?: string;
  model: string;
  mocks: ToolMock[];
}

/**
 * Shows a copy-paste-ready Vercel AI SDK snippet that mirrors the current
 * simulator configuration — same agent, same model, same mocks. Lets users
 * lift exactly what they see into their own project without guessing the
 * wiring.
 */
export function SnippetPanel({ agentName, model, mocks }: SnippetPanelProps) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(
    () => buildSnippet({ agentName, model, mocks }),
    [agentName, model, mocks]
  );

  const handleCopy = () => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Vercel AI SDK snippet</div>
          <div className="text-xs text-muted-foreground">
            Drop this into your own project to run the same agent locally.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <pre
          className={cn(
            'text-xs font-mono leading-relaxed whitespace-pre',
            'bg-muted/40 rounded-md p-3'
          )}
        >
          <code>{snippet}</code>
        </pre>

        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <div>
            <strong className="text-foreground">Install:</strong>
          </div>
          <pre className="bg-muted/40 rounded-md p-3 font-mono">
            <code>
              pnpm add @agentscript/runtime @agentscript/runtime-vercel ai
              @ai-sdk/openai
            </code>
          </pre>
          <div className="pt-2">
            <strong className="text-foreground">Note:</strong> the snippet uses{' '}
            <code className="font-mono">OPENAI_BASE_URL</code> /{' '}
            <code className="font-mono">OPENAI_API_KEY</code> env vars rather
            than inlining the ones from your Simulator settings — don&apos;t
            paste API keys into source.
          </div>
        </div>
      </div>
    </div>
  );
}

interface BuildSnippetArgs {
  agentName?: string;
  model: string;
  mocks: ToolMock[];
}

function buildSnippet({ agentName, model, mocks }: BuildSnippetArgs): string {
  const enabledMocks = mocks.filter(m => m.enabled && m.target);
  const agentFileName = toFilename(agentName ?? 'agent') + '.agent';

  const mockSection =
    enabledMocks.length > 0
      ? `
// Mock responses that match the ones you configured in the Simulator.
// In production, replace these with real adapter handlers.
const fn = new FnAdapter();
${enabledMocks
  .map(m => {
    const name = targetToFnName(m.target);
    const safeJson = prettifyJson(m.responseJson);
    return `fn.register(${JSON.stringify(name)}, () => (${safeJson}));`;
  })
  .join('\n')}
const tools = new ToolRegistry();
tools.register('fn', fn);
`.trim()
      : `
// Register real tool handlers. The Simulator auto-mocks common demos,
// but your own \`fn://\` targets need their own FnAdapter entries.
const tools = new ToolRegistry();
// e.g. const fn = new FnAdapter();
//      fn.register('lookup_order', async (args) => { ... });
//      tools.register('fn', fn);
`.trim();

  return `// ${agentName ?? 'agent'}.ts
import { readFileSync } from 'node:fs';
import { generateText, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { FnAdapter, ToolRegistry } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

// 1. Compile your .agent source.
const source = readFileSync('${agentFileName}', 'utf8');
const { output } = compileSource(source);

${mockSection}

// 2. Point at any OpenAI-compatible endpoint (OpenAI, LiteLLM, vLLM, ...).
const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
});

// 3. Create the agent.
const agent = createAgent({
  doc: output,
  llm: {
    model: openai.chat(${JSON.stringify(model)}),
    generateText,
    jsonSchema,
  },
  tools,
});

// 4. Stream a turn.
const stream = agent.stream('where is my order?');

for await (const part of stream.fullStream) {
  switch (part.type) {
    case 'text-delta':    process.stdout.write(part.text); break;
    case 'tool-call':     console.log('[tool]', part.toolName, part.args); break;
    case 'tool-result':   console.log('[ res]', part.toolName, part.result); break;
    case 'state-change':  console.log('[state]', part.name, '=', part.after); break;
    case 'phase-start':   console.log('[phase] →', part.phase, part.node); break;
    case 'phase-end':     console.log('[phase] ■', part.phase, part.node); break;
    case 'finish':        console.log('\\n[done]', part.finalNode); break;
    case 'error':         console.error('[err]', part.error); break;
  }
}

const result = await stream.result;
console.log(result.assistantText);
`;
}

/** `fn://search_flights` → `search_flights`. Other schemes are preserved. */
function targetToFnName(target: string): string {
  if (target.startsWith('fn://')) return target.slice('fn://'.length);
  return target;
}

function prettifyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
      .split('\n')
      .map((line, i) => (i === 0 ? line : '  ' + line))
      .join('\n');
  } catch {
    return raw.trim();
  }
}

function toFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}
