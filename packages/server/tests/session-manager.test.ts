import { describe, expect, it, vi } from 'vitest';
import type { AgentScriptAgent } from '@agentscript/runtime-vercel';
import { SessionService } from '../src/sessions.js';

function createManager(ttlMs = 50) {
  const registry = {
    hasAgent: (agentId: string) => agentId === 'support',
    createAgent: () => ({}) as AgentScriptAgent,
  };

  return new SessionService(registry as never, {
    sessionTtlMs: ttlMs,
    maxSessions: 2,
  });
}

describe('SessionService', () => {
  it('creates and reads sessions', async () => {
    const manager = createManager();
    const created = await manager.create('support');
    const fetched = await manager.get(created.sessionId);
    expect(fetched?.agentId).toBe('support');
    manager.stop();
  });

  it('rejects concurrent turns per session', async () => {
    const manager = createManager();
    const created = await manager.create('support');
    const turn = await manager.beginTurn(created.sessionId);
    await expect(manager.beginTurn(created.sessionId)).rejects.toThrow('busy');
    turn.done();
    manager.stop();
  });

  it('supports cancellation when turn is active', async () => {
    const manager = createManager();
    const created = await manager.create('support');
    await manager.beginTurn(created.sessionId);
    await expect(manager.cancel(created.sessionId)).resolves.toBe(true);
    manager.stop();
  });

  it('records feedback for a message id', async () => {
    const manager = createManager();
    const created = await manager.create('support');
    await expect(
      manager.recordFeedback(
        created.sessionId,
        'msg-1',
        'positive',
        'great answer'
      )
    ).resolves.toBeUndefined();
    manager.stop();
  });

  it('evicts idle sessions after TTL', async () => {
    vi.useFakeTimers();
    const manager = createManager(25);
    const created = await manager.create('support');
    await expect(manager.get(created.sessionId)).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(manager.get(created.sessionId)).resolves.toBeNull();
    manager.stop();
    vi.useRealTimers();
  });
});
