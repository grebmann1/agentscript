# Gateway Model Validation — Test Results & Agent Scripts

This document details the deterministic test suite for validating LLM gateway models against the AgentScript JS Runtime. All tests ran against the Salesforce internal LLM Gateway with `claude-haiku-4-5-20251001`.

---

## Test Results Summary

| # | Test Script | Assertions | Result | Duration |
|---|-------------|-----------|--------|----------|
| 1 | `test-basic-tool-call.ts` | 4/4 | PASS | 3.6s |
| 2 | `test-state-and-guard.ts` | 6/6 | PASS | 4.6s |
| 3 | `test-multi-agent-handoff.ts` | 5/5 | PASS | 5.2s |
| 4 | `test-parallel-tools.ts` | 10/10 | PASS | 304ms (tool time) |
| 5 | `test-parallel-timing.ts` | 11/11 | PASS | 504ms parallel / 554ms sequential |
| 6 | `test-middleware.ts` | 6/6 | PASS | ~3s |
| 7 | `test-guardrails.ts` | 8/8 | PASS | ~5s |
| 8 | `test-abort-and-timeout.ts` | 10/10 | PASS | 201ms / 316ms / ~2s |
| | **Total** | **60/60** | **ALL PASS** | |

---

## How to Run

```bash
# Configuration is auto-detected from your Claude settings:
#   ANTHROPIC_BEDROCK_BASE_URL → strips /bedrock, adds /v1
#   ANTHROPIC_AUTH_TOKEN → used as API key

# Run a single test:
pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-basic-tool-call.ts

# Run all tests:
for f in packages/runtime-vercel/examples/gateway-tests/test-*.ts; do
  echo "--- $f ---"
  pnpm exec tsx "$f"
  echo ""
done

# Override model:
LLM_GATEWAY_MODEL=claude-sonnet-4-6 pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-basic-tool-call.ts
```

---

## Design Principles

1. **Deterministic tool outputs** — all mock tools return hard-coded JSON, ensuring the logical flow is identical regardless of model
2. **Structural assertions** — we never assert on LLM-generated text; only on which tools were called, in what order, with what arguments, and what state resulted
3. **Configurable delays** — mock tools use `setTimeout` to simulate real latency, enabling timing-based assertions for parallel execution
4. **Model-agnostic** — swap `LLM_GATEWAY_MODEL` to validate any model against the same behavioral baseline
5. **No test framework** — standalone scripts, exit 0/1, runnable anywhere with `tsx`

---

## Test Details & AgentScript Sources

### Test 1: Basic Tool Call

**File:** `test-basic-tool-call.ts`  
**Validates:** Single tool invocation, argument passing, state mutation from tool output.

#### AgentScript

```yaml
system:
    instructions: "You are an order tracking assistant. When the user gives an order number, call the lookup_order tool immediately."

config:
    agent_name: "OrderLookupTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    order_status: mutable string = ""
        description: "Status returned by the lookup tool"

start_agent order_bot:
    description: "Looks up order status on demand"

    actions:
        Lookup_Order:
            description: "Look up an order by its number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                tracking: string
                    description: "Tracking number"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   The user wants to check an order. Call {!@actions.lookup}
                with the order number they provide. Report the result.
        actions:
            lookup: @actions.Lookup_Order
                with order_number=...
                set @variables.order_status = @outputs.status
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `lookup_order` | 150ms | `{ status: "shipped", tracking: "TRK-9876" }` |

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1 | `lookup_order` was called | Model understands tool availability |
| 2 | Called with args containing "ORD-123" | Model extracts entities from user message |
| 3 | State `order_status` == "shipped" | `set @variables` works correctly |
| 4 | No errors | Clean execution |

#### Output

```
> user: What's the status of order ORD-123?

  [tool-call]  fn://lookup_order({"order_number":"ORD-123"})
  [tool-res]   fn://lookup_order -> {"status":"shipped","tracking":"TRK-9876"}
  [state]      order_status: "" -> "shipped"

  4/4 passed
