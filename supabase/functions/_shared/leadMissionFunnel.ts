// WHY DID THIS RUN RETURN WHAT IT RETURNED?
//
// The pipeline records a great deal, and it records it in eight different
// places: `state.prequalification`, `state.triage`, `state.shortlist_decision`,
// the capability ledger, `provider_attempts`, per-company `stage_block` and
// `enrichment_outcome`, `evaluation_paths`, and the Workbench rows. Every number
// is honest and no single view answers the question a user actually asks, which
// is some version of:
//
//     "I asked for 5 leads and got 1. What happened to the other 19 companies?"
//
// Answering that today means joining eight structures by hand and knowing which
// of them counts companies, which counts calls, and which counts rows.
//
// This module is the join. It produces ONE ordered walk of the pipeline —
// discovery to persistence — where every stage reports what came in, what left,
// and where the difference went. It computes nothing new: every number is read
// from state the stages already recorded, which is what makes it safe to trust
// and impossible to disagree with the views it summarises.
//
// ── THE RULE THIS ENCODES ────────────────────────────────────────────────────
//
// Companies LEAVE the funnel for exactly three kinds of reason, and they are
// never mixed:
//
//   decided    something judged the company        (rejected / qualified)
//   withheld   the run judged nothing and stopped  (deferred, provider error)
//   excluded   the run never spent anything on it  (budget, triage, mission
//                                                   constraint)
//
// A stage that loses companies without attributing them to one of the three is
// a stage that lost them silently — which is the failure mode every other part
// of this architecture is built to prevent, so `unaccounted` exists to make it
// visible rather than to be assumed zero.
//
// PURE. No network, no provider, no database.

import type { EnrichmentOutcome } from "./leadEnrichmentState.ts";
import type { TriageRelevance } from "./missionTriage.ts";
import type { DecisionSource } from "./missionEvaluation.ts";

export const MISSION_FUNNEL_VERSION = "mission-funnel-v1" as const;

/** The pipeline, in order. Named exactly as the target architecture names them. */
export type FunnelStage =
  | "discovery"
  | "mission_intelligence"
  | "smart_shortlist"
  | "identity_resolution"
  | "enrichment"
  | "company_brain"
  | "mission_evaluator"
  | "persistence";

export const FUNNEL_STAGE_ORDER: readonly FunnelStage[] = [
  "discovery", "mission_intelligence", "smart_shortlist", "identity_resolution",
  "enrichment", "company_brain", "mission_evaluator", "persistence",
];

/**
 * One stage's accounting.
 *
 * `entered - advanced` must equal `decided + withheld + excluded + unaccounted`.
 * `unaccounted` is not padding: a non-zero value means a stage dropped companies
 * without saying why, and `funnelIsBalanced` turns that into a testable claim.
 */
export interface FunnelStageReport {
  stage: FunnelStage;
  entered: number;
  advanced: number;
  /** Judged — a real answer about the company. */
  decided: number;
  /** The run stopped or failed; resumable, and never a fact about the company. */
  withheld: number;
  /** Never investigated: budget, triage, or a mission-stated constraint. */
  excluded: number;
  /** Dropped without attribution. MUST be zero. */
  unaccounted: number;
  /** Free-form per-stage detail, e.g. triage or enrichment outcome counts. */
  detail: Record<string, number>;
}

/** What one company needs to expose to be walked through the funnel. */
export interface FunnelCompany {
  key: string;
  prequalified: boolean;
  triage: TriageRelevance | null;
  shortlisted: boolean;
  shortlist_exclusion: string | null;
  /** Ranked and waiting — resumable, and NOT a judgement. */
  awaiting_investigation?: boolean;
  identity: "resolved" | "unresolved" | "mismatch" | "blocked" | "not_attempted";
  enrichment: EnrichmentOutcome;
  reached_brain: boolean;
  /**
   * The qualification loop ran out of budget before reaching this company.
   *
   * Resumable and NOT a judgement, exactly like `identity: "blocked"`. Optional
   * so a caller that does not report it behaves as before.
   */
  brain_blocked?: boolean;
  brain: "QUALIFIED" | "REVIEW" | "REJECT" | null;
  evaluated: boolean;
  decision_source: DecisionSource;
  verdict: "pass" | "reject" | "unknown" | null;
  persisted: boolean;
}

export interface MissionFunnel {
  version: typeof MISSION_FUNNEL_VERSION;
  stages: FunnelStageReport[];
  /** The single number a user asked about, and the honest denominator for it. */
  summary: {
    discovered: number;
    investigated: number;
    evaluated: number;
    qualified: number;
    /** Judged and found not to meet the mission. */
    rejected: number;
    /** Looked at, no decision possible. Resumable. */
    unknown: number;
    /** Never judged at all. */
    never_investigated: number;
    /** Ranked and waiting for a later pass or continuation. */
    awaiting_investigation: number;
    /** Stopped by the run — the count that makes a resume worth offering. */
    withheld: number;
  };
}

