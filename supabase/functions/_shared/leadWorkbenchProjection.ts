// SHOW THE WORK, WITHOUT CALLING IT A LEAD.
//
// TEST task 42e39fb1 discovered 25 companies, read 85 embedded YC roles, found
// six with genuine commercial-expansion signals inside the size range — and
// showed the user an empty Workbench, because persistence writes rows only for
// companies that pass the Company Brain.
//
// That rule is correct and must stay. An earlier run published 20 raw
// discoveries as "qualified companies", and the fail-closed fix is what stopped
// it. The problem is not that unqualified companies are excluded from the LEAD
// table; it is that there was nowhere else for them to appear.
//
// So there are TWO projections, and they are different kinds of thing:
//
//   * QUALIFIED rows   → `lead_candidates`. Real leads. Actionable. Counted
//                        against the quota. Written only on an explicit Brain
//                        pass, by the existing persistence path.
//   * EVALUATION rows  → `tasks.result.workbench_evaluation_rows`. Evidence of
//                        work done. NEVER actionable, never counted, and
//                        structurally incapable of being actioned because they
//                        carry no `lead_candidate_id` — every action path in the
//                        product requires one.
//
// The separation is the safety property. A progress row cannot leak into a quota
// or a people search by accident, because it is not the same shape and does not
// live in the same table.
//
// ── AND: A COMPANY NOBODY JUDGED IS NOT A COMPANY THAT FAILED ────────────────
//
// The second half of the same problem. Every row this projection emitted landed
// in a table captioned "evaluated but NOT QUALIFIED" — including companies the
// run never looked at. Three of the four ways a company ends up here have
// nothing to do with the company:
//
//   * the investigation budget ran out before its turn
//   * the deadline's checkpoint reserve stopped paid work mid-run
//   * the enrichment provider failed, so no decision was possible
//
// The pipeline is careful about this everywhere else. Triage answers `uncertain`
// rather than excluding; the evaluator returns `insufficient_evidence` as a
// terminal state distinct from `not_qualified`; qualification HOLDS a company
// whose enrichment came back empty instead of rejecting it; `decision_source`
// records `not_evaluated` explicitly. All of that care was preserved right up to
// the projection, where it was flattened into one undifferentiated list and
// captioned as a rejection.
//
// So the lifecycle now carries the distinction the rest of the architecture
// already makes, and `not_qualified` is reachable ONLY from a real decision.
//
// PURE. No network, no provider, no database.

import type { DecisionSource, EvaluationDecision } from "./missionEvaluation.ts";
import type { EnrichmentOutcome } from "./leadEnrichmentState.ts";
import { ENRICHMENT_EXPLANATION } from "./leadEnrichmentState.ts";
import type { TriageRelevance } from "./missionTriage.ts";

export const WORKBENCH_PROJECTION_VERSION = "workbench-evaluation-projection-v2" as const;

/**
 * How far one company got. Ordered from least to most progressed.
 *
 * `not_qualified` and `qualified` are the only two that represent a DECISION
 * ABOUT THE COMPANY. Everything else records where the pipeline stopped, which
 * is what makes an empty result explainable instead of merely disappointing.
 *
 * THE THREE STATES THAT DID NOT EXIST, and the lie each one prevents:
 *
 *   not_investigated   excluded before any money was spent — the budget ran
 *                      out, or triage read it as irrelevant. Rendering this as
 *                      "not qualified" claims a judgement nobody made.
 *   deferred           the run stopped before this company's paid stage could
 *                      run. It is RESUMABLE; a continuation finishes it. This
 *                      is a fact about the clock, not about the company.
 *   held_for_evidence  evaluated, and the evidence did not permit a decision.
 *                      The evaluator's own `insufficient_evidence`, carried
 *                      through instead of being collapsed into a rejection.
 */
export type WorkbenchLifecycle =
  | "discovered"
  | "evaluated"
  | "not_investigated"
  | "awaiting_investigation"
  | "shortlisted"
  | "identity_unresolved"
  | "verifying"
  | "deferred"
  | "held_for_evidence"
  | "qualified"
  | "not_qualified"
  | "contact_ready";

export const LIFECYCLE_ORDER: readonly WorkbenchLifecycle[] = [
  "discovered", "evaluated", "not_investigated", "awaiting_investigation",
  "shortlisted",
  "identity_unresolved", "verifying", "not_qualified",
  // ABOVE a settled rejection, deliberately. These are the run's unfinished
  // business — the rows a user can still act on by resuming — and they belong
  // at the top of the table rather than buried under companies already decided.
  "deferred", "held_for_evidence",
  "qualified", "contact_ready",
];

