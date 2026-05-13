# AgentScript JS Runtime — Architecture Documentation

This directory contains the technical architecture documentation for the AgentScript JS Runtime, produced by a team of 4 architect reviewers analyzing the `feat/js-runtime` branch.

## Documents

| # | Document | Scope |
|---|----------|-------|
| 1 | [Runtime Core](./01-runtime-core.md) | Turn controller, state management, expression evaluator, template rendering, step interpreter, graph loader, tool registry, event system, LLM driver interface |
| 2 | [Advanced Features](./02-advanced-features.md) | Middleware pipeline, output guardrails, tracing/telemetry, structured output, checkpoint/resume, abort/cancellation |
| 3 | [Delegation & Parallel](./03-delegation-and-parallel.md) | Agent-as-tool delegation, parallel delegation, state merging, depth protection, parallel tool dispatch, integration patterns |
| 4 | [UI & Integration](./04-ui-and-integration.md) | Vercel AI SDK adapter, streaming architecture, browser simulator, MCP browser adapter, tool provider system, mock system, UI architecture |

## Quick Start

If you're new to the codebase, read in order:

1. **Runtime Core** gives you the mental model — how the ReAct loop works, how state flows, how tools are dispatched.
2. **Advanced Features** shows you the opt-in extension points — add middleware, guardrails, tracing without changing core logic.
3. **Delegation & Parallel** covers multi-agent patterns — when to use delegation vs handoff, how to fan-out work.
4. **UI & Integration** explains the developer experience — the playground, the Vercel adapter, how to connect real tool servers.

## Packages

```
packages/
├── runtime/           @agentscript/runtime       — Core execution engine
├── runtime-vercel/    @agentscript/runtime-vercel — Vercel AI SDK adapter
apps/
├── ui/                agentscript-ui             — Browser playground & simulator
```

## Key Design Principles

1. **Opt-in complexity** — The runtime runs with zero config beyond `doc + llm + tools`. Middleware, guardrails, tracing, delegation, and parallel dispatch are all additive.

2. **URI-scheme tool dispatch** — Every tool target is a URI. The scheme determines which adapter handles it (`fn://`, `http://`, `mcp://`, `delegate://`). New protocols = new adapters.

3. **Event-driven observability** — Every internal action emits a typed `RuntimeEvent`. Consumers subscribe to what they care about. The tracing system is built on top of the same events.

4. **Isolation by default** — Delegated children get their own message history, preventing prompt pollution. State is shared but mutations are explicitly tracked and mergeable.

5. **Browser-first playground** — The simulator compiles and runs agents entirely client-side. No server needed beyond an LLM endpoint. MCP servers are reached via fetch + Vite proxy.
