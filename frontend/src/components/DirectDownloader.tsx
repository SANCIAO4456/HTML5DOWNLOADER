import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  FileText,
  Link2,
  Loader2,
  X,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import {
  downloadFlipBookDirectly,
  getDisplayImageUrl,
  inspectBookInBrowser,
  type BrowserBookMetadata,
  type BrowserDownloadProgress,
  type BrowserDownloadResult,
} from '../services/browserFlipHtml5';
import type { OutputFormat, QualityPreset } from '../types';

interface DirectDownloaderProps {
  url: string;
  onUrlChange: (value: string) => void;
  onDownloadComplete: (result: BrowserDownloadResult) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DirectDownloader({
  url,
  onUrlChange,
  onDownloadComplete,
}: DirectDownloaderProps) {
  const [format, setFormat] = useState<OutputFormat>('pdf');
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [pageRange, setPageRange] = useState('all');
  const [customTitle, setCustomTitle] = useState('');

  const [previewBook, setPreviewBook] = useState<BrowserBookMetadata | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [progressState, setProgressState] =
    useState<BrowserDownloadProgress | null>(null);
  const [lastSuccess, setLastSuccess] = useState<BrowserDownloadResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const handleUrlEdit = (value: string) => {
    onUrlChange(value);
    if (previewBook && value.trim() !== previewBook.url) {
      setPreviewBook(null);
      setCustomTitle('');
      setCoverFailed(false);
    }
  };

  const handlePreview = async () => {
    if (!url.trim() || previewLoading || downloading) return;
    setPreviewLoading(true);
    setError(null);
    setCoverFailed(false);

    try {
      const book = await inspectBookInBrowser(url.trim());
      setPreviewBook(book);
      setCustomTitle(book.title);
      onUrlChange(book.url);
    } catch (err) {
      setPreviewBook(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal membaca detail buku FlipHTML5.',
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDirectDownload = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || downloading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDownloading(true);
    setError(null);
    setLastSuccess(null);
    setProgressState({
      phase: 'fetching_meta',
      progress: 4,
      label: 'Memulai proses unduhan...',
      downloadedPages: 0,
      selectedPages: 0,
      totalPages: previewBook?.totalPages ?? 0,
      title: customTitle.trim() || previewBook?.title || 'FlipHTML5 Book',
    });

    try {
      const result = await downloadFlipBookDirectly({
        url: url.trim(),
        format,
        quality,
        pageRange: pageRange.trim() || 'all',
        customTitle: customTitle.trim() || undefined,
        prefetchedBook:
          previewBook && previewBook.url === url.trim() ? previewBook : null,
        signal: controller.signal,
        onProgress: (state) => setProgressState(state),
      });

      setLastSuccess(result);
      onDownloadComplete(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Unduhan dibatalkan.');
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Terjadi kesalahan saat mengunduh buku FlipHTML5.',
        );
      }
    } finally {
      setDownloading(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const coverUrl = previewBook ? getDisplayImageUrl(previewBook.coverUrl) : null;

  return (
    <section className="hero-section" id="top">
      <div className="hero-copy">
        <h1 className="hero-title">
          Tempel link FlipHTML5, pilih format, langsung terunduh.
        </h1>
        <p className="hero-subtitle">
          Tanpa perlu setup API atau server. Masukkan link publikasi FlipHTML5
          publik Anda untuk langsung mengunduh sebagai dokumen <strong>PDF</strong>{' '}
          atau paket <strong>Offline HTML5 (.zip)</strong> lengkap dengan viewer.
        </p>
      </div>

      <div className="folio-panel">
        <form className="direct-form" onSubmit={handleDirectDownload}>
          <div className="field-group">
            <label htmlFor="fliphtml5-url-input" className="inspector-label">
              Link FlipHTML5
            </label>
            <div className="inspector-row">
              <div className="url-input-wrap">
                <Link2 size={17} className="url-input-icon" aria-hidden="true" />
                <input
                  id="fliphtml5-url-input"
                  type="text"
                  className="url-input"
                  value={url}
                  onChange={(e) => handleUrlEdit(e.target.value)}
                  placeholder="https://online.fliphtml5.com/account/bookid/"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={downloading}
                />
              </div>

              <button
                id="preview-book-btn"
                type="button"
                className="btn btn-secondary"
                onClick={handlePreview}
                disabled={previewLoading || downloading || !url.trim()}
                title="Lihat info judul & jumlah halaman sebelum unduh"
              >
                {previewLoading ? (
                  <>
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                    <span>Mengecek...</span>
                  </>
                ) : (
                  <>
                    <Eye size={16} aria-hidden="true" />
                    <span>Cek Info</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {previewBook && (
            <div className="preview-inline-card">
              <div className="preview-inline-cover">
                {coverUrl && !coverFailed ? (
                  <img
                    src={coverUrl}
                    alt={`Sampul ${previewBook.title}`}
                    onError={() => setCoverFailed(true)}
                  />
                ) : (
                  <div className="cover-placeholder">
                    <BookOpen size={22} strokeWidth={1.6} />
                  </div>
                )}
              </div>

              <div className="preview-inline-meta">
                <div className="book-heading-row">
                  <strong className="preview-inline-title">
                    {previewBook.title}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setPreviewBook(null);
                      setCustomTitle('');
                    }}
                    aria-label="Tutup pratinjau"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="book-meta-row">
                  <span>{previewBook.totalPages} halaman</span>
                  {previewBook.pageWidth && previewBook.pageHeight && (
                    <span>
                      {previewBook.pageWidth} &times; {previewBook.pageHeight}px
                    </span>
                  )}
                  <span>{previewBook.bookSlug}</span>
                </div>
                <input
                  type="text"
                  className="field-input preview-title-input"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Ubah nama file hasil download (opsional)"
                  aria-label="Nama file hasil download"
                />
              </div>
            </div>
          )}

          <div className="field-group">
            <span className="field-label">Pilih Format Unduhan</span>
            <div
              className="format-options"
              role="radiogroup"
              aria-label="Format unduhan"
            >
              <button
                id="format-pdf-btn"
                type="button"
                role="radio"
                aria-checked={format === 'pdf'}
                className={`format-option ${format === 'pdf' ? 'selected' : ''}`}
                onClick={() => setFormat('pdf')}
                disabled={downloading}
              >
                <FileText
                  size={19}
                  style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }}
                />
                <span>
                  <span className="format-option-title">Dokumen PDF (.pdf)</span>
                  <span className="format-option-desc">
                    Satu file PDF siap baca &amp; cetak sesuai proporsi halaman asli.
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
                disabled={downloading}
              >
                <FileArchive
                  size={19}
                  style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }}
                />
                <span>
                  <span className="format-option-title">
                    Offline HTML5 (.zip)
                  </span>
                  <span className="format-option-desc">
                    Paket buku HTML5 mandiri — ekstrak &amp; buka index.html tanpa
                    internet.
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="config-grid">
            <div className="field-group">
              <label htmlFor="page-range-input" className="field-label">
                Halaman yang Diunduh
              </label>
              <input
                id="page-range-input"
                type="text"
                className="field-input"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder="all atau contoh: 1-10, 15"
                disabled={downloading}
              />
              <span className="field-help">
                Ketik <code>all</code> untuk semua halaman, atau rentang seperti{' '}
                <code>1-10, 15</code>.
              </span>
            </div>

            <div className="field-group">
              <label htmlFor="quality-select" className="field-label">
                Kualitas Gambar
              </label>
              <select
                id="quality-select"
                className="field-select"
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityPreset)}
                disabled={downloading}
              >
                <option value="high">Tinggi (hingga 1800px — Disarankan)</option>
                <option value="original">Asli (Resolusi Penuh)</option>
                <option value="medium">Sedang (hingga 1280px — Seimbang)</option>
                <option value="compact">Ringan (hingga 960px — File Kecil)</option>
              </select>
              <span className="field-help">
                Semua konversi berjalan langsung di browser Anda.
              </span>
            </div>
          </div>

