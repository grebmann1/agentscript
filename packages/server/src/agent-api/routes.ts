import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentRegistry } from '../agents.js';
import { SessionService } from '../sessions.js';
import { serializeStreamChunk } from '../sse.js';
import { RuntimePolicy } from '../runtime-policy.js';
import {
  streamPartToChunk,
  toSendMessageResponse,
  toStartSessionResponse,
} from './mappers.js';
import {
  AGENT_API_BASE,
  type AgentApiError,
  type SendMessageRequest,
  type StartSessionRequest,
  type SubmitFeedbackRequest,
} from './types.js';

interface CreateAgentApiRouterOptions {
  agents: AgentRegistry;
  sessions: SessionService;
  runtimePolicy: RuntimePolicy;
}

export function createAgentApiRouter({
  agents,
  sessions,
  runtimePolicy,
}: CreateAgentApiRouterOptions) {
  const router = new Hono();

  router.post('/agents/:agentId/sessions', async c => {
    const body = await parseJson<StartSessionRequest>(c);
    const agentId = c.req.param('agentId');

    if (!agents.hasAgent(agentId)) {
      return c.json(
        toError('AGENT_NOT_FOUND', `Unknown agent: ${agentId}`),
        404
      );
    }

    try {
      const session = await sessions.create(agentId, body?.context);
      const baseUrl = new URL(c.req.url).origin;
      return c.json(toStartSessionResponse(baseUrl, session), 201);
    } catch (error) {
      return c.json(
        toError('SESSION_CREATE_FAILED', toErrorMessage(error)),
        400
      );
    }
  });

  router.get('/sessions/:sessionId', async c => {
    const session = await sessions.get(c.req.param('sessionId'));
    if (!session) {
      return c.json(toError('SESSION_NOT_FOUND', 'Session not found'), 404);
    }
    return c.json({
      sessionId: session.sessionId,
      agentId: session.agentId,
      status: session.busy ? 'Active' : 'Idle',
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    });
  });

  router.delete('/sessions/:sessionId', async c => {
    const deleted = await sessions.delete(c.req.param('sessionId'));
    if (!deleted) {
      return c.json(toError('SESSION_NOT_FOUND', 'Session not found'), 404);
    }
    return c.body(null, 204);
  });

  router.post('/sessions/:sessionId/messages', async c => {
    const body = await parseJson<SendMessageRequest>(c);
    const text = body?.message?.text;
    const sequenceId = body?.message?.sequenceId;
    if (!text || typeof text !== 'string') {
      return c.json(toError('INVALID_INPUT', 'message.text is required'), 400);
    }
    if (typeof sequenceId !== 'number') {
      return c.json(
        toError('INVALID_INPUT', 'message.sequenceId is required'),
        400
      );
    }

    let activeTurn;
    try {
      activeTurn = await sessions.beginTurn(c.req.param('sessionId'));
    } catch (error) {
      const message = toErrorMessage(error);
      const code = message.includes('busy') ? 409 : 404;
      return c.json(toError('SESSION_UNAVAILABLE', message), code);
    }

    try {
      const result = await runtimePolicy.run(
        activeTurn.agent,
        text,
        activeTurn.signal
      );
      return c.json(
        toSendMessageResponse({
          sessionId: activeTurn.session.sessionId,
          sequenceId,
          text: result.assistantText,
        })
      );
    } catch (error) {
      return c.json(toError('MESSAGE_SEND_FAILED', toErrorMessage(error)), 500);
    } finally {
      activeTurn.done();
    }
  });

  router.post('/sessions/:sessionId/messages/stream', async c => {
    const body = await parseJson<SendMessageRequest>(c);
    const text = body?.message?.text;
    const sequenceId = body?.message?.sequenceId;
    if (!text || typeof text !== 'string') {
      return c.json(toError('INVALID_INPUT', 'message.text is required'), 400);
    }
    if (typeof sequenceId !== 'number') {
      return c.json(
        toError('INVALID_INPUT', 'message.sequenceId is required'),
        400
      );
    }

    let activeTurn;
    try {
      activeTurn = await sessions.beginTurn(c.req.param('sessionId'));
    } catch (error) {
      const message = toErrorMessage(error);
      const code = message.includes('busy') ? 409 : 404;
      return c.json(toError('SESSION_UNAVAILABLE', message), code);
    }

    const messageId = randomUUID();
    return streamSSE(c, async stream => {
      try {
        const run = runtimePolicy.stream(
          activeTurn.agent,
          text,
          activeTurn.signal
        );
        for await (const part of run.fullStream) {
          const chunk = streamPartToChunk({
            sessionId: activeTurn.session.sessionId,
            sequenceId,
            part,
            messageId,
          });
          if (!chunk) continue;
          await stream.writeSSE({
            event: chunk.chunkType,
            data: serializeStreamChunk(chunk),
          });
        }
        await run.result;
      } catch (error) {
        await stream.writeSSE({
          event: 'Error',
          data: serializeStreamChunk({
            chunkType: 'Error',
            sessionId: activeTurn.session.sessionId,
            sequenceId,
            messageId,
            error: toErrorMessage(error),
          }),
        });
      } finally {
        activeTurn.done();
      }
    });
  });

  router.post('/sessions/:sessionId/messages/:messageId/feedback', async c => {
    const body = await parseJson<SubmitFeedbackRequest>(c);
    if (
      !body?.feedback ||
      (body.feedback !== 'positive' && body.feedback !== 'negative')
    ) {
      return c.json(
        toError('INVALID_INPUT', 'feedback must be positive or negative'),
        400
      );
    }

    try {
      await sessions.recordFeedback(
        c.req.param('sessionId'),
        c.req.param('messageId'),
        body.feedback,
        body.comment
      );
      return c.json({
        status: 'accepted',
        sessionId: c.req.param('sessionId'),
        messageId: c.req.param('messageId'),
      });
    } catch (error) {
      return c.json(toError('FEEDBACK_FAILED', toErrorMessage(error)), 404);
    }
  });

  return { router, basePath: AGENT_API_BASE };
}

async function parseJson<T>(c: Context): Promise<T | undefined> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return undefined;
  }
}

function toError(errorCode: string, message: string): AgentApiError {
  return { errorCode, message };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
