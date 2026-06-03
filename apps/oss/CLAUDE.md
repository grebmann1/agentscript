# apps/oss — public OSS site

Next.js 15 (App Router) landing site + interactive demo chat. The web dyno
on Heroku app `agentscript-runner`
(https://agentscript-runner-b7017f0b6a6b.herokuapp.com) — root `Procfile`
boots `apps/oss/.next/standalone/apps/oss/server.js`.

## Live demo chat is wired to a separate backend

The chat widget on this site does **not** run the agent in-process. It calls
into a second Heroku app, `agentscript-runner-demo`
(https://agentscript-runner-demo-43272b107f3c.herokuapp.com), which hosts the
actual `@agentscript/server` + embedded MCP. See `apps/demo/CLAUDE.md` for
the backend's manifest, deploy script, and config-var requirements.

Wiring:
- `lib/demoApi.ts` reads `window.AGENTSCRIPT_DEMO_API_BASE` to resolve the
  backend origin (with a same-origin fallback for local dev).
- `app/layout.tsx` injects that global via an inline
  `<Script strategy="beforeInteractive">`.
- `/mcp` on the backend is bearer-gated (`MCP_AUTH_TOKENS`). The site itself
  hits `/api/sessions` etc., which are not bearer-gated; only the MCP
  endpoint requires the token.

## Bundling apps/ui

The web dyno serves `/app/` (UI SPA) from this Next.js app. Root
`heroku-postbuild` copies `apps/ui/dist/` → `apps/oss/public/app/` before
`next build`, so the static tree ends up inside
`.next/standalone/apps/oss/public/`. `next.config.mjs` rewrites `/app` and
`/app/` to `/app/index.html`.

## /docs is a Next.js App Router route, not a static drop

`apps/docs/` (Docusaurus) is a separate project and is **not** bundled under
`/docs` on this app. The `/docs` route is owned by App Router MDX pages
under `app/docs/**/page.mdx`. MDX is wired through `@next/mdx` in
`next.config.mjs`; `mdx-components.tsx` maps fenced code blocks
(`pre > code`) to the existing `components/CodeBlock.tsx` so MDX-authored
code keeps the same token-highlighter rendering as the JSX deploy pages.

## POC banner

`components/PocBanner.tsx` is rendered at the top of `<body>` (before
`<StickyHeader />`) so it sits above the sticky header. It is dismissable
and persists the choice in `localStorage` under the key
`agentscript-poc-banner-dismissed`.

## Highlighter is server-rendered

`components/CodeBlock.tsx` calls `tokenize()` from `lib/highlight.ts` at
render time and emits `<span class="tok-*">` elements directly. Do not
introduce `innerHTML` or `dangerouslySetInnerHTML` — both are blocked by
the security hook and the site is built around React-tree DOM construction.
