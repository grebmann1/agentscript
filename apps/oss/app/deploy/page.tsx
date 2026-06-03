import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Deploy — AgentScript OSS',
  description:
    'Three ways to deploy AgentScript: Heroku buildpack, Heroku via deploy script, or embedded in a Vercel/Next.js route.',
  openGraph: {
    title: 'Deploy — AgentScript OSS',
    description:
      'Three ways to deploy AgentScript: Heroku buildpack, Heroku via deploy script, or embedded in a Vercel/Next.js route.',
    type: 'website',
  },
};

const DEPLOY_NAV = [
  { href: '/#packages', label: 'Packages' },
  { href: '/#quickstart', label: 'Quickstart' },
  { href: '/#deploy', label: 'Deploy' },
  { href: '/docs/', label: 'Docs' },
];

export default function DeployPage() {
  return (
    <>
      <SiteHeader links={DEPLOY_NAV} />
      <main>
        <section className="hero">
          <div className="container">
            <div className="eyebrow">
              <span className="dot"></span> Deployment
            </div>
            <h1 className="hero-title">
              Three ways to deploy <em>AgentScript.</em>
            </h1>
            <p className="hero-sub">
              Pick the path that matches your infrastructure. All three run the
              same compiled IR — only the host changes.
            </p>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">Paths</p>
            <h2 className="section-title">
              Same runtime. <em>Three hosts.</em>
            </h2>
            <p className="section-lead">
              Each path ships the same compiled IR — they differ only in how it
              gets to the host and what runs it.
            </p>

            <div className="packages">
              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">heroku-buildpack</span>
                  <span className="pkg-version">path 1</span>
                </div>
                <p className="pkg-tagline">
                  Push <code>.agent</code> files. Done.
                </p>
                <p className="pkg-desc">
                  The buildpack detects <code>.agent</code> files, scaffolds{' '}
                  <code>package.json</code> and <code>Procfile</code>, and hands
                  off to <code>heroku/nodejs</code>.{' '}
                  <code>git push heroku main</code> is the deployment — no local
                  build step.
                </p>
                <Link className="btn primary" href="/deploy/heroku-buildpack">
                  Read the guide <span className="arrow">→</span>
                </Link>
              </article>

              <article className="pkg">
                <div className="pkg-head">
                  <span className="pkg-name">heroku-script</span>
                  <span className="pkg-version">path 2</span>
                </div>
                <p className="pkg-tagline">Vendored tarballs. Repeatable.</p>
                <p className="pkg-desc">
                  The script <code>pnpm pack</code>s workspace packages, pins{' '}
                  <code>file:vendor/*.tgz</code> overrides, and force-pushes to
                  Heroku. The same flow powers the live demo at{' '}
                  <a href="https://agentscript-runner-demo-43272b107f3c.herokuapp.com">
                    agentscript-runner-demo
                  </a>{' '}
                  — pre-publish ready.
                </p>
                <Link className="btn primary" href="/deploy/heroku-script">
                  Read the guide <span className="arrow">→</span>
                </Link>
              </article>

              <article className="pkg span-2">
                <div className="pkg-head">
                  <span className="pkg-name">vercel</span>
                  <span className="pkg-version">path 3</span>
                </div>
                <p className="pkg-tagline">Embed in a Next.js route.</p>
                <p className="pkg-desc">
                  <code>@agentscript/runtime-vercel</code> bridges the Vercel AI
                  SDK and runs the agent inside any App Router route handler.
                  Full streaming, no separate server — co-deploys with your app.
                </p>
                <Link className="btn primary" href="/deploy/vercel">
                  Read the guide <span className="arrow">→</span>
                </Link>
              </article>
            </div>
          </div>
        </section>

        <section className="alt">
          <div className="container">
            <p className="section-eyebrow">Decision matrix</p>
            <h2 className="section-title">Which path is right?</h2>
            <p className="section-lead">
              Match the left column to what you already run. If two rows fit,
              the right column is the tiebreaker.
            </p>

            <table className="env-table">
              <thead>
                <tr>
                  <th>If you have…</th>
                  <th>…and want…</th>
                  <th>Pick</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="var">
                    a few <code>.agent</code> files
                  </td>
                  <td className="note">skip infra setup</td>
                  <td className="note">
                    <Link href="/deploy/heroku-buildpack">Heroku buildpack</Link>
                  </td>
                </tr>
                <tr>
                  <td className="var">a workspace monorepo</td>
                  <td className="note">ship repeatable pre-publish deploys</td>
                  <td className="note">
                    <Link href="/deploy/heroku-script">Heroku via script</Link>
                  </td>
                </tr>
                <tr>
                  <td className="var">an existing Next.js app</td>
                  <td className="note">co-deploy on serverless or edge</td>
                  <td className="note">
                    <Link href="/deploy/vercel">Vercel</Link>
                  </td>
                </tr>
                <tr>
                  <td className="var">your own Node server</td>
                  <td className="note">
                    run <code>@agentscript/server</code> directly
                  </td>
                  <td className="note">
                    See <code>packages/server/README.md</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="container">
            <p className="section-eyebrow">One runtime</p>
            <h2 className="section-title">
              Move between hosts <em>without rewriting agents.</em>
            </h2>
            <p className="section-lead">
              The <code>.agent</code> source, the tool registry, and the
              compiled IR are identical across all three paths. What changes is
              the Procfile, the route handler, or the deploy command — not the
              agent.
            </p>
            <div className="cta">
              <a className="btn" href="https://github.com/salesforce/agentscript">
                View source on GitHub <span className="arrow">→</span>
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter meta="© Salesforce, Inc. · Apache-2.0 · Built by the AgentScript OSS team." />
    </>
  );
}
