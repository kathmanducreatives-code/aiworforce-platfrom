// Radar scan history — pure, import-free, unit-testable. Groups persisted signals
// by raw.scan_run_id so the current scan's counters never mix with previous runs,
// while previous scans stay accessible. No migration: reads raw.scan_run_id.

export interface ScanScopedSignal {
  id?: string;
  created_at?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface ScanRun {
  scan_run_id: string;
  started_at: string | null;   // newest created_at in the run
  count: number;
}

function runId(s: ScanScopedSignal): string {
  const v = (s.raw ?? {})["scan_run_id"];
  return typeof v === "string" && v.trim() ? v : "legacy";
}
function ts(s: ScanScopedSignal): number {
  const t = Date.parse(s.created_at ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/** List runs newest-first. Legacy rows (no scan_run_id) group under "legacy". */
export function listScanRuns(signals: ScanScopedSignal[]): ScanRun[] {
  const byRun = new Map<string, ScanScopedSignal[]>();
  for (const s of signals) {
    const id = runId(s);
    (byRun.get(id) ?? byRun.set(id, []).get(id)!).push(s);
  }
  const runs: ScanRun[] = [];
  for (const [id, rows] of byRun) {
    const newest = rows.reduce((m, r) => Math.max(m, ts(r)), 0);
    runs.push({ scan_run_id: id, started_at: newest ? new Date(newest).toISOString() : null, count: rows.length });
  }
  // Newest run first; legacy last.
  return runs.sort((a, b) => {
    if (a.scan_run_id === "legacy") return 1;
    if (b.scan_run_id === "legacy") return -1;
    return (Date.parse(b.started_at ?? "") || 0) - (Date.parse(a.started_at ?? "") || 0);
  });
}

/** The current (newest) run id, or null when there are no signals. */
export function currentScanRunId(signals: ScanScopedSignal[]): string | null {
  const runs = listScanRuns(signals);
  return runs.length ? runs[0].scan_run_id : null;
}

/** Signals belonging to a specific run (defaults to the current run). */
export function signalsForRun<T extends ScanScopedSignal>(signals: T[], scanRunId: string | null): T[] {
  if (!scanRunId) return [];
  return signals.filter((s) => runId(s) === scanRunId);
}

/** Convenience: only the current scan's signals. */
export function currentScanSignals<T extends ScanScopedSignal>(signals: T[]): T[] {
  return signalsForRun(signals, currentScanRunId(signals));
}
