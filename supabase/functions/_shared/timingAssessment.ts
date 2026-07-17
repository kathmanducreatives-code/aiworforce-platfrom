// Timing requirement + assessment (Phase A) — pure, deterministic, clock-injected.
//
// ANSWERS ONE QUESTION per candidate: "is there enough CURRENT, source-backed
// evidence to justify contacting this person now?"
//
// RECONCILED WITH THE EXISTING CONTRACT — this does NOT replace the evidence
// contract. `compileEvidenceContract` already emits `timingRequirements` (the six
// canonical EvidenceCategories) with any-of semantics for `hot_opportunity` and
// all-of for `recent_signal`. This module compiles that SAME contract into a signal
// -aware TimingRequirement and evaluates it against normalized SignalEvents.
//
// CRITICAL BOUNDARY: `timing_sufficient` does NOT mean `qualify_now`. It only means
// the timing GAP is closed, allowing the candidate to proceed to the existing final
// qualification authority (resolveFinalCandidateState → qualificationPersistenceDecision).
// Nothing here bypasses the source gate, ICP checks, contradiction checks, the
// persistence gate or provenance requirements.

import type { EvidenceCategory } from "./evidenceContract.ts";
import type { EvidenceContract } from "./evidenceContract.ts";
import { timingIsAnyOf } from "./evidenceContract.ts";
import {
  type SignalEvent, evidenceCategoryForSignalType, isRiskSignal, isTimingCapableSignal,
} from "./signalEvent.ts";
import {
  type SignalFreshnessPolicy, type SignalStrength, SIGNAL_FRESHNESS_POLICY,
  assessSignalStrength, strengthAtLeast, isSignalFresh,
} from "./signalFreshness.ts";
import type {
  FundingFreshnessBand, TimingFreshnessBand, ListingStatus, ExplicitTimingWindow,
} from "./timingFreshnessPolicy.ts";

export type TimingDecision =
  | "timing_sufficient"
  | "missing_timing_evidence"
  | "timing_contradicted"
  | "timing_not_required";

export type TimingNextAction = "signal_enrichment" | "none" | "manual_review";

export interface TimingRequirement {
  /** Which canonical evidence categories can satisfy the timing gap. */
  requiredCategories: EvidenceCategory[];
  /** Unverified signals never count. Self-reported ones may still act as supporting
   * evidence — they are banded `weak` by assessSignalStrength and can never satisfy
   * a `moderate` minimum alone. */
  requireProviderVerified: boolean;
  /**
   * The contract's own max age PER CATEGORY, in hours.
   *
   * Deliberately per-category: applying the tightest window across every category
   * would judge a funding signal by job_signal's much shorter window and wrongly call
   * it stale. Absent ⇒ defer to the signal freshness policy for that type.
   */
  maxAgeHoursByCategory: Partial<Record<EvidenceCategory, number>>;
  /** The band a single signal must reach to satisfy alone. */
  minimumStrength: SignalStrength;
  /** True ⇒ ONE qualifying signal is enough (hot_opportunity any-of semantics). */
  anyOfSufficient: boolean;
  /** How many CURRENT weak signals may combine to stand in for one qualifying signal. */
  supportingSignalsRequired: number;
  /** False ⇒ the request never asked for timing at all. */
  required: boolean;
  /**
   * The window the user stated explicitly, carried from the typed intent.
   *
   * When the user names a window ("hiring in the last 60 days") they have declared
   * that age acceptable, so a weak_supporting signal INSIDE that window satisfies on
   * its own. This never applies to a bare "hot right now" request, which states no
   * window and must still be carried by a genuinely current signal.
   */
  explicitWindow: ExplicitTimingWindow | null;
}

/**
 * Per-signal reasoning, so an assessment never reduces to an unexplained verdict.
 * Shows the age, the window that was actually applied, the resulting strength, and
 * whether the signal satisfied the requirement or merely supported another.
 */
export interface TimingSignalBreakdown {
  signal_id: string;
  signal_type: string;
  category: EvidenceCategory | null;
  /** When the event actually happened — the basis of every freshness judgment. */
  occurred_at: string;
  /** Age of the EVENT (occurred_at → now), in days. */
  age_days: number | null;
  /** The window applied after resolving contract vs signal policy, in hours. */
  applied_window_hours: number;
  strength: SignalStrength;
  /** Funding only: strong · medium · weak_supporting · stale. */
  funding_band?: FundingFreshnessBand;
  /** Any decaying category (funding, hiring): the explicit policy band. */
  freshness_band?: TimingFreshnessBand;
  /** Job listings only: the source-backed listing status that was applied. */
  listing_status?: ListingStatus;
  /** It met the minimum strength and satisfied its category on its own merit. */
  satisfied: boolean;
  /** It was real and fresh but too weak to satisfy alone — counted as support only. */
  supporting_only: boolean;
  stale: boolean;
}

