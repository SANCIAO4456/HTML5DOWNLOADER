import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_CONCURRENCY, OUTPUT_DIR } from '../config.js';
import type {
  FlipDownDatabase,
  JobRecord,
  OutputFormat,
  QualityPreset,
} from '../db/database.js';
import {
  downloadPageImage,
  FlipHtml5Error,
  inspectFlipBook,
  normalizeFlipHtml5Url,
  type BookMetadata,
  type DownloadedPage,
} from './fliphtml5.js';
import { buildOfflineHtml5Zip } from './html5Builder.js';
import { formatPageRange, parsePageRange } from './pageRange.js';
import { buildPdfFromPages } from './pdfBuilder.js';

export interface CreateJobInput {
  url: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange?: string;
  customTitle?: string;
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return cleaned || 'fliphtml5-book';
}

export class JobManager {
  private readonly db: FlipDownDatabase;
  private readonly outputDir: string;
  private readonly events = new EventEmitter();
  private readonly controllers = new Map<string, AbortController>();

  constructor(db: FlipDownDatabase, outputDir = OUTPUT_DIR) {
    this.db = db;
    this.outputDir = outputDir;
    this.events.setMaxListeners(100);
  }

  subscribe(jobId: string, listener: (job: JobRecord) => void): () => void {
    const channel = `job:${jobId}`;
    this.events.on(channel, listener);
    return () => {
      this.events.off(channel, listener);
    };
  }

  private emitUpdate(job: JobRecord): void {
    this.events.emit(`job:${job.id}`, job);
  }

  private updateAndEmit(
    jobId: string,
    patch: Partial<Omit<JobRecord, 'id' | 'createdAt'>>,
  ): JobRecord | null {
    const updated = this.db.updateJob(jobId, patch);
    if (updated) {
      this.emitUpdate(updated);
    }
    return updated;
  }

  async inspect(rawUrl: string): Promise<BookMetadata> {
    const metadata = await inspectFlipBook(rawUrl);
    this.db.saveInspection({
      url: metadata.url,
      bookSlug: metadata.bookSlug,
      title: metadata.title,
      description: metadata.description,
      totalPages: metadata.totalPages,
      pageWidth: metadata.pageWidth,
      pageHeight: metadata.pageHeight,
      coverUrl: metadata.coverUrl,
      inspectedAt: new Date().toISOString(),
    });
    return metadata;
  }

