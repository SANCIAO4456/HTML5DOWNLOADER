import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import type { QualityPreset } from '../db/database.js';
import { normalizePageImage, type PageImageInput } from './pdfBuilder.js';

export interface Html5BundleOptions {
  title: string;
  sourceUrl: string;
  quality: QualityPreset;
  outputPath: string;
  onProgress?: (completed: number, total: number) => void;
}

interface OfflinePageEntry {
  pageNumber: number;
  file: string;
  width: number;
  height: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildOfflineReaderHtml(title: string): string {
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
        <button id="toggleThumbsBtn" class="icon-btn" type="button" title="Toggle thumbnails (T)">Pages</button>
        <h1 class="book-title" id="bookTitle">${safeTitle}</h1>
      </div>
      <div class="topbar-controls">
        <button id="modeBtn" class="icon-btn" type="button" title="Switch single / spread view (M)">Spread View</button>
        <button id="zoomOutBtn" class="icon-btn" type="button" title="Zoom out (-)">-</button>
        <span id="zoomLabel" class="zoom-label">100%</span>
        <button id="zoomInBtn" class="icon-btn" type="button" title="Zoom in (+)">+</button>
        <button id="fullscreenBtn" class="icon-btn" type="button" title="Fullscreen (F)">Fullscreen</button>
      </div>
    </header>

    <div class="workspace">
      <aside id="thumbSidebar" class="sidebar" aria-label="Page thumbnails">
        <div class="sidebar-header">
          <span>All Pages</span>
          <span id="thumbCount">0</span>
        </div>
        <div id="thumbGrid" class="thumb-grid"></div>
      </aside>

      <main class="stage-wrap">
        <button id="prevBtn" class="nav-arrow nav-prev" type="button" aria-label="Previous page">&#8249;</button>
        <div id="stage" class="stage"></div>
        <button id="nextBtn" class="nav-arrow nav-next" type="button" aria-label="Next page">&#8250;</button>
      </main>
    </div>

    <footer class="bottombar">
      <div class="pager">
        <span>Page</span>
        <input id="pageInput" type="number" min="1" value="1" aria-label="Current page number" />
        <span id="pageTotal">/ 1</span>
      </div>
      <input id="pageSlider" type="range" min="1" max="1" value="1" aria-label="Page scrubber" />
      <span class="hint">Keys: &larr; &rarr; navigate &middot; M spread &middot; +/- zoom &middot; F fullscreen</span>
    </footer>
  </div>

  <script src="book-data.js"></script>
  <script src="assets/viewer.js"></script>
</body>
</html>
`;
}

function buildOfflineReaderCss(): string {
  return `*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1b1917;
  color: #f5f2eb;
  overflow: hidden;
}
.reader-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.topbar, .bottombar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #24211e;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.bottombar {
  border-bottom: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.topbar-left, .topbar-controls, .pager {
  display: flex;
  align-items: center;
  gap: 8px;
}
.book-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  max-width: 44vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-btn {
  background: #332f2b;
  color: #f5f2eb;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 11px;
  font-size: 0.82rem;
  cursor: pointer;
}
.icon-btn:hover { background: #443f39; }
.zoom-label {
  min-width: 46px;
  text-align: center;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 220px;
  background: #201d1a;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease, opacity 0.2s ease;
}
.sidebar.collapsed {
  width: 0;
  opacity: 0;
  overflow: hidden;
  border-right: none;
}
.sidebar-header {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 0.8rem;
  color: #c2bab0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.thumb-grid {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.thumb-item {
  background: #2c2824;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 4px;
  cursor: pointer;
  text-align: center;
  color: #d6cfc5;
  font-size: 0.72rem;
}
.thumb-item.active { border-color: #d96b38; }
.thumb-item img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: contain;
  background: #fff;
  border-radius: 3px;
  display: block;
  margin-bottom: 4px;
}
.stage-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 20px 56px;
}
.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transform-origin: center center;
  transition: transform 0.15s ease;
}
.page-frame {
  background: #fff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
  line-height: 0;
}
.page-frame img {
  max-height: calc(100vh - 148px);
  max-width: 44vw;
  width: auto;
  height: auto;
  display: block;
}
.stage.single .page-frame img {
  max-width: 82vw;
}
.nav-arrow {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  height: 64px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(36, 33, 30, 0.82);
  color: #fff;
  font-size: 28px;
  cursor: pointer;
  z-index: 5;
}
.nav-arrow:hover { background: rgba(68, 63, 57, 0.96); }
.nav-arrow:disabled { opacity: 0.25; cursor: not-allowed; }
.nav-prev { left: 12px; }
.nav-next { right: 12px; }
#pageInput {
  width: 60px;
  background: #332f2b;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  padding: 4px 6px;
  text-align: center;
}
#pageSlider { flex: 1; accent-color: #d96b38; }
.hint { font-size: 0.76rem; color: #a89f95; white-space: nowrap; }
@media (max-width: 780px) {
  .sidebar { position: absolute; left: 0; top: 52px; bottom: 52px; z-index: 10; }
  .hint { display: none; }
}
`;
}

function buildOfflineReaderJs(): string {
  return `(function () {
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

  if (window.innerWidth <= 900) {
    thumbSidebar.classList.add('collapsed');
  }

  thumbCount.textContent = String(pages.length);
  pageTotal.textContent = '/ ' + pages.length;
  pageInput.max = String(Math.max(1, pages.length));
  pageSlider.max = String(Math.max(1, pages.length));

  function buildThumbnails() {
    thumbGrid.innerHTML = '';
    pages.forEach(function (entry, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb-item';
      btn.dataset.index = String(idx);
      var img = document.createElement('img');
      img.src = entry.file;
      img.loading = 'lazy';
      img.alt = 'Page ' + entry.pageNumber;
      var label = document.createElement('span');
      label.textContent = 'Page ' + entry.pageNumber;
      btn.appendChild(img);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        currentIndex = idx;
        render();
      });
      thumbGrid.appendChild(btn);
    });
  }

  function stepSize() {
    return spreadMode && currentIndex > 0 ? 2 : 1;
  }

  function render() {
    if (!pages.length) return;
    currentIndex = Math.max(0, Math.min(pages.length - 1, currentIndex));
    stage.innerHTML = '';
    stage.className = spreadMode ? 'stage spread' : 'stage single';
    stage.style.transform = 'scale(' + zoom.toFixed(2) + ')';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    modeBtn.textContent = spreadMode ? 'Single Page' : 'Spread View';

    var visibleIndices = [currentIndex];
    if (spreadMode && currentIndex > 0 && currentIndex + 1 < pages.length) {
      visibleIndices.push(currentIndex + 1);
    }

    visibleIndices.forEach(function (idx) {
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
    nextBtn.disabled = visibleIndices[visibleIndices.length - 1] >= pages.length - 1;

    Array.prototype.forEach.call(thumbGrid.children, function (el, idx) {
      el.classList.toggle('active', visibleIndices.indexOf(idx) !== -1);
    });
  }

  function goPrev() {
    if (currentIndex <= 0) return;
    currentIndex = spreadMode ? Math.max(0, currentIndex - (currentIndex === 1 ? 1 : 2)) : currentIndex - 1;
    render();
  }

  function goNext() {
    if (currentIndex >= pages.length - 1) return;
    currentIndex = Math.min(pages.length - 1, currentIndex + stepSize());
    render();
  }

  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  modeBtn.addEventListener('click', function () {
    spreadMode = !spreadMode;
    render();
  });
  zoomInBtn.addEventListener('click', function () {
    zoom = Math.min(2.4, zoom + 0.15);
    render();
  });
  zoomOutBtn.addEventListener('click', function () {
    zoom = Math.max(0.55, zoom - 0.15);
    render();
  });
  toggleThumbsBtn.addEventListener('click', function () {
    thumbSidebar.classList.toggle('collapsed');
  });
  fullscreenBtn.addEventListener('click', function () {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen().catch(function () {});
    }
  });
  pageInput.addEventListener('change', function () {
    var target = parseInt(pageInput.value, 10);
    if (!isNaN(target)) {
      currentIndex = Math.max(0, Math.min(pages.length - 1, target - 1));
      render();
    }
  });
  pageSlider.addEventListener('input', function () {
    currentIndex = Math.max(0, Math.min(pages.length - 1, parseInt(pageSlider.value, 10) - 1));
    render();
  });

  document.addEventListener('keydown', function (event) {
    if (event.target && event.target.tagName === 'INPUT') return;
    if (event.key === 'ArrowLeft') goPrev();
    else if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      goNext();
    } else if (event.key === '+' || event.key === '=') {
      zoom = Math.min(2.4, zoom + 0.15);
      render();
    } else if (event.key === '-') {
      zoom = Math.max(0.55, zoom - 0.15);
      render();
    } else if (event.key.toLowerCase() === 'm') {
      spreadMode = !spreadMode;
      render();
    } else if (event.key.toLowerCase() === 't') {
      thumbSidebar.classList.toggle('collapsed');
    } else if (event.key.toLowerCase() === 'f') {
      fullscreenBtn.click();
    }
  });

  buildThumbnails();
  render();
})();
`;
}

/**
 * Bundles downloaded flipbook pages into a standalone offline HTML5 viewer ZIP archive.
 * Opening `index.html` works directly via `file://` without requiring a local web server.
 */
