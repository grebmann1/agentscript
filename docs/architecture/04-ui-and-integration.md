# 04 — UI Playground and Integration Layer

This document describes the browser-based AgentScript Simulator and the Vercel AI SDK adapter that bridges the AgentScript runtime to mainstream LLM providers. Together they form the experimentation surface: authors write `.agent` scripts, configure an LLM endpoint, and interact with a live agent entirely in the browser.

---

## 1. Vercel AI SDK Adapter

**Package:** `@agentscript/runtime-vercel`  
**Entry point:** `packages/runtime-vercel/src/index.ts`

### 1.1 `createAgent` Factory

The primary API is `createAgent(opts)`, which returns an `AgentScriptAgent` instance. This mirrors Vercel-ecosystem conventions (`createOpenAI`, `createAnthropic`, etc.):

```ts
import { compileSource, createAgent } from '@agentscript/runtime-vercel';
import { generateText, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const { output } = compileSource(agentSource);
const openai = createOpenAI({ baseURL, apiKey });

const agent = createAgent({
  doc: output,                          // Compiled AgentDSL IR
  llm: {
    model: openai.chat('gpt-4o-mini'),  // Any LanguageModel instance
    generateText,                       // Injected — no hard dependency on `ai`
    jsonSchema,                         // Wraps raw JSON Schema for SDK v5
  },
  tools,                                // ToolRegistry (FnAdapter, HttpAdapter, etc.)
  context: { userId: '...' },           // Seed values for Context variables
  maxStepsPerTurn: 10,                  // Runaway guard
});
```

### 1.2 VercelAiSdkDriver

`VercelAiSdkDriver` implements the runtime's `LlmDriver` interface. Its design decisions:

1. **Dependency injection** — `generateText` and `jsonSchema` are function parameters, not imports. This lets the package compile without `ai` installed; consumers bring their own version.

2. **Tool schemas without `execute`** — The driver passes tool definitions (name, description, inputSchema) to the SDK but omits any `execute` function. The AgentScript runtime owns tool dispatch, not the SDK. This is the critical architectural boundary: the SDK sees tools as "return-only" definitions.

3. **Non-streaming step model** — Each `step()` call awaits a single `generateText` invocation, then yields `StepEvent` items synchronously from the response. The runtime calls `step()` in a loop until the model signals `stop`.

