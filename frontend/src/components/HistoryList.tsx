import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { getDownloadUrl } from '../api/client';
import { isActiveStatus, type JobRecord } from '../types';

interface HistoryListProps {
  jobs: JobRecord[];
  onDelete: (jobId: string) => void;
  onReinspect: (url: string) => void;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: JobRecord['status']): string {
  if (status === 'completed') return 'status-badge status-completed';
  if (status === 'failed') return 'status-badge status-failed';
  if (status === 'cancelled') return 'status-badge status-cancelled';
  return 'status-badge status-active';
}

export function HistoryList({
  jobs,
  onDelete,
  onReinspect,
}: HistoryListProps) {
  return (
    <section id="archive-history" aria-labelledby="archive-heading">
      <div className="section-header">
        <h2 id="archive-heading" className="section-title">
          Download Archive
        </h2>
        <span className="section-count">
          {jobs.length} {jobs.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      <div className="history-list">
        {jobs.length === 0 ? (
          <div className="empty-archive">
            No archived publications yet. Inspect a FlipHTML5 URL above to create
            your first PDF or offline HTML5 package.
          </div>
        ) : (
          jobs.map((job) => (
            <div className="history-row" key={job.id}>
              <div className="history-main">
                <div className="history-title-line">
                  <span className="history-title">{job.title}</span>
                  <span className="format-tag">
                    {job.format === 'pdf' ? 'PDF' : 'HTML5 ZIP'}
                  </span>
                  <span className={statusBadgeClass(job.status)}>
                    {isActiveStatus(job.status) ? `${job.progress}%` : job.status}
                  </span>
                </div>

                <div className="history-meta">
                  <span>
                    {job.selectedPages > 0
                      ? `${job.selectedPages} pages (${job.pageRange})`
                      : `range: ${job.pageRange}`}
                  </span>
                  <span>{job.quality}</span>
                  <span>{formatBytes(job.fileSize)}</span>
                  <span>{formatDate(job.createdAt)}</span>
                </div>

                {job.errorMessage && (
                  <p className="history-error">{job.errorMessage}</p>
                )}
              </div>

              <div className="history-actions">
                {job.status === 'completed' && (
                  <a
                    href={getDownloadUrl(job.id)}
                    download={job.outputFilename ?? undefined}
                    className="btn btn-primary btn-sm"
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>Save File</span>
                  </a>
                )}

                <button
                  type="button"
                  className="btn btn-ghost"
                  title="Inspect this book again"
                  onClick={() => onReinspect(job.url)}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  title="Delete record and output file"
                  onClick={() => onDelete(job.id)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
