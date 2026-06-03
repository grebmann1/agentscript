---
sidebar_position: 1
---

# Deploy to Heroku

The AgentScript Heroku buildpack turns a directory of `.agent` files into a
live agent service. There is no local build step — `git push heroku main` is
the deployment.

## What the buildpack does

1. Detects any `*.agent` file at the repo root or under `agents/`.
2. Installs `@agentscript/cli` from npm (version pinned by an optional
   `.agentscript-version` file, default `latest`).
3. Runs `agentscript build` to produce `package.json`, `Procfile`,
   `agents/*.agent`, `.env.example`, and `agentscript.json`.
4. Hands off to `heroku/nodejs`, which installs dependencies and boots the
   dyno.

User-committed `package.json` and `Procfile` files are preserved.

## Prerequisites

- A Heroku account and the `heroku` CLI (`heroku login`).
- An LLM API key for whichever provider your agent's `deployment:` block
  references (OpenAI, Anthropic, Google, or an OpenAI-compatible gateway).

## Minimum repo layout

A deployable repo needs **one** thing: a `.agent` file with a `deployment:`
block.

```
my-agent/
└── support.agent
```

A minimal `support.agent`:

```yaml
config:
    agent_name: "support"

deployment:
    llm:
        provider: "openai"
        model: "gpt-4o-mini"
        api_key: "env(OPENAI_API_KEY)"

start_agent main:
    description: "Replies to greetings."
    reasoning:
        instructions: ->
            | You are a friendly support agent. Greet the user warmly.
```

Multi-agent repos are supported too — drop several files under `agents/`:

```
my-agent/
└── agents/
    ├── support.agent
    └── billing.agent
```

## A richer example: order tracking

The server ships with a set of demo `fn://` handlers (`GetCustomerInfo`,
`FindOrderByNumber`, `GetOrderDetails`, `GetTrackingUpdates`,
`ProcessReturnRequest`, `ReportShippingIssue`) that simulate an order-tracking
backend. Any agent whose actions target those names will get realistic mock
responses without you wiring up a real backend.

The minimal multi-topic agent that exercises them:

```yaml
config:
    agent_name: "support"

deployment:
    llm:
        provider: "openai"
        model: "gpt-4o-mini"
        api_key: "env(OPENAI_API_KEY)"

variables:
    customer_email: mutable string = ""
    customer_id:    mutable string = ""
    order_number:   mutable string = ""
    order_found:    mutable boolean = False
    order_status:   mutable string = ""
    tracking_number: mutable string = ""
    delivery_date:  mutable string = ""

start_agent order_locator:
    description: "Locate a customer's order."

    actions:
        Get_Customer_Info:
            description: "Look up a customer by email."
            inputs:
                email: string
                    is_required: True
            outputs:
                customer_found: boolean
                customer_id:    string
            target: "fn://GetCustomerInfo"

        Find_Order_By_Number:
            description: "Find an order by its number."
            inputs:
                order_number: string
                    is_required: True
                customer_id: string
            outputs:
                order_found: boolean
            target: "fn://FindOrderByNumber"

    reasoning:
        instructions: ->
            | Help the customer locate their order. Ask for an order number
              or email if you don't have one yet.

    after_reasoning:
        if @variables.customer_email != "":
            run @actions.Get_Customer_Info
                with email=@variables.customer_email
                set @variables.customer_id = @outputs.customer_id

        if @variables.order_number != "":
            run @actions.Find_Order_By_Number
                with order_number=@variables.order_number
                with customer_id=@variables.customer_id
                set @variables.order_found = @outputs.order_found
```

`after_reasoning run @actions.X` blocks run **deterministically on the server
after each turn**, independent of whether the LLM chose to call any tool.
That makes them ideal for normalization, side effects, and cross-topic state
plumbing.

## Deploy in five commands

```sh
heroku create my-agent
heroku buildpacks:add https://github.com/salesforce/agentscript-buildpack
heroku buildpacks:add heroku/nodejs
heroku config:set OPENAI_API_KEY=sk-...
git push heroku main
```

Buildpack order matters. The AgentScript buildpack must run **before**
`heroku/nodejs` — it scaffolds `package.json` and `Procfile`, which
`heroku/nodejs` then consumes.

### Pre-publish workflow (vendored tarballs)

