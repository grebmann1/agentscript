# @agentscript/runtime

A lightweight TypeScript runtime that executes the `AgentDSLAuthoring` IR emitted by `@agentscript/compiler`.

The repo's compiler has always been open; the *runtime* was not. This package is the first open JS executor for AgentScript — enough to run compiled agents in Node, Bun, edge workers, or the browser, outside Salesforce infrastructure.

## Install

```bash
pnpm add @agentscript/runtime @agentscript/agentforce
```

## Usage

```typescript
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '@agentscript/runtime';

const { output } = compileSource(agentScriptSource);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_id }) => ({ status: 'shipped' }));

const tools = new ToolRegistry();
tools.register('fn', fn);

const runtime = new Runtime({ doc: output, llm, tools });
const { assistantText } = await runtime.turn('Where is my order?');
```

`llm` is any value that implements the driver interface below. For the Vercel AI SDK, use [`@agentscript/runtime-vercel`](../runtime-vercel/).

### LLM driver

```typescript
interface LlmDriver {
  step(input: { system: string; messages: Msg[]; tools: ToolDef[] }): AsyncIterable<StepEvent>;
}
```

Ship `text-delta`, `tool-call`, and a final `finish` event per step.

### Tool adapters

Register adapters keyed by URI scheme. Built-ins:

- `fn://` — local JS functions (`FnAdapter`)
- `http(s)://` — POST JSON to a URL (`HttpAdapter`)

Any action target whose scheme is not `__state_update_action__` is routed through the registry. Salesforce-only schemes (`apex://`, `flow://`, `apexRest://`) have no built-in adapter — bring your own or stub them with `FnAdapter`.

## What it runs

- `subagent` / `start_agent` nodes
- Lifecycle hooks: `before_reasoning`, `before_reasoning_iteration`, `after_all_tool_calls`, `after_reasoning`
- `set` / `run` / `with` / `transition` semantics via compiled step IR
- `__state_update_action__` sentinel → direct state mutation, no tool dispatch
- `{{ state.x }}` template interpolation in system and focus prompts
- `mutable` / `linked` (Context) variable enforcement
- Intra-turn subagent handoff

## What it does not run yet

Deferred to follow-up PRs — see `chatbots/module-graph-runtime` (Salesforce-internal) for the parity target.

- `action` / `router` / `external_agent` / `byon` node types (only `subagent` today)
- `on_init` / `on_exit` lifecycle hooks
- `pre_tool_calls` / `post_tool_calls` per-tool hooks
- `end_turn_first` on handoff
- `RequireConfirmation` pause/resume
- Granular per-turn limits (`maxHandoffs`, `maxReasoningIterations`, `maxToolCallsPerNode`)
- Subgraph tools (agent-as-tool nesting)
- MCP adapter (`mcp://`)
- `AbortSignal` cancellation
- OpenTelemetry spans

## Testing

```bash
pnpm --filter @agentscript/runtime test
```

## License

MIT
