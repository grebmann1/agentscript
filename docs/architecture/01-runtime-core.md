# Runtime Core Architecture

## 1. Overview

The AgentScript JS Runtime (`@agentscript/runtime`) is the execution engine that drives compiled AgentScript agents. It takes the intermediate representation (IR) produced by `@agentscript/compiler`, loads it into an in-memory graph, and orchestrates multi-turn conversations between a user, an LLM, and external tools.

Its responsibilities:

- **Graph execution** -- navigate a directed graph of subagent nodes, each with its own system prompt, tool set, and lifecycle hooks.
- **ReAct loop** -- implement a Reasoning + Acting loop where the LLM reasons about user input, invokes tools, observes results, and produces a final response.
- **State management** -- maintain typed, observable state variables that govern agent behavior and persist across turns.
- **Expression evaluation** -- evaluate guard expressions (`available when`, `enabled`) and value bindings at runtime.
- **Tool dispatch** -- route tool invocations through a pluggable adapter system supporting multiple protocols (functions, HTTP, MCP, mocks).
- **Event streaming** -- emit a structured event stream that hosts can observe for logging, UI updates, and debugging.

```
+------------------+       +------------------+       +-----------------+
|  Compiler IR     | ----> |   Graph Loader   | ----> |  LoadedGraph    |
| (AgentDSLAuthor) |       |   (load.ts)      |       | nodes, state,   |
+------------------+       +------------------+       | initialNode     |
                                                      +-----------------+
                                                              |
                                                              v
+---------+    +------------------+    +-----------+    +------------+
|  User   | -> |  Turn Controller | -> | LLM Driver| -> | LLM (ext.) |
| message |    |  (runtime.ts)    |    | (types.ts)|    |            |
+---------+    +------------------+    +-----------+    +------------+
                      |       ^
                      v       |
               +--------------+-----+
               | Tool Registry      |
               | fn:// http:// ...  |
               +--------------------+
```

---

## 2. Turn Controller

The `Runtime` class in `packages/runtime/src/turn/runtime.ts` is the heart of the system. Each call to `runtime.turn(userInput)` drives one complete user turn through the ReAct loop.

### 2.1 Lifecycle Phases

A turn progresses through clearly-defined phases within a node:

```
turn(userInput)
  |
  +-- [middleware: beforeTurn]
  |
  +-- outer loop (one iteration per node entry)
  |     |
  |     +-- 1. before_reasoning  (hook steps, may handoff)
  |     |
  |     +-- 2. reasoning loop:
  |     |     |
  |     |     +-- before_reasoning_iteration (per-LLM-call hook)
  |     |     +-- build system prompt + filter tools by guards
  |     |     +-- [middleware: beforeLlmStep]
  |     |     +-- LLM step (with guardrails + retry)
  |     |     +-- [middleware: afterLlmStep]
  |     |     |
  |     |     +-- if no tool calls --> break (LLM is done)
  |     |     +-- if tool calls:
  |     |     |     dispatch each tool call (sequential or parallel)
  |     |     |     push tool_result messages to history
  |     |     |     check for end_session / escalation
  |     |     +-- after_all_tool_calls (hook steps, may handoff)
  |     |     +-- loop back to LLM
  |     |
  |     +-- 3. after_reasoning  (hook steps, may handoff)
  |     |
  |     +-- if handoff: swap currentNode, continue outer loop
  |     +-- else: break (turn ends on this node)
  |
  +-- [middleware: afterTurn]
  +-- return TurnResult { assistantText, finalNode, events, parsed? }
```

### 2.2 Handoff Mechanics

A handoff occurs when a lifecycle hook (before_reasoning, after_all_tool_calls, or after_reasoning) executes a `handoff` step whose `enabled` guard passes. The runtime sets `currentNode` to the handoff target and re-enters the outer loop on the new node.

A `maxStepsPerTurn` guard (default: 8) prevents infinite handoff chains.

### 2.3 Abort / Cancellation

The runtime checks an `AbortSignal` at five checkpoint locations (CP-1 through CP-5):

