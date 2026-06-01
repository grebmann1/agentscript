import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const serverPort = Number.parseInt(process.env.PORT ?? '5520', 10);
const authToken =
  process.env.API_AUTH_TOKENS?.split(',')[0]?.trim() ?? 'real-smoke-token';
const llmBaseUrl = process.env.LLM_BASE_URL ?? process.env.LLM_GATEWAY_URL;
const llmApiKey = process.env.LLM_API_KEY ?? process.env.LLM_GATEWAY_API_KEY;
const llmModel = process.env.LLM_MODEL ?? process.env.LLM_GATEWAY_MODEL;

if (!llmBaseUrl || !llmApiKey || !llmModel) {
  throw new Error(
    'LLM_BASE_URL/LLM_GATEWAY_URL, LLM_API_KEY/LLM_GATEWAY_API_KEY, and LLM_MODEL/LLM_GATEWAY_MODEL are required.'
  );
}

const server = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(serverPort),
    AGENTS_DIR: process.env.AGENTS_DIR ?? 'agents',
    LLM_BASE_URL: llmBaseUrl,
    LLM_API_KEY: llmApiKey,
    LLM_MODEL: llmModel,
    API_AUTH_TOKENS: process.env.API_AUTH_TOKENS ?? authToken,
  },
  stdio: 'inherit',
});

try {
  await sleep(1500);

  const base = `http://127.0.0.1:${serverPort}/einstein/ai-agent/v1`;
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${authToken}`,
  };

  const startRes = await fetch(`${base}/agents/support/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ externalSessionKey: 'real-llm-smoke' }),
  });
  if (!startRes.ok) {
    throw new Error(`start session failed: ${startRes.status}`);
  }
  const start = await startRes.json();
  const sessionId = start.sessionId;
  if (!sessionId) throw new Error('missing sessionId');

  const sendRes = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: {
        sequenceId: 1,
        type: 'Text',
        text: 'Reply with exactly: real provider smoke ok',
      },
    }),
  });
  if (!sendRes.ok) {
    throw new Error(`send message failed: ${sendRes.status}`);
  }
  const reply = await sendRes.json();
  const text = reply.messages?.[0]?.message;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('real provider returned empty response');
  }
  console.log(`REAL_LLM_REPLY=${text}`);

  const endRes = await fetch(`${base}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers,
  });
  if (endRes.status !== 204) {
    throw new Error(`end session failed: ${endRes.status}`);
  }
} finally {
  server.kill('SIGTERM');
}
