// OPS HEALTH — THE NUMBERS THAT SAY THE BETA IS BROKEN, AND WHEN TO SAY SO.
//
// The system heals some failures on its own (cron sweeps stuck runs, resumes
// stalled leads) and tells nobody about any of them. This reads the handful of
// signals that mean "a person should look", evaluates them against thresholds,
// and returns AGGREGATES ONLY — counts, ages and dollar totals, never a
// workspace id, a user, a query or a result — so the only credential an
// external checker holds (the ops token) can reveal nothing about a customer.
//
// Read by the `ops-health` edge function; alerted on by
// .github/workflows/ops-health.yml through scripts/ops/check-health.ts.

export const OPS_HEALTH_VERSION = "ops-health-v1" as const;

export interface OpsSnapshot {
  version: typeof OPS_HEALTH_VERSION;
  at: string;
  queue: {
    /** `running` with a lease that expired over 5 minutes ago: the reclaim did not happen. */
    stuck_running: number;
    /** Claimable (queued/resumable, due) for over 15 minutes: no worker is claiming. */
    unclaimed_waiting: number;
    oldest_unclaimed_minutes: number | null;
    completed_24h: number;
    failed_24h: number;
  };
  /** Legacy-path tasks still `running` with no update for 30 minutes. */
  stale_running_tasks: number;
  /** Paid provider calls still open an hour after they started: money in an unknown state. */
  unsettled_provider_calls: number;
  spend_24h: {
    provider_usd: number;
    model_usd: number;
    /** The single largest workspace's provider spend — the value, not the workspace. */
    top_workspace_provider_usd: number;
    /** True when a read hit its row cap, so a total is a lower bound. */
    truncated: boolean;
  };
  beta: { pending_requests: number; oldest_pending_hours: number | null };
}

export interface OpsThresholds {
  failed_24h: number;
  provider_usd_24h: number;
  model_usd_24h: number;
  top_workspace_provider_usd_24h: number;
  beta_pending_hours: number;
}

/** Defaults sized for a small beta; every one can be overridden by env (OPS_ALERT_*). */
export const DEFAULT_OPS_THRESHOLDS: Readonly<OpsThresholds> = Object.freeze({
  failed_24h: 3,
  provider_usd_24h: 10,
  model_usd_24h: 5,
  top_workspace_provider_usd_24h: 5,
  beta_pending_hours: 48,
});

