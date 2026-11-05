// Strategy discovery in the browser: lead-pipeline's `strategy_plan` → owner approval →
// `strategy_run`, and the words for what came back (Apify only, LeadOcean only, or both
// concurrently).
//
// Off unless VITE_STRATEGY_DISCOVERY === 'true' (and the server's own switches:
// LEAD_PIPELINE_ENABLED + the workspace allowlist + each provider's flag; the function
// answers 404/403 otherwise, and that answer is shown as-is).
//
// NOTHING HERE COUNTS, ESTIMATES OR DECIDES. Every figure and verdict comes from the
// response: the plan's worst case, the run's spend, its provider summary
// (providerRunSummary.ts) and each company's own qualification status. A response this
// module cannot read yields an error, never a zero-filled or guessed view.
//
// Pure (the network call is injected). No React.

import { readProviderRunSummary, type ProviderRunSummary } from './providerRunSummary';

export type StrategyChoice = 'auto' | 'apify_only' | 'leadocean_only' | 'apify_leadocean_concurrent';
export const STRATEGY_CHOICES: { id: StrategyChoice; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Auto', blurb: 'Agentory picks the strategy that can prove your requirements.' },
  { id: 'apify_only', label: 'Apify', blurb: 'Discover by dated signals (job postings), then verify each company.' },
  { id: 'leadocean_only', label: 'LeadOcean', blurb: 'Company and people candidates. Hiring is not proven by LeadOcean alone.' },
  { id: 'apify_leadocean_concurrent', label: 'Both', blurb: 'Both providers on the same mission; results merged without double counting.' },
];

export function strategyDiscoveryUiEnabled(env: Record<string, unknown> = (import.meta as { env?: Record<string, unknown> }).env ?? {}): boolean {
  return env.VITE_STRATEGY_DISCOVERY === 'true';
}

export type Invoke = <T>(name: string, body: unknown) => Promise<{ data: T | null; error: (Error & { context?: Response }) | null }>;
export type Result<T> = { ok: true; value: T; error?: undefined } | { ok: false; value?: undefined; error: string };

/** The server validates walk ids as /^[a-z0-9:_-]{1,120}$/i; one walk per card and strategy. */
export function walkIdFor(messageId: string, choice: StrategyChoice): string {
  const base = messageId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80) || 'card';
  return `ui-${base}-${choice}`.slice(0, 120);
}

