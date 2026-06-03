import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CodeBlock from '@/components/CodeBlock';

export const metadata: Metadata = {
  title: 'Deploy on Vercel — AgentScript OSS',
  description:
    'Embed AgentScript inside a Vercel/Next.js route handler with @agentscript/runtime-vercel. Full streaming, any AI SDK provider, no separate server.',
  openGraph: {
    title: 'Deploy on Vercel — AgentScript OSS',
    description:
      'Embed AgentScript inside a Vercel/Next.js route handler with @agentscript/runtime-vercel. Full streaming, any AI SDK provider, no separate server.',
    type: 'website',
  },
};

const DEPLOY_NAV = [
  { href: '/#packages', label: 'Packages' },
  { href: '/#quickstart', label: 'Quickstart' },
  { href: '/#deploy', label: 'Deploy' },
  { href: '/docs/', label: 'Docs' },
];

const INSTALL = `pnpm add @agentscript/runtime @agentscript/runtime-vercel ai @ai-sdk/openai`;

const ROUTE_TS = `// app/api/agent/route.ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin to Node — the parser depends on a native module.
export const runtime = 'nodejs';

const source = readFileSync(
  join(process.cwd(), 'agents/support.agent'),
  'utf8'
);
const { output: doc } = compileSource(source);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_number }) => ({
  status: order_number === 'ORD-42' ? 'shipped' : 'unknown',
}));

const tools = new ToolRegistry();
tools.register('fn', fn);

const agent = createAgent({
  doc,
  llm: { model: openai('gpt-4o-mini'), generateText },
  tools,
});

export async function POST(req: Request) {
  const { message } = await req.json();
  const stream = agent.stream(message);
  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream.textStream) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
}`;

const VERCEL_ENV = `vercel env add OPENAI_API_KEY production
# Optional: ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY for other providers`;