4. **Message format mapping** — `toAiSdkMessage()` converts runtime `Msg` objects to Vercel SDK format, handling the nuances of tool-result content (v5's `LanguageModelV2ToolResultOutput` tagged union) and multi-part assistant messages containing tool-call parts.

5. **v4/v5 compatibility** — Tool call arguments are read from either `call.input` (v5) or `call.args` (v4), making the adapter forward-compatible.

```
┌──────────────────────────────────────────────────────────────────┐
│ AgentScriptAgent                                                 │
│  ┌────────────┐     ┌──────────────────┐     ┌───────────────┐  │
│  │  Runtime    │────>│ VercelAiSdkDriver│────>│ generateText  │  │
│  │  (loop)    │<────│  (LlmDriver)     │<────│ (AI SDK)      │  │
│  │            │     └──────────────────┘     └───────────────┘  │
│  │            │                                                  │
│  │            │────> ToolRegistry ────> FnAdapter / HttpAdapter  │
│  └────────────┘                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Streaming Architecture

### 2.1 Stream Parts (`AgentStreamPart`)

The stream uses a discriminated union with kebab-case `type` fields, matching Vercel's `fullStream` conventions:

| Type | Payload | Semantics |
|------|---------|-----------|
| `start-step` | `node` | Agent entered a subagent node |
| `finish-step` | `node`, `to?` | Agent exited node, optionally handing off |
| `phase-start` / `phase-end` | `node`, `phase` | Lifecycle phase boundaries |
| `text-delta` | `text` | Incremental model output |
| `tool-call` | `toolName`, `args` | Tool invocation requested by model |
| `tool-result` | `toolName`, `result` | Tool returned successfully |
| `tool-error` | `toolName`, `error` | Tool execution failed |
| `state-change` | `name`, `before`, `after` | AgentScript variable mutated |
| `abort` | `reason?` | Turn was aborted |
| `finish` | `finalNode`, `assistantText` | Turn completed |
| `error` | `error` | Uncaught exception |

### 2.2 fullStream / textStream

`agent.stream(userInput)` returns an `AgentStream` object providing:

- **`fullStream`** — `AsyncIterable<AgentStreamPart>` with all typed events.
- **`textStream`** — `AsyncIterable<string>` that yields only `text-delta` payloads.
- **`result`** — `Promise<AgentRunResult>` that resolves when streaming completes.

### 2.3 Backpressure and Buffering

The stream uses a pull-based buffer:

```
Runtime events ──push()──> parts[]  <──next()── Consumer
                              │
                    (if consumer is ahead)
                              │
                           waiters[] ── Promise resolves on next push()
```

- If the consumer calls `next()` and `parts[]` has items, it resolves immediately.
- If `parts[]` is empty but the stream is not done, a Promise is pushed onto `waiters[]` and will resolve when the next `push()` fires.
- When the runtime finishes (or errors), `close()` drains all pending waiters with `{ done: true }`.

This guarantees no events are lost even if the consumer is slow, without requiring a full ReadableStream.

### 2.4 Bridge from RuntimeEvents

The `runtimeEventToStreamPart()` function maps internal runtime events to the public stream type. Not all events are surfaced — `turn-start`, `turn-end`, `end-session`, `action-skipped`, and `tool-limit-reached` are intentionally suppressed; the `finish` part signals end-of-turn.

---

## 3. Browser Simulator

**File:** `apps/ui/src/lib/simulator.ts`

### 3.1 The `buildAgent()` Pipeline

```
agentSource (string)
    │
    ├─ compileSource() ──> { output (IR), diagnostics }
    │
    ├─ buildToolRegistry(mocks, providers) ──> ToolRegistry
    │
    ├─ createOpenAI({ baseURL, apiKey }) ──> model instance
    │
    └─ createAgent({ doc, llm, tools }) ──> AgentScriptAgent
```

Steps:

1. **Compile** — The raw `.agent` text is compiled via `compileSource()` from `@agentscript/agentforce`. Hard errors (severity 1, excluding `invalid-action-target` lint) abort with a user-facing message.

2. **Configure tools** — `buildToolRegistry()` merges three layers:
   - Default `fn://` handlers (seeded demo tools for order lookup, travel, weather, etc.)
   - User-configured providers (HTTP or MCP adapters)
   - User-defined mocks (which wrap adapters via `MockToolAdapter`)

3. **Create agent** — The `createAgent` factory wires everything together with the user's LLM settings.

### 3.2 `buildToolRegistry` Composition

```
┌─────────────────────────────────────────────────────────┐
│ buildToolRegistry(mocks, providers)                      │
│                                                         │
│  1. Parse mocks → Map<targetURI, jsonObject>            │
│  2. buildAdapters(providers) → Map<scheme, adapter>     │
│     ├─ "fn"   → FnAdapter (seeded)                     │
│     ├─ "http" → HttpAdapter (if HTTP provider)          │
│     ├─ "https"→ HttpAdapter (shares instance)           │
│     └─ "mcp"  → McpBrowserAdapter (if MCP provider)    │
│  3. For each scheme:                                    │
│     ├─ Has mocks? → MockToolAdapter(mocks, adapter)    │
│     └─ No mocks?  → adapter (direct)                   │
│  4. Mock-only schemes → MockToolAdapter(mocks, none)    │
└─────────────────────────────────────────────────────────┘
```

Priority resolution at invocation time: **Mocks > Providers > Default fn handlers**. If a mock matches the tool's full target URI (`fn://search_flights`), the mock's JSON response is returned immediately and the real adapter is never called.

### 3.3 Default Demo Tools

The simulator seeds FnAdapter with deterministic mock handlers for common demo scenarios:

- `fn://lookup_order` — Returns order status based on order number.
- `fn://search_flights` — Returns flight data derived from a hash of the destination.
- `fn://search_hotels` — Returns hotel data with an optional budget cap.
- `fn://get_weather` — Returns weather conditions for a city.
- `fn://confirm_booking` — Returns a deterministic confirmation code.

These use a FNV-1a hash function (`hashCode`) for reproducible-but-varied responses without any network calls.

---

## 4. MCP Browser Adapter

**File:** `apps/ui/src/lib/mcp-browser-adapter.ts`

### 4.1 JSON-RPC 2.0 Protocol

The adapter implements the Model Context Protocol (MCP) using JSON-RPC 2.0 over plain HTTP POST. Each request includes:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "get_weather", "arguments": { "city": "Tokyo" } }
}
```

### 4.2 Initialization Handshake

The MCP spec requires a two-step handshake before tool calls:

1. **`initialize` RPC** — Sends protocol version, empty capabilities, and client info. Receives server capabilities and version.
2. **`notifications/initialized`** — A fire-and-forget notification (no `id` field) confirming the client is ready.

The adapter memoizes initialization via a promise-based mutex (`this.initPromise`). If initialization fails, the promise is nulled so the next call retries.

### 4.3 Timeout Handling

All RPC calls default to 30 seconds (`DEFAULT_TIMEOUT_MS = 30_000`) via `AbortSignal.timeout()`. Callers can override with their own `AbortSignal`.

### 4.4 Target Validation

Before calling the server, the adapter validates the target URI:
- Must start with `mcp://`
- Tool name cannot contain `/` or `..` (path traversal protection)
- Empty tool names are rejected

