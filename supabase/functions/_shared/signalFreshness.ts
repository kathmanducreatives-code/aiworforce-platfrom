// Signal freshness + strength policy (Phase A) — pure, deterministic, clock-injected.
//
// WHY occurred_at, NOT observed_at
// The existing `isEvidenceFresh` (candidateEnvelope.ts) keys freshness on
// `observedAt` — when WE saw the fact. That is correct for firmographics (a company's
// website doesn't get less true with age) but WRONG for timing: a funding round
// announced eight months ago and scraped today would look "fresh" and fabricate
// urgency. Timing freshness therefore keys on `occurred_at` — when the event actually
// happened. This module is the only place that judgment lives.
//
// NO SINGLE OPAQUE SCORE
// Timing strength is composed from four NAMED, independently inspectable components
// (evidence confidence · event freshness · ICP relevance · relationship strength) so a
// reviewer can always see WHY a candidate looked hot. Each component is reported
// alongside the verdict.
//
// WINDOWS ARE POLICY, NOT MAGIC NUMBERS
// Every window below is documented with its rationale and is overridable per call.
// These are CONSERVATIVE DEFAULTS for the provider-free foundation — they are not a
// silent production decision. See SIGNAL_FRESHNESS_POLICY.

import type { EvidenceConfidence } from "./evidenceContract.ts";
import {
  type SignalEvent, type SignalType, type SignalCategory, type ListingStatus,
  isRiskSignal, isTimingCapableSignal, signalCategoryOf,
} from "./signalEvent.ts";
import {
  type FundingFreshnessBand, type TimingFreshnessBand,
  FUNDING_MAX_AGE_DAYS, JOB_MAX_AGE_DAYS,
  fundingBandForAgeDays, jobBandForAgeDays, listingStatusIsDead,
  DAYS as POLICY_DAYS,
} from "./timingFreshnessPolicy.ts";

/** Strength bands — deliberately coarse and explainable, never a bare float. */
export type SignalStrength = "none" | "weak" | "moderate" | "strong";

const STRENGTH_RANK: Readonly<Record<SignalStrength, number>> = {
  none: 0, weak: 1, moderate: 2, strong: 3,
};

export function strengthAtLeast(actual: SignalStrength, minimum: SignalStrength): boolean {
  return STRENGTH_RANK[actual] >= STRENGTH_RANK[minimum];
}

/**
 * How long an event of each type stays meaningful, measured from `occurred_at`.
 *
 * Rationale per band (documented so these are reviewable, not folklore):
 *  - Engagement decays fastest: a like from three weeks ago is not a reason to
 *    contact someone today. 14d.
 *  - Founder posts are a live problem statement while the conversation is current. 30d.
 *  - Hiring is a durable intent — a sales role posted six weeks ago usually means the
 *    team is still being built. 60d.
 *  - Product launches justify outreach for roughly a quarter. 90d.
 *  - Funding stays relevant longest: budget released this year is still budget. 180d.
 *  - Risk signals never expire on this table — a person who left a company has not
 *    "become fresh again". Handled by isRiskSignal, never by a window.
 */
export interface SignalFreshnessPolicy {
  /** Max age in hours, keyed by signal type. */
  windowHours: Partial<Record<SignalType, number>>;
  /** Fallback when a type is absent from the table. */
  defaultWindowHours: number;
}

const DAYS = (d: number) => d * 24;

export const SIGNAL_FRESHNESS_POLICY: SignalFreshnessPolicy = {
  defaultWindowHours: DAYS(30),
  windowHours: {
    // growth — funding's ceiling comes from THE canonical authority so this table and
    // the evidence contract cannot drift apart. Decay bands govern strength within it.
    recent_funding: POLICY_DAYS(FUNDING_MAX_AGE_DAYS),
    employee_growth: DAYS(90),
    market_expansion: DAYS(90),
    geographic_expansion: DAYS(90),
    // gtm — hiring retention comes from THE canonical authority (60d). The 30d
    // DEFAULT requirement window lives in the contract; 31-60d is supporting-only
    // unless the user explicitly asked for the last 60 days.
    sales_hiring: POLICY_DAYS(JOB_MAX_AGE_DAYS),
    revops_hiring: POLICY_DAYS(JOB_MAX_AGE_DAYS),
    growth_hiring: POLICY_DAYS(JOB_MAX_AGE_DAYS),
    new_revenue_leader: DAYS(90),
    outbound_initiative: DAYS(60),
    positioning_change: DAYS(90),
    // product
    product_launch: DAYS(90),
    major_release: DAYS(90),
    new_integration: DAYS(90),
    category_expansion: DAYS(90),
    // founder intent — a live conversation, not an archive
    founder_pipeline_post: DAYS(30),
    founder_outbound_post: DAYS(30),
    founder_customer_acquisition_post: DAYS(30),
    founder_hiring_post: DAYS(30),
    founder_problem_statement: DAYS(30),
    // engagement — decays fastest
    linkedin_connection_accepted: DAYS(14),
    linkedin_post_like: DAYS(14),
    linkedin_post_comment: DAYS(14),
    linkedin_post_reply: DAYS(14),
    direct_reply: DAYS(14),
    content_engagement: DAYS(14),
  },
};

