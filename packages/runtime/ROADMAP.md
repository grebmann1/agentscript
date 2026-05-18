# `@agentscript/runtime` — Roadmap

Synthesized from the architecture review at `~/.claude/plans/spawn-a-team-of-compiled-simon.md`.

Status today: **179/179 tests pass.** ReAct loop, abort handling, delegation, parallel dispatch, guardrails, structured output, tracing, and checkpoints all work. The gaps below are correctness (silent drops vs SPEC), API depth (driver contract too thin for real providers), and production hardening (observability, error taxonomy).

---

## Roadmap at a glance

### Must-have — correctness / parity blockers

| # | Item | File(s) | Effort | Why |
|---|---|---|---|---|
| 1 | Wire up `RouterNode` (or fail loud) | `src/graph/load.ts:32` | M | Compiler emits Router/BYON nodes; runtime silently drops → silent agent failure |
| 2 | Validate action definitions at graph load | `src/graph/load.ts` | S | Today undefined action refs only fail at dispatch, after debug noise |
| 3 | Inject `@system_variables.user_input` into step scope | `src/steps/run-steps.ts`, `src/turn/runtime.ts` | S | SPEC §12 requires it; users smuggle via linked context today |
| 4 | Update README — stop claiming AbortSignal / OTel are deferred | `README.md` | XS | Both ship; readme misleads adopters |

### Should-have — feature parity + maintainability

| # | Item | File(s) | Effort | Why |
|---|---|---|---|---|
| 5 | Split `runtime.ts` god class into `TurnOrchestrator` / `ToolDispatcher` / `DelegationManager` / `GuardrailManager` | `src/turn/runtime.ts` (2217 lines) | L | De-duplicate 3 tool-dispatch paths; isolate concerns |
| 6 | Pre-compile bound-value expressions at load time | `src/graph/load.ts`, `src/steps/run-steps.ts` | M | `evalBoundValue` re-parses every dispatch; hot path |
| 7 | Implement `on_init` / `on_exit` hooks | `src/steps/run-steps.ts`, `src/turn/runtime.ts` | M | Listed in SPEC, missing today |
| 8 | Implement `end_turn_first` on handoff | `src/turn/runtime.ts` | S | Handoff semantics gap |
| 9 | Add per-iteration reasoning limit (`maxReasoningIterations`) | `src/turn/runtime.ts` | S | Only `maxStepsPerTurn` exists today |
| 10 | Multimodal `Msg` content (image/audio/file parts) | `src/llm/types.ts`, `packages/runtime-vercel/src/driver.ts` | M | Vision agents (Claude vision, GPT-4V, Bedrock) blocked |
| 11 | Token usage on `StepEvent` (`prompt`/`completion`/`reasoning`) | `src/llm/types.ts` | S | Drivers can't report mid-stream cost |
| 12 | `toolChoice` field on `LlmStepInput` (`'required' \| 'auto' \| { name }`) | `src/llm/types.ts` | S | Middleware can't force/forbid tools before LLM call |
| 13 | Thread `AbortSignal` into `FnAdapter` + document contract | `src/tools/fn-adapter.ts`, `src/tools/registry.ts` | S | Only `HttpAdapter` respects signal today |

### Nice-to-have — production hardening

| # | Item | File(s) | Effort | Why |
|---|---|---|---|---|
| 14 | `ErrorCode` enum + structured `Logger` interface in `RuntimeOptions` | new `src/error-codes.ts`, `src/logging/types.ts` | M | Today only EventBus; no machine-readable categorization |
| 15 | `CheckpointStore.migrate(checkpoint, toVersion)` + migration path | `src/checkpoint/types.ts`, `src/checkpoint/memory-store.ts` | M | Bumping `CHECKPOINT_SCHEMA_VERSION` breaks all stored checkpoints |
| 16 | Enrich `OnErrorContext` (msg-history snapshot, llm request) | `src/middleware/types.ts` | S | Audit/incident logging blind today |
| 17 | MCP adapter (`mcp://` scheme) | new `packages/runtime-mcp` | L | Unblocks MCP tool ecosystem |
| 18 | Per-tool timeout / retry / circuit-breaker adapter wrapper | new `src/tools/resilience.ts` | M | Today only call-count budget |
| 19 | `BatchingSpanExporter` + retry/backpressure for OTLP | `src/tracing/exporters/batching.ts` | M | OTLP exporter is one-POST-per-export today |
| 20 | Subgraph tools (agent-as-tool nesting) | `src/turn/runtime.ts`, `src/tools/registry.ts` | L | Enables recursion / hierarchical agents |
| 21 | Implement `pre_tool_calls` / `post_tool_calls` per-tool hooks | `src/turn/runtime.ts`, `src/steps/run-steps.ts` | M | Today only global middleware |
| 22 | `RequireConfirmation` pause/resume primitive | `src/turn/runtime.ts`, `src/checkpoint/*` | L | Human-in-the-loop pattern blocked |
| 23 | Pre-emit prompt-caching hints (Anthropic / Bedrock) | `src/llm/types.ts`, `packages/runtime-vercel/src/driver.ts` | M | No way to mark cacheable prefixes today |

### Tests to add

| # | Test | File | Why |
|---|---|---|---|
| 24 | EventBus listener accumulation across N turns | `test/memory-leaks.test.ts` (new) | Cleanup at `runtime.ts:227,624` is correct but unverified |
| 25 | Checkpoint mid-parallel-delegation, abort during restore | extend `test/checkpoint.test.ts` | Concurrency interaction untested |
| 26 | Streaming break mid-delta (graceful degradation) | `test/streaming-recovery.test.ts` (new) | No fault-tolerance test today |
| 27 | Memory/leak stress (100 turns, watch listeners + spans + heap) | `test/memory-leaks.test.ts` (new) | Confidence for long-lived processes |
| 28 | Deep-recursion delegation (10+ levels) | extend `test/delegation-integration.test.ts` | No recursion stress today |
| 29 | `dist/` runs in browser/edge (jsdom or edge-runtime sandbox) | `test/dist-browser.test.ts` (new) + CI | Edge readiness verified by inspection only |
| 30 | Bundle-size CI gate (warn if `dist/index.js` > 100KB gzipped) | `scripts/bundle-size.mjs` + CI | Prevent silent bloat |

---

## Suggested execution order

1. **Cheap wins first (1 day):** items 4 (README), 13 (signal in FnAdapter), 11 (token usage), 12 (toolChoice). Low risk, high adopter visibility.
2. **Correctness (3-5 days):** items 1, 2, 3. Closes silent-failure gaps vs SPEC.
3. **Driver depth (1-2 weeks):** items 10, 23. Enables real production providers (vision, prompt caching).
4. **Refactor (1-2 weeks):** item 5. Pays back across every subsequent feature.
5. **Hardening (parallel):** items 14, 15, 16, 19. Production readiness.
6. **Long tail:** items 17, 20, 21, 22 — feature parity with the Salesforce-internal `module-graph-runtime`.

## Effort key

- **XS** = < 1 hour
- **S** = a few hours
- **M** = 1-2 days
- **L** = 3+ days

## References

- Full architectural review: `~/.claude/plans/spawn-a-team-of-compiled-simon.md`
- Parity target: `chatbots/module-graph-runtime` (Salesforce-internal)
- SPEC: `../../SPEC.md`
