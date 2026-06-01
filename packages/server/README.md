# @agentscript/server

Node server that hosts AgentScript agents with in-memory sessions over REST, SSE, and WebSocket.
The primary API surface follows Agentforce Agent API lifecycle naming.

## Session management architecture

- Session orchestration is handled by `SessionService` (`packages/server/src/sessions.ts`).
- Persistence is delegated to a pluggable `SessionStore` interface.
- Default implementation is `InMemorySessionStore`.
- This keeps today’s behavior while making storage backend swaps straightforward.

Extension docs:
- [`docs/session-store.md`](docs/session-store.md)
- [`docs/session-store-decision-record.md`](docs/session-store-decision-record.md)
- [`docs/go-live-checklist.md`](docs/go-live-checklist.md)
- [`docs/operational-runbook.md`](docs/operational-runbook.md)
- [`docs/api-compatibility-matrix.md`](docs/api-compatibility-matrix.md)
- [`docs/launch-policy.md`](docs/launch-policy.md)
- [`docs/api-quickstart.md`](docs/api-quickstart.md)
- [`docs/versioning-policy.md`](docs/versioning-policy.md)
- [`docs/postman-collection.json`](docs/postman-collection.json)
- [`docs/release-governance.md`](docs/release-governance.md)
- [`docs/full-test-matrix.md`](docs/full-test-matrix.md)
- [`docs/test-runbook.md`](docs/test-runbook.md)
- [`docs/test-gaps.md`](docs/test-gaps.md)
- [`docs/local-example.md`](docs/local-example.md)

## Primary endpoints (Agentforce-style)

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `POST /einstein/ai-agent/v1/agents/:agentId/sessions` (start session)
- `GET /einstein/ai-agent/v1/sessions/:sessionId` (session state)
- `POST /einstein/ai-agent/v1/sessions/:sessionId/messages` (sync send)
- `POST /einstein/ai-agent/v1/sessions/:sessionId/messages/stream` (SSE send)
- `DELETE /einstein/ai-agent/v1/sessions/:sessionId` (end session)
- `POST /einstein/ai-agent/v1/sessions/:sessionId/messages/:messageId/feedback`
- `GET /einstein/ai-agent/v1/sessions/:sessionId/messages/ws` (WebSocket companion transport)

## Landing page demo endpoints

The site landing page includes a lightweight chat demo that calls same-origin routes:

- `POST /demo/agent/session` (starts a session for fixed `multi_step_support`)
- `POST /demo/agent/session/:sessionId/message` (synchronous message send)
- `DELETE /demo/agent/session/:sessionId` (ends the demo session)

These routes are intentionally constrained:
- no arbitrary `agentId` selection from the browser
- public auth bypass applies only to `/demo/agent/*`
- existing payload-size and rate-limit controls still apply

## Backward compatibility aliases

`/v1/*` endpoints are still available temporarily and return `x-api-deprecated: true`.
Plan migration to the `/einstein/ai-agent/v1/*` surface.

Sunset policy:
- `/v1/*` aliases are compatibility-only and should be removed after client migration.
- Target policy: 2 release cycles minimum notice before removal.

## Local run

1. Copy `.env.example` values into your environment.
2. From repo root:
   - `pnpm --filter @agentscript/server build`
   - `node packages/server/dist/index.js`

## Full local example

From repo root:

```bash
pnpm --filter @agentscript/server example:local
```

This starts the server locally and exercises health, readiness, sync messaging,
SSE streaming, WebSocket streaming, feedback, and session cleanup.

## WebSocket protocol

Send:

```json
{
  "message": {
    "sequenceId": 1,
    "type": "Text",
    "text": "hello"
  }
}
```

Receive:
- canonical stream chunks (shared with SSE payloads), for example:
  - `{ "chunkType": "Text", "sessionId": "...", "sequenceId": 1, "messageId": "...", "text": "..." }`
  - `{ "chunkType": "Done", "sessionId": "...", "sequenceId": 1, "messageId": "...", "text": "..." }`
  - `{ "chunkType": "Error", "error": "..." }`

## Security defaults

- All non-health endpoints require bearer auth when `API_AUTH_TOKENS` is set.
- CORS allowlist is controlled by `CORS_ALLOWED_ORIGINS`.
- Request size and rate limiting controls are available through:
  - `MAX_REQUEST_BYTES`
  - `RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX`

## Runtime safety controls

- Turn timeout: `TURN_TIMEOUT_MS`
- LLM circuit breaker:
  - `LLM_CIRCUIT_FAILURES`
  - `LLM_CIRCUIT_OPEN_MS`

## Session backend selection

- `SESSION_STORE_BACKEND=memory` (default)
- `SESSION_STORE_BACKEND=postgres` with `POSTGRES_URL`