export default function VercelPage() {
  return (
    <>
      <SiteHeader links={DEPLOY_NAV} />
      <main>
        <section className="hero">
          <div className="container">
            <div className="eyebrow">
              <span className="dot"></span> Vercel · Serverless
            </div>
            <h1 className="hero-title">
              AgentScript inside a <em>Vercel route.</em>
            </h1>
            <p className="hero-sub">
              The runtime is a JavaScript library — it runs wherever Node
              runs. The Vercel AI SDK adapter wraps it as a streaming Next.js
              route handler.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Why this works</p>
            <h2 className="section-title">A library, not a server</h2>
            <p className="section-lead">
              AgentScript compiles <code>.agent</code> source into an IR. The
              runtime executes that IR through an <code>LlmDriver</code>{' '}
              interface. <code>@agentscript/runtime-vercel</code> ships a
              driver that wraps the Vercel AI SDK's <code>generateText</code>,
              so any AI SDK provider (OpenAI, Anthropic, Google, …) becomes a
              valid LLM backend. The same agent file that runs under{' '}
              <code>@agentscript/server</code> on Heroku runs inside a Next.js
              route on Vercel — no second process.
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Install</p>
            <h2 className="section-title">Three packages plus a provider</h2>
            <p className="section-lead">
              The runtime, the Vercel adapter, the AI SDK core, and whichever
              provider package you already pull in for the rest of your app.
            </p>

            <CodeBlock lang="bash">{INSTALL}</CodeBlock>

            <p style={{ marginTop: 24 }}>
              <code>ai</code> is a peer dependency — bring whatever version
              you already have pinned in your Next.js app. Swap{' '}
              <code>@ai-sdk/openai</code> for <code>@ai-sdk/anthropic</code>,{' '}
              <code>@ai-sdk/google</code>, or any other AI SDK provider with
              no other code changes.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Recipe</p>
            <h2 className="section-title">A streaming agent route, end to end</h2>
            <p className="section-lead">
              One file under <code>app/api/agent/</code>. Compile the{' '}
              <code>.agent</code> source at module load, register tools, build
              the agent, then stream tokens out of the <code>POST</code>{' '}
              handler as a plain Web <code>ReadableStream</code>.
            </p>

            <CodeBlock lang="ts">{ROUTE_TS}</CodeBlock>

            <p style={{ marginTop: 24 }}>
              Top-down: standard Next.js + AI SDK imports, then the
              AgentScript runtime + adapter. The{' '}
              <code>runtime = 'nodejs'</code> export opts the route out of the
              edge runtime (see the next section for why).{' '}
              <code>readFileSync</code> + <code>compileSource</code> run once
              at module load — Next.js caches the module across requests, so
              compilation is paid for once per cold start.{' '}
              <code>FnAdapter</code> registers each in-process function under
              a <code>fn://NAME</code> URI; the <code>ToolRegistry</code>{' '}
              binds the <code>fn</code> scheme to that adapter.{' '}
              <code>createAgent</code> stitches the compiled doc, the LLM
              driver, and the tool registry into a single agent. The{' '}
              <code>POST</code> handler reads a JSON body, kicks off{' '}
              <code>agent.stream(message)</code>, and pipes{' '}
              <code>textStream</code> chunks into a Web{' '}
              <code>ReadableStream</code> for the response.
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Caveats</p>
            <h2 className="section-title">Two things to know up front</h2>
            <p className="section-lead">
              Both bite at deploy time, not at write time. Read these before
              you push.
            </p>

            <h3>Edge runtime not yet supported.</h3>
            <p>
              The default Agentforce parser (
              <code>@agentscript/parser-tree-sitter</code>) compiles a native
              tree-sitter binding, which doesn't run in Vercel's edge runtime.
              Pin the route to <code>runtime: 'nodejs'</code> until an
              edge-safe parser ships. The <code>compileSource</code> re-export
              from <code>runtime-vercel</code> uses the Agentforce dialect's
              pure-Node parser path; do not import{' '}
              <code>@agentscript/parser-tree-sitter</code> directly from your
              route file.
            </p>

            <h3 style={{ marginTop: 24 }}>No buildpack equivalent.</h3>
            <p>
              Unlike the Heroku flows, this is a library integration, not a
              turnkey deploy. Vercel doesn't auto-detect <code>.agent</code>{' '}
              files, scaffold a <code>package.json</code>, or boot a server
              for you. The route handler is your only entry point — wire your
              own streaming, error-handling, and auth as you would for any
              Next.js route.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Configuration</p>
            <h2 className="section-title">Env vars on Vercel</h2>
            <p className="section-lead">
              Provider keys live on Vercel, not in the agent. Set each one
              with <code>vercel env add</code> before the first deploy.
            </p>

            <CodeBlock lang="bash">{VERCEL_ENV}</CodeBlock>

            <p style={{ marginTop: 24 }}>
              The AI SDK provider modules (<code>@ai-sdk/openai</code>,{' '}
              <code>@ai-sdk/anthropic</code>, …) read these from{' '}
              <code>process.env</code> automatically. The agent's own{' '}
              <code>deployment:</code> block, if present, is ignored on Vercel
              — the AI SDK provider, not AgentScript, owns credentials in
              this flow.
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Other dialects</p>
            <h2 className="section-title">Beyond Agentforce</h2>
            <p className="section-lead">
              <code>compileSource</code> is Agentforce-only. Other dialects
              compile through a different entry point but plug into the same
              runtime.
            </p>
            <p>
              For Agent Fabric or the AgentScript dialect, compile separately
              with <code>@agentscript/compiler</code>'s <code>compile()</code>{' '}
              and pass the resulting <code>AgentDSLAuthoring</code> straight
              to <code>createAgent({'{ doc }'})</code>. The runtime is
              dialect-agnostic — only the compile step changes. Everything
              else on this page (tool registry, streaming, env vars, the
              route handler) stays the same.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Reference</p>
            <h2 className="section-title">Stream part types</h2>
            <p className="section-lead">
              <code>agent.stream(text)</code> returns both a{' '}
              <code>textStream</code> (text deltas only) and a{' '}
              <code>fullStream</code> of typed parts. The shape mirrors the
              Vercel AI SDK <code>streamText</code> idiom — switch on{' '}
              <code>part.type</code> exactly as you would there.
            </p>

            <table className="env-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Payload</th>
                  <th>AI SDK analog</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="var"><code>start-step</code></td>
                  <td className="note"><code>{'{ node }'}</code></td>
                  <td className="note"><code>start-step</code></td>
                </tr>
                <tr>
                  <td className="var"><code>finish-step</code></td>
                  <td className="note"><code>{'{ node, to? }'}</code></td>
                  <td className="note"><code>finish-step</code></td>
                </tr>
                <tr>
                  <td className="var"><code>phase-start</code></td>
                  <td className="note"><code>{'{ node, phase }'}</code></td>
                  <td className="note">—</td>
                </tr>
                <tr>
                  <td className="var"><code>phase-end</code></td>
                  <td className="note"><code>{'{ node, phase }'}</code></td>
                  <td className="note">—</td>
                </tr>
                <tr>
                  <td className="var"><code>text-delta</code></td>
                  <td className="note"><code>{'{ text }'}</code></td>
                  <td className="note"><code>text-delta</code></td>
                </tr>
                <tr>
                  <td className="var"><code>tool-call</code></td>
                  <td className="note"><code>{'{ toolName, args }'}</code></td>
                  <td className="note"><code>tool-call</code></td>
                </tr>
                <tr>
                  <td className="var"><code>tool-result</code></td>
                  <td className="note"><code>{'{ toolName, result }'}</code></td>
                  <td className="note"><code>tool-result</code></td>
                </tr>
                <tr>
                  <td className="var"><code>tool-error</code></td>
                  <td className="note"><code>{'{ toolName, error }'}</code></td>
                  <td className="note"><code>tool-error</code></td>
                </tr>
                <tr>
                  <td className="var"><code>state-change</code></td>
                  <td className="note"><code>{'{ name, before, after }'}</code></td>
                  <td className="note">—</td>
                </tr>
                <tr>
                  <td className="var"><code>abort</code></td>
                  <td className="note"><code>{'{ reason? }'}</code></td>
                  <td className="note"><code>abort</code></td>
                </tr>
                <tr>
                  <td className="var"><code>finish</code></td>
                  <td className="note">
                    <code>{'{ finalNode, assistantText }'}</code>
                  </td>
                  <td className="note"><code>finish</code></td>
                </tr>
                <tr>
                  <td className="var"><code>error</code></td>
                  <td className="note"><code>{'{ error }'}</code></td>
                  <td className="note"><code>error</code></td>
                </tr>
              </tbody>
            </table>

            <p style={{ marginTop: 24 }}>
              Phase parts (<code>phase-start</code>, <code>phase-end</code>)
              and <code>state-change</code> are AgentScript-specific — surface
              them in your UI for in-flight tool progress, or ignore them and
              stick to <code>textStream</code> for plain token output.
            </p>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Reference</p>
            <h2 className="section-title">Where to go next</h2>
            <p className="section-lead">
              Back to <Link href="/deploy">all deploy paths</Link>. For a
              turnkey deploy from a standalone agent repo, see the{' '}
              <Link href="/deploy/heroku-buildpack">Heroku buildpack</Link>.
              For the workspace-monorepo flow that powers the live demo, see{' '}
              <Link href="/deploy/heroku-script">
                Heroku via deploy script
              </Link>
              . Both ship the same compiled IR — only the host changes.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter meta="© Salesforce, Inc. · Apache-2.0 · Built by the AgentScript OSS team." />
    </>
  );
}
