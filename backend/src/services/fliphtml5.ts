import { isAllowedFlipHost, REQUEST_TIMEOUT_MS, USER_AGENT } from '../config.js';

export class FlipHtml5Error extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FlipHtml5Error';
    this.statusCode = statusCode;
  }
}

export interface NormalizedBookUrl {
  originalUrl: string;
  normalizedUrl: string;
  baseUrl: string;
  account: string;
  bookId: string;
  slug: string;
}

export interface PageManifestEntry {
  pageNumber: number;
  candidates: string[];
  thumbUrl: string | null;
}

export interface BookMetadata {
  url: string;
  baseUrl: string;
  bookSlug: string;
  title: string;
  description: string | null;
  totalPages: number;
  pageWidth: number | null;
  pageHeight: number | null;
  coverUrl: string | null;
  pages: PageManifestEntry[];
}

export interface DownloadedPage {
  pageNumber: number;
  buffer: Buffer;
  contentType: string;
  sourceUrl: string;
}

/**
 * Normalizes and validates a FlipHTML5 book URL, preventing SSRF to non-FlipHTML5 hosts.
 */
export function normalizeFlipHtml5Url(rawInput: string): NormalizedBookUrl {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new FlipHtml5Error('FlipHTML5 URL is required.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new FlipHtml5Error('Invalid URL format. Please enter a valid FlipHTML5 link.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FlipHtml5Error('Only HTTP and HTTPS FlipHTML5 URLs are supported.');
  }

  if (!isAllowedFlipHost(parsed.hostname)) {
    throw new FlipHtml5Error(
      `Host "${parsed.hostname}" is not supported. Please provide a fliphtml5.com or online.fliphtml5.com URL.`,
    );
  }

  const segments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^index\.html?$/i.test(s) && s !== 'mobile');

  if (segments.length < 2) {
    throw new FlipHtml5Error(
      'URL does not appear to point to a specific FlipHTML5 book (expected /<account>/<book>/).',
    );
  }

  const [account, bookId] = segments;
  if (!/^[a-zA-Z0-9._-]+$/.test(account) || !/^[a-zA-Z0-9._-]+$/.test(bookId)) {
    throw new FlipHtml5Error('FlipHTML5 URL contains invalid path segments.');
  }

  const baseUrl = `https://online.fliphtml5.com/${account}/${bookId}/`;
  return {
    originalUrl: trimmed,
    normalizedUrl: baseUrl,
    baseUrl,
    account,
    bookId,
    slug: `${account}-${bookId}`,
  };
}

/**
 * Resolves a relative or absolute FlipHTML5 asset path against the book baseUrl,
 * validating that any absolute URL still stays within allowed FlipHTML5 hosts.
 */
export function resolveAssetUrl(assetPath: string, baseUrl: string): string | null {
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

/**
 * Extracts a balanced JSON object literal starting from the first `{` after a marker.
 */
function extractBalancedJsonObject(source: string, startIndex: number): string | null {
  const openBrace = source.indexOf('{', startIndex);
  if (openBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, i + 1);
      }
    }
  }

  return null;
}

interface RawFlipPageItem {
  n?: string[] | string;
  t?: string;
}

interface RawHtmlConfig {
  meta?: {
    title?: string;
    description?: string;
  };
  bookConfig?: {
    bookTitle?: string;
    totalPageCount?: number | string;
    pageCount?: number | string;
    pageWidth?: number | string;
    pageHeight?: number | string;
    largePath?: string;
    normalPath?: string;
    thumbPath?: string;
    fliphtml5_pages?: RawFlipPageItem[];
  };
  fliphtml5_pages?: RawFlipPageItem[];
}

