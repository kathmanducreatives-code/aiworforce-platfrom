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
// verified. A provider's reported location or size band that disagrees
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
import { eventWithinWindow, type EvidenceDimension, type EvidenceItem } from "./candidateObservation.ts";
import { anyOfGroupKey, type CriterionDimension, type MissionCriterion } from "./missionCriteria.ts";
import type { CriterionVerdict } from "./missionEvaluation.ts";
import type { QualificationHold } from "./qualificationHold.ts";
import { geographyContradicts } from "./leadEligiblePool.ts";
import { isControlledPhrase, matchBusinessModel } from "./businessModelMatch.ts";
import {
  decideHasRaised, decideRecentlyFunded, fundingKindOf, fundingPresenceOf, normalizeRoundType, requiredStagesOf, stageRequirement,
} from "./fundingStageClaim.ts";
import type { FundingStageVerdict } from "./fundingStageClaim.ts";
import { fundingRecordsInGraph } from "./fundingCorroboration.ts";
import { bandSatisfies, isSizeBand } from "./companySize.ts";
import { normalizeSuppliedCompanies } from "./suppliedCompanyIdentity.ts";

export const ELIGIBILITY_VERSION = "candidate-eligibility-v1" as const;

export type Eligibility = "eligible" | "pending" | "ineligible";
export type CheckResult = "pass" | "fail" | "unknown";