```

---

### Test 2: State Guards & Multi-Turn

**File:** `test-state-and-guard.ts`  
**Validates:** `available when` guards, tool ordering enforcement, multi-turn conversation.

#### AgentScript

```yaml
system:
    instructions: "You are a banking assistant. Users must authenticate before checking their balance. If the user asks for their balance and is not authenticated, call authenticate first, then check_balance."

config:
    agent_name: "BankGuardTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    authenticated: mutable boolean = False
        description: "Whether the user has been authenticated"
    balance: mutable string = ""
        description: "Account balance returned by the check_balance tool"

start_agent bank_bot:
    description: "Handles authentication and balance inquiries"

    actions:
        Authenticate:
            description: "Authenticate the current user"
            inputs:
                reason: string
                    description: "Why authentication is needed"
                    is_required: False
            outputs:
                success: boolean
                    description: "Whether authentication succeeded"
                user: string
                    description: "Authenticated username"
            target: "fn://authenticate"

        Check_Balance:
            description: "Check the account balance for the authenticated user"
            inputs:
                account_type: string
                    description: "Type of account to check"
                    is_required: False
            outputs:
                balance: string
                    description: "Current account balance"
                currency_code: string
                    description: "Currency code"
            target: "fn://check_balance"

    reasoning:
        instructions: ->
            |   Help the user with banking inquiries.
                If the user wants to check their balance and is not yet
                authenticated (authenticated={! @variables.authenticated }),
                call {!@actions.auth} first. Once authenticated, call
                {!@actions.get_balance} to retrieve the balance.
                Always authenticate before checking balance.
        actions:
            auth: @actions.Authenticate
                with reason=...
                set @variables.authenticated = True

            get_balance: @actions.Check_Balance
                available when @variables.authenticated == True
                with account_type=...
                set @variables.balance = @outputs.balance
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `authenticate` | 100ms | `{ success: true, user: "john" }` |
| `check_balance` | 50ms | `{ balance: "$1,234.56", currency: "USD" }` |

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1 | `authenticate` was called | Model respects auth requirement |
| 2 | `check_balance` was called | Model calls guarded tool after auth |
| 3 | `authenticate` called BEFORE `check_balance` | `available when` guard enforces ordering |
| 4 | State `balance` contains "$1,234" | Tool output flows to state correctly |
| 5 | State `authenticated` is true | Boolean state mutation works |
| 6 | No errors | Clean multi-turn execution |

#### Output

```
--- Turn 1: "Check my account balance please" ---

  [tool-call]  fn://authenticate({"reason":"To check your account balance"})
  [tool-res]   fn://authenticate -> {"success":true,"user":"john"}
  [state]      authenticated: false -> true
  [tool-call]  fn://check_balance({})
  [tool-res]   fn://check_balance -> {"balance":"$1,234.56","currency":"USD"}
  [state]      balance: "" -> "$1,234.56"

  6/6 passed
```

---

### Test 3: Multi-Agent Handoff

**File:** `test-multi-agent-handoff.ts`  
**Validates:** Node transitions (handoffs), correct routing between subagents.

#### AgentScript

