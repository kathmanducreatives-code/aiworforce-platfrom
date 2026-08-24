// NEVER BUY EVIDENCE AGENTORY ALREADY HAS — WHATEVER FOUND IT.
//
// ── THE RULE, AND WHY IT NEEDS TO BE CROSS-ORIGIN ───────────────────────────
//
// `signal_events` is one store fed by Lead missions and by monitoring. So if a
// Lead mission proved Acme raised a Series A an hour ago, a monitoring run
// asking "did anyone in my ICP raise?" already has the answer. Buying it again
// is paying twice for one fact.
//
// The reuse therefore keys on the QUESTION — workspace, company, signal — and
// deliberately not on origin. A check that only reused monitoring's own output
// would make Leads and Signals two caches of the same providers, which is the
// duplication this whole convergence exists to remove.
//
// ── STALE EVIDENCE MUST NOT BLOCK ───────────────────────────────────────────
//
// The opposite failure is worse and quieter. A funding round from eight months
// ago is not a reason to skip looking today; treating any hit as a hit would
// freeze the feed at whatever was first discovered and call it monitoring.
//
// So freshness is judged against the mission's own window: `timeframe_days` on
// the signal is what the workspace said it cares about, and evidence older than
// that is a historical record rather than an answer to today's question.
//
// ── WHAT COUNTS AS AN ANSWER ────────────────────────────────────────────────
//
// Only an event that actually establishes the signal. A row whose
// `occurred_at_basis` is `unknown` has no date, so it cannot be shown to fall
// inside a window — it is evidence that something happened, not evidence that
// it happened recently, and it may not suppress a fresh look.
//
// PURE. The store is injected. No network, provider, model or database access.

import type { SignalEvent, SignalSubject } from "./missionSignalDescriptor.ts";

export const MONITORING_PREFLIGHT_VERSION = "monitoring-preflight-v1" as const;

/** One stored event, as the pre-flight needs to see it. */
export interface ExistingEvidence {
  signal_type: string;
  /** Canonical event time. Null when the source never reported one. */
  occurred_at: string | null;
  occurred_at_basis: "source_reported" | "unknown";
  /** When Agentory observed it. Never a substitute for `occurred_at`. */
  observed_at: string;
  /** Which workflow produced it. Recorded, never used to decide reuse. */
  origin: string;
  /** Whichever identity the event is filed under. */
  account_id?: string | null;
  subject_type?: string | null;
  subject_key?: string | null;
  lifecycle_status?: string | null;
}

/** What the monitoring run is about to go and buy. */
export interface PlannedInvestigation {
  /** Company identity, when the question is about a specific company. */
  account_id?: string | null;
  /** Subject identity, when it is about a competitor or a market. */
  subject_type?: string | null;
  subject_key?: string | null;
  event: SignalEvent | string;
  subject: SignalSubject | string;
  /** The workspace's own window. Null means no window was stated. */
  timeframe_days: number | null;
}

export type PreflightVerdict =
  /** Fresh evidence already answers this. Skip the purchase. */
  | "reuse"
  /** Nothing usable is held. The investigation may run and may charge. */
  | "investigate";

export interface PreflightDecision {
  verdict: PreflightVerdict;
  /** Named so a skipped purchase can be explained and audited. */
  reason: string;
  /** True when this decision prevented a provider call. */
  spend_avoided: boolean;
  /** The origin that produced the reused evidence — reporting only. */
  reused_from_origin: string | null;
  /** How old the reused evidence is, in days. */
  reused_age_days: number | null;
  /** Held evidence that was too old to answer today's question. */
  stale_hits: number;
  /** Held evidence with no date, which cannot prove recency either way. */
  undated_hits: number;
}

/**
 * Which canonical signal types establish which mission signal.
 *
 * Deliberately narrow. A `sales_hiring` row proves a hiring signal; a
 * `market_problem_discussion` row proves that the category is being talked
 * about and proves nothing about any company's hiring, so it must never
 * suppress a hiring investigation.
 */
export const EVENT_TYPES_FOR_SIGNAL:
  Readonly<Record<string, readonly string[]>> = Object.freeze({
    hiring: ["sales_hiring", "revops_hiring", "growth_hiring", "new_revenue_leader"],
    funding: ["recent_funding"],
    expansion: ["market_expansion", "geographic_expansion"],
    product_launch: ["product_launch", "major_release", "new_integration", "category_expansion"],
    technology: [],
    headcount_change: ["employee_growth"],
    post: [
      "founder_pipeline_post", "founder_outbound_post",
      "founder_customer_acquisition_post", "founder_hiring_post",
      "founder_problem_statement",
    ],
    // MARKET TYPES PROVE NOTHING ABOUT A COMPANY, so no mission signal maps
    // onto them. Listed as empty rather than omitted: an absent key and a
    // deliberately empty one read the same at runtime and differently to a
    // person deciding whether something was forgotten.
    comment: [],
    leadership_change: [],
  });