          <div className="direct-submit-row">
            <span className="inspector-hints">
              Mendukung{' '}
              <span className="mono-sample">
                online.fliphtml5.com/&lt;user&gt;/&lt;buku&gt;/
              </span>
            </span>

            <button
              id="direct-download-btn"
              type="submit"
              className="btn btn-primary"
              disabled={downloading || !url.trim()}
            >
              {downloading ? (
                <>
                  <Loader2 size={17} className="spin" aria-hidden="true" />
                  <span>Memproses Unduhan...</span>
                </>
              ) : (
                <>
                  <Download size={17} aria-hidden="true" />
                  <span>
                    {format === 'pdf'
                      ? 'Download PDF Sekarang'
                      : 'Download Offline HTML5 (.zip)'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {downloading && progressState && (
        <article className="active-job-card" aria-live="polite">
          <div className="active-job-top">
            <div>
              <h2 className="active-job-title">
                {progressState.title || 'Mengunduh Publikasi FlipHTML5'}
              </h2>
              <span className="active-job-phase">{progressState.label}</span>
            </div>
            <button
              type="button"
              className="cancel-btn"
              onClick={handleCancel}
            >
              Batal
            </button>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progressState.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, progressState.progress)}%` }}
            />
          </div>

          <div className="active-job-footer">
            <span>
              {format.toUpperCase()} &middot; {quality}
              {progressState.selectedPages > 0
                ? ` · ${progressState.downloadedPages}/${progressState.selectedPages} halaman`
                : ''}
            </span>
            <span>{progressState.progress}%</span>
          </div>
        </article>
      )}

      {lastSuccess && !downloading && (
        <div className="alert-banner alert-success success-with-action" role="status">
          <div className="success-text">
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Berhasil! <strong>{lastSuccess.filename}</strong> (
              {lastSuccess.selectedPages} halaman &middot;{' '}
              {formatFileSize(lastSuccess.fileSize)}) otomatis tersimpan ke folder
              Downloads Anda.
            </span>
          </div>
          <a
            href={lastSuccess.blobUrl}
            download={lastSuccess.filename}
            className="btn btn-primary btn-sm"
          >
            <Download size={14} />
            <span>Simpan Lagi</span>
          </a>
        </div>
      )}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
