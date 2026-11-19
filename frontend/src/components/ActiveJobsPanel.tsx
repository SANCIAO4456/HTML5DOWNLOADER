import type { JobRecord } from '../types';

interface ActiveJobsPanelProps {
  jobs: JobRecord[];
  onCancel: (jobId: string) => void;
}

function describePhase(job: JobRecord): string {
  switch (job.status) {
    case 'queued':
      return 'Queued...';
    case 'fetching_meta':
      return 'Reading publication manifest...';
    case 'downloading':
      return job.selectedPages > 0
        ? `Fetching page ${job.downloadedPages} of ${job.selectedPages}`
        : 'Fetching pages...';
    case 'packaging':
      return job.format === 'pdf'
        ? 'Compiling PDF document...'
        : 'Bundling offline HTML5 reader...';
    default:
      return job.status;
  }
}

export function ActiveJobsPanel({ jobs, onCancel }: ActiveJobsPanelProps) {
  if (jobs.length === 0) return null;

  return (
    <section className="active-jobs-stack" aria-label="Active downloads">
      {jobs.map((job) => (
        <article className="active-job-card" key={job.id}>
          <div className="active-job-top">
            <div>
              <h2 className="active-job-title">{job.title}</h2>
              <span className="active-job-phase">{describePhase(job)}</span>
            </div>
            <button
              type="button"
              className="cancel-btn"
              onClick={() => onCancel(job.id)}
            >
              Cancel
            </button>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, job.progress)}%` }}
            />
          </div>

          <div className="active-job-footer">
            <span>
              {job.format.toUpperCase()} &middot; {job.quality} &middot; pages:{' '}
              {job.pageRange}
            </span>
            <span>{job.progress}%</span>
          </div>
        </article>
      ))}
    </section>
  );
}
