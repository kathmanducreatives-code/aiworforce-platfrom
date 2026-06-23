// LocalStorage-backed recent runs for the Workflows page.
// Persistence in DB is a follow-up; this gives us an honest "Recent Runs"
// experience now without inventing schema.

const KEY = 'agentory.workflow.recent_runs.v1';
const MAX = 25;

export type RecentRunStatus = 'running' | 'complete' | 'partial' | 'failed' | 'blocked' | 'needs_approval';

export interface RecentRun {
  id: string;
  workflowId: string;
  workflowTitle: string;
  category: string;
  agents: string[];
  inputSummary: string;
  status: RecentRunStatus;
  conversationId?: string | null;
  createdAt: number;
}

function read(): RecentRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(rows: RecentRun[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX))); } catch { /* ignore */ }
}

export function listRecentRuns(): RecentRun[] { return read(); }

export function recordRun(run: RecentRun): void {
  const rows = read();
  rows.unshift(run);
  write(rows);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workflow:run-recorded'));
  }
}

export function updateRun(id: string, patch: Partial<RecentRun>): void {
  const rows = read().map((r) => (r.id === id ? { ...r, ...patch } : r));
  write(rows);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workflow:run-recorded'));
  }
}

export function summarizeInputs(values: Record<string, string | number | string[]>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' · ');
}
