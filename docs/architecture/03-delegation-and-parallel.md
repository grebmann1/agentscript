# Delegation and Parallel Execution

This section covers the AgentScript JS Runtime's multi-agent capabilities: delegating work to child agents and dispatching tool calls in parallel. These mechanisms enable fan-out/fan-in patterns, supervisor architectures, and concurrent tool execution within a single agent turn.

---

## 1. Delegation Overview

### What Is "Agent-as-Tool"?

Delegation treats a child agent node as a callable tool. When a parent agent's LLM emits a tool call targeting `delegate://childNode`, the runtime suspends the parent's reasoning loop, spawns a new reasoning loop for the child, and feeds the child's final response back to the parent as the tool result.

From the parent's perspective, delegation looks like any other tool call:

```
Parent LLM step  -->  tool_call: "delegate://child" {context: "summarize report"}
                       |
                       v
              [child reasoning loop executes]
                       |
                       v
Parent receives  <--  tool_result: "Summary: Q4 revenue grew 12%..."
```

### Delegation vs. Handoff (Transition)

| Aspect | Delegation | Handoff (Transition) |
|--------|-----------|---------------------|
| Control flow | Call-return (parent resumes) | One-way transfer (parent exits) |
| History | Isolated by default | Carried forward to new node |
| State | Shared — child mutations visible to parent | Shared — state persists across nodes |
| Use case | Subtask completion, tool augmentation | Routing to a specialist, conversation branching |
| Agent DSL target | `delegate://nodeName` | `transition://nodeName` |

Use delegation when the parent needs to continue reasoning after the child completes. Use handoff when the conversation should permanently move to a different node.

---

## 2. Single Delegation

### API

```typescript
// Internal method — invoked automatically when the runtime encounters
// a tool call with a "delegate://" target.
private async delegate(
  childNodeName: string,
  context?: string,
  signal?: AbortSignal
): Promise<DelegationResult>
```

### Options

Configured at runtime construction via the `delegation` key:

```typescript
const runtime = new Runtime({
  doc: compiledAgent,
  llm,
  tools,
  delegation: {
    maxSteps: 10,        // Max LLM steps the child may take (default: 10)
    maxDepth: 5,         // Max recursive delegation depth (default: 5)
    context: '',         // Default context string for all delegations
    shareHistory: false, // Pass parent history to child (default: false)
  },
});
```

| Option | Default | Purpose |
|--------|---------|---------|
| `maxSteps` | 10 | Prevents runaway children. Throws `DelegationTimeoutError` when exceeded. |
| `maxDepth` | 5 | Prevents infinite recursive delegation. Throws `DelegationDepthError`. |
| `context` | `''` | Additional instructions injected into the child's conversation as a `[Delegation context: ...]` user message. |
| `shareHistory` | `false` | When `true`, the child receives a copy of the parent's full conversation history. |

### DelegationResult

```typescript
interface DelegationResult {
  assistantText: string;                  // Child's final text response
  stateChanges: Record<string, unknown>;  // Keys the child mutated
  finalNode: string;                      // Node the child ended on
  steps: number;                          // LLM steps consumed
}
```

### Lifecycle

```
Parent Turn Loop
  |
  |--- LLM emits tool_call: delegate://child {context: "..."}
  |
  |    [1] Resolve child node from the agent graph
  |    [2] Check depth limit (DelegationDepthError if exceeded)
  |    [3] Create DelegationFrame, push onto delegationStack
  |    [4] Emit 'delegation-start' event
  |    [5] Snapshot parent state: savedNode, savedHistory, stateBefore
  |    [6] Swap to child context:
  |          - currentNode = childNodeName
  |          - Clear history (optionally copy parent's if shareHistory=true)
  |          - Inject delegation context as user message
  |    [7] Run child reasoning loop:
  |          - before_reasoning hooks
  |          - while (steps < maxSteps):
  |              - Build system prompt for child node
  |              - LLM step -> text + toolCalls
  |              - If no tool calls: push assistant text, break
  |              - Dispatch child's tool calls sequentially
  |          - after_reasoning hooks
  |    [8] Compute stateChanges = diff(stateBefore, current state)
  |    [9] Pop DelegationFrame
  |   [10] Restore parent: currentNode, history
  |   [11] Emit 'delegation-end' event
  |   [12] Return DelegationResult
  |
  |--- Parent receives child result as tool_result message
  |--- Parent LLM continues reasoning
  v
```

### History Isolation

