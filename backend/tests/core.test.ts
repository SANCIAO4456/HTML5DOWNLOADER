import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { FlipDownDatabase } from '../src/db/database.js';
import {
  detectImageMime,
  FlipHtml5Error,
  normalizeFlipHtml5Url,
  parseConfigJs,
  parseHtmlFallback,
} from '../src/services/fliphtml5.js';
import { buildOfflineHtml5Zip } from '../src/services/html5Builder.js';
import {
  formatPageRange,
  PageRangeError,
  parsePageRange,
} from '../src/services/pageRange.js';
import { buildPdfFromPages } from '../src/services/pdfBuilder.js';

describe('normalizeFlipHtml5Url', () => {
  it('normalizes standard online.fliphtml5.com and fliphtml5.com URLs', () => {
    const a = normalizeFlipHtml5Url(
      'https://fliphtml5.com/abcd/efgh/#p=4',
    );
    assert.equal(a.baseUrl, 'https://online.fliphtml5.com/abcd/efgh/');
    assert.equal(a.slug, 'abcd-efgh');

    const b = normalizeFlipHtml5Url('online.fliphtml5.com/myorg/brochure2026/index.html');
    assert.equal(b.baseUrl, 'https://online.fliphtml5.com/myorg/brochure2026/');
    assert.equal(b.account, 'myorg');
    assert.equal(b.bookId, 'brochure2026');
  });

  it('rejects non-FlipHTML5 hosts and malformed paths to prevent SSRF', () => {
    assert.throws(
      () => normalizeFlipHtml5Url('https://evil-fliphtml5.com/a/b/'),
      FlipHtml5Error,
    );
    assert.throws(
      () => normalizeFlipHtml5Url('http://127.0.0.1:3001/a/b/'),
      FlipHtml5Error,
    );
    assert.throws(
      () => normalizeFlipHtml5Url('https://online.fliphtml5.com/onlyaccount/'),
      FlipHtml5Error,
    );
  });
});

describe('parsePageRange & formatPageRange', () => {
  it('parses all, single pages, ranges, and deduplicates sorted pages', () => {
    assert.deepEqual(parsePageRange('all', 4), [1, 2, 3, 4]);
    assert.deepEqual(parsePageRange('', 3), [1, 2, 3]);
    assert.deepEqual(parsePageRange('1, 3-5, 4, 8', 10), [1, 3, 4, 5, 8]);
    assert.equal(formatPageRange([1, 3, 4, 5, 8], 10), '1, 3-5, 8');
    assert.equal(formatPageRange([1, 2, 3], 3), 'all');
  });

  it('throws PageRangeError on out-of-bounds or invalid ranges', () => {
    assert.throws(() => parsePageRange('0-2', 5), PageRangeError);
    assert.throws(() => parsePageRange('1-6', 5), PageRangeError);
    assert.throws(() => parsePageRange('5-2', 5), PageRangeError);
    assert.throws(() => parsePageRange('abc', 5), PageRangeError);
  });
});

describe('FlipHTML5 config.js and HTML metadata parsers', () => {
  it('parses var htmlConfig JSON with fliphtml5_pages entries', () => {
    const normalized = normalizeFlipHtml5Url('https://online.fliphtml5.com/demo/book1/');
    const mockConfigJs = `
      var htmlConfig = {
        "meta": { "title": "Annual Architecture Monograph", "description": "2026 Edition" },
        "bookConfig": {
          "bookTitle": "Annual Architecture Monograph",
          "totalPageCount": 2,
          "pageWidth": 800,
          "pageHeight": 1120
        },
        "fliphtml5_pages": [
          { "n": ["files/large/1.webp"], "t": "files/thumb/1.jpg" },
          { "n": ["files/large/2.webp"], "t": "files/thumb/2.jpg" }
        ]
      };
    `;

    const meta = parseConfigJs(mockConfigJs, normalized);
    assert.ok(meta);
    assert.equal(meta.title, 'Annual Architecture Monograph');
    assert.equal(meta.totalPages, 2);
    assert.equal(meta.pageWidth, 800);
    assert.equal(meta.pageHeight, 1120);
    assert.equal(
      meta.pages[0].candidates[0],
      'https://online.fliphtml5.com/demo/book1/files/large/1.webp',
    );
    assert.equal(
      meta.coverUrl,
      'https://online.fliphtml5.com/demo/book1/files/thumb/1.jpg',
    );
  });

  it('falls back to HTML OpenGraph tags when config.js is absent', () => {
    const normalized = normalizeFlipHtml5Url('https://online.fliphtml5.com/demo/book2/');
    const html = `
      <html>
        <head>
          <title>Design Manual - FlipHTML5</title>
          <meta property="og:title" content="Design Manual" />
          <meta property="og:image" content="https://online.fliphtml5.com/demo/book2/files/shot.jpg" />
        </head>
        <body><script>var totalPageCount = 3;</script></body>
      </html>
    `;
    const meta = parseHtmlFallback(html, normalized);
    assert.ok(meta);
    assert.equal(meta.title, 'Design Manual');
    assert.equal(meta.totalPages, 3);
    assert.equal(meta.pages.length, 3);
  });
});

