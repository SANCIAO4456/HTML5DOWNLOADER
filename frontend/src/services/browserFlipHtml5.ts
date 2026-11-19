import JSZip from 'jszip';
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
  skippedPages: number;
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

interface DeStringWindow extends Window {
  allocateUTF8?: (str: string) => number;
  UTF8ToString?: (ptr: number) => string;
  Module?: {
    calledRun?: boolean;
    runtimeInitialized?: boolean;
    _DeString?: (ptr: number) => number;
    _free?: (ptr: number) => void;
    allocateUTF8?: (str: string) => number;
    UTF8ToString?: (ptr: number) => string;
  };
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
    name: 'corslol',
    build: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  },
  {
    name: 'corsproxy',
    build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  },
];

// Remembers the fastest working fetch route ('direct' or relay index) for this session
let preferredRoute: 'direct' | number | null = null;
let deStringReadyPromise: Promise<boolean> | null = null;

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

/**
 * Resolves a FlipHTML5 asset path safely against the book's baseUrl,
 * normalizing leading `./` and `../` segments from config.js.
 */
function resolveAssetUrl(assetPath: string, baseUrl: string): string | null {
  const cleaned = assetPath.trim();
  if (!cleaned) return null;
  try {
    let resolved: URL;
    if (/^https?:\/\//i.test(cleaned)) {
      resolved = new URL(cleaned);
    } else if (cleaned.startsWith('//')) {
      resolved = new URL(`https:${cleaned}`);
    } else {
      const normalizedRel = cleaned.replace(/^(?:\.\.\/|\.\/|\/)+/, '');
      resolved = new URL(normalizedRel, baseUrl);
    }
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

function isZipBuffer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function loadScriptTag(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function getDeStringHandles(): {
  allocateUTF8: (str: string) => number;
  deString: (ptr: number) => number;
  utf8ToString: (ptr: number) => string;
  free?: (ptr: number) => void;
} | null {
  const win = window as DeStringWindow;
  const mod = win.Module;
  // Critical: Emscripten exports _DeString & allocateUTF8 BEFORE WASM runtime initializes.
  // Calling allocateUTF8 before `calledRun` is true throws "malloc called before runtime initialization".
  if (!mod || !mod.calledRun) {
    return null;
  }

  const allocateUTF8 = win.allocateUTF8 ?? mod.allocateUTF8;
  const utf8ToString = win.UTF8ToString ?? mod.UTF8ToString;
  const deString = mod._DeString;
  if (
    typeof allocateUTF8 === 'function' &&
    typeof utf8ToString === 'function' &&
    typeof deString === 'function'
  ) {
    return {
      allocateUTF8,
      deString,
      utf8ToString,
      free: typeof mod._free === 'function' ? mod._free : undefined,
    };
  }
  return null;
}

/**
 * Loads FlipHTML5's official self-contained deString.js WASM decoder and waits
 * until the Emscripten WASM runtime (`Module.calledRun === true`) is fully ready.
 */
async function ensureDeStringLoaded(): Promise<boolean> {
  if (getDeStringHandles()) return true;
  if (deStringReadyPromise) return deStringReadyPromise;

  deStringReadyPromise = (async () => {
    try {
      await loadScriptTag(
        'https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js',
      );

      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (getDeStringHandles()) return true;
        await new Promise((r) => setTimeout(r, 60));
      }
      return Boolean(getDeStringHandles());
    } catch {
      return false;
    }
  })();

  const ok = await deStringReadyPromise;
  if (!ok) {
    deStringReadyPromise = null;
  }
  return ok;
}

/**
 * Decodes an encoded FlipHTML5 string (`bookConfig`, `fliphtml5_pages`, or `meta`)
 * into a parsed JSON object or array, stripping any trailing checksum suffix.
 */
async function decodeFlipStringToJson<T>(
  encoded: string,
  expectedType: 'array' | 'object',
): Promise<T | null> {
  const trimmed = encoded.trim();
  const openChar = expectedType === 'array' ? '[' : '{';
  const closeChar = expectedType === 'array' ? ']' : '}';

  if (trimmed.startsWith(openChar)) {
    const endIdx = trimmed.lastIndexOf(closeChar);
    if (endIdx !== -1) {
      try {
        return JSON.parse(trimmed.slice(0, endIdx + 1)) as T;
      } catch {
        // Proceed to WASM decoder
      }
    }
  }

  const ready = await ensureDeStringLoaded();
  const handles = ready ? getDeStringHandles() : null;
  if (!handles) return null;

  const ptr = handles.allocateUTF8(encoded);
  try {
    const outPtr = handles.deString(ptr);
    const decoded = handles.utf8ToString(outPtr).trim();

    const startIdx = decoded.indexOf(openChar);
    const endIdx = decoded.lastIndexOf(closeChar);
    if (startIdx === -1 || endIdx <= startIdx) {
      return null;
    }

    const slice = decoded.slice(startIdx, endIdx + 1);
    return JSON.parse(slice) as T;
  } catch {
    return null;
  } finally {
    try {
      handles.free?.(ptr);
    } catch {
      // Ignore cleanup errors
    }
  }
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

function normalizePathList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const norm = item.trim().replace(/^(?:\.\.\/|\.\/|\/)+/, '');
    if (!norm) continue;
    const withSlash = norm.endsWith('/') ? norm : `${norm}/`;
    if (!result.includes(withSlash)) result.push(withSlash);
  }
  return result;
}

function expandExtensionVariants(pathWithoutQuery: string): string[] {
  const [cleanPath, query] = pathWithoutQuery.split('?');
  const suffix = query ? `?${query}` : '';
  const hasExt = /\.(webp|jpe?g|png|gif|zip)$/i.test(cleanPath);

  if (!hasExt) {
    return [
      `${cleanPath}.webp${suffix}`,
      `${cleanPath}.jpg${suffix}`,
      `${cleanPath}.png${suffix}`,
      `${cleanPath}${suffix}`,
    ];
  }

  const variants = [`${cleanPath}${suffix}`];
  if (/\.webp$/i.test(cleanPath)) {
    variants.push(`${cleanPath.replace(/\.webp$/i, '.jpg')}${suffix}`);
  } else if (/\.jpe?g$/i.test(cleanPath)) {
    variants.push(`${cleanPath.replace(/\.jpe?g$/i, '.webp')}${suffix}`);
  }
  return variants;
}

function buildAssetCandidates(
  rawAsset: string,
  baseUrl: string,
  largePaths: string[],
  normalPaths: string[],
): string[] {
  const cleaned = rawAsset.trim().replace(/^(?:\.\.\/|\.\/)+/, '');
  if (!cleaned) return [];

  const out: string[] = [];
  const pushResolved = (candidate: string) => {
    const resolved = resolveAssetUrl(candidate, baseUrl);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  };

  const expandedNames = expandExtensionVariants(cleaned);
  const hasDir = cleaned.includes('/') || /^https?:\/\//i.test(cleaned);

  if (hasDir) {
    for (const variant of expandedNames) {
      pushResolved(variant);
    }
    const fileOnly = cleaned.split('/').pop();
    if (fileOnly && !/^https?:\/\//i.test(cleaned)) {
      for (const variant of expandExtensionVariants(fileOnly)) {
        pushResolved(`files/large/${variant}`);
        pushResolved(`files/medium/${variant}`);
        pushResolved(`files/page/${variant}`);
        pushResolved(`files/mobile/${variant}`);
      }
    }
    return out;
  }

  const dirs: string[] = [];
  const addDir = (dir: string) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };

  largePaths.forEach(addDir);
  addDir('files/large/');
  normalPaths.forEach(addDir);
  addDir('files/medium/');
  addDir('files/page/');
  addDir('files/mobile/');

  for (const dir of dirs) {
    for (const variant of expandedNames) {
      pushResolved(`${dir}${variant}`);
    }
  }

  return out;
}

