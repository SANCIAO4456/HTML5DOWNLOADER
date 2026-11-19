import type {
  InspectedBook,
  InspectionSummary,
  JobRecord,
  OutputFormat,
  QualityPreset,
} from '../types';

const API_BASE_STORAGE_KEY = 'flipdown_custom_api_base';

export function isGitHubPagesHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.endsWith('.github.io');
}

export function getCustomApiBase(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(API_BASE_STORAGE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function setCustomApiBase(rawUrl: string): string {
  const normalized = rawUrl.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }
  return normalized;
}

export function resolveApiPrefix(): string {
  const custom = getCustomApiBase();
  if (custom) return `${custom}/api`;
  return '/api';
}

export function hasConfiguredBackend(): boolean {
  if (getCustomApiBase()) return true;
  return !isGitHubPagesHost();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${resolveApiPrefix()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      isGitHubPagesHost() && !getCustomApiBase()
        ? 'GitHub Pages hosts static files only. Connect a running FlipDown Backend URL (top-right Settings) to inspect FlipHTML5 links, or switch to the Local Pages Studio tab.'
        : 'Unable to reach the FlipDown Backend API. Verify that the server is running and CORS is enabled.',
    );
  }

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

export async function checkHealth(overrideBase?: string): Promise<boolean> {
  const prefix =
    overrideBase !== undefined
      ? overrideBase.trim()
        ? `${overrideBase.trim().replace(/\/+$/, '').replace(/\/api$/i, '')}/api`
        : '/api'
      : resolveApiPrefix();

  if (overrideBase === undefined && !hasConfiguredBackend()) {
    return false;
  }

  try {
    const res = await fetch(`${prefix}/health`);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

export async function inspectBookUrl(url: string): Promise<InspectedBook> {
  return requestJson<InspectedBook>('/inspect', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function listRecentInspections(): Promise<InspectionSummary[]> {
  const data = await requestJson<{ inspections: InspectionSummary[] }>(
    '/inspections',
  );
  return data.inspections;
}

export async function listJobs(): Promise<JobRecord[]> {
  const data = await requestJson<{ jobs: JobRecord[] }>('/jobs');
  return data.jobs;
}

export async function createDownloadJob(params: {
  url: string;
  format: OutputFormat;
  quality: QualityPreset;
  pageRange: string;
  title?: string;
}): Promise<JobRecord> {
  const data = await requestJson<{ job: JobRecord }>('/jobs', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.job;
}

export async function cancelJob(jobId: string): Promise<JobRecord> {
  const data = await requestJson<{ job: JobRecord }>(
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
  return data.job;
}

export async function deleteJob(jobId: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
}

export function getDownloadUrl(jobId: string): string {
  return `${resolveApiPrefix()}/jobs/${encodeURIComponent(jobId)}/download`;
}

export function getProxiedImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  return `${resolveApiPrefix()}/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

export function subscribeToJob(
  jobId: string,
  onUpdate: (job: JobRecord) => void,
): () => void {
  const source = new EventSource(
    `${resolveApiPrefix()}/jobs/${encodeURIComponent(jobId)}/events`,
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
