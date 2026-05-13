# Advanced Features

This document covers the advanced extensibility mechanisms of the AgentScript JS Runtime. Each feature is designed to be opt-in: you compose only the capabilities your agent needs without paying for complexity you do not use.

---

## 1. Middleware Pipeline

The middleware pipeline provides lifecycle hooks that intercept and transform data flowing through the runtime at every key phase: turn boundaries, tool calls, and LLM steps.

### 1.1 The Middleware Interface

A middleware is a plain object conforming to the `Middleware` interface:

```typescript
import type { Middleware } from '@agentscript/runtime/middleware';

const myMiddleware: Middleware = {
  name: 'my-middleware',     // Required: unique identifier
  priority: 50,              // Optional: lower numbers run first (default: 100)
  failOpen: false,           // Optional: if true, errors in this middleware are swallowed

  async beforeTurn(ctx) { /* ... */ },
  async afterTurn(ctx) { /* ... */ },
  async beforeToolCall(ctx) { /* ... */ },
  async afterToolCall(ctx) { /* ... */ },
  async beforeLlmStep(ctx) { /* ... */ },
  async afterLlmStep(ctx) { /* ... */ },
  async onError(ctx) { /* ... */ },
};
```

All hooks are optional. You implement only the hooks your middleware needs.

### 1.2 Priority Ordering

Middlewares are sorted by `priority` in ascending order when the pipeline is constructed. Lower values execute first:

| Priority Range | Typical Use |
|---|---|
| 0-49 | Security / auth / rate limiting |
| 50-99 | Observability, logging |
| 100 (default) | Business logic transforms |
| 101-200 | Formatting, normalization |

```typescript
const pipeline = new MiddlewarePipeline([
  { name: 'auth-check', priority: 10, beforeTurn(ctx) { /* runs first */ } },
  { name: 'logger', priority: 50, afterTurn(ctx) { /* runs second */ } },
  { name: 'formatter', priority: 150, afterTurn(ctx) { /* runs last */ } },
]);
```

### 1.3 Lifecycle Hooks

#### `beforeTurn(ctx: BeforeTurnContext): BeforeTurnResult | void`

Runs before the turn begins. Receives `userInput`, `node`, and the current `state`.

- **Transform input**: Return `{ userInput: "modified text" }` to rewrite the user message.
- **Short-circuit (abort)**: Return `{ abort: { assistantText: "Sorry, I can't help with that." } }` to skip the entire turn and immediately return the abort message as the assistant response.

```typescript
beforeTurn(ctx) {
  if (ctx.userInput.includes('DROP TABLE')) {
    return { abort: { assistantText: 'This request is not allowed.' } };
  }
}
```

#### `afterTurn(ctx: AfterTurnContext): AfterTurnResult | void`

Runs after the turn completes. Receives `assistantText`, `finalNode`, `state`, and the full list of runtime `events`.

- **Transform output**: Return `{ assistantText: "modified response" }` to rewrite the assistant reply before it reaches the caller.

#### `beforeToolCall(ctx: BeforeToolCallContext): BeforeToolCallResult | void`

Runs before each tool is invoked. Receives `node`, `state`, `target`, `toolName`, `args`, and the raw `toolCall`.

- **Transform args**: Return `{ args: modifiedArgs }` to alter tool input.
- **Skip**: Return `{ skip: true }` to silently skip this tool call without executing it.
- **Abort**: Return `{ abort: { result: { error: "denied" } } }` to short-circuit and provide a synthetic tool result.

```typescript
beforeToolCall(ctx) {
  if (ctx.toolName === 'deleteAccount' && !ctx.state.isAdmin) {
    return { abort: { result: { error: 'Permission denied' } } };
  }
}
```

#### `afterToolCall(ctx: AfterToolCallContext): AfterToolCallResult | void`

Runs after a tool returns. Receives the tool `result` and optionally `error`.

- **Transform result**: Return `{ result: modifiedResult }` to alter the tool output before it is added to the conversation history.

#### `beforeLlmStep(ctx: BeforeLlmStepContext): BeforeLlmStepResult | void`

Runs before each LLM call. Receives `system` prompt, `messages`, and `tools` (the tool definitions array).

- **Modify system prompt**: Return `{ system: "new system prompt" }`.
- **Inject messages**: Return `{ appendMessages: [...] }` to append context messages.
- **Filter tools**: Return `{ tools: filteredToolDefs }` to restrict available tools.
- **Inject guardrails**: Return `{ guardrails: [...] }` to apply guardrails to this LLM step's output.