export function windowHoursFor(t: SignalType, policy: SignalFreshnessPolicy = SIGNAL_FRESHNESS_POLICY): number {
  return policy.windowHours[t] ?? policy.defaultWindowHours;
}

/** Age of the EVENT in hours. Negative ages (future events) are treated as 0. */
export function signalAgeHours(s: Pick<SignalEvent, "occurred_at">, now: string): number | null {
  const t = Date.parse(s.occurred_at);
  const n = Date.parse(now);
  if (!isFinite(t) || !isFinite(n)) return null;
  return Math.max(0, (n - t) / 3600_000);
}

/**
 * Fresh = the event happened inside its type's window, and any explicit expires_at
 * has not passed. Keyed on occurred_at — see the module header.
 */
export function isSignalFresh(
  s: SignalEvent, now: string, policy: SignalFreshnessPolicy = SIGNAL_FRESHNESS_POLICY,
): boolean {
  if (s.expires_at) {
    const e = Date.parse(s.expires_at); const n = Date.parse(now);
    if (isFinite(e) && isFinite(n) && n > e) return false;
  }
  const age = signalAgeHours(s, now);
  if (age == null) return false;
  return age <= windowHoursFor(s.signal_type, policy);
}

// ------------------------------------------------- strength components --------

/** The named inputs behind a strength verdict. Reported, never hidden. */
export interface SignalStrengthComponents {
  /** How good is the underlying evidence? */
  evidence_confidence: EvidenceConfidence;
  /** How recent is the EVENT (fraction of its window remaining, 0..1)? */
  freshness_ratio: number;
  /** Does this signal type matter for the requested ICP motion? */
  icp_relevance: SignalStrength;
  /** Do we have a real relationship (engagement) with this entity? */
  relationship_strength: SignalStrength;
  /** Verified provider backing (an LLM guess can never be strong). */
  provider_verified: boolean;
}

export interface SignalStrengthResult {
  strength: SignalStrength;
  components: SignalStrengthComponents;
  /** Machine-readable explanation of the deciding factor. */
  reason: string;
  fresh: boolean;
  /** Age of the EVENT in days (occurred_at → now). Reported, never hidden. */
  age_days: number | null;
  /** The window actually applied, in hours. */
  applied_window_hours: number;
  /**
   * Funding only: the explicit decay band (strong · medium · weak_supporting · stale).
   * Surfaced alongside `strength` so a reviewer can see WHY funding was downgraded
   * rather than inferring it from a bare band name.
   */
  funding_band?: FundingFreshnessBand;
  /**
   * The explicit policy band for any DECAYING category (funding, hiring). Kept
   * separate from `strength` so the repository's strength vocabulary stays canonical
   * while the policy's own band language remains inspectable.
   */
  freshness_band?: TimingFreshnessBand;
  /** Job listings only: the source-backed status that was applied, if any. */
  listing_status?: ListingStatus | null;
}

/** Hiring signal types — these decay through the JOB bands (7/30/60 days). */
const HIRING_TYPES: ReadonlySet<SignalType> = new Set<SignalType>([
  "sales_hiring", "revops_hiring", "growth_hiring",
]);

/** Categories that directly evidence a buying/GTM motion for a B2B ICP. */
const HIGH_RELEVANCE: ReadonlySet<SignalCategory> = new Set<SignalCategory>(["growth", "gtm"]);
const MEDIUM_RELEVANCE: ReadonlySet<SignalCategory> = new Set<SignalCategory>(["product", "founder_intent"]);

function icpRelevanceOf(t: SignalType): SignalStrength {
  const c = signalCategoryOf(t);
  if (HIGH_RELEVANCE.has(c)) return "strong";
  if (MEDIUM_RELEVANCE.has(c)) return "moderate";
  if (c === "engagement") return "moderate";
  return "none";
}

function relationshipOf(t: SignalType): SignalStrength {
  switch (t) {
    case "direct_reply": case "linkedin_post_reply": return "strong";
    case "linkedin_post_comment": return "moderate";
    case "linkedin_connection_accepted": case "linkedin_post_like": case "content_engagement": return "weak";
    default: return "none";
  }
}