export function resolveOpsThresholds(read: (k: string) => string | undefined): OpsThresholds {
  const num = (k: string, d: number) => {
    const n = Number(String(read(k) ?? "").trim());
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const d = DEFAULT_OPS_THRESHOLDS;
  return {
    failed_24h: num("OPS_ALERT_FAILED_24H", d.failed_24h),
    provider_usd_24h: num("OPS_ALERT_PROVIDER_USD_24H", d.provider_usd_24h),
    model_usd_24h: num("OPS_ALERT_MODEL_USD_24H", d.model_usd_24h),
    top_workspace_provider_usd_24h: num("OPS_ALERT_TOP_WORKSPACE_USD_24H", d.top_workspace_provider_usd_24h),
    beta_pending_hours: num("OPS_ALERT_BETA_PENDING_HOURS", d.beta_pending_hours),
  };
}

export interface OpsAlert {
  /** `critical`: the product is not working for someone right now. `warn`: look today. */
  severity: "critical" | "warn";
  code: string;
  detail: string;
}

/** Pure: which signals cross which line. */
export function evaluateOpsHealth(s: OpsSnapshot, t: OpsThresholds = DEFAULT_OPS_THRESHOLDS): OpsAlert[] {
  const a: OpsAlert[] = [];
  const usd = (n: number) => `$${n.toFixed(2)}`;
  if (s.queue.stuck_running > 0) {
    a.push({ severity: "critical", code: "queue_stuck_running",
      detail: `${s.queue.stuck_running} Lead V2 mission(s) running on an expired lease — the reclaim did not happen` });
  }
  if (s.queue.unclaimed_waiting > 0) {
    a.push({ severity: "critical", code: "queue_unclaimed",
      detail: `${s.queue.unclaimed_waiting} mission(s) waiting ${s.queue.oldest_unclaimed_minutes ?? "?"}+ min with no worker claiming — is the Railway worker up?` });
  }
  if (s.queue.failed_24h >= t.failed_24h) {
    a.push({ severity: "warn", code: "queue_failures",
      detail: `${s.queue.failed_24h} mission(s) failed in 24h (${s.queue.completed_24h} completed)` });
  }
  if (s.stale_running_tasks > 0) {
    a.push({ severity: "warn", code: "tasks_stale_running", detail: `${s.stale_running_tasks} task(s) 'running' with no update for 30+ min` });
  }
  if (s.unsettled_provider_calls > 0) {
    a.push({ severity: "warn", code: "provider_calls_unsettled",
      detail: `${s.unsettled_provider_calls} paid provider call(s) still open after 1h — spend in an unknown state` });
  }
  if (s.spend_24h.provider_usd > t.provider_usd_24h) {
    a.push({ severity: "warn", code: "provider_spend_high", detail: `provider spend ${usd(s.spend_24h.provider_usd)} in 24h (alert above ${usd(t.provider_usd_24h)})` });
  }
  if (s.spend_24h.model_usd > t.model_usd_24h) {
    a.push({ severity: "warn", code: "model_spend_high", detail: `model spend ${usd(s.spend_24h.model_usd)} in 24h (alert above ${usd(t.model_usd_24h)})` });
  }
  if (s.spend_24h.top_workspace_provider_usd > t.top_workspace_provider_usd_24h) {
    a.push({ severity: "warn", code: "workspace_spend_high",
      detail: `one workspace spent ${usd(s.spend_24h.top_workspace_provider_usd)} on providers in 24h (alert above ${usd(t.top_workspace_provider_usd_24h)})` });
  }
  if (s.beta.pending_requests > 0 && (s.beta.oldest_pending_hours ?? 0) > t.beta_pending_hours) {
    a.push({ severity: "warn", code: "beta_requests_waiting",
      detail: `${s.beta.pending_requests} beta request(s) waiting; the oldest ${s.beta.oldest_pending_hours}h` });
  }
  return a;
}

// ─────────────────────────────────────────────────────────── reading ──

type Rows = Array<Record<string, unknown>>;
/** The reads the snapshot needs, injected so a test can answer them. */
export interface OpsDb {
  count(table: string, filters: Array<[string, string, unknown]>): Promise<number>;
  rows(table: string, columns: string, filters: Array<[string, string, unknown]>, limit: number): Promise<Rows>;
}

export const OPS_ROW_CAP = 5000;
const minutesAgo = (now: number, m: number) => new Date(now - m * 60_000).toISOString();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function readOpsSnapshot(db: OpsDb, now: number = Date.now()): Promise<OpsSnapshot> {
  const day = minutesAgo(now, 24 * 60);
  const [stuck, waitingRows, completed, failed, staleTasks, unsettled, calls, models, pending] = await Promise.all([
    db.count("lead_mission_queue", [["status", "eq", "running"], ["lease_expires_at", "lt", minutesAgo(now, 5)]]),
    db.rows("lead_mission_queue", "updated_at", [["status", "in", ["queued", "resumable"]], ["updated_at", "lt", minutesAgo(now, 15)]], OPS_ROW_CAP),
    db.count("lead_mission_queue", [["status", "eq", "complete"], ["updated_at", "gte", day]]),
    db.count("lead_mission_queue", [["status", "eq", "failed"], ["updated_at", "gte", day]]),
    db.count("tasks", [["status", "eq", "running"], ["updated_at", "lt", minutesAgo(now, 30)]]),
    // `started` is the one in-flight status (lead_execution_calls_status_check:
    // started | succeeded | failed | timed_out | reused); a finished attempt
    // rewrites its row, so a `started` row an hour old is a call nobody closed.
    db.count("lead_execution_calls", [["record_kind", "eq", "provider_call"], ["status", "eq", "started"], ["created_at", "lt", minutesAgo(now, 60)]]),
    db.rows("lead_execution_calls", "workspace_id, provider_call_id, settled_usd, actual_cost_usd, estimated_cost_usd", [["record_kind", "eq", "provider_call"], ["created_at", "gte", day]], OPS_ROW_CAP),
    db.rows("lead_model_calls", "actual_cost_usd, estimated_cost_usd", [["started_at", "gte", day]], OPS_ROW_CAP),
    db.rows("beta_access_requests", "created_at", [["status", "eq", "pending"]], OPS_ROW_CAP),
  ]);

  // Once per provider call: a resumed run writes another row under the same id.
  const perCall = new Map<string, { ws: string; usd: number }>();
  for (const r of calls) {
    const key = String(r.provider_call_id ?? `${r.workspace_id}:${perCall.size}`);
    const usd = Math.max(num(r.settled_usd), num(r.actual_cost_usd), num(r.estimated_cost_usd));
    const prev = perCall.get(key);
    if (!prev || usd > prev.usd) perCall.set(key, { ws: String(r.workspace_id ?? ""), usd });
  }
  const byWs = new Map<string, number>();
  for (const { ws, usd } of perCall.values()) byWs.set(ws, (byWs.get(ws) ?? 0) + usd);
  const provider = [...perCall.values()].reduce((s, x) => s + x.usd, 0);
  const model = models.reduce((s, r) => s + (r.actual_cost_usd != null ? num(r.actual_cost_usd) : num(r.estimated_cost_usd)), 0);
  const oldest = (rows: Rows, unit: number) => rows.length
    ? Math.floor((now - Math.min(...rows.map((r) => Date.parse(String(r.created_at ?? r.updated_at))))) / unit)
    : null;

  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    version: OPS_HEALTH_VERSION,
    at: new Date(now).toISOString(),
    queue: {
      stuck_running: stuck,
      unclaimed_waiting: waitingRows.length,
      oldest_unclaimed_minutes: oldest(waitingRows, 60_000),
      completed_24h: completed,
      failed_24h: failed,
    },
    stale_running_tasks: staleTasks,
    unsettled_provider_calls: unsettled,
    spend_24h: {
      provider_usd: round(provider),
      model_usd: round(model),
      top_workspace_provider_usd: round(Math.max(0, ...byWs.values())),
      truncated: calls.length >= OPS_ROW_CAP || models.length >= OPS_ROW_CAP,
    },
    beta: { pending_requests: pending.length, oldest_pending_hours: oldest(pending, 3_600_000) },
  };
}

// ─────────────────────────────────────────────────────────── the token ──

/** The ops token must be long enough to be a secret; a short one disables the endpoint. */
export const MIN_OPS_TOKEN_LENGTH = 32;

/** Constant-time comparison, so response timing reveals nothing about the token. */
export function opsTokenMatches(given: string | null, expected: string | null | undefined): boolean {
  if (!expected || expected.length < MIN_OPS_TOKEN_LENGTH || !given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