export interface TimingAssessment {
  candidate_id: string;
  evaluated_signal_ids: string[];
  satisfied_categories: EvidenceCategory[];
  missing_categories: EvidenceCategory[];
  stale_signal_ids: string[];
  contradictory_signal_ids: string[];
  decision: TimingDecision;
  next_action: TimingNextAction;
  /** Human-readable, sanitized. Never raw payload. */
  explanation: string;
  observed_at: string;
  /** Strongest band any qualifying signal reached. */
  strongest: SignalStrength;
  /** Per-signal age/window/strength reasoning. */
  signal_breakdown: TimingSignalBreakdown[];
  /** Signals that contributed as SUPPORT rather than satisfying on their own. */
  supporting_signal_ids: string[];
}

/**
 * Compile the signal-aware TimingRequirement from the ALREADY-COMPILED evidence
 * contract. Single source of truth: the contract decides whether timing is required
 * (freshness = recent_signal | hot_opportunity) and which categories count.
 */
export function compileTimingRequirement(
  contract: EvidenceContract,
  overrides: Partial<TimingRequirement> = {},
): TimingRequirement {
  const cats = contract.timingRequirements.map((r) => r.category);
  const required = cats.length > 0;
  const anyOf = timingIsAnyOf(contract);
  // Keep each category's own window. The contract is the stricter authority where it
  // sets one, but a funding signal must be judged by the funding window — never by
  // job_signal's shorter one just because both appear in an any-of list.
  const maxAgeHoursByCategory: Partial<Record<EvidenceCategory, number>> = {};
  for (const r of contract.timingRequirements) {
    if (typeof r.freshnessWindowHours !== "number") continue;
    const prev = maxAgeHoursByCategory[r.category];
    maxAgeHoursByCategory[r.category] = prev == null ? r.freshnessWindowHours : Math.min(prev, r.freshnessWindowHours);
  }
  return {
    requiredCategories: [...new Set(cats)],
    requireProviderVerified: true,
    maxAgeHoursByCategory,
    // "Hot right now" accepts one genuinely strong reason; a named signal
    // ("recently funded") must prove that specific category.
    minimumStrength: anyOf ? "moderate" : "moderate",
    anyOfSufficient: anyOf,
    supportingSignalsRequired: 2,
    required,
    explicitWindow: contract.explicitTimingWindow ?? null,
    ...overrides,
  };
}

/** A signal satisfies a category only via the canonical bridge, never by name. */
function categoryOf(s: SignalEvent): EvidenceCategory | null {
  return evidenceCategoryForSignalType(s.signal_type);
}

/**
 * Evaluate timing for ONE candidate.
 *
 * Precedence:
 *   1. timing not required        → timing_not_required
 *   2. a fresh risk/contradiction → timing_contradicted (never fabricate urgency)
 *   3. a qualifying signal        → timing_sufficient
 *   4. otherwise                  → missing_timing_evidence + signal_enrichment
 */
