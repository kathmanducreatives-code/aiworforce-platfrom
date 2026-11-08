// ORION — EXECUTIVE INTELLIGENCE, V1: THE READ.
//
// Assembles the normalized `ExecutiveContext` that `executiveBrief.ts`
// synthesizes, from tables other agents already write:
//
//   signal_events   (LISA's monitoring / radar)        → market changes
//   lead_candidates (ATLAS)  + accounts for names       → opportunities
//   content_item    (content drafts)                    → pending review
//   approvals       (any agent)                         → pending decisions
//   task_plans / tasks                                  → in flight / failed
//   company_brain                                       → relevance + goals
//
// ── THE RULES ───────────────────────────────────────────────────────────────
//
//   STRICT WORKSPACE SCOPE. Every query carries `.eq("workspace_id", id)`,
//   including the accounts lookup (an account id from a lead is not trusted to
//   belong to the workspace by itself). The caller has already checked the
//   user's membership; this module never widens the scope.
//   BOUNDED. Every query has a `.limit()` and a time window where the table
//   grows without bound. No query reads `raw` provider payloads.
//   NO PROVIDER CALLS. Reads only; nothing here can spend.
//   A FAILED READ IS REPORTED, NOT HIDDEN. It lands in `unavailable_sources`
//   and the section is empty, so the brief can say what it could not see.

import {
  brainCompanyName, brainCompetitors, brainDescription, brainICP, brainMissingFields, hasUsableBrain,
} from "./companyBrainContext.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";
import type { BrainSnapshot, ExecItem, ExecutiveContext } from "./executiveBrief.ts";

/** The slice of supabase-js this module uses. A fake implements it in tests. */
export interface BriefQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  select(columns: string): BriefQuery;
  eq(column: string, value: unknown): BriefQuery;
  in(column: string, values: unknown[]): BriefQuery;
  gte(column: string, value: string): BriefQuery;
  order(column: string, opts: { ascending: boolean }): BriefQuery;
  limit(n: number): BriefQuery;
}
export type BriefDb = { from(table: string): BriefQuery };

export const BRIEF_LIMITS = {
  signals: 30,
  leads: 40,
  content: 15,
  approvals: 20,
  plans: 10,
  failed_tasks: 15,
  accounts: 60,
} as const;

export const DEFAULT_WINDOW_DAYS = 7;

// Lead statuses that are already decided and are not opportunities any more.
const CLOSED_LEAD = /reject|disqualif|archiv|dismiss|lost|won|closed|duplicate|excluded/i;
const IN_FLIGHT_PLAN = ["running", "active", "pending", "in_progress", "awaiting_approval", "resumable"];

// Plain labels for `signal_events.signal_type` (the CHECK constraint's values,
// migration 20260824130000) and, as a fallback, `evidence_category`.
const SIGNAL_LABEL: Record<string, string> = {
  recent_funding: "Funding announced",
  employee_growth: "Headcount growing",
  market_expansion: "Entering a new market",
  geographic_expansion: "Expanding to a new region",
  sales_hiring: "Hiring salespeople",
  revops_hiring: "Hiring revenue operations",
  growth_hiring: "Hiring for growth",
  new_revenue_leader: "New revenue leader",
  outbound_initiative: "Starting outbound",
  positioning_change: "Positioning changed",
  product_launch: "Product launch",
  major_release: "Major release",
  new_integration: "New integration",
  category_expansion: "Expanding into a new category",
  founder_pipeline_post: "Founder posted about pipeline",
  founder_outbound_post: "Founder posted about outbound",
  founder_customer_acquisition_post: "Founder posted about customer acquisition",
  founder_hiring_post: "Founder posted about hiring",
  founder_problem_statement: "Founder described a problem",
  person_left_company: "Contact left the company",
  company_outside_icp: "Company no longer fits your ICP",
  role_changed: "Contact changed role",
  company_inactive: "Company looks inactive",
  signal_became_stale: "Earlier signal went stale",
  competitor_activity: "Competitor activity",
  market_problem_discussion: "Market discussing a problem",
  job_signal: "Hiring activity",
  funding_signal: "Funding announced",
  launch_signal: "Product launch",
  expansion_signal: "Expansion",
  founder_activity_signal: "Founder activity",
  gtm_signal: "Go-to-market change",
};

type Row = Record<string, unknown>;

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function n(v: unknown): number | null {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}
function clip(t: string | null, max = 160): string | null {
  if (!t) return null;
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : null;
}
function clamp(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x)));
}