/** Which evidence dimension answers a criterion. Null = nothing can answer it yet. */
export const CRITERION_EVIDENCE_DIMENSION: Readonly<Partial<Record<CriterionDimension, EvidenceDimension>>> =
  Object.freeze({
    geography: "geography",
    industry: "industry",
    business_model: "business_model",
    // THE DECLARED BAND, never the LinkedIn member count (companySize.ts).
    company_size: "company_size_band",
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
  /**
   * Set when NO purchase can close this check: a hold another authority placed
   * on the company (`hold:<code>`, Q1), equally authoritative sources that
   * disagree (`conflict:<dimension>`, Q2), or a requirement no route can
   * establish (`unproven:<claim>`, Q2). The gap router reports it blocked,
   * so a candidate carrying one is never bought more evidence.
   */
  blocked?: string;
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
  /** Q1 — holds that kept an otherwise eligible candidate pending (`qualificationHold.ts`). */
  held: QualificationHold[];
}

const text = (v: unknown): string => String(v ?? "").trim().toLowerCase();


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
 * Q2 — WHEN EQUALLY AUTHORITATIVE SOURCES DISAGREE, NOTHING IS DECIDED.
 *
 * The graph keeps every fresh item that disagrees with the one it picked
 * (`conflicting`), but a check used to read `current` only — and `current` is
 * chosen by method, status, confidence, recency and finally evidence ID, so
 * which of two equally authoritative answers won could depend on arrival order
 * (audit G01: two company records, US vs Canadian HQ; G02: 11–50 vs 201–500).
 *
 * The rule is generic: a fresh, PROVEN item of the same method as `current`
 * is re-checked against this criterion; when any would give a different
 * result, the check is `unknown` and BLOCKED (buying the same kind of source
 * again cannot settle it). Disagreement that does not change THIS criterion's
 * answer is not material and decides nothing. A weaker item (plausible, or a
 * lower method) never overturns a stronger one — that ordering is the graph's.
 * HQ and office presence are compared within the criterion's own scope.
 */
const CONFLICT_DIMENSIONS: ReadonlySet<CriterionDimension> = new Set<CriterionDimension>(["geography", "company_size"]);

export function checkCriterion(c: MissionCriterion, graph: CompanyEvidenceGraph): CriterionCheck {
  const check = checkAgainst(c, graph);
  const dim = CRITERION_EVIDENCE_DIMENSION[c.dimension];
  if (!dim || !CONFLICT_DIMENSIONS.has(c.dimension) || check.result === "unknown") return check;
  const claim = graph.claims.find((x) => x.dimension === dim);
  const current = claim?.current;
  if (!claim || !current) return check;
  for (const other of claim.conflicting) {
    if (other.status !== "proven" || other.method !== current.method) continue;
    const alone: CompanyEvidenceGraph = {
      ...graph,
      claims: graph.claims.map((x) => x.dimension === dim ? { ...x, current: other, supporting: [], conflicting: [] } : x),
    };
    const theirs = checkAgainst(c, alone);
    // An item that cannot answer this criterion (unknown — e.g. a location
    // copy with no HQ authority) does not DISPUTE it: only a definite, different
    // answer is a material conflict.
    if (theirs.result !== "unknown" && theirs.result !== check.result) {
      return {
        ...check, result: "unknown", evidence_ids: [current.evidence_id, other.evidence_id],
        reason: `equally authoritative sources disagree: ${current.source.actor} says ${check.result} (${check.reason}), ` +
          `${other.source.actor} says ${theirs.result} (${theirs.reason})`,
        blocked: `conflict:${dim}`,
      };
    }
  }
  return check;
}

/**
 * One criterion against the evidence. `unknown` whenever the evidence cannot
 * answer it — never a guess, and never a rejection by absence.
 */
function checkAgainst(c: MissionCriterion, graph: CompanyEvidenceGraph): CriterionCheck {
  const base = { criterion_id: c.id, dimension: c.dimension, kind: c.kind };
  // ── A SELECTION, CHECKED AGAINST WHO THE COMPANY TURNED OUT TO BE ────────
  //
  // "Companies you supplied" is compiled as a HARD criterion, and no evidence
  // dimension answers it — so it fell through to the `!dim` branch below and
  // came back `unknown` for every candidate, forever. One unknown hard check
  // makes eligibility `pending`, so EVERY candidate of EVERY known-company
  // mission was structurally unqualifiable: the funding pair could run, ground
  // its claim, and the company still could never reach `eligible`.
  //
  // Answered from the candidate's resolved IDENTITY rather than passed blindly:
  // a company that resolved to something the user did not supply fails, and
  // one whose identity is not resolved yet stays unknown until it is.
  if (c.dimension === "known_companies") return checkKnownCompanies(c, graph, base);
  if (excludedTypes(c)) return checkExcludedTypes(c, excludedTypes(c)!, graph, base);
  const dim = CRITERION_EVIDENCE_DIMENSION[c.dimension];
  if (!dim) {
    return { ...base, result: "unknown", reason: `no evidence dimension answers ${c.dimension}`, evidence_ids: [], provenance: null };
  }
  if (c.dimension === "industry" || c.dimension === "business_model") return checkBusinessModel(c, graph, base);
  const current = currentItem(graph, dim);
  const item = c.dimension === "geography" && c.geography_scope === "presence" && current?.geography_presence
    ? { ...current, value: current.geography_presence.value, status: current.geography_presence.status,
      authority: current.geography_presence.authority } : current;
  if (!item || item.status === "unknown") {
    const stale = graph.claims.find((x) => x.dimension === dim)?.stale.length ?? 0;
    return {
      ...base, result: "unknown", evidence_ids: [], provenance: null,
      reason: stale > 0 ? `the only ${dim} evidence has expired` : `${dim} is not established`,
    };
  }
  const ids = [item.evidence_id];
  const provenance = provenanceOf(item);
  // HEADQUARTERS NEEDS PROVEN HQ AUTHORITY — from the item speaking for the
  // dimension or from a proven item AGREEING with it (Q3). The same location
  // can reach the graph twice: as the company record's observation, which
  // carries the HQ authority, and as the registry's `company_location`, which
  // does not. Which of two equal items is `current` must not decide whether HQ
  // is established; a DISAGREEING item never lends its authority.
  const hqAuthority = (e: EvidenceItem | null | undefined) =>
    !!e && e.status === "proven" && e.authority?.claim === "headquarters" && e.authority.level === "proven";
  // A DISPROVEN location fails whatever the scope: the headquarters question
  // only arises for a location that is not already ruled out (below).
  if (c.dimension === "geography" && c.geography_scope === "headquarters" && item.status !== "disproven" && !(item.status === "proven" &&
    (hqAuthority(item) || (graph.claims.find((x) => x.dimension === dim)?.supporting ?? []).some(hqAuthority)))) {
    return { ...base, result: "unknown", reason: "headquarters is not explicitly established",
      evidence_ids: ids, provenance };
  }
  // P6 — A DECIDED FUNDING-STAGE CLAIM ANSWERS THE STAGE CRITERION DIRECTLY.
  // `fundingStageClaim.ts` already ordered the verified rounds; re-reading its
  // verdict as a string would only reintroduce the substring test it replaces.
  if (c.dimension === "company_stage") {
    const fs = fundingStageClaimValue(item, stageRequirement(c));
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
  // location or size band ranks a candidate; it neither satisfies a hard
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
      // A SIZE CRITERION IS ANSWERED BY THE DECLARED BAND. Band inside the
      // requested range → pass; fully outside → fail; a partial overlap, or an
      // exact staff count, cannot be settled by a band → unknown. The LinkedIn
      // associated-member count is a different dimension and is never read.
      if (!isSizeBand(item.value)) {
        return { ...base, result: "unknown", reason: "no declared size band is established", evidence_ids: ids, provenance };
      }
      const required = c.value as { min?: number | null; max?: number | null } | null;
      const { verdict, reason } = bandSatisfies(required, item.value);
      if (verdict === "unknown") return { ...base, result: "unknown", reason, evidence_ids: ids, provenance };
      return proven
        ? { ...base, result: verdict, reason, evidence_ids: ids, provenance }
        : { ...base, result: "unknown", reason: `${reason} — reported on a discovery row, not yet read from the company record`, evidence_ids: ids, provenance };
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
    case "funding": {
      // ── "RECENTLY FUNDED" IS A DATE, NOT A PRESENCE ────────────────────
      //
      // The mission's own window decides it, against the dated rounds the
      // company already carries (funding discovery's records, the pair's
      // corroborated record). Nothing is bought here: a company we hold no
      // rounds for stays PENDING and reaches the verifier through its gap.
      //
      // ── WITHOUT A WINDOW IT IS PRESENCE — DECIDED, NOT ASSUMED (RC05) ──
      //
      // "Has raised (venture) funding" / "raised funding before 2024" is decided
      // by `decideHasRaised` over the same records: a cited qualifying round
      // passes, a COMPLETE history without one fails, and non-equity
      // assistance never counts. A windowless criterion used to pass on any
      // proven funding item, which let a grant-only history through.
      const window = c.time_window?.days ?? null;
      const records = fundingRecordsInGraph(graph);
      const kind = fundingKindOf(c.value);
      if (window && records.length > 0) {
        const d = decideRecentlyFunded({ window_days: window, records, now: new Date(), kind });
        if (d.verdict !== "pending") {
          return { ...base, result: d.verdict === "pass" ? "pass" : "fail", reason: d.explanation, evidence_ids: ids, provenance };
        }
        return { ...base, result: "unknown", reason: d.explanation, evidence_ids: ids, provenance };
      }
      if (!window && records.length > 0) {
        const d = decideHasRaised({ records, ...fundingPresenceOf(c.value) });
        return { ...base, result: d.verdict === "pending" ? "unknown" : d.verdict, reason: d.explanation, evidence_ids: ids, provenance };
      }
      if (!proven) return { ...base, result: "unknown", reason: `${dim} is reported, not proven`, evidence_ids: ids, provenance };
      if (item.value === false) return { ...base, result: "fail", reason: `${dim} is false`, evidence_ids: ids, provenance };
      // Venture is a kind of round: an item that names no round cannot show it.
      if (kind === "venture") {
        return { ...base, result: "unknown", reason: "no funding round record shows the round is venture funding", evidence_ids: ids, provenance };
      }
      return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}`, evidence_ids: ids, provenance };
    }
    case "hiring": {
      // ── THE ROLE THE CLAIM NAMED, NOT ANY OPENING ─────────────────────────
      //
      // Presence of a proven `hiring` item used to satisfy every hiring
      // criterion, so an Account Executive opening proved "hiring a growth
      // role". Evidence that says WHICH role it found (the open-role verifier's
      // `{ open_role, role_families }`) must name a family the criterion asked
      // for. A bare `true` comes from a discovery posting, and the search having
      // ASKED for the role does not mean it returned one (Query B: "Assistant
      // Manager" for sales), so job discovery only records it when the posting's
      // title matches the mission's family (`jobProvesRequestedHiring`).
      if (!proven) return { ...base, result: "unknown", reason: `${dim} is reported, not proven`, evidence_ids: ids, provenance };
      if (item.value === false) return { ...base, result: "fail", reason: `${dim} is false`, evidence_ids: ids, provenance };
      const wanted = ((c.value as { qualifier?: { role_families?: unknown } } | null)?.qualifier?.role_families ?? []) as unknown[];
      const found = (item.value && typeof item.value === "object")
        ? ((item.value as { role_families?: unknown }).role_families ?? []) as unknown[] : null;
      if (found !== null && wanted.length > 0 && !wanted.some((w) => found.includes(w))) {
        return { ...base, result: "unknown", reason: `an open role was found, but not in ${wanted.join(" / ")}`, evidence_ids: ids, provenance };
      }
      // ── Q2 — "THE FIRST HIRE IN THE FUNCTION" IS PART OF THE REQUIREMENT ───
      //
      // The compiler keeps the user's own first-hire words on the hiring
      // qualifier (`first_in_function`); this check used to ignore them, so an
      // ordinary sales posting satisfied "must be hiring its FIRST sales
      // representative" (Codex routing audit H03). The engine already records
      // first-in-function evidence (`team_composition`, from the posting's own
      // words or a team lookup): supported → pass, contradicted → fail,
      // otherwise unknown. Unknown is BLOCKED: the open-role verifier would
      // only re-buy the opening that is already proven.
      const firstHire = (c.value as { qualifier?: { first_in_function?: unknown } } | null)?.qualifier?.first_in_function;
      if (firstHire) {
        const team = currentItem(graph, "team_composition");
        const said = (team?.value as { first_in_function?: unknown } | null)?.first_in_function;
        if (team && team.status === "proven" && said === "supported") {
          return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}, and it is the first hire in the function (${team.source.actor})`,
            evidence_ids: [...ids, team.evidence_id], provenance };
        }
        if (team && (team.status === "disproven" || said === "contradicted")) {
          return { ...base, result: "fail", reason: `an open role is proven, but it is not the first hire in the function (${team.source.actor})`,
            evidence_ids: [...ids, team.evidence_id], provenance };
        }
        return { ...base, result: "unknown", reason: "an open role is proven, but that it is the first hire in the function is not established",
          evidence_ids: ids, provenance, blocked: "unproven:first_in_function" };
      }
      return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}`, evidence_ids: ids, provenance };
    }
    default: {
      // Signal dimensions: presence of a fresh, proven item satisfies them.
      if (!proven) return { ...base, result: "unknown", reason: `${dim} is reported, not proven`, evidence_ids: ids, provenance };
      if (item.value === false) return { ...base, result: "fail", reason: `${dim} is false`, evidence_ids: ids, provenance };
      // Q2 — THE CUSTOMER'S WINDOW, ON THE EVENT'S OWN DATE (audit G14). The
      // graph's validity (`EVIDENCE_VALIDITY_DAYS`, 180 days for expansion) says
      // how long a fact stays usable in general; a criterion that asked for
      // "in the last 7 days" is judged against the event's date, and an item
      // that does not carry one cannot pass it. Hiring and funding keep their
      // own dated rules above.
      if (c.time_window?.days) {
        const w = eventWithinWindow(item.occurred_at, c.time_window.days);
        if (!w.inside) return { ...base, result: "unknown", reason: `${dim} is proven, but ${w.reason}`, evidence_ids: ids, provenance };
        return { ...base, result: "pass", reason: `${dim} is proven by ${item.source.actor}, ${w.reason}`, evidence_ids: ids, provenance };
      }
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

function fundingStageClaimValue(item: EvidenceItem, wanted: string): FundingStageClaimRead | null {
  const v = item.value as
    | { claim?: string; verdict?: string; required_stage?: string | null; explanation?: string }
    | null
    | undefined;
  if (!v || typeof v !== "object" || v.claim !== "funding_stage") return null;
  if (v.verdict !== "pass" && v.verdict !== "fail") return null;
  // One rung, or an any-of set joined by "|" (RC02): the claim answers this
  // criterion only when it decided exactly the set the criterion asks for.
  const rungs = (s: string | null) => requiredStagesOf(s).map((x) => normalizeRoundType(x)).filter((x): x is string => !!x).sort();
  const decided = rungs(v.required_stage ?? null);
  const want = rungs(wanted);
  if (!decided.length || !want.length || decided.join("|") !== want.join("|")) {
    return { answers: false, required_stage: decided.join("|") || String(v.required_stage ?? "") };
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

/** Lower-case LinkedIn company slug, or null. */
function linkedinSlug(u: unknown): string | null {
  const m = /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(u ?? ""));
  return m ? decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, "") : null;
}
const normDomain = (d: unknown) =>
  String(d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null;
const normName = (n: unknown) =>
  String(n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null;

/**
 * Is this candidate one of the companies the user supplied?
 *
 * A STRONG identifier (LinkedIn slug, domain) decides when both sides have
 * one: a match passes and a disagreement fails. A name decides only to PASS —
 * "Wordware" and a resolved "Wordware AI" are the same company far more often
 * than not, so a name difference is `unknown`, never a rejection.
 */
function checkKnownCompanies(
  c: MissionCriterion, graph: CompanyEvidenceGraph,
  base: { criterion_id: string; dimension: CriterionDimension; kind: MissionCriterion["kind"] },
): CriterionCheck {
  const supplied = normalizeSuppliedCompanies(Array.isArray(c.value) ? c.value : []).companies.map((s) => s.company);
  const claim = graph.claims.find((x) => x.dimension === "identity");
  const item = claim?.current ?? null;
  const id = (item?.value ?? null) as { linkedin_company_url?: unknown; domain?: unknown; name?: unknown } | null;
  if (!item || !id) {
    return { ...base, result: "unknown", reason: "the company's identity is not resolved yet", evidence_ids: [], provenance: null };
  }
  const ids = [item.evidence_id];
  const cand = { slug: linkedinSlug(id.linkedin_company_url), domain: normDomain(id.domain), name: normName(id.name) };
  let strongDisagreement = false;
  for (const s of supplied) {
    const sup = { slug: linkedinSlug(s.linkedin_company_url), domain: normDomain(s.canonical_domain), name: normName(s.company_name) };
    if ((sup.slug && sup.slug === cand.slug) || (sup.domain && sup.domain === cand.domain)) {
      return { ...base, result: "pass", reason: `one of the companies you supplied (${sup.slug ?? sup.domain})`,
        evidence_ids: ids, provenance: provenanceOf(item) };
    }
    if (sup.name && cand.name && (cand.name === sup.name || cand.name.startsWith(`${sup.name} `))) {
      return { ...base, result: "pass", reason: `one of the companies you supplied (${s.company_name})`,
        evidence_ids: ids, provenance: provenanceOf(item) };
    }
    if ((sup.slug && cand.slug) || (sup.domain && cand.domain)) strongDisagreement = true;
  }
  return strongDisagreement
    ? { ...base, result: "fail", reason: "resolved to a company you did not supply", evidence_ids: ids, provenance: provenanceOf(item) }
    : { ...base, result: "unknown", reason: "the resolved identity neither matches nor rules out the companies you supplied",
      evidence_ids: ids, provenance: provenanceOf(item) };
}

/** The company types an exclusion criterion names, or null for any other criterion. */
function excludedTypes(c: MissionCriterion): string[] | null {
  const v = c.value as { field?: unknown; value?: unknown } | null;
  if (c.dimension !== "exclusion" || v?.field !== "excluded_company_types") return null;
  const values = (Array.isArray(v.value) ? v.value : [v.value]).map((x) => String(x ?? "").trim()).filter(Boolean);
  return values.length ? values : null;
}

/**
 * Q4 — AN EXCLUDED COMPANY TYPE IS THE INDUSTRY IT NAMES, INVERTED.
 *
 * "Excluding recruiting agencies" is answered by the same controlled vocabulary
 * as an industry: proven evidence that the company IS one of the types fails
 * it; proven evidence that rules out every type passes it; anything else stays
 * unknown — an exclusion is never passed by silence. A type outside the
 * vocabulary is answered, as an interpretive industry is (H05), only by a
 * receipt-backed verdict from the company's own words.
 */
function checkExcludedTypes(
  c: MissionCriterion, values: readonly string[], graph: CompanyEvidenceGraph,
  base: Pick<CriterionCheck, "criterion_id" | "dimension" | "kind">,
): CriterionCheck {
  const reads = values.map((v) => checkBusinessModel({ ...c, dimension: "industry", value: v }, graph, base));
  const is = reads.findIndex((r) => r.result === "pass");
  if (is >= 0) {
    return { ...reads[is], ...base, result: "fail", reason: `${reads[is].reason}, which the request excludes` };
  }
  if (reads.every((r) => r.result === "fail")) {
    return { ...reads[0], ...base, result: "pass", reason: `${reads[0].reason} — not ${values.join(" or ")}` };
  }
  return { ...base, result: "unknown", evidence_ids: [], provenance: null,
    reason: `nothing established yet shows the company is not ${values.join(" or ")}` };
}

/** Q3 — an industry / business-model criterion the controlled vocabulary cannot read. */
function interpretive(c: MissionCriterion): boolean {
  if (excludedTypes(c)) return excludedTypes(c)!.some((v) => !isControlledPhrase(v));
  return (c.dimension === "industry" || c.dimension === "business_model") && !isControlledPhrase(c.value);
}

/**
 * ANY-OF GROUPS (RC02). Hard criteria that carry the same `any_of` alternatives
 * ("AI or developer-tools", "Series A or Series B") are ONE requirement:
 *
 *   an alternative passes   → the group passes; its siblings are answered by it
 *   every alternative fails → each fails, as before
 *   otherwise               → open: failed alternatives are dropped, so they can
 *                             neither reject the company nor route a purchase;
 *                             the open ones stay unknown
 *
 * Criteria without `any_of` are untouched, so "worst result wins" still holds
 * for genuine ANDs ("B2B SaaS" → b2b saas + saas).
 */
function anyOfResolved(criteria: readonly MissionCriterion[], checks: CriterionCheck[]): CriterionCheck[] {
  const groupOf = (i: number) => anyOfGroupKey(criteria[i]);
  const groups = new Map<string, number[]>();
  checks.forEach((_, i) => { const g = groupOf(i); if (g) groups.set(g, [...(groups.get(g) ?? []), i]); });
  if (groups.size === 0) return checks;
  const out: Array<CriterionCheck | null> = [...checks];
  for (const members of groups.values()) {
    const passing = members.find((i) => checks[i].result === "pass");
    if (passing !== undefined) {
      const p = checks[passing];
      for (const i of members) {
        if (checks[i].result === "pass") continue;
        out[i] = { ...checks[i], result: "pass", evidence_ids: p.evidence_ids, provenance: p.provenance,
          reason: `answered by the alternative ${criteria[passing].dimension === criteria[i].dimension
            ? String(criteria[passing].value) : criteria[passing].label}: ${p.reason}` };
      }
    } else if (!members.every((i) => checks[i].result === "fail")) {
      for (const i of members) if (checks[i].result === "fail") out[i] = null;
    }
  }
  return out.filter((c): c is CriterionCheck => c !== null);
}

/**
 * The candidate's eligibility — THE canonical qualification decision (Q1).
 * Hard criteria decide it; everything else is checked for the record and
 * cannot change the outcome.
 *
 *   - The evaluator's per-criterion verdicts can only lower a check (#113) —
 *     except that the model's own evidence-free abstention does not lower a
 *     funding window a clean, dated round record has decided
 *     (`fundingResolvesAbstention`).
 *   - A `hold` (`qualificationHold.ts`) can only stop an otherwise ELIGIBLE
 *     candidate: it becomes pending with a blocked `qualification_hold` check.
 */
export function evaluateEligibility(
  criteria: readonly MissionCriterion[], graph: CompanyEvidenceGraph,
  verdicts?: readonly CriterionVerdict[],
  holds: readonly QualificationHold[] = [],
): EligibilityResult {
  // Q3 — A MANDATORY REQUIREMENT IS ENFORCED WHETHER OR NOT A SOURCE CAN
  // ESTABLISH IT (audit G08, G08b). Before, a hard criterion no current source
  // can prove (`unprovable_today`: "exactly 23 employees", a round stage with
  // no funding verifier, the noun "startup") was dropped here, so a company
  // qualified without it. Now it is read like any other: evidence already in
  // the graph may pass or rule it out, and a receipt-backed evaluator verdict
  // from the company's own words may answer it. Otherwise it is an open check
  // that is BLOCKED: the company stays pending, nothing is bought for it, and
  // it is never counted. A non-hard criterion with that status still never
  // decides anything (a preference only ranks). Q3a-1 first stopped the
  // compiler inventing such requirements.
  const usable = criteria.filter((c) => c.status === "ok" || c.kind === "hard");
  const checks = anyOfResolved(usable, usable.map((c) => {
    const rows = verdicts?.filter((v) => v.criterion_id === c.id) ?? [];
    const verdict = rows.length === 1 ? rows[0] : null;
    const graphCheck = checkCriterion(c.dimension === "geography" && !c.geography_scope && verdict?.geography_scope
      ? { ...c, geography_scope: verdict.geography_scope } : c, graph);
    const unsupported = c.status !== "ok";
    if (unsupported && graphCheck.result === "unknown" && verdict && verdict.result !== "unknown" && verdict.evidence.length > 0) {
      return { ...graphCheck, result: verdict.result,
        reason: `${verdict.reason} (the evaluator's reading of the company's own cited words; no structured source establishes ${c.label})`,
        evidence_ids: verdict.evidence.map((e) => e.evidence_id), provenance: null };
    }
    const check: CriterionCheck = unsupported && graphCheck.result === "unknown"
      ? { ...graphCheck, reason: `no current source can establish ${c.label}; it stays open until the company's own cited words do`,
        blocked: `unsupported:${c.dimension}` }
      : graphCheck;
    if (!verdicts || check.result === "fail") return check;
    if (unsupported && verdict?.result !== "fail") return check;
    // Q3 — AN INDUSTRY THE VOCABULARY CANNOT READ. A mandatory industry or
    // business model outside the controlled vocabulary ("recruiting agencies",
    // "manufacturers") can never be answered by the evidence graph, so it used
    // to stay unknown forever and no such ICP could qualify (Codex routing
    // audit H05). There, and only there, the evaluator's per-criterion verdict
    // answers it — when it carries receipts the strict parser already checked:
    // verbatim, this company's own, fresh, verified, and from a COMPANY-OWNED
    // source (description, industry label, own website, cohort record). No
    // receipt, no answer: model confidence never substitutes for evidence. A
    // value the vocabulary CAN read keeps the rule below: verdicts only lower.
    if (check.result === "unknown" && interpretive(c) && verdict && verdict.result !== "unknown" && verdict.evidence.length > 0) {
      return { ...check, result: verdict.result,
        reason: `${verdict.reason} (the evaluator's reading of the company's own cited words; ${excludedTypes(c)?.join(" or ") ?? String(c.value)} is outside the controlled vocabulary)`,
        evidence_ids: verdict.evidence.map((e) => e.evidence_id), provenance: null };
    }
    if (verdict?.result === "pass") return check; // never upgrades missing facts
    // A DATED ROUND RESOLVES A GENUINE ABSTENTION — AND NOTHING ELSE.
    // On the job-first route the funding verifier runs AFTER the evaluator, so
    // the evaluator answered "unknown" before any round existed, and that
    // stale abstention held a company Atomus had just proven funded inside the
    // window as pending (the first-canary rehearsal). See `fundingResolvesAbstention`.
    if (fundingResolvesAbstention(c, check, verdict, graph)) return check;
    if (authorityResolvesAbstention(c, check, verdict, graph)) return check;
    return { ...check, result: verdict?.result === "fail" ? "fail" as const : "unknown" as const,
      reason: verdict?.reason ?? "the evaluator did not establish this criterion",
      evidence_ids: verdict?.evidence.map((e) => e.evidence_id) ?? [] };
  }));
  const hard = checks.filter((c) => c.kind === "hard");
  const disproven = hard.filter((h) => h.result === "fail").map((h) => h.criterion_id);
  const unknown = hard.filter((h) => h.result === "unknown");
  let eligibility: Eligibility = disproven.length > 0
    ? "ineligible"
    : unknown.length > 0
    ? "pending"
    : "eligible";
  // A HOLD STOPS ONLY WHAT WOULD OTHERWISE QUALIFY. Pending and ineligible
  // candidates already say why; adding a blocked check there would also stop
  // the ordinary purchase that could still answer their open questions.
  const held = eligibility === "eligible" ? [...holds] : [];
  if (held.length > 0) {
    eligibility = "pending";
    for (const h of held) {
      const check: CriterionCheck = {
        criterion_id: `qualification_hold:${h.code}`, dimension: "qualification_hold" as CriterionDimension,
        kind: "hard", result: "unknown", reason: h.reason, evidence_ids: [], provenance: null, blocked: `hold:${h.code}`,
      };
      checks.push(check);
      hard.push(check);
    }
  }
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
  // Only what a purchase could close is a gap.
  const gaps = [...new Set(hard.filter((h) => h.result === "unknown" && !h.blocked)
    .map((h) => CRITERION_EVIDENCE_DIMENSION[h.dimension])
    .filter((d): d is EvidenceDimension => !!d))];
  return { version: ELIGIBILITY_VERSION, eligibility, checks, hard_checks, disproven, gaps, held };
}