  startJob(input: CreateJobInput): JobRecord {
    const normalized = normalizeFlipHtml5Url(input.url);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const initialTitle = input.customTitle?.trim() || normalized.slug;

    const job = this.db.createJob({
      id,
      url: normalized.normalizedUrl,
      bookSlug: normalized.slug,
      title: initialTitle,
      format: input.format,
      quality: input.quality,
      pageRange: input.pageRange?.trim() || 'all',
      totalPages: 0,
      selectedPages: 0,
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

    const controller = new AbortController();
    this.controllers.set(id, controller);

    void this.runJob(job.id, input, controller.signal).finally(() => {
      this.controllers.delete(id);
    });

    return job;
  }

  cancelJob(jobId: string): JobRecord | null {
    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort();
    }
    const existing = this.db.getJob(jobId);
    if (!existing) return null;

    if (
      existing.status === 'queued' ||
      existing.status === 'fetching_meta' ||
      existing.status === 'downloading' ||
      existing.status === 'packaging'
    ) {
      return this.updateAndEmit(jobId, {
        status: 'cancelled',
        errorMessage: 'Download cancelled by user.',
      });
    }

    return existing;
  }

  async deleteJob(jobId: string): Promise<boolean> {
    this.cancelJob(jobId);
    const job = this.db.getJob(jobId);
    if (!job) return false;

    if (job.outputPath) {
      await fs.rm(job.outputPath, { force: true }).catch(() => {});
    }
    return this.db.deleteJob(jobId);
  }

  private async runJob(
    jobId: string,
    input: CreateJobInput,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      this.updateAndEmit(jobId, { status: 'fetching_meta', progress: 3 });

      const metadata = await inspectFlipBook(input.url, signal);
      this.db.saveInspection({
        url: metadata.url,
        bookSlug: metadata.bookSlug,
        title: metadata.title,
        description: metadata.description,
        totalPages: metadata.totalPages,
        pageWidth: metadata.pageWidth,
        pageHeight: metadata.pageHeight,
        coverUrl: metadata.coverUrl,
        inspectedAt: new Date().toISOString(),
      });

      const selectedPageNumbers = parsePageRange(
        input.pageRange,
        metadata.totalPages,
      );
      const formattedRange = formatPageRange(
        selectedPageNumbers,
        metadata.totalPages,
      );
      const finalTitle = input.customTitle?.trim() || metadata.title;

      this.updateAndEmit(jobId, {
        title: finalTitle,
        coverUrl: metadata.coverUrl,
        totalPages: metadata.totalPages,
        selectedPages: selectedPageNumbers.length,
        pageRange: formattedRange,
        status: 'downloading',
        progress: 8,
      });

      const pageEntries = selectedPageNumbers
        .map((num) => metadata.pages[num - 1])
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      const downloadedPages: DownloadedPage[] = [];
      let nextCursor = 0;
      let completedDownloads = 0;

      const workerCount = Math.min(MAX_CONCURRENCY, pageEntries.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const idx = nextCursor;
          nextCursor += 1;
          if (idx >= pageEntries.length) break;

          const entry = pageEntries[idx];
          const downloaded = await downloadPageImage(
            entry,
            metadata.baseUrl,
            signal,
          );
          downloadedPages.push(downloaded);
          completedDownloads += 1;

          // Download phase represents 8% -> 78%
          const pct = Math.min(
            78,
            8 + Math.round((completedDownloads / pageEntries.length) * 70),
          );
          this.updateAndEmit(jobId, {
            downloadedPages: completedDownloads,
            progress: pct,
          });
        }
      });

      await Promise.all(workers);

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      this.updateAndEmit(jobId, { status: 'packaging', progress: 80 });

      const ext = input.format === 'pdf' ? 'pdf' : 'zip';
      const safeBase = sanitizeFilename(finalTitle);
      const shortId = jobId.slice(0, 8);
      const outputFilename =
        input.format === 'pdf'
          ? `${safeBase}.pdf`
          : `${safeBase}-offline-html5.zip`;
      const diskFilename = `${shortId}-${safeBase}.${ext}`;
      const outputPath = path.join(this.outputDir, diskFilename);

      const onPackageProgress = (done: number, total: number) => {
        const pct = Math.min(98, 80 + Math.round((done / total) * 18));
        this.updateAndEmit(jobId, { progress: pct });
      };

      const result =
        input.format === 'pdf'
          ? await buildPdfFromPages(downloadedPages, {
              title: finalTitle,
              sourceUrl: metadata.url,
              quality: input.quality,
              outputPath,
              onProgress: onPackageProgress,
            })
          : await buildOfflineHtml5Zip(downloadedPages, {
              title: finalTitle,
              sourceUrl: metadata.url,
              quality: input.quality,
              outputPath,
              onProgress: onPackageProgress,
            });

      this.updateAndEmit(jobId, {
        status: 'completed',
        progress: 100,
        outputFilename,
        outputPath: result.outputPath,
        fileSize: result.fileSize,
        completedAt: new Date().toISOString(),
        errorMessage: null,
      });
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        this.updateAndEmit(jobId, {
          status: 'cancelled',
          errorMessage: 'Download cancelled by user.',
        });
        return;
      }

      const message =
        error instanceof FlipHtml5Error || error instanceof Error
          ? error.message
          : 'Unexpected error while processing flipbook.';

      this.updateAndEmit(jobId, {
        status: 'failed',
        errorMessage: message,
      });
    }
  }
}
