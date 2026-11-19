import type { OutputFormat, QualityPreset } from '../types';
import {
  buildPackageFromRawPages,
  triggerBrowserDownload,
  type RawPageBytes,
} from './clientBundler';

export interface BrowserPageEntry {
  pageNumber: number;
  candidates: string[];
  thumbUrl: string | null;
}

export interface BrowserBookMetadata {
  url: string;
  baseUrl: string;
  bookSlug: string;
  title: string;
  description: string | null;
  totalPages: number;
  pageWidth: number | null;
  pageHeight: number | null;
  coverUrl: string | null;
  pages: BrowserPageEntry[];
}

export interface BrowserDownloadProgress {
  phase: 'fetching_meta' | 'downloading' | 'packaging' | 'completed';
  progress: number;
  label: string;
  downloadedPages: number;
  selectedPages: number;
  totalPages: number;
  title?: string;
}

export interface BrowserDownloadResult {
  url: string;
  bookSlug: string;
  title: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  totalPages: number;
  selectedPages: number;
  filename: string;
  fileSize: number;
  blobUrl: string;
}

interface NormalizedUrl {
  normalizedUrl: string;
  baseUrl: string;
  account: string;
  bookId: string;
  slug: string;
}

type RelayFn = (targetUrl: string) => string;

const CORS_RELAYS: Array<{ name: string; build: RelayFn }> = [
  {
    name: 'codetabs',
    build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  },
  {
    name: 'allorigins',
    build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
  {
    name: 'corsproxy',
    build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  },
  {
    name: 'corslol',
    build: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  },
];

// Remembers the fastest working fetch route ('direct' or relay index) for this session
let preferredRoute: 'direct' | number | null = null;

function isAllowedFlipHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === 'fliphtml5.com' || host.endsWith('.fliphtml5.com');
}

export function normalizeFlipHtml5Url(rawInput: string): NormalizedUrl {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Masukkan link FlipHTML5 terlebih dahulu.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error(
      'Format link tidak valid. Contoh: https://online.fliphtml5.com/account/book/',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Hanya mendukung link HTTP/HTTPS FlipHTML5.');
  }

  if (!isAllowedFlipHost(parsed.hostname)) {
    throw new Error(
      `Domain "${parsed.hostname}" bukan FlipHTML5. Gunakan link fliphtml5.com atau online.fliphtml5.com.`,
    );
  }

  const segments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(
      (s) =>
        !/^index\.html?$/i.test(s) &&
        s.toLowerCase() !== 'mobile' &&
        s.toLowerCase() !== 'basic',
    );

  if (segments.length < 2 || segments[0].toLowerCase() === 'bookcase') {
    throw new Error(
      'Link harus mengarah langsung ke buku FlipHTML5 (contoh: https://online.fliphtml5.com/abcd/efgh/).',
    );
  }

  const [account, bookId] = segments;
  if (!/^[a-zA-Z0-9._-]+$/.test(account) || !/^[a-zA-Z0-9._-]+$/.test(bookId)) {
    throw new Error('Link FlipHTML5 mengandung karakter path yang tidak valid.');
  }

  const baseUrl = `https://online.fliphtml5.com/${account}/${bookId}/`;
  return {
    normalizedUrl: baseUrl,
    baseUrl,
    account,
    bookId,
    slug: `${account}-${bookId}`,
  };
}

export function parsePageRange(
  rawInput: string | undefined,
  totalPages: number,
): number[] {
  const trimmed = (rawInput ?? '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === '*' || trimmed === 'semua') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pageSet = new Set<number>();
  const tokens = trimmed
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.includes('-')) {
      const [sRaw, eRaw] = token.split('-').map((v) => v.trim());
      const start = Number(sRaw);
      const end = Number(eRaw);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        start > end ||
        end > totalPages
      ) {
        throw new Error(
          `Rentang halaman "${token}" tidak valid (total buku: ${totalPages} halaman).`,
        );
      }
      for (let p = start; p <= end; p += 1) pageSet.add(p);
    } else {
      const p = Number(token);
      if (!Number.isInteger(p) || p < 1 || p > totalPages) {
        throw new Error(
          `Nomor halaman "${token}" di luar batas (1 - ${totalPages}).`,
        );
      }
      pageSet.add(p);
    }
  }

  if (pageSet.size === 0) {
    throw new Error('Tidak ada halaman yang dipilih.');
  }

  return Array.from(pageSet).sort((a, b) => a - b);
}

