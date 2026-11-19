import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  buildClientPackage,
  sortFilesNaturally,
  type LocalPageItem,
} from '../services/clientBundler';
import type { OutputFormat, QualityPreset } from '../types';

export function LocalBundlerPanel() {
  const [pages, setPages] = useState<LocalPageItem[]>([]);
  const [title, setTitle] = useState('My Offline Flipbook');
  const [format, setFormat] = useState<OutputFormat>('pdf');
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [dragActive, setDragActive] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; label: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    filename: string;
    size: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pagesRef = useRef<LocalPageItem[]>([]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    return () => {
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const addFiles = (fileList: FileList | File[]) => {
    const accepted = Array.from(fileList).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (accepted.length === 0) {
      setError('Please select valid image files (JPEG, PNG, or WebP).');
      return;
    }

    setError(null);
    setLastResult(null);
    const sorted = sortFilesNaturally(accepted);
    const nextItems: LocalPageItem[] = sorted.map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPages((prev) => [...prev, ...nextItems]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files?.length) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removePage = (id: string) => {
    setPages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const movePage = (index: number, delta: -1 | 1) => {
    setPages((prev) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, moved);
      return copy;
    });
  };

  const clearAll = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPages([]);
    setLastResult(null);
    setProgress(null);
    setError(null);
  };

  const handleExport = async (event: FormEvent) => {
    event.preventDefault();
    if (pages.length === 0 || building) return;

    setBuilding(true);
    setError(null);
    setLastResult(null);
    setProgress({ percent: 4, label: 'Preparing browser studio...' });

    try {
      const result = await buildClientPackage({
        pages,
        title: title.trim() || 'FlipDown Book',
        format,
        quality,
        onProgress: (percent, label) => setProgress({ percent, label }),
      });
      setLastResult(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to build package in browser.',
      );
    } finally {
      setBuilding(false);
    }
  };

  const formatKb = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  return (
    <section className="folio-panel" aria-label="Browser-side PDF and Offline HTML5 studio">
      <form className="local-studio-form" onSubmit={handleExport}>
        <div className="local-studio-head">
          <div>
            <h2 className="section-title">Browser PDF &amp; Offline HTML5 Studio</h2>
            <p className="hero-subtitle">
              Runs 100% locally inside your browser — zero server needed. Drop
              page images in order to build a print-ready PDF or standalone
              offline HTML5 flipbook archive.
            </p>
          </div>
          {pages.length > 0 && (
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={clearAll}
            >
              <Trash2 size={15} />
              <span>Clear ({pages.length})</span>
            </button>
          )}
        </div>

        <div
          className={`dropzone ${dragActive ? 'active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) {
                addFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <ImagePlus size={26} strokeWidth={1.7} />
          <span className="dropzone-title">
            Drop book page images here, or click to browse
          </span>
          <span className="dropzone-sub">
            Supports JPG, PNG, WebP &middot; Automatically sorted numerically (page-1, page-2, ..., page-10)
          </span>
        </div>

        {pages.length > 0 && (
          <div className="local-pages-grid" aria-label="Selected pages">
            {pages.map((item, idx) => (
              <div className="local-page-tile" key={item.id}>
                <div className="local-page-thumb">
                  <img src={item.previewUrl} alt={`Page ${idx + 1}`} />
                  <span className="local-page-badge">{idx + 1}</span>
                  <button
                    type="button"
                    className="local-page-remove"
                    title="Remove page"
                    onClick={() => removePage(item.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="local-page-controls">
                  <button
                    type="button"
                    className="mini-order-btn"
                    disabled={idx === 0}
                    title="Move earlier"
                    onClick={() => movePage(idx, -1)}
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <span className="local-page-name" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <button
                    type="button"
                    className="mini-order-btn"
                    disabled={idx === pages.length - 1}
                    title="Move later"
                    onClick={() => movePage(idx, 1)}
                  >
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="field-group">
          <span className="field-label">Export Format</span>
          <div className="format-options">
            <button
              type="button"
              className={`format-option ${format === 'pdf' ? 'selected' : ''}`}
              onClick={() => setFormat('pdf')}
            >
              <FileText size={19} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }} />
              <span>
                <span className="format-option-title">PDF Document (.pdf)</span>
                <span className="format-option-desc">
                  Compiled directly in your browser using pdf-lib.
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`format-option ${format === 'html5' ? 'selected' : ''}`}
              onClick={() => setFormat('html5')}
            >
              <FileArchive size={19} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }} />
              <span>
                <span className="format-option-title">Offline HTML5 (.zip)</span>
                <span className="format-option-desc">
                  Standalone flipbook viewer ZIP — unzip and open index.html offline.
                </span>
              </span>
            </button>
          </div>
        </div>

        <div className="config-grid">
          <div className="field-group">
            <label htmlFor="local-title-input" className="field-label">
              Publication Title
            </label>
            <input
              id="local-title-input"
              type="text"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label htmlFor="local-quality-select" className="field-label">
              Image Resolution
            </label>
            <select
              id="local-quality-select"
              className="field-select"
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityPreset)}
            >
              <option value="original">Original (Full Resolution)</option>
              <option value="high">High (Up to 1800px)</option>
              <option value="medium">Medium (Up to 1280px)</option>
              <option value="compact">Compact (Up to 960px)</option>
            </select>
          </div>
        </div>

        {progress && (
          <div className="local-progress-box">
            <div className="local-progress-meta">
              <span>{progress.label}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="progress-track local-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(4, progress.percent)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="alert-banner alert-error" role="alert">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {lastResult && (
          <div className="alert-banner alert-success" role="status">
            <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Saved <strong>{lastResult.filename}</strong> ({formatKb(lastResult.size)}) to your downloads folder.
            </span>
          </div>
        )}

        <div className="config-actions">
          <span className="field-help">
            All processing stays private on your device — files are never uploaded.
          </span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pages.length === 0 || building}
          >
            {building ? (
              <>
                <Loader2 size={17} className="spin" />
                <span>Building...</span>
              </>
            ) : (
              <>
                <Download size={17} />
                <span>
                  {format === 'pdf'
                    ? `Build PDF (${pages.length} pages)`
                    : `Build Offline HTML5 ZIP (${pages.length} pages)`}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
