// RECENT ACTIVITY — what the dashboard timeline is allowed to say.
//
//   activity_feed  ┐
//   signal_events  ├─ activitySources.ts (narrow reads + realtime) ─→ [this file] ─→ ActivityItem[]
//   tasks (failed) │
//   outreach_drafts┘
//
// ── THE RULES ──────────────────────────────────────────────────────────────
//
// 1. NOTHING IS INVENTED. Every line is built from a stored row: the event
//    type picks the verb, the row supplies the entity and the outcome. A row
//    with nothing honest to say is dropped, not filled in.
// 2. PUBLIC NAMES ONLY. Rows carry backend slugs and legacy titles ("Scout
//    started"); the agent is resolved through the one legacy map
//    (visualAgentKey) and the legacy title is never printed.
// 3. ATTRIBUTION IS NEVER GUESSED from free text, with one documented
//    exception: run-monitoring-scan writes `agent_name: "Signals Monitor"` and
//    no agent id — that job IS Lyra's signal monitoring.
// 4. SIGNAL, NOT NOISE. Internal plumbing (tool_used, ai_provider_call,
//    agent_started retries, provenance guards) is not activity. Repeats of the
//    same thing close together collapse into one line with a count.
// 5. ONE WORKSPACE. Rows are scoped by RLS and the query; `acceptRow` checks
//    again on the client so a stale channel can never paint another workspace.
//
// PURE. `now` is an input. Deno-testable.

import { visualAgentKey, type VisualAgentKey } from "../agent3d/visualState.ts";
import { signalTypeLabel } from "../signalFeedModel.ts";

// ── raw rows (narrow selects; see activitySources.ts) ──────────────────────

export interface ActivityRow {
  id: string;
  workspace_id: string | null;
  agent_id: string | null;
  event_type: string;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  plan_id: string | null;
  task_plan_id: string | null;
  created_at: string | null;
}

export interface SignalRow {
  id: string;
  workspace_id: string | null;
  signal_type: string | null;
  created_at: string | null;
  verification_status: string | null;
  lifecycle_status: string | null;
  title: string | null;
  company: string | null;
}

export interface DraftRow {
  id: string;
  workspace_id: string | null;
  channel: string | null;
  subject: string | null;
  status: string | null;
  created_at: string | null;
}

export interface FailedTaskRow {
  id: string;
  workspace_id: string | null;
  agent_slug: string | null;
  status: string | null;
  updated_at: string | null;
  error_message: string | null;
  plan_id: string | null;
  task_plan_id: string | null;
  terminal: string | null;
}

/** The few outcome facts a finished task carries (narrow JSON paths, never `result`). */
export interface TaskOutcome {
  id: string;
  status: string | null;
  terminal: string | null;
  discovered: number | null;
  relevant: number | null;
}

export interface Enrichment {
  /** agents.id → backend slug */
  agentSlugs: Readonly<Record<string, string>>;
  /** tasks.id → outcome */
  tasks: Readonly<Record<string, TaskOutcome>>;
  /** task_plans.id → what the person asked for */
  plans: Readonly<Record<string, string>>;
}

export const EMPTY_ENRICHMENT: Enrichment = { agentSlugs: {}, tasks: {}, plans: {} };

// ── the item the timeline renders ──────────────────────────────────────────

export type ActivityKind =
  | "signal_discovered" | "workflow_completed" | "workflow_round" | "draft_prepared"
  | "approval_requested" | "approved" | "rejected" | "plan_created"
  | "execution_failed" | "setup_completed";

export type ActivityTone = "success" | "info" | "attention" | "failed";

export interface ActivityItem {
  /** `${source}:${id}` — the dedupe key. */
  key: string;
  agent: VisualAgentKey;
  kind: ActivityKind;
  /** "Lyra discovered a hiring signal" */
  action: string;
  /** The entity: a company, a signal headline, what the person asked for. */
  detail: string | null;
  /** The result: "48 companies found · 9 relevant", a failure reason. */
  outcome: string | null;
  tone: ActivityTone;
  at: string;
  route: string | null;
  /** Repeats folded into this line (1 = just itself). */
  count: number;
  /** The task an activity row reports on — a failed-task row for it is a duplicate. */
  taskId?: string | null;
}

