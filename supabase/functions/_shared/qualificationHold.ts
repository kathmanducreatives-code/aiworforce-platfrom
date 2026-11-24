// Q1 — WHAT ELSE HAS ALREADY SAID "NOT QUALIFIED", CARRIED TO THE ONE DECISION.
//
// The canonical decision (`candidateEligibility.evaluateEligibility`) reads the
// evidence graph and the evaluator's per-criterion verdicts. Three other parts
// of the engine also decide that a company must not qualify, and before Q1 the
// canonical decision never heard any of them:
//
//   evaluator_rejected / evaluator_review
//       The evaluator's own aggregate answer was `not_qualified`, or
//       `insufficient_evidence` while every per-criterion row said PASS — a
//       contradictory answer (audit G09). It was ignored, and the company was
//       labelled, persisted as a lead, counted toward quota and reported.
//   verified_fact_rejected
//       A deterministic gate rejected the company on a VERIFIED fact before
//       evaluation (`FALSIFIABLE_REJECTIONS`), which the graph may not carry.
//   enrichment_evidence_missing
//       Enrichment was planned and produced no evidence, so qualifying on
//       discovery-time fields is exactly what the engine holds.
//
// A hold NEVER rejects a company and never upgrades one. It can only stop a
// company that would otherwise be ELIGIBLE: that company becomes PENDING, and
// the hold is a hard check no purchase can close (`blocked`), so a held company
// is neither labelled nor bought more evidence for. A pending or ineligible
// company is unchanged — its own checks already say why.
//
// A run with NO evaluator configured is not held here: its evaluation is
// `notEvaluated(…)` with no verdict array, and the deterministic graph decides,
// as before. Pure.

import type { MissionEvaluation } from "./missionEvaluation.ts";
import { enrichmentIsEvidence, type EnrichmentOutcome } from "./leadEnrichmentState.ts";

export const QUALIFICATION_HOLD_VERSION = "qualification-hold-v1" as const;

export type QualificationHoldCode =
  | "evaluator_rejected" | "evaluator_review" | "verified_fact_rejected" | "enrichment_evidence_missing";

export interface QualificationHold {
  code: QualificationHoldCode;
  /** In words a card can show. */
  reason: string;
}

/** The parts of an engine company a hold is read from. */
export interface HoldSource {
  mission_evaluation?: MissionEvaluation | null;
  decision_source?: string | null;
  fit?: { reason?: string | null } | null;
  record?: { stage_reason?: string | null } | null;
  /** Holds restored from a checkpoint; see `qualificationHoldsOf`. */
  qualification_holds?: readonly QualificationHold[] | null;
  /** How this slice reached (or did not reach) a decision for the company. */
  evaluation_path?: string | null;
  /** The company's enrichment outcome now — a restored enrichment hold lapses once it is evidence. */
  enrichment_outcome?: EnrichmentOutcome | null;
}

/** Holds only the engine's own record can show — not re-derivable from a restored evaluation. */
const ENGINE_HOLDS: ReadonlySet<QualificationHoldCode> = new Set(["verified_fact_rejected", "enrichment_evidence_missing"]);
/** Paths on which this slice made no fresh decision, so a previous slice's decision stands. */
const UNDECIDED_PATHS: ReadonlySet<string> = new Set(["restored_decision", "not_reached"]);

const HOLD_CODES: ReadonlySet<string> = new Set<QualificationHoldCode>([
  "evaluator_rejected", "evaluator_review", "verified_fact_rejected", "enrichment_evidence_missing",
]);

/** Holds read back from an (untrusted) checkpoint: known codes only, reason as text. */
export function restoredHolds(raw: unknown): QualificationHold[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((h) => {
    const r = h as { code?: unknown; reason?: unknown } | null;
    return r && typeof r.code === "string" && HOLD_CODES.has(r.code)
      ? [{ code: r.code as QualificationHoldCode, reason: String(r.reason ?? "") }] : [];
  });
}

/**
 * Did an evaluator actually answer (or was one enabled and failed)? A verdict
 * array is only present when the evaluator ran with compiled criteria or was
 * enabled and unavailable; a model answer without one is still an answer
 * unless `notEvaluated` marked it as none.
 */
export function evaluatorAnswered(e: MissionEvaluation | null | undefined): boolean {
  if (!e) return false;
  if (Array.isArray(e.criterion_verdicts)) return true;
  return !(e.unknown_fields ?? []).includes("not_evaluated");
}

/**
 * The holds on one company.
 *
 * WHICH EVALUATOR ANSWERS HOLD. A rejection always does: more evidence cannot
 * lift it without a new evaluation. A REVIEW holds only when it contradicts its
 * own rows — every per-criterion verdict PASS (audit G09, REVIEW variant). A
 * REVIEW with an open row is already decided by that row (#113), and a REVIEW
 * without rows (an answer from before per-criterion verdicts) asked exactly the
 * questions claim verification exists to answer: holding it would freeze a
 * company whose open question a verifier has since proven.
 */
export function qualificationHoldsOf(c: HoldSource): QualificationHold[] {
  const holds: QualificationHold[] = [];
  const e = c.mission_evaluation ?? null;
  if (e && evaluatorAnswered(e) && e.decision !== "qualified") {
    const why = (e.reasoning ?? "").trim();
    const rows = e.criterion_verdicts ?? [];
    if (e.decision === "not_qualified") {
      holds.push({ code: "evaluator_rejected", reason: `the evaluator rejected this company${why ? `: ${why}` : ""}` });
    } else if (rows.length > 0 && rows.every((v) => v.result === "pass")) {
      holds.push({ code: "evaluator_review",
        reason: `the evaluator passed every requirement but did not qualify the company${why ? `: ${why}` : ""}` });
    }
  }
  if (c.decision_source === "hard_constraint_rejection") {
    holds.push({ code: "verified_fact_rejected",
      reason: `rejected on a verified fact before evaluation${c.fit?.reason ? `: ${c.fit.reason}` : ""}` });
  }
  const stage = c.record?.stage_reason ?? "";
  if (stage.startsWith("enrichment_evidence_missing")) {
    holds.push({ code: "enrichment_evidence_missing",
      reason: `planned company enrichment returned no evidence (${stage.split(":")[1] ?? "unknown"})` });
  }
  // A PREVIOUS SLICE'S ENGINE HOLD STANDS while this slice has not re-decided
  // the company: the fields it was read from are not in the checkpoint. The
  // evaluator's holds are never copied — they are re-derived from the restored
  // evaluation above, so a later re-evaluation can change them — and a slice
  // that re-judges the company decides from what it derived itself.
  //
  // A RESTORED HOLD LASTS ONLY AS LONG AS ITS CONDITION. Missing enrichment is
  // retryable: a company-details read still running at slice end is adopted by
  // the next slice (replay "[failure] 6"), and once the company has enrichment
  // evidence the hold has nothing left to say. A verified-fact rejection is a
  // fact about the company and stands.
  if (UNDECIDED_PATHS.has(c.evaluation_path ?? "not_reached")) {
    for (const h of c.qualification_holds ?? []) {
      if (!ENGINE_HOLDS.has(h.code) || holds.some((x) => x.code === h.code)) continue;
      if (h.code === "enrichment_evidence_missing" && c.enrichment_outcome && enrichmentIsEvidence(c.enrichment_outcome)) continue;
      holds.push(h);
    }
  }
  return holds;
}
