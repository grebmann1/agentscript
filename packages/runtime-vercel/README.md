# @agentscript/runtime-vercel

Vercel AI SDK adapter for [`@agentscript/runtime`](../runtime/). Wraps `generateText` as an `LlmDriver` so the runtime can drive any SDK-supported provider (Anthropic, OpenAI, Google, …) while keeping tool dispatch and state management inside the runtime.

## Install

```bash
pnpm add @agentscript/runtime-vercel @agentscript/runtime ai @ai-sdk/anthropic
```

`ai` is a peer dependency — bring the version you use. `compileSource` is
re-exported from this package so you don't need a separate dependency on
`@agentscript/agentforce`.

## Usage

```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

const { output } = compileSource(agentScriptSource);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_id }) => ({ status: 'shipped' }));
const tools = new ToolRegistry();
tools.register('fn', fn);

const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-sonnet-4-6'), generateText },
  tools,
});

// Promise-style with lifecycle callbacks.
const { assistantText } = await agent.run('Where is my order?', {
  onStepFinish: step => console.log('step done:', step.node),
  onFinish: result => console.log('turn done:', result.finalNode),
});
```

### Streaming

`agent.stream()` returns Vercel-style `fullStream` / `textStream` iterables:

```typescript
const stream = agent.stream('Where is my order?');

for await (const part of stream.fullStream) {
  switch (part.type) {
    case 'text-delta':     process.stdout.write(part.text); break;
    case 'tool-call':      console.log('→', part.toolName, part.args); break;
    case 'tool-result':    console.log('←', part.toolName, part.result); break;
    case 'state-change':   console.log('state', part.name, '=', part.after); break;
    case 'start-step':     console.log('enter node', part.node); break;
    case 'finish-step':    console.log('exit node', part.node, '→', part.to); break;
    case 'finish':         console.log('done', part.finalNode); break;
    case 'error':          console.error(part.error); break;
  }
}
const { assistantText } = await stream.result;
```

Or for text-only streaming:

```typescript
for await (const chunk of stream.textStream) process.stdout.write(chunk);
```

### Stream part types

| `type`          | Payload                                   | Analog in `ai` `fullStream` |
| --------------- | ----------------------------------------- | --------------------------- |
| `start-step`    | `{ node }`                                | `start-step`                |
| `finish-step`   | `{ node, to? }`                           | `finish-step`               |
| `text-delta`    | `{ text }`                                | `text-delta`                |
| `tool-call`     | `{ toolName, args }`                      | `tool-call`                 |
| `tool-result`   | `{ toolName, result }`                    | `tool-result`               |
| `tool-error`    | `{ toolName, error }`                     | `tool-error`                |
| `state-change`  | `{ name, before, after }` *(AgentScript)* | —                           |
| `finish`        | `{ finalNode, assistantText }`            | `finish`                    |
| `error`         | `{ error }`                               | `error`                     |

The adapter configures AI SDK tools with schema only (no `execute`) — tool calls returned by the model are forwarded back to the runtime, which dispatches through its own adapter registry and applies `state_updates`.

### Low-level

If you need to plug directly into `@agentscript/runtime`, `VercelAiSdkDriver` is exported too — `createAgent` is just a thin wrapper over it.

## License

MIT