/** Event types that become timeline lines. Everything else is plumbing. */
export const CURATED_EVENT_TYPES = [
  "plan_created", "plan_complete", "plan_checkpointed", "plan_failed",
  "awaiting_approval", "tool_awaiting_approval", "approved", "rejected",
  "onboarding_completed", "tool_failed",
] as const;

// ── small readers ──────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const clip = (s: string | null, n = 110): string | null => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const NAME: Record<VisualAgentKey, string> = { pilot: "Pilot", lyra: "Lyra", atlas: "Atlas", mira: "Mira", orion: "Orion" };
export const agentName = (k: VisualAgentKey) => NAME[k];

/** The client-side workspace gate (RLS and the query filter come first). */
export function acceptRow(row: { workspace_id?: string | null; id?: string | null } | null | undefined, workspaceId: string | null): boolean {
  return !!row && !!row.id && !!workspaceId && row.workspace_id === workspaceId;
}

function agentOfActivity(row: ActivityRow, e: Enrichment): VisualAgentKey | null {
  const slug = (row.agent_id && e.agentSlugs[row.agent_id]) || str(row.metadata?.agent_slug);
  const key = visualAgentKey(slug);
  if (key) return key;
  // The one documented exception (rule 3).
  if ((row.title ?? "").startsWith("Signals Monitor")) return "lyra";
  return null;
}

/** What each agent's finished work is called, by the job the registry gives it. */
const COMPLETED_VERB: Record<VisualAgentKey, string> = {
  lyra: "completed a search",
  atlas: "completed account research",
  mira: "prepared outreach",
  orion: "finished a draft",
  pilot: "completed a workflow",
};

const TERMINAL_LABEL: Record<string, string> = {
  budget_exhausted: "Stopped at the run budget",
  search_exhausted: "Searched every available source",
  no_qualified_matches: "No qualified matches",
  retry_budget_exhausted: "Ran out of retries",
  continuation_attempts_exhausted: "Stopped at its continuation limit",
  cancelled: "Cancelled",
  completed: "",
};

function outcomeOfTask(t: TaskOutcome | undefined): string | null {
  if (!t) return null;
  const parts: string[] = [];
  if (t.discovered !== null && t.discovered > 0) parts.push(plural(t.discovered, "company found", "companies found"));
  if (t.relevant !== null && t.discovered !== null && t.discovered > 0) parts.push(`${t.relevant} relevant`);
  const terminal = t.terminal ? TERMINAL_LABEL[t.terminal] ?? null : null;
  if (terminal) parts.push(terminal);
  return parts.length ? parts.join(" · ") : null;
}

// ── WHY SOMETHING FAILED, IN WORDS A PERSON CAN ACT ON ─────────────────────
//
// Failure text on these rows is the backend's own: provider names, HTTP
// statuses, error codes ("apify is not configured. apify_unauthorized"). It is
// never shown. A known cause becomes one plain sentence; anything else shows
// no reason at all — the line still says who failed and opens the run, which
// is where the detail belongs.
const KNOWN_REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/not configured|unauthori[sz]ed|forbidden|invalid (api )?key|missing (api )?key|\b40[13]\b/i, "A connected tool needs attention in Integrations"],
  [/rate.?limit|too many requests|\b429\b|quota/i, "Hit a usage limit — it will try again later"],
  [/timed? ?out|timeout|deadline exceeded/i, "Took too long and stopped"],
  [/budget|out of credits|insufficient credits/i, "Stopped at the run budget"],
];

export function plainReason(body: string | null): string | null {
  const s = str(body);
  if (!s) return null;
  for (const [re, said] of KNOWN_REASONS) if (re.test(s)) return said;
  return null;
}

