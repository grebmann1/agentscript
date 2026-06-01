import { describe, expect, it } from 'vitest';
import { RuntimePolicy } from '../src/runtime-policy.js';

describe('RuntimePolicy', () => {
  it('opens circuit after configured failures', async () => {
    const policy = new RuntimePolicy({
      turnTimeoutMs: 1000,
      llmCircuitFailures: 1,
      llmCircuitOpenMs: 10000,
    });
    const agent = {
      run: async () => {
        throw new Error('llm failed');
      },
    };

    await expect(policy.run(agent as never, 'hi')).rejects.toThrow(
      'llm failed'
    );
    expect(policy.canExecute()).toBe(false);
  });
});
