# feat/js-runtime — Branch Change Summary

This document describes all changes introduced on `feat/js-runtime` relative to `main`.

**Stats:** 96 files changed, ~16,400 lines added across 14 commits.

---

## Table of Contents

1. [New Packages](#new-packages)
2. [Runtime Core (`@agentscript/runtime`)](#runtime-core)
3. [Vercel AI SDK Adapter (`@agentscript/runtime-vercel`)](#vercel-ai-sdk-adapter)
4. [UI Playground (`apps/ui`)](#ui-playground)
5. [Infrastructure & Config](#infrastructure--config)
6. [Test Coverage](#test-coverage)
7. [Commit History](#commit-history)

---

## New Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@agentscript/runtime` | `packages/runtime/` | Lightweight TypeScript runtime that executes compiled AgentScript IR |
| `@agentscript/runtime-vercel` | `packages/runtime-vercel/` | Vercel AI SDK adapter — wraps `generateText` as an LLM driver |

---

## Runtime Core

**Package:** `packages/runtime/`  
**Lines:** ~5,500 (src) + ~5,800 (tests)

### Architecture

```
AgentDSLAuthoring (compiler IR)
        │
        ▼
┌──────────────────────────────────────────────────┐
│  Runtime                                         │
│  ├── Graph Loader (load.ts)                      │
│  ├── State Store (mutable / linked vars)         │
│  ├── Expression Evaluator (Pratt parser)         │
│  ├── Template Renderer ({{ state.x }})           │
│  ├── Step Interpreter (if/else, set, run, with)  │
│  ├── Tool Registry (URI-scheme dispatch)         │
│  ├── ReAct Turn Controller                       │
│  ├── Middleware Pipeline                         │
│  ├── Tracing / Telemetry                         │
│  ├── Guardrails (output validation)              │
│  ├── Delegation (agent-as-tool)                  │
│  ├── Parallel Dispatch                           │
│  ├── Structured Output                           │
│  └── Checkpoint / Resume                         │
└──────────────────────────────────────────────────┘
```

### Key Components

#### Turn Controller (`src/turn/runtime.ts` — 2,180 lines)

The central execution engine. Implements the ReAct loop:

1. **before_reasoning** hooks (lifecycle steps)
2. **Reasoning loop**: LLM call → tool dispatch → after_all_tool_calls → repeat or break
3. **after_reasoning** hooks
4. **Handoff** to next subagent node (if transition fires)

Handles:
- `__state_update_action__` sentinel for direct state mutation
- `__end_session_action__` and `@utils.escalate` as terminal events
- `available when` / `enabled` guards on tool slots
- Intra-turn subagent handoff (graph traversal)
- Abort signal propagation

#### Tool Registry (`src/tools/`)

URI-scheme based routing:
- `fn://tool_name` → `FnAdapter` (local JS functions)
- `http://` / `https://` → `HttpAdapter` (POST JSON)
- `mcp://tool_name` → MCP adapter (JSON-RPC 2.0)
- `MockToolAdapter` — exact-target match with fallback (for testing)

#### Expression Evaluator (`src/expr/`)

Pratt parser + tree-walk evaluator for the compiler's expression subset:
- Logical: `and`, `or`, `not`
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`, `is`, `is not`
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Literals: `True`, `False`, `None`, strings, numbers
- Member access: `state.customer.name`
- Parenthesization

#### Middleware Pipeline (`src/middleware/`)

Interceptor hooks at every lifecycle point:
- `beforeTurn` / `afterTurn`
- `beforeToolCall` / `afterToolCall`
- `beforeLlmStep` / `afterLlmStep`
- `onError`

Priority-ordered execution with short-circuit capabilities.

#### Tracing / Telemetry (`src/tracing/`)

OpenTelemetry-compatible span instrumentation:
- `TracingContext` manages span lifecycle
- Exporters: `InMemorySpanExporter`, `ConsoleSpanExporter`, `OtlpJsonSpanExporter`
- Configurable sample rate
- Spans for: turns, LLM steps, tool calls, handoffs, delegation

#### Output Guardrails (`src/guardrails/`)

Validate LLM responses before acting on them:
- `jsonSchemaGuardrail` — validate against JSON Schema
- `regexGuardrail` — pattern matching
- `contentPolicyGuardrail` — blocklist/allowlist
- `customGuardrail` — arbitrary validation function
- `composeGuardrails` — combine multiple validators
- Configurable retry loop with `ExhaustionPolicy` (error vs. fallback)

#### Delegation — Agent-as-Tool (`src/delegation/`)

Run a child subagent as a tool call within the parent's turn:
- `delegateToNode(childNodeId, userMessage, options)` — single delegation
- `delegateMultiple(targets)` — parallel delegation to multiple children
- Depth limiting (`maxDepth: 5` default)
- Step limiting (`maxSteps: 10` default)
- State change propagation from child → parent
- Conflict detection with `error-on-conflict` merge strategy

#### Parallel Dispatch (`src/parallel/`)

Execute multiple tool calls or delegations concurrently:
- `ParallelStrategy`: `'auto'` | `'always'` | `'never'`
- `FailurePolicy`: `'fail-fast'` | `'wait-all'`
- Sequential tool exclusion list (`sequentialTools`)
- Per-child timeout for parallel delegation
- State merge strategies: `'last-wins'` | `'error-on-conflict'` | `'custom'`

#### Structured Output (`src/structured-output/`)

Enforce typed responses from the LLM:
- `buildResponseFormat(schema)` — convert JSON Schema to LLM response format
- `parseStructuredOutput(text, schema)` — validate and parse response
- Strategy options: `'json_schema'` | `'tool_call'`

#### Checkpoint / Resume (`src/checkpoint/`)

Serialize and restore runtime state:
- `Checkpoint` type with versioned schema (`CHECKPOINT_SCHEMA_VERSION`)
- `MemoryCheckpointStore` — in-memory implementation
- `CheckpointStore` interface for custom backends
- Version compatibility checks on restore

#### Abort & Error Handling

- `AbortError` raised on signal cancellation
- Per-turn and per-session abort signals
- Tool-level timeout propagation

---

## Vercel AI SDK Adapter

**Package:** `packages/runtime-vercel/`

Bridges `@agentscript/runtime` with the Vercel AI SDK ecosystem.

### Key Exports

- `createAgent(options)` → `AgentScriptAgent` with `.run()` and `.stream()` methods
- `compileSource(text)` — re-exported from `@agentscript/agentforce`
- `VercelAiSdkDriver` — low-level LLM driver wrapping `generateText`

### Streaming API

`agent.stream(userMessage)` yields typed stream parts:

| Part Type | Payload |
|-----------|---------|
| `start-step` | `{ node }` |
| `finish-step` | `{ node, to? }` |
| `text-delta` | `{ text }` |
| `tool-call` | `{ toolName, args }` |
| `tool-result` | `{ toolName, result }` |
| `tool-error` | `{ toolName, error }` |
| `state-change` | `{ name, before, after }` |
| `finish` | `{ finalNode, assistantText }` |
| `error` | `{ error }` |

### Examples

- `examples/run-mock.ts` — mock LLM for deterministic testing
- `examples/run-anthropic.ts` — Claude via Anthropic SDK
- `examples/run-gateway.ts` — OpenAI-compatible gateway
- `examples/run-gateway-travel.ts` — multi-subagent travel concierge

---

## UI Playground

**Package:** `apps/ui/`

### New: Browser Simulator

Full in-browser agent simulation with streaming chat UI.

#### Components Added

| File | Purpose |
|------|---------|
| `src/pages/Simulate.tsx` | Main simulation page — chat + right pane with tabs |
| `src/components/simulator/Transcript.tsx` | Chat message display with user input |
| `src/components/simulator/EventTimeline.tsx` | Real-time stream event viewer |
| `src/components/simulator/MocksPanel.tsx` | Configure tool mock responses (fixed JSON) |
| `src/components/simulator/ProvidersPanel.tsx` | Connect to external HTTP/MCP tool servers |
| `src/components/simulator/RightPane.tsx` | Tabbed right panel container |
| `src/components/simulator/SnippetPanel.tsx` | Copy-paste code snippet generator |

#### New: Tool Providers Panel

Connect to real external tool servers during simulation:

- **HTTP providers** — any REST endpoint; dispatches via `HttpAdapter`
- **MCP providers** — MCP servers over JSON-RPC 2.0 / HTTP; dispatches via `McpBrowserAdapter`

Features:
- Add/remove/toggle providers
- Custom headers (JSON) per provider
- "Test" button — initializes connection and discovers available tools
- Discovered tools displayed as badges
- Settings persisted to localStorage (excluding ephemeral tool discovery)
- Mocks take priority over live providers (explicit override)

#### New: MCP Browser Adapter (`src/lib/mcp-browser-adapter.ts`)

Browser-native MCP client using `fetch()`:
- JSON-RPC 2.0 protocol compliance
- `initialize` + `notifications/initialized` handshake
- Promise-based initialization mutex (prevents race conditions on concurrent calls)
- 30s default timeout via `AbortSignal.timeout()`
- Response validation (jsonrpc field, id matching, error detection)
- Target validation (only `mcp://` scheme, no path traversal)

#### New: Simulator Engine (`src/lib/simulator.ts`)

Orchestrates agent building for the browser:
- `buildAgent(source, settings, mocks, providers)` — compile + configure + return agent
- `buildToolRegistry(mocks, providers)` — single entry point composing adapters
- `buildAdapters(providers)` — creates `HttpAdapter` / `McpBrowserAdapter` from provider config
- `buildDefaultTools()` — seeded demo handlers (order lookup, flight search, etc.)
- Mock wrapping: `MockToolAdapter` wraps real adapters per scheme, mocks override real calls

#### New: Stores

| Store | Key | Purpose |
|-------|-----|---------|
| `src/store/llmSettings.ts` | `agentscript.llm-settings` | LLM endpoint config (baseUrl, apiKey, model, provider) |
| `src/store/toolProviderStore.ts` | `agentscript.tool-providers` | Provider CRUD with enable/disable |
| `src/store/agentStore.ts` | — | Per-agent mock configuration |

#### New: Test MCP Server (`test-mcp-server.ts`)

Fake MCP server for development/testing:
- Listens on port 3001
- Provides tools: `get_weather`, `calculate`, `search`
- Full MCP JSON-RPC 2.0 protocol with `initialize` + `tools/list` + `tools/call`
- CORS headers for direct browser access

---

## Infrastructure & Config

### Vite Configuration (`apps/ui/vite.config.ts`)

| Change | Before | After | Reason |
|--------|--------|-------|--------|
| Host binding | `0.0.0.0` | `127.0.0.1` | Security — don't expose dev server to network |
| Port | 27002 | 27003 | Avoid conflicts |
| Strict port | — | `true` | Fail instead of silently picking another port |
| Proxy | commented out | `/mcp-proxy` → `localhost:3001` | Route MCP calls through Vite to avoid CORS |

### ESLint (`eslint.config.js`)

Added 2 ignore patterns for generated/test files.

### pnpm-lock.yaml

Updated with new package dependencies (ai, @ai-sdk/openai, zustand, etc.)

---

## Test Coverage

**19 test files, 179 test cases** — all passing.

| Test File | Cases | Coverage Area |
|-----------|-------|---------------|
| `hello-world.test.ts` | 2 | Basic turn execution |
| `if-else.test.ts` | 8 | Expression evaluation in hook steps |
| `enabled-gating.test.ts` | 6 | `available when` / `enabled` guards |
| `tool-and-handoff.test.ts` | 3 | Tool dispatch + node transitions |
| `terminal-actions.test.ts` | 3 | End session + escalation |
| `graph-integration.test.ts` | 8 | Multi-node graph traversal |
| `mock-adapter.test.ts` | 3 | MockToolAdapter exact-match + fallback |
| `middleware.test.ts` | 12 | Full middleware lifecycle |
| `abort.test.ts` | 7 | Signal cancellation at every point |
| `tool-limits.test.ts` | 8 | Per-tool invocation budgets |
| `checkpoint.test.ts` | 12 | Save/restore/versioning |
| `tracing-integration.test.ts` | 14 | Span creation, attributes, export |
| `guardrail-validators.test.ts` | 20 | Individual validator unit tests |
| `guardrail-integration.test.ts` | 18 | End-to-end guardrail with retry |
| `integration-full-pipeline.test.ts` | 15 | All features composed together |
| `delegation-integration.test.ts` | 17 | Agent-as-tool delegation |
| `parallel-tool-calls.test.ts` | 12 | Parallel tool dispatch strategies |
| `parallel-delegation.test.ts` | 13 | Parallel delegation + state merge |
| `structured-output.test.ts` | 18 | JSON schema enforcement + parsing |

Plus `packages/runtime-vercel/test/agent.test.ts` (5 cases) for the Vercel adapter.

### Manual E2E (`test/manual/parallel-e2e.ts`)

Full end-to-end script with real HTTP/MCP servers:
- Spawns local HTTP tool server + MCP server
- Tests parallel tool dispatch, parallel delegation, sequential fallback
- Validates state merge conflict detection
- Not part of CI — requires running servers

---

## Commit History

| # | Hash | Message |
|---|------|---------|
| 1 | `016de4d` | feat(runtime): JS runtime + Vercel AI SDK adapter for AgentScript |
| 2 | `807bfc6` | feat(ui): browser simulator playground for AgentScript |
| 3 | `4889899` | feat(runtime): add middleware, abort, tool limits, and checkpoint support |
| 4 | `3c0ef62` | feat(runtime): add tracing/telemetry system with span instrumentation and integration tests |
| 5 | `6c2bf33` | feat(runtime): add output guardrails with retry loop and built-in validators |
| 6 | `140d631` | feat(runtime): add delegation-as-tool types and errors |
| 7 | `f1761ff` | feat(runtime): implement delegation-as-tool runtime method |
| 8 | `ff553b1` | test(runtime): add delegation-as-tool integration tests |
| 9 | `0680f04` | fix(runtime): handle endSession and escalation in delegation tool loop |
| 10 | `460ab8d` | fix(runtime): resolve eslint errors in delegation integration tests |
| 11 | `ae836b0` | test(runtime): add integration tests for structured output enforcement |
| 12 | `470a3eb` | feat(runtime): add parallel tool dispatch and parallel delegation |
| 13 | `b957da8` | feat(ui): add Providers panel for connecting external HTTP/MCP tool servers |
| 14 | `230010a` | fix(ui): resolve eslint errors in providers feature |

---

## What Is Not Yet Implemented

These are known gaps relative to the Salesforce-internal runtime:

- `action` / `router` / `external_agent` / `byon` node types (only `subagent` today)
- `on_init` / `on_exit` lifecycle hooks
- `pre_tool_calls` / `post_tool_calls` per-tool hooks
- `end_turn_first` on handoff
- `RequireConfirmation` pause/resume
- Granular per-turn limits (`maxHandoffs`, `maxReasoningIterations`)
- Apex/Flow adapters (`apex://`, `flow://`, `apexRest://`)
- Full MCP transport support (only HTTP, no stdio/WebSocket)
