// THE LIVE VERDICT: ICP FIT AND SIGNAL FIT, JUDGED SEPARATELY AND KEPT APART.
//
// ── WHAT THIS WIRES UP ──────────────────────────────────────────────────────
//
// `icpIntentSeparation.ts` has defined `IcpVerdict`, `IntentVerdict` and an
// ordinal `PriorityBand` for a while, with a rule worth having — signal alone
// never promotes a candidate — and it was imported by its own test and nothing
// else. Meanwhile the live evaluator returned `icp_fit` (ranking only) and
// `hiring_fit` (hiring-shaped), and the two were combined nowhere.
//
// This module is the adapter. It takes what the live pipeline actually
// produces — the evaluator's ICP axis, and the per-signal assessments from
// `signalQualification` — and produces one banded verdict without ever
// averaging them into a score.
//
// ── WHY A BAND AND NOT A NUMBER ─────────────────────────────────────────────
//
// Averaging a strong ICP with a weak signal gives a middling number that
// describes neither. A company that matches the ICP perfectly and shows nothing
// is a normal outbound account; a company showing loud intent that you do not
// sell to is not a prospect at all. Those are different ACTIONS, and a score
// cannot say which.
//
// PURE. No network, provider, model or database access.

import {
  combinedPriority, type IcpAssessment, type IntentAssessment,
  type IcpVerdict, type IntentVerdict, type PriorityBand,
} from "./icpIntentSeparation.ts";
import {
  isPositiveSignal, signalRequirementOutcome,
  type SignalAssessment,
} from "./signalQualification.ts";

export const QUALIFICATION_VERDICT_VERSION = "lead-qualification-verdict-v1" as const;

/** The evaluator's ICP axis, as `missionEvaluation` returns it. */
export type LiveIcpFit = "strong" | "plausible" | "weak";

/**
 * Map the live ICP axis onto the contract's vocabulary.
 *
 * ── THE ONE THAT MATTERS IS `insufficient_evidence` ────────────────────────
 *
 * `icp_fit` has no "we could not tell" value — it is documented as ranking
 * only, so `weak` covers both "we looked and it is a poor match" and "we had
 * nothing to look at". Collapsing those is exactly the failure the three-valued
 * gates elsewhere exist to prevent, so the CALLER supplies whether the ICP was
 * judgeable at all, and this refuses to invent it.
 */
export function icpVerdictFrom(
  fit: LiveIcpFit | null | undefined, judgeable: boolean,
): IcpVerdict {
  if (!judgeable || fit == null) return "insufficient_evidence";
  return fit === "strong" ? "strong" : fit === "plausible" ? "partial" : "poor";
}

/**
 * Map the per-signal assessments onto ONE intent verdict.
 *
 * ── THE STRONGEST SIGNAL WINS, AND SILENCE IS NOT ABSENCE ──────────────────
 *
 * A mission may require several signals. Intent is a claim about behaviour, so
 * the strongest evidenced signal decides — a confirmed funding round plus an
 * unproven post is still a company that raised money.
 *
 * But an UNINVESTIGATED signal cannot contribute in either direction, and if
 * NOTHING was investigated the answer is `insufficient_evidence`, never `none`.
 * `none` means "we looked and they are silent", which is a finding a user may
 * act on; the other is our gap, not theirs.
 */
export function intentVerdictFrom(
  assessments: readonly SignalAssessment[],
): IntentVerdict {
  if (assessments.length === 0) return "none";

  const investigated = assessments.filter((a) =>
    a.verdict !== "not_investigated" && a.verdict !== "investigation_failed");
  if (investigated.length === 0) return "insufficient_evidence";

  if (investigated.some((a) => a.verdict === "verified")) return "explicit";
  if (investigated.some((a) => a.verdict === "plausible")) return "implied";
  return "none";
}

export interface LeadVerdictInput {
  icp_fit: LiveIcpFit | null;
  /** False when the ICP could not be judged from the evidence collected. */
  icp_judgeable: boolean;
  icp_dimensions_met?: readonly string[];
  icp_dimensions_failed?: readonly string[];
  icp_dimensions_unknown?: readonly string[];
  icp_evidence_ids?: readonly string[];
  signals: readonly SignalAssessment[];
}

