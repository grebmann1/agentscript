# Launch Policy (v1)

## SLO targets

- Availability: 99.9% monthly for API endpoints (excluding scheduled maintenance).
- Latency:
  - p95 sync message round-trip <= 3s (excluding upstream LLM tail latency incidents).
  - p95 stream first chunk <= 1.5s.
- Error budget: 0.1% monthly failed requests (5xx + unhandled timeouts).

## Tenancy model

- v1: token-scoped multi-tenant model.
- A bearer token identifies a caller domain/tenant boundary.
- All rate limits and audit logs are keyed by token subject.

## Traffic assumptions

- Baseline: <= 20 RPS sustained.
- Burst: up to 100 RPS for <= 60 seconds.
- Concurrent active sessions per deployment: <= 5,000.

## v1 support boundary

In scope:
- Agentforce-style session lifecycle API.
- In-memory or Postgres-backed session records.
- SSE and WebSocket streaming.
- Token auth, CORS allowlist, request-size and rate limits.

Out of scope:
- Multi-region failover.
- Cross-process runtime rehydration from checkpoints.
- Tenant-specific custom model routing.

## Escalation

- Severity 1: auth bypass, data exposure, total outage.
- Severity 2: elevated 5xx rate or severe latency degradation.
- Severity 3: single-tenant incidents and degraded non-critical functionality.