```yaml
system:
    instructions: "You are a routing assistant. Route travel questions (flights, hotels) to the travel agent and order questions to the order agent. Always route immediately without asking follow-up questions."

config:
    agent_name: "RouterHandoffTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    destination: mutable string = ""
        description: "Travel destination"
    flight_result: mutable string = ""
        description: "Flight search result"
    order_result: mutable string = ""
        description: "Order lookup result"

start_agent router:
    description: "Routes user requests to the appropriate specialist agent"

    reasoning:
        instructions: ->
            |   You are a request router. Analyze the user's message:
                - If they ask about flights, travel, or hotels, immediately call {!@actions.go_to_travel}.
                - If they ask about orders, tracking, or deliveries, immediately call {!@actions.go_to_orders}.
                Do NOT answer the question yourself. Always route to a specialist.
        actions:
            go_to_travel: @utils.transition to @subagent.travel_agent
                description: "Route to the travel specialist for flight and hotel queries"

            go_to_orders: @utils.transition to @subagent.order_agent
                description: "Route to the order specialist for order and delivery queries"

subagent travel_agent:
    description: "Searches flights for the user"

    actions:
        Search_Flights:
            description: "Search for flights to a destination"
            inputs:
                destination: string
                    description: "Destination city or airport"
                    is_required: True
                travel_date: string
                    description: "Desired travel date"
                    is_required: False
            outputs:
                flight: string
                    description: "Flight number"
                price: number
                    description: "Price in USD"
                departure: string
                    description: "Departure time"
            target: "fn://search_flights"

    reasoning:
        instructions: ->
            |   Search for flights using {!@actions.find_flight}.
                The user wants to go to: {! @variables.destination }.
                Call the search tool with the destination from the user's message.
        actions:
            find_flight: @actions.Search_Flights
                with destination=...
                with travel_date=...
                set @variables.flight_result = @outputs.flight

subagent order_agent:
    description: "Looks up order status"

    actions:
        Lookup_Order:
            description: "Look up an order by number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                updated_at: string
                    description: "Last update date"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   Look up the user's order using {!@actions.find_order}.
                Call the tool with the order number from the user's message.
        actions:
            find_order: @actions.Lookup_Order
                with order_number=...
                set @variables.order_result = @outputs.status
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `search_flights` | 200ms | `{ flight: "AA-100", price: 450, departure: "10:30 AM" }` |
| `lookup_order` | 100ms | `{ status: "delivered", date: "2024-01-15" }` |

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1 | Handoff from `router` → `travel_agent` | Model triggers correct transition |
| 2 | `search_flights` was called | Post-handoff node executes correctly |
| 3 | `lookup_order` was NOT called | Routing is precise (no wrong agent) |
| 4 | Final node is `travel_agent` | Graph state is correct |
| 5 | No errors | Clean graph traversal |

#### Output

```
> user: I need to find a flight to Paris

  [node-enter] router
  [handoff]    <current> -> travel_agent
  [node-enter] travel_agent

--- Turn 2: follow-up after handoff ---

  [tool-call]  fn://search_flights({"destination":"Paris"})
  [tool-res]   fn://search_flights -> {"flight":"AA-100","price":450,"departure":"10:30 AM"}

  5/5 passed
```

---

### Test 4: Parallel Tool Dispatch

**File:** `test-parallel-tools.ts`  
**Validates:** Multiple tools dispatched concurrently, timing proves parallelism.

#### AgentScript

```yaml
system:
    instructions: "You are a research assistant. When the user asks a question, search ALL three sources simultaneously to find the answer. Always call all three tools."

config:
    agent_name: "ResearchBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    search_results: mutable string = ""
        description: "Aggregated search results"

start_agent researcher:
    description: "Searches multiple sources in parallel"

    actions:
        Search_Web:
            description: "Search the web for information"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Web search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_web"

        Search_Database:
            description: "Search the internal database"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Database search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_database"

        Search_Cache:
            description: "Search the local cache"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Cache search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_cache"

    reasoning:
        instructions: ->
            |   Search all three sources for the user's query using
                {!@actions.search_web}, {!@actions.search_database},
                and {!@actions.search_cache}, then summarize the results.
        actions:
            search_web: @actions.Search_Web
                with query=...
            search_database: @actions.Search_Database
                with query=...
            search_cache: @actions.Search_Cache
                with query=...
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `search_web` | 300ms | `{ results: ["Web result 1", "Web result 2"], source: "web" }` |
| `search_database` | 200ms | `{ results: ["DB record 1"], source: "database" }` |
| `search_cache` | 100ms | `{ results: ["Cached item"], source: "cache" }` |

