import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsSessionStore } from '../src/stores/fs-session-store.js';
import type { SessionRecord } from '../src/sessions.js';

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sess-1',
    agentId: 'travel',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastActiveAt: '2026-06-01T00:00:00.000Z',
    busy: false,
    feedbackByMessageId: {},
    ...overrides,
  };
}

describe('FsSessionStore', () => {
  let dir: string;
  let store: FsSessionStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fs-session-store-'));
    store = new FsSessionStore(dir);
    await store.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a record across instances', async () => {
    await store.create(makeRecord({ sessionId: 'abc' }));
    const reopened = new FsSessionStore(dir);
    await reopened.init();
    const got = await reopened.get('abc');
    expect(got?.sessionId).toBe('abc');
    expect(got?.agentId).toBe('travel');
  });

  it('returns null for unknown ids', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('rejects suspicious sessionIds', async () => {
    expect(await store.get('../escape')).toBeNull();
    await expect(
      store.create(makeRecord({ sessionId: '../escape' }))
    ).rejects.toThrow(/Invalid sessionId/);
  });

  it('counts and lists records', async () => {
    await store.create(makeRecord({ sessionId: 'a' }));
    await store.create(makeRecord({ sessionId: 'b' }));
    expect(await store.count()).toBe(2);
    const list = await store.list();
    expect(list.map(r => r.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('updates an existing record', async () => {
    await store.create(makeRecord({ sessionId: 'a' }));
    await store.update(makeRecord({ sessionId: 'a', busy: true }));
    const got = await store.get('a');
    expect(got?.busy).toBe(true);
  });

  it('delete returns false for missing record', async () => {
    expect(await store.delete('missing')).toBe(false);
  });

  it('delete returns true and removes record', async () => {
    await store.create(makeRecord({ sessionId: 'a' }));
    expect(await store.delete('a')).toBe(true);
    expect(await store.get('a')).toBeNull();
  });
});