By default, the child starts with an empty conversation history (plus the optional delegation context message). The parent's history is frozen and restored after delegation. The child's internal messages never appear in the parent's history — only the `DelegationResult.assistantText` is visible to the parent as a tool result.

When `shareHistory: true`, the child receives a copy of the parent's messages. This is useful when the child needs conversational context (e.g., references to earlier user statements).

---

## 3. Parallel Delegation

### API

```typescript
async delegateMultiple(
  children: Array<{ nodeName: string; context?: string }>,
  signal?: AbortSignal
): Promise<DelegationResult[]>
```

This is a public method on the `Runtime` class. It spawns multiple child reasoning loops concurrently using `Promise.allSettled`.

### Configuration

```typescript
const runtime = new Runtime({
  doc: compiledAgent,
  llm,
  tools,
  delegation: {
    maxSteps: 10,
    maxDepth: 5,
    parallel: {
      failurePolicy: 'wait-all',        // 'fail-fast' | 'wait-all'
      perChildTimeoutMs: 30000,          // Per-child wall-clock timeout
      stateMerge: 'last-wins',           // 'last-wins' | 'error-on-conflict' | 'custom'
      mergeFn: undefined,                // Required when stateMerge = 'custom'
    },
  },
});
```

### Execution Flow

```
delegateMultiple([childA, childB, childC])
  |
  |--- [1] Pre-validate: all child nodes exist, depth limit OK
  |--- [2] Emit 'parallel-delegation-start' event
  |--- [3] Snapshot parent state
  |--- [4] Create child AbortController (linked to parent signal)
  |--- [5] Spawn isolated delegation for each child via Promise.allSettled
  |           |
  |           |--- childA: runIsolatedDelegation("childA", context, signal)
  |           |--- childB: runIsolatedDelegation("childB", context, signal)
  |           |--- childC: runIsolatedDelegation("childC", context, signal)
  |           |
  |           v (all settle)
  |--- [6] Collect results and state changes from each child
  |--- [7] Apply failure policy (see below)
  |--- [8] Merge state changes according to stateMerge strategy
  |--- [9] Emit 'parallel-delegation-end' event
  |--- [10] Return DelegationResult[]
  v
```

### Per-Child Isolation

Each child in `delegateMultiple` runs in full isolation:

- Separate conversation history (not shared between siblings)
- Own LLM call sequence
- Own tool dispatch
- Shares the runtime's `State` object (mutations are visible cross-child)

The `runIsolatedDelegation` method creates a `DelegationFrame`, builds its own history, runs the child's full reasoning loop, then returns state diffs.

---

## 4. State Merging

When multiple children run in parallel, they may each mutate shared state variables. The `stateMerge` option controls how conflicting writes are reconciled after all children settle.

### Strategies

#### `last-wins` (default)

State changes are applied in child-array order. Later children overwrite earlier ones:

```typescript
// Internal implementation
const merged: Record<string, unknown> = {};
for (const change of changes) {
  Object.assign(merged, change);
}
```

This is simple and predictable but can silently lose data when children write to the same key.

#### `error-on-conflict`

If two children wrote different values to the same key, throws `StateConflictError`:

```typescript
throw new StateConflictError(key, writerA_index, writerB_index);
```

Use this in production systems where concurrent writes to the same variable indicate a design error.

#### `custom`

Provide a `mergeFn` that receives all children's state changes and returns the merged result:

```typescript
delegation: {
  parallel: {
    stateMerge: 'custom',
    mergeFn: (changes) => {
      // Example: concatenate string values with separator
      const merged: Record<string, unknown> = {};
      for (const change of changes) {
        for (const [key, value] of Object.entries(change)) {
          const existing = merged[key];
          merged[key] = existing ? `${existing};${value}` : value;
        }
      }
      return merged;
    },
  },
}
```

### StateConflictError

```typescript
class StateConflictError extends Error {
  readonly key: string;       // The conflicting state variable name
  readonly writerA: number;   // Index of first child that wrote
  readonly writerB: number;   // Index of second child that wrote a different value
}
```

---

## 5. Depth and Loop Protection

### DelegationDepthError

Prevents infinite recursive delegation chains (e.g., A delegates to B, B delegates to C, C delegates to D...):

```typescript
class DelegationDepthError extends Error {
  readonly currentDepth: number;
  readonly maxDepth: number;
}
```

The runtime checks `delegationStack.length >= maxDepth` before each delegation. When exceeded, the error propagates as a tool error to the parent, allowing the parent's LLM to handle the failure gracefully.

