export default function SiteFooter({
  meta = '© Salesforce, Inc. · Apache-2.0 · Built and open-sourced by Salesforce.',
}: {
  meta?: string;
}) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-row">
          <span className="brand-line">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 19 L12 5 L19 19"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <line
                x1="8"
                y1="14.5"
                x2="16"
                y2="14.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            AgentScript <span className="brand-tag on-deep">OSS</span>
          </span>
          <div>
            <a href="https://github.com/salesforce/agentscript">GitHub</a> ·{' '}
            <a href="/docs/">Docs</a> ·{' '}
            <a href="https://github.com/salesforce/agentscript/issues/new?template=poc-feedback.yml">
              Feedback
            </a>{' '}
            · <a href="https://www.npmjs.com/org/agentscript">npm</a> ·{' '}
            <a href="https://github.com/salesforce/agentscript/blob/main/LICENSE.txt">
              License
            </a>
          </div>
        </div>
        <div className="meta">{meta}</div>
      </div>
    </footer>
  );
}
