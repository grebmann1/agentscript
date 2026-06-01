# Test Runbook

## Quick Run (local, fast confidence)

From repo root:

1. `pnpm --filter @agentscript/server build`
2. `pnpm --filter @agentscript/server test`
3. `pnpm --filter @agentscript/server smoke`

Use this before every commit.

## Full Run (release candidate)

From repo root:

1. `pnpm --filter @agentscript/server build`
2. `pnpm --filter @agentscript/server test`
3. `pnpm --filter @agentscript/server smoke`
4. `pnpm --filter @agentscript/runtime build`
5. `pnpm --filter @agentscript/runtime-vercel build`
6. `pnpm --filter @agentscript/compiler build`

## CI Profile

Recommended CI stages:

1. **Static**: server build
2. **Unit**: server tests
3. **Smoke**: `packages/server/scripts/smoke-agent-api.mjs`
4. **Integration confidence**: runtime/runtime-vercel/compiler build

Hard fail on any non-zero exit.

## Staging Profile

Run quick run against staging environment variables, then execute manual API probes:

- Start session
- Send sync message
- Send streaming message
- Submit feedback
- End session
- Check `/healthz`, `/readyz`, `/metrics`

## Release Go/No-Go Criteria

Go only if all are true:

- quick run commands all pass
- full run commands all pass
- no P0 open in `test-gaps.md`
- no regression in Agentforce-style lifecycle endpoints
- operational endpoints healthy

No-go if any are true:

- auth bypass or inconsistent 401 behavior
- session lifecycle breakage
- smoke script failure
- timeout/circuit breaker logic regressed
- startup misconfiguration not surfaced clearly
