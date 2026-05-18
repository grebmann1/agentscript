# LLM SDK Drivers — What Are We Missing?

**Status:** review only. No code, package manifests, or roadmap files have been modified.
**Question:** today the runtime ships exactly one first-party adapter (`@agentscript/runtime-vercel`). Which other LLM SDKs and frameworks should we wrap as first-party drivers?
**Reviewers (parallel):** Engineer (driver candidate ranking), Researcher (May 2026 TS LLM SDK landscape with URLs), Architect (contract gaps + packaging + conformance).

---

## TL;DR

1. **We're heavily Vercel-centric today.** Through `runtime-vercel` you can technically reach 40+ providers, but at the cost of losing each provider's killer features — Anthropic prompt caching + extended thinking, OpenAI Responses API + o1/o3 reasoning, Google grounding + Live API, Bedrock guardrails + IAM auth, MCP tools.
2. **Five first-party drivers should ship.** In priority: **Anthropic direct**, **OpenAI direct**, **Google Gen AI**, **MCP tool adapter**, **Bedrock**. Honorable mention: **Ollama** for local/offline dev.
3. **Fix the `LlmDriver` contract before adding a second driver.** Seven gaps (multimodal `Msg`, `toolChoice`, prompt-cache hints, token usage on `StepEvent`, thinking events, streaming granularity, server-tool reporting). Otherwise each new driver invents its own escape hatches and they drift.
4. **Package as `@agentscript/runtime-providers` with conditional sub-module entry points** (e.g. `import { AnthropicDriver } from '@agentscript/runtime-providers/anthropic'`). Avoids 5+ separate workspace packages and keeps tree-shaking honest.
5. **Ship a `LlmDriver` conformance test suite.** Five categories — finish, tool-calls, abort-signal, error propagation, streaming granularity. Re-exported so third-party drivers can self-validate.
6. **`runtime-vercel` stays.** It's the broadest-coverage adapter and many users will keep using it. We're adding *purposeful* drivers that beat it for specific killer features, not replacing it.

---

## Driver gap matrix

| Provider / SDK | Today's path | First-party driver? | Killer feature lost via Vercel | Priority |
|---|---|---|---|---|
| Anthropic (`@anthropic-ai/sdk`) | through Vercel | **Must build** | Extended thinking blocks, encrypted reasoning signatures, prompt caching with `cache_control`, MCP connectors | **#1 Must** |
| OpenAI (`openai` v6) | through Vercel | **Must build** | Responses API (stateful), o1/o3 reasoning + budget, Realtime WS audio, hosted server tools (`web_search`, `file_search`, `code_interpreter`) | **#2 Must** |
| Google Gen AI (`@google/genai` v2) | through Vercel | **Should build** | Gemini Live (real-time WSS audio/video), `thinkingLevel`/`thinkingBudget`, Search grounding with `groundingMetadata` citations, Imagen | **#3 Should** |
| MCP (`@modelcontextprotocol/sdk`) | not covered | **Must build** as `ToolAdapter`, not LLM driver | Universal tool bus (Claude/ChatGPT/VS Code/Cursor all consume it) | **#4 Must (tool adapter)** |
| AWS Bedrock (`@aws-sdk/client-bedrock-runtime`) | through Vercel | **Should build** | Converse/ConverseStream unified API, `ApplyGuardrail`, IAM role auth, no API keys | **#5 Should** |
| Ollama (`ollama-js`) | not covered | **Nice to build** | Local/offline dev, `ollama/browser` module, no API keys | **#6 Nice** |
| Azure OpenAI (`@azure/openai`) | through Vercel | Skip / document | Most users route via `openai` SDK with custom baseURL | Skip |
| Cohere (`cohere-ai`) | not covered | Skip | RAG + citation tracking — niche | Skip |
| Mistral (`@mistralai/mistralai`) | through Vercel | Skip | OK via Vercel | Skip |
| Groq, Together, Fireworks, DeepSeek, xAI | through Vercel | Skip — covered by OpenAI driver | All OpenAI-API-compatible — `openai` SDK with custom baseURL covers all | — |
| Cloudflare Workers AI | not covered | Doc only | No npm SDK; uses `env.AI` binding | Doc, not package |
| LangChain.js `BaseChatModel` | not covered | Skip | Reverse adapter (consume LC chat models) — niche | Skip |
| Mastra `@mastra/core` | not covered | Defer | Mastra itself routes through Vercel — they'd consume our drivers, not the other way | Defer |
| OpenAI Agents JS SDK (`@openai/agents`) | not covered | Skip | Higher-level orchestration — competitor to our runtime, not a driver target | Skip |
| Anthropic Agent SDK (TS) | n/a | Skip | Doesn't exist standalone — covered by `@anthropic-ai/sdk`'s `betaZodTool` / `.toolRunner()` | — |