### DelegationTimeoutError

Prevents a child from consuming unlimited LLM steps:

```typescript
class DelegationTimeoutError extends Error {
  readonly childNode: string;
  readonly maxSteps: number;
  readonly stepsTaken: number;
}
```

Checked at the top of each iteration of the child's reasoning loop. Like depth errors, timeout errors propagate to the parent as tool results.

### The Delegation Stack

The runtime maintains a `delegationStack: DelegationFrame[]` that tracks the full chain of active delegations. Each frame records:

- `parentNode` — who initiated the delegation
- `childNode` — who is running
- `parentHistory` — frozen snapshot of parent's messages at delegation time
- `depth` — current depth (1-indexed)
- `options` — resolved delegation options for this frame

This stack enables the runtime to:
1. Enforce depth limits
2. Restore parent context on completion or error
3. Provide debugging visibility via events

---

## 6. Parallel Tool Dispatch

Independent of delegation, the runtime can dispatch multiple tool calls from a single LLM step in parallel. This reduces latency when the LLM emits multiple independent tool calls (e.g., fetching weather AND searching a database simultaneously).

### Configuration

```typescript
const runtime = new Runtime({
  doc: compiledAgent,
  llm,
  tools,
  parallel: {
    strategy: 'auto',                 // 'auto' | 'always' | 'never'
    sequentialTools: ['setState'],     // Tools that must never run in parallel
    failurePolicy: 'wait-all',        // 'fail-fast' | 'wait-all'
  },
});
```

### ParallelStrategy

| Strategy | Behavior |
|----------|----------|
| `auto` | Parallel when safe: 2+ tool calls, none are state-update/end-session/delegate/sequential-listed |
| `always` | Parallel whenever 2+ tool calls are emitted (regardless of type) |
| `never` | Always sequential, even with multiple tool calls |

### Safety Checks in `auto` Mode

The `shouldDispatchParallel` method returns `false` (forcing sequential) if any call in the batch:

1. Is listed in `sequentialTools`
2. Targets `__state_update_action__` (state mutation)
3. Targets `__end_session_action__` (session termination)
4. Targets `delegate://...` (delegation)
5. Targets `__delegate_action__` (delegation-as-tool)

This ensures side-effecting operations maintain ordering guarantees.

### Execution Flow

```
LLM emits: [tool_call_A, tool_call_B, tool_call_C]
  |
  |--- shouldDispatchParallel? (strategy + safety checks)
  |
  |--- YES: dispatchToolCallsParallel()
  |      |
  |      |--- [1] Emit 'parallel-dispatch-start' {toolNames}
  |      |--- [2] Pre-check tool limits for all calls
  |      |--- [3] Create child AbortController (linked to parent)
  |      |--- [4] Promise.allSettled(dispatchToolCallIsolated for each non-blocked call)
  |      |--- [5] Apply results in ORIGINAL call order (deterministic history)
  |      |         - Successes: apply stateWrites, push tool_result to history
  |      |         - Failures: emit 'tool-error', push error to history
  |      |         - fail-fast: abort remaining on first failure
  |      |--- [6] Emit 'parallel-dispatch-end'
  |      |--- [7] Return {endSession, steps}
  |
  |--- NO: sequential dispatch (existing for-loop)
  v
```

### Key Guarantees

- **Deterministic history order**: Results are inserted into conversation history in the same order as the original tool calls, regardless of which completes first.
- **Middleware hooks fire per-call**: `beforeToolCall` and `afterToolCall` execute for each parallel call.
- **Tool limits are pre-checked**: A blocked tool does not prevent other tools from executing.
- **Single tool calls never trigger parallel dispatch**: Even with `strategy: 'always'`, a single tool call uses the standard sequential path.

### FailurePolicy

| Policy | Behavior |
|--------|----------|
| `wait-all` | All tools run to completion. Failures are recorded as error tool_results. The LLM sees both successes and failures. |
| `fail-fast` | On first failure, the child AbortController fires, canceling remaining in-flight calls. Partial results up to the failure are recorded. |

---

## 7. Error Handling

### Single Delegation Errors

When a child fails (timeout, depth limit, unhandled exception), the runtime:

1. Pops the delegation frame
2. Restores the parent's `currentNode` and history
3. Emits a `delegation-error` event
4. Surfaces the error as a tool_result to the parent LLM

The parent then decides how to proceed (retry, respond to user, try a different approach).

