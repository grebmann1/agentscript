import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { startServer } from '@agentscript/server/node';
import WebSocket from 'ws';

const port = Number.parseInt(process.env.PORT ?? '5620', 10);
const authToken =
  process.env.API_AUTH_TOKENS?.split(',')[0]?.trim() ?? 'local-example-token';
const llmBaseUrl = process.env.LLM_BASE_URL ?? process.env.LLM_GATEWAY_URL;
const llmApiKey = process.env.LLM_API_KEY ?? process.env.LLM_GATEWAY_API_KEY;
const llmModel = process.env.LLM_MODEL ?? process.env.LLM_GATEWAY_MODEL;

if (!llmBaseUrl || !llmApiKey || !llmModel) {
  throw new Error(
    'Set LLM_BASE_URL/LLM_GATEWAY_URL, LLM_API_KEY/LLM_GATEWAY_API_KEY, and LLM_MODEL/LLM_GATEWAY_MODEL in the root .env file.'
  );
}

process.env.PORT = String(port);
process.env.AGENTS_DIR = process.env.AGENTS_DIR ?? 'agents';
process.env.LLM_BASE_URL = llmBaseUrl;
process.env.LLM_API_KEY = llmApiKey;
process.env.LLM_MODEL = llmModel;
process.env.API_AUTH_TOKENS = process.env.API_AUTH_TOKENS ?? authToken;

const running = await startServer({
  cwd: resolve(import.meta.dirname, '..'),
  staticRoot: '../../apps/ui/dist',
  onListen: info => {
    console.log(`Agent server listening on http://localhost:${info.port}`);
  },
});

const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/einstein/ai-agent/v1`;
const agentId = process.env.EXAMPLE_AGENT_ID ?? 'multi_step_support';
const headers = {
  authorization: `Bearer ${authToken}`,
  'content-type': 'application/json',
};

try {
  logStep('example.config', {
    base,
    agentId,
    model: llmModel,
    authToken: redact(authToken),
  });

  logStep('health.get', { path: '/healthz' });
  await getJson('/healthz');
  logStep('ready.get', { path: '/readyz' });
  await getJson('/readyz');
  logStep('metrics.get', { path: '/metrics' });
  await getJson('/metrics');
  console.log('OK health/readiness/metrics');

  logStep('session.start.request', { agentId });
  const session = await postJson(`${base}/agents/${agentId}/sessions`, {
    externalSessionKey: randomUUID(),
    streamingCapabilities: { chunkTypes: ['Text'] },
    bypassUser: true,
  });
  const sessionId = session.sessionId;
  if (!sessionId) throw new Error('start session response missing sessionId');
  logStep('session.start.response', {
    sessionId,
    links: Object.keys(session._links ?? {}),
    welcome: session.messages?.[0]?.message,
  });

  logStep('message.sync.request', { sessionId, sequenceId: 1 });
  const syncReply = await postJson(`${base}/sessions/${sessionId}/messages`, {
    message: {
      sequenceId: 1,
      type: 'Text',
      text: 'Run the three-step workflow for this issue: my order is delayed and I need a concise recommendation.',
    },
  });
  const syncText = syncReply.messages?.[0]?.message;
  if (!syncText) throw new Error('sync response missing assistant message');
  const messageId = syncReply.messages?.[0]?.id;
  logStep('message.sync.response', {
    messageId,
    chars: syncText.length,
    preview: preview(syncText),
  });

  logStep('message.sse.request', { sessionId, sequenceId: 2 });
  const sseText = await streamSse(
    `${base}/sessions/${sessionId}/messages/stream`,
    {
      message: {
        sequenceId: 2,
        type: 'Text',
        text: 'Run the three-step workflow again and include the exact phrase: streaming example ok.',
      },
    }
  );
  if (!sseText) throw new Error('SSE response did not include text');
  logStep('message.sse.response', {
    chars: sseText.length,
    preview: preview(sseText),
  });

  logStep('message.ws.request', { sessionId, sequenceId: 3 });
  const wsText = await streamWebSocket(sessionId, {
    message: {
      sequenceId: 3,
      type: 'Text',
      text: 'Run the three-step workflow again and include the exact phrase: websocket example ok.',
    },
  });
  if (!wsText) throw new Error('WebSocket response did not include text');
  logStep('message.ws.response', {
    chars: wsText.length,
    preview: preview(wsText),
  });

  if (messageId) {
    logStep('feedback.request', { sessionId, messageId });
    const feedback = await postJson(
      `${base}/sessions/${sessionId}/messages/${messageId}/feedback`,
      { feedback: 'positive', comment: 'Local example completed.' }
    );
    if (feedback.status !== 'accepted') {
      throw new Error('feedback was not accepted');
    }
    logStep('feedback.response', feedback);
  }

  logStep('session.delete.request', { sessionId });
  const end = await fetch(`${base}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers,
  });
  if (end.status !== 204) {
    throw new Error(`end session failed: ${end.status}`);
  }
  logStep('session.delete.response', { status: end.status });

  console.log('LOCAL_AGENT_API_EXAMPLE_OK');
} finally {
  running.stop();
}

