# Local Full Example

Run the complete Agentforce-style server API flow locally against a real LLM provider configured in the repo root `.env`.

## What it verifies

- Starts `@agentscript/server` locally through `@agentscript/server/node`.
- Checks `/healthz`, `/readyz`, and `/metrics`.
- Creates an Agentforce-style session.
- Sends a synchronous message.
- Sends a streaming SSE message.
- Sends a WebSocket message.
- Submits feedback for the sync message.
- Deletes the session.

## Prerequisites

The repo root `.env` must contain either:

```bash
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
```

or:

```bash
LLM_GATEWAY_URL=...
LLM_GATEWAY_API_KEY=...
LLM_GATEWAY_MODEL=...
```

`API_AUTH_TOKENS` is optional for the example. If omitted, the script uses a local temporary token.

## Run

From repo root:

```bash
pnpm --filter @agentscript/server example:local
```

The example has its own `packages/server/examples/package.json` and imports
`startServer()` from `@agentscript/server/node`, mirroring how an external app
would consume the package.

Expected final line:

```text
LOCAL_AGENT_API_EXAMPLE_OK
```

## Files

- Example client: `packages/server/examples/local-agent-api-client.mjs`
- Example package manifest: `packages/server/examples/package.json`
- Server entrypoint: `packages/server/src/index.ts`
- Default agent: `packages/server/agents/support.agent`