export async function buildOfflineHtml5Zip(
  pages: PageImageInput[],
  options: Html5BundleOptions,
): Promise<{ outputPath: string; fileSize: number }> {
  if (pages.length === 0) {
    throw new Error('Cannot generate offline HTML5 archive with zero pages.');
  }

  const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  await fsPromises.mkdir(path.dirname(options.outputPath), { recursive: true });

  const normalizedEntries: Array<{ entry: OfflinePageEntry; buffer: Buffer }> = [];
  for (let i = 0; i < orderedPages.length; i += 1) {
    const page = orderedPages[i];
    const { jpegBuffer, width, height } = await normalizePageImage(
      page.buffer,
      options.quality,
    );
    const padded = String(page.pageNumber).padStart(4, '0');
    normalizedEntries.push({
      entry: {
        pageNumber: page.pageNumber,
        file: `pages/page-${padded}.jpg`,
        width,
        height,
      },
      buffer: jpegBuffer,
    });
    options.onProgress?.(i + 1, orderedPages.length);
  }

  const manifest = {
    title: options.title,
    sourceUrl: options.sourceUrl,
    generatedAt: new Date().toISOString(),
    generator: 'FlipDown — FlipHTML5 Downloader',
    totalPages: normalizedEntries.length,
    pages: normalizedEntries.map((item) => item.entry),
  };

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(options.outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);

    archive.append(buildOfflineReaderHtml(options.title), { name: 'index.html' });
    archive.append(buildOfflineReaderCss(), { name: 'assets/viewer.css' });
    archive.append(buildOfflineReaderJs(), { name: 'assets/viewer.js' });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'metadata.json' });
    archive.append(
      `window.__FLIPDOWN_BOOK__ = ${JSON.stringify(manifest)};\n`,
      { name: 'book-data.js' },
    );

    for (const item of normalizedEntries) {
      archive.append(item.buffer, { name: item.entry.file });
    }

    void archive.finalize();
  });

  const stats = await fsPromises.stat(options.outputPath);
  return {
    outputPath: options.outputPath,
    fileSize: stats.size,
  };
}
