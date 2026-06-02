import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentRegistry } from './agents.js';
import { createAgentApiRouter } from './agent-api/routes.js';
import { createEmbeddedMcpRouter } from './embedded-mcp.js';
import { SessionService } from './sessions.js';
import type { CreateSessionRequest, SendMessageRequest } from './types.js';
import {
  loggingMiddleware,
  requestContextMiddleware,
  securityMiddleware,
  type MiddlewareConfig,
} from './middleware.js';
import { RuntimePolicy } from './runtime-policy.js';

const DEMO_AGENT_ID = process.env.DEMO_AGENT_ID ?? 'travel_booking_demo';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

export interface CreateAppOptions {
  agents: AgentRegistry;
  sessions: SessionService;
  staticRoot: string;
  middlewareConfig: MiddlewareConfig;
  runtimePolicy: RuntimePolicy;
}

export function createApp({
  agents,
  sessions,
  staticRoot,
  middlewareConfig,
  runtimePolicy,
}: CreateAppOptions) {
  const app = new Hono();
  const resolvedStaticRoot = resolve(staticRoot);
  const { router: agentApiRouter, basePath } = createAgentApiRouter({
    agents,
    sessions,
    runtimePolicy,
  });
  app.use('*', requestContextMiddleware());
  app.use('*', loggingMiddleware());
  app.use('*', securityMiddleware(middlewareConfig));

  app.get('/healthz', c =>
    c.json({
      ok: true,
      uptimeSec: Math.floor(process.uptime()),
      activeSessions: sessions.backendName,
    })
  );
  app.get('/readyz', c =>
    c.json({
      ok: true,
      storeBackend: sessions.backendName,
      circuitClosed: runtimePolicy.canExecute(),
    })
  );
  app.get('/metrics', c =>
    c.json({
      storeBackend: sessions.backendName,
      circuitClosed: runtimePolicy.canExecute(),
      uptimeSec: Math.floor(process.uptime()),
    })
  );

  app.route(basePath, agentApiRouter);
  // Embedded MCP server — exposes a tiny demo MCP service at /mcp so
  // agents declared with `deployment.mcp` and `mcp://` action targets can
  // round-trip end-to-end without a separate process. Stateless mode.
  //
  // DEMO-ONLY — do not deploy as a production MCP endpoint without
  // front-fronting auth. The security middleware classifies /mcp as a public
  // demo route (auth bypassed, demo rate-limit cap applied) so OSS users can
  // try it without configuring tokens. Production MCP traffic should hit a
  // separately-deployed MCP server with its own auth posture.
  app.route('/mcp', createEmbeddedMcpRouter());
  app.post('/demo/agent/session', async c => {
    try {
      const body = await parseJson<{ context?: Record<string, unknown> }>(c);
      const session = await sessions.create(DEMO_AGENT_ID, body?.context);
      return c.json(
        {
          sessionId: session.sessionId,
          agentId: DEMO_AGENT_ID,
          status: 'ready',
          createdAt: session.createdAt,
        },
        201
      );
    } catch (error) {
      return c.json({ error: toErrorMessage(error) }, 400);
    }
  });
  app.post('/demo/agent/session/:sessionId/message', async c => {
    const body = await parseJson<{ text?: string }>(c);
    const text = body?.text?.trim();
    if (!text) {
      return c.json({ error: 'text is required' }, 400);
    }

    let activeTurn;
    try {
      activeTurn = await sessions.beginTurn(c.req.param('sessionId'));
      if (activeTurn.session.agentId !== DEMO_AGENT_ID) {
        activeTurn.done();
        return c.json({ error: 'Session is not a demo session' }, 403);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      const statusCode = message.includes('busy') ? 409 : 404;
      return c.json({ error: message }, statusCode);
    }

    try {
      const result = await runtimePolicy.run(
        activeTurn.agent,
        text,
        activeTurn.signal
      );
      return c.json({
        sessionId: activeTurn.session.sessionId,
        reply: result.assistantText,
      });
    } catch (error) {
      return c.json({ error: toErrorMessage(error) }, 500);
    } finally {
      activeTurn.done();
    }
  });
  app.post('/demo/agent/session/:sessionId/message/stream', async c => {
    const body = await parseJson<{ text?: string }>(c);
    const text = body?.text?.trim();
    if (!text) {
      return c.json({ error: 'text is required' }, 400);
    }

    let activeTurn;
    try {
      activeTurn = await sessions.beginTurn(c.req.param('sessionId'));
      if (activeTurn.session.agentId !== DEMO_AGENT_ID) {
        activeTurn.done();
        return c.json({ error: 'Session is not a demo session' }, 403);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      const statusCode = message.includes('busy') ? 409 : 404;
      return c.json({ error: message }, statusCode);
    }

    return streamSSE(c, async stream => {
      try {
        const run = runtimePolicy.stream(
          activeTurn.agent,
          text,
          activeTurn.signal
        );
        for await (const part of run.fullStream) {
          if (part.type === 'text-delta') {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({
                type: 'text_delta',
                delta: part.text,
              }),
            });
            continue;
          }
          if (part.type === 'start-step' || part.type === 'finish-step') {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({
                type: 'status',
                status: `${part.type}:${part.node}`,
              }),
            });
            continue;
          }
          if (part.type === 'finish') {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({
                type: 'done',
                text: part.assistantText,
              }),
            });
            continue;
          }
          if (part.type === 'error') {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({
                type: 'error',
                error: toErrorMessage(part.error),
              }),
            });
          }
        }
        await run.result;
      } catch (error) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({
            type: 'error',
            error: toErrorMessage(error),
          }),
        });
      } finally {
        activeTurn.done();
      }
    });
  });
  app.delete('/demo/agent/session/:sessionId', async c => {
    const sessionId = c.req.param('sessionId');
    const session = await sessions.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    if (session.agentId !== DEMO_AGENT_ID) {
      return c.json({ error: 'Session is not a demo session' }, 403);
    }
    await sessions.delete(sessionId);
    return c.json({ ended: true, sessionId });
  });

  app.get('/v1/agents', c => {
    c.header('x-api-deprecated', 'true');
    return c.json({ agents: agents.listAgents() });
  });

  // Deprecated aliases kept for migration compatibility.
  app.post('/v1/sessions', async c => {
    c.header('x-api-deprecated', 'true');
    const body = await c.req.json<CreateSessionRequest>();
    if (!body?.agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }
    try {
      const session = await sessions.create(body.agentId, body.context);
      return c.json(session, 201);
    } catch (error) {
      return c.json({ error: toErrorMessage(error) }, 400);
    }
  });

  app.get('/v1/sessions/:id', async c => {
    c.header('x-api-deprecated', 'true');
    const session = await sessions.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(session);
  });

  app.delete('/v1/sessions/:id', async c => {
    c.header('x-api-deprecated', 'true');
    const deleted = await sessions.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.body(null, 204);
  });

  app.post('/v1/sessions/:id/cancel', async c => {
    c.header('x-api-deprecated', 'true');
    const sessionId = c.req.param('id');
    const session = await sessions.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    const cancelled = await sessions.cancel(sessionId);
    return c.json({ cancelled });
  });

  app.post('/v1/sessions/:id/messages', async c => {
    c.header('x-api-deprecated', 'true');
    const body = await c.req.json<SendMessageRequest>();
    if (!body?.message || !body.message.trim()) {
      return c.json({ error: 'message is required' }, 400);
    }

    const sessionId = c.req.param('id');
    const accept = c.req.header('accept') ?? '';
    const wantsSse = accept.includes('text/event-stream');

    let activeTurn;
    try {
      activeTurn = await sessions.beginTurn(sessionId);
    } catch (error) {
      const message = toErrorMessage(error);
      const statusCode = message.includes('busy') ? 409 : 404;
      return c.json({ error: message }, statusCode);
    }

    if (!activeTurn) {
      return c.json({ error: 'Unable to start turn' }, 500);
    }

    if (wantsSse) {
      return streamSSE(c, async stream => {
        try {
          let sequenceId = 1;
          const run = runtimePolicy.stream(
            activeTurn.agent,
            body.message,
            activeTurn.signal
          );
          for await (const part of run.fullStream) {
            await stream.writeSSE({
              event: part.type,
              data: JSON.stringify({
                chunkType: part.type,
                sessionId: activeTurn.session.sessionId,
                sequenceId: sequenceId++,
                part,
              }),
            });
          }
          await run.result;
        } catch (error) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: toErrorMessage(error) }),
          });
        } finally {
          activeTurn.done();
        }
      });
    }

    try {
      const result = await runtimePolicy.run(
        activeTurn.agent,
        body.message,
        activeTurn.signal
      );
      return c.json(result);
    } catch (error) {
      return c.json({ error: toErrorMessage(error) }, 500);
    } finally {
      activeTurn.done();
    }
  });

  app.get('*', async c => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const staticResponse = await serveStaticPath(resolvedStaticRoot, pathname);
    if (staticResponse) {
      return staticResponse;
    }
    return c.notFound();
  });

  return app;
}