```typescript
beforeLlmStep(ctx) {
  return {
    system: ctx.system + '\nAlways respond in French.',
    tools: ctx.tools.filter(t => t.name !== 'dangerousTool'),
  };
}
```

#### `afterLlmStep(ctx: AfterLlmStepContext): AfterLlmStepResult | void`

Runs after the LLM returns. Receives `text` and `toolCalls`.

- **Transform text**: Return `{ text: "modified text" }`.
- **Modify tool calls**: Return `{ toolCalls: [...] }` to rewrite, filter, or add tool calls.

#### `onError(ctx: OnErrorContext): OnErrorResult | void`

Runs when an error occurs during the turn. Receives `error`, `phase` (`'tool-call' | 'llm-step' | 'turn'`), and optionally `toolName`/`target`.

- **Suppress**: Return `{ suppress: true }` to swallow the error and continue.
- **Provide fallback**: Return `{ fallbackResult: { ... } }` to substitute a synthetic result (first middleware to provide a fallback wins).

### 1.4 Fail-Open Semantics

When `failOpen: true` is set on a middleware, any exception thrown by that middleware's hooks is caught and silently ignored. The pipeline continues executing subsequent middlewares. This is essential for observability middleware that should never break the happy path.

When `failOpen` is `false` (the default), an exception propagates immediately up to the caller.

### 1.5 Writing Custom Middleware

```typescript
import type { Middleware } from '@agentscript/runtime/middleware';

export function createRateLimitMiddleware(maxPerMinute: number): Middleware {
  const timestamps: number[] = [];

  return {
    name: 'rate-limiter',
    priority: 5,
    failOpen: false,

    beforeTurn(ctx) {
      const now = Date.now();
      // Remove timestamps older than 1 minute
      while (timestamps.length > 0 && now - timestamps[0] > 60_000) {
        timestamps.shift();
      }
      if (timestamps.length >= maxPerMinute) {
        return { abort: { assistantText: 'Rate limit exceeded. Please wait.' } };
      }
      timestamps.push(now);
    },
  };
}
```

---

## 2. Output Guardrails

Guardrails validate and constrain LLM output before it is returned. When validation fails, the runtime automatically retries by feeding the error back to the LLM as corrective context.

### 2.1 The Guardrail Interface

```typescript
interface Guardrail {
  name: string;
  target?: 'text' | 'tool-calls' | 'both';  // What to validate (default varies)
  maxRetries?: number;                         // Retry budget (default: 2)
  feedbackTemplate?: string;                   // Custom retry prompt template
  validate(
    output: GuardrailInput,
    context: GuardrailContext
  ): GuardrailResult | Promise<GuardrailResult>;
}
```

The `GuardrailInput` contains `{ text: string; toolCalls: ToolCall[] }`. The `GuardrailContext` provides `node`, `state`, `attempt`, `maxRetries`, and `messages`.

A `GuardrailResult` returns `{ valid: boolean; reason?: string; errors?: GuardrailError[] }`. Optionally, it can include `transformedText` or `transformedToolCalls` to rewrite the output in-place.

### 2.2 Built-in Validators

#### `jsonSchemaGuardrail`

Validates that the LLM's text output is valid JSON conforming to a JSON Schema:

```typescript
import { jsonSchemaGuardrail } from '@agentscript/runtime/guardrails';

const guardrail = jsonSchemaGuardrail({
  schema: {
    type: 'object',
    required: ['action', 'confidence'],
    properties: {
      action: { type: 'string', enum: ['approve', 'reject', 'escalate'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    additionalProperties: false,
  },
  maxRetries: 3,
});
```

The built-in schema validator supports: `type`, `enum`, `required`, `properties`, `additionalProperties`, `items` (for arrays), `minimum`/`maximum`, `minLength`/`maxLength`, and `pattern`.

#### `regexGuardrail`

Validates output against a regular expression:

```typescript
import { regexGuardrail } from '@agentscript/runtime/guardrails';

// Output MUST match the pattern
const mustContainJson = regexGuardrail({
  pattern: /^\{[\s\S]*\}$/,
  name: 'json-envelope',
});

// Output must NOT match the pattern (invert: true)
const noPII = regexGuardrail({
  pattern: /\b\d{3}-\d{2}-\d{4}\b/,
  invert: true,
  name: 'no-ssn',
});
```

