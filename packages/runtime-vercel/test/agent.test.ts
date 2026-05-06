import { describe, it, expect } from 'vitest';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import {
  compileSource,
  createAgent,
  type AgentStreamPart,
  type GenerateTextFn,
} from '../src/index.js';

const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "OrderBot"
    default_agent_user: "bot@example.com"

variables:
    status: mutable string = ""
        description: "Order status"

start_agent tracker:
    description: "Look up order"

    actions:
        Lookup:
            description: "Look up order"
            inputs:
                order_number: string
                    is_required: True
            outputs:
                status: string
            target: "fn://lookup"

    reasoning:
        instructions: ->
            | Look up the order.
        actions:
            lookup: @actions.Lookup
                with order_number=...
                set @variables.status = @outputs.status
`;

/** Mock generateText: turn 1 calls the tool, turn 2 emits text. */
function makeMockLlm() {
  let step = 0;
  const generateText: GenerateTextFn = async () => {
    step++;
    if (step === 1) {
      return {
        text: '',
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'lookup',
            args: { order_number: 'ORD-42' },
          },
        ],
        finishReason: 'tool-calls',
      };
    }
    return { text: 'shipped.', toolCalls: [], finishReason: 'stop' };
  };
  return generateText;
}

function makeAgent() {
  const { output, diagnostics } = compileSource(SRC);
  expect(
    diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    )
  ).toEqual([]);

  const fn = new FnAdapter();
  fn.register('lookup', () => ({ status: 'shipped' }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  return createAgent({
    doc: output,
    llm: {
      model: { modelId: 'mock', provider: 'mock' },
      generateText: makeMockLlm(),
    },
    tools,
  });
}

describe('createAgent — run()', () => {
  it('returns an AgentRunResult and fires onStepFinish + onFinish', async () => {
    const agent = makeAgent();
    const steps: string[] = [];
    let finishPayload: unknown = null;

    const result = await agent.run('where is my order?', {
      onStepFinish: step => {
        steps.push(step.node);
      },
      onFinish: r => {
        finishPayload = r;
      },
    });

    expect(result.assistantText).toBe('shipped.');
    expect(result.finalNode).toBe('tracker');
    expect(agent.state.get('status')).toBe('shipped');
    expect(steps).toEqual(['tracker']);
    expect(finishPayload).toEqual(result);
  });
});

describe('createAgent — stream()', () => {
  it('emits typed stream parts through fullStream and resolves result', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    const parts: AgentStreamPart[] = [];
    for await (const part of stream.fullStream) parts.push(part);

    const types = parts.map(p => p.type);
    expect(types).toContain('start-step');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('state-change');
    expect(types).toContain('text-delta');
    expect(types[types.length - 1]).toBe('finish');

    const toolCall = parts.find(p => p.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolName: 'fn://lookup',
      args: { order_number: 'ORD-42' },
    });

    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
    expect(final.finalNode).toBe('tracker');
  });

  it('textStream yields just the text deltas', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    const chunks: string[] = [];
    for await (const chunk of stream.textStream) chunks.push(chunk);

    expect(chunks.join('')).toBe('shipped.');
    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
  });
});
