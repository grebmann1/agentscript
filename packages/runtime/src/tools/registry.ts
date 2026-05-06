/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Sentinel target used by the compiler for state-only side effects. */
export const STATE_UPDATE_TARGET = '__state_update_action__';

export interface ToolAdapterInvocation {
  /** Fully-qualified target as written in the script (e.g. "flow://Foo", "fn://bar"). */
  target: string;
  /** Resolved arguments (bound_inputs merged with LLM-provided args). */
  args: Record<string, unknown>;
}

export interface ToolAdapter {
  invoke(i: ToolAdapterInvocation): Promise<Record<string, unknown>>;
}

/**
 * Registry keyed by URI scheme (`fn`, `http`, `https`, `mcp`, ...). The
 * `__state_update_action__` sentinel never hits an adapter — the runtime
 * applies state updates directly.
 */
export class ToolRegistry {
  private adapters = new Map<string, ToolAdapter>();

  register(scheme: string, adapter: ToolAdapter): void {
    this.adapters.set(scheme, adapter);
  }

  async invoke(
    target: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (target === STATE_UPDATE_TARGET) {
      return {};
    }
    const scheme = target.includes('://')
      ? target.slice(0, target.indexOf('://'))
      : null;
    if (!scheme) {
      throw new Error(
        `Tool target "${target}" has no scheme (expected "scheme://name")`
      );
    }
    const adapter = this.adapters.get(scheme);
    if (!adapter) {
      throw new Error(`No tool adapter registered for scheme "${scheme}://"`);
    }
    const result = await adapter.invoke({ target, args });
    return result ?? {};
  }
}
