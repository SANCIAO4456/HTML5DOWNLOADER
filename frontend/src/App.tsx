import { Download, Globe, Layers, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DirectDownloader } from './components/DirectDownloader';
import { Header } from './components/Header';
import { LocalBundlerPanel } from './components/LocalBundlerPanel';
import type { BrowserDownloadResult } from './services/browserFlipHtml5';
import type { OutputFormat, QualityPreset } from './types';

type WorkspaceMode = 'url' | 'local';

interface SavedHistoryEntry {
  id: string;
  url: string;
  title: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  selectedPages: number;
  filename: string;
  fileSize: number;
  createdAt: string;
}

const HISTORY_KEY = 'flipdown_browser_history_v1';

function loadSavedHistory(): SavedHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function persistHistory(items: SavedHistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
  } catch {
    // Ignore storage quota errors
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function App() {
  const [mode, setMode] = useState<WorkspaceMode>('url');
  const [urlInput, setUrlInput] = useState('');
  const [history, setHistory] = useState<SavedHistoryEntry[]>(loadSavedHistory);
  const [sessionBlobs, setSessionBlobs] = useState<Record<string, string>>({});

  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    };
  }, []);

  const handleDownloadComplete = useCallback((result: BrowserDownloadResult) => {
    const id = crypto.randomUUID();
    const entry: SavedHistoryEntry = {
      id,
      url: result.url,
      title: result.title,
      format: result.format,
      quality: result.quality,
      pageRange: result.pageRange,
      selectedPages: result.selectedPages,
      filename: result.filename,
      fileSize: result.fileSize,
      createdAt: new Date().toISOString(),
    };

    blobUrlsRef.current.push(result.blobUrl);
    setSessionBlobs((prev) => ({ ...prev, [id]: result.blobUrl }));
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 30);
      persistHistory(next);
      return next;
    });
  }, []);

  const handleDeleteEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      persistHistory(next);
      return next;
    });
    setSessionBlobs((prev) => {
      if (!prev[id]) return prev;
      URL.revokeObjectURL(prev[id]);
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);

  return (
    <>
      <Header historyCount={history.length} />

      <main className="page-main">
        <div className="mode-switcher" role="tablist" aria-label="Mode alat">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'url'}
            className={`mode-tab ${mode === 'url' ? 'active' : ''}`}
            onClick={() => setMode('url')}
          >
            <Globe size={16} aria-hidden="true" />
            <span>Download dari Link FlipHTML5</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'local'}
            className={`mode-tab ${mode === 'local' ? 'active' : ''}`}
            onClick={() => setMode('local')}
          >
            <Layers size={16} aria-hidden="true" />
            <span>Susun dari Gambar Lokal</span>
          </button>
        </div>

        {mode === 'url' ? (
          <>
            <DirectDownloader
              url={urlInput}
              onUrlChange={setUrlInput}
              onDownloadComplete={handleDownloadComplete}
            />

            <section id="archive-history" aria-labelledby="archive-heading">
              <div className="section-header">
                <h2 id="archive-heading" className="section-title">
                  Riwayat Unduhan
                </h2>
                <span className="section-count">{history.length} file</span>
              </div>

              <div className="history-list">
                {history.length === 0 ? (
                  <div className="empty-archive">
                    Belum ada riwayat unduhan. Tempel link FlipHTML5 di atas lalu
                    klik <strong>Download</strong> untuk langsung menyimpan PDF
                    atau Offline HTML5 ZIP.
                  </div>
                ) : (
                  history.map((item) => {
                    const liveBlobUrl = sessionBlobs[item.id];
                    return (
                      <div className="history-row" key={item.id}>
                        <div className="history-main">
                          <div className="history-title-line">
                            <span className="history-title">{item.title}</span>
                            <span className="format-tag">
                              {item.format === 'pdf' ? 'PDF' : 'HTML5 ZIP'}
                            </span>
                            <span className="status-badge status-completed">
                              Selesai
                            </span>
                          </div>
                          <div className="history-meta">
                            <span>
                              {item.selectedPages} halaman ({item.pageRange})
                            </span>
                            <span>{item.quality}</span>
                            <span>{formatBytes(item.fileSize)}</span>
                            <span>{formatDate(item.createdAt)}</span>
                          </div>
                        </div>

                        <div className="history-actions">
                          {liveBlobUrl && (
                            <a
                              href={liveBlobUrl}
                              download={item.filename}
                              className="btn btn-primary btn-sm"
                            >
                              <Download size={14} aria-hidden="true" />
                              <span>Simpan</span>
                            </a>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            title="Masukkan link ini lagi"
                            onClick={() => {
                              setUrlInput(item.url);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            <RotateCcw size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-ghost"
                            title="Hapus dari riwayat"
                            onClick={() => handleDeleteEntry(item.id)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        ) : (
          <LocalBundlerPanel />
        )}

        <section className="guide-strip" aria-label="Keunggulan FlipDown">
          <div className="guide-item">
            <h3>Langsung Tanpa Setup API</h3>
            <p>
              Cukup tempel link FlipHTML5 publik, pilih format PDF atau Offline
              HTML5, lalu klik Download. Proses otomatis berjalan di browser Anda.
            </p>
          </div>
          <div className="guide-item">
            <h3>PDF Tajam &amp; Proporsional</h3>
            <p>
              Setiap halaman WebP, PNG, atau JPG dikonversi otomatis dan disusun
              rapi menggunakan <code>pdf-lib</code> sesuai rasio asli buku.
            </p>
          </div>
          <div className="guide-item">
            <h3>Offline HTML5 Siap Buka</h3>
            <p>
              Ekstrak file <code>.zip</code> lalu klik dua kali{' '}
              <code>index.html</code> untuk membaca flipbook offline lengkap
              dengan tampilan 2 halaman, zoom, dan navigasi keyboard.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

export default App;
