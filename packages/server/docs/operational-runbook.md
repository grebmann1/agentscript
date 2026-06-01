# Operational Runbook

## Core endpoints

- Liveness: `GET /healthz`
- Readiness: `GET /readyz`
- Metrics snapshot: `GET /metrics`

## Typical incidents

### 401 spikes

1. Verify `API_AUTH_TOKENS` is populated and expected token is current.
2. Check if callers send `Authorization: Bearer <token>`.
3. If emergency mitigation needed, rotate/add temporary token and communicate.

### 429 spikes

1. Validate `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` are appropriate.
2. Identify top offending token/IP.
3. Increase limits only with explicit approval and monitoring.

### Timeout/circuit-open errors

1. Check upstream model health.
2. Inspect `TURN_TIMEOUT_MS`, `LLM_CIRCUIT_FAILURES`, `LLM_CIRCUIT_OPEN_MS`.
3. If persistent, lower traffic and fail over to safer model endpoint.

### Session backend degradation

1. If using Postgres, validate database connectivity and latency.
2. Check `SESSION_STORE_BACKEND` and `POSTGRES_URL`.
3. Execute rollback to memory store for emergency containment if needed.

## Rollback

1. Deploy last known-good release.
2. Confirm `/healthz` and `/readyz` are green.
3. Run smoke tests for session create/send/stream/end.
4. Broadcast incident update and follow-up RCA timeline.
