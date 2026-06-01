# Test Coverage Gaps (P0/P1/P2)

This file maps missing automation to concrete test additions.

## P0 (release blockers)

1. **Agentforce route integration tests**
   - Missing: direct HTTP integration tests for all primary lifecycle routes.
   - Add: `packages/server/tests/agent-api-routes.integration.test.ts`
   - Cover: start, sync, stream, feedback, end, and error envelopes.

2. **Legacy alias parity tests**
   - Missing: formal assertions that `/v1/*` aliases match primary behavior.
   - Add: `packages/server/tests/legacy-aliases.integration.test.ts`

3. **Rate limit and payload cap tests**
   - Missing: deterministic 429/413 assertions.
   - Add: `packages/server/tests/security-rate-limit.test.ts`

4. **Config validation tests**
   - Missing: startup failure tests for invalid/missing critical env.
   - Add: `packages/server/tests/config-validation.test.ts`

## P1 (next sprint)

1. **Postgres store integration tests**
   - Missing: real DB-backed CRUD tests for `PostgresSessionStore`.
   - Add: `packages/server/tests/postgres-session-store.integration.test.ts`
   - Run with ephemeral Postgres in CI (service container).

2. **Circuit breaker lifecycle tests**
   - Missing: open -> deny -> close-after-window end-to-end behavior in API path.
   - Add: `packages/server/tests/runtime-policy.integration.test.ts`

3. **WebSocket protocol integration tests**
   - Missing: automated WS session path tests for message/Done/Error envelopes.
   - Add: `packages/server/tests/websocket.integration.test.ts`

## P2 (nice-to-have)

1. **Load/soak scripts**
   - Missing: scripted load profile for rate limits and stream stability.
   - Add: `packages/server/scripts/load-test.mjs`

2. **Chaos/failure-injection tests**
   - Missing: injected LLM/store intermittent failures and recovery timing checks.
   - Add: `packages/server/tests/chaos.integration.test.ts`

3. **Docs contract checks**
   - Missing: verify examples in docs remain executable.
   - Add: lightweight docs contract test harness for curl snippets.