/**
 * The ONLY two lifecycle states that assert something about the company.
 *
 * A predicate rather than a convention, because every consumer that captions,
 * counts or filters these rows needs the same answer and must not re-derive it.
 */
const DECIDED: ReadonlySet<WorkbenchLifecycle> =
  new Set<WorkbenchLifecycle>(["qualified", "not_qualified", "contact_ready"]);

export function lifecycleIsDecision(s: WorkbenchLifecycle): boolean {
  return DECIDED.has(s);
}

/**
 * States where the run still owes this company work.
 *
 * These are exactly the rows a continuation would pick up, so the UI can say
 * "resume to finish these" truthfully rather than implying they were rejected.
 */
const RESUMABLE: ReadonlySet<WorkbenchLifecycle> =
  new Set<WorkbenchLifecycle>([
    "deferred", "held_for_evidence",
    // THE FRONTIER IS RESUMABLE WORK, and saying so is the point. These
    // companies were ranked, never judged, and a continuation will reach them.
    "awaiting_investigation",
  ]);

export function lifecycleIsResumable(s: WorkbenchLifecycle): boolean {
  return RESUMABLE.has(s);
}

/** Human-readable reason, shown verbatim in the Workbench. */
export const LIFECYCLE_EXPLANATION: Readonly<Record<WorkbenchLifecycle, string>> = Object.freeze({
  discovered: "Found by company discovery; not yet evaluated.",
  evaluated: "Evaluated against the mission's hiring signals and size range.",
  not_investigated: "Not investigated — the run never spent anything on this company.",
  awaiting_investigation:
    "Ranked and waiting — the budget stopped before this company's turn. " +
    "Continuing the run will investigate it.",
  shortlisted: "Strong commercial hiring signal — queued for identity resolution.",
  identity_unresolved: "LinkedIn company identity could not be resolved, so verification could not run.",
  verifying: "Identity resolved; evidence collection in progress.",
  deferred: "The run stopped before this company could be finished. Resuming will continue it.",
  held_for_evidence: "Evaluated, but the evidence did not support a decision either way.",
  qualified: "Passed the Company Brain.",
  not_qualified: "Evaluated against the mission and did not meet it.",
  contact_ready: "Verified decision-maker with a contact method.",
});

/**
 * Why a company was never shortlisted, in words rather than in a code.
 *
 * `budget_exhausted` in particular: that company was never judged at all, and
 * the sentence has to say so.
 */
export const SHORTLIST_EXCLUSION_EXPLANATION: Readonly<Record<string, string>> = Object.freeze({
  triage_irrelevant: "Mission triage read this as not what the mission asked for.",
  budget_exhausted: "The investigation budget ran out before this company's turn — it was never judged.",
  prequalification_ineligible: "Did not meet the mission's deterministic entry criteria.",
  not_selected: "Not selected for paid investigation.",
});

export function explainShortlistExclusion(reason: string | null): string | null {
  if (!reason) return null;
  return SHORTLIST_EXCLUSION_EXPLANATION[reason] ?? `Not investigated: ${reason}.`;
}

