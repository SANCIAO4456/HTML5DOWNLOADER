export class PageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageRangeError';
  }
}

/**
 * Parses a human-friendly 1-based page range string such as:
 *   "all", "", "1-10", "1, 3, 5-8"
 * Returns sorted, deduplicated 1-based page numbers within [1, totalPages].
 */
export function parsePageRange(
  rawInput: string | undefined | null,
  totalPages: number,
): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new PageRangeError('Total pages must be at least 1.');
  }

  const trimmed = (rawInput ?? '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === '*') {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pageSet = new Set<number>();
  const tokens = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new PageRangeError('Page range cannot be empty.');
  }

  for (const token of tokens) {
    if (token.includes('-')) {
      const bounds = token.split('-').map((value) => value.trim());
      if (bounds.length !== 2 || !bounds[0] || !bounds[1]) {
        throw new PageRangeError(`Invalid page range segment: "${token}".`);
      }

      const start = Number(bounds[0]);
      const end = Number(bounds[1]);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new PageRangeError(`Page numbers must be integers: "${token}".`);
      }
      if (start < 1 || end < 1) {
        throw new PageRangeError('Page numbers must start at 1 or higher.');
      }
      if (start > end) {
        throw new PageRangeError(
          `Range start (${start}) cannot be greater than end (${end}).`,
        );
      }
      if (end > totalPages) {
        throw new PageRangeError(
          `Requested page ${end} exceeds book length (${totalPages} pages).`,
        );
      }

      for (let page = start; page <= end; page += 1) {
        pageSet.add(page);
      }
    } else {
      const page = Number(token);
      if (!Number.isInteger(page)) {
        throw new PageRangeError(`Invalid page number: "${token}".`);
      }
      if (page < 1 || page > totalPages) {
        throw new PageRangeError(
          `Page ${page} is out of range (book has ${totalPages} pages).`,
        );
      }
      pageSet.add(page);
    }
  }

  if (pageSet.size === 0) {
    throw new PageRangeError('No valid pages selected.');
  }

  return Array.from(pageSet).sort((a, b) => a - b);
}

/**
 * Formats an array of page numbers back into compact range notation (e.g. "1-5, 8, 10-12").
 */
export function formatPageRange(pages: number[], totalPages: number): string {
  if (pages.length === 0) return '';
  if (pages.length === totalPages) return 'all';

  const sorted = [...pages].sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = current;
      prev = current;
    }
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);

  return ranges.join(', ');
}