**Net add to the workspace: 1 package (`runtime-providers`) + a sibling MCP entry point.** Not 5-7 separate packages.

---

## Contract gaps that block multi-SDK ergonomics

The Architect identified seven gaps in `packages/runtime/src/llm/types.ts` (lines 6-65) that, if not addressed *before* adding a second driver, will create per-SDK divergence:

| # | Gap | Affected SDKs | Severity | Minimal fix |
|---|---|---|---|---|
| G1 | No multimodal `Msg` content (`TextMsg.content: string` only at `types.ts:8-11`) | Anthropic vision, OpenAI vision, Google vision, audio | **Blocker** | Extend to `string \| Array<{ type: 'text' \| 'image' \| 'audio' \| 'document', ... }>`; backward-compat |
| G2 | No `toolChoice` field on `LlmStepInput` (`types.ts:47-61`) | Anthropic, OpenAI, Bedrock | High | Add `toolChoice?: 'auto' \| 'none' \| 'required' \| { name }` |
| G3 | No prompt-cache hints | Anthropic ephemeral, OpenAI cached input, Bedrock | High | Add `cacheHints?: { type, ttl? }` per-message or per-tool |
| G4 | No token usage on `StepEvent.finish` (`types.ts:42-45`) | All providers | High | Extend `finish` with `usage?: { promptTokens, completionTokens, cacheReadTokens?, cacheCreateTokens?, reasoningTokens? }` |
| G5 | No reasoning / thinking deltas | Anthropic extended thinking, OpenAI o1/o3 | Med | Add `{ kind: 'thinking' \| 'thinking-delta', text }` event |
| G6 | Streaming granularity unspecified — Vercel driver buffers entire response into one delta (`runtime-vercel/src/driver.ts:86`) | All providers | Med | Document: drivers MUST emit one `text-delta` per server-sent chunk; conformance test enforces |
| G7 | No server-tool reporting (`computer_use`, `file_search`, grounding, retrieve_and_generate) | Anthropic, OpenAI, Google, Bedrock | Med | Add `source?: 'user' \| 'builtin'` to `ToolCall`; emit `{ kind: 'server-tool-result', ... }` |

These overlap with existing roadmap items #10 (multimodal), #11 (token usage), #12 (toolChoice), #23 (prompt caching) — so fixing them isn't new work, it's **sequencing**: gate the next driver behind these contract changes.

---

## Packaging recommendation — hybrid `runtime-providers`

**Verdict:** Don't ship 5 separate workspace packages. Ship one with conditional entry points.

```
packages/runtime-providers/
├── src/
│   ├── index.ts                # shared utilities only
│   ├── anthropic/{driver,types}.ts
│   ├── openai/{driver,types}.ts
│   ├── google/{driver,types}.ts
│   ├── bedrock/{driver,types}.ts
│   ├── ollama/{driver,types}.ts
│   └── mcp/{tool-adapter,types}.ts
├── test/
│   └── conformance/            # shared LlmDriver conformance suite
└── package.json
    "exports": {
      "./anthropic": "./dist/anthropic/index.js",
      "./openai":    "./dist/openai/index.js",
      "./google":    "./dist/google/index.js",
      "./bedrock":   "./dist/bedrock/index.js",
      "./ollama":    "./dist/ollama/index.js",
      "./mcp":       "./dist/mcp/index.js"
    }
    "peerDependencies": {
      "@anthropic-ai/sdk":   ">=0.96.0",
      "openai":              ">=6.0.0",
      "@google/genai":       ">=2.0.0",
      "@aws-sdk/client-bedrock-runtime": ">=3.0.0",
      "ollama":              ">=0.6.0",
      "@modelcontextprotocol/sdk": ">=1.0.0"
    }
    "peerDependenciesMeta": {
      "@anthropic-ai/sdk": { "optional": true },
      "openai": { "optional": true },
      ...
    }
```

