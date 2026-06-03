import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CodeBlock from '@/components/CodeBlock';

export const metadata: Metadata = {
  title: 'Deploy via script — AgentScript OSS',
  description:
    'The script-based Heroku deploy flow that powers the live AgentScript demo: pnpm pack workspace packages, vendor them as file:*.tgz, and force-push to Heroku.',
  openGraph: {
    title: 'Deploy via script — AgentScript OSS',
    description:
      'The script-based Heroku deploy flow that powers the live AgentScript demo: pnpm pack workspace packages, vendor them as file:*.tgz, and force-push to Heroku.',
    type: 'website',
  },
};

const DEPLOY_NAV = [
  { href: '/#packages', label: 'Packages' },
  { href: '/#quickstart', label: 'Quickstart' },
  { href: '/#deploy', label: 'Deploy' },
  { href: '/docs/', label: 'Docs' },
];

const DEMO_TREE = `apps/demo/
├── Procfile
├── package.json
├── agents/
│   └── mcp_demo.agent
├── scripts/
│   └── deploy.sh
└── .gitignore        # vendor/, node_modules/`;

const RUN_DEPLOY = `./apps/demo/scripts/deploy.sh`;

const SET_TOKEN = `heroku config:set MCP_AUTH_TOKENS=$(openssl rand -hex 16) -a agentscript-runner-demo`;

const SMOKE_RUN = `MCP_AUTH_TOKEN=… node packages/server/scripts/smoke-mcp-remote.mjs`;

const SMOKE_OUTPUT = `✓ /mcp rejects unauthenticated request (401)
✓ connected to https://…/mcp (with bearer)
✓ tools/list returned 3 tools with annotations + outputSchemas
✓ search_flights -> 2 flights, picked FL-101
✓ search_hotels -> 2 hotels, picked HT-NYC-1
✓ book_trip flat shape, confirmation BK-…, total $557
✓ book_trip deterministic
✓ book_trip error path: { booked: false, error: "Unknown flight_id…" }

✅ Live MCP smoke passed`;

