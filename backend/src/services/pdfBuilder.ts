import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { QualityPreset } from '../db/database.js';

export interface PageImageInput {
  pageNumber: number;
  buffer: Buffer;
}

export interface PdfBuildOptions {
  title: string;
  sourceUrl: string;
  quality: QualityPreset;
  outputPath: string;
  onProgress?: (completed: number, total: number) => void;
}

interface QualitySettings {
  maxWidth: number | null;
  jpegQuality: number;
}

const QUALITY_MAP: Record<QualityPreset, QualitySettings> = {
  original: { maxWidth: null, jpegQuality: 94 },
  high: { maxWidth: 1800, jpegQuality: 86 },
  medium: { maxWidth: 1280, jpegQuality: 76 },
  compact: { maxWidth: 960, jpegQuality: 62 },
};

/**
 * Converts a page image buffer to a normalized JPEG suitable for PDF embedding
 * and offline bundling, applying optional downscaling and compression.
 */
export async function normalizePageImage(
  buffer: Buffer,
  quality: QualityPreset,
): Promise<{ jpegBuffer: Buffer; width: number; height: number }> {
  const settings = QUALITY_MAP[quality];
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();

  const meta = await pipeline.metadata();
  if (settings.maxWidth && meta.width && meta.width > settings.maxWidth) {
    pipeline = pipeline.resize({
      width: settings.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    });
  }

  // Flatten alpha onto crisp white background since flipbook pages are opaque paper
  const { data, info } = await pipeline
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: settings.jpegQuality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    jpegBuffer: data,
    width: info.width,
    height: info.height,
  };
}

/**
 * Combines downloaded flipbook page images into a properly proportioned multi-page PDF.
 */
export async function buildPdfFromPages(
  pages: PageImageInput[],
  options: PdfBuildOptions,
): Promise<{ outputPath: string; fileSize: number }> {
  if (pages.length === 0) {
    throw new Error('Cannot generate PDF with zero pages.');
  }

  const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pdfDoc = await PDFDocument.create();

  pdfDoc.setTitle(options.title);
  pdfDoc.setSubject(`Archived from ${options.sourceUrl}`);
  pdfDoc.setCreator('FlipDown — FlipHTML5 Downloader');
  pdfDoc.setProducer('FlipDown (pdf-lib + sharp)');
  pdfDoc.setCreationDate(new Date());

  for (let i = 0; i < orderedPages.length; i += 1) {
    const pageInput = orderedPages[i];
    const { jpegBuffer, width, height } = await normalizePageImage(
      pageInput.buffer,
      options.quality,
    );

    const embedded = await pdfDoc.embedJpg(jpegBuffer);

    // Scale oversized pixel dimensions into standard PDF points (72pt/in) while preserving exact aspect ratio
    const maxPdfDimension = 1200;
    const scale =
      Math.max(width, height) > maxPdfDimension
        ? maxPdfDimension / Math.max(width, height)
        : 1;
    const pdfWidth = Math.max(72, Math.round(width * scale * 100) / 100);
    const pdfHeight = Math.max(72, Math.round(height * scale * 100) / 100);

    const page = pdfDoc.addPage([pdfWidth, pdfHeight]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pdfWidth,
      height: pdfHeight,
    });

    options.onProgress?.(i + 1, orderedPages.length);
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, pdfBytes);

  return {
    outputPath: options.outputPath,
    fileSize: pdfBytes.byteLength,
  };
}