/** The minimum an engine company must expose to be projected. */
export interface ProjectableCompany {
  key: string;
  shortlisted: boolean;
  prequalified: {
    name: string;
    canonical_domain: string | null;
    team_size: number | null;
    best_tier: "A" | "B" | "C" | null;
    score: number;
    strongest_signal: string | null;
    exclusion: string | null;
    eligible: boolean;
    jobs: ReadonlyArray<{ title: string; tier: string }>;
    reasons: readonly string[];
    yc_url?: string | null;
  } | null;
  /**
   * CANONICAL: `identityIsActionable` — status === "verified_match" AND a URL.
   *
   * The progress strip used that predicate while this projection accepted
   * "anything not unresolved", so the audited run reported 6 resolved / 4
   * unresolved in one place and 7 / 3 in the other. One of the two numbers on
   * screen was always wrong.
   */
  identityResolved: boolean;
  identityAttempted: boolean;
  enriched: boolean;
  hiringVerified: boolean;
  verdict: "pass" | "reject" | "unknown" | null;
  contactCount: number;
  /**
   * WHY this company ended where it did, from the engine.
   *
   * The field that makes `not_qualified` falsifiable. `verdict === "reject"`
   * alone was never enough: a hold and a rejection both leave a company
   * unqualified, and only the decision source says which one happened.
   * Defaults to `not_evaluated`, which is the honest answer for a company the
   * evaluator never received.
   */
  decisionSource?: DecisionSource;
  /**
   * Mission Intelligence's verdict — `relevant` / `uncertain` / `irrelevant`.
   *
   * DELIBERATELY NOT pass/fail, and never rendered as one. `uncertain` is the
   * safe default every triage failure degrades to, so a company carrying it was
   * not judged badly — it was not judged at all.
   */
  triage?: {
    relevance: TriageRelevance;
    confidence: number;
    signal_strength: number;
    reasons: readonly string[];
  } | null;
  /** `triage_irrelevant`, `budget_exhausted`, … — different facts, kept apart. */
  shortlistExclusion?: string | null;
  /** What the enrichment stage actually did. See `EnrichmentOutcome`. */
  enrichmentOutcome?: EnrichmentOutcome;
  /** The evaluator's structured answer, when it ran. */
  missionEvaluation?: {
    decision: EvaluationDecision;
    match_score: number;
    confidence: number;
    reasoning: string;
    rejection_reasons: readonly string[];
    failed_requirements: readonly { requirement: string; why: string }[];
  } | null;
  /** Set when a paid stage was skipped or failed for run-level reasons. */
  /**
   * `qualification_deferred` is the same clock decision as `deferred`, one
   * stage later: the company is fully investigated and owes only a Brain call.
   * The Workbench reads both as "the run stopped before finishing this", which
   * is true of each; the split exists so scheduling can prioritise the one that
   * needs no provider call.
   */
  stageBlock?: {
    capability: string;
    reason: "deferred" | "qualification_deferred" | "provider_error";
  } | null;
  /**
   * Where this company sits in the investigation frontier.
   *
   * `pending_investigation` is the state the Workbench most needed and did not
   * have: ranked, never judged, and reachable by continuing. Without it such a
   * company rendered as `evaluated` — which claims the mission's criteria were
   * applied to it, and none were.
   */
  investigationState?:
    | "pending_investigation" | "in_flight" | "investigated" | "excluded_permanently";
  /**
   * The AUTHORITATIVE provider-supplied name, from discovery or enrichment.
   *
   * Added because this projection used to fall back to `key`, and on the
   * LinkedIn discovery path the key IS the company URL — so task 44b82535
   * persisted `https://www.linkedin.com/company/abr-talent` as a company NAME
   * for 93 of 94 rows.
   */
  companyName?: string | null;
  /**
   * Employee count from ENRICHMENT, which is where it actually comes from.
   *
   * The projection previously read `prequalified.team_size` alone. That field
   * is populated only on the startup/prequalification path, so on task
   * 44b82535 sixty successfully enriched companies still reported a null
   * count — the enrichment was bought and then never read.
   */
  employeeCount?: number | null;
}

/** A value that is a URL, not a name. */
export function looksLikeUrl(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || /linkedin\.com\//i.test(s);
}

/**
 * A human-readable name, or null — NEVER a URL.
 *
 * Authoritative provider fields first, exactly in the order they can be
 * trusted. The slug fallback exists only for the case where no provider ever
 * supplied a name: `.../company/abr-talent` becomes "Abr Talent", which is a
 * guess and is clearly better than showing the user a URL. When even that is
 * impossible the answer is null, because an absent name is honest and a URL in
 * a name column is not.
 */
export function readableCompanyName(i: {
  authoritative?: string | null;
  prequalified?: string | null;
  key?: string | null;
}): string | null {
  for (const c of [i.authoritative, i.prequalified]) {
    const s = String(c ?? "").trim();
    if (s && !looksLikeUrl(s)) return s;
  }
  const key = String(i.key ?? "").trim();
  if (key && !looksLikeUrl(key)) return key;
  // LAST RESORT: derive from the LinkedIn slug rather than emit the URL.
  const slug = key.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1];
  if (slug) {
    const words = slug.replace(/[-_]+/g, " ").trim();
    if (words) {
      return words.split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }
  return null;
}

/**
 * Decision sources that represent a REAL judgement about the company.
 *
 * `insufficient_evidence` and `not_evaluated` are conspicuously absent, and
 * that absence is the whole point: both mean nobody decided.
 * `identity_failure` is absent too — failing to find a LinkedIn page is a fact
 * about a lookup, not about whether the company suits the mission.
 */