export default function HerokuScriptPage() {
  return (
    <>
      <SiteHeader links={DEPLOY_NAV} />
      <main>
        <section className="hero">
          <div className="container">
            <div className="eyebrow">
              <span className="dot"></span> Heroku · Script-based
            </div>
            <h1 className="hero-title">
              Heroku via deploy <em>script</em>.
            </h1>
            <p className="hero-sub">
              The same flow that powers the live demo at{' '}
              <a href="https://agentscript-runner-demo-43272b107f3c.herokuapp.com">
                agentscript-runner-demo-43272b107f3c.herokuapp.com
              </a>
              .
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">When to reach for it</p>
            <h2 className="section-title">When to use this</h2>
            <p className="section-lead">
              Three situations call for it: the buildpack repo isn't published
              yet, the agent ships out of a workspace monorepo, or a single
              committed script needs to serve as the canonical deploy recipe.
              Workspace packages get vendored as{' '}
              <code>file:vendor/*.tgz</code> and force-pushed to Heroku from a
              clean working tree.
            </p>
            <p>
              <Link href="/deploy/heroku-buildpack">
                If you have a standalone agent repo, the buildpack flow is
                simpler.
              </Link>
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Template</p>
            <h2 className="section-title">
              The <code>apps/demo/</code> template
            </h2>
            <p className="section-lead">
              Five files under one directory, committed to the source repo.
              The deploy script reads from here and assembles a clean working
              tree elsewhere — nothing inside <code>apps/demo/</code> is
              mutated at deploy time.
            </p>

            <CodeBlock lang="bash">{DEMO_TREE}</CodeBlock>

            <p style={{ marginTop: 24 }}>
              <code>Procfile</code> is the dyno boot command.{' '}
              <code>package.json</code> pins <code>@agentscript/server</code>{' '}
              as a <code>file:vendor/*.tgz</code> dependency and lists every
              transitively required workspace package under{' '}
              <code>overrides</code> using the same <code>file:</code> form.{' '}
              <code>agents/</code> holds the <code>.agent</code> source the
              dyno actually loads. <code>scripts/deploy.sh</code> is the
              deploy. The <code>vendor/</code> dir is gitignored and rebuilt
              fresh on every deploy from <code>pnpm pack</code> output.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Deploy</p>
            <h2 className="section-title">
              What <code>deploy.sh</code> does
            </h2>
            <p className="section-lead">
              Each invocation runs four stages end-to-end. The script tears
              down and rebuilds <code>.deploy/</code> from scratch every time,
              so a failed deploy never leaves stale state.
            </p>

            <div className="steps">
              <div className="step">
                <div>
                  <h3>
                    <code>pnpm pack</code> workspace packages
                  </h3>
                  <p>
                    The script's <code>PACKAGES=(…)</code> array names every
                    workspace package the server needs at runtime —{' '}
                    <code>runtime</code>, <code>runtime-vercel</code>,{' '}
                    <code>server</code>, the three dialect packages (
                    <code>agentscript</code>, <code>agentforce</code>,{' '}
                    <code>agentfabric</code>), <code>compiler</code>,{' '}
                    <code>parser</code>, <code>parser-javascript</code>,{' '}
                    <code>parser-tree-sitter</code>, <code>language</code>,{' '}
                    <code>types</code>, <code>cli</code>, and{' '}
                    <code>agentforce</code>. Each is packed into a temp{' '}
                    <code>.deploy/vendor/</code> as a versioned{' '}
                    <code>.tgz</code>.
                  </p>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>
                    Assemble <code>.deploy/</code>
                  </h3>
                  <p>
                    <code>Procfile</code>, <code>package.json</code>, and the{' '}
                    <code>agents/</code> directory are copied verbatim from{' '}
                    <code>apps/demo/</code> into <code>.deploy/</code>{' '}
                    alongside the freshly built <code>vendor/</code>. The
                    source <code>apps/demo/</code> tree stays clean.
                  </p>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>
                    Validate <code>file:vendor/*.tgz</code> overrides
                  </h3>
                  <p>
                    An inline <code>node -e</code> step reads the staged{' '}
                    <code>package.json</code>, walks every{' '}
                    <code>overrides</code> value beginning with{' '}
                    <code>file:</code>, and asserts each tarball exists on
                    disk. Any miss aborts the script with a{' '}
                    <code>
                      Did you bump package.json versions before deploy?
                    </code>{' '}
                    message. The usual cause: a package version was bumped in
                    source but the matching <code>file:</code> ref in{' '}
                    <code>apps/demo/package.json</code> wasn't.
                  </p>
                </div>
              </div>

              <div className="step">
                <div>
                  <h3>Force-push to Heroku</h3>
                  <p>
                    <code>git init</code> inside <code>.deploy/</code>, single
                    commit, add{' '}
                    <code>
                      https://git.heroku.com/agentscript-runner-demo.git
                    </code>{' '}
                    as the <code>heroku</code> remote, then{' '}
                    <code>git push heroku main --force</code>. Heroku runs the
                    standard <code>heroku/nodejs</code> buildpack against the
                    staged tree.
                  </p>
                </div>
              </div>
            </div>

            <p style={{ marginTop: 32 }}>From the workspace root:</p>

            <CodeBlock lang="bash">{RUN_DEPLOY}</CodeBlock>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Configuration</p>
            <h2 className="section-title">Required Heroku config vars</h2>
            <p className="section-lead">
              Secrets stay on the Heroku side — the script never writes them.
              Set each var with <code>heroku config:set</code> before the
              first deploy.
            </p>

            <table className="env-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Required</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="var">
                    <code>OPENAI_API_KEY</code>
                  </td>
                  <td className="note">yes</td>
                  <td className="note">Provider key for the LLM.</td>
                </tr>
                <tr>
                  <td className="var">
                    <code>MCP_AUTH_TOKENS</code>
                  </td>
                  <td className="note">opt</td>
                  <td className="note">
                    Comma-separated bearer tokens. Required only if exposing{' '}
                    <code>/mcp</code> to external clients.
                  </td>
                </tr>
                <tr>
                  <td className="var">
                    <code>CORS_ALLOWED_ORIGINS</code>
                  </td>
                  <td className="note">opt</td>
                  <td className="note">
                    Comma-separated origins; required if a browser will call
                    this app.
                  </td>
                </tr>
                <tr>
                  <td className="var">
                    <code>DEMO_AGENT_ID</code>
                  </td>
                  <td className="note">opt</td>
                  <td className="note">
                    Default <code>mcp_demo</code>. The path-segment id used by{' '}
                    <code>
                      /einstein/ai-agent/v1/agents/&lt;id&gt;/sessions
                    </code>
                    .
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Traps</p>
            <h2 className="section-title">Two traps to know about</h2>
            <p className="section-lead">
              Both have bitten this app. The deploy reports success in both
              cases — the breakage only shows up at runtime.
            </p>

            <h3>The version-bump trap.</h3>
            <p>
              npm caches{' '}
              <code>file:vendor/&lt;name&gt;-&lt;ver&gt;.tgz</code> by
              filename. Re-pushing the same-name tarball is a silent no-op —
              Heroku reports the release succeeded, the dyno keeps the old
              code. Bump the package's version in source (
              <code>packages/&lt;pkg&gt;/package.json</code>) before
              re-deploying. The override-validation step catches the mismatch
              when the tarball name in <code>apps/demo/package.json</code> no
              longer resolves on disk.
            </p>

            <h3 style={{ marginTop: 24 }}>
              The <code>AGENTS_DIR=./agents</code> trap.
            </h3>
            <p>
              The <code>Procfile</code> sets <code>AGENTS_DIR=./agents</code>,
              so the dyno reads <code>apps/demo/agents/</code>, NOT the{' '}
              <code>agents/</code> dir bundled inside the{' '}
              <code>@agentscript/server</code> tarball. Edits to{' '}
              <code>packages/server/agents/*.agent</code> must be copied into{' '}
              <code>apps/demo/agents/*.agent</code>, or the live agent stays
              stale. Confirmed in v13 → v14 of the live demo.
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">MCP</p>
            <h2 className="section-title">MCP bearer-gate</h2>
            <p className="section-lead">
              The demo agent embeds an MCP server (<code>search_flights</code>
              , <code>search_hotels</code>, <code>book_trip</code>) and
              re-enters it through its own <code>/mcp</code> URL.{' '}
              <code>MCP_AUTH_TOKENS</code> enforces a bearer gate at the
              routing layer; <code>node.ts</code> forwards{' '}
              <code>mcpAuthTokens[0]</code> into{' '}
              <code>MCP_INTERNAL_TOKEN</code> automatically so the self-loop
              works without extra config.
            </p>

            <p style={{ marginTop: 24 }}>Generate and set a token:</p>

            <CodeBlock lang="bash">{SET_TOKEN}</CodeBlock>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Smoke test</p>
            <h2 className="section-title">Smoke-testing the live agent</h2>
            <p className="section-lead">
              One command exercises the full live path after every deploy.
            </p>

            <CodeBlock lang="bash">{SMOKE_RUN}</CodeBlock>

            <p style={{ marginTop: 24 }}>
              The script probes the 401 path, connects with the bearer, lists
              tools, then calls <code>search_flights</code>,{' '}
              <code>search_hotels</code>, and <code>book_trip</code>{' '}
              (deterministic + error path).
            </p>

            <p style={{ marginTop: 24 }}>Expected output:</p>

            <CodeBlock lang="bash">{SMOKE_OUTPUT}</CodeBlock>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Reference</p>
            <h2 className="section-title">Where to go next</h2>
            <p className="section-lead">
              Back to <Link href="/deploy">all deploy paths</Link>. For a
              standalone agent repo without the monorepo overhead, the{' '}
              <Link href="/deploy/heroku-buildpack">
                Heroku buildpack flow
              </Link>{' '}
              is simpler. For a serverless target, see{' '}
              <Link href="/deploy/vercel">Deploy to Vercel</Link>. The
              maintenance reference for this app — every config var, every
              trap, every version-bump rule — lives at{' '}
              <code>apps/demo/CLAUDE.md</code> in the repo.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter meta="© Salesforce, Inc. · Apache-2.0 · Built by the AgentScript OSS team." />
    </>
  );
}