#### Runtime Config

```typescript
parallel: { strategy: 'always' }
```

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1-3 | All 3 tools called | Model issues all tool calls |
| 4 | Total tool calls == 3 | No duplicates |
| 5 | Turn duration < 500ms | **Parallel execution** (sequential = 600ms+) |
| 6-7 | `parallel-dispatch-start/end` events | Runtime dispatched in parallel |
| 8 | No tool errors | All tools resolved |
| 9 | Text is non-empty | Model summarized results |
| 10 | Call log has 3 entries | All tools hit the mock |

#### Output

```
Config: parallel strategy = "always"
Tools:  search_web (300ms), search_database (200ms), search_cache (100ms)
Expected: all 3 tools called in parallel, total < 500ms

  Turn duration: 304ms   ← proves parallel (300ms max tool + overhead)

  10/10 passed
```

---

### Test 5: Parallel vs Sequential Timing

**File:** `test-parallel-timing.ts`  
**Validates:** Parallel strategy actually speeds things up vs sequential.

#### AgentScript

```yaml
system:
    instructions: "You are a processing assistant. Call both tools to process the user's request."

config:
    agent_name: "TimingBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    processing_result: mutable string = ""
        description: "Result of processing"

start_agent processor:
    description: "Processes requests using two tools"

    actions:
        Fast_Tool:
            description: "A fast processing tool"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://fast_tool"

        Slow_Tool:
            description: "A slower processing tool"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://slow_tool"

    reasoning:
        instructions: ->
            |   Call both {!@actions.fast_tool} and {!@actions.slow_tool}
                to process the user's request, then summarize the results.
        actions:
            fast_tool: @actions.Fast_Tool
                with request=...
            slow_tool: @actions.Slow_Tool
                with request=...
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `fast_tool` | 50ms | `{ result: "fast_done" }` |
| `slow_tool` | 500ms | `{ result: "slow_done" }` |

#### Two Runs

| Run | Strategy | Duration | Behavior |
|-----|----------|----------|----------|
| 1 | `'always'` (parallel) | 504ms | max(50, 500) + overhead |
| 2 | `'never'` (sequential) | 554ms | 50 + 500 + overhead |

#### Output

```
--- Run 1: parallel (strategy: "always") ---
  Duration: 504ms

--- Run 2: sequential (strategy: "never") ---
  Duration: 554ms

  Speedup: 1.1x
  11/11 passed
```

---

### Test 6: Middleware Pipeline

**File:** `test-middleware.ts`  
**Validates:** Middleware intercepts tool calls, can log and block them.

#### AgentScript

```yaml
system:
    instructions: "You are a calculator assistant. Use the calculate tool to evaluate math expressions. When the user asks you to calculate multiple expressions, call the calculate tool once for each expression."

config:
    agent_name: "CalcBot"
    default_agent_user: "calc@example.com"

language:
    default_locale: "en_US"

variables:
    last_result: mutable string = ""
        description: "Last calculation result"

start_agent calculator:
    description: "Evaluates math expressions using the calculate tool"

    actions:
        Calculate:
            description: "Evaluate a mathematical expression"
            inputs:
                expression: string
                    description: "The math expression to evaluate"
                    is_required: True
            outputs:
                result: number
                    description: "The numeric result"
            target: "fn://calculate"

    reasoning:
        instructions: ->
            |   You must use the calculate tool for each expression.
                Call calculate once per expression. Do not skip any.
        actions:
            calc: @actions.Calculate
                with expression=...
                set @variables.last_result = @outputs.result
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `calculate` | 50ms | `{ result: 42 }` |

#### Middleware Stack

