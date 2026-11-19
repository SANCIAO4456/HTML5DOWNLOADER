import { BookMarked } from 'lucide-react';

interface HeaderProps {
  historyCount: number;
}

export function Header({ historyCount }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a href="#top" className="brand" aria-label="FlipDown Home">
          <span className="brand-mark" aria-hidden="true">
            <BookMarked size={17} strokeWidth={2.1} />
          </span>
          <span className="brand-wordmark">FlipDown</span>
          <span className="brand-sub">FlipHTML5 Downloader</span>
        </a>

        <nav className="header-meta" aria-label="Navigasi utama">
          <a href="#archive-history" className="nav-link nav-pill">
            Riwayat ({historyCount})
          </a>
        </nav>
      </div>
    </header>
  );
}