/** Lifecycle states in which an event still answers anything. */
const USABLE_LIFECYCLE: readonly string[] = Object.freeze(["active"]);

function daysBetween(a: string, b: number): number | null {
  const t = Date.parse(a);
  if (!isFinite(t)) return null;
  return (b - t) / 86_400_000;
}

/**
 * Does this stored event answer the planned investigation?
 *
 * Identity must match on whichever axis the question is asked. An account
 * question is answered by an account event; a subject question by an event
 * about the same subject. Crossing them would let a competitor's funding round
 * suppress a prospect's.
 */
export function evidenceAnswers(
  e: ExistingEvidence, p: PlannedInvestigation,
): boolean {
  const types = EVENT_TYPES_FOR_SIGNAL[String(p.event)] ?? [];
  if (!types.includes(e.signal_type)) return false;
  if (!USABLE_LIFECYCLE.includes(e.lifecycle_status ?? "active")) return false;

  if (p.account_id) return e.account_id === p.account_id;
  if (p.subject_type && p.subject_key) {
    return e.subject_type === p.subject_type && e.subject_key === p.subject_key;
  }
  // A question with no identity is about the cohort, not about anybody. Held
  // evidence cannot answer it, because "somebody in the ICP raised" says
  // nothing about whether anybody ELSE did.
  return false;
}

/**
 * Decide whether to spend.
 *
 * `now` is injected so freshness is testable without waiting a month.
 */
export function preflight(
  planned: PlannedInvestigation,
  held: readonly ExistingEvidence[],
  now: number = Date.now(),
): PreflightDecision {
  const candidates = held.filter((e) => evidenceAnswers(e, planned));

  const none = (reason: string): PreflightDecision => ({
    verdict: "investigate", reason, spend_avoided: false,
    reused_from_origin: null, reused_age_days: null,
    stale_hits: 0, undated_hits: 0,
  });

  if (candidates.length === 0) {
    return none("nothing held answers this question; the investigation may run");
  }

  // ── UNDATED EVIDENCE CANNOT PROVE RECENCY ────────────────────────────────
  const dated = candidates.filter((e) =>
    e.occurred_at_basis === "source_reported" && e.occurred_at);
  const undated = candidates.length - dated.length;

  if (dated.length === 0) {
    const d = none(
      `${undated} held event(s) match but carry no source date, so none can be ` +
      `shown to fall inside the window; re-investigating`);
    return { ...d, undated_hits: undated };
  }

  // NO WINDOW STATED ⇒ ANY DATED ANSWER WILL DO. The workspace asked for the
  // signal without qualifying recency, so the freshest held answer is an answer.
  const ages = dated
    .map((e) => ({ e, age: daysBetween(e.occurred_at!, now) }))
    .filter((x): x is { e: ExistingEvidence; age: number } => x.age !== null)
    .sort((a, b) => a.age - b.age);

  if (ages.length === 0) {
    const d = none("held events carry unparseable dates; re-investigating");
    return { ...d, undated_hits: undated };
  }

  const freshest = ages[0];
  const window = planned.timeframe_days;

  if (window == null || freshest.age <= window) {
    return {
      verdict: "reuse",
      reason: `${freshest.e.signal_type} evidence from ` +
        `${freshest.age.toFixed(1)} day(s) ago (origin ${freshest.e.origin})` +
        (window == null ? " and no window was stated" : ` is inside the ${window}-day window`) +
        "; nothing was purchased again",
      spend_avoided: true,
      reused_from_origin: freshest.e.origin,
      reused_age_days: Number(freshest.age.toFixed(2)),
      stale_hits: 0,
      undated_hits: undated,
    };
  }

  // STALE MUST NOT BLOCK. The held answer is a historical record, not an answer
  // to today's question.
  return {
    verdict: "investigate",
    reason: `the freshest held ${freshest.e.signal_type} evidence is ` +
      `${freshest.age.toFixed(1)} day(s) old, outside the ${window}-day window; ` +
      `re-investigating rather than reporting a stale fact as current`,
    spend_avoided: false,
    reused_from_origin: null,
    reused_age_days: null,
    stale_hits: ages.length,
    undated_hits: undated,
  };
}

/** Roll a run's decisions into what the caller reports. */
export function summarisePreflight(
  decisions: readonly PreflightDecision[],
): { planned: number; reused: number; investigating: number; origins: Record<string, number> } {
  const origins: Record<string, number> = {};
  let reused = 0;
  for (const d of decisions) {
    if (d.verdict !== "reuse") continue;
    reused++;
    const o = d.reused_from_origin ?? "unknown";
    origins[o] = (origins[o] ?? 0) + 1;
  }
  return {
    planned: decisions.length,
    reused,
    investigating: decisions.length - reused,
    origins,
  };
}
