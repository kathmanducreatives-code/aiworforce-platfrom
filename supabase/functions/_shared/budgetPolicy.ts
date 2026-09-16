// LEAD V2 P2 — ABSOLUTE CEILINGS, AND ESTIMATE → RESERVE → EXECUTE → SETTLE.
//
// Before P2 a provider call's cost was learned after the fact, priced once from
// the run document before Apify settled its per-result charges. Run 1e52d43c's
// ledger recorded $0.2463 against $0.5902 billed; fd27bfac recorded $0.0711
// against $0.2711. No ceiling could stop a call it could not see coming.
//
// Now every call is ESTIMATED from its spec (the exact input it will send),
// RESERVED against absolute call / candidate / route / mission ceilings before
// the network call, marked EXECUTED with a provisional cost, and SETTLED from
// the provider's receipt when it is available. A call that would breach any
// ceiling is `refused_budget` and never runs. Unused budget stays unused — no
// percentage split (plan, "Cost and Idempotency").
//
// Pure. The ledger is plain data carried in the execution state and checkpoint.

export const BUDGET_POLICY_VERSION = "budget-policy-v1" as const;

export type CallPurpose =
  | "discovery" | "identity" | "enrichment" | "hiring_evidence" | "funding_evidence"
  | "news_evidence" | "team_composition" | "technology_evidence" | "people";

export interface Ceilings {
  mission_provider_usd: number;
  mission_model_usd: number;
  per_route_usd: Record<string, number>;
  per_call_usd: Partial<Record<CallPurpose, number>>;
  per_candidate_evidence_usd: number;
  adaptive_reserve_usd: number;
}

/** Plan defaults. Canary missions use `canaryCeilings`. */
export const DEFAULT_CEILINGS: Readonly<Ceilings> = Object.freeze({
  mission_provider_usd: 2.00,
  mission_model_usd: 0.40,
  per_route_usd: { company_profile: 0.40, hiring: 0.50, funding: 0.90 },
  per_call_usd: {
    identity: 0.03,
    enrichment: 0.05,
    hiring_evidence: 0.05,
    news_evidence: 0.05,
    funding_evidence: 0.05,
    team_composition: 0.03,
    technology_evidence: 0.05,
    people: 0.10,
  },
  per_candidate_evidence_usd: 0.06,
  adaptive_reserve_usd: 0.30,
});

export function canaryCeilings(base: Ceilings = DEFAULT_CEILINGS): Ceilings {
  return { ...base, mission_provider_usd: Math.min(base.mission_provider_usd, 1.50) };
}

export function resolveCeilings(over: Partial<Ceilings> | null | undefined, canary = false): Ceilings {
  const base = canary ? canaryCeilings() : { ...DEFAULT_CEILINGS };
  if (!over) return base;
  return {
    ...base, ...over,
    per_route_usd: { ...base.per_route_usd, ...(over.per_route_usd ?? {}) },
    per_call_usd: { ...base.per_call_usd, ...(over.per_call_usd ?? {}) },
  };
}

/** Purposes whose spend counts against a candidate's evidence ceiling. */
const CANDIDATE_EVIDENCE: ReadonlySet<CallPurpose> = new Set([
  "identity", "enrichment", "hiring_evidence", "funding_evidence", "news_evidence",
  "team_composition", "technology_evidence",
]);

export type ReservationStatus =
  | "reserved" | "executed" | "settled" | "refused_budget" | "adopted" | "released";

export interface SpendReservation {
  idempotency_key: string;
  provider_call_id: string;
  purpose: CallPurpose;
  route_id: string | null;
  /** Companies a call is about. Batch calls split their estimate across them. */
  candidate_keys: string[];
  estimate_usd: number;
  status: ReservationStatus;
  provisional_usd: number | null;
  settled_usd: number | null;
  settlement_source: "provider_receipt" | "derived_floor" | null;
  variance_usd: number | null;
  /** The provider's run, so the receipt can be fetched after the call returns. */
  provider_run_id?: string | null;
  /**
   * True once two consecutive receipt reads agree. Apify posts per-result
   * charges AFTER a run reports SUCCEEDED (4250f181: $0.059 read at SUCCEEDED,
   * $0.355 billed), so a first read is not final until a later read repeats it.
   */
  settlement_stable?: boolean;
  receipt_reads?: number;
}

