import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { streamPartToChunk } from './agent-api/mappers.js';
import { AGENT_API_BASE } from './agent-api/types.js';
import { AgentRegistry } from './agents.js';
import { createApp } from './app.js';
import { RuntimePolicy } from './runtime-policy.js';
import { InMemorySessionStore, SessionService } from './sessions.js';
import { PostgresSessionStore } from './stores/postgres-session-store.js';
import type { ServerConfig } from './types.js';

export interface StartServerOptions {
  config?: ServerConfig;
  cwd?: string;
  staticRoot?: string;
  onListen?: (info: { port: number }) => void;
}

export interface RunningAgentServer {
  config: ServerConfig;
  server: ReturnType<typeof serve>;
  sessions: SessionService;
  stop: () => void;
}

export async function startServer(
  options: StartServerOptions = {}
): Promise<RunningAgentServer> {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? readConfig(cwd);
  // Self-referential MCP URL — lets demo agents that declare
  // `deployment.mcp.demo.url = "env(MCP_INTERNAL_URL)"` route through the
  // embedded MCP server mounted at /mcp on this same dyno. Set once here
  // so it's available to AgentRegistry.load → createMcpAdapter (which
  // resolves env-refs at load time).
  if (!process.env.MCP_INTERNAL_URL) {
    process.env.MCP_INTERNAL_URL = `http://127.0.0.1:${config.port}/mcp`;
  }
  // Pass `undefined` so AgentRegistry picks the LLM from deployment.llm when any
  // loaded .agent file declares one, falling back to env-var ServerConfig.
  const agents = await AgentRegistry.load(config);
  const sessionStore = await createSessionStore(config);
  const sessions = new SessionService(agents, {
    sessionTtlMs: config.sessionTtlMs,
    maxSessions: config.maxSessions,
    store: sessionStore,
  });
  const runtimePolicy = new RuntimePolicy({
    turnTimeoutMs: config.turnTimeoutMs,
    llmCircuitFailures: config.llmCircuitFailures,
    llmCircuitOpenMs: config.llmCircuitOpenMs,
  });

  const app = createApp({
    agents,
    sessions,
    staticRoot: resolve(
      cwd,
      options.staticRoot ?? process.env.STATIC_DIR ?? 'apps/ui/dist'
    ),
    middlewareConfig: {
      authTokens: config.authTokens,
      corsAllowedOrigins: config.corsAllowedOrigins,
      maxRequestBytes: config.maxRequestBytes,
      rateLimitWindowMs: config.rateLimitWindowMs,
      rateLimitMax: config.rateLimitMax,
    },
    runtimePolicy,
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    info => {
      options.onListen?.(info);
    }
  );

  attachWebSocketServer(server, sessions, runtimePolicy);

  return {
    config,
    server,
    sessions,
    stop: () => {
      sessions.stop();
      server.close();
    },
  };
}

export function readConfig(cwd = process.cwd()): ServerConfig {
  // LLM env vars are only required when no .agent file declares deployment.llm.
  // AgentRegistry.load throws a clear error if neither source is present.
  const llmBaseUrl =
    process.env.LLM_BASE_URL ?? process.env.LLM_GATEWAY_URL ?? '';
  const llmApiKey =
    process.env.LLM_API_KEY ?? process.env.LLM_GATEWAY_API_KEY ?? '';
  const llmModel = process.env.LLM_MODEL ?? process.env.LLM_GATEWAY_MODEL ?? '';

  return {
    port: parsePositiveInt(process.env.PORT, 8080),
    llmBaseUrl,
    llmApiKey,
    llmModel,
    agentsDir: resolve(cwd, process.env.AGENTS_DIR ?? 'packages/server/agents'),
    sessionTtlMs: parsePositiveInt(process.env.SESSION_TTL_MS, 30 * 60 * 1000),
    maxSessions: parsePositiveInt(process.env.MAX_SESSIONS, 100),
    sessionStoreBackend:
      process.env.SESSION_STORE_BACKEND === 'postgres' ? 'postgres' : 'memory',
    postgresUrl: process.env.POSTGRES_URL,
    authTokens: parseList(process.env.API_AUTH_TOKENS),
    corsAllowedOrigins: parseList(process.env.CORS_ALLOWED_ORIGINS, ['*']),
    maxRequestBytes: parsePositiveInt(process.env.MAX_REQUEST_BYTES, 1_000_000),
    rateLimitWindowMs: parsePositiveInt(
      process.env.RATE_LIMIT_WINDOW_MS,
      60_000
    ),
    rateLimitMax: parsePositiveInt(process.env.RATE_LIMIT_MAX, 120),
    turnTimeoutMs: parsePositiveInt(process.env.TURN_TIMEOUT_MS, 45_000),
    llmCircuitFailures: parsePositiveInt(process.env.LLM_CIRCUIT_FAILURES, 5),
    llmCircuitOpenMs: parsePositiveInt(process.env.LLM_CIRCUIT_OPEN_MS, 60_000),
    toolHttpHeaders: parseHeaders(process.env.TOOL_HTTP_HEADERS_JSON),
  };
}

export async function createSessionStore(config: ServerConfig) {
  if (config.sessionStoreBackend === 'postgres') {
    if (!config.postgresUrl) {
      throw new Error(
        'POSTGRES_URL is required when SESSION_STORE_BACKEND=postgres'
      );
    }
    const pool = new Pool({ connectionString: config.postgresUrl });
    const store = new PostgresSessionStore(pool);
    await store.init();
    return store;
  }
  return new InMemorySessionStore();
}

function attachWebSocketServer(
  server: ReturnType<typeof serve>,
  sessions: SessionService,
  runtimePolicy: RuntimePolicy
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      try {
        const requestUrl = new URL(
          request.url ?? '/',
          `http://${request.headers.host}`
        );
        const match = requestUrl.pathname.match(
          new RegExp(
            `^(?:${AGENT_API_BASE}|/v1)/sessions/([^/]+)/(?:messages/)?ws$`
          )
        );
        if (!match) {
          socket.destroy();
          return;
        }
        const sessionId = match[1];
        const session = await sessions.getEntry(sessionId);
        if (!session) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, ws => {
          wss.emit('connection', ws, sessionId);
        });
      } catch {
        socket.destroy();
      }
    })();
  });

  wss.on('connection', (ws, sessionIdArg) => {
    const sessionId = String(sessionIdArg);

    ws.send(
      JSON.stringify({
        chunkType: 'Status',
        sessionId,
        status: 'ready',
        protocol: 'agent-api.websocket.v1',
      })
    );

    ws.on('message', (data: RawData) => {
      void handleWsMessage(ws, sessionId, data, sessions, runtimePolicy);
    });
  });
}

