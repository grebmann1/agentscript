import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const mockPort = 5410;
const serverPort = 5420;

const mock = spawn('node', ['scripts/mock-llm.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, MOCK_LLM_PORT: String(mockPort) },
  stdio: 'inherit',
});

const server = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(serverPort),
    LLM_BASE_URL: `http://127.0.0.1:${mockPort}`,
    LLM_API_KEY: 'smoke-key',
    LLM_MODEL: 'gpt-3.5-turbo',
    AGENTS_DIR: 'agents',
    API_AUTH_TOKENS: 'smoke-token',
  },
  stdio: 'inherit',
});

try {
  await sleep(1000);

  const base = `http://127.0.0.1:${serverPort}/einstein/ai-agent/v1`;
  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer smoke-token',
  };

  const startRes = await fetch(`${base}/agents/support/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ externalSessionKey: 'smoke' }),
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
      message: { sequenceId: 1, type: 'Text', text: 'hello' },
    }),
  });
  if (!sendRes.ok) {
    throw new Error(`send message failed: ${sendRes.status}`);
  }

  const endRes = await fetch(`${base}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers,
  });
  if (endRes.status !== 204) {
    throw new Error(`end session failed: ${endRes.status}`);
  }
} finally {
  mock.kill('SIGTERM');
  server.kill('SIGTERM');
}