export interface SpendLedger {
  version: typeof BUDGET_POLICY_VERSION;
  ceilings: Ceilings;
  reservations: SpendReservation[];
}

export function newSpendLedger(ceilings: Ceilings): SpendLedger {
  return { version: BUDGET_POLICY_VERSION, ceilings, reservations: [] };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** What a reservation commits: settled, else provisional, else the estimate. */
function committed(r: SpendReservation): number {
  if (r.status === "refused_budget" || r.status === "released" || r.status === "adopted") return 0;
  return r.settled_usd ?? r.provisional_usd ?? r.estimate_usd;
}

export function spendTotals(l: SpendLedger) {
  const live = l.reservations.filter((r) => committed(r) > 0);
  const byRoute: Record<string, number> = {};
  const byCandidate: Record<string, number> = {};
  for (const r of live) {
    const c = committed(r);
    if (r.route_id) byRoute[r.route_id] = round4((byRoute[r.route_id] ?? 0) + c);
    if (CANDIDATE_EVIDENCE.has(r.purpose) && r.candidate_keys.length) {
      const share = c / r.candidate_keys.length;
      for (const k of r.candidate_keys) byCandidate[k] = round4((byCandidate[k] ?? 0) + share);
    }
  }
  return {
    mission_committed_usd: round4(live.reduce((n, r) => n + committed(r), 0)),
    settled_usd: round4(l.reservations.reduce((n, r) => n + (r.settled_usd ?? 0), 0)),
    provisional_usd: round4(l.reservations.reduce((n, r) => n + (r.provisional_usd ?? 0), 0)),
    by_route: byRoute,
    by_candidate: byCandidate,
  };
}

export interface ReserveRequest {
  idempotency_key: string;
  provider_call_id: string;
  purpose: CallPurpose;
  route_id: string | null;
  /** The route's anchor kind, which selects its ceiling. */
  route_anchor?: string | null;
  candidate_keys?: readonly string[];
  estimate_usd: number;
}

export type ReserveDecision =
  | { ok: true; reservation: SpendReservation }
  | { ok: false; ceiling: "call" | "candidate" | "route" | "mission"; limit_usd: number;
      would_commit_usd: number; reservation: SpendReservation };

/** The per-call ceiling for a purpose; discovery calls are bounded by their route. */
export function callCeilingFor(c: Ceilings, purpose: CallPurpose, routeAnchor?: string | null): number {
  const perCall = c.per_call_usd[purpose];
  if (perCall != null) return perCall;
  const route = routeAnchor ? c.per_route_usd[routeAnchor] : undefined;
  return route ?? c.mission_provider_usd;
}

/**
 * Reserve a call against every ceiling, or refuse it.
 *
 * Idempotent: a key already reserved, executed or settled is returned as-is
 * and commits nothing new.
 */
export function reserve(l: SpendLedger, q: ReserveRequest): ReserveDecision {
  const existing = l.reservations.find((r) => r.idempotency_key === q.idempotency_key &&
    r.status !== "refused_budget" && r.status !== "released");
  if (existing) return { ok: true, reservation: existing };

  const candidates = [...(q.candidate_keys ?? [])];
  const reservation: SpendReservation = {
    idempotency_key: q.idempotency_key, provider_call_id: q.provider_call_id, purpose: q.purpose,
    route_id: q.route_id, candidate_keys: candidates, estimate_usd: round4(q.estimate_usd),
    status: "reserved", provisional_usd: null, settled_usd: null, settlement_source: null, variance_usd: null,
  };
  const refuse = (ceiling: "call" | "candidate" | "route" | "mission", limit: number, would: number): ReserveDecision => {
    const r = { ...reservation, status: "refused_budget" as const };
    l.reservations.push(r);
    return { ok: false, ceiling, limit_usd: limit, would_commit_usd: round4(would), reservation: r };
  };

  const est = reservation.estimate_usd;
  const callLimit = callCeilingFor(l.ceilings, q.purpose, q.route_anchor);
  if (est > callLimit + 1e-9) return refuse("call", callLimit, est);

  const totals = spendTotals(l);
  if (CANDIDATE_EVIDENCE.has(q.purpose) && candidates.length) {
    const share = est / candidates.length;
    for (const k of candidates) {
      const would = (totals.by_candidate[k] ?? 0) + share;
      if (would > l.ceilings.per_candidate_evidence_usd + 1e-9) {
        return refuse("candidate", l.ceilings.per_candidate_evidence_usd, would);
      }
    }
  }
  if (q.route_id && q.route_anchor && l.ceilings.per_route_usd[q.route_anchor] != null) {
    const limit = l.ceilings.per_route_usd[q.route_anchor];
    const would = (totals.by_route[q.route_id] ?? 0) + est;
    if (would > limit + 1e-9) return refuse("route", limit, would);
  }
  const wouldMission = totals.mission_committed_usd + est;
  if (wouldMission > l.ceilings.mission_provider_usd + 1e-9) {
    return refuse("mission", l.ceilings.mission_provider_usd, wouldMission);
  }
  l.reservations.push(reservation);
  return { ok: true, reservation };
}

function find(l: SpendLedger, key: string): SpendReservation | undefined {
  // Latest non-refused entry for the key.
  for (let i = l.reservations.length - 1; i >= 0; i--) {
    const r = l.reservations[i];
    if (r.idempotency_key === key && r.status !== "refused_budget") return r;
  }
  return undefined;
}

/** The call ran. `provisional_usd` is the derived floor until a receipt settles it. */
export function markExecuted(l: SpendLedger, key: string, provisional_usd: number): SpendReservation | null {
  const r = find(l, key);
  if (!r) return null;
  r.status = "executed";
  r.provisional_usd = round4(provisional_usd);
  r.settlement_source = "derived_floor";
  return r;
}

/** Name the provider run that executed a reservation. */
export function attachProviderRun(l: SpendLedger, key: string, runId: string | null | undefined): SpendReservation | null {
  const r = find(l, key);
  if (!r || !runId) return r ?? null;
  r.provider_run_id = runId;
  return r;
}

/** An existing paid run was re-read, not bought: it commits nothing. */
export function markAdopted(l: SpendLedger, key: string): SpendReservation | null {
  const r = find(l, key);
  if (!r) return null;
  r.status = "adopted";
  return r;
}

/** The call never started (deadline, adoption decided late, compile failure). */
export function release(l: SpendLedger, key: string): SpendReservation | null {
  const r = find(l, key);
  if (!r || r.status !== "reserved") return r ?? null;
  r.status = "released";
  return r;
}

/** Settle from the provider's receipt. The receipt is the truth. */
export function settle(
  l: SpendLedger, key: string, receipt_usd: number, mayBeFinal = true,
): SpendReservation | null {
  const r = find(l, key);
  if (!r) return null;
  const usd = round4(receipt_usd);
  // A repeat read that agrees with the last settlement makes it final.
  r.settlement_stable = mayBeFinal && r.status === "settled" && r.settled_usd === usd;
  r.receipt_reads = (r.receipt_reads ?? 0) + 1;
  r.settled_usd = usd;
  r.settlement_source = "provider_receipt";
  r.variance_usd = round4(usd - (r.provisional_usd ?? r.estimate_usd));
  r.status = "settled";
  return r;
}

// ── ESTIMATES ────────────────────────────────────────────────────────────────

export interface CostModelLike {
  start_usd?: number | null;
  per_result_usd?: number | null;
  events_usd?: Record<string, number> | null;
}

/** The rows a spec can bill for — the published multipliers included. */
export function billableRows(actorKey: string, input: Record<string, unknown>): number {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const len = (v: unknown) => (Array.isArray(v) ? v.length : v ? 1 : 0);
  switch (actorKey) {
    case "apify_linkedin_company_details":
      return len(input.companies) + len(input.searches);
    case "apify_linkedin_job_search":
      // "maxItems PER jobTitle PER location"
      return n(input.maxItems) * Math.max(1, len(input.jobTitles)) * Math.max(1, len(input.locations));
    case "apify_google_news":
      return n(input.maxArticles) * Math.max(1, len(input.keywords) + len(input.topics));
    case "apify_yc_companies_solidcode":
      return n(input.maxResults);
    default:
      return n(input.maxItems) || n(input.maxResults);
  }
}

/** Per-row price for the mode the input selects (e.g. full vs short company rows). */
export function perRowUsd(actorKey: string, model: CostModelLike, input: Record<string, unknown>): number {
  const ev = model.events_usd ?? {};
  const base = model.per_result_usd ?? 0;
  if (actorKey === "apify_linkedin_company_search") {
    return String(input.scraperMode ?? "short") === "full"
      ? (ev["full-company"] ?? base) : (ev["short-company"] ?? base);
  }
  if (actorKey === "apify_linkedin_company_employees" || actorKey === "apify_people_search") {
    const mode = String(input.profileScraperMode ?? "");
    if (/email/i.test(mode)) return ev["full-profile-with-email"] ?? base;
    if (/full/i.test(mode)) return ev["full-profile"] ?? base;
    return ev["short-profile"] ?? base;
  }
  return base;
}

export function estimateCallUsd(actorKey: string, model: CostModelLike, input: Record<string, unknown>): number {
  return round4((model.start_usd ?? 0) + billableRows(actorKey, input) * perRowUsd(actorKey, model, input));
}

/** The largest row count a call ceiling affords, for the spec's count clamp. */
export function affordableRows(
  actorKey: string, model: CostModelLike, input: Record<string, unknown>, ceilingUsd: number,
): number {
  const per = perRowUsd(actorKey, model, input);
  if (per <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((ceilingUsd - (model.start_usd ?? 0) + 1e-9) / per));
}

/** Derived floor for an executed call: start + rows actually returned × row price. */
export function derivedFloorUsd(
  actorKey: string, model: CostModelLike, input: Record<string, unknown>, rowsReturned: number,
): number {
  return round4((model.start_usd ?? 0) + Math.max(0, rowsReturned) * perRowUsd(actorKey, model, input));
}

// ── SETTLEMENT PASS ─────────────────────────────────────────────────────────

export interface ProviderReceipt {
  /** The provider's settled total. */
  usageTotalUsd?: number | null;
  /** Charged event counts x the run's own event prices, when the run reports them. */
  chargedUsd?: number | null;
  status?: string | null;
  /** When the run finished; charges keep posting for a while after. */
  finishedAt?: string | null;
}

/** The receipt's charge: the larger of the usage total and the priced events, never their sum. */
export function receiptUsd(r: ProviderReceipt | null | undefined): number | null {
  const vals = [r?.usageTotalUsd, r?.chargedUsd]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Settle every executed reservation whose receipt is available.
 *
 * `receiptFor` is injected (Apify `GET /actor-runs/{id}` in production, fixture
 * receipts in tests). A receipt that is missing or unsettled leaves the
 * provisional floor in place — never a guess.
 */
export async function settlementPass(
  l: SpendLedger,
  receiptFor: (r: SpendReservation) => Promise<ProviderReceipt | null>,
  opts: { resettle?: boolean; minFinishedAgeMs?: number; now?: () => number } = {},
): Promise<{ settled: number; unsettled: number }> {
  let settled = 0, unsettled = 0;
  for (const r of l.reservations) {
    const open = r.status === "executed" ||
      (opts.resettle === true && r.status === "settled" && r.settlement_stable !== true);
    if (!open) continue;
    const receipt = await receiptFor(r).catch(() => null);
    const usd = receiptUsd(receipt);
    const done = !receipt?.status || /SUCCEEDED|FAILED|ABORTED|TIMED-OUT/i.test(String(receipt.status));
    if (typeof usd === "number" && Number.isFinite(usd) && done) {
      const finished = receipt?.finishedAt ? Date.parse(receipt.finishedAt) : NaN;
      const age = Number.isFinite(finished) ? (opts.now ?? Date.now)() - finished : Infinity;
      settle(l, r.idempotency_key, usd, age >= (opts.minFinishedAgeMs ?? 0));
      settled++;
    } else {
      unsettled++;
    }
  }
  return { settled, unsettled };
}
