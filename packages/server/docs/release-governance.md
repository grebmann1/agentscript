# Release Governance

## Required CI gates

- `pnpm --filter @agentscript/server build`
- `pnpm --filter @agentscript/server test`
- `pnpm --filter @agentscript/server smoke`

## Deploy workflow

1. Deploy to staging.
2. Run smoke checks (session lifecycle, SSE, WebSocket).
3. Verify `/readyz` and `/metrics`.
4. Deploy to production.
5. Run post-deploy smoke checks.

## Rollback policy

- Roll back if:
  - auth checks fail unexpectedly
  - 5xx rate exceeds error budget threshold
  - readiness check fails for >5 minutes
- Rollback target: last known-good release tag.
