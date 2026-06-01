import { randomUUID } from 'node:crypto';
import type { AgentStreamPart } from '@agentscript/runtime-vercel';
import type {
  AgentApiMessage,
  SendMessageResponse,
  StartSessionResponse,
  StreamChunk,
} from './types.js';

interface SessionViewLike {
  sessionId: string;
  agentId: string;
}

export function toStartSessionResponse(
  baseUrl: string,
  session: SessionViewLike
): StartSessionResponse {
  const base = stripTrailingSlash(baseUrl);
  return {
    sessionId: session.sessionId,
    _links: {
      self: {
        href: `${base}/einstein/ai-agent/v1/sessions/${session.sessionId}`,
      },
      messages: {
        href: `${base}/einstein/ai-agent/v1/sessions/${session.sessionId}/messages`,
      },
      messagesStream: {
        href: `${base}/einstein/ai-agent/v1/sessions/${session.sessionId}/messages/stream`,
      },
      session: {
        href: `${base}/einstein/ai-agent/v1/agents/${session.agentId}/sessions`,
      },
      end: {
        href: `${base}/einstein/ai-agent/v1/sessions/${session.sessionId}`,
      },
      websocket: {
        href: `${base.replace('http', 'ws')}/einstein/ai-agent/v1/sessions/${session.sessionId}/messages/ws`,
      },
    },
    messages: [
      createInformMessage(
        "Hi, I'm an AI service assistant. How can I help you?"
      ),
    ],
  };
}

export function toSendMessageResponse(args: {
  sessionId: string;
  sequenceId: number;
  text: string;
}): SendMessageResponse {
  return {
    sessionId: args.sessionId,
    sequenceId: args.sequenceId,
    messages: [createInformMessage(args.text)],
  };
}

export function streamPartToChunk(args: {
  sessionId: string;
  sequenceId: number;
  part: AgentStreamPart;
  messageId: string;
}): StreamChunk | null {
  const { sessionId, sequenceId, part, messageId } = args;
  switch (part.type) {
    case 'text-delta':
      return {
        chunkType: 'Text',
        sessionId,
        sequenceId,
        messageId,
        text: part.text,
      };
    case 'start-step':
      return {
        chunkType: 'Status',
        sessionId,
        sequenceId,
        messageId,
        status: `start-step:${part.node}`,
      };
    case 'finish-step':
      return {
        chunkType: 'Status',
        sessionId,
        sequenceId,
        messageId,
        status: `finish-step:${part.node}`,
      };
    case 'finish':
      return {
        chunkType: 'Done',
        sessionId,
        sequenceId,
        messageId,
        text: part.assistantText,
      };
    case 'error':
      return {
        chunkType: 'Error',
        sessionId,
        sequenceId,
        messageId,
        error: toErrorText(part.error),
      };
    default:
      return null;
  }
}

function createInformMessage(message: string): AgentApiMessage {
  return {
    type: 'Inform',
    id: randomUUID(),
    feedbackId: '',
    planId: '',
    isContentSafe: true,
    message,
    result: [],
    citedReferences: [],
  };
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}