| Priority | Middleware | Behavior |
|----------|-----------|----------|
| 10 | Logging | Records all `beforeToolCall` invocations |
| 50 | Rate Limiter | After 2 calls, returns `{ abort: true, result: { error: "rate limited" } }` |

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1 | Logging captured >= 2 attempts | Middleware sees all calls |
| 2 | Rate-limiter processed >= 2 calls | Priority ordering works |
| 3 | At most 2 tool-result events | 3rd call was blocked |
| 4 | Assistant text produced | Rate-limit is graceful, not fatal |
| 5 | No fatal error | Agent recovers from blocked tools |
| 6 | All tool calls target `calculate` | Correct tool targeted |

#### Output

```
> user: Calculate 2+2, then 3*3, then 5+5

  Logging middleware captured >= 2 tool call attempts  ✓
  Rate-limit middleware processed >= 2 calls           ✓
  At most 2 tool-result events (got 2)                 ✓
  Turn produced assistant text                         ✓

  6/6 passed
```

---

### Test 7: Output Guardrails

**File:** `test-guardrails.ts`  
**Validates:** Guardrails validate LLM output, retry on failure, exhaust after max retries.

#### AgentScript

```yaml
system:
    instructions: "You are a polite assistant. Always respond warmly to greetings. Never use profanity. Keep responses under two sentences."

config:
    agent_name: "GreeterBot"
    default_agent_user: "greeter@example.com"

language:
    default_locale: "en_US"

variables:
    mood: mutable string = "neutral"
        description: "Current user mood"

start_agent greeter:
    description: "Responds politely to user greetings"

    reasoning:
        instructions: ->
            |   Respond politely to the user's greeting in one or two sentences.
                Do not call any tools.
```

#### Guardrail Tests

**Test A — Content Policy (should pass):**
```typescript
contentPolicyGuardrail({ blocklist: ['XYZZY_FORBIDDEN', 'NEVER_SAY_THIS'], target: 'output' })
```
The model will never say these words → guardrail passes.

**Test B — Impossible Regex (should exhaust):**
```typescript
regexGuardrail({ pattern: /IMPOSSIBLE_STRING_XYZ/, target: 'output' })
```
The model can never produce this string → retries exhaust → `GuardrailExhaustionError`.

#### Assertions

| # | Assertion | What It Proves |
|---|-----------|----------------|
| 1 | No error (Test A) | Guardrail passes when content is clean |
| 2 | Non-empty response | Agent responds normally |
| 3 | `guardrail-pass` event emitted | Runtime emits validation events |
| 4 | No `guardrail-fail` events | Clean pass, no retries |
| 5 | `GuardrailExhaustionError` thrown (Test B) | Retries exhaust correctly |
| 6 | Error is correct type | Runtime throws the right error class |
| 7 | Error names correct guardrail | Diagnostic info present |
| 8 | >= 2 attempts reported | Retry loop ran |

#### Output

```
--- Test A: Content-policy guardrail (should pass) ---
  [PASS] No error, guardrail-pass event emitted

--- Test B: Regex guardrail (should fail and exhaust) ---
  [PASS] GuardrailExhaustionError thrown after retries

  8/8 passed
```

---

### Test 8: Abort & Timeout

**File:** `test-abort-and-timeout.ts`  
**Validates:** AbortSignal cancellation, timeout behavior, normal completion.

#### AgentScript (Slow)

```yaml
system:
    instructions: "You are a processing assistant. Always call slow_process to handle the user's request. Do not respond without calling the tool first."

config:
    agent_name: "SlowBot"
    default_agent_user: "slow@example.com"

language:
    default_locale: "en_US"

variables:
    status: mutable string = "idle"
        description: "Processing status"

start_agent processor:
    description: "Calls slow_process to handle user requests"

    actions:
        Slow_Process:
            description: "A slow processing operation"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://slow_process"

    reasoning:
        instructions: ->
            |   You must call {!@actions.slow_process_action} to handle
                the user request. Always call the tool before responding.
        actions:
            slow_process_action: @actions.Slow_Process
                with request=...
                set @variables.status = @outputs.result
```

