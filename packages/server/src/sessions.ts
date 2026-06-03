import { randomUUID } from 'node:crypto';
import type { Checkpoint } from '@agentscript/runtime';
import type { AgentScriptAgent } from '@agentscript/runtime-vercel';
import { AgentRegistry } from './agents.js';

export interface SessionView {
  sessionId: string;
  agentId: string;
  createdAt: string;
  lastActiveAt: string;
  busy: boolean;
}

export interface SessionFeedback {
  feedback: string;
  comment?: string;
}

export interface SessionRecord {
  sessionId: string;
  agentId: string;
  createdAt: string;
  lastActiveAt: string;
  busy: boolean;
  feedbackByMessageId: Record<string, SessionFeedback>;
  /**
   * Optional checkpoint of the agent runtime. Persisted between turns so the
   * session can be rehydrated after a server restart when the store backend
   * is durable (fs / postgres).
   */
  checkpoint?: Checkpoint;
}

interface RuntimeSessionState {
  agent: AgentScriptAgent;
  abortController?: AbortController;
}

export interface SessionServiceOptions {
  sessionTtlMs: number;
  maxSessions: number;
  store?: SessionStore;
}

export interface ActiveTurn {
  session: SessionView;
  agent: AgentScriptAgent;
  signal: AbortSignal;
  done: () => void;
}

export interface SessionStore {
  readonly backendName: string;
  count(): Promise<number>;
  create(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  update(record: SessionRecord): Promise<void>;
  delete(sessionId: string): Promise<boolean>;
  list(): Promise<SessionRecord[]>;
}

export class InMemorySessionStore implements SessionStore {
  readonly backendName = 'in_memory';
  private readonly sessions = new Map<string, SessionRecord>();

  async count(): Promise<number> {
    return this.sessions.size;
  }

  async create(record: SessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, structuredClone(record));
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const record = this.sessions.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async update(record: SessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, structuredClone(record));
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async list(): Promise<SessionRecord[]> {
    return [...this.sessions.values()].map(record => structuredClone(record));
  }
}

export class SessionService {
  readonly backendName: string;
  private readonly store: SessionStore;
  private readonly runtimeSessions = new Map<string, RuntimeSessionState>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly agents: AgentRegistry,
    private readonly options: SessionServiceOptions
  ) {
    this.store = options.store ?? new InMemorySessionStore();
    this.backendName = this.store.backendName;
    const intervalMs = Math.max(15_000, Math.floor(options.sessionTtlMs / 2));
    this.sweepTimer = setInterval(() => {
      void this.evictExpired();
    }, intervalMs);
    this.sweepTimer.unref();
  }

  stop(): void {
    clearInterval(this.sweepTimer);
  }

  async create(
    agentId: string,
    context?: Record<string, unknown>
  ): Promise<SessionView> {
    await this.evictExpired();
    if ((await this.store.count()) >= this.options.maxSessions) {
      throw new Error('Session limit reached');
    }
    if (!this.agents.hasAgent(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const sessionId = randomUUID();
    const agent = this.agents.createAgent(agentId, context);
    const nowIso = new Date().toISOString();
    const record: SessionRecord = {
      sessionId,
      agentId,
      createdAt: nowIso,
      lastActiveAt: nowIso,
      busy: false,
      feedbackByMessageId: {},
    };

    await this.store.create(record);
    this.runtimeSessions.set(sessionId, { agent });
    return toView(record);
  }

  async get(sessionId: string): Promise<SessionView | null> {
    const record = await this.store.get(sessionId);
    return record ? toView(record) : null;
  }

  async getEntry(sessionId: string): Promise<SessionView | null> {
    return await this.get(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    this.runtimeSessions.delete(sessionId);
    return await this.store.delete(sessionId);
  }

  async recordFeedback(
    sessionId: string,
    messageId: string,
    feedback: string,
    comment?: string
  ): Promise<void> {
    const record = await this.store.get(sessionId);
    if (!record) {
      throw new Error('Session not found');
    }
    record.feedbackByMessageId[messageId] = { feedback, comment };
    record.lastActiveAt = new Date().toISOString();
    await this.store.update(record);
  }

  async beginTurn(sessionId: string): Promise<ActiveTurn> {
    const record = await this.store.get(sessionId);
    if (!record) {
      throw new Error('Session not found');
    }
    if (record.busy) {
      throw new Error('Session is busy');
    }

    let runtime = this.runtimeSessions.get(sessionId);
    if (!runtime) {
      // Rehydrate from a durable store after a server restart. If the record
      // has no checkpoint (e.g. it was created in-memory and persisted
      // mid-flight) fall through to a fresh agent — better than throwing.
      const agent = record.checkpoint
        ? this.agents.restoreAgent(record.agentId, record.checkpoint)
        : this.agents.createAgent(record.agentId);
      runtime = { agent };
      this.runtimeSessions.set(sessionId, runtime);
    }

    record.busy = true;
    record.lastActiveAt = new Date().toISOString();
    await this.store.update(record);
    const abortController = new AbortController();
    runtime.abortController = abortController;
    const runtimeRef = runtime;

    return {
      session: toView(record),
      agent: runtime.agent,
      signal: abortController.signal,
      done: () => {
        void (async () => {
          const latest = await this.store.get(sessionId);
          if (!latest) return;
          latest.busy = false;
          latest.lastActiveAt = new Date().toISOString();
          try {
            latest.checkpoint = runtimeRef.agent.checkpoint();
          } catch {
            // Mid-turn checkpoint isn't valid; skip persisting it. Other
            // record fields still get flushed.
          }
          await this.store.update(latest);
        })();
        runtimeRef.abortController = undefined;
      },
    };
  }

  async cancel(sessionId: string): Promise<boolean> {
    const runtime = this.runtimeSessions.get(sessionId);
    if (!runtime?.abortController) {
      return false;
    }
    runtime.abortController.abort('cancelled');
    return true;
  }

  private async evictExpired(): Promise<void> {
    const nowMs = Date.now();
    for (const record of await this.store.list()) {
      if (record.busy) continue;
      const lastActiveMs = Date.parse(record.lastActiveAt);
      if (nowMs - lastActiveMs > this.options.sessionTtlMs) {
        this.runtimeSessions.delete(record.sessionId);
        await this.store.delete(record.sessionId);
      }
    }
  }
}

function toView(session: SessionRecord): SessionView {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    busy: session.busy,
  };
}