async function getJson(path) {
  const res = await fetch(`${origin}${path}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const json = await res.json();
  logStep('http.get.response', { path, status: res.status, body: json });
  return json;
}

async function postJson(url, body) {
  logStep('http.post.request', {
    path: new URL(url).pathname,
    body,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  logStep('http.post.response', {
    path: new URL(url).pathname,
    status: res.status,
    body: summarizeBody(json),
  });
  return json;
}

async function streamSse(url, body) {
  logStep('sse.open', { path: new URL(url).pathname });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const dataLine = event
        .split('\n')
        .find(line => line.startsWith('data: '));
      if (!dataLine) continue;
      const chunk = JSON.parse(dataLine.slice('data: '.length));
      logStep('sse.chunk', summarizeChunk(chunk));
      if (chunk.chunkType === 'Text') text += chunk.text ?? '';
      if (chunk.chunkType === 'Done') {
        logStep('sse.close', { finalChars: (text || chunk.text || '').length });
        return text || chunk.text || '';
      }
      if (chunk.chunkType === 'Error') {
        throw new Error(chunk.error ?? 'SSE stream failed');
      }
    }
  }
  return text;
}

function streamWebSocket(sessionId, payload) {
  return new Promise((resolve, reject) => {
    logStep('ws.open', { sessionId });
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/einstein/ai-agent/v1/sessions/${sessionId}/messages/ws`,
      { headers: { authorization: `Bearer ${authToken}` } }
    );
    let text = '';
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket example timed out'));
    }, 30_000);

    ws.on('open', () => {
      logStep('ws.send', payload);
      ws.send(JSON.stringify(payload));
    });
    ws.on('message', raw => {
      const chunk = JSON.parse(raw.toString());
      logStep('ws.chunk', summarizeChunk(chunk));
      if (chunk.chunkType === 'Text') text += chunk.text ?? '';
      if (chunk.chunkType === 'Done') {
        clearTimeout(timeout);
        ws.close();
        logStep('ws.close', { finalChars: (text || chunk.text || '').length });
        resolve(text || chunk.text || '');
      }
      if (chunk.chunkType === 'Error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(chunk.error ?? 'WebSocket stream failed'));
      }
    });
    ws.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function logStep(event, details = {}) {
  console.log(
    `[example] ${event} ${JSON.stringify(details, (_key, value) => {
      if (typeof value === 'string' && value.length > 500) {
        return `${value.slice(0, 500)}...`;
      }
      return value;
    })}`
  );
}

function preview(text) {
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

function redact(value) {
  if (!value) return '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function summarizeBody(body) {
  if (body?.messages?.[0]?.message) {
    return {
      ...body,
      messages: [
        {
          ...body.messages[0],
          message: preview(body.messages[0].message),
        },
      ],
    };
  }
  return body;
}

function summarizeChunk(chunk) {
  return {
    ...chunk,
    text: typeof chunk.text === 'string' ? preview(chunk.text) : chunk.text,
  };
}