const JUDGED: ReadonlySet<DecisionSource> =
  new Set<DecisionSource>(["gpt_evaluation", "hard_constraint_rejection"]);

/**
 * Where did this company actually stop?
 *
 * Read from the FURTHEST point reached, working backwards, so a company is
 * never described as less progressed than it is. `qualified` requires an
 * explicit `pass` — an absent verdict is never a pass.
 *
 * ── THE ORDER OF THESE CHECKS IS THE SAFETY PROPERTY ────────────────────────
 *
 * A rejection must clear TWO independent bars: an explicit `reject` verdict AND
 * a decision source that names who judged it. A company held for missing
 * evidence carries `verdict: "unknown"`, and one the deadline stopped carries
 * no verdict at all — neither can reach `not_qualified` through this function,
 * which is why the check is written as a conjunction rather than a fallthrough.
 */
export function deriveLifecycle(c: ProjectableCompany): WorkbenchLifecycle {
  const source = c.decisionSource ?? "not_evaluated";
  if (c.verdict === "pass") return c.contactCount > 0 ? "contact_ready" : "qualified";

  // A REJECTION NEEDS A JUDGE. Without one this is an unexplained negative, and
  // an unexplained negative is a hold.
  if (c.verdict === "reject") {
    return JUDGED.has(source) ? "not_qualified" : "held_for_evidence";
  }

  // UNKNOWN IS NOT A REJECTION. The evaluator ran and could not decide — the
  // evaluator's own `insufficient_evidence`, reported as the held state it is
  // rather than as the stage the company happened to reach.
  if (c.verdict === "unknown") return "held_for_evidence";

  // ── NO VERDICT: WHY NOT? ──────────────────────────────────────────────────
  //
  // Checked BEFORE the stage ladder, because a company stopped by the clock has
  // no stage that describes it truthfully. Left to fall through, a shortlisted
  // company whose identity lookup was never started reads as `shortlisted` —
  // which says the run chose it and stops there, hiding that the run owes it
  // work a resume would finish.
  if (c.stageBlock) return "deferred";
  if (c.enrichmentOutcome === "deferred" || c.enrichmentOutcome === "provider_error") {
    return "deferred";
  }

  if (c.enriched || c.hiringVerified) return "verifying";
  if (c.identityAttempted && !c.identityResolved) return "identity_unresolved";
  if (c.identityResolved) return "verifying";
  if (c.shortlisted) return "shortlisted";

  // RANKED AND WAITING. Checked before `not_investigated` and `evaluated`,
  // because it is neither: nothing was spent on it AND nothing judged it, and a
  // continuation will pick it up. Reporting it as `evaluated` claimed the
  // mission's criteria had been applied; reporting it as `not_investigated`
  // reads as final.
  if (c.investigationState === "pending_investigation") return "awaiting_investigation";

  // EXCLUDED BEFORE ANY MONEY WAS SPENT. Distinct from `evaluated`, which
  // implies the mission's criteria were applied to it and it merely placed
  // low; this company may never have been read at all.
  if (c.shortlistExclusion) return "not_investigated";
  if (c.prequalified) return "evaluated";
  return "discovered";
}

/** One non-actionable row. Deliberately has no lead_candidate_id. */
export interface WorkbenchEvaluationRow {
  company_key: string;
  /** Null when no provider ever supplied one. NEVER a URL. */
  company_name: string | null;
  domain: string | null;
  employee_count: number | null;
  strongest_signal: string | null;
  signal_tier: "A" | "B" | "C" | null;
  /** The role that earned the shortlist, with its source URL when YC gave one. */
  supporting_job_title: string | null;
  supporting_job_url: string | null;
  prequalification_score: number;
  status: WorkbenchLifecycle;
  explanation: string;
  /** Why it was shortlisted, or why it was not. Factual, from the free pass. */
  reasons: string[];
  exclusion: string | null;
  /**
   * DID ANYONE ACTUALLY JUDGE THIS COMPANY?
   *
   * Carried on the row rather than re-derived by each consumer, because every
   * caption, count and filter downstream depends on it and they must not be
   * able to disagree. False for every deferred, held and never-investigated
   * row — which is to say, for every row that must not be called "not
   * qualified".
   */
  decided: boolean;
  /** `gpt_evaluation`, `insufficient_evidence`, `not_evaluated`, … */
  decision_source: DecisionSource;
  /** True when a continuation would pick this company up and finish it. */
  resumable: boolean;
  /** Mission Intelligence's read. Never a pass/fail. */
  triage_relevance: TriageRelevance | null;
  triage_signal_strength: number | null;
  triage_reasons: string[];
  /** The raw exclusion code, and the sentence that explains it. */
  shortlist_exclusion: string | null;
  shortlist_exclusion_explanation: string | null;
  /** What the enrichment stage did, and why that produced no evidence. */
  enrichment_state: EnrichmentOutcome;
  enrichment_explanation: string;
  /** The evaluator's answer, when it reached one. Null when it never ran. */
  mission_decision: EvaluationDecision | null;
  mission_match_score: number | null;
  mission_reasoning: string | null;
  mission_failed_requirements: string[];
  /** ALWAYS FALSE. Present so a consumer must state the claim to break it. */
  actionable: false;
  counts_as_qualified: false;
}