/**
 * May a dated funding record resolve the evaluator's earlier `unknown`?
 *
 * Only when ALL hold — otherwise the verdict lowers the check as #113 says:
 *   - the verdict is a GENUINE abstention: the model itself answered
 *     "unknown" and offered no receipt (`origin: "abstained"`). An `unknown`
 *     the parser made — a pass/fail whose receipts were missing, stale,
 *     conflicting, invalid or foreign (`downgraded`), an unknown citing
 *     rejected receipts, a missing row, an unparsed answer, or a verdict with
 *     no recorded origin — is unresolved, never an abstention;
 *   - the criterion is a WINDOWED funding requirement and the check passed
 *     through `decideRecentlyFunded` over dated round records (a window and at
 *     least one record leave no other path to `pass` above);
 *   - the funding evidence is clean: its current item is proven (null when all are stale), and
 *     the graph holds no conflicting, stale or disproven funding item.
 */
/**
 * May a PROVEN AUTHORITY RULE resolve the evaluator's evidence-free `unknown`?
 *
 * Canary session 2, LangChain: the company record flagged exactly one
 * headquarters, San Francisco, United States — `li_record_flagged_headquarters`,
 * level proven — so the headquarters check passed on structured evidence. The
 * evaluator, shown the office list as well, answered "unknown" with no receipt,
 * and that abstention lowered the proven check: the company could never
 * qualify on geography. The same rule `fundingResolvesAbstention` states for a
 * dated round applies to every authority-proven fact:
 *   - the verdict is a GENUINE abstention: the model itself answered
 *     "unknown" (`origin: "abstained"`). It may cite what made it hesitate —
 *     LangChain's answer cited the office list — but an `unknown` asserts no
 *     fact; a contradiction comes back as `fail` with receipts, and a fail, a
 *     downgraded or rejected answer, a missing row or an unparsed answer still
 *     lowers the check as before;
 *   - the check PASSED on the graph, from an item a registered authority rule
 *     PROVES (`evidenceAuthority.ts`) — a plausible provider field, a job-row
 *     location or a model reading never qualifies here;
 *   - no proven item for the dimension disagrees with it.
 * Funding has its own, stricter rule above; interpretive dimensions (industry,
 * business model) are the evaluator's to answer and are never resolved here.
 */
