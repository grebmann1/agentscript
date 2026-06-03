import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CodeBlock from '@/components/CodeBlock';
import DemoChat from '@/components/DemoChat';

const RUNTIME_TS = `import { Runtime, ToolRegistry, FnAdapter } from '@agentscript/runtime';

const fn = new FnAdapter();
fn.register('lookup_order', async ({ id }) => ({ status: 'shipped' }));

const tools = new ToolRegistry();
tools.register('fn', fn);

const runtime = new Runtime({ doc, tools, llm: myDriver });
const result = await runtime.turn('check ORD-42');`;

const RUNTIME_VERCEL_TS = `import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

const { output } = compileSource(source);
const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-haiku-4-5'), generateText },
  tools,
});
const stream = agent.stream('check ORD-42');`;

const CLI_BASH = `npx @agentscript/cli build agents/ \\
  --out dist-agent --name my-agent

# dist-agent/
#   agents/*.agent
#   package.json
#   Procfile
#   .env.example
#   agentscript.json`;

const SERVER_BASH = `# Bundle from \`agentscript build\` already wires this up.
AGENTS_DIR=./agents \\
ANTHROPIC_API_KEY=sk-... \\
node node_modules/@agentscript/server/dist/index.js`;

const SUPPORT_AGENT = `system:
    instructions: "You are a friendly travel-booking assistant. Help the user search for flights, find hotels, and book trips."
    messages:
        welcome: "Hi! I can help you plan a trip — search flights and hotels, then book them."

config:
    agent_name: "TravelBookingAgent"

deployment:
    llm:
        provider: "openai"
        model: "gpt-4o-mini"
        api_key: "env(OPENAI_API_KEY)"
    mcp:
        demo:
            transport: "streamable-http"
            url: "env(MCP_INTERNAL_URL)"
            auth: { strategy: "bearer", key: "env(MCP_INTERNAL_TOKEN)" }

variables:
    last_confirmation: mutable string = ""
        description: "Confirmation number from the most recent booking"
    # ...

start_agent travel_assistant:
    description: "Search and book flights and hotels via the embedded MCP server"

    actions:
        Search_Flights:
            inputs:
                origin: string
                    is_required: True
                destination: string
                    is_required: True
                # ...
            outputs:
                flights: string
                count: number
            target: "mcp://demo/search_flights"

        Book_Trip:
            inputs:
                traveler_name: string
                    is_required: True
                flight_id: string
                # ...
            outputs:
                confirmation_number: string
                booked: boolean
            target: "mcp://demo/book_trip"

        # Search_Hotels: ...

    reasoning:
        instructions: ->
            |   1. Search flights with {!@actions.find_flights} once you have origin, destination, date.
            |   2. Once the user picks a flight_id, book with {!@actions.book}.
        actions:
            find_flights: @actions.Search_Flights
                with origin=...
                with destination=...
                with depart_date=...

            book: @actions.Book_Trip
                with traveler_name=...
                with flight_id=...
                set @variables.last_confirmation = @outputs.confirmation_number`;

const HEROKU_BUILDPACKS = `heroku create my-agent
heroku buildpacks:add https://github.com/salesforce/agentscript-buildpack
heroku buildpacks:add heroku/nodejs`;

const HEROKU_PUSH = `heroku config:set ANTHROPIC_API_KEY=sk-... \\
                  GITHUB_MCP_TOKEN=ghp_...
heroku addons:create heroku-postgresql:essential-0   # optional

git init && git add . && git commit -m "init"
git push heroku main`;

const HEROKU_CURL = `BASE=https://my-agent.herokuapp.com

SID=$(curl -s -X POST $BASE/einstein/ai-agent/v1/agents/support/sessions \\
  -H 'Content-Type: application/json' \\
  -d '{"userId":"u1"}' | jq -r .sessionId)

curl -N -X POST $BASE/einstein/ai-agent/v1/sessions/$SID/messages \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: text/event-stream' \\
  -d '{"message":"check ORD-42"}'`;

const SDK_COMPILE = `import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

const { output } = compileSource(agentScriptSource);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_number }) => ({
  status: order_number === 'ORD-42' ? 'shipped' : 'unknown',
}));

const tools = new ToolRegistry();
tools.register('fn', fn);

export const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-haiku-4-5'), generateText },
  tools,
});`;

