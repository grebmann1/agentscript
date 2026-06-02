# apps/demo — live Heroku demo backend

This directory is the canonical manifest for the **public demo agent** that
powers the chat on the OSS website.

## Live URLs

- Backend (this app): https://agentscript-runner-demo-43272b107f3c.herokuapp.com
- OSS site (separate app): https://agentscript-runner-b7017f0b6a6b.herokuapp.com
  - The site's chat hits the backend via `window.AGENTSCRIPT_DEMO_API_BASE`
    (set on the site's HTML); see `apps/oss/src/assets/demo-agent-api.js`.

## Two-app split

| App                              | Heroku name                     | Source                       |
| -------------------------------- | ------------------------------- | ---------------------------- |
| Static OSS site (UI)             | `agentscript-runner`            | `apps/oss/`                  |
| Agent backend (this — embedded MCP) | `agentscript-runner-demo`       | `apps/demo/` (this dir)      |

The backend runs `@agentscript/server` against `agents/mcp_demo.agent`, which
declares an embedded MCP server (`deployment.mcp.demo`) that loops back into
the same dyno's `/mcp` endpoint.

## /mcp is bearer-gated

`MCP_AUTH_TOKENS` must be set on the Heroku app (comma-separated list).
- Browsers/clients calling `/mcp` need `Authorization: Bearer <token>`.
- The agent's self-loop reads the same token via `MCP_INTERNAL_TOKEN`, which
  `server/src/node.ts` forwards from `mcpAuthTokens[0]` at boot — operators
  do **not** need to set `MCP_INTERNAL_TOKEN` manually.

Required Heroku config vars:
- `OPENAI_API_KEY` — model access
- `MCP_AUTH_TOKENS` — bearer gate on `/mcp`
- `CORS_ALLOWED_ORIGINS` — must include the OSS site origin
- `DEMO_AGENT_ID=mcp_demo`

## Procfile shadows the bundled agents dir

`Procfile`: `web: AGENTS_DIR=./agents node node_modules/@agentscript/server/dist/index.js`

The `AGENTS_DIR=./agents` env var means **the dyno reads `apps/demo/agents/`,
not the agents bundled inside the `@agentscript/server` tarball**. If you edit
`packages/server/agents/mcp_demo.agent` you must also copy the change into
`apps/demo/agents/mcp_demo.agent` — otherwise the live agent goes stale.
(This trap broke v13; v14 fixed it.)

## Deploy

```
./apps/demo/scripts/deploy.sh
```

The script:
1. `pnpm pack`s `runtime`, `runtime-vercel`, `server` into a temp `.deploy/vendor/`.
2. Copies `Procfile`, `package.json`, `agents/` into `.deploy/`.
3. Validates every `file:vendor/*.tgz` override resolves to an existing tarball.
4. Force-pushes `.deploy/` to `https://git.heroku.com/agentscript-runner-demo.git`.

Before re-deploying after changes to a workspace package: **bump the changed
package's version**. npm caches `file:vendor/<name>-<ver>.tgz` by filename, so
re-pushing the same tarball name is a silent no-op even though the release
"succeeds". After bumping, update the matching `file:` ref in
`apps/demo/package.json` (both `dependencies` and `overrides`).

## Smoke test

`packages/server/scripts/smoke-mcp-remote.mjs` exercises the public `/mcp`
end-to-end: 401 probe, `tools/list`, `search_flights`, `search_hotels`,
`book_trip` (deterministic + error path). Run with `MCP_AUTH_TOKEN` set.