async function read(
  label: string,
  q: PromiseLike<{ data: unknown; error: unknown }>,
  unavailable: string[],
): Promise<Row[]> {
  try {
    const { data, error } = await q;
    if (error) { unavailable.push(label); return []; }
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch {
    unavailable.push(label);
    return [];
  }
}

export function brainSnapshot(profile: Row | null, onboardingCompleted: boolean): BrainSnapshot {
  const p = profile ?? {};
  const structured = normalizeCompanyBrain(p);
  const goals = obj(p.goals);
  const founder = obj(p.founder);
  const goal = s(founder.first_help_goal) ?? s(goals.primary) ?? s(goals.this_quarter) ?? s(goals.main) ??
    (Array.isArray(goals.list) ? s(goals.list[0]) : null);
  return {
    usable: hasUsableBrain(p, onboardingCompleted),
    company: brainCompanyName(p),
    description: clip(brainDescription(p), 240),
    icp: clip(brainICP(p), 240),
    industries: structured.target_customer.industries.slice(0, 6),
    competitors: brainCompetitors(p).slice(0, 8),
    goal: clip(goal, 160),
    missing: brainMissingFields(p),
  };
}

function industryMatch(industry: string | null, brain: BrainSnapshot): boolean {
  if (!industry || !brain.usable || !brain.industries.length) return false;
  const i = industry.toLowerCase();
  return brain.industries.some((b) => {
    const x = b.toLowerCase();
    return x.length > 2 && (i.includes(x) || x.includes(i));
  });
}

function competitorMatch(name: string | null, brain: BrainSnapshot): boolean {
  if (!name || !brain.competitors.length) return false;
  const lower = name.toLowerCase();
  return brain.competitors.some((c) => c.toLowerCase() === lower);
}

export interface CollectOptions {
  now?: Date;
  windowDays?: number;
}

/** Read and normalize everything Orion needs for one workspace. */
export async function collectExecutiveContext(
  db: BriefDb,
  workspaceId: string,
  opts: CollectOptions = {},
): Promise<ExecutiveContext> {
  if (!workspaceId) throw new Error("workspace_id required");
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const unavailable: string[] = [];

  // One statement per query (the db-contract schema test parses each
  // `.from(…)…;` statement on its own), then read concurrently.
  const brainQ = db.from("company_brain")
    .select("profile, onboarding_completed")
    .eq("workspace_id", workspaceId).limit(1);
  const signalQ = db.from("signal_events")
    .select("id, account_id, lead_candidate_id, signal_type, signal_category, evidence_category, occurred_at, observed_at, confidence, freshness, verification_status, lifecycle_status, normalized_value, dedupe_key, source_url, created_at")
    .eq("workspace_id", workspaceId).eq("lifecycle_status", "active").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(BRIEF_LIMITS.signals);
  const leadQ = db.from("lead_candidates")
    .select("id, account_id, signal_id, plan_id, status, fit_score, priority, reason, next_action, created_at, updated_at")
    .eq("workspace_id", workspaceId).gte("updated_at", since)
    .order("updated_at", { ascending: false }).limit(BRIEF_LIMITS.leads);
  const contentQ = db.from("content_item")
    .select("id, title, status, format, source_signal_id, created_at, updated_at")
    .eq("workspace_id", workspaceId).in("status", ["draft", "in_review"])
    .order("updated_at", { ascending: false }).limit(BRIEF_LIMITS.content);
  const approvalQ = db.from("approvals")
    .select("id, title, description, summary, status, created_at, plan_id, task_id, agent_slug, type")
    .eq("workspace_id", workspaceId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(BRIEF_LIMITS.approvals);
  const planQ = db.from("task_plans")
    .select("id, goal, plan_summary, user_instruction, status, created_at, updated_at")
    .eq("workspace_id", workspaceId).in("status", [...IN_FLIGHT_PLAN, "failed"]).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(BRIEF_LIMITS.plans);
  const failedTaskQ = db.from("tasks")
    .select("id, plan_id, agent_slug, status, description, error_message, created_at, updated_at")
    .eq("workspace_id", workspaceId).eq("status", "failed").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(BRIEF_LIMITS.failed_tasks);

  const [brainRows, signalRows, leadRows, contentRows, approvalRows, planRows, failedTaskRows] = await Promise.all([
    read("company_brain", brainQ, unavailable),
    read("signal_events", signalQ, unavailable),
    read("lead_candidates", leadQ, unavailable),
    read("content_item", contentQ, unavailable),
    read("approvals", approvalQ, unavailable),
    read("task_plans", planQ, unavailable),
    read("tasks", failedTaskQ, unavailable),
  ]);

  const brainRow = brainRows[0] ?? null;
  const brain = brainSnapshot(brainRow ? obj(brainRow.profile) : null, brainRow?.onboarding_completed === true);

  // Account names and industries, same workspace only.
  const accountIds = [...new Set([
    ...signalRows.map((r) => s(r.account_id)), ...leadRows.map((r) => s(r.account_id)),
  ].filter((x): x is string => !!x))].slice(0, BRIEF_LIMITS.accounts);
  const accountRows = accountIds.length
    ? await read("accounts", db.from("accounts").select("id, name, domain, industry")
      .eq("workspace_id", workspaceId).in("id", accountIds).limit(BRIEF_LIMITS.accounts), unavailable)
    : [];
  const accounts = new Map(accountRows.map((a) => [String(a.id), a]));
  const accountName = (id: string | null, fallback: string | null = null) =>
    (id && (s(accounts.get(id)?.name) ?? s(accounts.get(id)?.domain))) ?? fallback;
  const accountIndustry = (id: string | null) => (id ? s(accounts.get(id)?.industry) : null);

  // ── signals ──
  const seenDedupe = new Set<string>();
  const signals: ExecItem[] = [];
  for (const r of signalRows) {
    const id = s(r.id);
    if (!id) continue;
    const dk = s(r.dedupe_key);
    if (dk) { if (seenDedupe.has(dk)) continue; seenDedupe.add(dk); }
    const nv = obj(r.normalized_value);
    const accountId = s(r.account_id);
    const name = accountName(accountId, s(nv.company_name));
    const type = s(r.signal_type) ?? "signal";
    const evidenceCategory = s(r.evidence_category);
    const typeLabel = SIGNAL_LABEL[type] ?? (evidenceCategory ? SIGNAL_LABEL[evidenceCategory] : undefined) ??
      type.replace(/_/g, " ");
    const title = clip(s(nv.title) ?? (typeof nv.signal === "string" ? s(nv.signal) : null) ?? typeLabel, 120)!;
    const when = s(r.occurred_at) ?? s(r.observed_at) ?? s(r.created_at);
    const age = daysBetween(when, now);
    const conf = (["high", "medium", "low"] as const).find((c) => c === r.confidence) ?? null;
    const reasons: string[] = [];
    let score = conf === "high" ? 30 : conf === "medium" ? 20 : conf === "low" ? 8 : 15;
    if (age !== null && age <= 2) { score += 25; reasons.push("happened in the last 2 days"); }
    else if (age !== null && age <= 7) { score += 15; reasons.push("happened this week"); }
    else score += 5;
    if (r.verification_status === "provider_verified") { score += 10; reasons.push("verified by the data provider"); }
    if (r.freshness === "stale") { score -= 15; reasons.push("source marks it stale"); }
    if (industryMatch(accountIndustry(accountId), brain)) { score += 15; reasons.push("in an industry you target"); }
    if (competitorMatch(name, brain)) { score += 12; reasons.push("a competitor you track"); }
    if (s(r.lead_candidate_id)) { score += 5; reasons.push("linked to a lead"); }
    signals.push({
      kind: "signal", table: "signal_events", id, title,
      occurred_at: when, route: "/signals",
      detail: clip(s(nv.description), 160) ?? typeLabel,
      account_id: accountId, account_name: name, score: clamp(score), reasons,
      source_confidence: conf, category: type,
    });
  }

  // ── leads ──
  const leads: ExecItem[] = [];
  for (const r of leadRows) {
    const id = s(r.id);
    if (!id) continue;
    if (CLOSED_LEAD.test(String(r.status ?? ""))) continue;
    const accountId = s(r.account_id);
    let fit = n(r.fit_score);
    if (fit !== null && fit <= 1) fit = fit * 100;
    const pr = String(r.priority ?? "").toLowerCase();
    const reasons: string[] = [];
    let score = fit !== null ? fit * 0.6 : 30;
    if (fit !== null) reasons.push(`fit ${Math.round(fit)}/100`);
    if (pr === "high" || pr === "hot") { score += 20; reasons.push("marked high priority"); }
    else if (pr === "medium") score += 10;
    if (s(r.signal_id)) { score += 10; reasons.push("backed by a buying signal"); }
    const age = daysBetween(s(r.updated_at) ?? s(r.created_at), now);
    if (age !== null && age <= 2) score += 10;
    if (industryMatch(accountIndustry(accountId), brain)) { score += 10; reasons.push("in an industry you target"); }
    const reasonText = clip(s(r.reason), 140);
    if (reasonText) reasons.unshift(reasonText);
    const name = accountName(accountId);
    const next = clip(s(r.next_action), 80);
    leads.push({
      kind: "lead", table: "lead_candidates", id,
      title: name ?? "Unnamed lead",
      occurred_at: s(r.updated_at) ?? s(r.created_at),
      route: `/leads?lead=${encodeURIComponent(accountId ?? id)}`,
      detail: next ? `Next: ${next}` : null,
      account_id: accountId, account_name: name, score: clamp(score), reasons,
      source_confidence: null, category: pr || null,
    });
  }

  // ── content drafts ──
  const content: ExecItem[] = contentRows.filter((r) => s(r.id)).map((r) => {
    const age = daysBetween(s(r.updated_at) ?? s(r.created_at), now) ?? 0;
    return {
      kind: "content" as const, table: "content_item", id: String(r.id),
      title: clip(s(r.title), 100) ?? "Untitled draft",
      occurred_at: s(r.updated_at) ?? s(r.created_at),
      route: `/content?item=${encodeURIComponent(String(r.id))}`,
      detail: r.status === "in_review" ? "In review" : "Draft",
      account_id: null, account_name: null,
      score: clamp(40 + (r.status === "in_review" ? 15 : 0) + Math.min(20, age * 4)),
      reasons: [], source_confidence: null, category: s(r.status),
    };
  });

  // ── approvals: the older, the more urgent ──
  const approvals: ExecItem[] = approvalRows.filter((r) => s(r.id)).map((r) => {
    const age = daysBetween(s(r.created_at), now) ?? 0;
    return {
      kind: "approval" as const, table: "approvals", id: String(r.id),
      title: clip(s(r.title), 100) ?? "Approval needed",
      occurred_at: s(r.created_at),
      route: "/awaiting-you",
      detail: clip(s(r.description) ?? s(r.summary), 140),
      account_id: null, account_name: null,
      score: clamp(age * 10), reasons: [], source_confidence: null, category: s(r.type),
    };
  });

  // ── plans in flight, and failed work (one item per failed plan) ──
  const planTitle = (r: Row) => clip(s(r.goal) ?? s(r.plan_summary) ?? s(r.user_instruction), 100) ?? "Untitled run";
  const plans_in_flight: ExecItem[] = planRows.filter((r) => s(r.id) && IN_FLIGHT_PLAN.includes(String(r.status)))
    .map((r) => ({
      kind: "plan" as const, table: "task_plans", id: String(r.id), title: planTitle(r),
      occurred_at: s(r.created_at), route: `/plans/${encodeURIComponent(String(r.id))}`,
      detail: String(r.status), account_id: null, account_name: null, score: 30, reasons: [],
      source_confidence: null, category: s(r.status),
    }));

  const failedByPlan = new Map<string, ExecItem>();
  for (const r of planRows.filter((r) => s(r.id) && r.status === "failed")) {
    failedByPlan.set(String(r.id), {
      kind: "plan", table: "task_plans", id: String(r.id), title: planTitle(r),
      occurred_at: s(r.updated_at) ?? s(r.created_at), route: `/plans/${encodeURIComponent(String(r.id))}`,
      detail: null, account_id: null, account_name: null, score: 60, reasons: [],
      source_confidence: null, category: "failed",
    });
  }
  for (const r of failedTaskRows) {
    const id = s(r.id);
    if (!id) continue;
    const planId = s(r.plan_id);
    const err = clip(s(r.error_message), 140);
    if (planId && failedByPlan.has(planId)) {
      const p = failedByPlan.get(planId)!;
      if (!p.detail && err) p.detail = err;
      continue;
    }
    const key = planId ?? `task:${id}`;
    if (failedByPlan.has(key)) continue;
    failedByPlan.set(key, {
      kind: "task", table: "tasks", id,
      title: clip(s(r.description), 100) ?? `${s(r.agent_slug) ?? "Agent"} step failed`,
      occurred_at: s(r.updated_at) ?? s(r.created_at),
      route: planId ? `/plans/${encodeURIComponent(planId)}` : "/dashboard",
      detail: err, account_id: null, account_name: null, score: 55, reasons: [],
      source_confidence: null, category: "failed",
    });
  }

  return {
    workspace_id: workspaceId,
    generated_at: nowDate.toISOString(),
    window_days: windowDays,
    brain,
    signals,
    leads,
    content,
    approvals,
    plans_in_flight,
    failed_work: [...failedByPlan.values()],
    unavailable_sources: unavailable,
  };
}