const CONF_RANK: Readonly<Record<EvidenceConfidence, number>> = { low: 0, medium: 1, high: 2 };

/**
 * Compose a strength verdict from named components.
 *
 * Hard rules (never overridden by a component):
 *  - a risk signal has NO timing strength
 *  - an unverified / unbacked signal is never above `weak`
 *  - a stale event is `none` regardless of how good the evidence is
 */
export function assessSignalStrength(
  s: SignalEvent, now: string,
  opts: { policy?: SignalFreshnessPolicy } = {},
): SignalStrengthResult {
  const policy = opts.policy ?? SIGNAL_FRESHNESS_POLICY;
  const fresh = isSignalFresh(s, now, policy);
  const age = signalAgeHours(s, now);
  const win = windowHoursFor(s.signal_type, policy);
  const freshness_ratio = age == null ? 0 : Math.max(0, Math.min(1, 1 - age / win));
  const provider_verified = s.verification === "provider_verified";

  const components: SignalStrengthComponents = {
    evidence_confidence: s.confidence,
    freshness_ratio: Number(freshness_ratio.toFixed(3)),
    icp_relevance: icpRelevanceOf(s.signal_type),
    relationship_strength: relationshipOf(s.signal_type),
    provider_verified,
  };
  const age_days = age == null ? null : Number((age / 24).toFixed(3));
  const isFunding = s.signal_type === "recent_funding";
  const isHiring = HIRING_TYPES.has(s.signal_type);
  const ageForBand = age_days ?? Number.POSITIVE_INFINITY;
  const funding_band: FundingFreshnessBand | undefined = isFunding
    ? fundingBandForAgeDays(ageForBand)
    : undefined;
  const freshness_band: TimingFreshnessBand | undefined = isFunding
    ? funding_band
    : isHiring ? jobBandForAgeDays(ageForBand) : undefined;
  const listing_status = s.listing_status ?? null;
  const meta = {
    age_days, applied_window_hours: win,
    ...(funding_band ? { funding_band } : {}),
    ...(freshness_band ? { freshness_band } : {}),
    ...(listing_status ? { listing_status } : {}),
  };

  // A verified CLOSED/EXPIRED listing is stale immediately — occurred_at age never
  // overrides it. A role filled last week is not a reason to reach out.
  if (listingStatusIsDead(listing_status)) {
    return {
      strength: "none", components, reason: "listing_closed", fresh: false,
      ...meta, ...(freshness_band ? { freshness_band: "stale" as const } : {}),
    };
  }

  if (isRiskSignal(s.signal_type)) {
    return { strength: "none", components, reason: "risk_signal_never_proves_timing", fresh, ...meta };
  }
  if (!isTimingCapableSignal(s)) {
    return { strength: "none", components, reason: "not_timing_capable", fresh, ...meta };
  }
  if (!fresh) {
    return { strength: "none", components, reason: "signal_stale", fresh, ...meta };
  }
  if (!provider_verified) {
    // Self-reported (e.g. the founder's own post) is real but weaker than provider proof.
    return { strength: "weak", components, reason: "not_provider_verified", fresh, ...meta };
  }

  // Decaying categories (funding, hiring) map their explicit policy band onto the
  // repository's strength vocabulary. Neither cliff-edges: a round closed — or a role
  // posted — last week is a strong reason to reach out; the same event months later is
  // real context but must never make someone "hot right now" on its own.
  if (freshness_band) {
    const label = isFunding ? "funding" : "job";
    switch (freshness_band) {
      case "strong": return { strength: "strong", components, reason: `${label}_band_strong`, fresh, ...meta };
      case "medium": return { strength: "moderate", components, reason: `${label}_band_medium`, fresh, ...meta };
      // `weak` is precisely the repository's "supports but never satisfies alone" band.
      case "weak_supporting": return { strength: "weak", components, reason: `${label}_band_weak_supporting`, fresh, ...meta };
      case "stale": return { strength: "none", components, reason: `${label}_band_stale`, fresh: false, ...meta };
    }
  }

  // Provider-verified + fresh: relevance and evidence confidence decide the band.
  const relevance = STRENGTH_RANK[components.icp_relevance];
  const conf = CONF_RANK[s.confidence];
  if (relevance >= STRENGTH_RANK.strong && conf >= CONF_RANK.medium && freshness_ratio >= 0.25) {
    return { strength: "strong", components, reason: "fresh_verified_high_relevance", fresh, ...meta };
  }
  if (relevance >= STRENGTH_RANK.moderate && conf >= CONF_RANK.medium) {
    return { strength: "moderate", components, reason: "fresh_verified_moderate_relevance", fresh, ...meta };
  }
  return { strength: "weak", components, reason: "low_confidence_or_relevance", fresh, ...meta };
}
