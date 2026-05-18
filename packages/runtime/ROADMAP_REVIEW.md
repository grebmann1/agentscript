# `@agentscript/runtime` Roadmap — Cross-Functional Review

**Status:** review only. No edits to `ROADMAP.md` have been applied. Use this document to decide which changes to accept.

**Round 1** produced `ROADMAP.md` (30 items, 4 sections).
**Round 2** (this document) is a 4-person re-review: **Architect**, **Researcher** (web/market trends 2026), **Engineer**, **PM**.
**Round 3** added an architectural decision: state/graph engine. See **A6** below and the dedicated review at [`STATE_GRAPH_ALTERNATIVES.md`](./STATE_GRAPH_ALTERNATIVES.md).
**Round 4** added LLM SDK driver strategy (V1-V7). See dedicated review at [`SDK_DRIVERS_REVIEW.md`](./SDK_DRIVERS_REVIEW.md). Today only `runtime-vercel` ships first-party; this round identified 5 missing drivers (Anthropic, OpenAI, Google, MCP, Bedrock) plus 7 contract gaps (G1-G7) that must be sequenced before the second driver.

---

## TL;DR

1. **The roadmap is engineering-strong, product-weak.** It correctly catalogs internal hygiene but under-invests in adopter-facing features. ~22 of 30 items are invisible to a developer landing on the README.
2. **MCP is the single biggest miss.** All four reviewers flag MCP adapter (#17, Nice-to-have, L) as wrongly ranked. The TypeScript MCP SDK has 12.4k stars / 94 releases / adoption by Cursor, Replit, Sourcegraph, Mastra. **Promote to Must-have.**
3. **Multimodal `Msg` is bigger than M effort.** Engineer flags ripple to checkpoints, history truncation, guardrails, every middleware context, and the Vercel driver. Realistic: **L** (split into 10a/b/c). Researcher + PM concur on **Must-have**.
4. **Sequencing is wrong.** Pre-compile expressions (#6) must precede god-class split (#5). `CheckpointStore.migrate` (#15) must precede *any* schema-bearing change like multimodal.
5. **Docs is missing as a category.** Zero quickstart, zero recipes, no `examples/`. PM ranks this as the highest-leverage adoption gap. We're adding a full **Docs & DX** section with 4 items, 2 at Must-have.
6. **State/graph engine: stay bespoke (Round 3).** A 3-architect team unanimously rejected adopting LangGraph.js — semantic mismatch (declarative IR vs graph topology), net +1,250 LOC of bridge code, edge-runtime regressions, no precedent (AutoGen/Burr/Swarm/Semantic Kernel/Juglans all roll their own). Borrow patterns only (interrupt API for #22, checkpoint shape for #15). Captured as **A6**.
7. **LLM SDK coverage is too narrow (Round 4).** Today only `runtime-vercel` ships. Through it the runtime can technically reach 40+ providers, but loses each provider's killer features (Anthropic prompt caching + extended thinking, OpenAI Responses API + o1/o3 reasoning, Google grounding + Live API, Bedrock guardrails + IAM, MCP tools). Five new first-party drivers should ship as a single hybrid `@agentscript/runtime-providers` package with conditional sub-module entry points. Captured as **V1-V7**.

---

## Per-item POV table

**Legend:** `✓` keep · `↑M` promote to Must · `↑S` promote to Should · `↓N` demote to Nice · `✗` cut/defer · `+L`/`+M`/`+S` resize effort · `–` not addressed.

### Existing roadmap items

| # | Item | Architect | Researcher | Engineer | PM | Consensus |
|---|---|---|---|---|---|---|
| 1 | Wire up `RouterNode` (or fail loud) | ✓ Must | – | ✓ Must | ↓ — "fix after we have users" | ✓ Must (3-of-4) |
| 2 | Validate action defs at graph load | ✓ Must (do first) | – | ✓ Must | – | ✓ Must |
| 3 | Inject `@system_variables.user_input` | ✓ Must | – | ✓ Must | – | ✓ Must |
| 4 | Update README (AbortSignal/OTel ship) | ✓ Must (30 min) | – | ✓ Must | ✓ Must | ✓ Must |
| 5 | Split `runtime.ts` god class | ✓ Must (split first) | – | ✗ defer; `+L+`; do AFTER #6 | ✗ gold-plating | **Should (defer until features hurt)** |
| 6 | Pre-compile bound expressions | ✓ Must (do FIRST, before #5) | – | ✓ Must (do before #5) | – | ✓ Should (re-sequenced before #5) |
| 7 | `on_init` / `on_exit` hooks | ✓ Should | – | ✓ Should | – | ✓ Should |
| 8 | `end_turn_first` on handoff | ✓ Should | – | ✓ Should | – | ✓ Should |
| 9 | Per-iteration reasoning limit | ✓ Should | – | ✓ Should | – | ✓ Should |
| 10 | Multimodal `Msg` content | ✓ Should | ✓ Should (matches Vercel AI SDK) | ↑M, **+L** (split 10a/b/c) | ↑M | **↑M, +L (split a/b/c)** |
| 11 | Token usage on `StepEvent` | ✓ Should | ✓ Should (Anthropic ships, OpenAI o3, DeepSeek R1) | ✓ Should | – | ✓ Should |
| 12 | `toolChoice` on `LlmStepInput` | ✓ Should | ✓ Should (universal in 2026) | ✓ Should | – | ✓ Should |
| 13 | AbortSignal in `FnAdapter` | ↑M (correctness bug) | – | ↑M (correctness bug) | – | **↑M** |
| 14 | `ErrorCode` enum + Logger | ✗ enum (typed errors ARE the enum); keep Logger only | – | – | ✗ low-value | **Reduce: drop enum, keep `Logger` interface (S)** |
| 15 | `CheckpointStore.migrate` | ↑M (must precede any schema bump) | ↑S | ↑M (must ship before #10) | ✗ premature, no users | **↑M** (3-of-4; PM accepts as prerequisite for #10) |
| 16 | Enrich `OnErrorContext` | ✓ Nice | – | ✓ Nice | – | ✓ Nice |
| 17 | MCP adapter (`mcp://`) | ↓ "sibling pkg" | ↑M (table-stakes 2026) | ↑M | ↑M | **↑M** (PM/Researcher/Engineer; sibling pkg is implementation detail) |
| 18 | Per-tool timeout/retry/circuit breaker | ✓ Nice | – | ✓ Nice | – | ✓ Nice |
| 19 | BatchingSpanExporter for OTLP | ✓ Nice | – | – | ✗ premature | **Defer** |
| 20 | Subgraph tools (agent-as-tool) | ↑S, **+S** (1hr; expose existing delegations) | ✓ Nice | – | ↑M (killer feature) | **↑S, +S (re-scope)** |
| 21 | `pre_tool_calls` / `post_tool_calls` per-tool hooks | ✓ Nice | – | ✓ Nice | – | ✓ Nice |
| 22 | `RequireConfirmation` pause/resume | ✓ Nice | ↑S (LangGraph/Mastra ship HITL) | ✓ Nice | ↑M (killer feature) | **↑S** |
| 23 | Prompt-caching hints | ✓ Nice | ↑S (~10× cost savings, GA in Anthropic SDK) | – | ↑M | **↑S** |

### Tests

| # | Item | Architect | Researcher | Engineer | PM | Consensus |
|---|---|---|---|---|---|---|
| 24 | EventBus listener accumulation test | ✓ | – | ✓ | – | ✓ |
| 25 | Mid-parallel-delegation checkpoint test | ✓ | – | ✓ | – | ✓ |
| 26 | Streaming break mid-delta test | ✓ | – | ✓ | – | ✓ |
| 27 | 100-turn memory stress | – | – | ✓ but flaky without baseline | ✗ premature | **Defer** |
| 28 | Deep-recursion delegation | – | – | ✓ but needs configurable depth limit first | ✗ premature | **Defer until issue filed** |
| 29 | dist-in-browser smoke test | – | ✓ defends edge differentiation | ✓ but **+M** not S | ↑M (defends differentiation) | **↑M, +M** |
| 30 | Bundle-size CI gate | ✓ | – | ✓ | ✗ "too small for roadmap; just add to CI" | **Move to repo CI, not roadmap line item** |

### New items proposed by reviewers

| # | Item | Source | Bucket / effort | Notes |
|---|---|---|---|---|
| 🆕 A1 | IR versioning / schema-evolution policy | Architect | Should · S (doc) | loadGraph silently drops Router/BYON today |
| 🆕 A2 | Tool adapter ABI versioning + capability discovery | Architect | Should · M | Third-party adapters can break silently on runtime upgrade |
| 🆕 A3 | Checkpoint restore semantics for in-flight delegations | Architect | Should · M | Resume vs restart; spec gap |
| 🆕 A4 | LlmDriver streaming-fault contract | Architect | Should · S (doc + test) | Mid-stream error / consumer-drops behavior |
| 🆕 A5 | Pre-commit / CI scan for forbidden Node imports in `dist/` | Architect | Should · S | Prevents accidental edge-break |
| 🆕 A6 | **ADR: do not adopt LangGraph for state/graph; pattern-borrow only** | Round-2 architect team (unanimous) | Should · S (doc) | See `STATE_GRAPH_ALTERNATIVES.md`. Migration would be +1,250 LOC, regress edge support, lose mid-node abort. Borrow LangGraph's interrupt API design (#22) and checkpoint payload shape (#15) without taking the dependency. |
| 🆕 V1 | `@agentscript/runtime-providers` package skeleton + conformance suite | Round-4 driver team | Should · S | See `SDK_DRIVERS_REVIEW.md`. Single workspace package with conditional sub-module exports + optional peer deps. Lands after G1-G4 contract changes ship in core. |
| 🆕 V2 | **Anthropic driver** (`@anthropic-ai/sdk` direct) | Round-4 driver team | Must · M | First validation of multi-driver contract. Unlocks prompt caching with `cache_control`, extended thinking blocks, encrypted reasoning signatures, MCP connectors. |
| 🆕 V3 | **OpenAI driver** (Responses API path) | Round-4 driver team | Must · M | Stateful sessions, o1/o3 reasoning + budget, Realtime WSS audio, hosted server tools (`web_search`, `file_search`, `code_interpreter`). Covers Groq/Together/xAI/DeepSeek/Fireworks/Azure OpenAI as a side-effect via custom baseURL. |
| 🆕 V4 | Google Gen AI driver (`@google/genai` v2) | Round-4 driver team | Should · M | Gemini Live API (WSS audio/video), `thinkingLevel`/`thinkingBudget`, Search grounding with `groundingMetadata` citations, Imagen. Validates G5 (thinking events). |
| 🆕 V5 | Bedrock driver (`@aws-sdk/client-bedrock-runtime`) | Round-4 driver team | Should · M | Converse/ConverseStream unified API, `ApplyGuardrail`, IAM role auth. **Edge-incompatible** — uses Node `crypto`; document this caveat clearly. |
| 🆕 V6 | Ollama driver (`ollama-js`) | Round-4 driver team | Nice · S | Local/offline dev DX, no API keys, `ollama/browser` module supported. |
| 🆕 V7 | Cloudflare Workers AI documentation | Round-4 driver team | Should · XS | No npm SDK; uses `env.AI` binding. Add a runtime example in `runtime-providers/README.md`, no separate driver. |
| 🆕 G1 | Multimodal `Msg` content (extends roadmap #10) | Round-4 architect | Must · M | `TextMsg.content: string` → `string \| Array<{ type: 'text' \| 'image' \| 'audio' \| 'document', ... }>`. **Blocker** for V2/V3/V4. |
| 🆕 G2 | `toolChoice` field on `LlmStepInput` (extends roadmap #12) | Round-4 architect | Must · S | `'auto' \| 'none' \| 'required' \| { name }`. Required for Anthropic/OpenAI/Bedrock parity. |
| 🆕 G3 | Prompt-cache hints on messages/tools (extends roadmap #23) | Round-4 architect | Must · S | `cacheHints?: { type, ttl? }` per-message or per-tool. Required for Anthropic ephemeral, OpenAI cached input, Bedrock prompt cache. |
| 🆕 G4 | Token usage on `StepEvent.finish` (extends roadmap #11) | Round-4 architect | Must · S | `usage?: { promptTokens, completionTokens, cacheReadTokens?, cacheCreateTokens?, reasoningTokens? }`. Required for cost dashboards across all providers. |
| 🆕 G5 | Reasoning / thinking deltas on `StepEvent` | Round-4 architect | Should · S | `{ kind: 'thinking' \| 'thinking-delta', text }`. Surfaces Anthropic extended thinking + OpenAI o1/o3 reasoning. |
| 🆕 G6 | Streaming-granularity contract + conformance test | Round-4 architect | Should · S | Today `runtime-vercel/src/driver.ts:86` buffers entire response into one delta. Document: drivers MUST emit one `text-delta` per server-sent chunk; conformance suite enforces. |
| 🆕 G7 | Server-tool reporting (`source: 'user' \| 'builtin'` on `ToolCall`) | Round-4 architect | Should · S | Lets drivers surface `computer_use`, `file_search`, `grounding`, `retrieve_and_generate` as pseudo tool calls without us executing them. |
| 🆕 E1 | `@stable` / `@experimental` JSDoc + `STABILITY.md` | Engineer | Must · S | OSS expects stability markers at 1.0 |
| 🆕 E2 | Type-tests via `tsd` / `expect-type` | Engineer | Should · M | Generic types untested |
| 🆕 E3 | Determinism / replay mode (`RuntimeOptions.seed` + IO capture) | Engineer | Nice · M | Local replay for debugging |
| 🆕 E4 | Rate-limit / 429 handling in driver layer | Engineer | Should · S | Vercel driver bubbles unhandled |
| 🆕 E5 | Changelog tooling (changesets) | Engineer | Must · S | Inevitable v0 → v1 break |
| 🆕 P1 | Success metrics dashboard (npm DL, stars, ext PRs, TTFS) | PM | Should · — | Defines "did the roadmap work?" |
| 🆕 D1 | "Anthropic + Cloudflare Workers" quickstart | PM | **Must · S** | Single highest-leverage adoption gap |
| 🆕 D2 | `examples/` dir with 3-4 runnable agents | PM | **Must · M** | Required for `npm install` to convert |
| 🆕 D3 | TypeDoc API reference | PM | Should · S | Generated from types |
| 🆕 D4 | AgentScript-by-example tutorial | PM | Should · M | SPEC is too dense to onboard from |

---

## Per-reviewer findings (full prose)

### Architect

**Items they got wrong:**
- **#5 split boundary is wrong.** Should be `TurnOrchestrator` / `ToolDispatcher` / `MiddlewareRunner` / `GuardrailManager`. Delegation is not a separate manager — it's a method on `TurnOrchestrator` that spins up a recursive `Runtime` in a sub-context.
- **#14 ErrorCode enum is overspecified.** Existing typed errors (`AbortError`, `DelegationDepthError`, etc.) ARE the categorization. What's missing is a structured logger.
- **#17 MCP adapter belongs in a sibling package** (`@agentscript/runtime-mcp`), not on the runtime roadmap. (Note: PM/Researcher/Engineer disagree — they think MCP should be Must-have regardless of package boundary; the Architect's point is package layout, not priority.)
- **#20 subgraph tools is a false economy.** Delegations already do agent-as-tool — just expose them in the registry. 1 hour, not L.

**Hidden dependencies:**
- **#5 blocks or is unblocked by #6.** `evalBoundValue` re-parses on every dispatch (53 call sites in `runtime.ts`). Pre-compile first, then refactor — otherwise duplicate caching logic.
- **#15 (checkpoint migration) is a breaking-change risk that cannot be retrofitted.** Bumping `CHECKPOINT_SCHEMA_VERSION` from 1 today orphans every existing checkpoint. Must precede #10 (multimodal) and any other schema-bearing change.
- **#13 (AbortSignal in `FnAdapter`) is a ticking compat bomb.** `FnAdapter.invoke` ignores `signal` (`src/tools/fn-adapter.ts:23-32`). The runtime claims to abort but `FnAdapter` violates that claim. **Move to Must-have or document the gap loudly.**

**Missing architectural items:**
- IR versioning / schema-evolution policy (`loadGraph` silently drops Router/BYON at `graph/load.ts:32`).
- Tool adapter ABI versioning + capability discovery.
- Checkpoint restore semantics for in-progress delegations (resume vs restart).
- LlmDriver streaming-fault contract (mid-stream errors, consumer drops iterator, malformed deltas).
- Pre-commit / CI gate that scans `dist/` for forbidden imports (today edge-readiness is "verified by inspection").

**Recommended re-order:**
1. README (#4) — 30 min cleanup.
2. Action validation (#2), RouterNode (#1), `@system_variables.user_input` (#3) — correctness.
3. **Pre-compile expressions (#6) FIRST**, then **god-class split (#5)** — *do not* split before pre-compile.
4. Features (#7-13) in parallel on the cleaner ToolDispatcher.

### Round 3 — State/Graph engine (3-architect team, unanimous)

A separate parallel review investigated whether to replace the state/graph layer with LangGraph.js or an alternative engine. **Verdict: stay bespoke; borrow patterns only.** Full review at [`STATE_GRAPH_ALTERNATIVES.md`](./STATE_GRAPH_ALTERNATIVES.md). Captured here as item **A6**.

Five reasons (all three reviewers agreed):
1. **Semantic mismatch.** Our four-phase ReAct loop (`before_reasoning` → reasoning iterations → `after_all_tool_calls` → `after_reasoning`) lives *inside* one node. LangGraph models *graph topology* — no native concept for sub-loop phases.
2. **Code grows, not shrinks.** ~250 LOC replaced; ~1,500 LOC of bridge code added (visibility enforcement, lazy expression eval, guardrail nesting, delegation state-merge, parallel failure policies). **Net: +1,250 LOC.**
3. **Edge regressions.** 4 open Cloudflare Workers / edge bugs against LangGraph.js (#1692, #1494, #1295, #1147). Our runtime works there today.
4. **No precedent.** AutoGen, Burr (DAGWorks), OpenAI Swarm, Semantic Kernel, Promptflow, Juglans — *none* use LangGraph as their runtime. They all build custom executors.
5. **Cloud drift.** LangGraph docs increasingly position the managed *LangGraph Platform* — the library may evolve toward cloud features that don't help embedding.

Migration cost if attempted: **20-25 engineer-days**, with three potential show-stoppers: hard Node-only deps in `@langchain/core`, no mid-node `AbortSignal` interruption (we have 5 abort checkpoints today), and possible checkpointer schema incompatibility for delegation frames.

**Two patterns to borrow without depending:**
- **#22 RequireConfirmation pause/resume** → mirror LangGraph's `interrupt()` API design.
- **#15 CheckpointStore.migrate** → reference LangGraph's checkpoint payload shape (`{ values, channel_versions, versions_seen, pending_sends }`).

### Round 4 — LLM SDK driver coverage (3-person team)

A separate parallel review investigated which LLM SDKs and frameworks we should ship as first-party drivers beyond the existing `@agentscript/runtime-vercel`. **Verdict: ship five new drivers as a single hybrid `@agentscript/runtime-providers` package, but only after fixing seven contract gaps in core.** Full review at [`SDK_DRIVERS_REVIEW.md`](./SDK_DRIVERS_REVIEW.md). Captured here as items **V1-V7** (drivers) and **G1-G7** (contract changes).

**The five missing drivers, by priority:**
1. **Anthropic** (`@anthropic-ai/sdk`) — extended thinking, prompt caching, encrypted reasoning signatures, MCP connectors. Vercel flattens these.
2. **OpenAI** (`openai` v6, Responses API) — stateful sessions, o1/o3 reasoning, Realtime WSS audio, hosted server tools. Single driver also covers Groq/Together/xAI/DeepSeek/Fireworks/Azure OpenAI via custom baseURL.
3. **Google Gen AI** (`@google/genai` v2) — Gemini Live, `thinkingLevel`/`thinkingBudget`, Search grounding with citations, Imagen.
4. **MCP tool adapter** (`@modelcontextprotocol/sdk`) — universal tool bus; folds the existing roadmap item #17 into the providers package.
5. **Bedrock** (`@aws-sdk/client-bedrock-runtime`) — Converse/ConverseStream, `ApplyGuardrail`, IAM. **Edge-incompatible** (Node `crypto`); document the caveat.

**The seven contract gaps that block multi-SDK ergonomics** (`packages/runtime/src/llm/types.ts:6-65`):
- **G1** Multimodal `Msg` content (today text-only at `types.ts:8-11`) — **blocker for V2/V3/V4**.
- **G2** `toolChoice` field on `LlmStepInput` — required for Anthropic/OpenAI/Bedrock parity.
- **G3** Prompt-cache hints on messages/tools — Anthropic ephemeral, OpenAI cached input, Bedrock.
- **G4** Token usage on `StepEvent.finish` — required for cost dashboards across all providers.
- **G5** Reasoning / thinking deltas — Anthropic extended thinking, OpenAI o1/o3.
- **G6** Streaming-granularity contract — `runtime-vercel/src/driver.ts:86` today buffers entire response into one delta.
- **G7** Server-tool reporting — `computer_use`, `file_search`, `grounding`, `retrieve_and_generate`.

G1-G4 overlap with existing roadmap items #10/#11/#12/#23 — fixing them is sequencing, not net-new work. **G1-G4 must land before V2 (Anthropic).**

**Packaging strategy:** one workspace package `@agentscript/runtime-providers` with **conditional sub-module entry points** (`import { AnthropicDriver } from '@agentscript/runtime-providers/anthropic'`) and optional peer deps. Avoids 5+ separate packages and keeps tree-shaking honest. `runtime-vercel` stays as a sibling for broad-provider coverage.

**Conformance test suite** (re-exportable from `runtime-providers/test/conformance/`): five categories every driver must pass — yields finish, surfaces tool calls correctly, respects `AbortSignal`, propagates SDK errors, streams text-deltas with bounded latency.

**Skipped:** Mistral, Cohere, Mastra, OpenAI Agents SDK, LangChain `BaseChatModel`, Anthropic Agent SDK (doesn't exist standalone). Groq/Together/Fireworks/DeepSeek/xAI all OpenAI-API-compatible — covered by V3 via custom baseURL. Cloudflare Workers AI ships only an `env.AI` binding; doc-only (V7).

### Researcher (market trends, May 2026)

**MCP — critical miss in roadmap priority.**
Announced by Anthropic Nov 25 2024. Official TypeScript SDK: **12.4k stars, 1.8k forks, 94 releases** (May 2026). Adopted by Block, Apollo, Zed, Replit, Codeium, Sourcegraph, **Cursor**. Mastra ships built-in support.
- Source: https://www.anthropic.com/news/model-context-protocol
- Source: https://github.com/modelcontextprotocol/typescript-sdk
- Source: https://github.com/modelcontextprotocol/servers (hundreds of community servers)

The agentscript roadmap ranks MCP **#17 Nice-to-have / L effort.** Six months post-launch this is wrong by an order of magnitude. **Recommendation: Must-have or Should-have.**

**Multimodal `Msg` content — competitive standard.**
Vercel AI SDK fully supports `{ type: 'text' | 'image' | 'file', ... }` (https://ai-sdk.dev/docs/foundations/prompts). Anthropic SDK exposes `ThinkingBlock`, `ThinkingDelta`, structured content arrays in streaming (https://github.com/anthropics/anthropic-sdk-typescript/blob/main/api.md). **Roadmap rank Should-have / M is appropriate**, but Engineer's L re-estimate is correct.

**Prompt caching — mature, undervalued at Nice-to-have.**
Anthropic GA: `cache_control: { type: "ephemeral" }` or per-block breakpoints (up to 4). Min 1024-4096 tokens. Cache reads = 10% of base input; writes = 125-200%. Reads are **~10× cost savings on multi-turn** (https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching). **Promote to Should-have.**

**Token usage / streaming reasoning tokens — fragmented but advancing.**
Anthropic streams `MessageDeltaUsage` + `thinking_delta` events with separate reasoning token counts (https://platform.claude.com/docs/en/api/messages-streaming). DeepSeek R1 uses `<think>` tags. **Roadmap Should-have / S is correct** — forward-looking and necessary for cost dashboards.

**`toolChoice` — universal standard.**
Vercel AI SDK: `'auto' | 'required' | 'none' | { type: 'tool', toolName: string }` (https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling). Anthropic: `tool_choice: {"type": "any"}`. **Should-have / S is correct.**

**HITL / pause/resume — emerging standard.**
LangGraph.js: 2.9k stars, 313 releases, used by Uber/LinkedIn/GitLab/Replit (Klarna 85M users). Markets "human-in-the-loop approvals" + interrupts as core (https://github.com/langchain-ai/langgraphjs). Mastra ships suspend/resume (https://github.com/mastra-ai/mastra). **Promote #22 from Nice to Should.**

**Durable execution / checkpointing.**
LangGraph and Mastra both ship persistent checkpointing. Restate explicitly markets "Durable AI Agents" (https://github.com/restatedev/restate). Roadmap #15 (migration hook) is a hardening prerequisite for production — **promote to Must when targeting enterprise.**

**Edge / serverless deployment.**
Runtime's edge-friendly stance is well-aligned with 2026 trends (Vercel, Cloudflare Workers, Deno Deploy dominate JS agent hosting). Test #29 (dist-in-browser) defends this differentiation — **promote to Must**.

**OpenTelemetry GenAI semantic conventions.**
Status: "Development" not stable (https://opentelemetry.io/docs/specs/semconv/gen-ai/). Vercel AI SDK ships `gen_ai.system`, `gen_ai.request.*`, `gen_ai.response.*`, `gen_ai.usage.*` (https://ai-sdk.dev/docs/ai-sdk-core/telemetry). **Current OTel stance is appropriate** — wait for stabilization.

**Summary — misalignments with 2026 expectations:**
- MCP (#17): **promote to Must/Should**
- Prompt caching (#23): **promote to Should**
- HITL pause/resume (#22): **promote to Should**

**Well-aligned:** multimodal, token usage, toolChoice, edge readiness, OTel approach.

### Engineer

**Effort estimates wrong:**
- **#5 (split god class):** L → **L+ (5-7 days)**. `runtime.ts:1457-1924` has 3 dispatch codepaths each re-implementing bound-arg merging. Delegation manager is 210 lines (`runtime.ts:940-1149`).
- **#6 (pre-compile expressions):** correct M, but **must precede #5**. `evalBoundValue` appears 53× in `runtime.ts`.
- **#10 (multimodal):** M → **L**. Ripples to: checkpoint serialization (`src/checkpoint/types.ts:15`, `history: Msg[]`), history truncation, guardrail validators, every middleware context (`src/middleware/types.ts:6`), Vercel driver (`packages/runtime-vercel/src/driver.ts:80`). **Split into 10a (extend `Msg`), 10b (checkpoint migration + guardrails), 10c (driver support).**
- **#29 (dist-in-browser):** S → **M**. Vitest browser mode + edge-runtime sandbox is non-trivial; needs CI workflow file.

**Sequencing fix:**
1. **#6 first** (pre-compile expressions).
2. **#5 second** (god-class split, against pre-compiled expressions).
3. **#7-13 in parallel** on the cleaner `ToolDispatcher`.
4. **#15 (checkpoint migration) MUST precede #10 (multimodal).** Bumping `CHECKPOINT_SCHEMA_VERSION` orphans every stored checkpoint without it.

**Dangerous breaking changes:**
- #5: subclassers break if internals aren't marked `@experimental`.
- #10: middleware pattern-matching `TextMsg | ToolCallMsg` will miss multimodal variant.
- #15: must precede any version bump or migrations are impossible.

**Missing engineering items:**
- `@stable` / `@experimental` JSDoc + `STABILITY.md` (a 1.0 OSS runtime needs this).
- Type-tests via `tsd` / `expect-type` (`*.test-d.ts`).
- Determinism / replay mode (`RuntimeOptions.seed` + LLM IO capture).
- Rate-limit / 429 handling in driver layer (Vercel driver bubbles unhandled errors today).
- LlmDriver mid-stream error contract (partial deltas → rollback? checkpoint?).
- Changelog tooling (changesets) for the inevitable v0 → v1 break.

### PM

**Target user is unserved.**
README pitches "developers running AgentScript outside Salesforce in Node/Bun/edge/browser." 22 of 30 roadmap items are internal hygiene; only ~4 are visible to that adopter. The roadmap reads like an internal Salesforce parity backlog with adopter items sprinkled in.

**Killer features for `npm install`:**
1. **#10 Multimodal** — vision is non-negotiable in 2026.
2. **#17 MCP adapter** — wedge for community adoption.
3. **#22 RequireConfirmation** — HITL is what every competitor markets.
4. **#23 Prompt caching** — "we cost less than your current setup" is a real adoption story.
5. **#20 Subgraph tools** — recursion/hierarchy differentiates "agent runtime" from "tool-calling loop."

Mostly invisible: #2, #5, #6, #14, #15, #16, #18, #19, #21, #24-28, #30.

**Time-to-first-success: hours, not minutes.**
README example uses `compileSource` from `@agentscript/agentforce`, registers a stub, instantiates an `llm` driver the README never tells you how to obtain. New developer must (1) read code to find `runtime-vercel`, (2) pick a model SDK, (3) write IR with no inline tutorial, (4) discover by trial that RouterNode is silently dropped. **Single highest-leverage adoption gap.**

**Differentiation under-invested.**
Compiled IR is unique vs LangGraph / Vercel AI SDK / OpenAI Agents SDK. Roadmap leans into parity (catching `module-graph-runtime`) more than differentiation. Nothing for "browse the IR in a debugger," "diff two compiled agents," "hot-reload an agent from a URL." Item #29 (browser/edge smoke test) is the one item defending the differentiation, parked in Tests.

**Cut / down-rank:**
- #5 god-class refactor — gold-plating until features hurt.
- #15 checkpoint migration — premature; ~0 prod users.
- #19 BatchingSpanExporter — premature.
- #27 100-turn memory stress — no user has reported it.
- #28 deep-recursion — write after issue filed.
- #30 bundle-size gate — XS, not roadmap-worthy (just add to CI).

**Promote:**
- #17 MCP → Must.
- #10 Multimodal → Must.
- #22 RequireConfirmation → Should.
- #29 dist-in-browser → Must.

**Docs/DX gaps (should be a section):**
- Anthropic in 5 minutes (copy-paste).
- Cloudflare Workers in 60 seconds.
- AgentScript-by-example.
- TypeDoc API reference.
- `examples/` directory.
- Migration guide.

**Success metrics:**
1. Weekly npm downloads — 1k/week by month 6 (LangGraph hit ~4 mo).
2. GitHub stars — 500 by month 6.
3. External PRs merged — 10 non-Salesforce by month 6.
4. Time-to-first-success — measured from `npm install` to running agent reply, target <5 min.
5. # MCP servers known to work with the runtime.

---

## Consensus recommendations

### Promotions to Must-have
| Item | Was | Reviewers in favor |
|---|---|---|
| #10 Multimodal `Msg` (split into a/b/c, **+L**) | Should/M | Researcher, Engineer, PM |
| #13 AbortSignal in `FnAdapter` | Should/S | Architect, Engineer (correctness bug) |
| #15 `CheckpointStore.migrate` | Nice/M | Architect, Researcher, Engineer (blocks #10) |
| #17 MCP adapter | Nice/L | Researcher, Engineer, PM |
| #29 dist-in-browser test (**+M**) | Tests/S | Researcher, Engineer, PM |
| 🆕 D1 Anthropic + Cloudflare Workers quickstart | new | PM |
| 🆕 D2 `examples/` dir | new | PM |
| 🆕 E1 `@stable` / `@experimental` JSDoc + STABILITY.md | new | Engineer |
| 🆕 E5 Changelog tooling (changesets) | new | Engineer |
| 🆕 V2 Anthropic driver | new | Round-4 driver team |
| 🆕 V3 OpenAI driver (Responses API) | new | Round-4 driver team |
| 🆕 G1 Multimodal `Msg` content (= 10a) | new | Round-4 architect (blocker for V2) |
| 🆕 G2 `toolChoice` on `LlmStepInput` (extends #12) | new | Round-4 architect |
| 🆕 G3 Prompt-cache hints (extends #23) | new | Round-4 architect |
| 🆕 G4 Token usage on `StepEvent.finish` (extends #11) | new | Round-4 architect |

### Promotions to Should-have
| Item | Was | Reviewers in favor |
|---|---|---|
| #20 Subgraph tools (re-scope to **+S**, expose existing delegations) | Nice/L | Architect, PM |
| #22 RequireConfirmation pause/resume | Nice/L | Researcher, PM |
| #23 Prompt-caching hints | Nice/M | Researcher, PM |
| 🆕 D3 TypeDoc API reference | new | PM |
| 🆕 D4 AgentScript-by-example tutorial | new | PM |
| 🆕 A1-A5 Architecture missing items | new | Architect |
| 🆕 A6 ADR: do not adopt LangGraph (state/graph stays bespoke) | new | Round-3 architect team (unanimous) |
| 🆕 E2 Type-tests (tsd) | new | Engineer |
| 🆕 E4 Rate-limit / 429 handling | new | Engineer |
| 🆕 V1 `runtime-providers` package skeleton + conformance suite | new | Round-4 driver team |
| 🆕 V4 Google Gen AI driver | new | Round-4 driver team |
| 🆕 V5 Bedrock driver (Node-only) | new | Round-4 driver team |
| 🆕 V7 Cloudflare Workers AI doc | new | Round-4 driver team |
| 🆕 G5 Reasoning / thinking deltas | new | Round-4 architect |
| 🆕 G6 Streaming-granularity contract | new | Round-4 architect |
| 🆕 G7 Server-tool reporting | new | Round-4 architect |

### Demotions / cuts
| Item | Was | New | Reasoning |
|---|---|---|---|
| #5 God-class split | Should/L | **Should — defer until features hurt** (PM) | All 4 agree refactor is needed; Engineer flags it AFTER #6; PM flags it as gold-plating |
| #14 ErrorCode enum | Nice/M | **Reduce: drop enum, keep `Logger` interface (S)** | Architect: typed errors ARE the enum |
| #19 BatchingSpanExporter | Nice/M | **Defer** | PM: premature |
| #27 100-turn memory stress | Tests | **Defer** | PM: no reported issue; Engineer: needs baseline first |
| #28 Deep-recursion delegation | Tests | **Defer until issue filed** | PM, Engineer |
| #30 Bundle-size CI gate | Tests/XS | **Move to repo CI config, not roadmap** | PM, Architect |

### Sequencing fix (was: 1→2→3→4→5→6 by section)
The "Suggested execution order" should change to a **wave model**:

1. **Wave 0 — 0-day cleanup:** README (#4), bundle-size CI gate (was #30, move to CI).
2. **Wave 1 — Correctness:** RouterNode (#1), action-validation (#2), `@system_variables.user_input` (#3), AbortSignal in FnAdapter (#13).
3. **Wave 2 — Schema safety:** `CheckpointStore.migrate` (#15) **must precede any schema-bearing change**.
4. **Wave 3 — Driver contract** (`LlmDriver` gaps): G1 (multimodal = 10a) → G2 (toolChoice = #12) → G3 (prompt-cache hints = #23) → G4 (token usage = #11). **Blockers for V2.**
5. **Wave 4 — Adopter wedge:** V1 (`runtime-providers` skeleton + conformance) → V2 (Anthropic) → V3 (OpenAI) → MCP entry point (folds #17) → Multimodal completion (10b/10c) → HITL pause/resume (#22).
6. **Wave 5 — Driver depth:** V4 (Google Gen AI), V5 (Bedrock, document edge caveat), G5/G6/G7 lazily as drivers need them, V6 (Ollama), V7 (CF Workers AI doc).
7. **Wave 6 — Performance + maintainability:** Pre-compile expressions (#6), then god-class split (#5).
8. **Wave 7 — Hardening:** Logger interface (reduced #14), checkpoint restore semantics (A3), rate-limit handling (E4), mid-stream error recovery contract (A4).
9. **Continuous (parallel):** Docs/DX (D1-D4), engineering hygiene (E1-E5), architecture decisions (A1-A6).

---

## Proposed new `ROADMAP.md` shape

Reorganize from 4 sections (Must / Should / Nice / Tests) to **5 sections**:

### 1. Must-have — correctness & adopter-facing

| # | Item | Effort |
|---|---|---|
| 1 | Wire up `RouterNode` (or fail loud) | M |
| 2 | Validate action defs at graph load | S |
| 3 | Inject `@system_variables.user_input` | S |
| 4 | Update README — drop "deferred" claims | XS |
| 13 | Thread `AbortSignal` into `FnAdapter` | S |
| 15 | `CheckpointStore.migrate(checkpoint, toVersion)` | M |
| 17 | MCP adapter (`mcp://` scheme) — **folded into V-series as `runtime-providers/mcp`** | L |
| 10a | Extend `Msg` for multimodal content (text/image/file/audio parts) — **same as G1** | M |
| 10b | Multimodal: checkpoint migration + guardrail support | M |
| 10c | Multimodal: Vercel driver support | S |
| G2 | `toolChoice` on `LlmStepInput` (extends roadmap #12) | S |
| G3 | Prompt-cache hints on messages/tools (extends roadmap #23) | S |
| G4 | Token usage on `StepEvent.finish` (extends roadmap #11) | S |
| V2 | **Anthropic driver** (`@anthropic-ai/sdk` direct) | M |
| V3 | **OpenAI driver** (Responses API path; covers Groq/Together/xAI/DeepSeek/Fireworks/Azure via baseURL) | M |
| 29 | dist-in-browser CI smoke test | M |
| D1 | Anthropic + Cloudflare Workers quickstart | S |
| D2 | `examples/` dir with 3-4 runnable agents | M |
| E1 | `@stable` / `@experimental` JSDoc + `STABILITY.md` | S |
| E5 | Changelog tooling (changesets) | S |

### 2. Should-have — depth & parity

| # | Item | Effort |
|---|---|---|
| 6 | Pre-compile bound-value expressions at load time | M |
| 5 | Split `runtime.ts` into `TurnOrchestrator` / `ToolDispatcher` / `MiddlewareRunner` / `GuardrailManager` | L+ |
| 7 | `on_init` / `on_exit` hooks | M |
| 8 | `end_turn_first` on handoff | S |
| 9 | Per-iteration reasoning limit | S |
| 11 | Token usage on `StepEvent` (prompt/completion/reasoning) | S |
| 12 | `toolChoice` on `LlmStepInput` | S |
| 20 | Expose existing delegations as agent-as-tool entries | S |
| 22 | `RequireConfirmation` pause/resume primitive | L |
| 23 | Prompt-caching hints (Anthropic / Bedrock) | M |
| A1 | IR versioning / schema-evolution policy | S |
| A2 | Tool adapter ABI versioning + capability discovery | M |
| A3 | Checkpoint restore semantics for in-flight delegations | M |
| A4 | LlmDriver streaming-fault contract (mid-stream error / consumer-drops) | S |
| A5 | Pre-commit / CI scan for forbidden Node imports in `dist/` | S |
| A6 | ADR: do not adopt LangGraph for state/graph; pattern-borrow only (see `STATE_GRAPH_ALTERNATIVES.md`) | S |
| V1 | `@agentscript/runtime-providers` package skeleton + conformance suite (see `SDK_DRIVERS_REVIEW.md`) | S |
| V4 | Google Gen AI driver (`@google/genai` v2; Live API, thinkingBudget, grounding) | M |
| V5 | Bedrock driver (`@aws-sdk/client-bedrock-runtime`; Node-only, document caveat) | M |
| V7 | Cloudflare Workers AI documentation (`env.AI` binding example, no SDK) | XS |
| G5 | Reasoning / thinking deltas on `StepEvent` | S |
| G6 | Streaming-granularity contract + conformance test | S |
| G7 | Server-tool reporting (`source: 'user' \| 'builtin'` on `ToolCall`) | S |
| E2 | Type-tests via `tsd` / `expect-type` | M |
| E4 | Rate-limit / 429 handling in driver layer | S |
| 14↓ | Structured `Logger` interface in `RuntimeOptions` (no-op default) — drop the enum | S |
| 16 | Enrich `OnErrorContext` (msg-history snapshot, llm request) | S |
| D3 | TypeDoc API reference | S |
| D4 | AgentScript-by-example tutorial | M |
| P1 | Success metrics dashboard | — |

### 3. Nice-to-have — polish

| # | Item | Effort |
|---|---|---|
| 18 | Per-tool timeout / retry / circuit-breaker adapter | M |
| 21 | `pre_tool_calls` / `post_tool_calls` per-tool hooks | M |
| V6 | Ollama driver (`ollama-js`; local/offline dev DX) | S |
| E3 | Determinism / replay mode (`RuntimeOptions.seed` + IO capture) | M |

### 4. Tests

| # | Item |
|---|---|
| 24 | EventBus listener accumulation across N turns |
| 25 | Mid-parallel-delegation checkpoint + abort-during-restore |
| 26 | Streaming break mid-delta graceful degradation |

### 5. Docs & DX (NEW SECTION)

| # | Item | Bucket | Effort |
|---|---|---|---|
| D1 | Anthropic + Cloudflare Workers quickstart | Must | S |
| D2 | `examples/` directory with 3-4 runnable agents | Must | M |
| D3 | TypeDoc API reference (generated) | Should | S |
| D4 | AgentScript-by-example tutorial | Should | M |

### 6. LLM SDK Drivers (NEW SECTION — see `SDK_DRIVERS_REVIEW.md`)

Today only `runtime-vercel` ships first-party. This section adds 5 new drivers + 7 contract gaps as a single hybrid `@agentscript/runtime-providers` package with conditional sub-module exports. **G1-G4 contract changes are blockers for V2.**

| # | Item | Bucket | Effort |
|---|---|---|---|
| G1 | Multimodal `Msg` content (also listed as 10a) | Must | M |
| G2 | `toolChoice` field on `LlmStepInput` | Must | S |
| G3 | Prompt-cache hints on messages/tools | Must | S |
| G4 | Token usage on `StepEvent.finish` | Must | S |
| G5 | Reasoning / thinking deltas | Should | S |
| G6 | Streaming-granularity contract + conformance test | Should | S |
| G7 | Server-tool reporting | Should | S |
| V1 | `@agentscript/runtime-providers` package skeleton + conformance suite | Should | S |
| V2 | Anthropic driver (extended thinking, prompt caching, MCP connectors) | Must | M |
| V3 | OpenAI driver (Responses API; covers Groq/Together/xAI/DeepSeek/Fireworks/Azure) | Must | M |
| V4 | Google Gen AI driver (Live API, thinkingBudget, grounding) | Should | M |
| V5 | Bedrock driver (Node-only — document caveat) | Should | M |
| V6 | Ollama driver (local dev) | Nice | S |
| V7 | Cloudflare Workers AI documentation | Should | XS |

**Build order:** G1-G4 → V1 (skeleton + conformance) → V2 (Anthropic) → V3 (OpenAI) → V1 MCP entry point → V4 (Google) → V5 (Bedrock) → V6 (Ollama) → V7 (CF doc).

`runtime-vercel` stays as a sibling package — different audience, different shape.

### Deferred (was on roadmap)

| # | Item | Reason |
|---|---|---|
| 19 | BatchingSpanExporter | Premature; no users with OTLP volume |
| 27 | 100-turn memory stress test | No reported issue; needs baseline first |
| 28 | Deep-recursion delegation test | Write after issue filed |
| 30 | Bundle-size CI gate | Too small for roadmap; just add to CI |

---

## Open questions for the user

1. **Refactor timing.** Engineer + Architect want the god-class split (#5) done after pre-compile (#6) but before further features. PM wants it deferred until features hurt. Which order do we commit to?
2. **MCP placement.** Architect wants MCP in a sibling package `@agentscript/runtime-mcp`. Researcher/Engineer/PM want it as a Must-have line item on the runtime roadmap regardless of package boundary. Confirm: Must-have on this roadmap, implemented as sibling package?
3. **Multimodal scope.** Engineer recommends splitting #10 into 10a/10b/10c. Are you OK shipping 10a (extend `Msg`) before 10b/10c land, or must they ship together to avoid breaking middleware?
4. **HITL urgency.** Researcher says LangGraph/Mastra make HITL table stakes. PM wants it Must. Reviewers' compromise was Should. Are you targeting enterprise (Must) or OSS adopters (Should)?
5. **Defer or drop the deferred items?** #19, #27, #28, #30 — keep on a "later" list, or remove entirely?

---

## Verification

How to use this document:
1. **Scan the TL;DR** (10 seconds).
2. **Read the per-item POV table** (1-2 minutes) — find rows where reviewers disagreed.
3. **Drill into per-reviewer findings** only for items where you want more depth.
4. **Decide which edits to apply to `ROADMAP.md`** — this document does not modify it.
5. **Answer the 5 open questions** above; once decided, the edits to `ROADMAP.md` are mechanical.

No code, tests, or other files have been modified by this review.