#### `contentPolicyGuardrail`

Validates output against blocklists and requirelists:

```typescript
import { contentPolicyGuardrail } from '@agentscript/runtime/guardrails';

const policy = contentPolicyGuardrail({
  blocklist: ['confidential', /internal[\s-]?use[\s-]?only/i],
  requirelist: ['disclaimer'],
  maxRetries: 2,
});
```

#### `customGuardrail`

Create arbitrary validation logic:

```typescript
import { customGuardrail } from '@agentscript/runtime/guardrails';

// Simple form
const lengthCheck = customGuardrail('max-length', (output) => ({
  valid: output.text.length <= 500,
  reason: output.text.length > 500 ? 'Response exceeds 500 characters' : undefined,
}));

// Object form with full options
const sentimentCheck = customGuardrail({
  name: 'positive-sentiment',
  target: 'text',
  maxRetries: 1,
  feedbackTemplate: 'Your response was too negative. Please rewrite with a positive tone.',
  async validate(output, ctx) {
    const score = await analyzeSentiment(output.text);
    return { valid: score > 0.3, reason: `Sentiment score ${score} below threshold` };
  },
});
```

### 2.3 Composing Guardrails

Use `composeGuardrails` to chain multiple guardrails into a single composite guardrail. Validation runs sequentially and short-circuits on the first failure:

```typescript
import { composeGuardrails, jsonSchemaGuardrail, contentPolicyGuardrail } from '@agentscript/runtime/guardrails';

const combined = composeGuardrails({
  name: 'output-policy',
  guardrails: [
    jsonSchemaGuardrail({ schema: mySchema }),
    contentPolicyGuardrail({ blocklist: ['forbidden-term'] }),
  ],
  maxRetries: 3,
});
```

The composite guardrail respects `target` filtering: if a child guardrail targets `'text'` only, it is skipped when the output contains tool calls (and vice versa).

### 2.4 Retry Loop and Exhaustion Policies

When a guardrail fails, the runtime:

