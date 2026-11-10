// LISA V2 — THE PIPELINE for one watched subject.
//
//   Collection → Extraction → Validation → Evidence → Deduplication
//   → Verification → Relevance → Persistence
//
// Collection goes through an injected SearchSource; persistence through an
// injected SignalStore. Everything between is pure, so a recorded fixture
// replays the exact pass offline. Every drop is counted with its reason.
//
// FAILURE HONESTY.
//   * A provider error is counted (`provider_errors`) and never replaced with
//     a fabricated result.
//   * A persistence failure is counted (`persist_failed`) and makes the pass
//     `partial` / `failed`. It is never reported as success: this is the defect
//     the legacy monitoring path has (writes refused by a disabled flag are
//     counted as failed while the pass is stamped ok).
//   * A budget refusal stops collection before any query is sent.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { planQueries, type CollectContext } from "./collectors.ts";
import { extract } from "./extract.ts";
import { evaluateRelevance } from "./relevance.ts";
import {
  dedupeKeyFor, eventInstance, isStale, SIGNAL_TYPE, subjectKeyFor, verify,
} from "./verify.ts";
import type { DropReason, LisaSignal, Observation, SearchSource, WatchSubject } from "./types.ts";

/** What persistence reports for one event. */
export interface StoreOutcome {
  status: "new" | "updated" | "duplicate" | "failed";
  event_id: string | null;
  /** The verification the database recomputed over ALL stored evidence. */
  verification_level?: string | null;
  lifecycle_status?: string | null;
  error?: string | null;
}

export interface SignalStore {
  record(signal: LisaSignal): Promise<StoreOutcome>;
}

/** Budget seam: authorize one provider call before it is sent, settle after. */
export interface CallBudget {
  authorize(query: string): Promise<{ ok: true; token: string } | { ok: false; reason: string }>;
  settle(token: string, credits: number, ok: boolean): Promise<void>;
}

export interface PassCounts {
  queries_planned: number;
  queries_sent: number;
  provider_errors: number;
  budget_refused: number;
  hits: number;
  observations: number;
  dropped: Partial<Record<DropReason, number>>;
  events: number;
  new: number;
  updated: number;
  duplicate: number;
  persist_failed: number;
  credits: number;
}

export interface PassResult {
  status: "ok" | "partial" | "failed" | "budget_exhausted" | "empty";
  counts: PassCounts;
  signals: LisaSignal[];
  errors: string[];
}

export interface PassInput {
  workspace_id: string;
  subject: WatchSubject;
  brain: SharedBrainContext | null;
  source: SearchSource;
  store: SignalStore;
  budget: CallBudget;
  now: Date;
  method: LisaSignal["collection_method"];
  /** Per-query timeout (ms). */
  timeout_ms?: number;
  limit?: number;
}

export function emptyCounts(): PassCounts {
  return { queries_planned: 0, queries_sent: 0, provider_errors: 0, budget_refused: 0, hits: 0, observations: 0,
    dropped: {}, events: 0, new: 0, updated: 0, duplicate: 0, persist_failed: 0, credits: 0 };
}

export function collectContext(brain: SharedBrainContext | null, now: Date): CollectContext {
  const tc = brain && brain.status !== "missing" ? brain.canonical.target_customer : null;
  return { industries: tc?.industries ?? [], geographies: tc?.geography ?? [], year: now.getUTCFullYear() };
}

