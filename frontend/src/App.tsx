import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelJob,
  checkHealth,
  createDownloadJob,
  deleteJob,
  inspectBookUrl,
  listJobs,
  listRecentInspections,
  subscribeToJob,
} from './api/client';
import { ActiveJobsPanel } from './components/ActiveJobsPanel';
import { BookPreviewCard } from './components/BookPreviewCard';
import { Header } from './components/Header';
import { HistoryList } from './components/HistoryList';
import { UrlInspector } from './components/UrlInspector';
import {
  isActiveStatus,
  type InspectedBook,
  type InspectionSummary,
  type JobRecord,
  type OutputFormat,
  type QualityPreset,
} from './types';

export function App() {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectedBook, setInspectedBook] = useState<InspectedBook | null>(null);
  const [recentInspections, setRecentInspections] = useState<InspectionSummary[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [submittingJob, setSubmittingJob] = useState(false);

  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());

  const upsertJob = useCallback((updated: JobRecord) => {
    setJobs((prev) => {
      const exists = prev.some((item) => item.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((item) => (item.id === updated.id ? updated : item));
    });
  }, []);

  const ensureJobSubscription = useCallback(
    (job: JobRecord) => {
      if (!isActiveStatus(job.status)) return;
      if (subscriptionsRef.current.has(job.id)) return;

      const unsubscribe = subscribeToJob(job.id, (latest) => {
        upsertJob(latest);
        if (!isActiveStatus(latest.status)) {
          subscriptionsRef.current.get(job.id)?.();
          subscriptionsRef.current.delete(job.id);
        }
      });

      subscriptionsRef.current.set(job.id, unsubscribe);
    },
    [upsertJob],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const healthy = await checkHealth();
      if (cancelled) return;
      setApiOnline(healthy);
      if (!healthy) return;

      try {
        const [loadedJobs, loadedInspections] = await Promise.all([
          listJobs(),
          listRecentInspections(),
        ]);
        if (cancelled) return;
        setJobs(loadedJobs);
        setRecentInspections(loadedInspections);
        loadedJobs.forEach(ensureJobSubscription);
      } catch {
        // Keep UI responsive even if initial refresh partially fails
      }
    }

    void bootstrap();
    const subs = subscriptionsRef.current;
    return () => {
      cancelled = true;
      subs.forEach((unsub) => unsub());
      subs.clear();
    };
  }, [ensureJobSubscription]);

  const handleInspect = useCallback(async (targetUrl?: string) => {
    const candidate = (targetUrl ?? urlInput).trim();
    if (!candidate) return;

    setInspectLoading(true);
    setInspectError(null);
    try {
      const result = await inspectBookUrl(candidate);
      setInspectedBook(result);
      setUrlInput(result.url);
      const updatedRecent = await listRecentInspections().catch(() => null);
      if (updatedRecent) {
        setRecentInspections(updatedRecent);
      }
    } catch (error) {
      setInspectedBook(null);
      setInspectError(
        error instanceof Error ? error.message : 'Unable to inspect FlipHTML5 link.',
      );
    } finally {
      setInspectLoading(false);
    }
  }, [urlInput]);

  const handleStartDownload = useCallback(
    async (config: {
      url: string;
      title: string;
      format: OutputFormat;
      quality: QualityPreset;
      pageRange: string;
    }) => {
      setSubmittingJob(true);
      setInspectError(null);
      try {
        const job = await createDownloadJob(config);
        upsertJob(job);
        ensureJobSubscription(job);
      } catch (error) {
        setInspectError(
          error instanceof Error ? error.message : 'Failed to start download job.',
        );
      } finally {
        setSubmittingJob(false);
      }
    },
    [ensureJobSubscription, upsertJob],
  );

  const handleCancelJob = useCallback(
    async (jobId: string) => {
      try {
        const updated = await cancelJob(jobId);
        upsertJob(updated);
      } catch {
        // Ignore cancellation errors if job already completed
      }
    },
    [upsertJob],
  );

  const handleDeleteJob = useCallback(async (jobId: string) => {
    subscriptionsRef.current.get(jobId)?.();
    subscriptionsRef.current.delete(jobId);

    try {
      await deleteJob(jobId);
      setJobs((prev) => prev.filter((item) => item.id !== jobId));
    } catch (error) {
      setInspectError(
        error instanceof Error ? error.message : 'Failed to delete record.',
      );
    }
  }, []);

  const activeJobs = jobs.filter((job) => isActiveStatus(job.status));

  return (
    <>
      <Header apiOnline={apiOnline} jobCount={jobs.length} />

      <main className="page-main">
        <UrlInspector
          url={urlInput}
          onUrlChange={setUrlInput}
          onInspect={handleInspect}
          loading={inspectLoading}
          error={inspectError}
          recentInspections={recentInspections}
        />

        {inspectedBook && (
          <BookPreviewCard
            key={inspectedBook.url}
            book={inspectedBook}
            submitting={submittingJob}
            onStartDownload={handleStartDownload}
            onDismiss={() => setInspectedBook(null)}
          />
        )}

        <ActiveJobsPanel jobs={activeJobs} onCancel={handleCancelJob} />

        <HistoryList
          jobs={jobs}
          onDelete={handleDeleteJob}
          onReinspect={(targetUrl) => {
            setUrlInput(targetUrl);
            void handleInspect(targetUrl);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />

        <section className="guide-strip" aria-label="How FlipDown works">
          <div className="guide-item">
            <h3>High-Fidelity PDF Export</h3>
            <p>
              Every WebP, PNG, or JPEG page is normalized via Sharp and assembled
              with pdf-lib, preserving exact page proportions and document metadata.
            </p>
          </div>
          <div className="guide-item">
            <h3>Zero-Server Offline HTML5</h3>
            <p>
              Unzip the HTML5 package and double-click <code>index.html</code>. It
              includes a standalone spread/single-page reader with zoom and keyboard
              navigation that works completely offline.
            </p>
          </div>
          <div className="guide-item">
            <h3>SQLite Archive History</h3>
            <p>
              All inspections and generated archives are tracked locally in SQLite so
              you can monitor progress live via SSE and re-download or clean up files
              at any time.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

export default App;
