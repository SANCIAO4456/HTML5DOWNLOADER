import { AlertCircle, Link2, Loader2, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import type { InspectionSummary } from '../types';

interface UrlInspectorProps {
  url: string;
  onUrlChange: (value: string) => void;
  onInspect: (targetUrl?: string) => void;
  loading: boolean;
  error: string | null;
  recentInspections: InspectionSummary[];
}

export function UrlInspector({
  url,
  onUrlChange,
  onInspect,
  loading,
  error,
  recentInspections,
}: UrlInspectorProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || loading) return;
    onInspect(url.trim());
  };

  return (
    <section className="hero-section" id="top">
      <div className="hero-copy">
        <h1 className="hero-title">
          Archive FlipHTML5 publications into crisp PDFs or offline HTML5 books.
        </h1>
        <p className="hero-subtitle">
          Paste any public FlipHTML5 link to inspect its pages, pick a custom range
          and image resolution, and export a print-ready PDF or standalone offline
          flipbook reader.
        </p>
      </div>

      <div className="folio-panel">
        <form className="inspector-form" onSubmit={handleSubmit}>
          <label htmlFor="fliphtml5-url-input" className="inspector-label">
            FlipHTML5 Book URL
          </label>
          <div className="inspector-row">
            <div className="url-input-wrap">
              <Link2 size={17} className="url-input-icon" aria-hidden="true" />
              <input
                id="fliphtml5-url-input"
                type="text"
                className="url-input"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://online.fliphtml5.com/account/bookid/"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <button
              id="inspect-book-btn"
              type="submit"
              className="btn btn-primary"
              disabled={loading || !url.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={17} className="spin" aria-hidden="true" />
                  <span>Inspecting</span>
                </>
              ) : (
                <>
                  <Search size={17} aria-hidden="true" />
                  <span>Inspect Book</span>
                </>
              )}
            </button>
          </div>

          <div className="inspector-hints">
            <span>
              Supports <span className="mono-sample">online.fliphtml5.com/&lt;user&gt;/&lt;book&gt;/</span>{' '}
              and <span className="mono-sample">fliphtml5.com/&lt;user&gt;/&lt;book&gt;/</span>
            </span>
            <span>Public flipbooks only</span>
          </div>

          {recentInspections.length > 0 && (
            <div className="recent-chips">
              <span className="recent-label">Recently inspected:</span>
              {recentInspections.slice(0, 5).map((item) => (
                <button
                  key={item.url}
                  type="button"
                  className="recent-chip"
                  title={`${item.title} (${item.totalPages} pages)`}
                  onClick={() => {
                    onUrlChange(item.url);
                    onInspect(item.url);
                  }}
                >
                  {item.title} ({item.totalPages}p)
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {error && (
        <div className="alert-banner alert-error" role="alert">
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
