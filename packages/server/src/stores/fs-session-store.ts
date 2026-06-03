import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { SessionRecord, SessionStore } from '../sessions.js';

const FILE_SUFFIX = '.json';
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

export class FsSessionStore implements SessionStore {
  readonly backendName = 'fs';
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async count(): Promise<number> {
    const files = await this.listFiles();
    return files.length;
  }

  async create(record: SessionRecord): Promise<void> {
    await this.write(record);
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    if (!SESSION_ID_RE.test(sessionId)) return null;
    try {
      const raw = await readFile(this.pathFor(sessionId), 'utf8');
      return JSON.parse(raw) as SessionRecord;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async update(record: SessionRecord): Promise<void> {
    await this.write(record);
  }

  async delete(sessionId: string): Promise<boolean> {
    if (!SESSION_ID_RE.test(sessionId)) return false;
    try {
      await unlink(this.pathFor(sessionId));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async list(): Promise<SessionRecord[]> {
    const files = await this.listFiles();
    const records: SessionRecord[] = [];
    for (const file of files) {
      try {
        const raw = await readFile(join(this.dir, file), 'utf8');
        records.push(JSON.parse(raw) as SessionRecord);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return records;
  }

  private async listFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries.filter(name => name.endsWith(FILE_SUFFIX));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private pathFor(sessionId: string): string {
    return join(this.dir, `${sessionId}${FILE_SUFFIX}`);
  }

  private async write(record: SessionRecord): Promise<void> {
    if (!SESSION_ID_RE.test(record.sessionId)) {
      throw new Error(`Invalid sessionId: ${record.sessionId}`);
    }
    await writeFile(
      this.pathFor(record.sessionId),
      JSON.stringify(record),
      'utf8'
    );
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  );
}
