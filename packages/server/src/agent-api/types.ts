export const AGENT_API_BASE = '/einstein/ai-agent/v1';

export interface AgentApiError {
  errorCode: string;
  message: string;
}

export interface StartSessionRequest {
  externalSessionKey?: string;
  instanceConfig?: {
    endpoint?: string;
  };
  streamingCapabilities?: {
    chunkTypes?: string[];
  };
  bypassUser?: boolean;
  context?: Record<string, unknown>;
}

export interface StartSessionResponse {
  sessionId: string;
  _links: {
    self: { href: string };
    messages: { href: string };
    messagesStream: { href: string };
    session: { href: string };
    end: { href: string };
    websocket: { href: string };
  };
  messages: AgentApiMessage[];
}

export interface SendMessageRequest {
  message: {
    sequenceId: number;
    type: 'Text';
    text: string;
  };
}

export interface SendMessageResponse {
  sessionId: string;
  sequenceId: number;
  messages: AgentApiMessage[];
}

export interface AgentApiMessage {
  type: 'Inform' | 'Error';
  id: string;
  feedbackId: string;
  planId: string;
  isContentSafe: boolean;
  message: string;
  result: unknown[];
  citedReferences: unknown[];
}

export interface SubmitFeedbackRequest {
  feedback: 'positive' | 'negative';
  comment?: string;
}

export interface SubmitFeedbackResponse {
  status: 'accepted';
  sessionId: string;
  messageId: string;
}

export interface StreamChunk {
  chunkType: 'Text' | 'Status' | 'Done' | 'Error';
  sessionId: string;
  sequenceId?: number;
  messageId?: string;
  text?: string;
  status?: string;
  error?: string;
}
