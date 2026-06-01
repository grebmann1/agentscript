import { describe, expect, it } from 'vitest';
import {
  streamPartToChunk,
  toSendMessageResponse,
  toStartSessionResponse,
} from '../src/agent-api/mappers.js';

describe('Agent API mappers', () => {
  it('builds start session envelope with agentforce-like links', () => {
    const response = toStartSessionResponse('http://localhost:8080', {
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    expect(response.sessionId).toBe('sess-1');
    expect(response._links.messages.href).toContain(
      '/einstein/ai-agent/v1/sessions/sess-1/messages'
    );
    expect(response._links.messagesStream.href).toContain('/messages/stream');
    expect(response.messages[0]?.type).toBe('Inform');
  });

  it('builds sync message response envelope', () => {
    const response = toSendMessageResponse({
      sessionId: 'sess-1',
      sequenceId: 2,
      text: 'hello',
    });

    expect(response.sessionId).toBe('sess-1');
    expect(response.sequenceId).toBe(2);
    expect(response.messages[0]?.message).toBe('hello');
  });

  it('maps runtime stream parts to canonical stream chunks', () => {
    const textChunk = streamPartToChunk({
      sessionId: 'sess-1',
      sequenceId: 10,
      messageId: 'msg-1',
      part: { type: 'text-delta', text: 'abc' },
    });
    const doneChunk = streamPartToChunk({
      sessionId: 'sess-1',
      sequenceId: 10,
      messageId: 'msg-1',
      part: { type: 'finish', finalNode: 'support', assistantText: 'done' },
    });

    expect(textChunk?.chunkType).toBe('Text');
    expect(textChunk?.text).toBe('abc');
    expect(doneChunk?.chunkType).toBe('Done');
    expect(doneChunk?.text).toBe('done');
  });
});