export interface EvaluationProjection {
  version: typeof WORKBENCH_PROJECTION_VERSION;
  rows: WorkbenchEvaluationRow[];
  counts: {
    accounts_found: number;
    evaluated: number;
    shortlisted: number;
    identity_unresolved: number;
    qualified: number;
    contact_ready: number;
    /**
     * THE COUNTS THAT MAKE AN EMPTY RUN EXPLAINABLE.
     *
     * "0 qualified" is a very different story depending on whether twenty
     * companies were judged and failed, or nineteen were never reached. These
     * are the numbers that tell the difference.
     */
    not_qualified: number;
    not_investigated: number;
    /** Ranked, never judged, reachable by continuing. */
    awaiting_investigation: number;
    deferred: number;
    held_for_evidence: number;
  };
  /** Per-relevance triage totals, or null when Mission Intelligence was off. */
  triage_counts: Record<TriageRelevance, number> | null;
  /** Per-outcome enrichment totals. */
  enrichment_counts: Record<EnrichmentOutcome, number>;
}

/**
 * Project the engine's working set into non-actionable evaluation rows.
 *
 * QUALIFIED COMPANIES ARE EXCLUDED. They get real `lead_candidates` rows through
 * the existing persistence path; emitting them here too would show the same
 * company twice and invite a consumer to treat the non-actionable copy as a
 * lead.
 */
