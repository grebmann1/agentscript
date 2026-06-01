# Full Test Matrix (A→Z)

This matrix covers `@agentscript/server` and integration touchpoints with runtime/compiler dependencies.

## A. Static Quality Gates

| ID | Scenario | Command | Expected | Failure signature |
|---|---|---|---|---|
| A1 | Build passes | `pnpm --filter @agentscript/server build` | TypeScript compile succeeds | `tsc` type errors |
| A2 | Server tests pass | `pnpm --filter @agentscript/server test` | All test files pass | Vitest failed tests |
| A3 | Smoke gate passes | `pnpm --filter @agentscript/server smoke` | Session lifecycle smoke succeeds | smoke script throws / non-zero exit |

## B. API Lifecycle (Agentforce-style)

| ID | Scenario | Setup | Request | Expected |
|---|---|---|---|---|
| B1 | Start session | valid auth token | `POST /einstein/ai-agent/v1/agents/:agentId/sessions` | 201 + `sessionId` + `_links` |
| B2 | Send sync message | active session | `POST /einstein/ai-agent/v1/sessions/:id/messages` | 200 + `messages[]` text |
| B3 | Send stream message | active session | `POST /einstein/ai-agent/v1/sessions/:id/messages/stream` | SSE events include `Text` and `Done` |
| B4 | Feedback | active session + message id | `POST /einstein/ai-agent/v1/sessions/:id/messages/:messageId/feedback` | 200 + `status=accepted` |
| B5 | End session | active session | `DELETE /einstein/ai-agent/v1/sessions/:id` | 204 |
| B6 | Session lookup missing id | none | `GET /einstein/ai-agent/v1/sessions/:missing` | 404 with error envelope |

## C. Legacy Alias Compatibility

| ID | Scenario | Request | Expected |
|---|---|---|---|
| C1 | `/v1/sessions` create alias | `POST /v1/sessions` | 201 + `x-api-deprecated: true` |
| C2 | `/v1/sessions/:id/messages` alias | `POST /v1/sessions/:id/messages` | 200 + `x-api-deprecated: true` |
| C3 | `/v1/sessions/:id` end alias | `DELETE /v1/sessions/:id` | 204 + `x-api-deprecated: true` |

## D. Session Service & Store

| ID | Scenario | Method | Expected |
|---|---|---|---|
| D1 | Session create/get | `SessionService.create/get` | persisted record fetched |
| D2 | Single-flight turn lock | `beginTurn` twice | second call fails with busy error |
| D3 | Cancel active turn | `cancel` after `beginTurn` | returns true |
| D4 | Idle TTL eviction | timer advance beyond TTL | session is removed |
| D5 | Feedback storage | `recordFeedback` | no throw; state updated |
| D6 | Postgres store CRUD | store methods | count/create/get/update/delete/list pass |

## E. Security Controls

| ID | Scenario | Request | Expected |
|---|---|---|---|
| E1 | Missing token | protected endpoint | 401 `UNAUTHORIZED` |
| E2 | Invalid token | protected endpoint | 401 |
| E3 | Valid token | protected endpoint | success status |
| E4 | Oversized payload | body > `MAX_REQUEST_BYTES` | 413 |
| E5 | Rate-limit exceeded | burst > configured max | 429 |
| E6 | CORS allowlist | origin in allowlist | CORS headers present |
| E7 | CORS deny | origin not allowlisted | no allow-origin header |

## F. Reliability Controls

| ID | Scenario | Setup | Expected |
|---|---|---|---|
| F1 | Turn timeout | low `TURN_TIMEOUT_MS` | request fails with timeout |
| F2 | Circuit opens | repeated upstream failures | later requests fail fast (`circuit open`) |
| F3 | Circuit recovers | wait > open interval | requests allowed again |
| F4 | Upstream LLM failure path | mock LLM returns error | stable error envelope, non-crash |

## G. Operational Endpoints

| ID | Scenario | Request | Expected |
|---|---|---|---|
| G1 | Health check | `GET /healthz` | 200 + uptime |
| G2 | Readiness | `GET /readyz` | 200 + store backend + circuit state |
| G3 | Metrics snapshot | `GET /metrics` | 200 + runtime stats payload |

## H. Startup/Config Validation

| ID | Scenario | Setup | Expected |
|---|---|---|---|
| H1 | Missing `LLM_BASE_URL` | unset var | startup fails clearly |
| H2 | Postgres selected without URL | `SESSION_STORE_BACKEND=postgres`, no `POSTGRES_URL` | startup fails clearly |
| H3 | Invalid integer env | malformed limits | fallback defaults are applied |

## I. Runtime/Compiler Integration Confidence

| ID | Scenario | Command | Expected |
|---|---|---|---|
| I1 | Runtime builds | `pnpm --filter @agentscript/runtime build` | success |
| I2 | Runtime-vercel builds | `pnpm --filter @agentscript/runtime-vercel build` | success |
| I3 | Compiler builds | `pnpm --filter @agentscript/compiler build` | success |

## J. Pre-Release Gate

Run the release bundle in order:
1. `pnpm --filter @agentscript/server build`
2. `pnpm --filter @agentscript/server test`
3. `pnpm --filter @agentscript/server smoke`
4. `pnpm --filter @agentscript/runtime build`
5. `pnpm --filter @agentscript/runtime-vercel build`
6. `pnpm --filter @agentscript/compiler build`

All must pass for go/no-go.
