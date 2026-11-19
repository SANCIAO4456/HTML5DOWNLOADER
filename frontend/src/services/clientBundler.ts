import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import type { OutputFormat, QualityPreset } from '../types';

export interface LocalPageItem {
  id: string;
  file: File;
  previewUrl: string;
}

export interface RawPageBytes {
  pageNumber: number;
  bytes: Uint8Array;
  mimeType: string;
}

interface QualityProfile {
  maxWidth: number | null;
  jpegQuality: number;
}

const QUALITY_PROFILES: Record<QualityPreset, QualityProfile> = {
  original: { maxWidth: null, jpegQuality: 0.94 },
  high: { maxWidth: 1800, jpegQuality: 0.88 },
  medium: { maxWidth: 1280, jpegQuality: 0.78 },
  compact: { maxWidth: 960, jpegQuality: 0.64 },
};

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function sortFilesNaturally(files: File[]): File[] {
  return [...files].sort((a, b) => naturalCollator.compare(a.name, b.name));
}

export function sanitizeBaseName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return cleaned || 'flipdown-publication';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function decodeImageSource(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below (e.g. Safari/certain WebP variants)
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Browser could not decode page image.'));
    };
    img.src = objectUrl;
  });
}

export async function normalizeBlobToJpeg(
  blob: Blob,
  quality: QualityPreset,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const decoded = await decodeImageSource(blob);
  try {
    const profile = QUALITY_PROFILES[quality];
    let targetWidth = decoded.width;
    let targetHeight = decoded.height;

    if (profile.maxWidth && decoded.width > profile.maxWidth) {
      const ratio = profile.maxWidth / decoded.width;
      targetWidth = profile.maxWidth;
      targetHeight = Math.max(1, Math.round(decoded.height * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Browser Canvas 2D context is unavailable.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);

      const outBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error('Failed to encode page image to JPEG.'));
          },
          'image/jpeg',
          profile.jpegQuality,
        );
      });

      const buffer = await outBlob.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        width: targetWidth,
        height: targetHeight,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    decoded.cleanup();
  }
}

function buildOfflineHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — FlipDown Offline Reader</title>
  <link rel="stylesheet" href="assets/viewer.css" />
</head>
<body>
  <div class="reader-shell">
    <header class="topbar">
      <div class="topbar-left">
        <button id="toggleThumbsBtn" class="icon-btn" type="button">Pages</button>
        <h1 class="book-title">${safeTitle}</h1>
      </div>
      <div class="topbar-controls">
        <button id="modeBtn" class="icon-btn" type="button">Spread View</button>
        <button id="zoomOutBtn" class="icon-btn" type="button">-</button>
        <span id="zoomLabel" class="zoom-label">100%</span>
        <button id="zoomInBtn" class="icon-btn" type="button">+</button>
        <button id="fullscreenBtn" class="icon-btn" type="button">Fullscreen</button>
      </div>
    </header>
    <div class="workspace">
      <aside id="thumbSidebar" class="sidebar">
        <div class="sidebar-header">
          <span>All Pages</span>
          <span id="thumbCount">0</span>
        </div>
        <div id="thumbGrid" class="thumb-grid"></div>
      </aside>
      <main class="stage-wrap">
        <button id="prevBtn" class="nav-arrow nav-prev" type="button" aria-label="Previous">&#8249;</button>
        <div id="stage" class="stage"></div>
        <button id="nextBtn" class="nav-arrow nav-next" type="button" aria-label="Next">&#8250;</button>
      </main>
    </div>
    <footer class="bottombar">
      <div class="pager">
        <span>Page</span>
        <input id="pageInput" type="number" min="1" value="1" />
        <span id="pageTotal">/ 1</span>
      </div>
      <input id="pageSlider" type="range" min="1" max="1" value="1" />
      <span class="hint">Keys: &larr; &rarr; navigate &middot; M spread &middot; +/- zoom &middot; F fullscreen</span>
    </footer>
  </div>
  <script src="book-data.js"></script>
  <script src="assets/viewer.js"></script>
