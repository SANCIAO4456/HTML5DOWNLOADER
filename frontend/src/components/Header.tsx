import { BookMarked, Settings2 } from 'lucide-react';
import { isGitHubPagesHost } from '../api/client';

interface HeaderProps {
  apiOnline: boolean | null;
  jobCount: number;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export function Header({
  apiOnline,
  jobCount,
  settingsOpen,
  onToggleSettings,
}: HeaderProps) {
  const staticHost = isGitHubPagesHost();
  const statusClass =
    apiOnline === true
      ? 'online'
      : apiOnline === false && !staticHost
        ? 'offline'
        : 'static';
  const statusLabel =
    apiOnline === true
      ? 'Backend Ready'
      : staticHost
        ? 'Static Mode'
        : apiOnline === false
          ? 'Backend Offline'
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
          {jobCount > 0 && (
            <a href="#archive-history" className="nav-link">
              Archive ({jobCount})
            </a>
          )}
          <button
            id="backend-settings-btn"
            type="button"
            className={`status-btn ${settingsOpen ? 'active' : ''}`}
            onClick={onToggleSettings}
            title="Configure FlipDown Backend API URL"
          >
            <span className={`status-dot ${statusClass}`} aria-hidden="true" />
            <span>{statusLabel}</span>
            <Settings2 size={14} aria-hidden="true" />
          </button>
        </nav>
      </div>
    </header>
  );
}