async function errorMessage(e: (Error & { context?: Response }) | null, fallback: string): Promise<string> {
  try {
    const j = await e?.context?.clone().json();
    if (j && typeof j.error === 'string') return j.error;
    if (j && typeof j.plan?.blockedReason === 'string') return j.plan.blockedReason;
  } catch { /* fall through */ }
  return fallback;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// ── Plan ────────────────────────────────────────────────────────────────────

export interface StrategyPlanView {
  status: 'ready' | 'blocked';
  blockedReason: string | null;
  strategy: string | null;
  selectedBy: string | null;
  rationale: string[];
  steps: { capability: string; provider: string; role: string; maxItems: number | null; why: string | null; estimate: { apifyUsd: number; leadoceanRecords: number } }[];
  worstCase: { apifyUsd: number; leadoceanRecords: number };
  planHash: string;
  approvalToken: string | null;
}

/** The plan as the server returned it, or null when the shape is not one we can show. */
export function readStrategyPlan(body: unknown): StrategyPlanView | null {
  if (!isObj(body) || !isObj(body.plan)) return null;
  const p = body.plan;
  if (p.status !== 'ready' && p.status !== 'blocked') return null;
  const est = isObj(p.estimate) ? p.estimate : null;
  const usd = amount(est?.apifyUsd), lo = amount(est?.leadoceanRecords);
  if (usd === null || lo === null || typeof p.planHash !== 'string') return null;
  const steps = Array.isArray(p.steps) ? p.steps.filter(isObj).map((s) => {
    const e = isObj(s.estimate) ? s.estimate : {};
    return {
      capability: String(s.capability ?? ''), provider: String(s.provider ?? ''), role: String(s.role ?? ''),
      maxItems: typeof s.maxItems === 'number' ? s.maxItems : null, why: str(s.why),
      estimate: { apifyUsd: amount(e.apifyUsd) ?? 0, leadoceanRecords: amount(e.leadoceanRecords) ?? 0 },
    };
  }) : [];
  return {
    status: p.status, blockedReason: str(p.blockedReason), strategy: str(p.strategy), selectedBy: str(p.selectedBy),
    rationale: Array.isArray(p.rationale) ? p.rationale.map(String) : [],
    steps, worstCase: { apifyUsd: usd, leadoceanRecords: lo }, planHash: p.planHash,
    approvalToken: str(body.approval_token),
  };
}

export interface PlanRequest { workspaceId: string; messageId: string; query: string; choice: StrategyChoice; requestedCount?: number | null }

function baseBody(r: PlanRequest) {
  return {
    workspace_id: r.workspaceId, walk_id: walkIdFor(r.messageId, r.choice), query: r.query,
    ...(r.requestedCount ? { requested_count: r.requestedCount } : {}),
    ...(r.choice === 'auto' ? {} : { strategy: r.choice }),
    // LeadOcean alone cannot prove a hiring signal: its companies are shown as pending review.
    allow_review_only: r.choice === 'leadocean_only',
  };
}

export async function planStrategy(invoke: Invoke, r: PlanRequest): Promise<Result<StrategyPlanView>> {
  const res = await invoke<Record<string, unknown>>('lead-pipeline', { action: 'strategy_plan', ...baseBody(r) });
  // A blocked plan answers 409 with the plan in the body: still a plan to show.
  const ctx = res.error?.context;
  let body: unknown = res.data;
  if (!body && ctx) { try { body = await ctx.clone().json(); } catch { body = null; } }
  const plan = readStrategyPlan(body);
  return plan ? { ok: true, value: plan } : { ok: false, error: await errorMessage(res.error, 'The discovery service is unavailable.') };
}

/** Run exactly the plan the owner approved: its hash, its worst case as the ceilings, and its signed token. */
export async function runStrategy(invoke: Invoke, r: PlanRequest, plan: StrategyPlanView): Promise<Result<StrategyRunView>> {
  if (plan.status !== 'ready') return { ok: false, error: plan.blockedReason ?? 'This plan cannot run.' };
  const res = await invoke<Record<string, unknown>>('lead-pipeline', {
    action: 'strategy_run', ...baseBody(r),
    approval: { plan_hash: plan.planHash, apify_usd: plan.worstCase.apifyUsd, leadocean_records: plan.worstCase.leadoceanRecords, ...(plan.approvalToken ? { token: plan.approvalToken } : {}) },
  });
  const run = readStrategyRun(res.data);
  return run ? { ok: true, value: run } : { ok: false, error: await errorMessage(res.error, 'The run did not return a readable result.') };
}

// ── Run ─────────────────────────────────────────────────────────────────────

export type Verdict = 'qualified' | 'pending' | 'rejected';
export interface CompanySignal { type: string; provider: string; sourceUrl: string | null; eventDate: string | null; collectedAt: string | null; excerpt: string | null; corroboration: string | null }
export interface CompanyRow {
  key: string; name: string; domain: string | null; linkedinUrl: string | null; website: string | null;
  providers: string[];
  /** The backend's own status (eligible / pending / ineligible), mapped to words only. */
  verdict: Verdict;
  inReview: boolean;
  checks: { dimension: string; result: string; reason: string }[];
  gaps: string[]; disproven: string[];
  evidenceSources: string[];
  signals: CompanySignal[];
  conflicts: { field: string; values: { provider: string; value: string }[] }[];
}
export interface StrategyRunView {
  status: string; reason: string | null; strategy: string | null;
  spend: { apifyUsd: number; leadoceanRecords: number };
  steps: { capability: string; provider: string; status: string; reason: string | null }[];
  companies: CompanyRow[];
  excludedCount: number;
  written: number | null;
  summary: ProviderRunSummary | null;
  /** The raw response, for ProviderRunSummaryCard (which reads `providerSummary` itself). */
  response: Record<string, unknown>;
}

/** Provider-supplied URLs are untrusted: only http(s) links are ever rendered. */
export function safeHref(u: string | null): string | null {
  if (!u) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}
const domainHref = (d: string | null) => (d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? `https://${d}` : null);

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

function companyRow(l: unknown, inReview: boolean): CompanyRow | null {
  if (!isObj(l) || !isObj(l.company) || !isObj(l.statuses)) return null;
  const c = l.company, q = isObj(l.qualification) ? l.qualification : {}, prov = isObj(l.provenance) ? l.provenance : {};
  const status = l.statuses.qualification;
  // Same mapping as the backend summary (providerRunSummary.ts): the queue's eligible are
  // qualified, the review's ineligible are rejected, everything else is pending.
  const verdict: Verdict = !inReview && status === 'eligible' ? 'qualified' : inReview && status === 'ineligible' ? 'rejected' : 'pending';
  const es = q.evidence_sources;
  return {
    key: String(c.key ?? l.leadKey ?? ''), name: str(c.name) ?? str(c.domain) ?? 'Unnamed company',
    domain: str(c.domain), linkedinUrl: safeHref(str(c.linkedinUrl)), website: domainHref(str(c.domain)),
    providers: Array.isArray(prov.providers) ? [...new Set(prov.providers.map(String))] : [],
    verdict, inReview,
    checks: Array.isArray(q.checks) ? q.checks.filter(isObj).map((k) => ({ dimension: String(k.dimension ?? ''), result: String(k.result ?? ''), reason: String(k.reason ?? '') })) : [],
    gaps: Array.isArray(q.gaps) ? q.gaps.map(String) : [],
    disproven: Array.isArray(q.disproven) ? q.disproven.map(String) : [],
    evidenceSources: Array.isArray(es) ? es.map(String) : isObj(es) ? Object.keys(es) : [],
    signals: Array.isArray(l.signals) ? l.signals.filter(isObj).map((s) => ({
      type: String(s.type ?? ''), provider: String(s.provider ?? ''), sourceUrl: safeHref(str(s.sourceUrl)), eventDate: str(s.eventDate),
      collectedAt: str(s.collectedAt), excerpt: isObj(s.evidence) ? str(s.evidence.excerpt) : null, corroboration: str(s.corroboration),
    })) : [],
    conflicts: Array.isArray(prov.conflicts) ? prov.conflicts.filter(isObj).map((x) => ({
      field: String(x.field ?? ''), values: Array.isArray(x.values) ? x.values.filter(isObj).map((v) => ({ provider: String(v.provider ?? ''), value: show(v.value) })) : [],
    })) : [],
  };
}

/** The run as the server returned it, or null when it is not a run response. */
export function readStrategyRun(body: unknown): StrategyRunView | null {
  if (!isObj(body) || typeof body.status !== 'string' || !Array.isArray(body.steps) || !isObj(body.spend)) return null;
  const usd = amount(body.spend.apifyUsd), lo = amount(body.spend.leadoceanRecords);
  if (usd === null || lo === null) return null;
  const queue = Array.isArray(body.queue) ? body.queue : [], review = Array.isArray(body.review) ? body.review : [];
  const companies = [...queue.map((l) => companyRow(l, false)), ...review.map((l) => companyRow(l, true))].filter((x): x is CompanyRow => !!x);
  return {
    status: body.status, reason: str(body.reason), strategy: str(body.strategy),
    spend: { apifyUsd: usd, leadoceanRecords: lo },
    steps: body.steps.filter(isObj).map((s) => ({ capability: String(s.capability ?? ''), provider: String(s.provider ?? ''), status: String(s.status ?? ''), reason: str(s.reason) })),
    companies, excludedCount: typeof body.excludedCount === 'number' ? body.excludedCount : 0,
    written: typeof body.written === 'number' ? body.written : null,
    summary: readProviderRunSummary(body), response: body,
  };
}

// ── Words ───────────────────────────────────────────────────────────────────

export const STRATEGY_LABEL: Record<string, string> = {
  apify_only: 'Apify only', leadocean_only: 'LeadOcean only', apify_leadocean_concurrent: 'Apify + LeadOcean (concurrent)',
  leadocean_plus_apify: 'LeadOcean, then Apify', apify_plus_leadocean: 'Apify, then LeadOcean', apollo_plus_apify: 'Apollo + Apify',
};
export const strategyLabel = (s: string | null) => (s ? STRATEGY_LABEL[s] ?? s.replace(/_/g, ' ') : 'No strategy');

export function worstCaseLine(w: { apifyUsd: number; leadoceanRecords: number }): string {
  const parts = [w.apifyUsd > 0 ? `up to $${w.apifyUsd.toFixed(w.apifyUsd >= 1 ? 2 : 4)} Apify` : null, w.leadoceanRecords > 0 ? `up to ${w.leadoceanRecords} LeadOcean record${w.leadoceanRecords === 1 ? '' : 's'}` : null].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'No provider spend';
}

/**
 * The provider overlap view, read from ONE run's backend summary: what each provider
 * found, how many companies in total (each counted once), and how many more than one
 * provider found. Null without a summary — never estimated.
 */
export function overlapView(s: ProviderRunSummary | null): { perProvider: { provider: string; discovered: number; onlyHere: number }[]; combinedUnique: number; overlap: number } | null {
  if (!s) return null;
  return {
    perProvider: s.providers.map((p) => ({ provider: p.provider, discovered: p.discovered, onlyHere: p.unique })),
    combinedUnique: s.totals.companies, overlap: s.totals.foundByMultiple,
  };
}

/** Per run kept in the panel (this session only): the strategy and the backend's totals. */
export interface ComparisonRow { strategy: string; companies: number; qualified: number; pending: number; rejected: number; spend: { apifyUsd: number; leadoceanRecords: number }; failed: boolean; status: string }
export function comparisonRow(run: StrategyRunView): ComparisonRow | null {
  if (!run.summary) return null;
  const t = run.summary.totals;
  return {
    strategy: run.strategy ?? run.summary.strategy ?? 'unknown', companies: t.companies, qualified: t.qualified, pending: t.pending, rejected: t.rejected,
    spend: run.spend, failed: run.summary.providers.some((p) => p.failed), status: run.status,
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = { qualified: 'Qualified', pending: 'Pending', rejected: 'Rejected' };
