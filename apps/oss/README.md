# @agentscript/oss-site

The AgentScript OSS landing page. A Next.js 15 (App Router) project that
introduces the AgentScript OSS stack — the runtime, the Vercel adapter, and
the server — and ships the live demo chat widget.

## Develop

```bash
pnpm --filter @agentscript/oss-site dev
# → http://localhost:4321
```

## Build

```bash
pnpm --filter @agentscript/oss-site build
# → .next/standalone/apps/oss/server.js
```

The build emits a self-contained Node server under
`.next/standalone/apps/oss/`. `next build` writes the standalone tree;
`scripts/prepare-standalone.mjs` then folds `.next/static/` and `public/`
into it.

## Deployment

The site is the Heroku web dyno. The root `Procfile` boots
`apps/oss/.next/standalone/apps/oss/server.js`. Root `heroku-postbuild`
builds every other workspace package, copies `apps/ui/dist/` →
`apps/oss/public/app/` and `apps/docs/build/` → `apps/oss/public/docs/`,
then runs `next build` so those static trees end up bundled inside the
standalone output.

`next.config.mjs` rewrites `/app` and `/docs` to the corresponding
`index.html` entries so the existing URLs keep working without any
server-side mounting logic.

## Layout

- `app/` — App Router pages (`/`, `/deploy`, `/deploy/heroku-buildpack`,
  `/deploy/heroku-script`, `/deploy/vercel`).
- `components/` — `DemoChat` (live chat widget), `CodeBlock` (token-based
  highlighter + copy button), `SiteHeader`/`SiteFooter`/`StickyHeader`.
- `lib/` — `demoApi.ts` (SSE client for the demo backend), `highlight.ts`
  (token-array highlighter for `bash`, `ts`, `agent`, `yaml`, `json`).
- `app/globals.css` — site styles, byte-identical to the previous
  hand-authored stylesheet.
- `public/assets/` — SVG assets and `mcp_demo.agent` (copied from
  `packages/server/agents/` by `scripts/copy-static-assets.mjs`).