/** Group observations into events by dedupe identity and build normalized signals. PURE. */
export function buildSignals(
  workspace_id: string, subject: WatchSubject, observations: Observation[], brain: SharedBrainContext | null,
  now: Date, method: LisaSignal["collection_method"], provider: string,
): { signals: LisaSignal[]; dropped: Array<{ reason: DropReason; url: string }> } {
  const discovered = now.toISOString();
  const groups = new Map<string, { obs: Observation[]; instance: string; signalType: string; subjectKey: string }>();
  for (const o of observations) {
    const signalType = SIGNAL_TYPE[o.category].type(o);
    const subjectKey = subjectKeyFor(o);
    const instance = eventInstance(o, discovered);
    const subjectType = subject.kind === "competitor" ? "competitor" : "company";
    const key = dedupeKeyFor(subjectType, subjectKey, signalType, instance);
    const g = groups.get(key) ?? { obs: [], instance, signalType, subjectKey };
    // One evidence row per source URL per event.
    if (!g.obs.some((x) => x.source_url === o.source_url)) g.obs.push(o);
    groups.set(key, g);
  }
  const signals: LisaSignal[] = [];
  const dropped: Array<{ reason: DropReason; url: string }> = [];
  for (const [key, g] of groups) {
    const first = g.obs[0];
    // The event date is the EARLIEST any source states — a later re-report never refreshes it.
    const dates = g.obs.map((o) => o.event_date).filter((d): d is string => !!d).sort();
    const event_date = dates[0] ?? null;
    if (isStale(first.category, event_date, now)) { dropped.push({ reason: "stale", url: first.source_url }); continue; }
    const verification = verify(g.obs);
    const companySite = g.obs.find((o) => o.source_type === "company_site");
    const primary = companySite ?? g.obs.find((o) => o.source_type === "news") ?? first;
    const s: LisaSignal = {
      workspace_id, category: first.category, signal_type: g.signalType, signal_category: SIGNAL_TYPE[first.category].category,
      subject_type: subject.kind === "competitor" ? "competitor" : "company", subject_key: g.subjectKey,
      company_name: first.company_name, company_domain: first.company_domain,
      title: primary.title.slice(0, 200), description: primary.description.slice(0, 600),
      event_date, discovered_at: discovered, source_url: primary.source_url, source_type: primary.source_type,
      evidence: g.obs.map((o) => ({ url: o.source_url, domain: o.source_domain, excerpt: o.excerpt, observed_at: discovered,
        negation: o.negation, source_type: o.source_type, attributes: o.attributes })),
      verification, relevance: null, dedupe_key: key, event_instance: g.instance,
      lifecycle_status: verification.retracted ? "retracted" : verification.level === "contradicted" ? "contradicted" : "active",
      collection_method: method, provider, processing_status: "new", watch_origin: subject.origin,
    };
    s.relevance = evaluateRelevance(s, brain, subject, now);
    if (s.relevance.band === "excluded") { dropped.push({ reason: "excluded", url: s.source_url }); continue; }
    signals.push(s);
  }
  return { signals, dropped };
}

function bump(c: PassCounts, r: DropReason, n = 1) { c.dropped[r] = (c.dropped[r] ?? 0) + n; }

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error("timeout")); }, ms); });
  try { return await Promise.race([fn(ac.signal), timeout]); }
  finally { clearTimeout(timer); }
}

/** Run one subject end to end. Never throws; every failure is in the result. */
export async function runPass(input: PassInput): Promise<PassResult> {
  const counts = emptyCounts();
  const errors: string[] = [];
  const plan = planQueries(input.subject, collectContext(input.brain, input.now));
  counts.queries_planned = plan.length;
  const observations: Observation[] = [];

  for (const step of plan) {
    const auth = await input.budget.authorize(step.query);
    if (!auth.ok) { counts.budget_refused++; errors.push(`budget: ${auth.reason}`); break; }
    counts.queries_sent++;
    let result;
    try {
      result = await withTimeout(input.timeout_ms ?? 20_000, (signal) => input.source.search(step.query, { limit: input.limit ?? 5, signal }));
    } catch (e) {
      result = { hits: [], error: e instanceof Error && e.message === "timeout" ? "timeout" : "provider_threw", credits: 0 };
    }
    const hits = Array.isArray(result?.hits) ? result.hits : null;
    const error = result?.error ?? (hits ? null : "invalid_response");
    counts.credits += Number(result?.credits) || 0;
    await input.budget.settle(auth.token, Number(result?.credits) || 0, !error);
    if (error) { counts.provider_errors++; errors.push(`${step.category}: ${error}`); continue; }
    counts.hits += hits!.length;
    for (const hit of hits!) {
      const ex = extract(hit, input.subject, step.category);
      observations.push(...ex.observations);
      for (const d of ex.dropped) bump(counts, d.reason);
    }
  }
  counts.observations = observations.length;

  const built = buildSignals(input.workspace_id, input.subject, observations, input.brain, input.now, input.method, input.source.provider);
  for (const d of built.dropped) bump(counts, d.reason);
  counts.events = built.signals.length;

  const stored: LisaSignal[] = [];
  for (const s of built.signals) {
    let out: StoreOutcome;
    try { out = await input.store.record(s); }
    catch { out = { status: "failed", event_id: null, error: "store_threw" }; }
    if (out.status === "failed") { counts.persist_failed++; errors.push(`persist: ${out.error ?? "failed"}`); continue; }
    counts[out.status]++;
    s.processing_status = out.status;
    stored.push(s);
  }

  const status: PassResult["status"] =
    counts.budget_refused && counts.queries_sent === 0 ? "budget_exhausted"
    : counts.persist_failed && stored.length === 0 && counts.events > 0 ? "failed"
    : counts.provider_errors && counts.provider_errors === counts.queries_sent && counts.queries_sent > 0 ? "failed"
    : counts.persist_failed || counts.provider_errors || counts.budget_refused ? "partial"
    : counts.events === 0 ? "empty"
    : "ok";
  return { status, counts, signals: stored, errors };
}
