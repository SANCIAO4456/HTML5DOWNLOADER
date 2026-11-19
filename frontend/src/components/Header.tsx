import { BookMarked } from 'lucide-react';

interface HeaderProps {
  apiOnline: boolean | null;
  jobCount: number;
}

export function Header({ apiOnline, jobCount }: HeaderProps) {
  const statusClass =
    apiOnline === true ? 'online' : apiOnline === false ? 'offline' : '';
  const statusLabel =
    apiOnline === true
      ? 'API Ready'
      : apiOnline === false
        ? 'API Offline'
        : 'Checking API';

  return (
    <header className="site-header">
      <div className="header-inner">
        <a href="#top" className="brand" aria-label="FlipDown Home">
          <span className="brand-mark" aria-hidden="true">
            <BookMarked size={17} strokeWidth={2.1} />
          </span>
          <span className="brand-wordmark">FlipDown</span>
          <span className="brand-sub">FlipHTML5 Archiver</span>
        </a>

        <nav className="header-meta" aria-label="Primary">
          <a href="#archive-history" className="nav-link">
            Archive ({jobCount})
          </a>
          <span className="status-indicator" title="Backend API status">
            <span className={`status-dot ${statusClass}`} aria-hidden="true" />
            <span>{statusLabel}</span>
          </span>
        </nav>
      </div>
    </header>
  );
}
