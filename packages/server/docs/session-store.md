# Session Store Extension Guide

`SessionService` now depends on a pluggable `SessionStore` interface.
By default, the server uses `InMemorySessionStore`.

## Interface

Implement `SessionStore` from `packages/server/src/sessions.ts`:

- `backendName`: display/debug label (ex: `in_memory`, `postgres`, `redis`)
- `count()`: current number of sessions
- `create(record)`: persist new session record
- `get(sessionId)`: fetch one session record
- `update(record)`: persist updates (busy state, activity time, feedback)
- `delete(sessionId)`: remove a session
- `list()`: list all records (used for TTL eviction in `SessionService`)

Session records are plain JSON (`SessionRecord`) so DB-backed stores can serialize
without custom transformations.

## What stays in-memory

Runtime agent instances are still process-local and held by `SessionService`.
Even with a DB-backed `SessionStore`, active `AgentScriptAgent` objects are not
shared across processes.

If you need durable multi-process continuation, add checkpoint persistence as a
future step (store serialized checkpoints and rehydrate runtime on demand).

## Example skeleton

```ts
import type { SessionRecord, SessionStore } from '../src/sessions.js';

export class PostgresSessionStore implements SessionStore {
  readonly backendName = 'postgres';

  async count(): Promise<number> {
    // SELECT COUNT(*) FROM sessions
    return 0;
  }

  async create(record: SessionRecord): Promise<void> {
    // INSERT session row
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    // SELECT row by sessionId
    return null;
  }

  async update(record: SessionRecord): Promise<void> {
    // UPDATE row by sessionId
  }

  async delete(sessionId: string): Promise<boolean> {
    // DELETE row by sessionId
    return true;
  }

  async list(): Promise<SessionRecord[]> {
    // SELECT all rows
    return [];
  }
}
```

## Wiring a custom store

In `packages/server/src/index.ts`, inject your store:

```ts
const sessions = new SessionService(agents, {
  sessionTtlMs: config.sessionTtlMs,
  maxSessions: config.maxSessions,
  store: new PostgresSessionStore(),
});
```
