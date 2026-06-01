import type {
  AgentScriptAgent,
  AgentRunResult,
  AgentStream,
} from '@agentscript/runtime-vercel';

export interface RuntimePolicyConfig {
  turnTimeoutMs: number;
  llmCircuitFailures: number;
  llmCircuitOpenMs: number;
}

export class RuntimePolicy {
  private consecutiveFailures = 0;
  private openUntilMs = 0;

  constructor(private readonly config: RuntimePolicyConfig) {}

  canExecute(): boolean {
    return Date.now() >= this.openUntilMs;
  }

  async run(
    agent: AgentScriptAgent,
    input: string,
    signal?: AbortSignal
  ): Promise<AgentRunResult> {
    this.assertCircuitClosed();
    const timeoutSignal = withTimeoutSignal(signal, this.config.turnTimeoutMs);
    try {
      const result = await agent.run(input, { signal: timeoutSignal });
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  stream(
    agent: AgentScriptAgent,
    input: string,
    signal?: AbortSignal
  ): AgentStream {
    this.assertCircuitClosed();
    const timeoutSignal = withTimeoutSignal(signal, this.config.turnTimeoutMs);
    const stream = agent.stream(input, { signal: timeoutSignal });
    void stream.result
      .then(() => this.onSuccess())
      .catch(() => this.onFailure());
    return stream;
  }

  private assertCircuitClosed(): void {
    if (this.canExecute()) return;
    throw new Error('LLM circuit breaker is open');
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntilMs = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.llmCircuitFailures) {
      this.openUntilMs = Date.now() + this.config.llmCircuitOpenMs;
      this.consecutiveFailures = 0;
    }
  }
}

function withTimeoutSignal(
  upstream: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal | undefined {
  if (timeoutMs <= 0 && !upstream) return undefined;
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(new Error('turn timeout reached'));
    }, timeoutMs);
    timeout.unref();
  }
  if (upstream) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstream.addEventListener(
        'abort',
        () => controller.abort(upstream.reason),
        { once: true }
      );
    }
  }
  if (timeout) {
    controller.signal.addEventListener('abort', () => clearTimeout(timeout), {
      once: true,
    });
  }
  return controller.signal;
}
