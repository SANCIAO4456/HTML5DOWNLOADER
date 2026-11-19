import type {
  InspectedBook,
  InspectionSummary,
  JobRecord,
  OutputFormat,
  QualityPreset,
} from '../types';

const API_BASE = '/api';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function inspectBookUrl(url: string): Promise<InspectedBook> {
  return requestJson<InspectedBook>(`${API_BASE}/inspect`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function listRecentInspections(): Promise<InspectionSummary[]> {
  const data = await requestJson<{ inspections: InspectionSummary[] }>(
    `${API_BASE}/inspections`,
  );
  return data.inspections;
}

export async function listJobs(): Promise<JobRecord[]> {
  const data = await requestJson<{ jobs: JobRecord[] }>(`${API_BASE}/jobs`);
  return data.jobs;
}

export async function createDownloadJob(params: {
  url: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  title?: string;
}): Promise<JobRecord> {
  const data = await requestJson<{ job: JobRecord }>(`${API_BASE}/jobs`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.job;
}

export async function cancelJob(jobId: string): Promise<JobRecord> {
  const data = await requestJson<{ job: JobRecord }>(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
  return data.job;
}

export async function deleteJob(jobId: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/jobs/${encodeURIComponent(jobId)}/download`;
}

export function getProxiedImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  return `${API_BASE}/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

export function subscribeToJob(
  jobId: string,
  onUpdate: (job: JobRecord) => void,
): () => void {
  const source = new EventSource(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/events`,
  );

  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as JobRecord;
      onUpdate(parsed);
      if (
        parsed.status === 'completed' ||
        parsed.status === 'failed' ||
        parsed.status === 'cancelled'
      ) {
        source.close();
      }
    } catch {
      // Ignore malformed SSE packets
    }
  };

  source.onerror = () => {
    source.close();
  };

  return () => {
    source.close();
  };
}