function buildNumberedFallbackCandidates(
  pageNumber: number,
  baseUrl: string,
  largePaths: string[],
  normalPaths: string[],
): string[] {
  const out: string[] = [];
  const push = (rel: string) => {
    const resolved = resolveAssetUrl(rel, baseUrl);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  };

  const dirs: string[] = [];
  const addDir = (dir: string) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };

  largePaths.forEach(addDir);
  addDir('files/large/');
  normalPaths.forEach(addDir);
  addDir('files/medium/');
  addDir('files/page/');
  addDir('files/mobile/');
  addDir('files/thumb/');

  for (const dir of dirs) {
    push(`${dir}${pageNumber}.webp`);
    push(`${dir}${pageNumber}.jpg`);
    push(`${dir}${pageNumber}.png`);
  }
  return out;
}

interface RawPageItem {
  n?: string[] | string;
  t?: string;
}

interface RawBookConfigObj {
  bookTitle?: string;
  bookDescription?: string;
  totalPageCount?: number | string;
  pageCount?: number | string;
  pageWidth?: number | string;
  pageHeight?: number | string;
  largePageWidth?: number | string;
  largePageHeight?: number | string;
  largePath?: string | string[];
  normalPath?: string | string[];
  thumbPath?: string | string[];
  fliphtml5_pages?: RawPageItem[] | string;
}