```
Parent                          Child
  |                               |
  |-- delegate://child ---------> |
  |                               |-- [step 1] tool call
  |                               |-- [step 2] tool call
  |                               |-- [step 3] EXCEEDS maxSteps
  |                               X   DelegationTimeoutError thrown
  |                               |
  |<-- tool_result: {error} ------+
  |                               
  |-- LLM sees error, responds
  v
```

### Parallel Delegation Errors

With `failurePolicy: 'wait-all'`:
- Failed children return an empty `DelegationResult` (`assistantText: '', stateChanges: {}, steps: 0`)
- Successful children's results are preserved
- State merging proceeds with whatever changes were collected

With `failurePolicy: 'fail-fast'`:
- The first rejection triggers `childController.abort()`
- The error is re-thrown from `delegateMultiple`
- Partial results from already-settled children are lost

### Parallel Tool Dispatch Errors

Individual tool failures in parallel dispatch are non-fatal:
- The failing tool gets an error tool_result in conversation history
- A `tool-error` event is emitted
- Other tools continue (under `wait-all`)
- The LLM receives all results (successes + errors) and can reason about them

### AbortSignal Propagation

All delegation and parallel paths respect the caller's `AbortSignal`:

```
User signal (controller.abort())
  |
  +-- delegateMultiple: onParentAbort -> childController.abort()
  |     |
  |     +-- runIsolatedDelegation: checks signal.aborted at each loop iteration
  |           |
  |           +-- tool calls: signal passed to adapter.invoke()
  |
  +-- dispatchToolCallsParallel: onParentAbort -> childController.abort()
        |
        +-- dispatchToolCallIsolated: checks signal before dispatch
```

---

## 8. Integration Patterns

### Pattern 1: Fan-Out / Fan-In (Parallel Research)

Multiple workers research different topics concurrently, results are aggregated by the parent.

```typescript
// Orchestrator delegates to multiple research workers
const results = await runtime.delegateMultiple([
  { nodeName: 'weather_worker', context: 'Get weather for Tokyo' },
  { nodeName: 'news_worker', context: 'Get top headlines for Japan' },
  { nodeName: 'finance_worker', context: 'Get NIKKEI index data' },
]);

// Parent LLM receives all results and synthesizes a response
// Each worker ran its own tool calls (HTTP APIs, databases) concurrently
```

Agent DSL structure:

```
start_agent orchestrator:
    description: "Research coordinator"
    # No tools — delegates everything

subagent weather_worker:
    description: "Fetches weather data"
    actions:
        Get_Weather:
            target: "http://api.weather.com/current"

subagent news_worker:
    description: "Fetches news headlines"
    actions:
        Search_News:
            target: "http://api.news.com/search"

subagent finance_worker:
    description: "Fetches financial data"
    actions:
        Get_Index:
            target: "http://api.finance.com/index"
```

### Pattern 2: Pipeline (Sequential Delegation Chain)

Each stage processes the output of the previous stage.

```
Parent
  |
  |-- delegate://extractor {context: "Extract entities from document"}
  |     |
  |     v (returns extracted entities)
  |
  |-- delegate://enricher {context: "Enrich these entities: [...]"}
  |     |
  |     v (returns enriched data)
  |
  |-- delegate://formatter {context: "Format for display: [...]"}
  |     |
  |     v (returns formatted output)
  |
  |-- Final response to user
  v
```

This uses sequential single-delegation. Each child's result becomes the context for the next delegation.

### Pattern 3: Supervisor (Delegation-as-Tool with Error Recovery)

The parent agent dynamically decides which children to call based on the task, with built-in retry logic.

```yaml
start_agent supervisor:
    description: "Routes tasks to appropriate specialists"

    actions:
        Delegate_To_Analyst:
            target: "delegate://analyst"
        Delegate_To_Writer:
            target: "delegate://writer"
        Delegate_To_Reviewer:
            target: "delegate://reviewer"

    reasoning:
        instructions: ->
            | You are a project supervisor. Analyze the request and delegate
            | to the appropriate specialist. If a delegation fails or returns
            | incomplete results, try a different approach or specialist.
```

The parent LLM sees delegation results as tool_results. If a child returns an error or unsatisfactory response, the parent can:
- Retry the same child with different context
- Try a different child
- Respond directly to the user

### Pattern 4: Parallel Tools + Delegation (Mixed)

A single turn can combine parallel tool dispatch with delegation:

