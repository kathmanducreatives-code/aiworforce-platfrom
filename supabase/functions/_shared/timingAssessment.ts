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
  /** How many `moderate` signals may combine to stand in for one `strong`. */
  supportingSignalsRequired: number;
  /** False ⇒ the request never asked for timing at all. */
  required: boolean;
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
      strongest: "none",
    };
  }

  const wanted = new Set(requirement.requiredCategories);
  const stale: string[] = [];
  const satisfied = new Set<EvidenceCategory>();
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
    if (!r.fresh) { stale.push(s.signal_id); continue; }

    // The contract's own per-category window applies on top of the signal policy.
    const contractWindow = requirement.maxAgeHoursByCategory[cat];
    if (contractWindow != null) {
      const t = Date.parse(s.occurred_at); const n = Date.parse(now);
      if (isFinite(t) && isFinite(n) && (n - t) / 3600_000 > contractWindow) {
        stale.push(s.signal_id); continue;
      }
    }

    if (strengthAtLeast(r.strength, requirement.minimumStrength)) {
      satisfied.add(cat);
      if (strengthAtLeast(r.strength, "strong")) strongest = "strong";
      else if (strongest !== "strong") strongest = "moderate";
    } else if (r.strength === "weak") {
      // A weak signal alone never satisfies, but several may combine.
      supporting += 1;
      if (strongest === "none") strongest = "weak";
    }
  }

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
    };
  }

  return {
    ...base, satisfied_categories: satisfiedList, missing_categories: missing,
    stale_signal_ids: stale, contradictory_signal_ids: [],
    decision: "missing_timing_evidence", next_action: "signal_enrichment",
    explanation: stale.length
      ? "Timing evidence exists but is stale; a current signal is needed."
      : "No current timing signal is proven for this candidate.",
    strongest,
  };
}
