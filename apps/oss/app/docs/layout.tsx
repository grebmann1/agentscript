import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Docs — AgentScript OSS',
  description:
    'Reference documentation for deploying AgentScript: the script-based Heroku flow and the Node + Vercel AI SDK embed.',
  openGraph: {
    title: 'Docs — AgentScript OSS',
    description:
      'Reference documentation for deploying AgentScript: the script-based Heroku flow and the Node + Vercel AI SDK embed.',
    type: 'website',
  },
};

const DOCS_NAV = [
  { href: '/', label: 'Home' },
  { href: '/docs/', label: 'Docs' },
  { href: '/docs/deployment/', label: 'Deployment' },
  { href: '/deploy/', label: 'Deploy paths' },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader links={DOCS_NAV} />
      <main>
        <section>
          <div className="container docs-shell">{children}</div>
        </section>
      </main>
      <SiteFooter meta="© Salesforce, Inc. · Apache-2.0 · Built by the AgentScript OSS team." />
    </>
  );
}