#### AgentScript (Fast)

```yaml
system:
    instructions: "You are a processing assistant. Always call fast_process to handle the user's request. Do not respond without calling the tool first."

config:
    agent_name: "FastBot"
    default_agent_user: "fast@example.com"

language:
    default_locale: "en_US"

variables:
    status: mutable string = "idle"
        description: "Processing status"

start_agent processor:
    description: "Calls fast_process to handle user requests"

    actions:
        Fast_Process:
            description: "A fast processing operation"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://fast_process"

    reasoning:
        instructions: ->
            |   You must call {!@actions.fast_process_action} to handle
                the user request. Always call the tool before responding.
        actions:
            fast_process_action: @actions.Fast_Process
                with request=...
                set @variables.status = @outputs.result
```

#### Mock Tools

| Tool | Delay | Response |
|------|-------|----------|
| `slow_process` | 5000ms | `{ result: "done" }` |
| `fast_process` | 50ms | `{ result: "done" }` |

#### Test Scenarios

| Test | Signal | Expected |
|------|--------|----------|
| A | `controller.abort()` after 200ms | AbortError, duration < 3s |
| B | `AbortSignal.timeout(300)` | TimeoutError, duration < 3s |
| C | No signal (fast tool) | Success, text produced |

#### Output

```
--- Test A: Abort mid-execution (200ms) ---
  Duration: 201ms
  [PASS] AbortError thrown, execution aborted quickly

--- Test B: Timeout via AbortSignal.timeout(300) ---
  Duration: 316ms
  [PASS] TimeoutError thrown

--- Test C: Normal completion (fast tool, no abort) ---
  [PASS] No error, assistant produced text

  10/10 passed
```

---

## Harness API Quick Reference

```typescript
import {
  createGatewayConfig,  // Reads ANTHROPIC_BEDROCK_BASE_URL + ANTHROPIC_AUTH_TOKEN
  createLlmDriver,      // Creates VercelAiSdkDriver from config
  createTestAgent,      // Compiles source + creates Runtime
  runTurn,              // Streams a turn, captures events + timing
  mockTool,             // Creates deterministic FnAdapter with delays
  assertions,           // Structural assertion helpers
  report,               // Print pass/fail summary, exit 0/1
} from './harness.js';
```

### Assertion Methods

| Method | Purpose |
|--------|---------|
| `assertions.ok(cond, label, detail?)` | Boolean assertion |
| `assertions.eq(actual, expected, label)` | Equality check |
| `assertions.gte(value, min, label)` | Greater-than-or-equal |
| `assertions.lt(value, max, label)` | Less-than |
| `assertions.truthy(value, label)` | Truthiness check |
| `assertions.throwsAsync(fn, label)` | Expects a thrown error |
| `report(suiteName)` | Print results, exit with code |

---

## What Each Test Validates (Feature Coverage Matrix)

| Feature | Test 1 | Test 2 | Test 3 | Test 4 | Test 5 | Test 6 | Test 7 | Test 8 |
|---------|:------:|:------:|:------:|:------:|:------:|:------:|:------:|:------:|
| Tool invocation | x | x | x | x | x | x | | x |
| Argument passing | x | | | | | | | |
| State mutation | x | x | | | | | | |
| `available when` guard | | x | | | | | | |
| Multi-turn | | x | x | | | | | |
| Node transitions (handoff) | | | x | | | | | |
| Multi-agent routing | | | x | | | | | |
| Parallel tool dispatch | | | | x | x | | | |
| Parallel timing validation | | | | x | x | | | |
| Middleware intercept | | | | | | x | | |
| Middleware rate-limiting | | | | | | x | | |
| Output guardrails (pass) | | | | | | | x | |
| Output guardrails (exhaust) | | | | | | | x | |
| AbortSignal cancellation | | | | | | | | x |
| Timeout behavior | | | | | | | | x |
