// LEAD V2 P5 — THE LABEL: CODE SETS THE CEILING, GPT MAY ONLY EXPLAIN.
//
// The plan's table, enforced. Code computes the highest label a candidate's
// evidence can support; GPT chooses at or below it and writes sentences that
// cite evidence ids. A sentence citing nothing real is deleted; a label with no
// surviving sentence drops one level. Nothing GPT returns can promote a
// candidate, hide a gap, or invent a fact.
//
//   EXACT MATCH        eligible · every target proven and fresh · anchor proven in window
//   STRONG OPPORTUNITY eligible · anchor proven in window · at most one target unproven
//   WORTH CONSIDERING  eligible · anchor OR any opportunity signal proven
//   LOW PRIORITY       eligible · no fresh anchor or opportunity signal
//   (none)             pending or ineligible — never surfaced as a match
//
// `missing_evidence` is generated HERE, from the criteria the evidence does not
// answer, so a model cannot quietly leave a gap out of its story.
//
// Pure.

import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";
import type { MissionCriterion } from "./missionCriteria.ts";
import { CRITERION_EVIDENCE_DIMENSION, checkCriterion, type EligibilityResult } from "./candidateEligibility.ts";

export const OPPORTUNITY_LABEL_VERSION = "opportunity-label-v1" as const;

export type Label = "exact_match" | "strong_opportunity" | "worth_considering" | "low_priority";

/** Criterion dimensions that name an observable, dated company event. */
const SIGNAL_CRITERION_DIMENSIONS: ReadonlySet<string> = new Set([
  "hiring", "funding", "expansion", "product_launch", "leadership_change",
  "headcount_growth", "technology", "team_composition",
]);

/** Highest first — the order a drop walks down. */
export const LABEL_ORDER: readonly Label[] = [
  "exact_match", "strong_opportunity", "worth_considering", "low_priority",
];

export function lowerLabel(l: Label): Label {
  const i = LABEL_ORDER.indexOf(l);
  return LABEL_ORDER[Math.min(i + 1, LABEL_ORDER.length - 1)];
}

export function labelAtOrBelow(proposed: Label, ceiling: Label): Label {
  return LABEL_ORDER.indexOf(proposed) < LABEL_ORDER.indexOf(ceiling) ? ceiling : proposed;
}

export interface CeilingInput {
  criteria: readonly MissionCriterion[];
  graph: CompanyEvidenceGraph;
  eligibility: EligibilityResult;
  /** The mission's anchor criterion dimension (hiring, funding, …), when it has one. */
  anchor: string | null;
}

export interface CeilingResult {
  version: typeof OPPORTUNITY_LABEL_VERSION;
  /** Null when the candidate is pending or ineligible: it is not a lead yet. */
  ceiling: Label | null;
  /** 0–1: the share of the mission's criteria the evidence actually answers. */
  evidence_coverage: number;
  /** 0–1: proven anchor and opportunity signals, weighted toward the anchor. */
  signal_strength: number;
  anchor_proven: boolean;
  targets_total: number;
  targets_proven: number;
  targets_unproven: string[];
  /** Code's list of what is missing. The reasoner cannot shorten it. */
  missing_evidence: string[];
  /** Evidence ids a sentence is allowed to cite. */
  citable_ids: string[];
}

function provenSignalIds(graph: CompanyEvidenceGraph, dims: readonly string[]): string[] {
  return graph.claims
    .filter((c) => dims.includes(c.dimension) && c.current && c.current.status === "proven")
    .map((c) => c.current!.evidence_id);
}

export function computeCeiling(i: CeilingInput): CeilingResult {
  const usable = i.criteria.filter((c) => c.status === "ok");
  const targets = usable.filter((c) => c.kind === "target");
  // WHAT COUNTS AS AN OPPORTUNITY SIGNAL HERE.
  //
  // The plan's `opportunity_signal` kind and, in practice, any OTHER observable
  // signal the mission carries: P1 compiles "bonus if they recently raised" as
  // a `target` (a hedge), and a proven funding round is exactly the thing that
  // makes an imperfect company worth surfacing. A `hypothesis` never counts —
  // it may only ever be a "possible reason to reach out".
  const anchorCriterionDim = i.anchor ?? null;
  const signals = usable.filter((c) =>
    c.kind !== "hypothesis" && c.kind !== "hard" &&
    c.dimension !== anchorCriterionDim &&
    SIGNAL_CRITERION_DIMENSIONS.has(c.dimension));

  const checks = usable.map((c) => ({ c, r: checkCriterion(c, i.graph) }));
  const targetChecks = checks.filter((x) => x.c.kind === "target");
  const targets_proven = targetChecks.filter((x) => x.r.result === "pass").length;
  const targets_unproven = targetChecks.filter((x) => x.r.result !== "pass").map((x) => x.c.id);

  const anchorDim = i.anchor ? CRITERION_EVIDENCE_DIMENSION[i.anchor as never] ?? i.anchor : null;
  const anchorClaim = anchorDim ? i.graph.claims.find((c) => c.dimension === anchorDim) : undefined;
  const anchor_proven = !!anchorClaim?.current && anchorClaim.current.status === "proven";

  const signalDims = signals
    .map((s) => CRITERION_EVIDENCE_DIMENSION[s.dimension])
    .filter((d): d is NonNullable<typeof d> => !!d);
  const provenSignals = provenSignalIds(i.graph, signalDims);

  const answered = checks.filter((x) => x.r.result !== "unknown").length;
  const evidence_coverage = checks.length === 0 ? 0 : round2(answered / checks.length);
  const signal_strength = round2(
    (anchor_proven ? 0.6 : 0) +
    (provenSignals.length > 0 ? 0.4 * Math.min(1, provenSignals.length / Math.max(1, signals.length)) : 0),
  );

  // Code owns the missing list: every criterion the evidence cannot answer.
  const missing_evidence = checks
    .filter((x) => x.r.result === "unknown")
    .map((x) => `${x.c.label} — ${x.r.reason}`);

  let ceiling: Label | null = null;
  if (i.eligibility.eligibility === "eligible") {
    if (anchor_proven && targets.length > 0 && targets_unproven.length === 0) ceiling = "exact_match";
    else if (anchor_proven && targets_unproven.length <= 1) ceiling = "strong_opportunity";
    else if (anchor_proven || provenSignals.length > 0) ceiling = "worth_considering";
    else ceiling = "low_priority";
  }

  const citable_ids = i.graph.claims.flatMap((c) =>
    [c.current, ...c.supporting].filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.evidence_id));

  return {
    version: OPPORTUNITY_LABEL_VERSION, ceiling, evidence_coverage, signal_strength, anchor_proven,
    targets_total: targets.length, targets_proven, targets_unproven, missing_evidence,
    citable_ids: [...new Set(citable_ids)],
  };
}

