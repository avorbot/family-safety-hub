export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `Request failed (${res.status})`, data);
  }
  return data as T;
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export const today = (): string => new Date().toLocaleDateString('en-CA');

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ---- Shapes returned by the API ----------------------------------------------

export interface Parent {
  id: number;
  name: string;
  email: string;
}

export interface Child {
  id: number;
  name: string;
  birthYear: number | null;
  dailyLimitMinutes: number;
  bedtimeStart: string | null;
  bedtimeEnd: string | null;
  pendingRequests?: number;
}

export interface Policy {
  day: string;
  dailyLimitMinutes: number;
  extraMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  limitReached: boolean;
  bedtime: { start: string; end: string } | null;
  blockedDomains: string[];
}

export interface UsageRow {
  label: string;
  category: string;
  minutes: number;
}

export interface TimeRequest {
  id: number;
  day: string;
  minutes: number;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  decidedAt: string | null;
}

export interface CheckIn {
  id: number;
  message: string;
  createdAt: string;
}

export interface Device {
  id: number;
  name: string;
  status: string;
  pairedAt: string | null;
  acknowledgedAt: string | null;
  lastSeenAt: string | null;
  pairingExpiresAt: string | null;
}

export interface Summary {
  child: Child;
  policy: Policy;
  usage: UsageRow[];
  week: { day: string; minutes: number }[];
  devices: Device[];
  blockedSites: { id: number; domain: string }[];
  timeRequests: TimeRequest[];
  checkIns: CheckIn[];
}

export interface Notice {
  title: string;
  summary: string;
  collected: string[];
  notCollected: string[];
  whoCanSee: string;
  yourControls: string;
}

export interface DeviceMe {
  childName: string;
  device: { id: number; name: string; acknowledgedAt: string | null };
  notice: Notice;
  policy: Policy;
  usage: UsageRow[];
  timeRequests: TimeRequest[];
  checkIns: CheckIn[];
}
