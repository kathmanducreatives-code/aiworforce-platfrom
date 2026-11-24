// THE LIVE WORKFORCE DASHBOARD MODEL. PURE.
//
// Built only from records the workspace holds: tasks, approvals, model-call
// ledger rows, agent handoffs, LISA signals and pending Company Brain
// proposals. A table that could not be read is marked `unavailable` and its
// numbers are null, never zero: an unreadable ledger must not look like a quiet
// week. Nothing here is fictional; the simulator lives at /dev/collaboration.

import { departmentOf, DEPARTMENTS, DEPARTMENT_PROFILES, type Department } from "./departments.ts";

export const WORKFORCE_DASHBOARD_VERSION = "workforce-dashboard-v1" as const;

type Row = Record<string, unknown>;
export interface DashboardInputs {
  now: Date;
  brainStatus: "missing" | "incomplete" | "ready" | "unavailable";
  tasks: Row[] | null;
  approvals: Row[] | null;
  modelCalls: Row[] | null;
  handoffs: Row[] | null;
  signals: Row[] | null;
  proposals: Row[] | null;
}

export type Availability = "live" | "unavailable";

export interface WorkforceDashboard {
  version: typeof WORKFORCE_DASHBOARD_VERSION;
  generated_at: string;
  data: "live";
  availability: Record<"tasks" | "approvals" | "spend" | "handoffs" | "signals" | "proposals", Availability>;
  orion_brief: string[];
  departments: Array<{
    id: Department; name: string; title: string;
    current: number | null; completed_7d: number | null; failed_7d: number | null; last_activity: string | null;
  }>;
  current_tasks: Array<{ id: string; department: string; title: string; status: string; started_at: string | null }>;
  completed_tasks: Array<{ id: string; department: string; title: string; finished_at: string | null }>;
  failures: Array<{ id: string; department: string; title: string; error: string; retry: "retried" | "not_retried" }>;
  pending_approvals: Array<{ id: string; title: string; type: string; created_at: string }>;
  findings: { signals_7d: number | null; verified_7d: number | null; contradicted_7d: number | null };
  handoffs: { awaiting_you: number | null; in_progress: number | null; completed: number | null; failed: number | null };
  spend: { actual_usd_7d: number | null; estimated_usd_7d: number | null; unpriced_calls_7d: number | null; calls_7d: number | null; retried_calls_7d: number | null };
  brain: { status: DashboardInputs["brainStatus"]; pending_proposals: number | null };
}

const DAY = 86_400_000;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const t = (v: unknown) => { const x = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(x) ? x : null; };
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (x: number) => Math.round(x * 10000) / 10000;

const RUNNING = new Set(["pending", "queued", "running", "in_progress", "awaiting_approval", "waiting"]);
const DONE = new Set(["completed", "done", "succeeded", "success"]);
const FAILED = new Set(["failed", "error", "errored", "cancelled_error"]);

function taskTitle(r: Row): string {
  const d = s(r.description) ?? s((r.input as Row | null)?.query) ?? s(r.agent_slug) ?? "task";
  return d.length > 120 ? d.slice(0, 117) + "…" : d;
}
const deptName = (slug: unknown): string => {
  const d = departmentOf(s(slug));
  return d ? DEPARTMENT_PROFILES[d].name : "Workforce";
};

