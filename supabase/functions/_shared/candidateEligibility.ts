// LEAD V2 P5 — ELIGIBILITY: CODE'S ANSWER, FROM EVIDENCE, DETERMINISTIC.
//
// Before P5 a candidate was pass / reject / unknown, decided by a model reading
// a prompt. Run after run that produced "0 qualified · 30 × insufficient
// evidence": a company whose only failing was a dimension nobody had bought yet
// was indistinguishable from one the mission had actually ruled out.
//
// Eligibility is now three states over the P4 evidence graph, and nothing else:
//
//   ineligible   some HARD criterion is DISPROVEN — the mission ruled it out
//   pending      no hard criterion disproven, at least one still unknown —
//                the candidate is a question, not a rejection
//   eligible     every hard criterion is proven by fresh evidence
//
// THE RULE THAT MAKES A PREFERENCE A PREFERENCE. Only `hard` criteria are read
// here. `target`, `opportunity_signal` and `hypothesis` rank a candidate and
// can never make it ineligible, however badly they fail — the plan's SEM-1.
//
// A STALE ITEM PROVES NOTHING. `buildCompanyEvidenceGraph` has already dropped
// expired items out of `current`, so a 90-day-old posting leaves `hiring`
// unknown rather than proven. That is what sends a candidate to evidence
// completion instead of onto the shortlist.
//
// P5.2 — THE THREE ANSWERS, AND WHAT EACH ONE NEEDS.
//
//   pass      the current item is PROVEN and supports the requirement
//   fail      the current item is PROVEN (verified) and contradicts it, or the
//             item itself is disproven
//   unknown   anything else: no item, an unverified item, or an item that
//             neither shows nor rules the requirement out
//
// A contradiction only fails a hard rule when the evidence behind it is
// verified. A provider's reported location or headcount band that disagrees
// sends the candidate to `pending`, not out of the mission: an unverified
// claim can no more reject a company than it can qualify one. Industry and
// business model are compared through the controlled vocabulary in
// `businessModelMatch.ts` — never by substring.
//
// Every check carries the provenance of the item it read (status, method,
// confidence, actor, and the grounding decision when one produced it), so the
// Workbench can show WHY a rule passed, not just that it did.
//
// GPT is not consulted and cannot appeal. Pure.

import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "./candidateObservation.ts";
import type { CriterionDimension, MissionCriterion } from "./missionCriteria.ts";
import { geographyContradicts } from "./leadEligiblePool.ts";
import { matchBusinessModel } from "./businessModelMatch.ts";
import { normalizeRoundType } from "./fundingStageClaim.ts";
import type { FundingStageVerdict } from "./fundingStageClaim.ts";
import { usableHeadcount } from "./headcountValue.ts";

export const ELIGIBILITY_VERSION = "candidate-eligibility-v1" as const;

export type Eligibility = "eligible" | "pending" | "ineligible";
export type CheckResult = "pass" | "fail" | "unknown";

/** Which evidence dimension answers a criterion. Null = nothing can answer it yet. */
export const CRITERION_EVIDENCE_DIMENSION: Readonly<Partial<Record<CriterionDimension, EvidenceDimension>>> =
  Object.freeze({
    geography: "geography",
    industry: "industry",
    business_model: "business_model",
    company_size: "headcount",
    company_stage: "company_stage",
    hiring: "hiring",
    funding: "funding",
    expansion: "expansion",
    product_launch: "product_launch",
    team_composition: "team_composition",
    headcount_growth: "headcount_growth",
    leadership_change: "leadership_change",
    technology: "technology",
  });

/** Where the answer came from — carried, never recomputed downstream. */
export interface CheckProvenance {
  evidence_id: string;
  dimension: EvidenceDimension;
  status: EvidenceItem["status"];
  method: EvidenceItem["method"];
  confidence: EvidenceItem["confidence"];
  actor: string;
  /** The grounder's whole-company verdict, when a grounded evaluation produced the item. */
  grounding_decision: "pass" | "review" | "fail" | null;
  /** The business-model claim's own decision — what actually made it proof or not. */
  business_model_decision: "accepted" | "review" | null;
  /** Where the evidence was read, when the source had an address. */
  url: string | null;
  /** The source's own words behind the value, when kept (a grounded quote). */
  excerpt: string | null;
}

export interface CriterionCheck {
  criterion_id: string;
  dimension: CriterionDimension;
  kind: MissionCriterion["kind"];
  result: CheckResult;
  /** Why, in the words a card can show. */
  reason: string;
  evidence_ids: string[];
  /** The item the answer rests on. Null when nothing answered it. */
  provenance: CheckProvenance | null;
}

