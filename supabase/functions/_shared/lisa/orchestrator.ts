// LISA V2 — ORCHESTRATION: who to watch, when, and exactly once.
//
// ONE CONTRACT FOR BOTH MODES. Radar-style on-demand scans and scheduled
// monitoring both become `runWatch()` over a WatchSubject; they differ only in
// the run key (a cadence slot vs a request id) and in which budget applies
// (scheduled scans also respect the workspace's monitoring period ceiling).
//
// THE EFFECTIVE WATCHLIST (pure):
//   enabled monitoring_subjects (competitor / tracked_company)
//   ∪ approved Company Brain competitors
//   ∪ one ICP market watch when the Brain has target industries
//   − Brain exclusions − competitors a person retracted
//   capped at MAX_WATCHES, deterministic order.
// The Brain is re-read for every tick, so a changed ICP or a new exclusion
// shapes the very next scan. LISA never writes monitoring_subjects: scan state
// lives in lisa_watch_state.
//
// EXACTLY ONCE. A run is claimed in the database (lisa_claim_scan_run) under a
// run key before any credit is reserved. A duplicate scheduled execution of the
// same slot gets `already_running` / `already_done` and spends nothing. A run
// whose worker died is reclaimed after its lease, at most MAX_ATTEMPTS times.
// Only the current attempt may finish a run.
//
// NOTHING IS SCHEDULED HERE. `tick()` is a function; no cron is created by this
// change and none may be enabled without deployment approval.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { canonicalDomain, matchExclusion } from "../brainMemoryModel.ts";
import { slug } from "./extract.ts";
import { runPass, type CallBudget, type PassResult, type SignalStore } from "./pipeline.ts";
import { LISA_CATEGORIES, type LisaCategory, type SearchSource, type WatchSubject } from "./types.ts";

export const MAX_WATCHES = 10;
export const DEFAULT_CADENCE_MINUTES = 7 * 24 * 60;
export const LEASE_SECONDS = 300;
export const MAX_ATTEMPTS = 3;

export interface MonitoringSubjectRow {
  subject_kind: string;
  identifier: string | null;
  label: string | null;
  signals: unknown;
  enabled: boolean;
  cadence_minutes: number | null;
}

function categoriesFrom(signals: unknown): LisaCategory[] {
  const t = JSON.stringify(signals ?? "").toLowerCase();
  const out = new Set<LisaCategory>();
  if (/fund|raise|round|invest/.test(t)) out.add("funding");
  if (/hir|job|headcount|recruit/.test(t)) out.add("hiring");
  if (/expan|office|location|facility|plant|geograph/.test(t)) out.add("expansion");
  if (/launch|product|release/.test(t)) out.add("product_launch");
  return out.size ? LISA_CATEGORIES.filter((c) => out.has(c)) : [...LISA_CATEGORIES];
}

/** The stable state key for a watch (lisa_watch_state.subject_key). */
export function watchKey(w: Pick<WatchSubject, "kind" | "domain" | "name">): string {
  return w.kind === "market" ? `market:${slug(w.name)}` : `${w.kind === "competitor" ? "competitor" : "company"}:${slug(w.domain ?? w.name)}`;
}

