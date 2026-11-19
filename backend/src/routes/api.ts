import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { isAllowedFlipHost, REQUEST_TIMEOUT_MS, USER_AGENT } from '../config.js';
import type {
  FlipDownDatabase,
  OutputFormat,
  QualityPreset,
} from '../db/database.js';
import { detectImageMime, FlipHtml5Error } from '../services/fliphtml5.js';
import type { JobManager } from '../services/jobManager.js';
import { PageRangeError } from '../services/pageRange.js';

const VALID_FORMATS = new Set<OutputFormat>(['pdf', 'html5']);
const VALID_QUALITIES = new Set<QualityPreset>([
  'original',
  'high',
  'medium',
  'compact',
]);

function getParamId(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

export function createApiRouter(
  db: FlipDownDatabase,
  jobManager: JobManager,
): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'FlipDown API',
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/inspect', async (req: Request, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    try {
      const metadata = await jobManager.inspect(url);
      res.json({
        url: metadata.url,
        bookSlug: metadata.bookSlug,
        title: metadata.title,
        description: metadata.description,
        totalPages: metadata.totalPages,
        pageWidth: metadata.pageWidth,
        pageHeight: metadata.pageHeight,
        coverUrl: metadata.coverUrl,
        samplePages: metadata.pages.slice(0, 6).map((p) => ({
          pageNumber: p.pageNumber,
          thumbUrl: p.thumbUrl,
        })),
      });
    } catch (error) {
      const status =
        error instanceof FlipHtml5Error ? error.statusCode : 500;
      const message =
        error instanceof Error ? error.message : 'Failed to inspect URL.';
      res.status(status).json({ error: message });
    }
  });

  router.get('/inspections', (_req: Request, res: Response) => {
    res.json({ inspections: db.listRecentInspections(12) });
  });

  router.get('/jobs', (_req: Request, res: Response) => {
    res.json({ jobs: db.listJobs(50) });
  });

  router.post('/jobs', (req: Request, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    const format = (req.body?.format ?? 'pdf') as OutputFormat;
    const quality = (req.body?.quality ?? 'high') as QualityPreset;
    const pageRange =
      typeof req.body?.pageRange === 'string' ? req.body.pageRange : 'all';
    const customTitle =
      typeof req.body?.title === 'string' ? req.body.title : undefined;

    if (!VALID_FORMATS.has(format)) {
      res.status(400).json({ error: 'Format must be either "pdf" or "html5".' });
      return;
    }

    if (!VALID_QUALITIES.has(quality)) {
      res.status(400).json({
        error: 'Quality must be one of: original, high, medium, compact.',
      });
      return;
    }

    try {
      const job = jobManager.startJob({
        url,
        format,
        quality,
        pageRange,
        customTitle,
      });
      res.status(201).json({ job });
    } catch (error) {
      const status =
        error instanceof FlipHtml5Error
          ? error.statusCode
          : error instanceof PageRangeError
            ? 400
            : 500;
      const message =
        error instanceof Error ? error.message : 'Failed to start download job.';
      res.status(status).json({ error: message });
    }
  });

  router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = db.getJob(getParamId(req));
    if (!job) {
      res.status(404).json({ error: 'Download job not found.' });
      return;
    }
    res.json({ job });
  });

  router.get('/jobs/:id/events', (req: Request, res: Response) => {
    const id = getParamId(req);
    const job = db.getJob(id);
    if (!job) {
      res.status(404).json({ error: 'Download job not found.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload: typeof job) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send(job);

    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      res.end();
      return;
    }

    const unsubscribe = jobManager.subscribe(id, (updated) => {
      send(updated);
      if (
        updated.status === 'completed' ||
        updated.status === 'failed' ||
        updated.status === 'cancelled'
      ) {
        unsubscribe();
        res.end();
      }
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post('/jobs/:id/cancel', (req: Request, res: Response) => {
    const job = jobManager.cancelJob(getParamId(req));
    if (!job) {
      res.status(404).json({ error: 'Download job not found.' });
      return;
    }
    res.json({ job });
  });

  router.get('/jobs/:id/download', (req: Request, res: Response) => {
    const job = db.getJob(getParamId(req));
    if (!job) {
      res.status(404).json({ error: 'Download job not found.' });
      return;
    }

    if (job.status !== 'completed' || !job.outputPath || !job.outputFilename) {
      res.status(409).json({ error: 'File is not ready for download yet.' });
      return;
    }

    if (!fs.existsSync(job.outputPath)) {
      res.status(410).json({ error: 'Generated file is no longer available on disk.' });
      return;
    }

    const contentType =
      job.format === 'pdf' ? 'application/pdf' : 'application/zip';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${job.outputFilename.replace(/"/g, '')}"`,
    );
    res.sendFile(job.outputPath);
  });

  router.delete('/jobs/:id', async (req: Request, res: Response) => {
    const deleted = await jobManager.deleteJob(getParamId(req));
    if (!deleted) {
      res.status(404).json({ error: 'Download job not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.get('/proxy/image', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing image url parameter.' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid image URL.' });
      return;
    }

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !isAllowedFlipHost(parsed.hostname)
    ) {
      res.status(403).json({ error: 'Image proxy only supports FlipHTML5 hosts.' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${parsed.origin}/`,
        },
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const mime = detectImageMime(buffer);
      if (!mime) {
        res.status(415).end();
        return;
      }

      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
    } catch {
      res.status(502).end();
    } finally {
      clearTimeout(timeout);
    }
  });

  return router;
}