### 4.5 Response Processing

MCP tool responses use a `content` array. The adapter extracts the first `text`-type entry and attempts JSON parsing. If parsing fails, the raw text is returned as `{ text: "..." }`.

### 4.6 Error Mapping

Errors from the JSON-RPC layer are mapped to exceptions:
- HTTP non-2xx: `"MCP server returned {status}: {body}"`
- Missing `jsonrpc: "2.0"`: `"Invalid JSON-RPC response"`
- ID mismatch: `"JSON-RPC id mismatch: expected {n}, got {m}"`
- Application error: `"MCP error {code}: {message}"`

---

## 5. Tool Provider System

**File:** `apps/ui/src/store/toolProviderStore.ts`

### 5.1 Zustand Store

The store manages an array of `ToolProvider` objects persisted to `localStorage` under key `agentscript.tool-providers`:

```ts
interface ToolProvider {
  id: string;          // UUID
  name: string;        // Display name
  type: 'http' | 'mcp';
  url: string;         // Endpoint URL
  headers?: string;    // JSON string of custom headers
  enabled: boolean;    // Toggle
  discoveredTools?: string[];  // From "Test" button (not persisted)
}
```

**Actions:**
- `addProvider(type)` — Creates a new provider with sensible defaults.
- `updateProvider(id, patch)` — Partial update.
- `removeProvider(id)` — Delete.
- `toggleProvider(id)` — Enable/disable.
- `setDiscoveredTools(id, tools)` — Stores tool names discovered via test.

**Persistence:** `partialize` strips `discoveredTools` before saving — it is runtime-only state discovered by the Test button and not meaningful across sessions.

### 5.2 Wiring into the Simulator

The `Simulate` page reads providers from the store via `useToolProviderStore.getState().providers` (deferred read inside `getAgent()`) rather than subscribing reactively. This prevents unnecessary agent rebuilds when the provider list reference changes but its content has not.

The agent is rebuilt (and the ref cache invalidated) when the providers hash changes.

### 5.3 "Test" Discovery Flow

When the user clicks "Test" on a provider row:

- **MCP providers:** A temporary `McpBrowserAdapter` is instantiated. `listTools()` performs the initialization handshake and then calls `tools/list`. The returned tool names populate the `discoveredTools` badge list.
- **HTTP providers:** An `OPTIONS` preflight is sent to the URL. A 2xx or 204 response is treated as success.

---

## 6. Mock System

**File:** `apps/ui/src/store/agentStore.ts` (data), `apps/ui/src/components/simulator/MocksPanel.tsx` (UI)

### 6.1 MockToolAdapter

`MockToolAdapter` (from `@agentscript/runtime`) wraps a real adapter. At invocation time:
1. Check if the full target URI has a mock entry.
2. If yes, return the mock's JSON object immediately.
3. If no, delegate to the wrapped adapter (if one exists).

### 6.2 Priority Order

```
Tool call arrives: "fn://search_flights"
   │
   ├─ Mock exists for "fn://search_flights"? → Return mock JSON
   │
   └─ No mock → FnAdapter.invoke("fn://search_flights", args)
                    │
                    └─ Handler registered? → Execute handler
                    └─ Not registered? → ToolError
```

### 6.3 Data Model

Mocks are stored per-agent in the `agentStore` (inside the `Agent.mocks` array) and persisted to localStorage alongside the agent's source code:

```ts
interface ToolMock {
  id: string;
  target: string;         // Full URI like "fn://search_flights"
  responseJson: string;   // Raw JSON string (validated at build time)
  enabled: boolean;
}
```

### 6.4 Mock Configuration UI

The `MocksPanel` component provides:
- **Add mock** button to create a new row.
- Per-mock toggle switch (enable/disable).
- Target URI input (monospace, placeholder: `fn://search_flights`).
- Response JSON textarea with real-time validation (red border + error message for non-object or invalid JSON).
- Delete button per row.