1. Before committing to the turn
2. At the top of the outer loop
3. At the top of each reasoning iteration
4. Before each tool dispatch
5. After each streamed LLM event

When aborted, an `AbortError` is thrown and the `abort` event is emitted.

### 2.4 Tool Call Dispatch

When the LLM emits tool calls, the runtime:

1. Looks up the tool definition by `name` (matched from the node's tool slots).
2. Evaluates `bound_inputs` against the current scope (compiler-declared arguments).
3. Merges bound args with LLM-provided arguments (LLM args take precedence for overlap).
4. Invokes the tool through the `ToolRegistry`, or handles sentinels (`__state_update_action__`, `__end_session_action__`, `delegate://`).
5. Applies `state_updates` referencing `result.*` from the tool output.
6. Pushes a `tool` message into the conversation history.

### 2.5 Parallel Tool Dispatch

When multiple tool calls arrive in a single LLM turn and the `parallel` strategy allows it, the runtime dispatches them concurrently via `Promise.allSettled`. Results are applied to state and history in deterministic (declaration) order.

Parallel dispatch is disabled for state-update sentinels, end-session actions, delegations, and any tools listed in `sequentialTools`.

---

## 3. State Management

**File:** `packages/runtime/src/state/store.ts`

The `StateStore` is a typed key-value store backed by a `Map<string, unknown>`.

### 3.1 Variable Specifications

Each variable is described by a `StateVarSpec`:

```typescript
interface StateVarSpec {
  name: string;
  dataType: 'boolean' | 'number' | 'string' | 'object' | 'date' | 'timestamp' | 'currency' | 'id';
  isList: boolean;
  default?: unknown;
  visibility: 'Internal' | 'Context';
}
```

### 3.2 Visibility Rules

| Visibility | Writeable? | Source |
|------------|-----------|--------|
| `Internal` | Yes | Initialized from defaults; mutated by steps and tool results. |
| `Context`  | No  | Supplied by the host at construction (`opts.context`). Attempting to write throws. |

### 3.3 Initialization Order

1. The `loadGraph` function extracts `StateVarSpec[]` from the compiled IR.
2. The `StateStore` constructor iterates specs. For each variable:
   - If a matching key exists in the `initial` (context) map, use that value.
   - Otherwise, if a default is declared, coerce it (unwrap string literals, parse booleans/numbers).
   - Otherwise, set to `null`.

### 3.4 Change Notifications

When `set()` is called and the new value differs from the old, the store emits a `state-change` event through the injected `EventBus`:

```typescript
{ kind: 'state-change', name: 'loan_amount', before: 5000, after: 10000 }
```

### 3.5 Checkpoint / Restore

`StateStore._restoreValue(name, value)` bypasses visibility checks and is used exclusively during checkpoint restore to reconstitute state from a serialized snapshot.

---

## 4. Expression System

**Files:** `packages/runtime/src/expr/lexer.ts`, `parser.ts`, `eval.ts`, `ast.ts`

The expression system evaluates the guard and binding expressions emitted by the compiler. It implements a compact Pratt-style recursive-descent parser.

### 4.1 AST

```typescript
type ExprNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'ref'; path: string[] }         // e.g. state.x -> ['state','x']
  | { kind: 'unary'; op: 'not' | '-'; arg: ExprNode }
  | { kind: 'binary'; op: BinOp; left: ExprNode; right: ExprNode }
  | { kind: 'call'; fn: string; args: ExprNode[] };  // reserved for future use
```

### 4.2 Lexer

The tokenizer (`tokenize(input)`) produces a flat `Token[]` array recognizing:

- **Numbers** -- integer and floating-point (`3.14`)
- **Strings** -- single or double-quoted with backslash escaping
- **Identifiers** -- `[A-Za-z_][A-Za-z0-9_]*`
- **Keywords** (treated as `op` tokens) -- `and`, `or`, `not`, `is`, `in`, `True`, `False`, `None`, `true`, `false`, `null`
- **Punctuation** -- `.`, `(`, `)`, `,`
- **Operators** -- `==`, `!=`, `<=`, `>=`, `<`, `>`, `+`, `-`, `*`, `/`, `%`

### 4.3 Parser (Pratt / Recursive-Descent)

The parser implements precedence climbing through chained methods:

```
parseOr        (lowest precedence)
  parseAnd
    parseNot
      parseComparison   (==, !=, <, <=, >, >=, is, is not, in)
        parseAddSub     (+, -)
          parseMulDiv   (*, /, %)
            parseUnary  (unary -)
              parsePrimary  (literals, refs, grouping)
```

The `is not` operator is handled by consuming two consecutive tokens (`is` followed by `not`).

### 4.4 Evaluator

The evaluator walks the AST recursively. Key behaviors:

- **References** resolve through an `EvalScope` interface: `scope.resolve('state')` returns a Proxy over the `StateStore`; `scope.resolve('result')` returns the current tool result.
- **Logical operators** (`and`, `or`) short-circuit.
- **Truthiness** follows Python-like semantics: `null`/`undefined` are falsy, empty strings and arrays are falsy, zero is falsy.
- **Equality** (`==`) uses loose comparison for numbers and strict identity for other types.
- **`in` operator** works with arrays (`.includes()`) and strings (substring check).

### 4.5 Caching

Parsed ASTs are cached in a module-level `Map<string, ExprNode>` so repeated evaluations of the same expression (common in per-turn guard checks) skip parsing.

### 4.6 Guard Evaluation

The `isEnabled(enabled, scope)` function is the entry point for `available when` guards:

```typescript
function isEnabled(enabled: unknown, scope: EvalScope): boolean {
  if (enabled === undefined || enabled === null || enabled === '') return true;
  if (typeof enabled === 'boolean') return enabled;
  if (typeof enabled === 'string') return Boolean(evalExpr(enabled.trim(), scope));
  return Boolean(enabled);
}
```

Missing guards default to `true` (tool is always visible).

---

## 5. Template Rendering

**File:** `packages/runtime/src/template/render.ts`

Templates are used in system prompts and focus prompts to interpolate state values at runtime.

### 5.1 Syntax

```
Hello, {{state.customer_name}}. Your balance is {{state.balance}}.
```

The compiler may prefix template strings with `template::` to disambiguate them from raw expressions. The renderer strips this prefix before processing.

### 5.2 Algorithm

1. Scan for `{{` markers.
2. Extract the expression between `{{` and `}}`.
3. Evaluate the expression against the current `EvalScope` (which provides `state.*`).
4. Format the result: strings pass through, numbers/booleans are stringified, objects are JSON-serialized, `null`/`undefined` become empty strings.
5. If evaluation throws, the raw `{{ ... }}` placeholder is preserved in the output.

### 5.3 Usage in the Turn Controller

```typescript
private buildSystemPrompt(node: SubAgentNode): string {
  const scope = makeScope(this.state);
  const pieces: string[] = [];
  if (node.instructions) pieces.push(node.instructions);
  if (node.focus_prompt) pieces.push(renderTemplate(node.focus_prompt, scope));
  return pieces.filter(Boolean).join('\n\n');
}
```

---

## 6. Step Interpreter

**File:** `packages/runtime/src/steps/run-steps.ts`

Steps are the imperative operations that execute in lifecycle hooks (before_reasoning, after_all_tool_calls, after_reasoning) and tool-call post-processing.

### 6.1 Step Types

```typescript
interface ActionStep {
  type?: 'action';
  target: string;            // URI or developer_name or sentinel
  enabled?: unknown;         // guard expression
  bound_inputs?: Record<string, unknown>;
  state_updates?: Array<Record<string, unknown>>;
}

interface HandoffStep {
  type: 'handoff';
  target: string;            // node developer_name to transition to
  enabled?: unknown;
  state_updates?: Array<Record<string, unknown>>;
}
```

### 6.2 Execution Semantics

`runSteps(steps, opts)` iterates sequentially. For each step:

1. **Guard check** -- evaluate `enabled`; if false, skip.
2. **Handoff** -- apply `state_updates`, emit `node-exit`, return `{ handoffTo: target }`. Short-circuits remaining steps.
3. **State-update sentinel** (`__state_update_action__`) -- apply `state_updates` inline (no adapter call). This implements `set` and `if/set` patterns.
4. **Action** -- resolve the target URI, evaluate `bound_inputs`, invoke the tool through the registry, then apply `state_updates` with the tool result in scope (`result.*`).

### 6.3 Value Resolution (`evalBoundValue`)

The compiler emits bound values as strings that can be:

| Shape | Example | Resolution |
|-------|---------|-----------|
| Template | `template::Hello {{state.name}}` | Rendered via `renderTemplate` |
| Quoted literal | `"default_value"` | Unwrapped to `default_value` |
| Expression | `state.x + 1` | Evaluated via `evalExpr` |
| Empty string | `""` | Returns `""` |
| Non-string | `42`, `true` | Pass-through |

### 6.4 Scope Construction

```typescript
function makeScope(state: StateStore, toolResult?: Record<string, unknown>): EvalScope {
  return {
    resolve(name: string): unknown {
      if (name === 'state') return proxyState(state);  // Proxy with get trap
      if (name === 'result') return toolResult ?? {};
      return undefined;
    },
  };
}
```

The `state` namespace uses a `Proxy` so that `state.x` reads are intercepted and delegated to `StateStore.get('x')`.

---

## 7. Graph Loader

**File:** `packages/runtime/src/graph/load.ts`

The graph loader transforms the compiled `AgentDSLAuthoring` document into the runtime's internal `LoadedGraph` structure.

### 7.1 LoadedGraph Interface

```typescript
interface LoadedGraph {
  initialNode: string;                  // Entry-point node developer_name
  nodes: Map<string, SubAgentNode>;     // All subagent nodes, keyed by name
  stateVars: StateVarSpec[];            // Typed variable declarations
}
```

### 7.2 Loading Process

1. Extract the first `AgentVersion` from `doc.agent_version` (array or single).
2. Iterate `version.nodes`, collecting only nodes of `type === 'subagent'` into the map.
3. Validate that `version.initial_node` exists in the collected map.
4. Map `version.state_variables` to `StateVarSpec[]`, normalizing `data_type`, `is_list`, `default`, and `visibility`.

### 7.3 Action URI Resolution

Each `SubAgentNode` carries `action_definitions` that describe how tool-slot targets map to invocable URIs. The helper `buildActionUriMap(node)` produces:

```
developer_name  ->  "{invocation_target_type}://{invocation_target_name}"
```

For example: `"search_flights" -> "fn://search_flights"` or `"create_booking" -> "http://api.travel.com/book"`.

---

## 8. Tool Registry

**Files:** `packages/runtime/src/tools/registry.ts`, `fn-adapter.ts`, `http-adapter.ts`, `mock-adapter.ts`

### 8.1 Architecture

The `ToolRegistry` dispatches tool invocations by URI scheme. Each scheme has one registered `ToolAdapter`.

```
               ToolRegistry
              /      |       \
         fn://    http://    mock://
           |         |          |
      FnAdapter  HttpAdapter  MockToolAdapter
```

### 8.2 ToolAdapter Interface

```typescript
interface ToolAdapterInvocation {
  target: string;                       // Full URI (e.g. "fn://search")
  args: Record<string, unknown>;        // Merged bound + LLM args
  signal?: AbortSignal;                 // Cooperative cancellation
}

interface ToolAdapter {
  invoke(i: ToolAdapterInvocation): Promise<Record<string, unknown>>;
}
```

Every adapter returns a flat `Record<string, unknown>` -- this is what `state_updates` can reference via `result.fieldName`.

### 8.3 Built-in Adapters

#### FnAdapter (`fn://`)

Maps URI path to a locally registered JavaScript function:

```typescript
const fn = new FnAdapter();
fn.register('search_flights', async (args) => {
  const flights = await db.query(args.origin, args.destination);
  return { flights };
});
tools.register('fn', fn);
```

#### HttpAdapter (`http://`, `https://`)

POSTs arguments as JSON to the target URL and expects a JSON response:

```typescript
const http = new HttpAdapter({
  headers: { 'Authorization': 'Bearer ...' },
  method: 'POST',
});
tools.register('http', http);
tools.register('https', http);
```

Non-JSON responses are wrapped as `{ body: "..." }`.

#### MockToolAdapter

Returns pre-declared responses for specific target URIs. Designed for testing and playground environments:

```typescript
const mocks = new Map([
  ['fn://search_flights', { flights: [{ id: 'FL1', price: 299 }] }],
]);
const mock = new MockToolAdapter(mocks, realAdapter);
tools.register('fn', mock);  // intercepts fn:// calls
```

Falls through to an optional fallback adapter for unmatched targets.

### 8.4 Sentinel Targets

Two special targets never reach an adapter:

| Sentinel | Purpose |
|----------|---------|
| `__state_update_action__` | Inline state mutation (the LLM's arguments become the "result") |
| `__end_session_action__` | Signals end of conversation; also applies args as state |

---

## 9. Event System

**File:** `packages/runtime/src/events/types.ts`

### 9.1 EventBus

The `EventBus` is a simple synchronous pub/sub mechanism:

```typescript
class EventBus {
  private listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);  // unsubscribe handle
  }

  emit(event: RuntimeEvent): void {
    for (const l of this.listeners) l(event);
  }
}
```

The `Runtime.on(listener)` method delegates to the bus and returns an unsubscribe function.

### 9.2 Event Types

Events are a discriminated union on the `kind` field:

| Kind | Payload | When |
|------|---------|------|
| `turn-start` | `{ node }` | Turn begins |
| `turn-end` | `{ node }` | Turn completes |
| `node-enter` | `{ node }` | Entering a subagent node |
| `node-exit` | `{ node, to? }` | Exiting a node (handoff) |
| `phase-start` | `{ node, phase }` | Lifecycle phase begins |
| `phase-end` | `{ node, phase }` | Lifecycle phase ends |
| `state-change` | `{ name, before, after }` | Variable mutated |
| `tool-call` | `{ name, args }` | Tool invocation starting |
| `tool-result` | `{ name, result }` | Tool returned successfully |
| `tool-error` | `{ name, error }` | Tool threw |
| `llm-text` | `{ text }` | Streaming text delta from LLM |
| `action-skipped` | `{ name, reason }` | Tool hidden due to guard |
| `tool-limit-reached` | `{ name, limit }` | Per-tool budget exhausted |
| `abort` | `{ reason? }` | Turn was aborted |
| `end-session` | -- | Session terminated |
| `guardrail-pass` | `{ name }` | Guardrail validated successfully |
| `guardrail-fail` | `{ name, error, attempt }` | Guardrail rejected output |
| `guardrail-exhausted` | `{ name, error, attempts }` | Guardrail retries exhausted |
| `delegation-start` | `{ parentNode, childNode, depth }` | Delegation begun |
| `delegation-end` | `{ parentNode, childNode, result }` | Delegation completed |
| `delegation-error` | `{ parentNode, childNode, error }` | Delegation failed |
| `parallel-dispatch-start` | `{ node, toolNames }` | Parallel tool batch starting |
| `parallel-dispatch-end` | `{ node, toolNames }` | Parallel tool batch done |
| `parallel-delegation-start` | `{ parentNode, childNodes }` | Multi-child delegation starting |
| `parallel-delegation-end` | `{ parentNode, childNodes, results }` | Multi-child delegation done |
| `span-start` | `{ traceId, spanId, name, parentSpanId? }` | Tracing span opened |
| `span-end` | `{ traceId, spanId, name, status }` | Tracing span closed |

### 9.3 Subscription Pattern

```typescript
const rt = new Runtime({ doc, llm, tools });

const off = rt.on((event) => {
  if (event.kind === 'llm-text') process.stdout.write(event.text);
  if (event.kind === 'state-change') console.log(`${event.name}: ${event.after}`);
});

await rt.turn('Book me a flight to Paris');
off();  // unsubscribe
```

---

## 10. LLM Driver Interface

**File:** `packages/runtime/src/llm/types.ts`

The `LlmDriver` interface defines the contract that LLM providers must implement to plug into the runtime.

### 10.1 The Contract

```typescript
interface LlmDriver {
  step(input: LlmStepInput): AsyncIterable<StepEvent>;
}
```

A single method that accepts the full context for one reasoning step and returns an async iterable of streaming events.

### 10.2 Input Shape

```typescript
interface LlmStepInput {
  system: string;                      // Rendered system prompt
  messages: Msg[];                     // Full conversation history
  tools: ToolDef[];                    // Available tools (JSON Schema)
  signal?: AbortSignal;                // Cooperative cancellation
  responseFormat?: {                   // Structured output (optional)
    type: 'json_schema';
    json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
  };
}
```

### 10.3 Output Events

The async iterable yields a stream of `StepEvent` values:

```typescript
type StepEvent =
  | { kind: 'text-delta'; text: string }       // Incremental text chunk
  | { kind: 'tool-call'; call: ToolCall }      // Complete tool call
  | { kind: 'finish'; reason: 'stop' | 'tool-calls' | 'length' | 'other' };
```

The runtime collects `text-delta` events into the full response, and `tool-call` events into the dispatch queue. The `finish` event signals the end of the step.

### 10.4 Message Types

```typescript
type Msg = TextMsg | ToolCallMsg | ToolResultMsg;

interface TextMsg     { role: 'system'|'user'|'assistant'; content: string }
interface ToolCallMsg { role: 'assistant'; content: ''; tool_calls: ToolCall[] }
interface ToolResultMsg { role: 'tool'; tool_call_id: string; tool_name: string; content: string }
```

### 10.5 Tool Definition

```typescript
interface ToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;  // JSON Schema for input
}
```

The driver is responsible for adapting `inputSchema` to whatever format its underlying SDK requires (e.g., OpenAI function calling, Anthropic tool use, Vercel AI SDK).

### 10.6 Implementing a Driver

A minimal driver implementation:

```typescript
import type { LlmDriver, LlmStepInput, StepEvent } from '@agentscript/runtime';

class MyLlmDriver implements LlmDriver {
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    const response = await myLlmApi.chat({
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      signal: input.signal,
    });

    if (response.toolCalls?.length) {
      for (const call of response.toolCalls) {
        yield { kind: 'tool-call', call };
      }
      yield { kind: 'finish', reason: 'tool-calls' };
    } else {
      // Stream text chunks
      for await (const chunk of response.textStream) {
        yield { kind: 'text-delta', text: chunk };
      }
      yield { kind: 'finish', reason: 'stop' };
    }
  }
}
```

---

## Appendix: Key Integration Points

### Constructing a Runtime

```typescript
import { Runtime, ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compile } from '@agentscript/compiler';

const doc = compile(agentScriptSource);
const tools = new ToolRegistry();
const fn = new FnAdapter();
fn.register('lookup_customer', async (args) => { /* ... */ });
tools.register('fn', fn);

const rt = new Runtime({
  doc,
  llm: new MyLlmDriver(),
  tools,
  context: { customer_id: '12345' },   // linked (read-only) variables
  maxStepsPerTurn: 12,
});

rt.on((event) => { /* observe */ });
const result = await rt.turn('What is my account balance?');
```

### Checkpoint and Resume

```typescript
// Save state
const checkpoint = rt.checkpoint({ id: 'cp-1', metadata: { user: 'alice' } });
// ... later, or on a different machine:
const restored = Runtime.fromCheckpoint(opts, checkpoint);
const result = await restored.turn('Continue where we left off');
```

### Extending the Tool System

Register a custom scheme adapter:

```typescript
class McpAdapter implements ToolAdapter {
  async invoke({ target, args, signal }: ToolAdapterInvocation) {
    const serverUrl = target.replace('mcp://', 'https://');
    // ... invoke MCP server
    return result;
  }
}
tools.register('mcp', new McpAdapter());
```