export function effectiveWatchlist(brain: SharedBrainContext | null, rows: MonitoringSubjectRow[]): { watches: WatchSubject[]; skipped: Array<{ name: string; reason: string }> } {
  const skipped: Array<{ name: string; reason: string }> = [];
  const byKey = new Map<string, WatchSubject>();
  const retracted = new Set((brain?.retracted_competitors ?? []).map((n) => n.trim().toLowerCase()));
  const add = (w: WatchSubject) => {
    if (w.kind !== "market" && brain) {
      const hit = matchExclusion(brain.exclusions, { name: w.name, domain: w.domain });
      if (hit) { skipped.push({ name: w.name, reason: `excluded: ${hit}` }); return; }
      if (w.kind === "competitor" && retracted.has(w.name.trim().toLowerCase())) { skipped.push({ name: w.name, reason: "competitor retracted in Company Brain" }); return; }
    }
    const k = watchKey(w);
    const prev = byKey.get(k);
    if (prev) {
      // Merge categories; a person's explicit watchlist row wins on cadence.
      prev.categories = LISA_CATEGORIES.filter((c) => prev.categories.includes(c) || w.categories.includes(c));
      return;
    }
    byKey.set(k, w);
  };

  for (const r of rows) {
    if (!r.enabled || (r.subject_kind !== "competitor" && r.subject_kind !== "tracked_company") || !r.identifier) continue;
    const domain = canonicalDomain(r.identifier) ?? canonicalDomain(r.identifier.replace(/^.*linkedin\.com\/company\//i, ""));
    if (!domain) { skipped.push({ name: r.label ?? r.identifier, reason: "no usable domain" }); continue; }
    add({ kind: r.subject_kind === "competitor" ? "competitor" : "tracked_company", domain, name: r.label?.trim() || domain.split(".")[0],
      origin: "watchlist", categories: categoriesFrom(r.signals), cadence_minutes: Math.max(60, r.cadence_minutes ?? DEFAULT_CADENCE_MINUTES) });
  }
  if (brain && brain.status !== "missing") {
    for (const c of brain.competitors) {
      add({ kind: "competitor", domain: c.domain ? canonicalDomain(c.domain) : null, name: c.name, origin: "brain_competitor",
        categories: [...LISA_CATEGORIES], cadence_minutes: DEFAULT_CADENCE_MINUTES });
    }
    const ind = brain.canonical.target_customer.industries.filter((i) => i.trim());
    if (ind.length) {
      add({ kind: "market", domain: null, name: `ICP: ${ind.slice(0, 2).join(", ")}`, origin: "icp",
        categories: ["expansion", "funding", "hiring"], cadence_minutes: DEFAULT_CADENCE_MINUTES });
    }
  }
  const watches = [...byKey.values()]
    .sort((a, b) => (a.origin === b.origin ? watchKey(a).localeCompare(watchKey(b)) : ["watchlist", "brain_competitor", "icp"].indexOf(a.origin) - ["watchlist", "brain_competitor", "icp"].indexOf(b.origin)));
  for (const w of watches.slice(MAX_WATCHES)) skipped.push({ name: w.name, reason: `over the ${MAX_WATCHES}-watch cap` });
  return { watches: watches.slice(0, MAX_WATCHES), skipped };
}

/** Scheduled run key: the watch + its cadence slot. Two schedulers in one slot compute the same key. */
export function scheduledRunKey(w: WatchSubject, now: Date): string {
  const slot = Math.floor(now.getTime() / (w.cadence_minutes * 60_000));
  return `${watchKey(w)}@${w.cadence_minutes}m:${slot}`;
}
export function onDemandRunKey(w: WatchSubject, requestId: string): string {
  return `${watchKey(w)}@manual:${slug(requestId)}`;
}

export interface RunStateDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface WatchRunResult {
  watch: string;
  run_key: string;
  claim: string;
  pass: PassResult | null;
  finish: string | null;
}

/** Claim → pass → finish for ONE watch. Never throws. */
export async function runWatch(i: {
  db: RunStateDb; workspace_id: string; watch: WatchSubject; brain: SharedBrainContext | null;
  source: SearchSource; store: SignalStore; budget: CallBudget; now: Date;
  trigger: "scheduled" | "on_demand"; run_key: string; timeout_ms?: number;
}): Promise<WatchRunResult> {
  const key = watchKey(i.watch);
  const base = { watch: key, run_key: i.run_key };
  let claim: { outcome: string; run_id: string | null; attempts: number };
  try {
    const { data, error } = await i.db.rpc("lisa_claim_scan_run", {
      p_workspace_id: i.workspace_id, p_run_key: i.run_key, p_subject_key: key, p_trigger: i.trigger,
      p_lease_seconds: LEASE_SECONDS, p_max_attempts: MAX_ATTEMPTS, p_ignore_eligibility: i.trigger === "on_demand",
    });
    if (error) return { ...base, claim: "claim_failed", pass: null, finish: null };
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; run_id?: string; attempts?: number } | null;
    claim = { outcome: String(row?.outcome ?? "claim_failed"), run_id: row?.run_id ?? null, attempts: Number(row?.attempts ?? 0) };
  } catch {
    return { ...base, claim: "claim_failed", pass: null, finish: null };
  }
  if (claim.outcome !== "claimed" && claim.outcome !== "reclaimed") return { ...base, claim: claim.outcome, pass: null, finish: null };

  const pass = await runPass({
    workspace_id: i.workspace_id, subject: i.watch, brain: i.brain, source: i.source, store: i.store, budget: i.budget,
    now: i.now, method: i.trigger === "scheduled" ? "lisa_v2_scheduled" : "lisa_v2_on_demand", timeout_ms: i.timeout_ms,
  });
  let finish: string;
  try {
    const { data, error } = await i.db.rpc("lisa_finish_scan_run", {
      p_run_id: claim.run_id, p_attempt: claim.attempts, p_status: pass.status,
      p_counts: pass.counts, p_provider_calls: pass.counts.queries_sent, p_credits: Math.round(pass.counts.credits),
      p_model_usd: 0, p_error: pass.errors.length ? pass.errors.slice(0, 5).join("; ") : null,
      p_cadence_minutes: i.watch.cadence_minutes,
    });
    finish = error ? "finish_failed" : String(data ?? "unknown");
  } catch { finish = "finish_failed"; }
  return { ...base, claim: claim.outcome, pass, finish };
}

/** One scheduled sweep for one workspace. Sequential and bounded by MAX_WATCHES. */
export async function tickWorkspace(i: {
  db: RunStateDb; workspace_id: string; brain: SharedBrainContext | null; rows: MonitoringSubjectRow[];
  source: SearchSource; store: SignalStore; budgetFor: (runKey: string) => CallBudget; now: Date; timeout_ms?: number;
}): Promise<{ results: WatchRunResult[]; skipped: Array<{ name: string; reason: string }> }> {
  const { watches, skipped } = effectiveWatchlist(i.brain, i.rows);
  const results: WatchRunResult[] = [];
  for (const w of watches) {
    const run_key = scheduledRunKey(w, i.now);
    const r = await runWatch({ db: i.db, workspace_id: i.workspace_id, watch: w, brain: i.brain, source: i.source, store: i.store,
      budget: i.budgetFor(run_key), now: i.now, trigger: "scheduled", run_key, timeout_ms: i.timeout_ms });
    results.push(r);
    // A budget wall is workspace-wide: stop rather than refuse every remaining watch one by one.
    if (r.pass?.status === "budget_exhausted") break;
  }
  return { results, skipped };
}