export interface ReasonedSentence {
  text: string;
  evidence_ids: string[];
}

export interface ReasonedLabel {
  label: Label | null;
  why_surfaced: ReasonedSentence[];
  /** Sentences removed, with the reason — kept so a bad prompt is visible. */
  dropped: Array<{ text: string; reason: "no_citation" | "unknown_evidence_id" }>;
  /** True when the label fell because nothing survived validation. */
  dropped_a_level: boolean;
  missing_evidence: string[];
  capped_from: Label | null;
}

/**
 * Apply a reasoner's proposal under the ceiling.
 *
 * A proposal is not trusted in any part: the label is capped, every sentence
 * must cite an evidence id this candidate actually has, and the missing list is
 * code's regardless of what the model said.
 */
export function applyReasoning(
  ceiling: CeilingResult,
  proposal: { label?: unknown; why_surfaced?: unknown } | null,
): ReasonedLabel {
  const base: ReasonedLabel = {
    label: ceiling.ceiling, why_surfaced: [], dropped: [], dropped_a_level: false,
    missing_evidence: ceiling.missing_evidence, capped_from: null,
  };
  if (!ceiling.ceiling) return base;                       // pending / ineligible: no label to explain

  const citable = new Set(ceiling.citable_ids);
  const raw = Array.isArray(proposal?.why_surfaced) ? proposal!.why_surfaced as unknown[] : [];
  const kept: ReasonedSentence[] = [];
  const dropped: ReasonedLabel["dropped"] = [];
  for (const s of raw) {
    const r = s as { text?: unknown; evidence_ids?: unknown };
    const t = typeof r?.text === "string" ? r.text.trim() : "";
    if (!t) continue;
    const ids = Array.isArray(r.evidence_ids) ? r.evidence_ids.map(String).filter((x) => citable.has(x)) : [];
    if (ids.length === 0) {
      const claimedAny = Array.isArray(r.evidence_ids) && r.evidence_ids.length > 0;
      dropped.push({ text: t.slice(0, 200), reason: claimedAny ? "unknown_evidence_id" : "no_citation" });
      continue;
    }
    kept.push({ text: t.slice(0, 400), evidence_ids: [...new Set(ids)] });
  }

  const proposedRaw = typeof proposal?.label === "string" ? proposal.label as Label : null;
  const proposed = proposedRaw && LABEL_ORDER.includes(proposedRaw) ? proposedRaw : ceiling.ceiling;
  let label = labelAtOrBelow(proposed, ceiling.ceiling);
  const capped_from = proposedRaw && LABEL_ORDER.indexOf(proposedRaw) < LABEL_ORDER.indexOf(ceiling.ceiling)
    ? proposedRaw
    : null;

  // NOTHING SURVIVED, SO THE CLAIM DOES NOT EITHER. A label with no cited
  // reason is the "invent a story" failure this validator exists to stop.
  let dropped_a_level = false;
  if (kept.length === 0 && raw.length > 0) {
    const lowered = lowerLabel(label);
    dropped_a_level = lowered !== label;
    label = lowered;
  }
  return { label, why_surfaced: kept, dropped, dropped_a_level, missing_evidence: ceiling.missing_evidence, capped_from };
}

/**
 * What code says about a candidate when no reasoner runs: the ceiling itself,
 * explained from the evidence that set it. The system stays useful with no
 * model at all.
 */
export function deterministicReasons(ceiling: CeilingResult, graph: CompanyEvidenceGraph): ReasonedSentence[] {
  const out: ReasonedSentence[] = [];
  for (const claim of graph.claims) {
    if (!claim.current || claim.current.status !== "proven") continue;
    if (!["hiring", "job", "funding", "company_stage", "team_composition"].includes(claim.dimension)) continue;
    out.push({
      text: `${claim.dimension.replace(/_/g, " ")} is proven by ${claim.current.source.actor}`,
      evidence_ids: [claim.current.evidence_id],
    });
    if (out.length >= 3) break;
  }
  return out.filter((s) => s.evidence_ids.every((id) => ceiling.citable_ids.includes(id)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