/**
 * An end-state CODE ("continuation_attempts_exhausted") read as words. Only a
 * bare code qualifies — lowercase words joined by underscores — so it can carry
 * no message, payload or identifier. Free text goes through plainReason.
 */
function codeAsWords(code: string | null): string | null {
  const s = str(code);
  return s && /^[a-z]+(?:_[a-z]+){0,5}$/.test(s) ? s.replace(/_/g, " ") : null;
}

const sentence = (s: string | null): string | null => (s ? s[0].toUpperCase() + s.slice(1) : null);

// ── mapping, one source at a time ──────────────────────────────────────────

export function fromActivity(row: ActivityRow, e: Enrichment): ActivityItem | null {
  const at = row.created_at;
  if (!at) return null;
  const meta = row.metadata ?? {};
  const planId = row.plan_id ?? row.task_plan_id;
  const planRoute = planId ? `/plans/${planId}` : null;
  const asked = planId ? clip(str(e.plans[planId])) : null;
  const base = { key: `activity:${row.id}`, at, count: 1 };

  switch (row.event_type) {
    case "plan_created":
      return { ...base, agent: "pilot", kind: "plan_created", action: "Pilot planned a mission", detail: asked ?? clip(str(row.body)), outcome: null, tone: "info", route: planRoute };

    case "plan_complete":
    case "plan_checkpointed": {
      const agent = agentOfActivity(row, e) ?? "pilot";
      const taskId = str(meta.task_id);
      const status = str(meta.workflow_status) ?? (row.event_type === "plan_checkpointed" ? "partial" : "complete");
      const task = taskId ? e.tasks[taskId] : undefined;
      if (status === "failed" || status === "no_qualified_matches") {
        return { ...base, agent, kind: "execution_failed", action: `${NAME[agent]}'s workflow didn't finish`, detail: asked, outcome: outcomeOfTask(task) ?? plainReason(row.body), tone: "failed", route: planRoute, taskId };
      }
      const round = status === "partial" || row.event_type === "plan_checkpointed";
      return {
        ...base, agent, taskId,
        kind: round ? "workflow_round" : "workflow_completed",
        action: round ? `${NAME[agent]} finished a round` : `${NAME[agent]} ${COMPLETED_VERB[agent]}`,
        detail: asked,
        outcome: outcomeOfTask(task) ?? (round ? "More rounds available" : null),
        tone: round ? "info" : "success",
        route: planRoute,
      };
    }

    case "plan_failed":
      return { ...base, agent: "pilot", kind: "execution_failed", action: "A workflow couldn't start", detail: asked, outcome: plainReason(row.body), tone: "failed", route: planRoute };

    case "awaiting_approval":
    case "tool_awaiting_approval": {
      const agent = agentOfActivity(row, e) ?? "pilot";
      return { ...base, agent, kind: "approval_requested", action: `${NAME[agent]} needs your approval`, detail: asked, outcome: null, tone: "attention", route: "/awaiting-you" };
    }

    case "approved":
    case "rejected": {
      const agent = agentOfActivity(row, e) ?? "pilot";
      const ok = row.event_type === "approved";
      return { ...base, agent, kind: ok ? "approved" : "rejected", action: ok ? `You approved ${NAME[agent]}'s work` : `You rejected ${NAME[agent]}'s work`, detail: asked, outcome: ok ? "Work continues" : "Plan stopped", tone: ok ? "success" : "info", route: planRoute };
    }

    case "onboarding_completed":
      return { ...base, agent: "pilot", kind: "setup_completed", action: "Company Brain is set up", detail: clip(str(row.body)), outcome: null, tone: "success", route: "/company-brain" };

    case "tool_failed": {
      // Inside a workflow a tool error is a retry; the plan's own outcome reports
      // it. Only a job with no plan (scheduled monitoring) speaks for itself.
      if (planId) return null;
      const agent = agentOfActivity(row, e);
      if (!agent) return null;
      const monitor = (row.title ?? "").startsWith("Signals Monitor");
      return { ...base, agent, kind: "execution_failed", action: monitor ? `${NAME[agent]}'s signal monitor couldn't run` : `${NAME[agent]} couldn't use a tool`, detail: null, outcome: plainReason(row.body), tone: "failed", route: monitor ? "/signals" : null };
    }

    default:
      return null;
  }
}

