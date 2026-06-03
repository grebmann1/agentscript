import type { Metadata } from 'next';
import Script from 'next/script';
import StickyHeader from '@/components/StickyHeader';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentScript OSS - create and deploy AgentScript agents',
  description:
    'Author an agent in a single .agent file, declare its model and MCP servers inline, and ship it to Heroku with `agentscript build` — or embed the runtime in your own TypeScript app.',
  icons: { icon: '/assets/favicon.svg' },
  openGraph: {
    title: 'AgentScript OSS - create and deploy AgentScript agents',
    description:
      'Create AgentScript agents and deploy them with a Heroku-ready server or embed them in your own app with the runtime and Vercel AI SDK.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        <Script id="demo-api-base" strategy="beforeInteractive">
          {`window.AGENTSCRIPT_DEMO_API_BASE = 'https://agentscript-runner-demo-43272b107f3c.herokuapp.com';`}
        </Script>
      </head>
      <body>
        {children}
        <StickyHeader />
      </body>
    </html>
  );
}
