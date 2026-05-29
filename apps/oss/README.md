# @agentscript/oss-site

The AgentScript OSS landing page. A small, hand-authored static site that
introduces the AgentScript OSS stack — the runtime, the Vercel adapter, and
the server — and shows how to deploy a working agent on Heroku.

## Develop

```bash
pnpm --filter @agentscript/oss-site dev
# → http://localhost:4321
```

The dev server rebuilds on changes under `src/`.

## Build

```bash
pnpm --filter @agentscript/oss-site build
# → dist/
```

## Deployment

The site is built into `apps/oss/dist/` and folded into `dist-static/` by the
root `heroku-postbuild` script. The Heroku web dyno (`@agentscript/server`)
serves the merged tree at `/` (OSS landing), `/app/` (UI SPA), and `/docs/`
(Docusaurus) alongside the live agent API.

No framework. No bundler. Vanilla HTML, CSS, and JS.
