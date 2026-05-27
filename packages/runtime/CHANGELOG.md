# @agentscript/runtime

## 0.1.0

Initial public release of the JavaScript runtime for AgentScript. Executes the
compiled IR end-to-end on top of any LLM driver compatible with the
`@agentscript/runtime-vercel` adapter (Vercel AI SDK out of the box).

### Behavior changes (vs. internal pre-releases)

- **Guardrail retries no longer pollute `runtime.history`.** When an output
  guardrail rejects an attempt, the failed assistant message and the synthetic
  feedback message (`"Your response failed validation: ..."`) are kept in a
  per-call scratch buffer and forwarded to the next LLM step, but never written
  to the canonical history. This applies to both `accept-last` and `throw`
  exhaustion policies. **Downstream callers that snapshotted `runtime.history`
  for retry artifacts will see fewer entries.**
- **`composeGuardrails` target filter now mirrors `runLlmStepWithGuardrails`.**
  A child with `target: 'text'` runs whenever the output contains any text
  (even when tool calls are also present); a child with `target: 'tool-calls'`
  runs whenever tool calls are present. Previously, text guardrails were
  skipped on any output that included tool calls.

### Fixes

- Tracing under parallel tool dispatch: child spans started off-stack via
  `startChildSpan` are now closed by id (`endSpanById`), so concurrent siblings
  cannot cross-pop each other. `drainAll` walks both the stack and the
  off-stack active set on abort/error.
- `regexGuardrail` and `contentPolicyGuardrail` no longer mutate
  caller-supplied `RegExp.lastIndex` on `g`/`y` flagged patterns — the helper
  rebuilds a fresh `RegExp` from `source` + `flags` for those cases.

### Public API additions

- `TracingContext.endSpanById(spanId, status?)` for closing off-stack spans
  by identity.
- `TracingContext.drainAll()` now finalizes both stacked and off-stack spans.

### What ships

- `subagent` node type, sequential reasoning loop, tool dispatch (`fn://`,
  `http://`)
- Parallel tool dispatch (`parallel.strategy: 'always' | 'auto' | 'never'`,
  `failurePolicy`, `sequentialTools`) and parallel delegation
- Output guardrails with retry, exhaustion policies, and feedback templates
- Structured output enforcement (`native` / `guardrail` / `auto` strategies)
- Middleware pipeline (before/after reasoning, before/after tool call, on error)
- Tool-call usage limits
- Checkpoint / restore (`runtime.checkpoint()`, `Runtime.fromCheckpoint(...)`)
- OpenTelemetry-shaped tracing with `InMemorySpanExporter`,
  `ConsoleSpanExporter`, and `MultiSpanExporter`
- `AbortSignal` cancellation at runtime and per-turn level
- Delegation-as-tool

### Not yet implemented

See `packages/runtime/README.md` and `packages/runtime/ROADMAP.md` for the full
matrix. Notable gaps: `action` / `router` / `external_agent` / `byon` node
types, `on_init` / `on_exit` hooks, `pre_tool_calls` / `post_tool_calls`,
`RequireConfirmation`, MCP adapter, agent-as-tool nesting.
