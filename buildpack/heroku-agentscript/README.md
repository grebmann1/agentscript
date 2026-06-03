# heroku-agentscript

Classic Heroku buildpack that turns a directory of `.agent` files into a live
AgentScript service. No `package.json`, no `Procfile`, no local build step
required — `git push heroku main` is the deployment.

## Usage

```sh
heroku create my-agent
heroku buildpacks:add https://github.com/salesforce/agentscript-buildpack
heroku buildpacks:add heroku/nodejs

heroku config:set ANTHROPIC_API_KEY=sk-...
git push heroku main
```

Buildpack order matters: this buildpack runs first to scaffold
`package.json` and `Procfile`, then `heroku/nodejs` installs dependencies and
boots the dyno.

## What it does

1. Detects any `*.agent` file at the repo root or under `agents/`.
2. Installs `@agentscript/cli` from npm (version pinned by
   `.agentscript-version`, default `latest`).
3. Runs `agentscript build` to produce `package.json`, `Procfile`,
   `agents/*.agent`, `.env.example`, and `agentscript.json`.
4. Hands off to `heroku/nodejs` for `npm install` and dyno boot.

If you commit your own `package.json` or `Procfile` they are preserved.

## Files honored in the user repo

| Path                      | Purpose                                                 |
|---------------------------|---------------------------------------------------------|
| `*.agent` or `agents/*`   | Source agents (required, at least one)                  |
| `.agentscript-version`    | Pin a specific `@agentscript/cli` version (optional)    |
| `package.json`            | If present, the buildpack does not overwrite it         |
| `Procfile`                | If present, the buildpack does not overwrite it         |

## Local testing

```sh
buildpack/heroku-agentscript/bin/test
```

## Pre-publish workflow (vendored tarballs)

Until `@agentscript/cli` and `@agentscript/server` are published to npm and
this buildpack repo is public, you can deploy via the public
[`heroku-buildpack-inline`](https://github.com/kr/heroku-buildpack-inline)
buildpack with `pnpm pack`'d tarballs vendored into your app.

### One-time: pack the workspace

From the `agentscript` repo root:

```sh
mkdir -p /path/to/my-agent/vendor
pnpm -r pack --pack-destination /path/to/my-agent/vendor
```

`pnpm pack` rewrites `workspace:*` deps to concrete versions in each tarball,
producing a self-contained closure: `agentscript-cli`, `agentscript-server`,
`agentscript-compiler`, `agentscript-runtime`, `agentscript-runtime-vercel`,
`agentscript-types`, `agentscript-parser`, `agentscript-language`,
`agentscript-lsp`, `agentscript-parser-tree-sitter`,
`agentscript-parser-javascript`.

### App layout

```
my-agent/
├── support.agent              # one or more .agent files
├── bin/
│   ├── detect                 # copy of buildpack/heroku-agentscript/bin/detect
│   └── compile                # copy of bin/compile, adapted for vendored install
├── vendor/
│   └── *.tgz                  # pnpm-pack output from the step above
└── package.json               # file: deps pointing at vendor/*.tgz
```

The adapted `bin/compile` swaps `npm install -g @agentscript/cli@$VERSION` for
`npm install -g vendor/agentscript-cli-*.tgz` and writes an `overrides:` map
keyed on `file:` URLs so transitive workspace deps resolve from the same
`vendor/` directory.

### Deploy

```sh
cd /path/to/my-agent
heroku create my-agent
heroku buildpacks:add https://github.com/kr/heroku-buildpack-inline
heroku buildpacks:add heroku/nodejs
heroku config:set OPENAI_API_KEY=sk-...
git init && git add . && git commit -m init
git push heroku main
```

### Critical caveat: bump tarball versions when re-packing

npm caches `file:` deps by package **name + version**. If you re-pack
`@agentscript/server` at the same `0.1.0` and redeploy, Heroku silently
reuses the cached install from the previous build — your changes will not
ship. Bump the package's `version` in `packages/<pkg>/package.json` before
`pnpm pack`, otherwise the deploy will look successful but run stale code.

Symptom: build logs report success, but server behavior reflects the
**previous** tarball. Diagnose by running:

```sh
heroku run "grep -c '<your-new-symbol>' node_modules/@agentscript/<pkg>/dist/<file>.js"
```

If the count is `0`, the cache served old code.
