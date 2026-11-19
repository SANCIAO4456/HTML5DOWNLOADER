import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BACKEND_ROOT = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

export const PORT = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001;
export const DATA_DIR = process.env.FLIPDOWN_DATA_DIR
  ? path.resolve(process.env.FLIPDOWN_DATA_DIR)
  : path.join(BACKEND_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'flipdown.db');
export const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
export const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, 'frontend', 'dist');

export const MAX_CONCURRENCY = Math.min(
  8,
  Math.max(1, Number.parseInt(process.env.FLIPDOWN_CONCURRENCY ?? '4', 10) || 4),
);
export const REQUEST_TIMEOUT_MS =
  Number.parseInt(process.env.FLIPDOWN_TIMEOUT_MS ?? '25000', 10) || 25000;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ALLOWED_ROOT_DOMAINS = ['fliphtml5.com'] as const;

/**
 * Validates that a hostname strictly belongs to FlipHTML5 to prevent SSRF.
 */
export function isAllowedFlipHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;
  return ALLOWED_ROOT_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}