Invalid mocks (bad JSON, non-object response, missing `://` in target) are silently skipped at build time and reported in `BuildAgentResult.invalidMocks`.

---

## 7. UI Architecture

### 7.1 Page Layout

The Simulate page uses a `ResizablePanelGroup` (horizontal) with two panels:

```
┌────────────────────────────────────────────────────────────────┐
│ Header bar: "Simulator" · model name · "light TS runtime"      │
│             [Reset] [Settings]                                  │
├──────────────────────────────┬─────────────────────────────────┤
│                              │  [Events] [Mocks] [Providers]   │
│                              │  [Snippet]                      │
│   Transcript                 │                                 │
│   (chat messages)            │  Tab content area               │
│                              │  (auto-scrolling, monospace)    │
│                              │                                 │
├──────────────────────────────┼─────────────────────────────────┤
│  [  Input textarea  ] [Send]│                                  │
└──────────────────────────────┴─────────────────────────────────┘
```

- **Left panel** (55% default): `Transcript` component with user/assistant/system messages and an input area.
- **Right panel** (45% default): `RightPane` tab container with Events, Mocks, Providers, and Snippet tabs.

### 7.2 Right-Pane Tab System

`RightPane` accepts an array of `{ id, label, badge?, content }` tab definitions. The active tab is tracked in local state. Badge numbers (enabled mock count, enabled provider count) appear next to tab labels.

### 7.3 State Management

| Store | Key | Purpose |
|-------|-----|---------|
| `useLlmSettingsStore` | `agentscript.llm-settings` | LLM endpoint config |
| `useToolProviderStore` | `agentscript.tool-providers` | External tool servers |
| `useAgentStore` | `agent-storage` | Agent scripts, mocks, metadata |
| `useAppStore` | (composite) | Current editor source, layout |

### 7.4 Reactive vs Deferred Reads

- **Reactive** (trigger re-renders): LLM settings, provider count badge, mocks array, agent source.
- **Deferred** (read inside callbacks): Full provider list is read via `useToolProviderStore.getState()` inside `getAgent()`, avoiding re-renders when provider metadata changes but the simulator is not actively building an agent.

### 7.5 Agent Instance Caching

A `useRef` holds the current `AgentScriptAgent` alongside hashes of: source, settings, mocks, providers. The agent is only rebuilt when one of these hashes changes. This lets multi-turn conversations maintain state and chat history across user messages.

---

## 8. Development Setup

### 8.1 Vite Proxy for MCP

The UI's dev server (port 27003) proxies `/mcp-proxy` to `http://localhost:3001`:

```ts
// vite.config.ts
server: {
  proxy: {
    '/mcp-proxy': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/mcp-proxy/, ''),
    },
  },
}
```

This avoids CORS issues when the browser calls an MCP server during development. The default MCP provider URL is `/mcp-proxy`, which routes through Vite to whatever is listening on port 3001.

### 8.2 Fake Test MCP Server

**File:** `apps/ui/test-mcp-server.ts`

A minimal Node.js HTTP server that implements the MCP JSON-RPC protocol with three tools:

| Tool | Input | Response |
|------|-------|----------|
| `get_weather` | `city: string` | Random temperature + conditions |
| `calculate` | `expression: string` | Evaluated math expression |
| `search` | `query: string` | Two mock search results |

Run it with:
```bash
npx tsx apps/ui/test-mcp-server.ts
```

It handles `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` methods, plus CORS preflight.

### 8.3 Adding a New Provider Type

To add a new tool provider type (e.g., gRPC):

1. **Add type to store** — Extend `ProviderType` in `toolProviderStore.ts`:
   ```ts
   export type ProviderType = 'http' | 'mcp' | 'grpc';
   ```

2. **Implement the adapter** — Create a class implementing `ToolAdapter` from `@agentscript/runtime`:
   ```ts
   interface ToolAdapter {
     invoke(invocation: ToolAdapterInvocation): Promise<Record<string, unknown>>;
   }
   ```

3. **Register in `buildAdapters()`** — In `simulator.ts`, add a case for the new type:
   ```ts
   const grpcProvider = active.find((p) => p.type === 'grpc');
   if (grpcProvider) {
     adapters.set('grpc', new GrpcAdapter(grpcProvider.url, headers));
   }
   ```

4. **Add UI button** — In `ProvidersPanel.tsx`, add a button calling `addProvider('grpc')`.