export interface LeadVerdict {
  version: typeof QUALIFICATION_VERDICT_VERSION;
  /** WHO they are. */
  icp: IcpVerdict;
  /** WHAT they did. */
  intent: IntentVerdict;
  /** The ordinal combination. Never a score. */
  band: PriorityBand;
  /** Per-signal detail, preserved rather than collapsed. */
  signals: readonly SignalAssessment[];
  /** Whether the mission's signal requirement is met / not met / unknown. */
  signal_requirement: ReturnType<typeof signalRequirementOutcome>;
  rationale: string;
}

/**
 * Produce the banded verdict.
 *
 * The band comes from `combinedPriority`, unchanged, so the ordinal rules live
 * in one place: an unjudged half is reported as unjudged; a strong signal from
 * outside the ICP is never promoted on signal alone.
 */
export function buildLeadVerdict(i: LeadVerdictInput): LeadVerdict {
  const icp: IcpAssessment = {
    verdict: icpVerdictFrom(i.icp_fit, i.icp_judgeable),
    dimensions_met: i.icp_dimensions_met ?? [],
    dimensions_failed: i.icp_dimensions_failed ?? [],
    dimensions_unknown: i.icp_dimensions_unknown ?? [],
    evidence: (i.icp_evidence_ids ?? []).map((id) => ({
      kind: "firmographic" as const, url: null, dated_at: null, excerpt: id,
    })),
    reason: i.icp_judgeable ? `icp_fit=${i.icp_fit}` : "ICP was not judgeable",
  };

  const strongest = [...i.signals].sort((a, b) =>
    Number(isPositiveSignal(b.verdict)) - Number(isPositiveSignal(a.verdict)))[0];

  const intent: IntentAssessment = {
    verdict: intentVerdictFrom(i.signals),
    subject: (strongest?.subject as IntentAssessment["subject"]) ?? "company",
    topic: strongest?.signal ?? null,
    age_days: null,
    evidence: i.signals.flatMap((s) =>
      s.evidence_ids.map((id) => ({
        // A SIGNAL IS NOT A FIRMOGRAPHIC. `assessmentViolations` refuses a
        // person-subject intent cited from firmographic evidence, and typing
        // these correctly is what makes that guard able to fire.
        kind: (s.event === "post" ? "post"
          : s.event === "comment" ? "comment"
          : s.event === "funding" ? "funding_round"
          : s.event === "hiring" ? "job"
          : "article") as IntentAssessment["evidence"][number]["kind"],
        url: null,
        // Dated at the evidence level rather than invented here; the registry
        // owns observation dates and this adapter must not manufacture one.
        dated_at: null,
        excerpt: id,
      }))),
    reason: i.signals.map((s) => `${s.signal}=${s.verdict}`).join("; ") || "no signal required",
  };

  const band = combinedPriority(icp, intent);
  const requirement = signalRequirementOutcome(i.signals);

  return {
    version: QUALIFICATION_VERDICT_VERSION,
    icp: icp.verdict,
    intent: intent.verdict,
    band,
    signals: i.signals,
    signal_requirement: requirement,
    rationale:
      `ICP ${icp.verdict}; intent ${intent.verdict}; ` +
      `signal requirement ${requirement.outcome} (${requirement.reason})`,
  };
}

/**
 * May this verdict be reported as QUALIFIED?
 *
 * ── THE GATE THE WHOLE MODULE EXISTS FOR ───────────────────────────────────
 *
 * A company is qualified when it is in the ICP AND the mission's signal
 * requirement is met. Not when a score crossed a line, and never when a signal
 * was simply never investigated — that is the run's gap, and charging it to the
 * company turns a missing capability into a verdict about a business.
 */
export function qualificationDecision(
  v: LeadVerdict,
): { decision: "qualified" | "not_qualified" | "insufficient_evidence"; reason: string } {
  if (v.icp === "insufficient_evidence") {
    return { decision: "insufficient_evidence", reason: "ICP fit could not be established" };
  }
  if (v.signal_requirement.outcome === "unknown") {
    return {
      decision: "insufficient_evidence",
      reason: v.signal_requirement.reason,
    };
  }
  if (v.icp === "poor") {
    return { decision: "not_qualified", reason: "outside the ICP" };
  }
  if (v.signal_requirement.outcome === "not_met") {
    return { decision: "not_qualified", reason: v.signal_requirement.reason };
  }
  return { decision: "qualified", reason: v.rationale };
}
