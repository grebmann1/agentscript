# State/Graph Engine — Should We Adopt LangGraph?

**Status:** review only. No code or `ROADMAP.md` has been changed.
**Question:** can the state/graph layer of `@agentscript/runtime` be replaced by an alternative engine like LangChain / LangGraph.js?
**Reviewers (parallel):** Architect A (semantic mapping), Architect B (migration cost & risks), Researcher (LangGraph + alternatives in May 2026).

---

## TL;DR — unanimous

**Do NOT replace the state/graph layer with LangGraph.js.** All three architects independently arrived at the same verdict for overlapping reasons:

1. **Semantic mismatch.** AgentScript executes a *pre-compiled, declarative IR*. LangGraph models *graph topology*. Our four-phase ReAct loop (`before_reasoning` → reasoning iterations → `after_all_tool_calls` → `after_reasoning`) lives **inside** a single node. LangGraph has no native concept for sub-loop phases. We'd embed the entire current loop inside one custom node and lose every benefit LangGraph offers.
2. **Net code grows, not shrinks.** ~250 lines could be replaced; **~1,500 lines of new bridge code** would be needed. **Net: +1,250 lines, worse separation of concerns.**
3. **Edge/browser readiness regresses.** 4 open Cloudflare-Workers / edge bugs against LangGraph.js (#1692 Postgres+Redis checkpointers break, #1494 EventTarget memory leak, #1295 useStream proxy, #1147 BadRequestError on tool calls). Our runtime works across Node/Bun/Workers/Deno/browser today.
4. **No precedent.** AutoGen, Burr (DAGWorks), OpenAI Swarm, Semantic Kernel, Promptflow, Juglans — none use LangGraph as a runtime. They all build custom executors. There's a reason: LangGraph is for dynamic graph construction, not IR execution.
5. **Cloud drift.** LangGraph docs increasingly position the managed *LangGraph Platform* for production "stateful workflows." The library may evolve toward cloud features that don't help an embeddable runtime.

**Recommendation:** stay bespoke. **Borrow patterns** from LangGraph for two roadmap items only — the interrupt API for HITL (#22) and the checkpoint serialization shape for `CheckpointStore.migrate` (#15) — without taking the dependency.

---

## Concept-by-concept fit

| AgentScript concept | LangGraph primitive | Fit | Why |
|---|---|---|---|
| `subagent` node | StateGraph node | medium | Each maps, but our nodes carry rich phase metadata that LangGraph nodes don't |
| `state_variables` (Internal/Context) | channels + reducers | partial | Internal fits; **Context (read-only) doesn't** — channels are all mutable |
| `bound_inputs` (templated) | tool arg preprocessing | poor | Lazy eval at dispatch; LangGraph receives args at node entry |
| `state_updates` post-tool | reducer functions | poor | Our updates are post-tool with `result.*` scope; LangGraph reducers fire on dispatch |
| `handoff` transition | conditional edge | medium | Map exists, but our handoffs fire in 4 phases inside a node |
| ReAct lifecycle hooks | node entry/exit + middleware | poor | No native equivalent for "before reasoning iteration" |
| `enabled` guards | conditional edge predicate | good | Clean match |
| Delegation (shared state) | subgraph + merge | partial | LangGraph subgraphs isolate state; we share it |
| Parallel dispatch | Send / fan-out | medium | Send exists, but failure policies + merge strategies don't |
| Guardrails (retry-with-feedback) | custom node loop | poor | Must nest entire LLM loop inside node |
| Structured output | `response_format` | good | Passthrough |
| Checkpointing | Checkpointer | good | API near-isomorphic |
| Tool registry | LangChain tools | good | Both scheme-based dispatch |
| Template `{{state.x}}` | (template renderer) | good | Independent of graph |
| AbortSignal mid-node | (none) | poor | Lose mid-LLM and mid-tool abort |
| Tracing (OTel) | LangSmith | good | LangSmith ingests our spans |

---

## Decision matrix

| Goal | Stay bespoke (today) | Adopt LangGraph | Adopt XState | Adopt Mastra | Inngest / Restate / Temporal |
|---|---|---|---|---|---|
| Edge/browser support | ✅ working | ⚠️ active bugs | ✅ excellent | ❓ unknown | ❌ requires server |
| Bundle size | ✅ ~15 KB | ❌ +500 KB transitive | ✅ <5 KB | ❓ | n/a |
| Pre-compiled IR fit | ✅ purpose-built | ❌ topology mismatch | ⚠️ generic | ⚠️ DSL-flavored | ❌ workflow-flavored |
| AbortSignal mid-node | ✅ 5 checkpoints | ❌ not supported | ✅ supported | ❓ | ✅ |
| Checkpointing | ✅ ours | ✅ included | ❌ none | ✅ included | ✅ included |
| HITL interrupts | ❌ on roadmap | ✅ included | ⚠️ DIY | ✅ included | ✅ |
| Maintenance burden | medium (we own it) | low (community) | low | low | low |
| License risk | none | MIT clean | MIT | unclear | mixed |
| Lock-in risk | none | medium (cloud drift) | none | medium | high (server req'd) |
| Migration days | 0 | 20-25 | 15-20 | unknown | n/a |

**Stay bespoke** wins 6 of 10 rows. The two it loses on (HITL, community maintenance) are addressable by **borrowing patterns**, not by replacing the engine.

---

## Per-reviewer findings

### Architect A — Semantic mapping

**Cleanly mappable (~250 lines of our code):**
- Checkpointing → LangGraph `Checkpointer` (drop-in)
- Graph loading → StateGraph node registration
- `enabled` guards → conditional edge predicates
- Tool registry → LangChain tool wrappers
- Structured output → `responseFormat` passthrough
- Tracing → LangSmith integration

**Awkward to map (~1,500 lines of new bridge code):**
- **Lifecycle phases** (`runtime.ts:314-573`): four-phase ReAct loop is *inside* one node. LangGraph nodes are functions; we'd embed our entire loop inside a custom node and bypass LangGraph's value.
- **State visibility** (`state/store.ts:60-64`): Context (linked) variables are read-only. LangGraph channels are all mutable — we'd wrap with our own visibility tracker.
- **Bound inputs + template interpolation** (`steps/run-steps.ts:109-126`): lazy expression eval at tool dispatch time. LangGraph tools receive args before node execution.
- **Guardrail retry loop** (`runtime.ts:778-916`): wraps the LLM, injects feedback, retries — must nest the *entire* reasoning loop inside a node.
- **Delegation with state merging** (`runtime.ts:940-1154`): parent ↔ child shared state with `last-wins` / `error-on-conflict` policies. LangGraph subgraphs isolate state.
- **Parallel failure policies** (`runtime.ts:1605-1680`): `fail-fast` vs `wait-all` + state merge. LangGraph Send/Join doesn't directly support these.

**Bottom line:** LangGraph excels at *graph topology*. AgentScript's IR is *declarative* — phases, guards, and state updates are **data inside the IR**, not graph topology. Forcing declarative IR through a topology framework requires recompiling IR into graph nodes, which is exactly the bridge layer we'd be writing.

### Architect B — Migration cost

**Effort: 20-25 engineer-days (2-3 weeks at capacity).**
Critical path: IR→StateGraph compiler (3-5 d) → turn-loop refactor (5 d) → checkpointer bridge (4 d) → integration & test migration (5-8 d).

**What stays vs replaced:**

| Subsystem | Verdict | Effort |
|---|---|---|
| `graph/load.ts` (52 LOC) | **REPLACE** | XS |
| `state/store.ts` (109 LOC) | **REPLACE** | XS |
| ReAct loop (`runtime.ts:223-620`) | **REPLACE** logic, embed in custom node | L |
| `checkpoint/*` | **KEEP, write bridge adapter** | M |
| `delegation/*` | **KEEP, rewrite as nested invoke** | M |
| `parallel/*` | **KEEP, wire to RunnableParallel** | S |
| `guardrails/*` | **KEEP, runs inside a node** | S |
| `tools/*` | **KEEP untouched** | — |
| `llm/types.ts` | **KEEP, wrap to LangChain Message** | XS |
| `middleware/*` | **KEEP, weave into nodes** | S |
| `tracing/*` | **KEEP** | XS |
| `structured-output/*` | **KEEP** | — |
| Tests (179) | **rewrite suite** | M-L |

**Top 3 show-stoppers (any one kills migration):**
1. **`@langchain/core` has hard Node-only deps** (`fs`, `node:crypto`). If `npm ls` confirms, edge/browser breaks. Spike this in week 1.
2. **No mid-graph AbortSignal interruption.** LangGraph.js cannot interrupt a node mid-execution. We'd lose abort guarantees we have today (5 checkpoints in `runtime.ts:248+`). Unacceptable for production safety.
3. **Checkpointer schema incompatibility.** If LangGraph's checkpoint format can't express delegation frames + handoff state without major schema extension, migration cost roughly doubles.

**Functionality lost:** fine-grained phase events (`phase-start: before_reasoning_iteration`); mid-LLM and mid-tool-dispatch abort.

**Hybrid options considered and rejected:**
- *Adopt only LangGraph's Checkpointer:* low value — we'd still own the ReAct loop and lose schema flexibility.
- *Adopt only LangGraph's Interrupts for HITL:* minimal ROI — our delegation+parallel already solve adjacent problems differently.

### Researcher — LangGraph and alternatives in May 2026

**LangGraph.js current state:**
- v1.3.0, 2.9k stars, 313 releases, MIT — https://github.com/langchain-ai/langgraphjs
- Production users: Klarna (85 M users), Uber, LinkedIn, Replit, Elastic.
- Edge support: 4 open issues; SQLite/Postgres checkpointers break in Cloudflare Workers — https://github.com/langchain-ai/langgraphjs/issues?q=cloudflare+workers
- Bundle: peer-dep on `@langchain/core` (^1.1.44) and `zod`; tree-shaking unclear; multiple export points (`./web`, `./channels`, `./pregel`, `./prebuilt`).
- HITL/interrupts: supported.
- Vercel AI SDK integration: NOT native (open feature request #1305 since June 2025).
- Cloud drift: docs prominently push the managed LangGraph Platform for production.

**Alternatives surveyed:**

| Engine | Stars | Edge fit | License | Verdict |
|---|---|---|---|---|
| **XState** | 29.6k | excellent (zero deps) | MIT | Generic state machines — would still need agent orchestration on top |
| **Mastra workflows** | 24k | unclear | unclear | Agent-native, no edge evidence |
| **Inngest** | 949 | works on Workers | unclear | **Fully hosted** — cannot embed |
| **Restate** | 106 | no | unclear | Requires Restate Server |
| **Temporal TS SDK** | — | no | — | Requires Temporal Service |
| **Vercel AI SDK Agents** | — | excellent | Apache | No persistent checkpointing or graph execution |
| **Roll-our-own (today)** | — | excellent | MIT | 370 LOC; works everywhere; full control |

**Precedent check:** AutoGen, Burr (DAGWorks), OpenAI Swarm, Semantic Kernel, Promptflow, Juglans — *none* use LangGraph as a runtime; all build custom executors.

**Verdict:** Do not adopt. If you later want specific patterns (interrupts, checkpoint schema), borrow inspiration. If you ever want a state-machine primitive, **XState** is the only edge-friendly mature library — but you don't actually need one for IR execution.

---

## Consolidated recommendation

1. **Do not replace the state/graph layer.** The IR-to-topology mismatch is structural, not incidental. Migration would cost 20-25 days, add ~1,250 lines, regress edge support, and lose mid-node abort.
2. **Borrow specific patterns from LangGraph without depending on it:**
   - **Interrupt API design** as a reference for the `RequireConfirmation` HITL feature (`#22` on the roadmap).
   - **Checkpoint serialization shape** as a reference for `CheckpointStore.migrate()` (`#15` on the roadmap).
3. **Reframe the runtime's identity.** The 2,217 lines of `runtime.ts` aren't tech debt to outsource — they're a domain-specific compiled-IR ReAct engine. The PM's "differentiation" critique from the prior review and this analysis agree: the bespoke engine is a feature.
4. **Lock down edge readiness as a first-class invariant.** The roadmap's `dist-in-browser` test (promoted to Must in the last review) defends this differentiation.

## Roadmap implications

Add to `ROADMAP_REVIEW.md` (Architecture missing-items list):

- **🆕 A6 — ADR: do not adopt LangGraph for state/graph; pattern-borrow only.** Capture the decision so a future contributor doesn't redebate it. (Should · S, doc)

Modify two existing items:

- **#22 RequireConfirmation pause/resume.** Note: API surface should mirror LangGraph's interrupt design (`interrupt()` inside a node yields a resumable token); we don't take the dependency.
- **#15 CheckpointStore.migrate.** Note: reference LangGraph's checkpoint payload shape when designing migration semantics (versioned tuple of `{ values, channel_versions, versions_seen, pending_sends }`); we don't take the dependency.

## Citations (Researcher)

- LangGraph.js repo: https://github.com/langchain-ai/langgraphjs
- LangGraph.js Cloudflare Workers issues: https://github.com/langchain-ai/langgraphjs/issues?q=cloudflare+workers
- Langgraph-core README (Platform positioning): https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/README.md
- XState: https://github.com/statelyai/xstate
- Mastra: https://github.com/mastra-ai/mastra
- Inngest TS SDK: https://github.com/inngest/inngest-js
- Restate TS SDK: https://github.com/restatedev/sdk-typescript
- Temporal TS SDK docs: https://docs.temporal.io/typescript/introduction/
- Vercel AI SDK: https://github.com/vercel/ai
- AutoGen: https://github.com/microsoft/autogen
- Burr (DAGWorks): https://github.com/dagworks-inc/burr
- OpenAI Swarm: https://github.com/openai/swarm
- Juglans: https://github.com/juglans-ai/juglans

## Critical files referenced

- `packages/runtime/src/graph/load.ts` (52 lines)
- `packages/runtime/src/state/store.ts` (109 lines, Internal/Context visibility at lines 60-64)
- `packages/runtime/src/steps/run-steps.ts` (210 lines, `evalBoundValue` at 109-126, `isEnabled` at 57-67)
- `packages/runtime/src/turn/runtime.ts` (2,217 lines: ReAct phases at 314-573, guardrail loop at 778-916, delegation at 940-1154, parallel at 1605-1680, abort checkpoints around 248+)
- `packages/runtime/src/checkpoint/types.ts` (`CHECKPOINT_SCHEMA_VERSION`)