const SDK_STREAM = `export async function POST(request: Request) {
  const { message } = await request.json();
  const stream = agent.stream(message);
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream.textStream) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}`;

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">
                <span className="dot"></span> v0.1 · Apache-2.0
              </div>
              <h1 className="hero-title">
                Create an agent. <em>Ship it your way.</em>
              </h1>
              <p className="hero-sub">
                Write the agent in AgentScript, then choose the deployment
                path: self-host a ready server on Heroku, or embed the runtime
                in your own TypeScript app with Vercel AI SDK provider support.
              </p>
              <div className="cta">
                <a className="btn primary" href="#quickstart">
                  Deploy on Heroku <span className="arrow">→</span>
                </a>
                <a className="btn" href="#deploy">
                  Use the SDK
                </a>
              </div>
            </div>
            <div>
              <img
                className="hero-art"
                src="/assets/hero.svg"
                alt="A request entering @agentscript/server, flowing through the runtime-vercel adapter and the runtime tools, then streaming a response — running on a Heroku web dyno."
              />
            </div>
          </div>
        </section>

        <section id="demo">
          <div className="container">
            <p className="section-eyebrow">Live demo</p>
            <h2 className="section-title">
              Try the hosted travel-booking agent.
            </h2>
            <p className="section-lead">
              Start a session and explore an AgentScript agent running through
              the hosted server. The demo uses the <code>mcp_demo</code> agent,
              three MCP tools served by an embedded MCP server, and OpenAI{' '}
              <code>gpt-4o-mini</code>.
            </p>

            <div className="demo-tools">
              <article className="demo-tool-card">
                <p className="demo-tool-eyebrow">MCP tool</p>
                <h3>
                  <code>search_flights(origin, destination, depart_date)</code>
                </h3>
                <ul>
                  <li>
                    <strong>SF → New York:</strong> FL-101, FL-102
                  </li>
                  <li>
                    <strong>NY → London:</strong> FL-201
                  </li>
                  <li>
                    <strong>SF → Tokyo:</strong> FL-301
                  </li>
                </ul>
              </article>
              <article className="demo-tool-card">
                <p className="demo-tool-eyebrow">MCP tool</p>
                <h3>
                  <code>search_hotels(city, check_in, check_out)</code>
                </h3>
                <ul>
                  <li>
                    <strong>New York:</strong> HT-NYC-1, HT-NYC-2
                  </li>
                  <li>
                    <strong>London:</strong> HT-LON-1
                  </li>
                  <li>
                    <strong>Tokyo:</strong> HT-TYO-1
                  </li>
                </ul>
              </article>
              <article className="demo-tool-card">
                <p className="demo-tool-eyebrow">MCP tool</p>
                <h3>
                  <code>book_trip(traveler_name, flight_id?, hotel_id?)</code>
                </h3>
                <ul>
                  <li>Returns confirmation + total USD</li>
                  <li>Validates flight_id / hotel_id</li>
                </ul>
              </article>
            </div>

            <DemoChat />

            <p
              className="section-lead"
              style={{ marginTop: 24, fontSize: 15, maxWidth: 'none' }}
            >
              Like what you see? <a href="#quickstart">Deploy your own on Heroku</a>{' '}
              or <a href="#deploy">embed the runtime via the SDK</a>.
            </p>
          </div>
        </section>

        <section id="paths" className="alt">
          <div className="container">
            <p className="section-eyebrow">Deployment paths</p>
            <h2 className="section-title">
              Two deployment paths. One agent source.
            </h2>
            <p className="section-lead">
              Both paths start from the same <code>.agent</code> file. Pick the
              one that fits your team: a hosted API on Heroku, or the runtime
              embedded in an app you already operate.
            </p>

            <div className="stack-pillars">
              <div className="pillar">
                <div className="num">01</div>
                <h3>Heroku self deploy</h3>
                <p>
                  Declare your model and MCP servers inside the{' '}
                  <code>.agent</code> file. Add the AgentScript buildpack and{' '}
                  <code>git push heroku main</code> — no local build, no glue
                  code. The packaged server provides REST, SSE, WebSocket,
                  sessions, and optional Postgres.
                </p>
              </div>
              <div className="pillar">
                <div className="num">02</div>
                <h3>SDK manual deploy</h3>
                <p>
                  Compile AgentScript in your app, create a runtime agent with{' '}
                  <code>@agentscript/runtime-vercel</code>, connect any AI SDK
                  model, and expose it from Next.js, Hono, Express, workers, or
                  your own job runner.
                </p>
              </div>
            </div>

            <p style={{ marginTop: 32, textAlign: 'center' }}>
              <a className="btn" href="/deploy/">
                Read all deployment guides <span className="arrow">→</span>
              </a>
            </p>
          </div>
        </section>

        <section id="stack">
          <div className="container">
            <p className="section-eyebrow">Architecture</p>
            <h2 className="section-title">What runs when an agent runs.</h2>
            <p className="section-lead">
              At execution time, AgentScript splits into three layers: the
              language you author, the runtime that executes it, and the
              adapters that connect it to a model and to your tools.
            </p>
            <div className="stack-pillars">
              <div className="pillar">
                <div className="num">01</div>
                <h3>Agent language</h3>
                <p>
                  A single <code>.agent</code> file declares behavior, tools,
                  variables, and the <code>deployment:</code> block — model and
                  MCP servers included.
                </p>
              </div>
              <div className="pillar">
                <div className="num">02</div>
                <h3>Runtime</h3>
                <p>
                  Loads the compiled IR, dispatches tool calls through{' '}
                  <code>ToolRegistry</code>, maintains turn state, and emits a
                  typed event stream for text, tool calls, and step boundaries.
                </p>
              </div>
              <div className="pillar">
                <div className="num">03</div>
                <h3>Adapters</h3>
                <p>
                  <code>runtime-vercel</code> drives Anthropic, OpenAI, Google,
                  or any AI-SDK provider. Tool adapters like{' '}
                  <code>FnAdapter</code> and <code>McpAdapter</code> wire local
                  code or remote MCP servers into the same registry.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="packages">
          <div className="container">
            <p className="section-eyebrow">Packages</p>
            <h2 className="section-title">
              Use the whole server, or just the runtime pieces you need.
            </h2>
            <p className="section-lead">
              The packages map to the deployment choice. Heroku self deploy
              uses the server. Manual SDK deployment uses the runtime plus the
              Vercel AI SDK adapter. Advanced integrations can bring their own
              LLM driver directly to the runtime.
            </p>

            <div className="packages">
              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">@agentscript/runtime</span>
                  <span className="pkg-version">v0.1</span>
                </div>
                <p className="pkg-tagline">Agent execution core.</p>
                <p className="pkg-desc">
                  TypeScript runtime — no extra processes, no host-specific
                  glue. Executes compiled AgentScript IR with{' '}
                  <code>ToolRegistry</code>, turn state, guardrails, tracing,
                  and checkpoints. You bring the host.
                </p>
                <CodeBlock lang="ts">{RUNTIME_TS}</CodeBlock>
              </article>

              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">@agentscript/runtime-vercel</span>
                  <span className="pkg-version">v0.1</span>
                </div>
                <p className="pkg-tagline">Manual SDK deployment path.</p>
                <p className="pkg-desc">
                  Vercel AI SDK adapter for Anthropic, OpenAI, Google, or any
                  AI-SDK-compatible provider. Use it when your app owns
                  routing, auth, persistence, and deployment.
                </p>
                <CodeBlock lang="ts">{RUNTIME_VERCEL_TS}</CodeBlock>
              </article>

              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">@agentscript/cli</span>
                  <span className="pkg-version">v0.1</span>
                </div>
                <p className="pkg-tagline">
                  Bundle builder for non-Heroku targets.
                </p>
                <p className="pkg-desc">
                  Compile your <code>.agent</code> file(s) into the same bundle
                  the Heroku buildpack produces, but locally — for Docker,
                  Kubernetes, or any host that runs Node. Walks{' '}
                  <code>deployment:</code> for env-var refs and emits a
                  complete project layout.
                </p>
                <CodeBlock lang="bash">{CLI_BASH}</CodeBlock>
              </article>

              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">@agentscript/server</span>
                  <span className="pkg-version">v0.1</span>
                </div>
                <p className="pkg-tagline">Heroku-ready agent API server.</p>
                <p className="pkg-desc">
                  Hono-based server with REST, Server-Sent Events, and
                  WebSocket sessions. Loads the LLM provider and MCP servers
                  directly from the agent's <code>deployment:</code> block.
                  In-memory or Postgres storage.
                </p>
                <CodeBlock lang="bash">{SERVER_BASH}</CodeBlock>
              </article>
            </div>
          </div>
        </section>

        <section id="quickstart" className="alt">
          <div className="container">
            <p className="section-eyebrow">Heroku self deploy</p>
            <h2 className="section-title">
              One <code>.agent</code> file. One <code>git push</code>. Live
              agent.
            </h2>
            <p className="section-lead">
              The AgentScript Heroku buildpack turns a directory of{' '}
              <code>.agent</code> files into a running service. No{' '}
              <code>package.json</code>, no <code>Procfile</code>, no local
              build step. The buildpack runs the compiler on the dyno,
              scaffolds the server, and hands off to <code>heroku/nodejs</code>.
            </p>

            <div className="steps">
              <div className="step">
                <div>
                  <h3>
                    Write <code>travel.agent</code>
                  </h3>
                  <p>
                    The <code>deployment:</code> block declares the LLM and any
                    MCP servers the agent needs. Use <code>env(NAME)</code> for
                    secrets — they are resolved on the dyno at boot, never at
                    compile time. <code>actions</code> in{' '}
                    <code>start_agent</code> are typed and target tool URIs
                    like <code>mcp://demo/search_flights</code>.
                  </p>
                  <CodeBlock lang="agent">{SUPPORT_AGENT}</CodeBlock>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>Add the buildpacks</h3>
                  <p>
                    Order matters: the AgentScript buildpack runs first to
                    scaffold <code>package.json</code> and{' '}
                    <code>Procfile</code>, then <code>heroku/nodejs</code>{' '}
                    installs <code>@agentscript/server</code> and boots the
                    dyno.
                  </p>
                  <CodeBlock lang="bash">{HEROKU_BUILDPACKS}</CodeBlock>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>Set secrets and push</h3>
                  <p>
                    The buildpack lists every <code>env(NAME)</code> reference
                    it found in <code>.env.example</code>. Set them with{' '}
                    <code>heroku config:set</code> and deploy.
                  </p>
                  <CodeBlock lang="bash">{HEROKU_PUSH}</CodeBlock>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>Open a hosted session</h3>
                  <p>
                    Clients talk to the hosted agent over REST, SSE, or
                    WebSocket.
                  </p>
                  <CodeBlock lang="bash">{HEROKU_CURL}</CodeBlock>
                </div>
              </div>
            </div>

            <p
              className="section-lead"
              style={{ marginTop: 32, fontSize: 15, maxWidth: 'none' }}
            >
              Targeting Docker, Kubernetes, or another platform? Use{' '}
              <code>npx @agentscript/cli build agents/ --out dist-agent</code>{' '}
              locally to produce the same bundle the buildpack would generate
              on Heroku, then ship it however you like.
            </p>
          </div>
        </section>

        <section id="deploy">
          <div className="container">
            <p className="section-eyebrow">SDK manual deploy</p>
            <h2 className="section-title">
              Embed AgentScript support in your own TypeScript app.
            </h2>
            <p className="section-lead">
              Use this path when you already have an API surface, auth model,
              or deployment target. The runtime executes the agent. The Vercel
              AI SDK provides the model. Your app decides how requests,
              sessions, and persistence work.
            </p>

            <div className="deploy-stack">
              <h3 className="deploy-step-title">
                1. Compile the agent and wire its tools
              </h3>
              <CodeBlock lang="ts">{SDK_COMPILE}</CodeBlock>

              <h3 className="deploy-step-title">
                2. Stream it from your own HTTP route
              </h3>
              <CodeBlock lang="ts">{SDK_STREAM}</CodeBlock>

              <p
                className="section-lead"
                style={{ marginTop: 8, fontSize: 15, maxWidth: 'none' }}
              >
                The SDK path is intentionally small: compile the agent,
                register tools, connect an AI SDK model, then stream from your
                own route. It works anywhere TypeScript and the Vercel AI SDK
                work.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