Until `@agentscript/*` is published to npm and the buildpack repo is public,
you can deploy via the [`heroku-buildpack-inline`](https://github.com/kr/heroku-buildpack-inline)
buildpack with `pnpm pack`'d tarballs vendored into your app.

```sh
# From the agentscript repo root
pnpm -r pack --pack-destination /path/to/my-agent/vendor
# Copy buildpack/heroku-agentscript/bin/{detect,compile} into my-agent/bin/

cd /path/to/my-agent
heroku create my-agent
heroku buildpacks:add https://github.com/kr/heroku-buildpack-inline
heroku buildpacks:add heroku/nodejs
heroku config:set OPENAI_API_KEY=sk-...
git init && git add . && git commit -m init
git push heroku main
```

The `bin/compile` script reads `vendor/*.tgz`, builds an npm `overrides:`
map keyed on `file:` URLs, and installs the closure offline. See
[`buildpack/heroku-agentscript/README.md`](https://github.com/salesforce/agentscript/tree/main/buildpack/heroku-agentscript)
for the full recipe. **Bump the tarball version when you re-pack** — npm caches
by version, and a same-version `.tgz` will silently reuse the cached build.

## Configuration

### Pinning a CLI version

Create `.agentscript-version` at the repo root to pin a specific CLI
version (the buildpack defaults to `latest`):

```
0.1.0
```

### Environment variables

The agent's `deployment:` block declares which env vars it needs via
`env(NAME)` references. After the first build, the buildpack writes a
`.env.example` listing them. Set each one with `heroku config:set`.

Example `.env.example` produced from the `support.agent` above:

```
OPENAI_API_KEY=
```

### Custom `package.json` or `Procfile`

If you commit either file, the buildpack will not overwrite it. Useful when
you need extra runtime dependencies, a custom dyno command, or a non-default
port. The default `Procfile` is:

```
web: AGENTS_DIR=./agents node node_modules/@agentscript/server/dist/index.js
```

## Verifying the deploy

After `git push heroku main` completes, the build log should show:

```
-----> AgentScript app detected
-----> Pinning @agentscript/cli@latest
-----> Installing @agentscript/cli@latest
-----> Building bundle from /tmp/build_.../agents
-----> Bundle ready
       agents:   support
       env vars: OPENAI_API_KEY
       Set them with: heroku config:set NAME=value
```

Confirm the dyno started:

```sh
heroku ps -a my-agent
# === web (Basic): AGENTS_DIR=./agents node ... (1)
# web.1: up
```

## Smoke-testing the live agent

The deployed server exposes a REST API rooted at `/einstein/ai-agent/v1`.

### Open a session, optionally seeding state

`POST /agents/:id/sessions` accepts a `context` object that pre-populates
mutable variables. This is what makes deterministic `before_reasoning` /
`after_reasoning` `run @actions.X` blocks fire on the very first turn.

```sh
BASE=$(heroku info -s -a my-agent | grep ^web_url | cut -d= -f2)

SID=$(curl -s -X POST "${BASE}einstein/ai-agent/v1/agents/support/sessions" \
  -H 'Content-Type: application/json' \
  -d '{
        "context": {
          "customer_email": "alice@example.com",
          "order_number":   "ORD-12345"
        }
      }' | jq -r .sessionId)
```

Any name in `context` that matches a `mutable` variable in your agent will
be seeded into runtime state. Internal-visibility (`mutable`) vars are
writable; linked (`Context`) vars are read-only.

### Send a message

```sh
curl -s -X POST "${BASE}einstein/ai-agent/v1/sessions/${SID}/messages" \
  -H 'Content-Type: application/json' \
  -d '{"message":{"sequenceId":1,"text":"hello"}}'
```

A successful response is HTTP 200 with `messages[].message`. If you seeded
`customer_email` and `order_number` above, the server logs will show the
deterministic action chain firing:

```json
{"event":"flow_call","name":"GetCustomerInfo","args":{"email":"alice@example.com"},"result":{"customer_found":true,...}}
{"event":"flow_call","name":"FindOrderByNumber","args":{"order_number":"ORD-12345",...},...}
{"event":"flow_call","name":"GetOrderDetails",...}
{"event":"flow_call","name":"GetTrackingUpdates",...}
```

Streaming over SSE is also available at
`POST /einstein/ai-agent/v1/sessions/<id>/messages/stream`.

## Updating the agent

Edit your `.agent` file and push again — the buildpack rebuilds the bundle
and `heroku/nodejs` restarts the dyno:

```sh
git add support.agent
git commit -m "tweak prompt"
git push heroku main
```

## Troubleshooting

**`Environment variable "OPENAI_API_KEY" required by deployment.llm.api_key is not set.`**
The agent declared an env var via `env(...)` but you haven't run
`heroku config:set` for it. Set the var, then `heroku ps:restart`.

**Build fails with `node: command not found`.**
The `heroku/nodejs` buildpack must come **after** the AgentScript buildpack
in `heroku buildpacks`. Run `heroku buildpacks` to verify the order. If wrong,
clear with `heroku buildpacks:clear` and re-add in the correct order.

**Build fails with `no .agent file found`.**
The buildpack only detects `*.agent` at the repo root or under `agents/`.
Move your file to one of those locations.

**Dyno boots but every request returns 404.**
The agent's `config.agent_name` (or `developer_name`) is the path segment
used by the REST API. If you set `agent_name: "support"`, hit
`/einstein/ai-agent/v1/agents/support/sessions`.

**`No fn handler registered for "fn://X"`.**
The agent script targets `fn://X` but the server has no handler under that
name. Either rename the target to one of the bundled mocks
(`GetCustomerInfo`, `FindOrderByNumber`, …) or build a custom server image
that registers your own `FnAdapter` handlers.

**Re-pack of vendored tarballs deployed but old code still runs.**
npm caches `file:` deps by name+version. Bump the package's `version` in
`packages/<pkg>/package.json` before re-packing, otherwise Heroku reuses
the cached install.

## What lives where

| Path                    | Purpose                                         |
|-------------------------|-------------------------------------------------|
| `*.agent` or `agents/*` | Source agents (required, at least one)          |
| `.agentscript-version`  | Optional CLI version pin                        |
| `vendor/*.tgz`          | Optional pre-publish: vendored workspace deps   |
| `package.json`          | If present, preserved verbatim                  |
| `Procfile`              | If present, preserved verbatim                  |