**Why hybrid wins:**

| Approach | Trade-off |
|---|---|
| **One package per provider** (`runtime-anthropic`, `runtime-openai`, …) | ✅ Per-provider versioning. ❌ 5+ packages = peer-dep sprawl, npm install bloat, 5 GitHub releases per cycle, broken tree-shaking across packages |
| **One mega-package, all providers compiled in** | ✅ Single version. ❌ +200 KB bundle even if user only uses Anthropic; tree-shaking can't help |
| **Hybrid: one package, conditional sub-module entry points** | ✅ Single version cycle, tree-shake-clean per-provider, optional peer deps so users only install SDKs they use, shared utilities live once |

`runtime-vercel` stays as a sibling package — different audience (broad provider coverage), different shape (depends on `ai`).

---

## Conformance test suite

**Where:** `packages/runtime-providers/test/conformance/index.ts`. Re-exported so external teams writing custom drivers can self-validate.

**Helper signature:**
```typescript
import { createConformanceTests } from '@agentscript/runtime-providers/test/conformance';
createConformanceTests({ name: 'AnthropicDriver', driver: new AnthropicDriver({ /* … */ }) });
```

**Five categories every driver must pass:**

| Category | Minimum bar |
|---|---|
| **Yields finish** | Exactly one `finish` event per `step()`. Reason is one of `stop \| tool-calls \| length \| other`. No double-finish; no hang. |
| **Tool calls correct** | Non-empty `id` + `name`. Arguments always an object (`{}` if empty). Tool order matches SDK order. |
| **Respects `AbortSignal`** | Cancels SDK request mid-stream; yields a finish or throws. No dangling fetch. |
| **Propagates errors** | SDK throws (auth, rate-limit, model-not-found) become caught errors at runtime layer — not silent `finish`. |
| **Streaming granularity** | If driver supports streaming, deltas arrive within 200 ms of each other (configurable). Joined text equals SDK's final text. |

Optional extensions documented as vendor-specific: extended thinking (Anthropic, o1/o3), caching (Anthropic, OpenAI), server tools (computer_use, file_search, grounding).

---

## Build order

1. **Fix contract first** — G1-G4 land in `@agentscript/runtime` v0.next. Roadmap items #10, #11, #12, #23 already cover this; sequence them ahead of any new driver.
2. **Scaffold `@agentscript/runtime-providers`** — empty package, peer-dep manifest, conformance suite skeleton.
3. **Anthropic driver** — first new driver. Validates contract changes against a real SDK with prompt caching + thinking + MCP connector.
4. **OpenAI driver** — Responses API path. Covers Groq/Together/xAI/DeepSeek/Fireworks/Azure-OpenAI as a side-effect via custom baseURL.
5. **MCP tool adapter** — sibling track; doesn't depend on driver work. Implements `ToolAdapter` for `mcp://` scheme.
6. **Google Gen AI driver** — adds `thinkingLevel`/`thinkingBudget` and grounding; validates G5 (thinking events).
7. **Bedrock driver** — last because of Node-only `@aws-sdk/client-bedrock-runtime` (no edge support); document this caveat clearly.
8. **Ollama** — small effort, big DX win. Slot in whenever convenient.
9. **Cloudflare Workers AI doc** — `env.AI` binding example in `runtime-providers/README.md`; no separate driver because there's no npm SDK.

---

## Roadmap implications (proposed for `ROADMAP_REVIEW.md`)

| Item | Bucket | Effort | Notes |
|---|---|---|---|
| 🆕 V1 — `@agentscript/runtime-providers` package skeleton + conformance suite | Should · S | new | Lands after G1-G4 ship in core |
| 🆕 V2 — Anthropic driver | Must · M | new | First validation of multi-driver contract |
| 🆕 V3 — OpenAI driver (Responses API) | Must · M | new | Covers OpenAI-compatible providers via baseURL |
| 🆕 V4 — Google Gen AI driver | Should · M | new | Thinking/grounding validation |
| 🆕 V5 — Bedrock driver | Should · M | new | Edge-incompatible — document caveat |
| 🆕 V6 — Ollama driver | Nice · S | new | Local dev DX |
| 🆕 V7 — Cloudflare Workers AI doc | Should · XS | new | No SDK; runtime example only |
| Existing #17 (MCP adapter) | folded into V-series as `runtime-providers/mcp` | — | Keep prio Must |

