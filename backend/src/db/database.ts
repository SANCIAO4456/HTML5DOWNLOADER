import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type OutputFormat = 'pdf' | 'html5';
export type QualityPreset = 'original' | 'high' | 'medium' | 'compact';
export type JobStatus =
  | 'queued'
  | 'fetching_meta'
  | 'downloading'
  | 'packaging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRecord {
  id: string;
  url: string;
  bookSlug: string;
  title: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  totalPages: number;
  selectedPages: number;
  downloadedPages: number;
  status: JobStatus;
  progress: number;
  coverUrl: string | null;
  outputFilename: string | null;
  outputPath: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface InspectionRecord {
  url: string;
  bookSlug: string;
  title: string;
  description: string | null;
  totalPages: number;
  pageWidth: number | null;
  pageHeight: number | null;
  coverUrl: string | null;
  inspectedAt: string;
}

interface RawJobRow {
  id: string;
  url: string;
  book_slug: string;
  title: string;
  format: OutputFormat;
  quality: QualityPreset;
  page_range: string;
  total_pages: number;
  selected_pages: number;
  downloaded_pages: number;
  status: JobStatus;
  progress: number;
  cover_url: string | null;
  output_filename: string | null;
  output_path: string | null;
  file_size: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface RawInspectionRow {
  url: string;
  book_slug: string;
  title: string;
  description: string | null;
  total_pages: number;
  page_width: number | null;
  page_height: number | null;
  cover_url: string | null;
  inspected_at: string;
}

function mapJobRow(row: RawJobRow): JobRecord {
  return {
    id: row.id,
    url: row.url,
    bookSlug: row.book_slug,
    title: row.title,
    format: row.format,
    quality: row.quality,
    pageRange: row.page_range,
    totalPages: row.total_pages,
    selectedPages: row.selected_pages,
    downloadedPages: row.downloaded_pages,
    status: row.status,
    progress: row.progress,
    coverUrl: row.cover_url,
    outputFilename: row.output_filename,
    outputPath: row.output_path,
    fileSize: row.file_size,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapInspectionRow(row: RawInspectionRow): InspectionRecord {
  return {
    url: row.url,
    bookSlug: row.book_slug,
    title: row.title,
    description: row.description,
    totalPages: row.total_pages,
    pageWidth: row.page_width,
    pageHeight: row.page_height,
    coverUrl: row.cover_url,
    inspectedAt: row.inspected_at,
  };
}

export class FlipDownDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        book_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        quality TEXT NOT NULL,
        page_range TEXT NOT NULL DEFAULT 'all',
        total_pages INTEGER NOT NULL DEFAULT 0,
        selected_pages INTEGER NOT NULL DEFAULT 0,
        downloaded_pages INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        output_filename TEXT,
        output_path TEXT,
        file_size INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);

      CREATE TABLE IF NOT EXISTS inspections (
        url TEXT PRIMARY KEY,
        book_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        total_pages INTEGER NOT NULL,
        page_width INTEGER,
        page_height INTEGER,
        cover_url TEXT,
        inspected_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inspections_time ON inspections (inspected_at DESC);
    `);
  }

  createJob(job: JobRecord): JobRecord {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, url, book_slug, title, format, quality, page_range,
        total_pages, selected_pages, downloaded_pages, status, progress,
        cover_url, output_filename, output_path, file_size, error_message,
        created_at, updated_at, completed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      job.id,
      job.url,
      job.bookSlug,
      job.title,
      job.format,
      job.quality,
      job.pageRange,
      job.totalPages,
      job.selectedPages,
      job.downloadedPages,
      job.status,
      job.progress,
      job.coverUrl,
      job.outputFilename,
      job.outputPath,
      job.fileSize,
      job.errorMessage,
      job.createdAt,
      job.updatedAt,
      job.completedAt,
    );

    return job;
  }

  updateJob(
    id: string,
    patch: Partial<Omit<JobRecord, 'id' | 'createdAt'>>,
  ): JobRecord | null {
    const current = this.getJob(id);
    if (!current) return null;

    const merged: JobRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    const stmt = this.db.prepare(`
      UPDATE jobs SET
        url = ?,
        book_slug = ?,
        title = ?,
        format = ?,
        quality = ?,
        page_range = ?,
        total_pages = ?,
        selected_pages = ?,
        downloaded_pages = ?,
        status = ?,
        progress = ?,
        cover_url = ?,
        output_filename = ?,
        output_path = ?,
        file_size = ?,
        error_message = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.url,
      merged.bookSlug,
      merged.title,
      merged.format,
      merged.quality,
      merged.pageRange,
      merged.totalPages,
      merged.selectedPages,
      merged.downloadedPages,
      merged.status,
      merged.progress,
      merged.coverUrl,
      merged.outputFilename,
      merged.outputPath,
      merged.fileSize,
      merged.errorMessage,
      merged.updatedAt,
      merged.completedAt,
      id,
    );

    return merged;
  }

  getJob(id: string): JobRecord | null {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id) as RawJobRow | undefined;
    return row ? mapJobRow(row) : null;
  }

  listJobs(limit = 50): JobRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as unknown as RawJobRow[];
    return rows.map(mapJobRow);
  }

  deleteJob(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM jobs WHERE id = ?');
    const result = stmt.run(id);
    return Number(result.changes) > 0;
  }

  markInterruptedJobsFailed(): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          error_message = 'Server restarted while job was in progress.',
          updated_at = ?
      WHERE status IN ('queued', 'fetching_meta', 'downloading', 'packaging')
    `);
    const result = stmt.run(now);
    return Number(result.changes);
  }

  saveInspection(record: InspectionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO inspections (
        url, book_slug, title, description, total_pages,
        page_width, page_height, cover_url, inspected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        book_slug = excluded.book_slug,
        title = excluded.title,
        description = excluded.description,
        total_pages = excluded.total_pages,
        page_width = excluded.page_width,
        page_height = excluded.page_height,
        cover_url = excluded.cover_url,
        inspected_at = excluded.inspected_at
    `);

    stmt.run(
      record.url,
      record.bookSlug,
      record.title,
      record.description,
      record.totalPages,
      record.pageWidth,
      record.pageHeight,
      record.coverUrl,
      record.inspectedAt,
    );
  }

  listRecentInspections(limit = 10): InspectionRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM inspections ORDER BY inspected_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as unknown as RawInspectionRow[];
    return rows.map(mapInspectionRow);
  }

  close(): void {
    this.db.close();
  }
}