export interface EligibilityResult {
  version: typeof ELIGIBILITY_VERSION;
  eligibility: Eligibility;
  checks: CriterionCheck[];
  /** Per hard dimension, for the Workbench's `hard_checks`. */
  hard_checks: Record<string, CheckResult>;
  /** Hard criteria the evidence disproves — the reason an ineligible is ineligible. */
  disproven: string[];
  /** Hard dimensions still unknown: exactly what evidence completion should buy. */
  gaps: EvidenceDimension[];
}

const text = (v: unknown): string => String(v ?? "").trim().toLowerCase();

function headcountSatisfied(required: unknown, count: unknown): CheckResult {
  // A zero or negative "count" is a missing number, never a contradiction.
  const n = usableHeadcount(count);
  if (n === null) return "unknown";
  const r = required as { min?: number | null; max?: number | null } | number | null;
  const min = typeof r === "object" && r ? r.min ?? null : null;
  const max = typeof r === "object" && r ? r.max ?? null : null;
  if (min == null && max == null) return "unknown";
  if (min != null && n < min) return "fail";
  if (max != null && n > max) return "fail";
  return "pass";
}

function provenanceOf(item: EvidenceItem): CheckProvenance {
  return {
    evidence_id: item.evidence_id, dimension: item.dimension, status: item.status,
    method: item.method, confidence: item.confidence, actor: item.source.actor,
    grounding_decision: item.assessment?.decision ?? null,
    business_model_decision: item.assessment?.business_model_decision ?? null,
    url: item.source.url ?? null,
    excerpt: item.source.excerpt ?? null,
  };
}

/** The item that currently speaks for a dimension, and what it says. */
function currentItem(graph: CompanyEvidenceGraph, dim: EvidenceDimension): EvidenceItem | null {
  return graph.claims.find((c) => c.dimension === dim)?.current ?? null;
}

/**
 * One criterion against the evidence. `unknown` whenever the evidence cannot
 * answer it — never a guess, and never a rejection by absence.
 */