5. **Add test logic** — In `ProviderRow`, add a case inside `handleTest()` for the new type.

---

## 9. LLM Configuration

### 9.1 Settings Store

**File:** `apps/ui/src/store/llmSettings.ts`

```ts
interface LlmSettings {
  baseUrl: string;   // OpenAI-compatible endpoint
  apiKey: string;    // Bearer token
  model: string;     // Model identifier
  provider: 'openai'; // Wire protocol (pinned for now)
}
```

Default values: `https://api.openai.com/v1`, empty key, `gpt-4o-mini`.

### 9.2 Settings Dialog

The Settings dialog (accessible from the Simulator header bar) provides a left-nav with sections: General, LLM Endpoint, Version. The LLM section renders:

- **Base URL** input — Any OpenAI-compatible endpoint.
- **API Key** input — Type `password`, with a prominent localStorage security warning.
- **Model** input — Free-form text (model identifiers vary across providers).
- **Save / Reset** buttons with dirty-state tracking.

### 9.3 Provider Compatibility

The architecture uses `@ai-sdk/openai`'s `createOpenAI` with a custom `baseURL`, making it compatible with:

| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Anthropic (via gateway) | `https://gateway.example.com/v1` |
| Azure OpenAI | `https://{resource}.openai.azure.com/...` |
| LiteLLM | `http://localhost:4000/v1` |
| vLLM | `http://localhost:8000/v1` |
| Ollama | `http://localhost:11434/v1` |

### 9.4 How Settings Are Consumed

The `Simulate` page assembles a `LlmSettings` object from reactive store selectors:

```ts
const settings = useMemo(
  () => ({ baseUrl, apiKey, model, provider }),
  [baseUrl, apiKey, model, provider]
);
```

This is passed to `buildAgent()` which uses it to create the OpenAI client and model instance. The settings hash is part of the agent cache key, so changing the endpoint or model automatically rebuilds the agent on the next user message.

### 9.5 Code Snippet Export

The `SnippetPanel` generates a copy-paste-ready TypeScript file that mirrors the current simulator configuration. It uses environment variables (`OPENAI_BASE_URL`, `OPENAI_API_KEY`) instead of inlining secrets, and includes the install command:

```bash
pnpm add @agentscript/runtime @agentscript/runtime-vercel ai @ai-sdk/openai
```

---

## Key File Reference

| Layer | File | Purpose |
|-------|------|---------|
| Vercel adapter | `packages/runtime-vercel/src/agent.ts` | AgentScriptAgent class, stream implementation |
| Vercel adapter | `packages/runtime-vercel/src/driver.ts` | VercelAiSdkDriver (LlmDriver implementation) |
| Vercel adapter | `packages/runtime-vercel/src/index.ts` | Public API surface |
| Simulator | `apps/ui/src/lib/simulator.ts` | buildAgent, buildToolRegistry, demo tools |
| MCP adapter | `apps/ui/src/lib/mcp-browser-adapter.ts` | JSON-RPC 2.0 MCP client |
| Store | `apps/ui/src/store/toolProviderStore.ts` | Provider CRUD + persistence |
| Store | `apps/ui/src/store/llmSettings.ts` | LLM endpoint settings |
| Store | `apps/ui/src/store/agentStore.ts` | Agent scripts + per-agent mocks |
| Page | `apps/ui/src/pages/Simulate.tsx` | Simulator page orchestration |
| Component | `apps/ui/src/components/simulator/Transcript.tsx` | Chat display |
| Component | `apps/ui/src/components/simulator/EventTimeline.tsx` | Stream event viewer |
| Component | `apps/ui/src/components/simulator/MocksPanel.tsx` | Mock editor UI |
| Component | `apps/ui/src/components/simulator/ProvidersPanel.tsx` | Provider config UI |
| Component | `apps/ui/src/components/simulator/SnippetPanel.tsx` | Code export |
| Component | `apps/ui/src/components/simulator/RightPane.tsx` | Tab container |
| Config | `apps/ui/vite.config.ts` | Dev server proxy |
| Test server | `apps/ui/test-mcp-server.ts` | Fake MCP server for development |
| Example | `packages/runtime-vercel/examples/run-mock.ts` | Mock LLM end-to-end |
| Example | `packages/runtime-vercel/examples/run-anthropic.ts` | Real Anthropic model |
| Example | `packages/runtime-vercel/examples/run-gateway.ts` | OpenAI-compatible gateway |
| Example | `packages/runtime-vercel/examples/run-gateway-travel.ts` | Multi-agent travel demo |