</body>
</html>
`;
}

const OFFLINE_VIEWER_CSS = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1b1917; color: #f5f2eb; overflow: hidden; }
.reader-shell { display: flex; flex-direction: column; height: 100vh; }
.topbar, .bottombar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #24211e; border-bottom: 1px solid rgba(255,255,255,0.08); }
.bottombar { border-bottom: none; border-top: 1px solid rgba(255,255,255,0.08); }
.topbar-left, .topbar-controls, .pager { display: flex; align-items: center; gap: 8px; }
.book-title { margin: 0; font-size: 0.95rem; font-weight: 600; max-width: 44vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { background: #332f2b; color: #f5f2eb; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 6px 11px; font-size: 0.82rem; cursor: pointer; }
.icon-btn:hover { background: #443f39; }
.zoom-label { min-width: 46px; text-align: center; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.workspace { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 220px; background: #201d1a; border-right: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; transition: width 0.2s ease, opacity 0.2s ease; }
.sidebar.collapsed { width: 0; opacity: 0; overflow: hidden; border-right: none; }
.sidebar-header { display: flex; justify-content: space-between; padding: 10px 14px; font-size: 0.8rem; color: #c2bab0; border-bottom: 1px solid rgba(255,255,255,0.07); }
.thumb-grid { flex: 1; overflow-y: auto; padding: 10px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.thumb-item { background: #2c2824; border: 2px solid transparent; border-radius: 6px; padding: 4px; cursor: pointer; text-align: center; color: #d6cfc5; font-size: 0.72rem; }
.thumb-item.active { border-color: #d96b38; }
.thumb-item img { width: 100%; aspect-ratio: 3 / 4; object-fit: contain; background: #fff; border-radius: 3px; display: block; margin-bottom: 4px; }
.stage-wrap { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 20px 56px; }
.stage { display: flex; align-items: center; justify-content: center; gap: 4px; transform-origin: center center; transition: transform 0.15s ease; }
.page-frame { background: #fff; box-shadow: 0 18px 48px rgba(0,0,0,0.48); line-height: 0; }
.page-frame img { max-height: calc(100vh - 148px); max-width: 44vw; width: auto; height: auto; display: block; }
.stage.single .page-frame img { max-width: 82vw; }
.nav-arrow { position: fixed; top: 50%; transform: translateY(-50%); width: 42px; height: 64px; border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; background: rgba(36,33,30,0.82); color: #fff; font-size: 28px; cursor: pointer; z-index: 5; }
.nav-arrow:disabled { opacity: 0.25; cursor: not-allowed; }
.nav-prev { left: 12px; }
.nav-next { right: 12px; }
#pageInput { width: 60px; background: #332f2b; color: #fff; border: 1px solid rgba(255,255,255,0.14); border-radius: 5px; padding: 4px 6px; text-align: center; }
#pageSlider { flex: 1; accent-color: #d96b38; }
.hint { font-size: 0.76rem; color: #a89f95; white-space: nowrap; }
@media (max-width: 780px) { .sidebar { position: absolute; left: 0; top: 52px; bottom: 52px; z-index: 10; } .hint { display: none; } }`;

