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

export interface SamplePage {
  pageNumber: number;
  thumbUrl: string | null;
}

export interface InspectedBook {
  url: string;
  bookSlug: string;
  title: string;
  description: string | null;
  totalPages: number;
  pageWidth: number | null;
  pageHeight: number | null;
  coverUrl: string | null;
  samplePages: SamplePage[];
}

export interface InspectionSummary {
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

export function isActiveStatus(status: JobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'fetching_meta' ||
    status === 'downloading' ||
    status === 'packaging'
  );
}
