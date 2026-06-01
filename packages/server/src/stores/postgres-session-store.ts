import { Pool } from 'pg';
import type { SessionRecord, SessionStore } from '../sessions.js';

export class PostgresSessionStore implements SessionStore {
  readonly backendName = 'postgres';

  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS agent_sessions (
        session_id TEXT PRIMARY KEY,
        record JSONB NOT NULL
      )`
    );
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM agent_sessions'
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async create(record: SessionRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO agent_sessions (session_id, record) VALUES ($1, $2::jsonb)',
      [record.sessionId, JSON.stringify(record)]
    );
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<{ record: SessionRecord }>(
      'SELECT record FROM agent_sessions WHERE session_id = $1',
      [sessionId]
    );
    return result.rows[0]?.record ?? null;
  }

  async update(record: SessionRecord): Promise<void> {
    await this.pool.query(
      'UPDATE agent_sessions SET record = $2::jsonb WHERE session_id = $1',
      [record.sessionId, JSON.stringify(record)]
    );
  }

  async delete(sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM agent_sessions WHERE session_id = $1',
      [sessionId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(): Promise<SessionRecord[]> {
    const result = await this.pool.query<{ record: SessionRecord }>(
      'SELECT record FROM agent_sessions'
    );
    return result.rows.map(row => row.record);
  }
}