const OFFLINE_VIEWER_JS = `(function () {
  var book = window.__FLIPDOWN_BOOK__ || { title: 'FlipBook', pages: [] };
  var pages = book.pages || [];
  var currentIndex = 0;
  var spreadMode = window.innerWidth > 900 && pages.length > 1;
  var zoom = 1;
  var stage = document.getElementById('stage');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var modeBtn = document.getElementById('modeBtn');
  var zoomInBtn = document.getElementById('zoomInBtn');
  var zoomOutBtn = document.getElementById('zoomOutBtn');
  var zoomLabel = document.getElementById('zoomLabel');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var toggleThumbsBtn = document.getElementById('toggleThumbsBtn');
  var thumbSidebar = document.getElementById('thumbSidebar');
  var thumbGrid = document.getElementById('thumbGrid');
  var thumbCount = document.getElementById('thumbCount');
  var pageInput = document.getElementById('pageInput');
  var pageTotal = document.getElementById('pageTotal');
  var pageSlider = document.getElementById('pageSlider');
  if (window.innerWidth <= 900) thumbSidebar.classList.add('collapsed');
  thumbCount.textContent = String(pages.length);
  pageTotal.textContent = '/ ' + pages.length;
  pageInput.max = String(Math.max(1, pages.length));
  pageSlider.max = String(Math.max(1, pages.length));
  pages.forEach(function (entry, idx) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb-item';
    var img = document.createElement('img');
    img.src = entry.file;
    img.loading = 'lazy';
    img.alt = 'Page ' + entry.pageNumber;
    var label = document.createElement('span');
    label.textContent = 'Page ' + entry.pageNumber;
    btn.appendChild(img);
    btn.appendChild(label);
    btn.addEventListener('click', function () { currentIndex = idx; render(); });
    thumbGrid.appendChild(btn);
  });
  function render() {
    if (!pages.length) return;
    currentIndex = Math.max(0, Math.min(pages.length - 1, currentIndex));
    stage.innerHTML = '';
    stage.className = spreadMode ? 'stage spread' : 'stage single';
    stage.style.transform = 'scale(' + zoom.toFixed(2) + ')';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    modeBtn.textContent = spreadMode ? 'Single Page' : 'Spread View';
    var visible = [currentIndex];
    if (spreadMode && currentIndex > 0 && currentIndex + 1 < pages.length) visible.push(currentIndex + 1);
    visible.forEach(function (idx) {
      var frame = document.createElement('div');
      frame.className = 'page-frame';
      var img = document.createElement('img');
      img.src = pages[idx].file;
      img.alt = 'Page ' + pages[idx].pageNumber;
      frame.appendChild(img);
      stage.appendChild(frame);
    });
    pageInput.value = String(currentIndex + 1);
    pageSlider.value = String(currentIndex + 1);
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = visible[visible.length - 1] >= pages.length - 1;
    Array.prototype.forEach.call(thumbGrid.children, function (el, idx) {
      el.classList.toggle('active', visible.indexOf(idx) !== -1);
    });
  }
  function goPrev() {
    if (currentIndex <= 0) return;
    currentIndex = spreadMode ? Math.max(0, currentIndex - (currentIndex === 1 ? 1 : 2)) : currentIndex - 1;
    render();
  }
  function goNext() {
    if (currentIndex >= pages.length - 1) return;
    currentIndex = Math.min(pages.length - 1, currentIndex + (spreadMode && currentIndex > 0 ? 2 : 1));
    render();
  }
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  modeBtn.addEventListener('click', function () { spreadMode = !spreadMode; render(); });
  zoomInBtn.addEventListener('click', function () { zoom = Math.min(2.4, zoom + 0.15); render(); });
  zoomOutBtn.addEventListener('click', function () { zoom = Math.max(0.55, zoom - 0.15); render(); });
  toggleThumbsBtn.addEventListener('click', function () { thumbSidebar.classList.toggle('collapsed'); });
  fullscreenBtn.addEventListener('click', function () {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
    else document.exitFullscreen().catch(function () {});
  });
  pageInput.addEventListener('change', function () {
    var t = parseInt(pageInput.value, 10);
    if (!isNaN(t)) { currentIndex = Math.max(0, Math.min(pages.length - 1, t - 1)); render(); }
  });
  pageSlider.addEventListener('input', function () {
    currentIndex = Math.max(0, Math.min(pages.length - 1, parseInt(pageSlider.value, 10) - 1));
    render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
    else if (e.key === '+' || e.key === '=') { zoom = Math.min(2.4, zoom + 0.15); render(); }
    else if (e.key === '-') { zoom = Math.max(0.55, zoom - 0.15); render(); }
    else if (e.key.toLowerCase() === 'm') { spreadMode = !spreadMode; render(); }
    else if (e.key.toLowerCase() === 'f') fullscreenBtn.click();
  });
  render();
})();`;

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Compiles ordered page image blobs into either a PDF or standalone Offline HTML5 ZIP
 * completely inside the user's browser.
 */