function buildFallbackCandidates(
  pageNumber: number,
  baseUrl: string,
  largePath?: string,
  normalPath?: string,
): string[] {
  const candidates: string[] = [];
  const push = (rel: string) => {
    const resolved = resolveAssetUrl(rel, baseUrl);
    if (resolved && !candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  if (largePath) {
    const prefix = largePath.endsWith('/') ? largePath : `${largePath}/`;
    push(`${prefix}${pageNumber}.jpg`);
    push(`${prefix}${pageNumber}.webp`);
    push(`${prefix}${pageNumber}.png`);
  }
  if (normalPath) {
    const prefix = normalPath.endsWith('/') ? normalPath : `${normalPath}/`;
    push(`${prefix}${pageNumber}.jpg`);
    push(`${prefix}${pageNumber}.webp`);
  }

  push(`files/large/${pageNumber}.jpg`);
  push(`files/large/${pageNumber}.webp`);
  push(`files/page/${pageNumber}.jpg`);
  push(`files/page/${pageNumber}.webp`);
  push(`files/mobile/${pageNumber}.jpg`);
  push(`files/mobile/${pageNumber}.webp`);
  push(`files/large/${pageNumber}.png`);

  return candidates;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Parses FlipHTML5 `config.js` content (`var htmlConfig = {...};`).
 */
export function parseConfigJs(
  scriptText: string,
  normalized: NormalizedBookUrl,
): BookMetadata | null {
  const configMarker = scriptText.search(/(?:var|let|const|window\.)\s*htmlConfig\s*=/);
  let parsedConfig: RawHtmlConfig | null = null;

  if (configMarker !== -1) {
    const jsonBlock = extractBalancedJsonObject(scriptText, configMarker);
    if (jsonBlock) {
      try {
        parsedConfig = JSON.parse(jsonBlock) as RawHtmlConfig;
      } catch {
        parsedConfig = null;
      }
    }
  }

  // Also support standalone `var fliphtml5_pages = [...]` found in older FlipHTML5 books
  let rawPages: RawFlipPageItem[] =
    parsedConfig?.fliphtml5_pages ?? parsedConfig?.bookConfig?.fliphtml5_pages ?? [];

  if (rawPages.length === 0) {
    const pagesMatch = scriptText.match(/fliphtml5_pages\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (pagesMatch?.[1]) {
      try {
        const parsed = JSON.parse(pagesMatch[1]);
        if (Array.isArray(parsed)) {
          rawPages = parsed as RawFlipPageItem[];
        }
      } catch {
        // Ignore malformed fallback array
      }
    }
  }

  const bookConfig = parsedConfig?.bookConfig;
  const meta = parsedConfig?.meta;

  const detectedCount =
    rawPages.length ||
    parsePositiveInt(bookConfig?.totalPageCount) ||
    parsePositiveInt(bookConfig?.pageCount) ||
    parsePositiveInt(scriptText.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/)?.[1]);

  if (!detectedCount) {
    return null;
  }

  const titleMatch = scriptText.match(/["']?bookTitle["']?\s*[:=]\s*"([^"]+)"/);
  const title =
    (bookConfig?.bookTitle || meta?.title || titleMatch?.[1] || normalized.slug).trim();
  const description = meta?.description?.trim() || null;
  const pageWidth = parsePositiveInt(bookConfig?.pageWidth);
  const pageHeight = parsePositiveInt(bookConfig?.pageHeight);

  const pages: PageManifestEntry[] = [];
  for (let i = 0; i < detectedCount; i += 1) {
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
        if (resolved && !candidates.includes(resolved)) {
          candidates.push(resolved);
        }
      }
    };

    if (item?.n) {
      const list = Array.isArray(item.n) ? item.n : [item.n];
      for (const entry of list) {
        if (typeof entry === 'string' && entry.trim()) {
          addAsset(entry);
        }
      }
    }

    for (const fallback of buildFallbackCandidates(
      pageNumber,
      normalized.baseUrl,
      bookConfig?.largePath,
      bookConfig?.normalPath,
    )) {
      if (!candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    }

    let thumbUrl: string | null = null;
    if (typeof item?.t === 'string' && item.t.trim()) {
      const rawThumb = item.t.includes('/') || /^https?:\/\//i.test(item.t)
        ? item.t
        : `files/thumb/${item.t}`;
      thumbUrl = resolveAssetUrl(rawThumb, normalized.baseUrl);
    }
    if (!thumbUrl) {
      thumbUrl = candidates[0] ?? null;
    }

    pages.push({ pageNumber, candidates, thumbUrl });
  }

  const coverUrl = pages[0]?.thumbUrl ?? pages[0]?.candidates[0] ?? null;

  return {
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,
    bookSlug: normalized.slug,
    title,
    description,
    totalPages: detectedCount,
    pageWidth,
    pageHeight,
    coverUrl,
    pages,
  };
}

/**
 * Fallback parser when a FlipHTML5 book embeds metadata directly in index.html.
 */
export function parseHtmlFallback(
  html: string,
  normalized: NormalizedBookUrl,
): BookMetadata | null {
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
  const resolvedOgImage = ogImage
    ? resolveAssetUrl(ogImage, normalized.baseUrl)
    : null;

  const inlineConfig = parseConfigJs(html, normalized);
  if (inlineConfig) {
    return {
      ...inlineConfig,
      title:
        inlineConfig.title === normalized.slug && htmlTitle
          ? htmlTitle
          : inlineConfig.title,
      description: inlineConfig.description ?? (ogDesc?.trim() || null),
      coverUrl: inlineConfig.coverUrl ?? resolvedOgImage,
    };
  }

  const pageCount = parsePositiveInt(
    html.match(/["']?totalPageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ??
      html.match(/["']?pageCount["']?\s*[:=]\s*["']?(\d+)/i)?.[1],
  );
  if (!pageCount) return null;

  const title = htmlTitle || normalized.slug;

  const pages: PageManifestEntry[] = Array.from({ length: pageCount }, (_, idx) => {
    const pageNumber = idx + 1;
    const candidates = buildFallbackCandidates(pageNumber, normalized.baseUrl);
    return {
      pageNumber,
      candidates,
      thumbUrl: candidates[0] ?? null,
    };
  });

  const coverUrl = resolvedOgImage ?? pages[0]?.candidates[0] ?? null;

  return {
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,
    bookSlug: normalized.slug,
    title,
    description: ogDesc?.trim() || null,
    totalPages: pageCount,
    pageWidth: null,
    pageHeight: null,
    coverUrl,
    pages,
  };
}

/**
 * Verifies image magic bytes so HTML error pages served with 200 OK are rejected.
 */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  // WebP: RIFF .... WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // GIF: GIF87a / GIF89a
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  referer: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Referer: referer,
        Accept: '*/*',
      },
    });
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Inspects a public FlipHTML5 book by fetching its config.js or HTML manifest.
 */
export async function inspectFlipBook(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<BookMetadata> {
  const normalized = normalizeFlipHtml5Url(rawUrl);

  const configUrls = [
    `${normalized.baseUrl}mobile/javascript/config.js`,
    `${normalized.baseUrl}javascript/config.js`,
  ];

  for (const configUrl of configUrls) {
    try {
      const response = await fetchWithTimeout(configUrl, normalized.baseUrl, signal);
      if (response.ok) {
        const scriptText = await response.text();
        const metadata = parseConfigJs(scriptText, normalized);
        if (metadata) {
          return metadata;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      // Continue trying fallback endpoints
    }
  }

  // Fallback: fetch the main HTML page
  let htmlResponse: Response;
  try {
    htmlResponse = await fetchWithTimeout(normalized.baseUrl, normalized.baseUrl, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new FlipHtml5Error(
      'Unable to reach FlipHTML5 right now. Check your network connection and verify the book URL.',
      502,
    );
  }

  if (htmlResponse.status === 404) {
    throw new FlipHtml5Error(
      'FlipHTML5 book not found (HTTP 404). Please verify that the link is public and spelled correctly.',
      404,
    );
  }

  if (htmlResponse.status === 403 || htmlResponse.status === 401) {
    throw new FlipHtml5Error(
      'This FlipHTML5 publication is private or access-restricted and cannot be downloaded.',
      403,
    );
  }

  if (!htmlResponse.ok) {
    throw new FlipHtml5Error(
      `FlipHTML5 returned HTTP ${htmlResponse.status} while inspecting the book.`,
      502,
    );
  }

  const htmlText = await htmlResponse.text();
  const parsedHtml = parseHtmlFallback(htmlText, normalized);
  if (!parsedHtml) {
    throw new FlipHtml5Error(
      'Could not extract flipbook configuration. The book may be private, password-protected, or use an unsupported layout.',
      422,
    );
  }

  return parsedHtml;
}

/**
 * Downloads a single page image by probing candidate URLs in priority order.
 */
export async function downloadPageImage(
  entry: PageManifestEntry,
  referer: string,
  signal?: AbortSignal,
): Promise<DownloadedPage> {
  let lastError = 'No candidate URLs available.';

  for (const candidateUrl of entry.candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      try {
        const response = await fetchWithTimeout(candidateUrl, referer, signal);
        if (!response.ok) {
          lastError = `HTTP ${response.status} from ${candidateUrl}`;
          if (response.status === 404 || response.status === 403) {
            break; // Try next candidate immediately
          }
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mime = detectImageMime(buffer);
        if (mime) {
          return {
            pageNumber: entry.pageNumber,
            buffer,
            contentType: mime,
            sourceUrl: candidateUrl,
          };
        }

        lastError = `Response from ${candidateUrl} was not a valid image.`;
        break;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new FlipHtml5Error(
    `Failed to download page ${entry.pageNumber}: ${lastError}`,
    502,
  );
}