These supplement, not replace, `runtime-vercel`.

---

## Per-reviewer findings

### Engineer — driver candidate ranking

**Must-build:**

| Package | Wraps | Why first-party | Cost | Edge / browser | Killer feature |
|---|---|---|---|---|---|
| `…/runtime-providers/anthropic` | `@anthropic-ai/sdk` | Native prompt caching, extended thinking blocks, MCP server tools, encrypted signatures for multi-turn reasoning. Vercel flattens these. | **S** | Node + Workers (fetch build) ✓ | Caching + thinking + MCP |
| `…/runtime-providers/openai` | `openai` v6 | Native function-calling streaming, reasoning models o1/o3 with budget control, parallel tool use, Responses API stateful sessions. Vercel doesn't expose reasoning budgets. | **S** | Node 20+ / Workers / Edge / Deno / Bun | Reasoning token accounting + Responses API |
| `…/runtime-providers/bedrock` | `@aws-sdk/client-bedrock-runtime` | Inference profiles, guardrails (`ApplyGuardrail`), IAM role auth, multi-model via single `Converse` API. | **M** | Node only ❌ | Guardrails + IAM |

**Should-build:**

| Package | Wraps | Killer feature |
|---|---|---|
| `…/runtime-providers/google` | `@google/genai` v2 | Gemini Live API (WSS audio/video), `thinkingLevel`/`thinkingBudget`, Search grounding with citations |
| `…/runtime-providers/azure` | `@azure/openai` | Multi-deployment-slot routing, Microsoft Entra ID auth — though most users use `openai` SDK with baseURL |
| `…/runtime-providers/cohere` | `cohere-ai` | Native multi-step retrieval, citation tracking |

**Nice-to-have:**
- `…/runtime-providers/ollama` (`ollama-js`) — local/offline dev DX, no API keys.
- `…/runtime-providers/groq` — sub-second inference; covered by OpenAI driver via baseURL.
- `…/runtime-providers/mcp` (`@modelcontextprotocol/sdk`) — server-side tool federation. **NOT** an LLM driver; it's a `ToolAdapter` for `mcp://` scheme.

**Skip:** Mistral, Fireworks, Together, Replicate, DeepSeek, xAI Grok, LangChain `BaseChatModel`, OpenAI Agents SDK, Anthropic Agent SDK, Mastra agents — clean Vercel routing exists, or hard-dependency on a competing framework.

**Three driver-shape gaps surfaced immediately by adding a second driver:**
1. No token / cost accounting on `StepEvent` — Bedrock provisioned-throughput, o1 reasoning limits, Anthropic cache-hit tracking all need this.
2. No multimodal `Msg` — Anthropic + Google + OpenAI all require vision content blocks.
3. No `toolChoice` — needed for "must call tool X" / "no tools" semantics.

### Researcher — May 2026 TS LLM SDK landscape

**Direct provider SDKs (all stable May 2026):**

