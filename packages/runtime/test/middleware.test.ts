/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { Middleware } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const TOOL_SRC = `
system:
    instructions: "You are a support bot."

config:
    agent_name: "TestBot"
    default_agent_user: "bot@example.com"

variables:
    result_value: mutable string = ""
        description: "Stored result"

start_agent main:
    description: "Main agent"

    actions:
        Do_Something:
            description: "Does something"
            inputs:
                input: string
                    description: "Input value"
                    is_required: True
            outputs:
                output: string
                    description: "Output value"
            target: "fn://do_something"

    reasoning:
        instructions: ->
            | Help the user.
        actions:
            do_it: @actions.Do_Something
                set @variables.result_value = @outputs.output
`;

describe('Middleware', () => {
  function compileToolSrc() {
    const { output, diagnostics } = compileSource(TOOL_SRC);
    const errors = diagnostics.filter(
      d =>
        d.severity === 1 &&
        d.code !== 'invalid-action-target' &&
        d.code !== 'action-missing-input'
    );
    expect(errors).toEqual([]);
    return output;
  }

  it('beforeToolCall abort blocks tool invocation', async () => {
    const output = compileToolSrc();

    let adapterCalled = false;
    const fn = new FnAdapter();
    fn.register('do_something', () => {
      adapterCalled = true;
      return { output: 'real' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'block-tool',
      beforeToolCall(_ctx) {
        return { abort: { result: { output: 'blocked' } } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(adapterCalled).toBe(false);
    expect(result.assistantText).toBe('Done.');
  });

  it('afterToolCall transforms result used by state_updates', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'original' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'transform-result',
      afterToolCall(_ctx) {
        return { result: { output: 'transformed' } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('test');

    expect(runtime.state.get('result_value')).toBe('transformed');
  });

  it('beforeLlmStep modifies system prompt', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'modify-system',
      beforeLlmStep(_ctx) {
        return { system: 'CUSTOM SYSTEM PROMPT' };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('test');

    expect(llm.calls[0].system).toBe('CUSTOM SYSTEM PROMPT');
  });

  it('afterLlmStep modifies text in returned assistantText', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'modify-text',
      afterLlmStep(_ctx) {
        return { text: 'REPLACED TEXT' };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Original text.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(result.assistantText).toBe('REPLACED TEXT');
  });

  it('onError suppresses with fallback result', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => {
      throw new Error('adapter exploded');
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'error-handler',
      onError(_ctx) {
        return { suppress: true, fallbackResult: { output: 'fallback' } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    // The turn should succeed and state_updates should use the fallback
    expect(result.assistantText).toBe('Done.');
    expect(runtime.state.get('result_value')).toBe('fallback');
  });

  it('respects priority ordering', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const order: string[] = [];

    const mwA: Middleware = {
      name: 'mw-a',
      priority: 200,
      beforeLlmStep() {
        order.push('A');
        return undefined;
      },
    };

    const mwB: Middleware = {
      name: 'mw-b',
      priority: 50,
      beforeLlmStep() {
        order.push('B');
        return undefined;
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [mwA, mwB],
    });
    await runtime.turn('test');

    // mw-b (priority 50) should run before mw-a (priority 200)
    expect(order).toEqual(['B', 'A']);
  });

  it('failOpen catches middleware errors and continues', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'crashy',
      failOpen: true,
      beforeLlmStep() {
        throw new Error('middleware crashed');
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    // The turn should succeed despite the middleware crash
    expect(result.assistantText).toBe('Hello.');
  });
});