function authorityResolvesAbstention(
  c: MissionCriterion, check: CriterionCheck, verdict: CriterionVerdict | null, graph: CompanyEvidenceGraph,
): boolean {
  if (check.result !== "pass" || c.dimension === "funding" || interpretive(c)) return false;
  if (!verdict || verdict.result !== "unknown" || verdict.origin !== "abstained") return false;
  const dim = CRITERION_EVIDENCE_DIMENSION[c.dimension];
  const claim = dim ? graph.claims.find((x) => x.dimension === dim) : undefined;
  if (!claim) return false;
  const proven = (e: EvidenceItem | null | undefined) =>
    !!e && e.status === "proven" && e.authority?.level === "proven";
  const authoritative = [claim.current, ...claim.supporting].filter(proven);
  if (!authoritative.some((e) => check.evidence_ids.includes(e!.evidence_id) ||
    (c.dimension === "geography" && e!.authority?.claim === "headquarters"))) return false;
  return !claim.conflicting.some(proven);
}

function fundingResolvesAbstention(
  c: MissionCriterion, check: CriterionCheck, verdict: CriterionVerdict | null, graph: CompanyEvidenceGraph,
): boolean {
  if (c.dimension !== "funding" || !c.time_window?.days || check.result !== "pass") return false;
  if (!verdict || verdict.result !== "unknown" || verdict.origin !== "abstained" || verdict.evidence.length > 0) return false;
  if (fundingRecordsInGraph(graph).length === 0 || graph.conflicts.includes("funding")) return false;
  const claim = graph.claims.find((x) => x.dimension === "funding");
  if (!claim || claim.current?.status !== "proven") return false;
  if (claim.conflicting.length > 0 || claim.stale.length > 0) return false;
  return ![claim.current, ...claim.supporting].some((i) => i?.status === "disproven");
}