/** signal_events types, as they read mid-sentence ("Lyra discovered a … signal"). */
const SIGNAL_PHRASE: Record<string, string> = {
  recent_funding: "funding", employee_growth: "headcount growth", sales_hiring: "sales hiring",
  revops_hiring: "RevOps hiring", growth_hiring: "growth hiring", new_revenue_leader: "new revenue leader",
  outbound_initiative: "outbound", market_expansion: "market expansion", geographic_expansion: "expansion",
  product_launch: "product launch", major_release: "product release", new_integration: "integration",
  founder_pipeline_post: "founder", founder_outbound_post: "founder", founder_customer_acquisition_post: "founder",
  founder_hiring_post: "founder hiring", founder_problem_statement: "founder", competitor_activity: "competitor",
};

export function fromSignal(row: SignalRow): ActivityItem | null {
  if (!row.created_at) return null;
  const headline = clip(str(row.title)) ?? (str(row.company) ? `${str(row.company)} · ${signalTypeLabel(row.signal_type)}` : null);
  if (!headline) return null;
  const label = SIGNAL_PHRASE[row.signal_type ?? ""] ?? signalTypeLabel(row.signal_type).toLowerCase().replace(/ signal$/, "");
  // "provider_verified" / "verified" yes; "unverified", "not_verified", "verification_needed" no.
  const v = (row.verification_status ?? "").toLowerCase();
  const verified = v.endsWith("verified") && !v.startsWith("un") && !v.includes("not");
  return {
    key: `signal:${row.id}`, agent: "lyra", kind: "signal_discovered",
    action: `Lyra discovered ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} signal`, detail: headline,
    outcome: verified ? "Verified" : "Needs review", tone: verified ? "success" : "info",
    at: row.created_at, route: "/signals", count: 1,
  };
}

const CHANNEL_DRAFT: Record<string, string> = {
  email: "an email draft",
  linkedin: "a LinkedIn draft",
  linkedin_dm: "a LinkedIn message",
  linkedin_connection: "a LinkedIn connection note",
  linkedin_inmail: "a LinkedIn InMail",
  linkedin_comment: "a LinkedIn comment",
  linkedin_post: "a LinkedIn post",
};

export function fromDraft(row: DraftRow): ActivityItem | null {
  if (!row.created_at) return null;
  const channel = CHANNEL_DRAFT[(row.channel ?? "").toLowerCase()] ?? "an outreach draft";
  const status = (row.status ?? "").toLowerCase();
  const waiting = /draft|pending|review|awaiting/.test(status) || !status;
  return {
    key: `draft:${row.id}`, agent: "mira", kind: "draft_prepared",
    action: `Mira prepared ${channel}`, detail: clip(str(row.subject)),
    outcome: waiting ? "Waiting for your review" : sentence(codeAsWords(status)), tone: waiting ? "attention" : "success",
    at: row.created_at, route: "/awaiting-you", count: 1,
  };
}

export function fromFailedTask(row: FailedTaskRow, e: Enrichment): ActivityItem | null {
  const at = row.updated_at;
  const agent = visualAgentKey(row.agent_slug);
  if (!at || !agent) return null;
  const planId = row.plan_id ?? row.task_plan_id;
  const blocked = row.status === "blocked";
  return {
    key: `task:${row.id}`, agent, kind: "execution_failed", taskId: row.id,
    action: blocked ? `${NAME[agent]} was blocked` : `${NAME[agent]}'s run failed`,
    detail: planId ? clip(str(e.plans[planId])) : null,
    // The curated end state first; a raw error message only through plainReason's allow-list.
    outcome: (row.terminal ? TERMINAL_LABEL[row.terminal] || codeAsWords(row.terminal) : null) ?? plainReason(row.error_message),
    tone: "failed", at, route: planId ? `/plans/${planId}` : null, count: 1,
  };
}