```
LLM Step 1: [get_weather, search_db, translate]  --> dispatched in parallel
LLM Step 2: [delegate://analyst]                  --> sequential (delegation)
LLM Step 3: [notify_user, log_event]              --> dispatched in parallel
LLM Step 4: text response                         --> turn complete
```

The `auto` strategy correctly identifies that Step 2 must not be parallelized (delegation target), while Steps 1 and 3 are safe for parallel dispatch.

---

## Data Flow Diagram: Complete Delegation Cycle

```
                          PARENT TURN
    +--------------------------------------------------------+
    |                                                        |
    |  [User Message] --> LLM Step 1                         |
    |        |                                               |
    |        v                                               |
    |  tool_call: delegate://child {context: "..."}          |
    |        |                                               |
    |        |    +---- DELEGATION BOUNDARY ----+            |
    |        |    |                             |            |
    |        v    v                             |            |
    |   +--------------------------+           |            |
    |   |     CHILD TURN LOOP      |           |            |
    |   |                          |           |            |
    |   | [context msg] --> LLM    |           |            |
    |   |       |                  |           |            |
    |   |       v                  |           |            |
    |   | tool_call: do_work       |           |            |
    |   |       |                  |           |            |
    |   |       v                  |           |            |
    |   | [execute tool]           |           |            |
    |   | [state.set("key", val)]  |  state    |            |
    |   |       |                  |  shared   |            |
    |   |       v                  |     |     |            |
    |   | tool_result --> LLM      |     |     |            |
    |   |       |                  |     |     |            |
    |   |       v                  |     |     |            |
    |   | "Done working."          |     |     |            |
    |   +--------------------------+     |     |            |
    |        |                           |     |            |
    |        v                           v     |            |
    |   DelegationResult {                     |            |
    |     assistantText: "Done working."       |            |
    |     stateChanges: {key: val}             |            |
    |     finalNode: "child"                   |            |
    |     steps: 2                             |            |
    |   }                                      |            |
    |        |    +----------------------------+            |
    |        |                                               |
    |        v                                               |
    |  tool_result: "Done working." --> LLM Step 2           |
    |        |                                               |
    |        v                                               |
    |  "The child completed the work."  (final response)     |
    |                                                        |
    +--------------------------------------------------------+
```

---

## Events Reference

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `delegation-start` | `delegate()`, `runIsolatedDelegation()` | `parentNode`, `childNode`, `depth` |
| `delegation-end` | `delegate()`, `runIsolatedDelegation()` | `parentNode`, `childNode`, `result: DelegationResult` |
| `delegation-error` | `delegate()`, `runIsolatedDelegation()` | `parentNode`, `childNode`, `error: string` |
| `parallel-delegation-start` | `delegateMultiple()` | `parentNode`, `childNodes: string[]` |
| `parallel-delegation-end` | `delegateMultiple()` | `parentNode`, `childNodes`, `results` |
| `parallel-dispatch-start` | `dispatchToolCallsParallel()` | `node`, `toolNames: string[]` |
| `parallel-dispatch-end` | `dispatchToolCallsParallel()` | `node`, `toolNames: string[]` |
| `tool-error` | parallel dispatch | `name`, `error: string` |
| `tool-limit-reached` | parallel dispatch | `name`, `limit: number` |

---

## Source Files

| File | Purpose |
|------|---------|
| `packages/runtime/src/delegation/types.ts` | `DelegationOptions`, `DelegationFrame`, `DelegationResult` |
| `packages/runtime/src/delegation/errors.ts` | `DelegationTimeoutError`, `DelegationDepthError`, `StateConflictError` |
| `packages/runtime/src/parallel/types.ts` | `ParallelStrategy`, `FailurePolicy`, `ParallelDispatchOptions`, `ParallelDelegationOptions` |
| `packages/runtime/src/turn/runtime.ts` | Core implementation: `delegate()`, `delegateMultiple()`, `dispatchToolCallsParallel()`, `mergeStateChanges()`, `shouldDispatchParallel()` |
| `packages/runtime/test/delegation-integration.test.ts` | 9 tests covering single delegation patterns |
| `packages/runtime/test/parallel-tool-calls.test.ts` | 12 tests covering parallel tool dispatch |
| `packages/runtime/test/parallel-delegation.test.ts` | 13 tests covering parallel delegation and state merging |
| `packages/runtime/test/manual/parallel-e2e.ts` | End-to-end test with real HTTP and MCP servers |