export async function buildPackageFromRawPages(options: {
  pages: RawPageBytes[];
  title: string;
  sourceUrl?: string;
  format: OutputFormat;
  quality: QualityPreset;
  onProgress: (fraction: number, label: string) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; filename: string; size: number }> {
  const { pages, title, sourceUrl, format, quality, onProgress, signal } = options;
  if (pages.length === 0) {
    throw new Error('Tidak ada halaman yang berhasil diambil untuk diproses.');
  }

  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const baseName = sanitizeBaseName(title);

  if (format === 'pdf') {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(title);
    if (sourceUrl) pdfDoc.setSubject(`Archived from ${sourceUrl}`);
    pdfDoc.setCreator('FlipDown — FlipHTML5 Downloader');
    pdfDoc.setCreationDate(new Date());

    for (let i = 0; i < ordered.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onProgress(
        (i + 0.5) / ordered.length,
        `Menyusun halaman PDF ${i + 1} / ${ordered.length}...`,
      );
      const blob = new Blob([new Uint8Array(ordered[i].bytes)], {
        type: ordered[i].mimeType,
      });
      const { bytes, width, height } = await normalizeBlobToJpeg(blob, quality);
      const embedded = await pdfDoc.embedJpg(bytes);
      const maxDim = 1200;
      const scale =
        Math.max(width, height) > maxDim ? maxDim / Math.max(width, height) : 1;
      const pdfWidth = Math.max(72, Math.round(width * scale * 100) / 100);
      const pdfHeight = Math.max(72, Math.round(height * scale * 100) / 100);
      const page = pdfDoc.addPage([pdfWidth, pdfHeight]);
      page.drawImage(embedded, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
      ordered[i].bytes = new Uint8Array(0);
      if ((i + 1) % 4 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress(0.96, 'Menyelesaikan file PDF...');
    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    const filename = `${baseName}.pdf`;
    return { blob, filename, size: blob.size };
  }

  const zip = new JSZip();
  const manifestPages: Array<{
    pageNumber: number;
    file: string;
    width: number;
    height: number;
  }> = [];

  for (let i = 0; i < ordered.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress(
      ((i + 0.5) / ordered.length) * 0.85,
      `Mengemas halaman HTML5 ${i + 1} / ${ordered.length}...`,
    );
    const blob = new Blob([new Uint8Array(ordered[i].bytes)], {
      type: ordered[i].mimeType,
    });
    const { bytes, width, height } = await normalizeBlobToJpeg(blob, quality);
    const padded = String(ordered[i].pageNumber).padStart(4, '0');
    const relPath = `pages/page-${padded}.jpg`;
    zip.file(relPath, bytes);
    ordered[i].bytes = new Uint8Array(0);
    manifestPages.push({
      pageNumber: ordered[i].pageNumber,
      file: relPath,
      width,
      height,
    });
    if ((i + 1) % 4 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const manifest = {
    title,
    sourceUrl: sourceUrl ?? null,
    generatedAt: new Date().toISOString(),
    generator: 'FlipDown — FlipHTML5 Downloader',
    totalPages: manifestPages.length,
    pages: manifestPages,
  };

  zip.file('index.html', buildOfflineHtml(title));
  zip.file('assets/viewer.css', OFFLINE_VIEWER_CSS);
  zip.file('assets/viewer.js', OFFLINE_VIEWER_JS);
  zip.file('metadata.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'book-data.js',
    `window.__FLIPDOWN_BOOK__ = ${JSON.stringify(manifest)};\n`,
  );

  onProgress(0.92, 'Mengompresi paket Offline HTML5 (.zip)...');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const filename = `${baseName}-offline-html5.zip`;
  return { blob, filename, size: blob.size };
}

/**
 * Generates a PDF or standalone Offline HTML5 ZIP from user-selected local image files.
 */
export async function buildClientPackage(options: {
  pages: LocalPageItem[];
  title: string;
  format: OutputFormat;
  quality: QualityPreset;
  onProgress: (percent: number, label: string) => void;
}): Promise<{ filename: string; size: number }> {
  const { pages, title, format, quality, onProgress } = options;
  if (pages.length === 0) {
    throw new Error('Pilih minimal satu gambar halaman terlebih dahulu.');
  }

  const rawPages: RawPageBytes[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const arr = new Uint8Array(await pages[i].file.arrayBuffer());
    rawPages.push({
      pageNumber: i + 1,
      bytes: arr,
      mimeType: pages[i].file.type || 'image/jpeg',
    });
  }

  const result = await buildPackageFromRawPages({
    pages: rawPages,
    title,
    format,
    quality,
    onProgress: (fraction, label) =>
      onProgress(Math.min(99, Math.round(fraction * 100)), label),
  });

  triggerBrowserDownload(result.blob, result.filename);
  onProgress(
    100,
    format === 'pdf'
      ? 'PDF berhasil diunduh ke perangkat Anda.'
      : 'Paket Offline HTML5 ZIP berhasil diunduh ke perangkat Anda.',
  );
  return { filename: result.filename, size: result.size };
}