export function checkCriterion(c: MissionCriterion, graph: CompanyEvidenceGraph): CriterionCheck {
  const base = { criterion_id: c.id, dimension: c.dimension, kind: c.kind };
  const dim = CRITERION_EVIDENCE_DIMENSION[c.dimension];
  if (!dim) {
    return { ...base, result: "unknown", reason: `no evidence dimension answers ${c.dimension}`, evidence_ids: [], provenance: null };
  }
  if (c.dimension === "industry" || c.dimension === "business_model") return checkBusinessModel(c, graph, base);
  const item = currentItem(graph, dim);
  if (!item || item.status === "unknown") {
    const stale = graph.claims.find((x) => x.dimension === dim)?.stale.length ?? 0;
    return {
      ...base, result: "unknown", evidence_ids: [], provenance: null,
      reason: stale > 0 ? `the only ${dim} evidence has expired` : `${dim} is not established`,
    };
  }
  const ids = [item.evidence_id];
  const provenance = provenanceOf(item);
  // P6 — A DECIDED FUNDING-STAGE CLAIM ANSWERS THE STAGE CRITERION DIRECTLY.
  // `fundingStageClaim.ts` already ordered the verified rounds; re-reading its
  // verdict as a string would only reintroduce the substring test it replaces.
  if (c.dimension === "company_stage") {
    const fs = fundingStageClaimValue(item, c.value);
    if (fs) {
      // A DECIDED CLAIM IS NEVER RE-READ AS TEXT. Falling through to the label
      // path would let the explanation's own words ("later than seed") match a
      // seed criterion by substring — the exact false positive §31 mutates for.
      if (fs.answers === false) {
        return {
          ...base, result: "unknown", evidence_ids: ids, provenance,
          reason: `the funding-stage claim decided "${fs.required_stage}", not ${String(c.value)}`,
        };
      }
      return {
        ...base, result: fs.verdict === "pass" ? "pass" : "fail",
        reason: fs.explanation, evidence_ids: ids, provenance,
      };
    }
  }
  // A disproven claim fails whatever the value was.
  if (item.status === "disproven") {
    return { ...base, result: "fail", reason: `${dim} is disproven by ${item.source.actor}`, evidence_ids: ids, provenance };
  }
  // PLAUSIBLE IS NOT PROVEN — in either direction. A provider's reported
  // location or headcount band ranks a candidate; it neither satisfies a hard
  // rule nor rules the candidate out.
  const proven = item.status === "proven";

  switch (c.dimension) {
    case "geography": {
      const required = Array.isArray(c.value) ? c.value.map(String) : [String(c.value ?? "")];
      const claimed = typeof item.value === "string" ? item.value : null;
      if (geographyContradicts(claimed, required.filter(Boolean))) {
        return proven
          ? { ...base, result: "fail", reason: `geography ${claimed} is outside ${required.join(", ")}`, evidence_ids: ids, provenance }
          : { ...base, result: "unknown", reason: `geography ${claimed} is reported outside ${required.join(", ")}, not verified`, evidence_ids: ids, provenance };
      }
      return proven
        ? { ...base, result: "pass", reason: `geography ${claimed} matches ${required.join(", ")}`, evidence_ids: ids, provenance }
        : { ...base, result: "unknown", reason: `geography ${claimed} is reported, not proven`, evidence_ids: ids, provenance };
    }
    case "company_size": {
      const r = headcountSatisfied(c.value, item.value);
      if (r === "fail") {
        return proven
          ? { ...base, result: "fail", reason: `headcount ${item.value} is outside the required range`, evidence_ids: ids, provenance }
          : { ...base, result: "unknown", reason: `headcount ${item.value} is reported outside the range, not verified`, evidence_ids: ids, provenance };
      }
      if (r === "unknown") return { ...base, result: "unknown", reason: "headcount is not established", evidence_ids: ids, provenance };
      return proven
        ? { ...base, result: "pass", reason: `headcount ${item.value} is within range`, evidence_ids: ids, provenance }
        : { ...base, result: "unknown", reason: `headcount ${item.value} is advisory, not proven`, evidence_ids: ids, provenance };
    }
    case "company_stage": {
      // A STAGE LABEL IS NOT A STAGE DISPROOF. "series_c" does not mention
      // "startup", and a cohort record ({cohort: y_combinator}) does not
      // mention "seed" — neither rules the criterion out, so both leave it
      // unknown and send the candidate to evidence completion.
      const want = text(c.value);
      const got = typeof item.value === "string" ? text(item.value) : text(JSON.stringify(item.value));
      if (!want) return { ...base, result: "unknown", reason: "no stage was asked for", evidence_ids: ids, provenance };
      if (!got.includes(want)) {
        return { ...base, result: "unknown", reason: `stage "${item.value}" neither shows nor rules out ${want}`, evidence_ids: ids, provenance };
      }
      return proven
        ? { ...base, result: "pass", reason: `stage "${item.value}" matches ${want}`, evidence_ids: ids, provenance }
        : { ...base, result: "unknown", reason: `stage "${item.value}" is reported, not proven`, evidence_ids: ids, provenance };
    }
    default: {
      // Signal dimensions: presence of a fresh, proven item satisfies them.
      if (!proven) return { ...base, result: "unknown", reason: `${dim} is reported, not proven`, evidence_ids: ids, provenance };
      if (item.value === false) return { ...base, result: "fail", reason: `${dim} is false`, evidence_ids: ids, provenance };
      return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}`, evidence_ids: ids, provenance };
    }
  }
}

/**
 * A `company_stage` item written by the funding-stage claim, and whether it
 * answers the stage THIS criterion asked for.
 *
 * A verdict decided for "seed" says nothing about a criterion asking for
 * "series-a", so a mismatch is reported as `answers: false` and leaves the
 * criterion unknown — it is NOT handed to the label path, whose substring test
 * would match the claim's own explanation text. A
 * PENDING funding claim never reaches here: `fundingStageEvidenceItem` writes
 * no item for one.
 */
type FundingStageClaimRead =
  | { answers: false; required_stage: string }
  | { answers: true; verdict: FundingStageVerdict; explanation: string };

function fundingStageClaimValue(item: EvidenceItem, wanted: unknown): FundingStageClaimRead | null {
  const v = item.value as
    | { claim?: string; verdict?: string; required_stage?: string | null; explanation?: string }
    | null
    | undefined;
  if (!v || typeof v !== "object" || v.claim !== "funding_stage") return null;
  if (v.verdict !== "pass" && v.verdict !== "fail") return null;
  const decided = normalizeRoundType(v.required_stage ?? null);
  const want = normalizeRoundType(typeof wanted === "string" ? wanted : null);
  if (!decided || !want || decided !== want) {
    return { answers: false, required_stage: decided ?? String(v.required_stage ?? "") };
  }
  return { answers: true, verdict: v.verdict, explanation: String(v.explanation ?? `funding stage ${v.verdict}`) };
}

/**
 * INDUSTRY AND BUSINESS MODEL, through the controlled vocabulary.
 *
 * An `industry` criterion is also answered by the business model: the compiler
 * files the noun phrase "B2B SaaS" under industry, while what can actually be
 * established about a company is its model. Every current item for either
 * dimension is read; only a PROVEN one can pass or fail the rule.
 *
 *   a proven item supports it, none contradicts    → pass
 *   a proven item contradicts it, none supports    → fail
 *   proven items disagree                          → unknown (a real conflict)
 *   nothing proven says either                     → unknown
 */
function checkBusinessModel(
  c: MissionCriterion, graph: CompanyEvidenceGraph,
  base: Pick<CriterionCheck, "criterion_id" | "dimension" | "kind">,
): CriterionCheck {
  const dims: EvidenceDimension[] = c.dimension === "industry" ? ["business_model", "industry"] : ["business_model"];
  const items = dims.map((d) => currentItem(graph, d)).filter((x): x is EvidenceItem => !!x && x.status !== "unknown");
  const want = text(c.value);
  if (items.length === 0) {
    const stale = dims.some((d) => (graph.claims.find((x) => x.dimension === d)?.stale.length ?? 0) > 0);
    return {
      ...base, result: "unknown", evidence_ids: [], provenance: null,
      reason: stale ? `the only ${dims[0]} evidence has expired` : `${dims[0].replace(/_/g, " ")} is not established`,
    };
  }
  const read = items.map((item) => ({
    item,
    match: item.status === "disproven" ? "fail" as const : matchBusinessModel(c.value, item.value),
  }));
  const proven = read.filter((r) => r.item.status === "proven" || r.item.status === "disproven");
  const supports = proven.filter((r) => r.match === "pass");
  const contradicts = proven.filter((r) => r.match === "fail");
  const say = (r: { item: EvidenceItem }) => `${r.item.dimension.replace(/_/g, " ")} "${r.item.value}"`;
  if (supports.length > 0 && contradicts.length === 0) {
    const r = supports[0];
    return { ...base, result: "pass", reason: `${say(r)} matches ${want}`, evidence_ids: [r.item.evidence_id], provenance: provenanceOf(r.item) };
  }
  if (contradicts.length > 0 && supports.length === 0) {
    const r = contradicts[0];
    return {
      ...base, result: "fail", evidence_ids: [r.item.evidence_id], provenance: provenanceOf(r.item),
      reason: r.item.status === "disproven" ? `${r.item.dimension} is disproven by ${r.item.source.actor}` : `verified ${say(r)} rules out ${want}`,
    };
  }
  if (supports.length > 0 && contradicts.length > 0) {
    return {
      ...base, result: "unknown", evidence_ids: [supports[0].item.evidence_id, contradicts[0].item.evidence_id],
      provenance: provenanceOf(supports[0].item),
      reason: `verified sources disagree: ${say(supports[0])} vs ${say(contradicts[0])}`,
    };
  }
  // Nothing verified answers it. Say what was seen, and why it is not proof.
  const seen = read.find((r) => r.match === "pass") ?? read[0];
  const why = seen.item.status === "proven"
    ? "neither shows nor rules out"
    : seen.match === "pass" ? "suggests, but is not verified as," : seen.match === "fail" ? "suggests otherwise, but is not verified, for" : "neither shows nor rules out";
  // Which fact the company's own words left unstated — the gap a verification
  // route (the product / pricing / customers pages) has to close.
  const unstated = (seen.item.assessment?.business_model_reasons ?? [])
    .filter((r) => r.startsWith("quote_does_not_state_"))
    .map((r) => r.slice("quote_does_not_state_".length).replace(/_/g, " "));
  return {
    ...base, result: "unknown", evidence_ids: [seen.item.evidence_id], provenance: provenanceOf(seen.item),
    reason: `${say(seen)} ${why} ${want}` + (unstated.length ? ` (the quote does not state ${unstated.join(" or ")})` : ""),
  };
}

/**
 * The candidate's eligibility. Hard criteria decide it; everything else is
 * checked for the record and cannot change the outcome.
 */
export function evaluateEligibility(
  criteria: readonly MissionCriterion[], graph: CompanyEvidenceGraph,
): EligibilityResult {
  const usable = criteria.filter((c) => c.status === "ok");
  const checks = usable.map((c) => checkCriterion(c, graph));
  const hard = checks.filter((c) => c.kind === "hard");
  const hard_checks: Record<string, CheckResult> = {};
  for (const h of hard) {
    // Worst result wins when two hard criteria share a dimension.
    const prior = hard_checks[h.dimension];
    hard_checks[h.dimension] = prior === "fail" || h.result === "fail"
      ? "fail"
      : prior === "unknown" || h.result === "unknown"
      ? "unknown"
      : "pass";
  }
  const disproven = hard.filter((h) => h.result === "fail").map((h) => h.criterion_id);
  const unknown = hard.filter((h) => h.result === "unknown");
  const eligibility: Eligibility = disproven.length > 0
    ? "ineligible"
    : unknown.length > 0
    ? "pending"
    : "eligible";
  const gaps = [...new Set(unknown
    .map((h) => CRITERION_EVIDENCE_DIMENSION[h.dimension])
    .filter((d): d is EvidenceDimension => !!d))];
  return { version: ELIGIBILITY_VERSION, eligibility, checks, hard_checks, disproven, gaps };
}