async function handleWsMessage(
  ws: WebSocket,
  sessionId: string,
  raw: RawData,
  sessions: SessionService,
  runtimePolicy: RuntimePolicy
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    ws.send(
      JSON.stringify({ chunkType: 'Error', error: 'invalid JSON payload' })
    );
    return;
  }

  const message =
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    (payload as { message?: { text?: unknown } }).message?.text
      ? (payload as { message: { text?: unknown } }).message.text
      : payload &&
          typeof payload === 'object' &&
          'type' in payload &&
          (payload as { type?: unknown }).type === 'message' &&
          'text' in payload
        ? (payload as { text?: unknown }).text
        : undefined;

  const sequenceId =
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof (payload as { message?: { sequenceId?: unknown } }).message
      ?.sequenceId === 'number'
      ? ((payload as { message: { sequenceId: number } }).message.sequenceId ??
        1)
      : 1;

  if (typeof message !== 'string' || !message.trim()) {
    ws.send(
      JSON.stringify({
        chunkType: 'Error',
        error: 'expected payload { "type": "message", "text": "..." }',
      })
    );
    return;
  }

  let activeTurn;
  try {
    activeTurn = await sessions.beginTurn(sessionId);
  } catch (error) {
    ws.send(
      JSON.stringify({
        chunkType: 'Error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return;
  }

  const messageId = randomUUID();
  try {
    const run = runtimePolicy.stream(
      activeTurn.agent,
      message,
      activeTurn.signal
    );
    for await (const part of run.fullStream) {
      const chunk = streamPartToChunk({
        sessionId: activeTurn.session.sessionId,
        sequenceId,
        part,
        messageId,
      });
      if (chunk) {
        ws.send(JSON.stringify(chunk));
      }
    }
    await run.result;
  } catch (error) {
    ws.send(
      JSON.stringify({
        chunkType: 'Error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  } finally {
    activeTurn.done();
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseHeaders(
  raw: string | undefined
): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseList(raw: string | undefined, fallback: string[] = []): string[] {
  if (!raw?.trim()) return fallback;
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}