1. Constructs a feedback message from `feedbackTemplate` or the `reason`/`errors` in the result.
2. Appends this feedback to the conversation as a system-injected user message.
3. Calls the LLM again (consuming one retry from the guardrail's `maxRetries` budget).
4. Re-validates the new output.

This loop continues until validation passes or retries are exhausted.

**Exhaustion Policy** (`ExhaustionPolicy`):

| Policy | Behavior |
|---|---|
| `'throw'` | Throws `GuardrailExhaustionError` with the guardrail name, last error message, and total attempts. |
| `'last-response'` | Returns the last LLM response as-is, even though it failed validation. |

```typescript
// GuardrailExhaustionError provides diagnostic context
try {
  const result = await runtime.turn(input);
} catch (e) {
  if (e instanceof GuardrailExhaustionError) {
    console.error(`Guardrail: ${e.guardrailName}`);
    console.error(`Last error: ${e.lastError}`);
    console.error(`Attempts: ${e.attempts}`);
  }
}
```

### 2.5 Integration with the Turn Controller

Guardrails are applied at two levels:

1. **Static configuration**: Guardrails declared in the agent configuration are applied to every LLM step.
2. **Middleware injection**: The `beforeLlmStep` hook can return `{ guardrails: [...] }` to inject guardrails dynamically per-step (e.g., only enforce schema validation for the final response node).

---

## 3. Tracing and Telemetry

The runtime includes a built-in tracing system that produces W3C-compatible spans for every phase of agent execution.

### 3.1 TracingContext

`TracingContext` manages a tree of spans for a single trace using a stack-based model:

```typescript
import { TracingContext, InMemorySpanExporter } from '@agentscript/runtime/tracing';

const exporter = new InMemorySpanExporter();
const tracing = new TracingContext({
  traceId: 'optional-custom-trace-id',  // auto-generated if omitted
  exporter,
});
```

**Key operations:**

```typescript
// Start a span (becomes child of current top-of-stack)
const span = tracing.startSpan('llm-step', { model: 'gpt-4', node: 'greet' });

// Access the currently-active span
const current = tracing.current();

// End the current span (pops from stack, moves to completed buffer)
tracing.endSpan('ok');

// Flush completed spans to the exporter
await tracing.flush();

// Emergency drain: close all open spans with error status
tracing.drainAll('error');
```

### 3.2 Span Structure

Each span carries:

```typescript
interface Span {
  name: string;                           // e.g., 'turn', 'llm-step', 'tool-call:searchDB'
  traceId: string;                        // 32-char hex (W3C trace ID)
  spanId: string;                         // 16-char hex (W3C span ID)
  parentSpanId?: string;                  // Links to parent span
  startTime: number;                      // Unix timestamp (ms)
  endTime?: number;                       // Set on endSpan()
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;    // Arbitrary key-value pairs
  events: SpanEvent[];                    // Timestamped events within the span
}
```

IDs are generated using cryptographically random bytes via `crypto.getRandomValues`, producing W3C-compliant 16-byte trace IDs and 8-byte span IDs.

### 3.3 Span Exporters

#### InMemorySpanExporter

Accumulates spans in memory for testing and inspection:

```typescript
const exporter = new InMemorySpanExporter();
// After runtime execution...
const spans = exporter.getSpans();
exporter.reset(); // Clear accumulated spans
```

#### ConsoleSpanExporter

Logs spans to `console.warn` for debugging:

```typescript
const exporter = new ConsoleSpanExporter();
// Output: [SPAN] llm-step (a3f2...) trace=b1c4... parent=root status=ok duration=1230ms
```

#### OtlpJsonSpanExporter

Exports spans as OTLP JSON over HTTP, compatible with Jaeger, Grafana Tempo, and other OTLP-capable backends:

```typescript
import { OtlpJsonSpanExporter } from '@agentscript/runtime/tracing';

const exporter = new OtlpJsonSpanExporter({
  url: 'http://localhost:4318/v1/traces',
  headers: { 'Authorization': 'Bearer <token>' },
});
```

The exporter formats spans into the OTLP `resourceSpans` envelope with nanosecond timestamps and maps span attributes to the OTLP key-value format.

#### MultiSpanExporter

Fan out spans to multiple exporters simultaneously:

```typescript
import { MultiSpanExporter, ConsoleSpanExporter, OtlpJsonSpanExporter } from '@agentscript/runtime/tracing';

const exporter = new MultiSpanExporter([
  new ConsoleSpanExporter(),
  new OtlpJsonSpanExporter({ url: 'http://collector:4318/v1/traces' }),
]);
```

### 3.4 How Tracing Hooks into the Runtime

The runtime creates spans at each phase boundary:

| Span Name | Parent | Attributes |
|---|---|---|
| `turn` | (root) | `node`, `userInput` |
| `llm-step` | `turn` | `model`, `node`, `messageCount` |
| `tool-call:{name}` | `turn` | `toolName`, `target`, `args` |
| `middleware:{name}` | current phase span | `hook`, `priority` |
| `guardrail:{name}` | `llm-step` | `attempt`, `valid` |

On error or abort, `drainAll('error')` closes any unclosed spans and flushes them to the exporter, ensuring you never lose telemetry even on crashes.

### 3.5 Parallel Spans

For parallel tool execution, `startChildSpan` creates spans with an explicit parent ID without disturbing the stack order:

```typescript
const parentId = tracing.current()!.spanId;
const childSpan = tracing.startChildSpan(parentId, 'tool-call:fetchA', { target: 'api' });
// ... execute tool ...
tracing.endSpan('ok');
```

---

## 4. Structured Output

Structured output enforcement ensures the LLM returns data conforming to a specific JSON Schema, using either native LLM capabilities or guardrail-based validation (or both).

### 4.1 Configuration

```typescript
import type { StructuredOutputOptions } from '@agentscript/runtime/structured-output';

const outputConfig: StructuredOutputOptions = {
  schema: {
    type: 'object',
    required: ['intent', 'entities'],
    properties: {
      intent: { type: 'string', enum: ['book', 'cancel', 'modify'] },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'value'],
          properties: {
            type: { type: 'string' },
            value: { type: 'string' },
          },
        },
      },
    },
  },
  name: 'intent_extraction',      // Used in responseFormat sent to the LLM
  description: 'Extract user intent and entities',
  strategy: 'auto',               // 'native' | 'guardrail' | 'auto'
  maxRetries: 2,
};
```

### 4.2 Strategies

| Strategy | Behavior |
|---|---|
| `'native'` | Sends `responseFormat` with `type: 'json_schema'` to the LLM driver. Relies entirely on the model's native structured output support. No runtime validation. |
| `'guardrail'` | Does not modify the LLM call. Validates the text output against the schema post-hoc using the guardrail retry loop. |
| `'auto'` (default) | Sends `responseFormat` to the LLM **and** adds a guardrail as a fallback validator. Belt-and-suspenders for maximum reliability. |

### 4.3 `buildResponseFormat`

Constructs the `responseFormat` object passed to `LlmStepInput`:

```typescript
import { buildResponseFormat } from '@agentscript/runtime/structured-output';

const responseFormat = buildResponseFormat({
  schema: mySchema,
  name: 'my_output',
});
// Result:
// {
//   type: 'json_schema',
//   json_schema: { name: 'my_output', schema: mySchema, strict: true }
// }
```

The `strict: true` flag instructs compatible LLM drivers to enforce the schema at the token-sampling level.

### 4.4 `parseStructuredOutput`

Parses and validates raw LLM text against a schema. Handles markdown code fences (` ```json ... ``` `) gracefully:

```typescript
import { parseStructuredOutput } from '@agentscript/runtime/structured-output';

const result = parseStructuredOutput(llmText, mySchema);
if (result.valid) {
  console.log(result.data); // Typed, validated data
} else {
  console.error(result.error); // "Invalid JSON: ..." or "JSON Schema validation failed: ..."
}
```

The parser first attempts to extract JSON from markdown code fences, then falls back to parsing the raw text. This makes it tolerant of models that wrap JSON output in backticks.

### 4.5 How It Modifies LLM Calls

When structured output is enabled on a node:

1. **Before the LLM call**: If strategy is `'native'` or `'auto'`, `buildResponseFormat` is invoked and the result is attached to the `LlmStepInput.responseFormat` field.
2. **After the LLM call**: If strategy is `'guardrail'` or `'auto'`, `parseStructuredOutput` validates the response. On failure, the error is fed back to the LLM and the step is retried (up to `maxRetries`).
3. **On success**: The parsed data is available as the structured output of the turn.

---

## 5. Checkpoint and Resume

The checkpoint system enables suspending and resuming agent execution across process boundaries, enabling long-running conversations, fault recovery, and session migration.

### 5.1 Checkpoint Schema

```typescript
interface Checkpoint {
  schemaVersion: number;                   // Currently: 1
  createdAt: string;                       // ISO 8601 timestamp
  id: string;                              // Unique identifier
  currentNode: string;                     // The node the agent was in
  history: Msg[];                          // Full conversation history
  stateValues: Record<string, unknown>;    // Agent state snapshot
  metadata?: Record<string, unknown>;      // Optional application-specific data
}
```

The `CHECKPOINT_SCHEMA_VERSION` constant (currently `1`) is used for compatibility checks during restore.

### 5.2 What Gets Captured

A checkpoint captures the complete agent state needed to resume execution:

- **Current node**: Which node in the agent graph the conversation is in.
- **History**: The full message history (user messages, assistant messages, tool call/result pairs).
- **State values**: All mutable state variables (slots, counters, flags, etc.).
- **Metadata**: Optional data that your application attaches (e.g., user session ID, tenant info).

### 5.3 CheckpointStore Interface

```typescript
interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<string>;   // Returns the checkpoint ID
  load(id: string): Promise<Checkpoint | null>;    // Returns null if not found
  list(filter?: { limit?: number }): Promise<string[]>; // Most recent first
  delete(id: string): Promise<void>;
}
```

This interface is intentionally simple to allow implementation over any storage backend (Redis, DynamoDB, PostgreSQL, filesystem, etc.).

### 5.4 MemoryCheckpointStore

The built-in in-memory implementation for development and testing:

```typescript
import { MemoryCheckpointStore } from '@agentscript/runtime/checkpoint';

const store = new MemoryCheckpointStore();

// Save a checkpoint
const id = await store.save(checkpoint);

// Load it back
const restored = await store.load(id);

// List recent checkpoints
const ids = await store.list({ limit: 10 });

// Delete when no longer needed
await store.delete(id);
```

The `MemoryCheckpointStore` uses `structuredClone` to deep-copy checkpoints on save and load, preventing mutation of stored data from affecting the live agent or vice versa.

### 5.5 Restore Flow

To resume from a checkpoint:

1. Load the checkpoint from the store.
2. Validate the `schemaVersion` against the runtime's `CHECKPOINT_SCHEMA_VERSION`.
3. Restore `currentNode`, `history`, and `stateValues` into the runtime session.
4. Continue execution from where it left off.

```typescript
const checkpoint = await store.load(checkpointId);
if (!checkpoint) throw new Error('Checkpoint not found');

// Runtime handles version validation internally
const session = runtime.restoreFromCheckpoint(checkpoint);
const result = await session.turn('Continue where we left off');
```

### 5.6 Version Compatibility Errors

Two error classes handle compatibility issues:

**`CheckpointVersionError`** -- Thrown when the checkpoint's `schemaVersion` does not match the runtime's expected version:

```typescript
import { CheckpointVersionError } from '@agentscript/runtime/checkpoint';

try {
  const session = runtime.restoreFromCheckpoint(oldCheckpoint);
} catch (e) {
  if (e instanceof CheckpointVersionError) {
    console.error(`Found version ${e.found}, expected ${e.expected}`);
    // Trigger migration or start fresh
  }
}
```

**`CheckpointIncompatibleError`** -- Thrown for structural incompatibilities beyond version number (e.g., the checkpoint references a node that no longer exists in the current agent definition):

```typescript
import { CheckpointIncompatibleError } from '@agentscript/runtime/checkpoint';

try {
  const session = runtime.restoreFromCheckpoint(checkpoint);
} catch (e) {
  if (e instanceof CheckpointIncompatibleError) {
    console.error(e.message); // Describes the specific incompatibility
  }
}
```

### 5.7 Design Decisions

- **Deep cloning on save/load**: Prevents subtle aliasing bugs where mutating the live state would corrupt the stored checkpoint or vice versa.
- **Simple async interface**: Even the in-memory store returns Promises, ensuring that swapping to a network-backed store requires zero code changes in the consumer.
- **Version pinning**: The explicit `schemaVersion` field future-proofs the system. When the checkpoint format evolves, old checkpoints can be detected and either migrated or rejected cleanly.

---

## 6. Abort and Cancellation

The runtime supports cooperative cancellation via the standard `AbortSignal` API, enabling callers to cancel long-running agent turns from the outside.

### 6.1 AbortError

When cancellation is triggered, the runtime throws an `AbortError`:

```typescript
import { AbortError } from '@agentscript/runtime/errors';

const controller = new AbortController();

// Pass the signal to the runtime
const resultPromise = runtime.turn(input, { signal: controller.signal });

// Cancel from elsewhere (e.g., timeout, user action)
controller.abort('User cancelled');

try {
  await resultPromise;
} catch (e) {
  if (e instanceof AbortError) {
    console.log(e.message);  // "User cancelled"
    console.log(e.reason);   // The original reason passed to abort()
  }
}
```

### 6.2 AbortError Semantics

`AbortError` wraps the abort reason with consistent semantics:

| `abort(reason)` | `AbortError.message` | `AbortError.reason` |
|---|---|---|
| `abort('timeout')` | `"timeout"` | `"timeout"` |
| `abort(new Error('fail'))` | `"fail"` | The Error instance |
| `abort()` (no reason) | `"The operation was aborted"` | `undefined` |

### 6.3 Where Checks Happen

The runtime checks `signal.aborted` at multiple points to ensure timely cancellation:

1. **Before each LLM call**: Checked before sending the request to the LLM provider.
2. **Before each tool execution**: Checked before invoking the tool handler.
3. **Between middleware hooks**: Checked between pipeline stages.
4. **During the tool execution loop**: Checked before processing the next tool call in a multi-tool response.

This design ensures that even in a long tool-call loop, cancellation is detected within one iteration rather than waiting for the entire loop to complete.

### 6.4 Interaction with Tracing

When an abort occurs, the `TracingContext.drainAll('error')` method is called to close all open spans with error status and flush them to the exporter. This guarantees that partial traces are still exported for post-mortem analysis, with clear error status indicating the abort point.

### 6.5 Interaction with Checkpoints

Abort does not automatically create a checkpoint. If you need resumability after cancellation, wrap the abort handler to save state:

```typescript
controller.signal.addEventListener('abort', async () => {
  const checkpoint = runtime.createCheckpoint(session);
  await store.save(checkpoint);
});
```

This is intentionally left to the application layer because not all aborts are resumable (e.g., a security abort should not preserve state).
