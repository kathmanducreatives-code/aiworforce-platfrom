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
// GPT is not consulted and cannot appeal. Pure.

import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "./candidateObservation.ts";
import type { CriterionDimension, MissionCriterion } from "./missionCriteria.ts";
import { geographyContradicts } from "./leadEligiblePool.ts";

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

export interface CriterionCheck {
  criterion_id: string;
  dimension: CriterionDimension;
  kind: MissionCriterion["kind"];
  result: CheckResult;
  /** Why, in the words a card can show. */
  reason: string;
  evidence_ids: string[];
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

/** Tokens a label must contain to satisfy an industry/business-model criterion. */
function industrySatisfied(required: unknown, claimed: unknown): boolean {
  const need = text(required).split(/[^a-z0-9+]+/).filter((t) => t.length > 1);
  const got = text(claimed);
  if (!need.length || !got) return false;
  return need.every((t) => got.includes(t));
}

function headcountSatisfied(required: unknown, count: unknown): CheckResult {
  if (typeof count !== "number" || !Number.isFinite(count)) return "unknown";
  const r = required as { min?: number | null; max?: number | null } | number | null;
  const min = typeof r === "object" && r ? r.min ?? null : null;
  const max = typeof r === "object" && r ? r.max ?? null : null;
  if (min == null && max == null) return "unknown";
  if (min != null && count < min) return "fail";
  if (max != null && count > max) return "fail";
  return "pass";
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
    return { ...base, result: "unknown", reason: `no evidence dimension answers ${c.dimension}`, evidence_ids: [] };
  }
  const item = currentItem(graph, dim);
  if (!item || item.status === "unknown") {
    const stale = graph.claims.find((x) => x.dimension === dim)?.stale.length ?? 0;
    return {
      ...base, result: "unknown", evidence_ids: [],
      reason: stale > 0 ? `the only ${dim} evidence has expired` : `${dim} is not established`,
    };
  }
  const ids = [item.evidence_id];
  // A disproven claim fails whatever the value was.
  if (item.status === "disproven") {
    return { ...base, result: "fail", reason: `${dim} is disproven by ${item.source.actor}`, evidence_ids: ids };
  }
  // PLAUSIBLE IS NOT PROVEN. A provider's own industry label, an advisory
  // headcount band — they rank a candidate; they never satisfy a hard rule.
  const proven = item.status === "proven";

  switch (c.dimension) {
    case "geography": {
      const required = Array.isArray(c.value) ? c.value.map(String) : [String(c.value ?? "")];
      const claimed = typeof item.value === "string" ? item.value : null;
      if (geographyContradicts(claimed, required.filter(Boolean))) {
        return { ...base, result: "fail", reason: `geography ${claimed} is outside ${required.join(", ")}`, evidence_ids: ids };
      }
      return proven
        ? { ...base, result: "pass", reason: `geography ${claimed} matches ${required.join(", ")}`, evidence_ids: ids }
        : { ...base, result: "unknown", reason: `geography ${claimed} is reported, not proven`, evidence_ids: ids };
    }
    case "industry":
    case "business_model": {
      const ok = industrySatisfied(c.value, item.value);
      if (!ok) {
        // A label that does not mention it is not a disproof: LinkedIn's
        // "Technology, Information and Internet" says nothing about B2B SaaS.
        return { ...base, result: "unknown", reason: `${dim} "${item.value}" neither shows nor rules out ${text(c.value)}`, evidence_ids: ids };
      }
      return proven
        ? { ...base, result: "pass", reason: `${dim} "${item.value}" matches`, evidence_ids: ids }
        : { ...base, result: "unknown", reason: `${dim} "${item.value}" is a provider label, not proof`, evidence_ids: ids };
    }
    case "company_size": {
      const r = headcountSatisfied(c.value, item.value);
      if (r === "fail") return { ...base, result: "fail", reason: `headcount ${item.value} is outside the required range`, evidence_ids: ids };
      if (r === "unknown") return { ...base, result: "unknown", reason: "headcount is not established", evidence_ids: ids };
      return proven
        ? { ...base, result: "pass", reason: `headcount ${item.value} is within range`, evidence_ids: ids }
        : { ...base, result: "unknown", reason: `headcount ${item.value} is advisory, not proven`, evidence_ids: ids };
    }
    case "company_stage": {
      // A STAGE LABEL IS NOT A STAGE DISPROOF. "series_c" does not mention
      // "startup", and a cohort record ({cohort: y_combinator}) does not
      // mention "seed" — neither rules the criterion out, so both leave it
      // unknown and send the candidate to evidence completion.
      const want = text(c.value);
      const got = typeof item.value === "string" ? text(item.value) : text(JSON.stringify(item.value));
      if (!want) return { ...base, result: "unknown", reason: "no stage was asked for", evidence_ids: ids };
      if (!got.includes(want)) {
        return { ...base, result: "unknown", reason: `stage "${item.value}" neither shows nor rules out ${want}`, evidence_ids: ids };
      }
      return proven
        ? { ...base, result: "pass", reason: `stage "${item.value}" matches ${want}`, evidence_ids: ids }
        : { ...base, result: "unknown", reason: `stage "${item.value}" is reported, not proven`, evidence_ids: ids };
    }
    default: {
      // Signal dimensions: presence of a fresh, proven item satisfies them.
      if (!proven) return { ...base, result: "unknown", reason: `${dim} is reported, not proven`, evidence_ids: ids };
      if (item.value === false) return { ...base, result: "fail", reason: `${dim} is false`, evidence_ids: ids };
      return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}`, evidence_ids: ids };
    }
  }
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