export function evaluateTimingSufficiency(args: {
  candidateId: string;
  requirement: TimingRequirement;
  signals: readonly SignalEvent[];
  now: string;
  policy?: SignalFreshnessPolicy;
}): TimingAssessment {
  const { candidateId, requirement, now } = args;
  const policy = args.policy ?? SIGNAL_FRESHNESS_POLICY;
  const signals = args.signals ?? [];
  const base = {
    candidate_id: candidateId,
    evaluated_signal_ids: signals.map((s) => s.signal_id),
    observed_at: now,
  };

  if (!requirement.required) {
    return {
      ...base, satisfied_categories: [], missing_categories: [], stale_signal_ids: [],
      contradictory_signal_ids: [], decision: "timing_not_required", next_action: "none",
      explanation: "The request did not ask for current timing evidence.", strongest: "none",
      signal_breakdown: [], supporting_signal_ids: [],
    };
  }

  // 2) A fresh, source-backed contradiction outranks any positive signal: a person who
  //    has left the company is not hot, however much their old company is hiring.
  const contradictions = signals.filter((s) => isRiskSignal(s.signal_type) && s.status === "active"
    && s.verification !== "unverified" && isSignalFresh(s, now, policy));
  if (contradictions.length) {
    return {
      ...base, satisfied_categories: [], missing_categories: requirement.requiredCategories,
      stale_signal_ids: [], contradictory_signal_ids: contradictions.map((s) => s.signal_id),
      decision: "timing_contradicted", next_action: "manual_review",
      explanation: `A verified contradicting signal is present (${contradictions.map((s) => s.signal_type).join(", ")}).`,
      strongest: "none", signal_breakdown: [], supporting_signal_ids: [],
    };
  }

  const wanted = new Set(requirement.requiredCategories);
  const stale: string[] = [];
  const satisfied = new Set<EvidenceCategory>();
  const breakdown: TimingSignalBreakdown[] = [];
  let strongest: SignalStrength = "none";
  let supporting = 0;

  for (const s of signals) {
    if (isRiskSignal(s.signal_type)) continue;
    const cat = categoryOf(s);
    if (!cat || !wanted.has(cat)) continue;
    if (!isTimingCapableSignal(s)) continue;
    // Unverified never counts at all. Self-reported is kept: it is a real, source-backed
    // statement that assessSignalStrength bands as `weak`, so it can support but never
    // satisfy a `moderate` minimum on its own.
    if (requirement.requireProviderVerified && s.verification === "unverified") continue;

    const r = assessSignalStrength(s, now, { policy });
    // The contract's own per-category window applies ON TOP of the signal policy —
    // the stricter of the two wins, so "funded this week" is never widened to 90 days.
    const contractWindow = requirement.maxAgeHoursByCategory[cat];
    const appliedWindow = contractWindow != null
      ? Math.min(contractWindow, r.applied_window_hours)
      : r.applied_window_hours;
    const ageHours = r.age_days == null ? null : r.age_days * 24;
    const outsideContractWindow = contractWindow != null && ageHours != null && ageHours > contractWindow;
    const isStale = !r.fresh || outsideContractWindow;

    const row: TimingSignalBreakdown = {
      signal_id: s.signal_id, signal_type: s.signal_type, category: cat,
      occurred_at: s.occurred_at,
      age_days: r.age_days, applied_window_hours: appliedWindow,
      strength: isStale ? "none" : r.strength,
      ...(r.funding_band ? { funding_band: outsideContractWindow ? "stale" : r.funding_band } : {}),
      ...(r.freshness_band ? { freshness_band: outsideContractWindow ? "stale" : r.freshness_band } : {}),
      ...(r.listing_status ? { listing_status: r.listing_status } : {}),
      satisfied: false, supporting_only: false, stale: isStale,
    };

    if (isStale) { stale.push(s.signal_id); breakdown.push(row); continue; }

    // A weak_supporting signal INSIDE a window the user explicitly named satisfies on
    // its own: they declared that age acceptable ("hiring in the last 60 days"). This
    // never applies to a bare "hot right now" (any-of) request, which names no window
    // and must still be carried by a genuinely current signal.
    const explicitlyAuthorized = !!requirement.explicitWindow && !requirement.anyOfSufficient
      && r.strength === "weak" && r.freshness_band === "weak_supporting";

    if (strengthAtLeast(r.strength, requirement.minimumStrength) || explicitlyAuthorized) {
      satisfied.add(cat);
      row.satisfied = true;
      if (strengthAtLeast(r.strength, "strong")) strongest = "strong";
      else if (strongest !== "strong" && strengthAtLeast(r.strength, "moderate")) strongest = "moderate";
      else if (strongest === "none") strongest = "weak";
    } else if (r.strength === "weak") {
      // Weak signals only ever SUPPORT. An AGE-DEGRADED signal (funding 91–180d,
      // hiring 31–60d) cannot even stack: two stale-ish events must never combine into
      // fabricated urgency. Only signals that are weak for another reason — e.g. a
      // fresh but self-reported founder post — may reach the supporting threshold.
      const ageDegraded = r.freshness_band === "weak_supporting";
      row.supporting_only = true;
      if (!ageDegraded) supporting += 1;
      if (strongest === "none") strongest = "weak";
    }
    breakdown.push(row);
  }

  const supportingIds = breakdown.filter((b) => b.supporting_only).map((b) => b.signal_id);
  const satisfiedList = [...satisfied];
  const missing = requirement.requiredCategories.filter((c) => !satisfied.has(c));

  const sufficient = requirement.anyOfSufficient
    ? satisfiedList.length > 0
    : missing.length === 0;

  // Configured fallback: enough weak-but-real supporting signals stand in for one
  // qualifying signal (any-of requests only — a named signal must still be proven).
  const combined = !sufficient && requirement.anyOfSufficient
    && supporting >= requirement.supportingSignalsRequired;

  if (sufficient || combined) {
    return {
      ...base, satisfied_categories: satisfiedList,
      missing_categories: requirement.anyOfSufficient ? [] : missing,
      stale_signal_ids: stale, contradictory_signal_ids: [],
      decision: "timing_sufficient", next_action: "none",
      explanation: combined
        ? `${supporting} supporting signals combine to evidence current timing.`
        : `Current verified timing evidence: ${satisfiedList.join(", ")}.`,
      strongest: combined && strongest === "none" ? "weak" : strongest,
      signal_breakdown: breakdown, supporting_signal_ids: supportingIds,
    };
  }

  return {
    ...base, satisfied_categories: satisfiedList, missing_categories: missing,
    stale_signal_ids: stale, contradictory_signal_ids: [],
    decision: "missing_timing_evidence", next_action: "signal_enrichment",
    explanation: stale.length
      ? "Timing evidence exists but is stale; a current signal is needed."
      : "No current timing signal is proven for this candidate.",
    strongest, signal_breakdown: breakdown, supporting_signal_ids: supportingIds,
  };
}