export function projectEvaluationRows(
  companies: readonly ProjectableCompany[],
): EvaluationProjection {
  const rows: WorkbenchEvaluationRow[] = [];
  let qualified = 0, contactReady = 0, shortlisted = 0, evaluated = 0, unresolved = 0;
  let notQualified = 0, notInvestigated = 0, deferred = 0, held = 0;
  let awaiting = 0;
  const triageCounts: Record<TriageRelevance, number> =
    { relevant: 0, uncertain: 0, irrelevant: 0 };
  let anyTriage = false;
  const enrichmentCounts: Record<EnrichmentOutcome, number> = {
    not_attempted: 0, success: 0, empty: 0, provider_error: 0, deferred: 0,
  };

  for (const c of companies) {
    const state = deriveLifecycle(c);
    if (state === "qualified") qualified++;
    if (state === "contact_ready") { qualified++; contactReady++; }
    if (c.shortlisted) shortlisted++;
    if (c.prequalified) evaluated++;
    if (state === "identity_unresolved") unresolved++;
    if (state === "not_qualified") notQualified++;
    if (state === "not_investigated") notInvestigated++;
    if (state === "awaiting_investigation") awaiting++;
    if (state === "deferred") deferred++;
    if (state === "held_for_evidence") held++;
    if (c.triage) { anyTriage = true; triageCounts[c.triage.relevance]++; }
    const enrichment = c.enrichmentOutcome ?? (c.enriched ? "success" : "not_attempted");
    enrichmentCounts[enrichment]++;
    if (state === "qualified" || state === "contact_ready") continue;

    const pq = c.prequalified;
    const supporting = pq?.jobs.find((j) => j.title === pq.strongest_signal) ?? null;
    const evaluation = c.missionEvaluation ?? null;
    rows.push({
      company_key: c.key,
      // NEVER THE KEY. On the LinkedIn path the key is a URL.
      company_name: readableCompanyName({
        authoritative: c.companyName, prequalified: pq?.name, key: c.key,
      }),
      domain: pq?.canonical_domain ?? null,
      // Enrichment first — it is the stage that actually measures this.
      employee_count: c.employeeCount ?? pq?.team_size ?? null,
      strongest_signal: pq?.strongest_signal ?? null,
      signal_tier: pq?.best_tier ?? null,
      supporting_job_title: supporting?.title ?? pq?.strongest_signal ?? null,
      supporting_job_url: (supporting as { url?: string } | null)?.url ?? pq?.yc_url ?? null,
      prequalification_score: pq?.score ?? 0,
      status: state,
      explanation: LIFECYCLE_EXPLANATION[state],
      reasons: [...(pq?.reasons ?? [])],
      exclusion: pq?.exclusion ?? null,
      decided: lifecycleIsDecision(state),
      decision_source: c.decisionSource ?? "not_evaluated",
      resumable: lifecycleIsResumable(state),
      triage_relevance: c.triage?.relevance ?? null,
      triage_signal_strength: c.triage?.signal_strength ?? null,
      triage_reasons: [...(c.triage?.reasons ?? [])],
      shortlist_exclusion: c.shortlistExclusion ?? null,
      shortlist_exclusion_explanation: explainShortlistExclusion(c.shortlistExclusion ?? null),
      enrichment_state: enrichment,
      enrichment_explanation: ENRICHMENT_EXPLANATION[enrichment],
      // NULL WHEN THE EVALUATOR NEVER RAN, never a fabricated neutral. An
      // absent evaluation is exactly what `decision_source: not_evaluated`
      // already says, and inventing a zero score here would let a consumer
      // rank a company nobody read.
      mission_decision: evaluation?.decision ?? null,
      mission_match_score: evaluation?.match_score ?? null,
      mission_reasoning: evaluation?.reasoning ?? null,
      mission_failed_requirements: (evaluation?.failed_requirements ?? [])
        .map((f) => `${f.requirement}: ${f.why}`),
      actionable: false,
      counts_as_qualified: false,
    });
  }

  // ORDERED BY HOW FAR THEY GOT, then by score. The six companies that nearly
  // made it belong at the top; the technical-only rejects belong at the bottom.
  rows.sort((a, b) =>
    LIFECYCLE_ORDER.indexOf(b.status) - LIFECYCLE_ORDER.indexOf(a.status) ||
    b.prequalification_score - a.prequalification_score ||
    // An unnamed company sorts last within its band rather than crashing the
    // comparator or jumping to the front on an empty string.
    (a.company_name ?? "￿").localeCompare(b.company_name ?? "￿"));

  return {
    version: WORKBENCH_PROJECTION_VERSION,
    rows,
    counts: {
      accounts_found: companies.length,
      evaluated,
      shortlisted,
      identity_unresolved: unresolved,
      qualified,
      contact_ready: contactReady,
      not_qualified: notQualified,
      not_investigated: notInvestigated,
      awaiting_investigation: awaiting,
      deferred,
      held_for_evidence: held,
    },
    // NULL, NOT ZEROES, when triage never ran. All-zero counts would read as
    // "triage found nothing relevant", which is a result; the truth is that
    // the stage was off.
    triage_counts: anyTriage ? triageCounts : null,
    enrichment_counts: enrichmentCounts,
  };
}

/**
 * Rows that may be captioned as a rejection. Everything else may NOT.
 *
 * The function the UI calls instead of assuming, and the one a test asserts
 * against. A row reaches it only by carrying a decision made about the company
 * itself.
 */
export function notQualifiedRows(
  rows: readonly WorkbenchEvaluationRow[],
): WorkbenchEvaluationRow[] {
  return rows.filter((r) => r.status === "not_qualified" && r.decided);
}

/** Rows the run still owes work on. A resume finishes exactly these. */
export function resumableRows(
  rows: readonly WorkbenchEvaluationRow[],
): WorkbenchEvaluationRow[] {
  return rows.filter((r) => r.resumable);
}

/**
 * Rows nobody judged.
 *
 * THE INVARIANT, as a function: no row here may ever be described as not
 * qualified, and `decided` is false for every one of them.
 */
export function undecidedRows(
  rows: readonly WorkbenchEvaluationRow[],
): WorkbenchEvaluationRow[] {
  return rows.filter((r) => !r.decided);
}

/**
 * Can this row be acted on? Always no.
 *
 * Exists so the rule is a function a test can call, rather than a convention
 * every call site is trusted to remember.
 */
export function evaluationRowIsActionable(_row: WorkbenchEvaluationRow): boolean {
  return false;
}

/** Rows eligible for a paid people search. Structurally always empty. */
export function peopleSearchEligible(
  rows: readonly WorkbenchEvaluationRow[],
): WorkbenchEvaluationRow[] {
  return rows.filter((r) => r.counts_as_qualified as boolean);
}