| Package | Latest | Stars | License | Edge / Browser | Unique vs Vercel |
|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | v0.96.0 | TS-specific stars unclear | MIT | Node 18+, Workers (fetch build), `dangerouslyAllowBrowser` | Extended thinking blocks, `signature` for multi-turn reasoning, `betaZodTool` / `.toolRunner()`, MCP connectors |
| `openai` | v6.38.0 | 10.9k | Apache 2.0 | Node 20+ / Workers / Edge / Deno 1.28+ / Bun 1.0+ | Responses API (stateful), Realtime WSS, workload identity auth, `AzureOpenAI` class |
| `@google/genai` | v2.4.0 | 1.6k | Apache 2.0 | Browser (with key warning) | Gemini Live API, `thinkingLevel`/`thinkingBudget`, grounding, Imagen |
| `@aws-sdk/client-bedrock-runtime` | v3.x | 10k+ (monorepo) | Apache 2.0 | Node + browser + RN ❌ Workers (uses Node `crypto`) | `Converse`/`ConverseStream`, `ApplyGuardrail`, `StartAsyncInvoke`, `CountTokens` |
| `@azure/openai` | latest | — | MIT | Node + browser | Azure content filtering, Cognitive Search data source, Entra ID auth |
| `cohere-ai` | v8.0.0 | 173 | MIT | Server-only | Multi-cloud (Bedrock/SageMaker/Azure/GCP/Oracle) |
| `@mistralai/mistralai` | v2.2.1 | 139 | Apache 2.0 | Browser, Node, Bun, Deno 1.39 | Audio TTS/STT, agents, RAG, batch, Zod v4 |
| `groq-sdk` | v1.2.0 | 248 | Apache 2.0 | Workers / Edge / Deno / Bun | Sub-second latency |
| `together-ai` | v0.40.0 | 67 | — | Workers / Edge / Node 20+ / Deno / Bun | Fine-tuning, serverless endpoints |
| `replicate` | v1.4.0 | 593 | Apache 2.0 | Workers / Vercel / Lambda; CORS-blocked in browser | Model fine-tuning, `FileOutput` ReadableStream |
| `ollama-js` | v0.6.3 | 4.2k | MIT | Browser via `ollama/browser` | Local dev, no API key, `thinking` mode |
| Cloudflare Workers AI | no SDK | — | — | Workers-only via `env.AI` | 50+ OSS models, zero cold start |
| xAI Grok | no SDK | — | — | Use `openai` SDK at `api.x.ai/v1` | Grok models via OpenAI-compatible API |
| DeepSeek | no SDK | — | — | OpenAI-compatible | R1 reasoner models |

**Agent / orchestration frameworks (TypeScript):**

| Framework | Version | Stars | Notes |
|---|---|---|---|
| `@openai/agents` (OpenAI Agents JS SDK) | v0.11.4 | — | Provider-agnostic — competitor to our runtime, not a driver target |
| Anthropic Agent SDK (TS) | n/a | — | Doesn't exist standalone; built into `@anthropic-ai/sdk` |
| `@langchain/core` (LangChain.js) | v1.1.46 | 17.7k | `BaseChatModel` adapter target — niche |
| `@langchain/langgraph-sdk` | v1.9.2 | 2.9k | Already covered in earlier review (do not adopt as engine) |
| `@mastra/core` | v1.35.0 | 24k | Routes through Vercel internally — they'd consume our drivers |
| `genkit` (Firebase) | v1.34.0 | 6k | Plugin-based; Firebase/Cloud Functions focus |
| AutoGen.js | n/a | — | Doesn't exist (Python only) |
| Burr (DAGWorks) | n/a | — | Python only |
| PydanticAI / AG2 | n/a | — | Python only |

**Tool / context protocols:**

| Protocol | Status |
|---|---|
| **MCP TS SDK** (`@modelcontextprotocol/sdk`) | Stable v1.x, v2 pre-alpha. Transports: stdio + Streamable HTTP (sessions via `Mcp-Session-Id`, resumable via `Last-Event-ID`). Protocol version `2025-06-18`. Runs on Node/Bun/Deno. Schema: Zod / Valibot / ArkType. Adopted by Claude, ChatGPT, VS Code Copilot, Cursor. |
| OpenAI function-calling format | De-facto standard; extended by Responses API with hosted server tools (`web_search_preview`, `file_search`, `code_interpreter`, `image_generation`) — proprietary, no cross-provider equivalent. |
| Other JSON-RPC tool protocols beyond MCP | None significant in May 2026. |

**Edge / serverless runtime contexts:**

| Runtime | Clean SDKs | Non-starters |
|---|---|---|
| Cloudflare Workers | `openai`, `@anthropic-ai/sdk` (fetch build), `groq-sdk`, `together-ai`, `@mistralai/mistralai`, `@google/genai`, LangChain.js | `@aws-sdk/client-bedrock-runtime` (uses Node `crypto`, `http`) |
| Vercel Edge | Same set + `@ai-sdk/*` | Bedrock same caveat |
| Deno / Deno Deploy | `openai` (1.28+), `groq-sdk`, `together-ai`, `@mistralai/mistralai` (1.39), `ollama-js` | Mistral lacks streaming file upload on Deno |
| Bun | `openai` (1.0+), all major SDKs | None known |
| Browser | `@google/genai` (with warning), `ollama-js` (`ollama/browser`), `@mistralai/mistralai` (evergreen) | `openai`, `groq-sdk`, `together-ai` need `dangerouslyAllowBrowser`. Replicate CORS-blocked. Bedrock impractical (IAM). |