function isInsideStaticRoot(staticRoot: string, absPath: string): boolean {
  return absPath === staticRoot || absPath.startsWith(staticRoot + sep);
}

async function serveStaticPath(
  staticRoot: string,
  pathname: string
): Promise<Response | null> {
  if (
    pathname.startsWith('/demo/agent/') ||
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/einstein/ai-agent/v1/') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/') ||
    pathname === '/healthz' ||
    pathname === '/readyz' ||
    pathname === '/metrics'
  ) {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    return new Response('Bad Request', { status: 400 });
  }

  const filePath = resolve(staticRoot, '.' + pathname);
  if (!isInsideStaticRoot(staticRoot, filePath)) {
    return new Response('Forbidden', { status: 403 });
  }

  const exact = await readIfFile(filePath);
  if (exact) return exact;

  const indexPath = join(filePath, 'index.html');
  const directoryIndex = await readIfFile(indexPath);
  if (directoryIndex) return directoryIndex;

  if (pathname.startsWith('/docs')) {
    const docs404Path = join(staticRoot, 'docs', '404.html');
    const docs404 = await readIfFile(docs404Path, 404);
    if (docs404) return docs404;
  }

  return readIfFile(join(staticRoot, 'index.html'));
}

async function readIfFile(
  filePath: string,
  status = 200
): Promise<Response | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const body = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const isHashed = /\.[a-f0-9]{8,}\.\w+$/.test(filePath);
    const cacheControl = isHashed
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60';
    return new Response(body, {
      status,
      headers: {
        'content-type': contentType,
        'cache-control': cacheControl,
      },
    });
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function parseJson<T>(c: Context): Promise<T | undefined> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return undefined;
  }
}
