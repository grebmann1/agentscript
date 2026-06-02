# apps/oss — public OSS site

Static landing site + interactive demo chat. Deployed to Heroku app
`agentscript-runner` (https://agentscript-runner-b7017f0b6a6b.herokuapp.com).

## Live demo chat is wired to a separate backend

The chat widget on this site does **not** run the agent in-process. It calls
into a second Heroku app, `agentscript-runner-demo`
(https://agentscript-runner-demo-43272b107f3c.herokuapp.com), which hosts the
actual `@agentscript/server` + embedded MCP. See `apps/demo/CLAUDE.md` for
the backend's manifest, deploy script, and config-var requirements.

Wiring:
- `src/assets/demo-agent-api.js` reads `window.AGENTSCRIPT_DEMO_API_BASE` to
  resolve the backend origin (with a same-origin fallback for local dev).
- The site's HTML sets that global to the demo backend's URL.
- `/mcp` on the backend is bearer-gated (`MCP_AUTH_TOKENS`). The site itself
  hits `/api/sessions` etc., which are not bearer-gated; only the MCP
  endpoint requires the token.
