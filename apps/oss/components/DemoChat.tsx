'use client';

import { useCallback, useRef, useState } from 'react';
import {
  startDemoSession,
  endDemoSession,
  streamDemoMessage,
} from '@/lib/demoApi';

type Msg = {
  id: number;
  kind: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  error?: boolean;
};

const INITIAL_GREETING =
  'Hi! I can help you plan a trip — search flights and hotels, then book them. Try the prefilled prompt below or write your own.';

export default function DemoChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('No active session');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const idSeq = useRef(0);
  const nextId = () => ++idSeq.current;

  const scrollLogToBottom = useCallback(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, []);

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    setStatusText('Starting session…');
    setErrorText(null);
    try {
      if (sessionId) {
        try {
          await endDemoSession(sessionId);
        } catch {
          /* best effort */
        }
      }
      const { sessionId: id } = await startDemoSession();
      setSessionId(id);
      setMessages([
        { id: nextId(), kind: 'assistant', text: INITIAL_GREETING },
      ]);
      setStatusText(`Session ${shortId(id)}`);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      setStatusText('Failed to start session');
      setErrorText(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setStatusText('Ending session…');
    try {
      try {
        await endDemoSession(sessionId);
      } catch {
        /* best effort */
      }
      setSessionId(null);
      setStatusText('No active session');
      setInput('');
      setMessages([]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!sessionId || busy) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    setErrorText(null);
    const userMsg: Msg = { id: nextId(), kind: 'user', text };
    const pendingMsg: Msg = {
      id: nextId(),
      kind: 'assistant',
      text: 'Thinking…',
      pending: true,
    };
    setMessages(prev => [...prev, userMsg, pendingMsg]);
    setBusy(true);
    setTimeout(scrollLogToBottom, 0);

    const updatePending = (changes: Partial<Msg>) => {
      setMessages(prev =>
        prev.map(m => (m.id === pendingMsg.id ? { ...m, ...changes } : m))
      );
      setTimeout(scrollLogToBottom, 0);
    };

    try {
      await streamDemoMessage(sessionId, text, {
        onStatus: s => updatePending({ text: `${s}…`, pending: true }),
        onDelta: (_d, full) => updatePending({ text: full, pending: false }),
        onDone: full =>
          updatePending({ text: full || '(no response)', pending: false }),
        onError: msg =>
          updatePending({ text: msg, pending: false, error: true }),
      });
    } catch (error) {
      const msg = messageOf(error);
      updatePending({ text: msg, pending: false, error: true });
      setErrorText(msg);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const onToggleScript = async () => {
    if (scriptOpen) {
      setScriptOpen(false);
      return;
    }
    setScriptOpen(true);
    if (!scriptLoaded) {
      try {
        const res = await fetch('/assets/agents/mcp_demo.agent');
        if (!res.ok) throw new Error(`Failed to load script (${res.status})`);
        setScriptText(await res.text());
        setScriptLoaded(true);
      } catch (error) {
        setScriptText(`// ${messageOf(error)}`);
      }
    }
  };

  const sendDisabled = busy || !sessionId;

  return (
    <div className="demo-chat" data-demo-chat>
      <div className="demo-chat-head">
        <div>
          <h3>Live Demo Chat</h3>
          <p className="demo-status" data-demo-status>
            {statusText}
          </p>
        </div>
        <div className="demo-actions">
          <button
            type="button"
            className="btn primary"
            data-demo-start
            onClick={onStart}
            disabled={busy}
          >
            Start new session
          </button>
          <button
            type="button"
            className="btn"
            data-demo-end
            onClick={onEnd}
            disabled={!sessionId || busy}
          >
            End session
          </button>
          <button
            type="button"
            className="btn"
            data-demo-view-script
            aria-expanded={scriptOpen}
            aria-controls="demo-script-panel"
            onClick={onToggleScript}
          >
            {scriptOpen ? 'Hide script' : 'View script'}
          </button>
        </div>
      </div>

      <div className="demo-log" data-demo-log ref={logRef}>
        {messages.length === 0 ? (
          <p className="demo-empty">
            Start a session, then ask the agent to search flights, search
            hotels, and book a trip via MCP tools.
          </p>
        ) : (
          messages.map(m => (
            <div
              key={m.id}
              className={[
                'demo-msg',
                m.kind,
                m.pending ? 'pending' : '',
                m.error ? 'error' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="demo-role">
                {m.kind === 'user' ? 'USER' : 'ASSISTANT'}
              </span>
              <div className="demo-bubble">
                <Markdown source={m.text} />
              </div>
            </div>
          ))
        )}
      </div>

      <form className="demo-compose" data-demo-compose onSubmit={onSubmit}>
        <input
          type="text"
          name="message"
          autoComplete="off"
          data-demo-input
          ref={inputRef}
          placeholder="Find me a flight from San Francisco to New York on 2026-07-15 and a hotel for 3 nights."
          disabled={!sessionId}
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button
          type="submit"
          className="btn primary"
          data-demo-send
          disabled={sendDisabled}
        >
          Send
        </button>
      </form>
      {errorText ? (
        <p className="demo-error" data-demo-error>
          {errorText}
        </p>
      ) : null}

      <div
        id="demo-script-panel"
        className="demo-script"
        data-demo-script-panel
        hidden={!scriptOpen}
      >
        <div className="demo-script-head">
          <p className="demo-script-eyebrow">
            <code>mcp_demo.agent</code>
            <span className="demo-script-tag">read-only</span>
          </p>
          <a
            className="demo-script-link"
            href="https://github.com/salesforce/agentscript/blob/main/packages/server/agents/mcp_demo.agent"
            target="_blank"
            rel="noopener"
          >
            View on GitHub →
          </a>
        </div>
        <pre className="demo-script-source">
          <code data-demo-script-code>
            {scriptText ?? 'Loading script…'}
          </code>
        </pre>
      </div>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}

function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${b.level}` as 'h3' | 'h4' | 'h5' | 'h6';
            return (
              <Tag key={i} className="demo-md-heading">
                {renderInline(b.text)}
              </Tag>
            );
          }
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case 'p':
            return <div key={i}>{renderInline(b.text)}</div>;
          default:
            return null;
        }
      })}
    </>
  );
}

type Block =
  | { kind: 'heading'; level: 3 | 4 | 5 | 6; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; text: string };

function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split('\n');
  let listKind: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const closeList = () => {
    if (listKind && listItems.length) {
      blocks.push({ kind: listKind, items: listItems });
    }
    listKind = null;
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, Math.max(3, heading[1].length + 2)) as
        | 3
        | 4
        | 5
        | 6;
      blocks.push({ kind: 'heading', level, text: heading[2] });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (listKind !== 'ul') {
        closeList();
        listKind = 'ul';
      }
      listItems.push(bullet[1]);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (listKind !== 'ol') {
        closeList();
        listKind = 'ol';
      }
      listItems.push(ordered[1]);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const tokenRe =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|(?<![A-Za-z0-9])_([^_\s][^_]*?)_(?![A-Za-z0-9])/g;
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(tokenRe)) {
    if (m.index! > lastIndex) {
      out.push(text.slice(lastIndex, m.index));
    }
    if (m[1] !== undefined) {
      out.push(<code key={key++}>{m[1]}</code>);
    } else if (m[2] !== undefined) {
      out.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<em key={key++}>{m[3] ?? m[4]}</em>);
    }
    lastIndex = m.index! + m[0].length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}
