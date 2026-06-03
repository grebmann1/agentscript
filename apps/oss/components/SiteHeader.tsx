import Link from 'next/link';

interface NavLink {
  href: string;
  label: string;
}

const DEFAULT_LINKS: NavLink[] = [
  { href: '/#paths', label: 'Deploy paths' },
  { href: '/#quickstart', label: 'Heroku' },
  { href: '/#deploy', label: 'SDK' },
  { href: '/docs/', label: 'Docs' },
];

export default function SiteHeader({
  links = DEFAULT_LINKS,
}: {
  links?: NavLink[];
}) {
  return (
    <header className="site-header">
      <div className="container">
        <Link className="brand" href="/">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
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
          AgentScript <span className="brand-tag">OSS</span>
        </Link>
        <nav className="nav">
          {links.map(link => (
            <a key={link.href} className="desktop" href={link.href}>
              {link.label}
            </a>
          ))}
          <a className="pill" href="https://github.com/salesforce/agentscript">
            GitHub →
          </a>
        </nav>
      </div>
    </header>
  );
}