const stage = (
  s: FunnelStage, entered: number, advanced: number,
  parts: { decided?: number; withheld?: number; excluded?: number },
  detail: Record<string, number> = {},
): FunnelStageReport => {
  const decided = parts.decided ?? 0;
  const withheld = parts.withheld ?? 0;
  const excluded = parts.excluded ?? 0;
  return {
    stage: s, entered, advanced, decided, withheld, excluded,
    unaccounted: entered - advanced - decided - withheld - excluded,
    detail,
  };
};

/**
 * Walk the pool through the pipeline, attributing every departure.
 *
 * Read stage by stage from the companies themselves rather than from any
 * stage's own counters, so this cannot drift from what actually happened to
 * each company — the failure that had one screen reporting 6 resolved / 4
 * unresolved while another reported 7 / 3 for the same run.
 */
export function buildMissionFunnel(
  companies: readonly FunnelCompany[],
): MissionFunnel {
  const n = companies.length;

  // ── DISCOVERY → MISSION INTELLIGENCE ─────────────────────────────────────
  const prequalified = companies.filter((c) => c.prequalified).length;

  // ── MISSION INTELLIGENCE ─────────────────────────────────────────────────
  const triaged = companies.filter((c) => c.triage !== null);
  const triageDetail = {
    relevant: triaged.filter((c) => c.triage === "relevant").length,
    uncertain: triaged.filter((c) => c.triage === "uncertain").length,
    irrelevant: triaged.filter((c) => c.triage === "irrelevant").length,
    not_triaged: n - triaged.length,
  };
  // Irrelevant is the only triage verdict that removes anyone.
  const triageExcluded = companies.filter(
    (c) => !c.shortlisted && c.shortlist_exclusion === "triage_irrelevant").length;

  // ── SMART SHORTLIST + BUDGET ─────────────────────────────────────────────
  const shortlisted = companies.filter((c) => c.shortlisted).length;
  // THE FRONTIER. Ranked, never judged, reachable by continuing — reported as
  // WITHHELD rather than excluded, because "we have not got to it yet" and "we
  // decided against it" are the distinction this whole funnel exists to keep.
  const awaiting = companies.filter((c) => c.awaiting_investigation).length;
  const shortlistExcluded = companies.filter(
    (c) => !c.shortlisted && c.shortlist_exclusion !== null &&
      c.shortlist_exclusion !== "triage_irrelevant").length;
  const shortlistDetail: Record<string, number> = {};
  for (const c of companies) {
    if (c.shortlisted || !c.shortlist_exclusion) continue;
    if (c.shortlist_exclusion === "triage_irrelevant") continue;
    shortlistDetail[c.shortlist_exclusion] =
      (shortlistDetail[c.shortlist_exclusion] ?? 0) + 1;
  }

  // ── IDENTITY RESOLUTION ──────────────────────────────────────────────────
  const identityResolved = companies.filter((c) => c.identity === "resolved").length;
  const identityBlocked = companies.filter((c) => c.identity === "blocked").length;
  // Unresolved and mismatch are ANSWERS: the lookup ran and told us something.
  // They are terminal for the run, but they are not judgements about mission
  // fit, so they are `decided` at this stage only in the sense that the stage
  // finished with them.
  const identityAnswered = companies.filter(
    (c) => c.identity === "unresolved" || c.identity === "mismatch").length;
  const identityDetail = {
    resolved: identityResolved,
    unresolved: companies.filter((c) => c.identity === "unresolved").length,
    mismatch: companies.filter((c) => c.identity === "mismatch").length,
    blocked: identityBlocked,
    not_attempted: companies.filter((c) => c.identity === "not_attempted").length,
  };

  // ── ENRICHMENT ───────────────────────────────────────────────────────────
  const enrichmentDetail = {
    success: 0, empty: 0, provider_error: 0, deferred: 0, not_attempted: 0,
  } as Record<EnrichmentOutcome, number>;
  for (const c of companies) {
    if (c.identity !== "resolved") continue;
    enrichmentDetail[c.enrichment]++;
  }
  // ENRICHMENT REMOVES NOBODY, and this is not a technicality.
  //
  // A failed or deferred enrichment does NOT drop a company from the pipeline —
  // it reaches the Company Brain anyway and is HELD there as `unknown`, which is
  // the architecture's rule that an absence of evidence is never a proven
  // negative. Modelling enrichment as a stage companies exit was wrong and the
  // funnel caught it: `advanced` came out below `entered` while every one of
  // those companies had demonstrably reached the Brain.
  //
  // So the withholding is recorded as DETAIL here and materialises as `unknown`
  // at the evaluator, which is where it actually changes an outcome.
  const enrichmentWithheld =
    enrichmentDetail.provider_error + enrichmentDetail.deferred;

  // ── COMPANY BRAIN → EVALUATOR ────────────────────────────────────────────
  //
  // EMPTY ENRICHMENT STILL ADVANCES. That is the architecture's own rule: an
  // empty provider result is an absence of evidence, not a proven negative, so
  // the company reaches the Brain and is held rather than rejected.
  const reachedBrain = companies.filter((c) => c.reached_brain).length;
  // ── WHY THE BRAIN STAGE CAN LOSE COMPANIES WITHOUT LOSING THEM ───────────
  //
  // The Brain assembles and removes nobody, so `entered - advanced` used to be
  // reported entirely as `unaccounted` — this stage's alarm for a silent drop.
  // On task 633ad466 that read `UNACCOUNTED=31` for thirty-one companies the
  // qualification loop had simply run out of clock before reaching. They keep
  // `brain: not_started`, `nextStageFor` routes them back, and a later slice
  // qualifies them; nothing was lost, and the alarm was false.
  //
  // A clock decision is `withheld` by this file's own vocabulary — "the run
  // stopped or failed; resumable, and never a fact about the company" — and
  // that is now what it is counted as. `unaccounted` goes back to meaning what
  // it says.
  const brainWithheld = companies.filter(
    (c) => !c.reached_brain && c.brain_blocked === true).length;
  const evaluated = companies.filter((c) => c.evaluated).length;
  const notEvaluated = companies.filter(
    (c) => c.reached_brain && !c.evaluated).length;

  const qualified = companies.filter((c) => c.verdict === "pass").length;
  const rejected = companies.filter((c) => c.verdict === "reject").length;
  const unknown = companies.filter((c) => c.verdict === "unknown").length;
  // ONLY A QUALIFIED COMPANY CAN BE PERSISTED. Counted as the conjunction
  // rather than trusting the flag, so a caller that mislabels an unqualified
  // row cannot make the persistence stage claim to have written more than
  // qualified — which is the one direction this number must never overstate.
  const persisted = companies.filter((c) => c.verdict === "pass" && c.persisted).length;

  const withheldTotal = companies.filter(
    (c) => c.identity === "blocked" ||
      c.enrichment === "provider_error" || c.enrichment === "deferred").length;
  const neverInvestigated = companies.filter(
    (c) => !c.shortlisted && c.shortlist_exclusion !== null).length;

  return {
    version: MISSION_FUNNEL_VERSION,
    stages: [
      stage("discovery", n, n, {}, { prequalified, unique_companies: n }),
      stage("mission_intelligence", n, n - triageExcluded,
        { excluded: triageExcluded }, triageDetail),
      stage("smart_shortlist", n - triageExcluded, shortlisted,
        { excluded: shortlistExcluded, withheld: awaiting },
        { ...shortlistDetail, selected: shortlisted, awaiting_investigation: awaiting }),
      stage("identity_resolution", shortlisted, identityResolved,
        { decided: identityAnswered, withheld: identityBlocked }, identityDetail),
      // Enrichment determines EVIDENCE QUALITY, not membership — see above.
      stage("enrichment", identityResolved, identityResolved, {}, {
        ...enrichmentDetail, without_evidence: enrichmentWithheld,
      }),
      // The Brain assembles; it removes nobody either. A difference here means a
      // company never arrived, which `unaccounted` will surface.
      stage("company_brain", identityResolved, reachedBrain,
        { withheld: brainWithheld }, {
          reached: reachedBrain, deadline_deferred: brainWithheld,
        }),
      stage("mission_evaluator", reachedBrain, qualified,
        { decided: rejected, withheld: unknown }, {
          evaluated, not_evaluated: notEvaluated,
          qualified, rejected, unknown,
        }),
      // QUALIFIED BUT NOT WRITTEN IS A REAL FAILURE, and a resumable one — the
      // company earned a Lead Library row and did not get one. Attributed as
      // `withheld` rather than left unaccounted, because it is a fact about the
      // WRITE (it failed, or has not run yet) and never about the company.
      stage("persistence", qualified, persisted,
        { withheld: qualified - persisted },
        { written: persisted, not_written: qualified - persisted }),
    ],
    summary: {
      discovered: n,
      investigated: shortlisted,
      evaluated,
      qualified,
      rejected,
      unknown,
      never_investigated: neverInvestigated,
      awaiting_investigation: awaiting,
      withheld: withheldTotal,
    },
  };
}

/**
 * Did every company that left the funnel leave for a stated reason?
 *
 * The invariant as a function, so a test asserts it rather than a reader
 * eyeballing eight numbers. A stage with `unaccounted !== 0` lost companies
 * silently — which is the one thing this pipeline may never do.
 */
export function funnelIsBalanced(f: MissionFunnel): boolean {
  return f.stages.every((s) => s.unaccounted === 0);
}

/** The stages that lost companies without saying why. Empty when healthy. */
export function unbalancedStages(f: MissionFunnel): FunnelStageReport[] {
  return f.stages.filter((s) => s.unaccounted !== 0);
}

/**
 * One line per stage, for a log.
 *
 * Deliberately terse and stable: this ends up in edge-function logs where it is
 * grepped, so the shape matters more than the prose.
 */
export function formatFunnel(f: MissionFunnel): string[] {
  return f.stages.map((s) =>
    `${s.stage}: ${s.entered}→${s.advanced}` +
    (s.decided ? ` decided=${s.decided}` : "") +
    (s.withheld ? ` withheld=${s.withheld}` : "") +
    (s.excluded ? ` excluded=${s.excluded}` : "") +
    (s.unaccounted ? ` UNACCOUNTED=${s.unaccounted}` : ""));
}