// ── merge: dedupe, order, collapse ─────────────────────────────────────────

/** Repeats closer together than this fold into one line. */
export const COLLAPSE_WINDOW_MS = 20 * 60_000;

function groupKey(i: ActivityItem): string {
  if (i.kind === "signal_discovered") return "signal";
  if (i.kind === "execution_failed") return `fail|${i.agent}|${i.outcome ?? ""}|${i.detail ?? ""}`;
  return `${i.kind}|${i.agent}|${i.detail ?? ""}`;
}

export interface BuildInput {
  workspaceId: string | null;
  activity: readonly ActivityRow[];
  signals: readonly SignalRow[];
  drafts: readonly DraftRow[];
  failedTasks: readonly FailedTaskRow[];
  enrichment: Enrichment;
  limit?: number;
}

export function buildActivityFeed(input: BuildInput): ActivityItem[] {
  const ws = input.workspaceId;
  const items = new Map<string, ActivityItem>();
  const add = (i: ActivityItem | null) => { if (i && !items.has(i.key)) items.set(i.key, i); };

  input.activity.filter((r) => acceptRow(r, ws)).forEach((r) => add(fromActivity(r, input.enrichment)));
  input.signals.filter((r) => acceptRow(r, ws) && (r.lifecycle_status ?? "active") === "active").forEach((r) => add(fromSignal(r)));
  input.drafts.filter((r) => acceptRow(r, ws)).forEach((r) => add(fromDraft(r)));

  // A failed task an activity row already reports on is the same event.
  const reported = new Set([...items.values()].map((i) => i.taskId).filter(Boolean) as string[]);
  input.failedTasks.filter((r) => acceptRow(r, ws) && !reported.has(r.id)).forEach((r) => add(fromFailedTask(r, input.enrichment)));

  const sorted = [...items.values()].sort((a, b) => time(b.at) - time(a.at) || a.key.localeCompare(b.key));

  // Collapse runs of the same thing: the newest line speaks for the run.
  const out: ActivityItem[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (prev && groupKey(prev) === groupKey(item) && time(prev.at) - time(item.at) <= COLLAPSE_WINDOW_MS) {
      prev.count += item.count;
      if (prev.kind === "signal_discovered") prev.action = `Lyra discovered ${prev.count} signals`;
      continue;
    }
    out.push({ ...item });
  }
  return out.slice(0, input.limit ?? 12);
}

/** Merge arriving rows into a list: newest first, never duplicated by id. */
export function mergeRows<T extends { id: string }>(current: readonly T[], arriving: readonly T[], cap = 60): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...arriving, ...current]) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.slice(0, cap);
}

/** Ids an activity row needs looked up before it can be described. */
export function enrichmentNeeds(rows: readonly ActivityRow[], e: Enrichment): { taskIds: string[]; planIds: string[] } {
  const taskIds = new Set<string>();
  const planIds = new Set<string>();
  for (const r of rows) {
    const t = str(r.metadata?.task_id);
    if (t && (r.event_type === "plan_complete" || r.event_type === "plan_checkpointed") && !e.tasks[t]) taskIds.add(t);
    const p = r.plan_id ?? r.task_plan_id;
    if (p && !(p in e.plans)) planIds.add(p);
  }
  return { taskIds: [...taskIds], planIds: [...planIds] };
}

export function outcomeFromNumbers(id: string, status: string | null, terminal: string | null, discovered: unknown, relevant: unknown): TaskOutcome {
  return { id, status, terminal, discovered: num(discovered), relevant: num(relevant) };
}