**Key observation:** SDKs generated by Stainless (`openai`, `groq-sdk`, `@anthropic-ai/sdk`, `together-ai`, `@mistralai/mistralai`) follow a consistent pattern using Web Fetch API, with explicit Workers + Edge support. AWS SDK v3 is the main Node-only exception.

### Architect — contract gaps + packaging + conformance

**Contract gaps** (covered in detail above as G1-G7).

**Packaging recommendation** — hybrid `runtime-providers` with conditional exports (see "Packaging recommendation" section above).

**Conformance test suite** — five-category re-exportable factory (see "Conformance test suite" section above).

**Position summary:** The contract is elegant but incomplete for a multi-provider world. Shipping 3-5 drivers without fixing G1-G7 will produce: multimodal content shoved into `providerOptions` closures (not portable); tool-choice logic duplicated per driver (not maintainable); token usage lost to middleware (not observable); thinking tokens silently dropped (not auditable for o1 workloads). Sequence the contract changes ahead of any second driver.

---

## Citations

- `@anthropic-ai/sdk` — https://github.com/anthropics/anthropic-sdk-typescript
- `openai` — https://github.com/openai/openai-node
- `@google/genai` — https://github.com/googleapis/js-genai (replaces deprecated `@google/generative-ai`, archived Dec 2025)
- `@aws-sdk/client-bedrock-runtime` — https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-bedrock-runtime
- `@azure/openai` — https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/openai/openai
- `@mistralai/mistralai` — https://github.com/mistralai/client-ts (`RUNTIMES.md`: https://github.com/mistralai/client-ts/blob/main/RUNTIMES.md)
- `groq-sdk` — https://github.com/groq/groq-typescript
- `together-ai` — https://github.com/togethercomputer/together-typescript
- `cohere-ai` — https://github.com/cohere-ai/cohere-typescript
- `replicate` — https://github.com/replicate/replicate-javascript
- `ollama-js` — https://github.com/ollama/ollama-js
- Cloudflare Workers AI — https://developers.cloudflare.com/workers-ai/
- xAI Grok API — https://x.ai/api
- Vercel AI SDK provider list — https://ai-sdk.dev/docs/foundations/providers-and-models
- MCP TS SDK — https://github.com/modelcontextprotocol/typescript-sdk
- MCP transport spec — https://modelcontextprotocol.io/docs/concepts/transports
- MCP introduction — https://modelcontextprotocol.io/introduction
- OpenAI Agents JS — https://github.com/openai/openai-agents-js / https://openai.github.io/openai-agents-js/
- Mastra — https://github.com/mastra-ai/mastra
- LangChain.js — https://github.com/langchain-ai/langchainjs
- LangGraph.js — https://github.com/langchain-ai/langgraphjs
- Genkit (Firebase) — https://github.com/firebase/genkit
- Anthropic extended thinking — https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
- Gemini thinking docs — https://ai.google.dev/gemini-api/docs/thinking
- Gemini grounding docs — https://ai.google.dev/gemini-api/docs/grounding

---

## Critical files referenced

- `packages/runtime/src/llm/types.ts` (lines 6-65) — the `LlmDriver` contract that needs G1-G7
- `packages/runtime-vercel/src/driver.ts` (197 lines) — reference adapter shape; line 86 is the buffering single-delta site (G6)
- `packages/runtime-vercel/package.json` — peer-dep pattern to mirror
- `packages/runtime-vercel/README.md` — usage shape
- `packages/runtime/src/tools/registry.ts` — where MCP tool adapter slots in
- `packages/runtime/src/index.ts:30-40` — types we re-export to drivers (`Msg`, `LlmDriver`, `LlmStepInput`, `StepEvent`, `ToolCall`, `ToolDef`)