describe('PDF and Offline HTML5 ZIP builders', () => {
  it('generates valid PDF and ZIP bundles from synthetic page images', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flipdown-test-'));
    try {
      const page1 = await sharp({
        create: {
          width: 400,
          height: 560,
          channels: 3,
          background: { r: 245, g: 240, b: 230 },
        },
      })
        .webp()
        .toBuffer();

      const page2 = await sharp({
        create: {
          width: 400,
          height: 560,
          channels: 3,
          background: { r: 225, g: 235, b: 245 },
        },
      })
        .png()
        .toBuffer();

      assert.equal(detectImageMime(page1), 'image/webp');
      assert.equal(detectImageMime(page2), 'image/png');

      const pdfPath = path.join(tmpDir, 'book.pdf');
      const pdfRes = await buildPdfFromPages(
        [
          { pageNumber: 1, buffer: page1 },
          { pageNumber: 2, buffer: page2 },
        ],
        {
          title: 'Synthetic Monograph',
          sourceUrl: 'https://online.fliphtml5.com/demo/book1/',
          quality: 'medium',
          outputPath: pdfPath,
        },
      );
      assert.ok(pdfRes.fileSize > 500);
      const pdfHeader = (await fs.readFile(pdfPath)).subarray(0, 5).toString('ascii');
      assert.equal(pdfHeader, '%PDF-');

      const zipPath = path.join(tmpDir, 'book-offline.zip');
      const zipRes = await buildOfflineHtml5Zip(
        [
          { pageNumber: 1, buffer: page1 },
          { pageNumber: 2, buffer: page2 },
        ],
        {
          title: 'Synthetic Monograph',
          sourceUrl: 'https://online.fliphtml5.com/demo/book1/',
          quality: 'high',
          outputPath: zipPath,
        },
      );
      assert.ok(zipRes.fileSize > 1000);
      const zipHeader = (await fs.readFile(zipPath)).subarray(0, 4);
      assert.deepEqual(Array.from(zipHeader), [0x50, 0x4b, 0x03, 0x04]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('FlipDownDatabase (node:sqlite)', () => {
  it('persists, updates, queries, and deletes jobs & inspections', () => {
    const db = new FlipDownDatabase(':memory:');
    try {
      const now = new Date().toISOString();
      db.createJob({
        id: 'job-1',
        url: 'https://online.fliphtml5.com/demo/book1/',
        bookSlug: 'demo-book1',
        title: 'Test Book',
        format: 'pdf',
        quality: 'high',
        pageRange: 'all',
        totalPages: 12,
        selectedPages: 12,
        downloadedPages: 0,
        status: 'queued',
        progress: 0,
        coverUrl: null,
        outputFilename: null,
        outputPath: null,
        fileSize: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });

      const updated = db.updateJob('job-1', {
        status: 'completed',
        progress: 100,
        downloadedPages: 12,
        outputFilename: 'test-book.pdf',
        fileSize: 42000,
      });
      assert.equal(updated?.status, 'completed');
      assert.equal(db.listJobs().length, 1);

      db.saveInspection({
        url: 'https://online.fliphtml5.com/demo/book1/',
        bookSlug: 'demo-book1',
        title: 'Test Book',
        description: 'Sample',
        totalPages: 12,
        pageWidth: 800,
        pageHeight: 1100,
        coverUrl: null,
        inspectedAt: now,
      });
      assert.equal(db.listRecentInspections().length, 1);

      assert.equal(db.deleteJob('job-1'), true);
      assert.equal(db.getJob('job-1'), null);
    } finally {
      db.close();
    }
  });
});