interface RawMetaObj {
  title?: string;
  description?: string;
  pageCount?: number | string;
  pageWidth?: number | string;
  pageHeight?: number | string;
}

interface RawConfig {
  meta?: RawMetaObj | string;
  bookConfig?: RawBookConfigObj | string;
  fliphtml5_pages?: RawPageItem[] | string;
}

function pickBestTitle(
  metaTitle: string | undefined,
  bookTitle: string | undefined,
  slug: string,
): string {
  const cleanMeta = metaTitle?.trim() || '';
  const cleanBook = bookTitle?.trim() || '';
  const isGeneric = (val: string) =>
    !val || /^fliphtml5$/i.test(val) || /^untitled$/i.test(val);

  if (!isGeneric(cleanMeta)) return cleanMeta;
  if (!isGeneric(cleanBook)) return cleanBook;
  return cleanMeta || cleanBook || slug;
}

async function parseConfigText(
  scriptText: string,
  normalized: NormalizedUrl,
): Promise<{ metadata: BrowserBookMetadata; hasExplicitPages: boolean } | null> {
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

  // Decode meta if it's an encoded string
  let meta: RawMetaObj | undefined;
  if (typeof parsed?.meta === 'string' && parsed.meta.trim()) {
    meta =
      (await decodeFlipStringToJson<RawMetaObj>(parsed.meta, 'object')) ??
      undefined;
  } else if (parsed?.meta && typeof parsed.meta === 'object') {
    meta = parsed.meta;
  }

  // Decode bookConfig if it's an encoded string (standard in 2025/2026 FlipHTML5 books!)
  let bookConfig: RawBookConfigObj | undefined;
  if (typeof parsed?.bookConfig === 'string' && parsed.bookConfig.trim()) {
    bookConfig =
      (await decodeFlipStringToJson<RawBookConfigObj>(
        parsed.bookConfig,
        'object',
      )) ?? undefined;
  } else if (parsed?.bookConfig && typeof parsed.bookConfig === 'object') {
    bookConfig = parsed.bookConfig;
  }

  // Decode fliphtml5_pages (can be array OR encoded string)
  let rawPages: RawPageItem[] = [];
  const rawField = parsed?.fliphtml5_pages ?? bookConfig?.fliphtml5_pages;

  if (Array.isArray(rawField)) {
    rawPages = rawField;
  } else if (typeof rawField === 'string' && rawField.trim()) {
    const decoded = await decodeFlipStringToJson<RawPageItem[]>(
      rawField,
      'array',
    );
    if (Array.isArray(decoded) && decoded.length > 0) {
      rawPages = decoded;
    }
  }

  // Fallback regex for standalone `var fliphtml5_pages = [...]` or `= "..."`
  if (rawPages.length === 0) {
    const arrMatch = scriptText.match(/fliphtml5_pages\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (arrMatch?.[1]) {
      try {
        const arr = JSON.parse(arrMatch[1]);
        if (Array.isArray(arr)) rawPages = arr as RawPageItem[];
      } catch {
        // Ignore malformed array
      }
    }
  }

  if (rawPages.length === 0) {
    const strMatch =
      scriptText.match(/["']?fliphtml5_pages["']?\s*[:=]\s*"((?:[^"\\]|\\.){20,})"/) ??
      scriptText.match(/["']?fliphtml5_pages["']?\s*[:=]\s*'((?:[^'\\]|\\.){20,})'/);
    if (strMatch?.[1]) {
      let rawEncoded = strMatch[1];
      try {
        rawEncoded = JSON.parse(`"${rawEncoded.replace(/"/g, '\\"')}"`);
      } catch {
        // Keep raw captured string
      }
      const decoded = await decodeFlipStringToJson<RawPageItem[]>(
        rawEncoded,
        'array',
      );
      if (Array.isArray(decoded) && decoded.length > 0) {
        rawPages = decoded;
      }
    }
  }

  const totalPages =
    rawPages.length ||
    parsePositiveInt(bookConfig?.totalPageCount) ||
    parsePositiveInt(bookConfig?.pageCount) ||
    parsePositiveInt(meta?.pageCount) ||
    parsePositiveInt(
      scriptText.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/)?.[1],
    ) ||
    parsePositiveInt(
      scriptText.match(/["']?pageCount["']?\s*[:=]\s*["']?(\d+)/)?.[1],
    );

  if (!totalPages) return null;

  const titleMatch = scriptText.match(/["']?bookTitle["']?\s*[:=]\s*"([^"]+)"/);
  const title = pickBestTitle(
    meta?.title,
    bookConfig?.bookTitle || titleMatch?.[1],
    normalized.slug,
  );
  const description =
    meta?.description?.trim() || bookConfig?.bookDescription?.trim() || null;
  const pageWidth =
    parsePositiveInt(bookConfig?.largePageWidth) ||
    parsePositiveInt(bookConfig?.pageWidth) ||
    parsePositiveInt(meta?.pageWidth);
  const pageHeight =
    parsePositiveInt(bookConfig?.largePageHeight) ||
    parsePositiveInt(bookConfig?.pageHeight) ||
    parsePositiveInt(meta?.pageHeight);

  const largePaths = normalizePathList(bookConfig?.largePath);
  const normalPaths = normalizePathList(bookConfig?.normalPath);
  const thumbPaths = normalizePathList(bookConfig?.thumbPath);

  const pages: BrowserPageEntry[] = [];
  for (let i = 0; i < totalPages; i += 1) {
    const pageNumber = i + 1;
    const item = rawPages[i];
    const candidates: string[] = [];

    const pushUnique = (urls: string[]) => {
      for (const u of urls) {
        if (!candidates.includes(u)) candidates.push(u);
      }
    };

    if (item?.n) {
      const list = Array.isArray(item.n) ? item.n : [item.n];
      for (const entry of list) {
        if (typeof entry === 'string' && entry.trim()) {
          pushUnique(
            buildAssetCandidates(
              entry,
              normalized.baseUrl,
              largePaths,
              normalPaths,
            ),
          );
        }
      }
    }

    let thumbUrl: string | null = null;
    if (typeof item?.t === 'string' && item.t.trim()) {
      const thumbCandidates = buildAssetCandidates(
        item.t.includes('/') || /^https?:\/\//i.test(item.t)
          ? item.t
          : `files/thumb/${item.t}`,
        normalized.baseUrl,
        thumbPaths,
        [],
      );
      thumbUrl = thumbCandidates[0] ?? null;
      pushUnique(thumbCandidates);
    }

    pushUnique(
      buildNumberedFallbackCandidates(
        pageNumber,
        normalized.baseUrl,
        largePaths,
        normalPaths,
      ),
    );

    if (!thumbUrl) thumbUrl = candidates[0] ?? null;
    pages.push({ pageNumber, candidates, thumbUrl });
  }

  return {
    hasExplicitPages: rawPages.length > 0,
    metadata: {
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
    },
  };
}

async function parseHtmlText(
  html: string,
  normalized: NormalizedUrl,
): Promise<BrowserBookMetadata | null> {
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

  const inline = await parseConfigText(html, normalized);
  if (inline) {
    return {
      ...inline.metadata,
      title:
        inline.metadata.title === normalized.slug && htmlTitle
          ? htmlTitle
          : inline.metadata.title,
      description: inline.metadata.description ?? (ogDesc?.trim() || null),
      coverUrl: inline.metadata.coverUrl ?? resolvedOgImg,
    };
  }

  const totalPages = parsePositiveInt(
    html.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ??
      html.match(/["']?pageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1],
  );
  if (!totalPages) return null;

  const pages: BrowserPageEntry[] = Array.from({ length: totalPages }, (_, i) => {
    const pageNumber = i + 1;
    const candidates = buildNumberedFallbackCandidates(
      pageNumber,
      normalized.baseUrl,
      [],
      [],
    );
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
      if (response.status === 404) {
        lastResponse = response;
        if (route === preferredRoute || route === 'direct') {
          return response;
        }
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        lastResponse = response;
        if (route === 'direct') {
          return response;
        }
        if (route === preferredRoute) {
          preferredRoute = null;
        }
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (route === preferredRoute) {
          preferredRoute = null;
        }
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'AbortError' &&
        signal?.aborted
      ) {
        throw error;
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(
    'Gagal terhubung ke FlipHTML5. Pastikan link benar dan koneksi internet stabil.',
  );
}

export async function inspectBookInBrowser(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<BrowserBookMetadata> {
  const normalized = normalizeFlipHtml5Url(rawUrl);

  const configUrls = [
    `${normalized.baseUrl}javascript/config.js`,
    `${normalized.baseUrl}mobile/javascript/config.js`,
  ];

  let fallbackMeta: BrowserBookMetadata | null = null;

  for (const configUrl of configUrls) {
    try {
      const res = await smartFetch(configUrl, signal);
      if (res.ok) {
        const text = await res.text();
        const result = await parseConfigText(text, normalized);
        if (result) {
          if (result.hasExplicitPages) {
            return result.metadata;
          }
          if (!fallbackMeta) {
            fallbackMeta = result.metadata;
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }

  if (fallbackMeta) {
    return fallbackMeta;
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
  const parsed = await parseHtmlText(html, normalized);
  if (!parsed) {
    throw new Error(
      'Daftar halaman buku FlipHTML5 tidak dapat dibaca. Pastikan publikasi bersifat publik.',
    );
  }
  return parsed;
}

async function extractImageFromResponseBytes(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const directMime = detectImageMime(bytes);
  if (directMime) {
    return { bytes, mimeType: directMime };
  }

  if (isZipBuffer(bytes)) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const imageEntry = Object.values(zip.files).find(
        (file) => !file.dir && /\.(webp|jpe?g|png|gif)$/i.test(file.name),
      );
      if (imageEntry) {
        const extracted = await imageEntry.async('uint8array');
        const extractedMime = detectImageMime(extracted);
        if (extractedMime) {
          return { bytes: extracted, mimeType: extractedMime };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function fetchPageBytes(
  entry: BrowserPageEntry,
  signal?: AbortSignal,
): Promise<RawPageBytes> {
  let lastReason = 'URL gambar halaman tidak ditemukan.';

  for (const candidateUrl of entry.candidates) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const response = await smartFetch(candidateUrl, signal);
      if (!response.ok) {
        lastReason = `HTTP ${response.status}`;
        continue;
      }
      const buffer = await response.arrayBuffer();
      const rawBytes = new Uint8Array(buffer);
      const extracted = await extractImageFromResponseBytes(rawBytes);
      if (extracted) {
        return {
          pageNumber: entry.pageNumber,
          bytes: extracted.bytes,
          mimeType: extracted.mimeType,
        };
      }
      lastReason = 'Respons bukan gambar yang valid.';
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
    label: 'Membaca daftar halaman FlipHTML5...',
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
  const failedPages: number[] = [];
  let firstErrorMessage = '';
  let cursor = 0;
  let processedCount = 0;
  const workerCount = Math.min(5, entries.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const idx = cursor;
      cursor += 1;
      if (idx >= entries.length) break;

      const entry = entries[idx];
      try {
        const pageBytes = await fetchPageBytes(entry, signal);
        downloaded.push(pageBytes);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        failedPages.push(entry.pageNumber);
        if (!firstErrorMessage) {
          firstErrorMessage = err instanceof Error ? err.message : String(err);
        }
      }

      processedCount += 1;
      const pct = Math.min(
        78,
        10 + Math.round((processedCount / entries.length) * 68),
      );
      onProgress({
        phase: 'downloading',
        progress: pct,
        label: `Mengunduh halaman ${downloaded.length} / ${entries.length}...`,
        downloadedPages: downloaded.length,
        selectedPages: entries.length,
        totalPages: book.totalPages,
        title: finalTitle,
      });
    }
  });

  await Promise.all(workers);

  if (downloaded.length === 0) {
    throw new Error(
      firstErrorMessage ||
        'Tidak ada halaman yang dapat diunduh dari publikasi ini.',
    );
  }

  onProgress({
    phase: 'packaging',
    progress: 80,
    label:
      format === 'pdf'
        ? 'Menyusun dokumen PDF...'
        : 'Mengemas paket Offline HTML5 (.zip)...',
    downloadedPages: downloaded.length,
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
        downloadedPages: downloaded.length,
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
    downloadedPages: downloaded.length,
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
    selectedPages: downloaded.length,
    skippedPages: failedPages.length,
    filename: built.filename,
    fileSize: built.size,
    blobUrl,
  };
}
