import {
  BookOpen,
  Download,
  FileArchive,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { getProxiedImageUrl } from '../api/client';
import type { InspectedBook, OutputFormat, QualityPreset } from '../types';

interface BookPreviewCardProps {
  book: InspectedBook;
  submitting: boolean;
  onStartDownload: (config: {
    url: string;
    title: string;
    format: OutputFormat;
    quality: QualityPreset;
    pageRange: string;
  }) => void;
  onDismiss: () => void;
}

export function BookPreviewCard({
  book,
  submitting,
  onStartDownload,
  onDismiss,
}: BookPreviewCardProps) {
  const [title, setTitle] = useState(book.title);
  const [format, setFormat] = useState<OutputFormat>('pdf');
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [pageRange, setPageRange] = useState('all');
  const [coverFailed, setCoverFailed] = useState(false);

  const coverSrc = getProxiedImageUrl(book.coverUrl);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onStartDownload({
      url: book.url,
      title: title.trim() || book.title,
      format,
      quality,
      pageRange: pageRange.trim() || 'all',
    });
  };

  return (
    <section className="folio-panel" aria-label="Publication export settings">
      <div className="book-workspace">
        <div className="cover-column">
          <div className="cover-frame">
            {coverSrc && !coverFailed ? (
              <img
                src={coverSrc}
                alt={`Cover of ${book.title}`}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <div className="cover-placeholder">
                <BookOpen size={30} strokeWidth={1.6} />
                <span>{book.totalPages} Pages</span>
              </div>
            )}
          </div>

          {book.samplePages.length > 1 && (
            <div className="sample-strip" aria-label="Sample page thumbnails">
              {book.samplePages.slice(1, 5).map((sample) => {
                const thumbSrc = getProxiedImageUrl(sample.thumbUrl);
                if (!thumbSrc) return null;
                return (
                  <div className="sample-thumb" key={sample.pageNumber}>
                    <img
                      src={thumbSrc}
                      alt={`Page ${sample.pageNumber}`}
                      loading="lazy"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form className="book-config-column" onSubmit={handleSubmit}>
          <div className="book-header">
            <div className="book-heading-row">
              <h2 className="book-title-display">{book.title}</h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onDismiss}
                aria-label="Close book preview"
              >
                <X size={16} />
              </button>
            </div>

            <div className="book-meta-row">
              <span>{book.totalPages} pages</span>
              {book.pageWidth && book.pageHeight && (
                <span>
                  {book.pageWidth} &times; {book.pageHeight}px
                </span>
              )}
              <span>{book.bookSlug}</span>
            </div>

            {book.description && (
              <p className="book-description">{book.description}</p>
            )}
          </div>

          <div className="field-group">
            <span className="field-label">Export Format</span>
            <div className="format-options" role="radiogroup" aria-label="Export format">
              <button
                id="format-pdf-btn"
                type="button"
                role="radio"
                aria-checked={format === 'pdf'}
                className={`format-option ${format === 'pdf' ? 'selected' : ''}`}
                onClick={() => setFormat('pdf')}
              >
                <FileText
                  size={19}
                  style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }}
                />
                <span>
                  <span className="format-option-title">PDF Document (.pdf)</span>
                  <span className="format-option-desc">
                    Single portable file with exact page ratios and embedded metadata.
                  </span>
                </span>
              </button>

              <button
                id="format-html5-btn"
                type="button"
                role="radio"
                aria-checked={format === 'html5'}
                className={`format-option ${format === 'html5' ? 'selected' : ''}`}
                onClick={() => setFormat('html5')}
              >
                <FileArchive
                  size={19}
                  style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }}
                />
                <span>
                  <span className="format-option-title">Offline HTML5 (.zip)</span>
                  <span className="format-option-desc">
                    Standalone browser flipbook reader with spread view &amp; zoom.
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="config-grid">
            <div className="field-group full-width">
              <label htmlFor="export-title-input" className="field-label">
                Output Filename / Title
              </label>
              <input
                id="export-title-input"
                type="text"
                className="field-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Book title"
              />
            </div>

            <div className="field-group">
              <label htmlFor="page-range-input" className="field-label">
                Page Range
              </label>
              <input
                id="page-range-input"
                type="text"
                className="field-input"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder="all or 1-10, 15"
              />
              <span className="field-help">
                Use &ldquo;all&rdquo; or ranges like 1-8, 12 (max {book.totalPages})
              </span>
            </div>

            <div className="field-group">
              <label htmlFor="quality-select" className="field-label">
                Image Resolution
              </label>
              <select
                id="quality-select"
                className="field-select"
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityPreset)}
              >
                <option value="original">Original (Full Resolution)</option>
                <option value="high">High (Up to 1800px — Recommended)</option>
                <option value="medium">Medium (Up to 1280px — Balanced)</option>
                <option value="compact">Compact (Up to 960px — Smallest)</option>
              </select>
              <span className="field-help">
                Higher resolution preserves small print and diagrams.
              </span>
            </div>
          </div>

          <div className="config-actions">
            <span className="field-help">
              Files are archived locally in SQLite and ready for immediate save.
            </span>
            <button
              id="start-download-btn"
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={17} className="spin" aria-hidden="true" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <Download size={17} aria-hidden="true" />
                  <span>
                    {format === 'pdf'
                      ? 'Generate & Download PDF'
                      : 'Build Offline HTML5 ZIP'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