export function buildWorkforceDashboard(i: DashboardInputs): WorkforceDashboard {
  const since = i.now.getTime() - 7 * DAY;
  const recent = (r: Row, ...keys: string[]) => keys.some((k) => (t(r[k]) ?? 0) >= since);
  const tasks = i.tasks ?? [];

  const departments = DEPARTMENTS.map((d) => {
    const mine = tasks.filter((r) => departmentOf(s(r.agent_slug)) === d);
    const last = mine.map((r) => s(r.updated_at) ?? s(r.created_at)).filter(Boolean).sort().pop() ?? null;
    return {
      id: d, name: DEPARTMENT_PROFILES[d].name, title: DEPARTMENT_PROFILES[d].title,
      current: i.tasks ? mine.filter((r) => RUNNING.has(String(r.status))).length : null,
      completed_7d: i.tasks ? mine.filter((r) => DONE.has(String(r.status)) && recent(r, "finished_at", "completed_at", "updated_at")).length : null,
      failed_7d: i.tasks ? mine.filter((r) => FAILED.has(String(r.status)) && recent(r, "updated_at", "created_at")).length : null,
      last_activity: last,
    };
  });

  const current_tasks = tasks.filter((r) => RUNNING.has(String(r.status))).slice(0, 10).map((r) => ({
    id: String(r.id), department: deptName(r.agent_slug), title: taskTitle(r), status: String(r.status), started_at: s(r.started_at),
  }));
  const completed_tasks = tasks.filter((r) => DONE.has(String(r.status))).slice(0, 10).map((r) => ({
    id: String(r.id), department: deptName(r.agent_slug), title: taskTitle(r), finished_at: s(r.finished_at) ?? s(r.completed_at),
  }));
  // A failed task whose lineage has a later attempt was retried.
  const failures = tasks.filter((r) => FAILED.has(String(r.status))).slice(0, 10).map((r) => {
    const lineage = s(r.lineage_id);
    const retried = !!lineage && tasks.some((o) => o.id !== r.id && s(o.lineage_id) === lineage && (t(o.created_at) ?? 0) > (t(r.created_at) ?? 0));
    return { id: String(r.id), department: deptName(r.agent_slug), title: taskTitle(r),
      error: (s(r.error_message) ?? "no error recorded").slice(0, 200), retry: retried ? "retried" as const : "not_retried" as const };
  });

  const pending_approvals = (i.approvals ?? []).filter((r) => r.status === "pending").slice(0, 20).map((r) => ({
    id: String(r.id), title: s(r.title) ?? s(r.summary) ?? "Approval", type: s(r.type) ?? "action", created_at: String(r.created_at ?? ""),
  }));

  const calls = (i.modelCalls ?? []).filter((r) => recent(r, "started_at", "finished_at"));
  const actual = calls.reduce((a, r) => a + (n(r.actual_cost_usd) ?? 0), 0);
  const estimated = calls.filter((r) => n(r.actual_cost_usd) == null).reduce((a, r) => a + (n(r.estimated_cost_usd) ?? 0), 0);
  const unpriced = calls.filter((r) => n(r.actual_cost_usd) == null && n(r.estimated_cost_usd) == null).length;

  const sig = (i.signals ?? []).filter((r) => recent(r, "observed_at"));
  const level = (r: Row) => s(((r.normalized_value as Row | null)?.lisa as Row | undefined)?.verification &&
    (((r.normalized_value as Row).lisa as Row).verification as Row).level);
  const hs = i.handoffs ?? [];

  const d = {
    awaiting: i.handoffs ? hs.filter((r) => r.status === "awaiting_review").length : null,
    progress: i.handoffs ? hs.filter((r) => ["approved", "queued", "running"].includes(String(r.status))).length : null,
    done: i.handoffs ? hs.filter((r) => ["completed", "partially_completed"].includes(String(r.status))).length : null,
    failed: i.handoffs ? hs.filter((r) => ["failed", "blocked"].includes(String(r.status))).length : null,
  };
  const pendingProposals = i.proposals ? i.proposals.filter((r) => r.approval_status === "pending").length : null;

  // ORION's brief: only counts this dashboard can see, each stated as a fact.
  const brief: string[] = [];
  if (pending_approvals.length) brief.push(`${pending_approvals.length} approval${pending_approvals.length === 1 ? "" : "s"} waiting for you.`);
  if (d.awaiting) brief.push(`${d.awaiting} agent handoff${d.awaiting === 1 ? "" : "s"} awaiting your review.`);
  if (failures.length) brief.push(`${failures.length} recent task failure${failures.length === 1 ? "" : "s"}${failures.some((f) => f.retry === "not_retried") ? ", not all retried" : ""}.`);
  if (i.signals) brief.push(`LISA logged ${sig.length} signal${sig.length === 1 ? "" : "s"} this week, ${sig.filter((r) => level(r) === "corroborated").length} verified.`);
  if (pendingProposals) brief.push(`${pendingProposals} Company Brain proposal${pendingProposals === 1 ? "" : "s"} to review.`);
  if (i.brainStatus !== "ready") brief.push(`Company Brain is ${i.brainStatus}: agents work without a full ICP.`);
  if (!brief.length) brief.push("Nothing needs your attention right now.");

  return {
    version: WORKFORCE_DASHBOARD_VERSION, generated_at: i.now.toISOString(), data: "live",
    availability: {
      tasks: i.tasks ? "live" : "unavailable", approvals: i.approvals ? "live" : "unavailable",
      spend: i.modelCalls ? "live" : "unavailable", handoffs: i.handoffs ? "live" : "unavailable",
      signals: i.signals ? "live" : "unavailable", proposals: i.proposals ? "live" : "unavailable",
    },
    orion_brief: brief, departments, current_tasks, completed_tasks, failures, pending_approvals,
    findings: {
      signals_7d: i.signals ? sig.length : null,
      verified_7d: i.signals ? sig.filter((r) => level(r) === "corroborated").length : null,
      contradicted_7d: i.signals ? sig.filter((r) => level(r) === "contradicted" || r.lifecycle_status === "contradicted").length : null,
    },
    handoffs: { awaiting_you: d.awaiting, in_progress: d.progress, completed: d.done, failed: d.failed },
    spend: i.modelCalls ? {
      actual_usd_7d: round(actual), estimated_usd_7d: round(estimated), unpriced_calls_7d: unpriced,
      calls_7d: calls.length, retried_calls_7d: calls.filter((r) => (n(r.attempt_number) ?? 1) > 1).length,
    } : { actual_usd_7d: null, estimated_usd_7d: null, unpriced_calls_7d: null, calls_7d: null, retried_calls_7d: null },
    brain: { status: i.brainStatus, pending_proposals: pendingProposals },
  };
}