function resolveAssetUrl(assetPath: string, baseUrl: string): string | null {
  const cleaned = assetPath.trim();
  if (!cleaned) return null;
  try {
    const resolved = cleaned.startsWith('//')
      ? new URL(`https:${cleaned}`)
      : new URL(cleaned.replace(/^\.\//, ''), baseUrl);
    if (
      (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
      !isAllowedFlipHost(resolved.hostname)
    ) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  if (riff === 'GIF8') return 'image/gif';
  return null;
}

function extractBalancedJson(source: string, startIndex: number): string | null {
  const open = source.indexOf('{', startIndex);
  if (open === -1) return null;

  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function parsePositiveInt(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.round(val);
  }
  if (typeof val === 'string' && val.trim()) {
    const n = Number.parseInt(val.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function buildFallbackCandidates(
  pageNumber: number,
  baseUrl: string,
  largePath?: string,
  normalPath?: string,
): string[] {
  const out: string[] = [];
  const push = (rel: string) => {
    const resolved = resolveAssetUrl(rel, baseUrl);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  };

  if (largePath) {
    const p = largePath.endsWith('/') ? largePath : `${largePath}/`;
    push(`${p}${pageNumber}.webp`);
    push(`${p}${pageNumber}.jpg`);
    push(`${p}${pageNumber}.png`);
  }
  if (normalPath) {
    const p = normalPath.endsWith('/') ? normalPath : `${normalPath}/`;
    push(`${p}${pageNumber}.webp`);
    push(`${p}${pageNumber}.jpg`);
  }

  push(`files/large/${pageNumber}.webp`);
  push(`files/large/${pageNumber}.jpg`);
  push(`files/page/${pageNumber}.webp`);
  push(`files/page/${pageNumber}.jpg`);
  push(`files/mobile/${pageNumber}.webp`);
  push(`files/mobile/${pageNumber}.jpg`);
  push(`files/large/${pageNumber}.png`);
  return out;
}

interface RawPageItem {
  n?: string[] | string;
  t?: string;
}

interface RawConfig {
  meta?: { title?: string; description?: string };
  bookConfig?: {
    bookTitle?: string;
    totalPageCount?: number | string;
    pageCount?: number | string;
    pageWidth?: number | string;
    pageHeight?: number | string;
    largePath?: string;
    normalPath?: string;
    fliphtml5_pages?: RawPageItem[];
  };
  fliphtml5_pages?: RawPageItem[];
}

function parseConfigText(
  scriptText: string,
  normalized: NormalizedUrl,
): BrowserBookMetadata | null {
  const marker = scriptText.search(/(?:var|let|const|window\.)\s*htmlConfig\s*=/);
  let parsed: RawConfig | null = null;
  if (marker !== -1) {
    const jsonStr = extractBalancedJson(scriptText, marker);
    if (jsonStr) {
      try {
        parsed = JSON.parse(jsonStr) as RawConfig;
      } catch {
        parsed = null;
      }
    }
  }

  let rawPages: RawPageItem[] =
    parsed?.fliphtml5_pages ?? parsed?.bookConfig?.fliphtml5_pages ?? [];
  if (rawPages.length === 0) {
    const m = scriptText.match(/fliphtml5_pages\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (m?.[1]) {
      try {
        const arr = JSON.parse(m[1]);
        if (Array.isArray(arr)) rawPages = arr as RawPageItem[];
      } catch {
        // Ignore malformed array
      }
    }
  }

  const bookConfig = parsed?.bookConfig;
  const meta = parsed?.meta;
  const totalPages =
    rawPages.length ||
    parsePositiveInt(bookConfig?.totalPageCount) ||
    parsePositiveInt(bookConfig?.pageCount) ||
    parsePositiveInt(
      scriptText.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/)?.[1],
    );

  if (!totalPages) return null;

  const titleMatch = scriptText.match(/["']?bookTitle["']?\s*[:=]\s*"([^"]+)"/);
  const title = (
    bookConfig?.bookTitle ||
    meta?.title ||
    titleMatch?.[1] ||
    normalized.slug
  ).trim();
  const description = meta?.description?.trim() || null;
  const pageWidth = parsePositiveInt(bookConfig?.pageWidth);
  const pageHeight = parsePositiveInt(bookConfig?.pageHeight);

  const pages: BrowserPageEntry[] = [];
  for (let i = 0; i < totalPages; i += 1) {
    const pageNumber = i + 1;
    const item = rawPages[i];
    const candidates: string[] = [];

    const addAsset = (rawAsset: string) => {
      const hasDir = rawAsset.includes('/') || /^https?:\/\//i.test(rawAsset);
      const variants = hasDir
        ? [rawAsset]
        : [
            `files/large/${rawAsset}`,
            `files/page/${rawAsset}`,
            `files/mobile/${rawAsset}`,
            rawAsset,
          ];
      for (const variant of variants) {
        const resolved = resolveAssetUrl(variant, normalized.baseUrl);
        if (resolved && !candidates.includes(resolved)) candidates.push(resolved);
      }
    };

    if (item?.n) {
      const list = Array.isArray(item.n) ? item.n : [item.n];
      list.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) addAsset(entry);
      });
    }

    buildFallbackCandidates(
      pageNumber,
      normalized.baseUrl,
      bookConfig?.largePath,
      bookConfig?.normalPath,
    ).forEach((c) => {
      if (!candidates.includes(c)) candidates.push(c);
    });

    let thumbUrl: string | null = null;
    if (typeof item?.t === 'string' && item.t.trim()) {
      const rel =
        item.t.includes('/') || /^https?:\/\//i.test(item.t)
          ? item.t
          : `files/thumb/${item.t}`;
      thumbUrl = resolveAssetUrl(rel, normalized.baseUrl);
    }
    if (!thumbUrl) thumbUrl = candidates[0] ?? null;

    pages.push({ pageNumber, candidates, thumbUrl });
  }

  return {
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,
    bookSlug: normalized.slug,
    title,
    description,
    totalPages,
    pageWidth,
    pageHeight,
    coverUrl: pages[0]?.thumbUrl ?? pages[0]?.candidates[0] ?? null,
    pages,
  };
}

function parseHtmlText(
  html: string,
  normalized: NormalizedUrl,
): BrowserBookMetadata | null {
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const ogDesc = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  const ogImage = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];

  const htmlTitle = (ogTitle || titleTag || '')
    .replace(/\s*[-|]\s*FlipHTML5\s*$/i, '')
    .trim();
  const resolvedOgImg = ogImage
    ? resolveAssetUrl(ogImage, normalized.baseUrl)
    : null;

  const inline = parseConfigText(html, normalized);
  if (inline) {
    return {
      ...inline,
      title:
        inline.title === normalized.slug && htmlTitle ? htmlTitle : inline.title,
      description: inline.description ?? (ogDesc?.trim() || null),
      coverUrl: inline.coverUrl ?? resolvedOgImg,
    };
  }

  const totalPages = parsePositiveInt(
    html.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ??
      html.match(/["']?pageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1],
  );
  if (!totalPages) return null;

  const pages: BrowserPageEntry[] = Array.from({ length: totalPages }, (_, i) => {
    const pageNumber = i + 1;
    const candidates = buildFallbackCandidates(pageNumber, normalized.baseUrl);
    return { pageNumber, candidates, thumbUrl: candidates[0] ?? null };
  });

  return {
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,
    bookSlug: normalized.slug,
    title: htmlTitle || normalized.slug,
    description: ogDesc?.trim() || null,
    totalPages,
    pageWidth: null,
    pageHeight: null,
    coverUrl: resolvedOgImg ?? pages[0]?.candidates[0] ?? null,
    pages,
  };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetches a public FlipHTML5 resource directly from the browser, seamlessly
 * falling back to read-only public CORS relays if the browser blocks cross-origin reads.
 */
async function smartFetch(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<Response> {
  const order: Array<'direct' | number> = [];
  if (preferredRoute !== null) order.push(preferredRoute);
  if (preferredRoute !== 'direct') order.push('direct');
  for (let i = 0; i < CORS_RELAYS.length; i += 1) {
    if (preferredRoute !== i) order.push(i);
  }

  let lastResponse: Response | null = null;

  for (const route of order) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url =
      route === 'direct' ? targetUrl : CORS_RELAYS[route].build(targetUrl);
    try {
      const response = await fetchWithTimeout(url, 18000, signal);
      if (response.ok) {
        preferredRoute = route;
        return response;
      }
      if (response.status === 404 || response.status === 403 || response.status === 401) {
        lastResponse = response;
        if (route === 'direct') {
          // Real upstream HTTP status without CORS error
          preferredRoute = 'direct';
          return response;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && signal?.aborted) {
        throw error;
      }
      // CORS error or relay unavailable -> continue trying next route
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(
    'Gagal mengambil data dari FlipHTML5 langsung di browser. Pastikan link bersifat publik dan koneksi internet stabil.',
  );
}

export async function inspectBookInBrowser(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<BrowserBookMetadata> {
  const normalized = normalizeFlipHtml5Url(rawUrl);

  const configUrls = [
    `${normalized.baseUrl}mobile/javascript/config.js`,
    `${normalized.baseUrl}javascript/config.js`,
  ];

  for (const configUrl of configUrls) {
    try {
      const res = await smartFetch(configUrl, signal);
      if (res.ok) {
        const text = await res.text();
        const meta = parseConfigText(text, normalized);
        if (meta) return meta;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }

  const htmlRes = await smartFetch(normalized.baseUrl, signal);
  if (htmlRes.status === 404) {
    throw new Error('Buku FlipHTML5 tidak ditemukan (404). Cek kembali link-nya.');
  }
  if (htmlRes.status === 401 || htmlRes.status === 403) {
    throw new Error('Buku FlipHTML5 ini bersifat privat atau dilindungi kata sandi.');
  }
  if (!htmlRes.ok) {
    throw new Error(`FlipHTML5 merespons dengan status HTTP ${htmlRes.status}.`);
  }

  const html = await htmlRes.text();
  const parsed = parseHtmlText(html, normalized);
  if (!parsed) {
    throw new Error(
      'Struktur halaman buku FlipHTML5 tidak dapat dibaca. Pastikan publikasi bersifat publik.',
    );
  }
  return parsed;
}

async function fetchPageBytes(
  entry: BrowserPageEntry,
  signal?: AbortSignal,
): Promise<RawPageBytes> {
  let lastReason = 'Tidak ada kandidat URL gambar.';

  for (const candidateUrl of entry.candidates) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const response = await smartFetch(candidateUrl, signal);
      if (!response.ok) {
        lastReason = `HTTP ${response.status}`;
        continue;
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const mimeType = detectImageMime(bytes);
      if (mimeType) {
        return { pageNumber: entry.pageNumber, bytes, mimeType };
      }
      lastReason = 'Respons bukan file gambar yang valid.';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Gagal mengunduh halaman ${entry.pageNumber} (${lastReason}).`);
}

export function getDisplayImageUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  if (preferredRoute !== null && preferredRoute !== 'direct') {
    return CORS_RELAYS[preferredRoute].build(rawUrl);
  }
  return rawUrl;
}

/**
 * Full zero-API 1-click flow:
 * Paste FlipHTML5 URL -> inspect -> download pages -> build PDF or Offline HTML5 ZIP -> auto-save!
 */
export async function downloadFlipBookDirectly(options: {
  url: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  customTitle?: string;
  prefetchedBook?: BrowserBookMetadata | null;
  onProgress: (state: BrowserDownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<BrowserDownloadResult> {
  const {
    url,
    format,
    quality,
    pageRange,
    customTitle,
    prefetchedBook,
    onProgress,
    signal,
  } = options;

  onProgress({
    phase: 'fetching_meta',
    progress: 5,
    label: 'Membaca informasi buku FlipHTML5...',
    downloadedPages: 0,
    selectedPages: 0,
    totalPages: prefetchedBook?.totalPages ?? 0,
    title: customTitle || prefetchedBook?.title,
  });

  const book = prefetchedBook ?? (await inspectBookInBrowser(url, signal));
  const selectedNumbers = parsePageRange(pageRange, book.totalPages);
  const finalTitle = customTitle?.trim() || book.title;

  onProgress({
    phase: 'downloading',
    progress: 10,
    label: `Mengunduh 0 / ${selectedNumbers.length} halaman...`,
    downloadedPages: 0,
    selectedPages: selectedNumbers.length,
    totalPages: book.totalPages,
    title: finalTitle,
  });

  const entries = selectedNumbers
    .map((n) => book.pages[n - 1])
    .filter((entry): entry is BrowserPageEntry => Boolean(entry));

  const downloaded: RawPageBytes[] = [];
  let cursor = 0;
  let doneCount = 0;
  const workerCount = Math.min(4, entries.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const idx = cursor;
      cursor += 1;
      if (idx >= entries.length) break;

      const pageBytes = await fetchPageBytes(entries[idx], signal);
      downloaded.push(pageBytes);
      doneCount += 1;

      const pct = Math.min(
        78,
        10 + Math.round((doneCount / entries.length) * 68),
      );
      onProgress({
        phase: 'downloading',
        progress: pct,
        label: `Mengunduh halaman ${doneCount} / ${entries.length}...`,
        downloadedPages: doneCount,
        selectedPages: entries.length,
        totalPages: book.totalPages,
        title: finalTitle,
      });
    }
  });

  await Promise.all(workers);

  onProgress({
    phase: 'packaging',
    progress: 80,
    label:
      format === 'pdf'
        ? 'Menyusun dokumen PDF...'
        : 'Mengemas paket Offline HTML5 (.zip)...',
    downloadedPages: doneCount,
    selectedPages: entries.length,
    totalPages: book.totalPages,
    title: finalTitle,
  });

  const built = await buildPackageFromRawPages({
    pages: downloaded,
    title: finalTitle,
    sourceUrl: book.url,
    format,
    quality,
    signal,
    onProgress: (fraction, label) => {
      const pct = Math.min(99, 80 + Math.round(fraction * 19));
      onProgress({
        phase: 'packaging',
        progress: pct,
        label,
        downloadedPages: doneCount,
        selectedPages: entries.length,
        totalPages: book.totalPages,
        title: finalTitle,
      });
    },
  });

  triggerBrowserDownload(built.blob, built.filename);
  const blobUrl = URL.createObjectURL(built.blob);

  onProgress({
    phase: 'completed',
    progress: 100,
    label: `Selesai! ${built.filename} langsung terunduh.`,
    downloadedPages: doneCount,
    selectedPages: entries.length,
    totalPages: book.totalPages,
    title: finalTitle,
  });

  return {
    url: book.url,
    bookSlug: book.bookSlug,
    title: finalTitle,
    format,
    quality,
    pageRange:
      selectedNumbers.length === book.totalPages
        ? 'all'
        : pageRange.trim() || 'all',
    totalPages: book.totalPages,
    selectedPages: selectedNumbers.length,
    filename: built.filename,
    fileSize: built.size,
    blobUrl,
  };
}
