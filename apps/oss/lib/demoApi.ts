export type StreamHandlers = {
  onStatus?: (status: string) => void;
  onDelta?: (delta: string, full: string) => void;
  onDone?: (full: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
};

declare global {
  interface Window {
    AGENTSCRIPT_DEMO_API_BASE?: string;
  }
}

async function requestJson<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const bases = resolveApiBases();
  let lastError: unknown;

  for (const base of bases) {
    const url = base ? `${base}${path}` : path;
    try {
      return (await requestJsonAtUrl(url, init)) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Request failed for ${path}`);
}

export async function startDemoSession(): Promise<{ sessionId: string }> {
  const payload = await requestJson<{ sessionId?: unknown }>(
    '/demo/agent/session',
    { method: 'POST' }
  );
  if (!payload || typeof payload.sessionId !== 'string') {
    throw new Error('Demo API returned an invalid session payload.');
  }
  return { sessionId: payload.sessionId };
}

export async function sendDemoMessage(
  sessionId: string,
  text: string
): Promise<{ reply: string }> {
  const payload = await requestJson<{ reply?: unknown }>(
    `/demo/agent/session/${encodeURIComponent(sessionId)}/message`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    }
  );
  if (!payload || typeof payload.reply !== 'string') {
    throw new Error('Demo API returned an invalid message payload.');
  }
  return { reply: payload.reply };
}

export async function streamDemoMessage(
  sessionId: string,
  text: string,
  handlers: StreamHandlers = {}
): Promise<{ reply: string }> {
  const path = `/demo/agent/session/${encodeURIComponent(sessionId)}/message/stream`;
  const bases = resolveApiBases();
  let lastError: unknown;

  for (const base of bases) {
    const url = base ? `${base}${path}` : path;
    try {
      return await streamDemoMessageAtUrl(url, text, handlers);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Streaming request failed.');
}

export async function endDemoSession(
  sessionId: string
): Promise<{ ended: true }> {
  const payload = await requestJson<{ ended?: unknown }>(
    `/demo/agent/session/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
  if (!payload || payload.ended !== true) {
    throw new Error('Demo API returned an invalid session end payload.');
  }
  return { ended: true };
}

function resolveApiBases(): string[] {
  const bases: string[] = [];
  const globalBase =
    typeof window !== 'undefined' &&
    typeof window.AGENTSCRIPT_DEMO_API_BASE === 'string'
      ? window.AGENTSCRIPT_DEMO_API_BASE.trim()
      : '';
  if (globalBase) {
    bases.push(globalBase.replace(/\/+$/, ''));
  }

  bases.push('');

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    const localhostLike = hostname === 'localhost' || hostname === '127.0.0.1';
    if (localhostLike && port !== '8080') {
      bases.push(`${protocol}//${hostname}:8080`);
    }
  }

  return Array.from(new Set(bases));
}

async function requestJsonAtUrl(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string; message?: string } | undefined)?.error ||
      (payload as { error?: string; message?: string } | undefined)?.message ||
      `Request failed with ${response.status}`;
    throw new Error(message);
  }

  if (payload === undefined) {
    throw new Error(`Invalid JSON response from ${url}`);
  }

  return payload;
}

async function streamDemoMessageAtUrl(
  url: string,
  text: string,
  handlers: StreamHandlers
): Promise<{ reply: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: handlers.signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    let payload: { error?: string; message?: string } | undefined;
    try {
      payload = raw ? JSON.parse(raw) : undefined;
    } catch {
      payload = undefined;
    }
    const message =
      payload?.error || payload?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error(`Streaming response body missing from ${url}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let doneText: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    while (true) {
      const next = takeNextSseFrame(buffer);
      if (!next) break;
      const frame = next.frame;
      buffer = next.remaining;
      const payload = parseSseFrame(frame);
      if (!payload) continue;

      if (payload.type === 'status' && typeof payload.status === 'string') {
        handlers.onStatus?.(payload.status);
        continue;
      }
      if (payload.type === 'text_delta' && typeof payload.delta === 'string') {
        fullText += payload.delta;
        handlers.onDelta?.(payload.delta, fullText);
        continue;
      }
      if (payload.type === 'done') {
        if (typeof payload.text === 'string') {
          doneText = payload.text;
          fullText = payload.text;
        }
        handlers.onDone?.(fullText);
        return { reply: fullText };
      }
      if (payload.type === 'error') {
        const message =
          typeof payload.error === 'string' ? payload.error : 'Streaming failed';
        handlers.onError?.(message);
        throw new Error(message);
      }
    }
  }

  if (buffer.trim()) {
    const payload = parseSseFrame(buffer);
    if (payload?.type === 'done' && typeof payload.text === 'string') {
      doneText = payload.text;
      fullText = payload.text;
    }
  }

  if (doneText) {
    handlers.onDone?.(doneText);
    return { reply: doneText };
  }
  if (!fullText) {
    throw new Error('Stream ended before receiving message output.');
  }
  handlers.onDone?.(fullText);
  return { reply: fullText };
}

type SseFrame = {
  type?: string;
  status?: string;
  delta?: string;
  text?: string;
  error?: string;
};

function parseSseFrame(frame: string): SseFrame | null {
  const dataLines = frame
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''));
  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join('\n')) as SseFrame;
  } catch {
    return null;
  }
}

function takeNextSseFrame(
  buffer: string
): { frame: string; remaining: string } | null {
  const boundary = buffer.indexOf('\n\n');
  if (boundary === -1) return null;
  return {
    frame: buffer.slice(0, boundary),
    remaining: buffer.slice(boundary + 2),
  };
}
