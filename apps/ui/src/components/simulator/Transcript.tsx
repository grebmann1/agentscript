/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { cn } from '~/lib/utils';

export type TranscriptMessage =
  | { role: 'user'; text: string; id: string }
  | { role: 'assistant'; text: string; id: string; streaming?: boolean }
  | { role: 'system'; text: string; id: string; tone?: 'info' | 'error' };

interface TranscriptProps {
  messages: TranscriptMessage[];
  onSend: (text: string) => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
}

/**
 * Custom chat transcript. Simple, tightly coupled to the simulator's
 * message shape, enough for a BYO-key test harness. A full-fat
 * `@assistant-ui/react` runtime adapter is overkill at this stage.
 */
export function Transcript({
  messages,
  onSend,
  disabled,
  sending,
  placeholder,
}: TranscriptProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed || disabled || sending) return;
    onSend(trimmed);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Send a message to run a turn against the current agent.
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map(m => (
              <li key={m.id} className="flex">
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm border',
                    m.role === 'user' &&
                      'ml-auto bg-primary text-primary-foreground border-primary',
                    m.role === 'assistant' &&
                      'mr-auto bg-card text-card-foreground border-border shadow-sm',
                    m.role === 'system' && 'mx-auto text-xs',
                    m.role === 'system' &&
                      m.tone === 'error' &&
                      'border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                    m.role === 'system' &&
                      m.tone !== 'error' &&
                      'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
                  )}
                >
                  {m.text || (m.role === 'assistant' && m.streaming ? '…' : '')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              placeholder ?? 'Type a message and press Enter to send…'
            }
            rows={2}
            disabled={disabled}
            className="resize-none"
          />
          <Button
            type="button"
            onClick={send}
            disabled={disabled || sending || draft.trim().length === 0}
            size="icon"
          >
            <SendHorizonal />
          </Button>
        </div>
      </div>
    </div>
  );
}
