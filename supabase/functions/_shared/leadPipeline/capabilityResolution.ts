// CAPABILITY RESOLUTION — how each requirement of a mission will be checked, decided
// BEFORE anything is bought (MRLE Phase 0, audit 2026-11-07 RC1).
//
// The audit's central finding: approval bound WHAT WAS SAID (the contract hash) and WHAT
// WOULD BE BOUGHT (the plan hash), but nothing bound WHAT COULD BE ESTABLISHED. A REQUIRED
// business model was listed as a "limitation" and the plan stayed `ready`, so a paid run
// could only ever return `needs_verification` leads (multiProvider S1).
//
// This module answers, per compiled criterion (the same criteria the eligibility engine
// decides on — never a re-reading of the sentence):
//
//   checked      a step of the chosen chain PROVES the dimension the criterion needs
//   ranked_only  a preference: it orders results and never gates (nothing to prove)
//   not_checkable  REQUIRED, and no step proves it — the plan must not run normally
//
// It knows dimensions and capabilities, never words: a new industry, title or place needs
// no change here. Pure.

import type { MissionCriterion } from "../missionCriteria.ts";

/** What a capability can establish about a company (strategy.ts `Provable`, plus verification routes). */
export type ProofDimension =
  | "identity" | "headquarters" | "presence" | "size_band" | "hiring" | "current_employment"
  | "business_model" | "industry" | "funding";

export interface RequirementRoute {
  criterionId: string;
  label: string;
  /** hard = REQUIRED (gates); target / opportunity_signal / hypothesis = preference (ranks). */
  necessity: "required" | "preferred";
  dimension: string;
  /** What must be proven for this criterion to pass or fail. Empty when nothing can. */
  needs: ProofDimension[];
  route: "checked" | "ranked_only" | "not_checkable";
  /** The capabilities in the chain that prove it (ids), when checked. */
  checkedBy: string[];
  /** Plain words for the approval card. */
  explanation: string;
}

/** The proof a criterion needs, by its dimension (the compiler's own vocabulary). */
export function proofNeeded(c: Pick<MissionCriterion, "dimension" | "value"> & { geography_scope?: string; status?: string }): ProofDimension[] {
  // A criterion the compiler itself marked as unprovable or unrepresentable cannot be checked.
  if (c.status && c.status !== "ok") return [];
  switch (c.dimension) {
    case "geography": return [c.geography_scope === "presence" ? "presence" : "headquarters"];
    case "company_size": return ["size_band"];
    case "hiring": return ["hiring"];
    case "business_model": return ["business_model"];
    case "industry": return ["industry"];
    case "funding": case "company_stage": return ["funding"];
    case "known_companies": return ["identity"];
    case "exclusion": {
      const field = (c.value as { field?: string } | null)?.field ?? "";
      if (field === "excluded_geographies") return ["headquarters"];
      if (field === "excluded_company_types") return ["industry"];
      return [];
    }
    default: return []; // other signal kinds, unsupported carriers: no capability proves them today
  }
}

const NEEDS_WORDS: Record<ProofDimension, string> = {
  identity: "company identity", headquarters: "headquarters location", presence: "office / market presence",
  size_band: "company size", hiring: "a dated job posting", current_employment: "current employment",
  business_model: "business model (who the company sells to)", industry: "industry", funding: "funding round and date",
};

/**
 * Route every criterion through the capabilities a chain offers.
 *
 * `proves` maps each proof dimension to the capability ids (in the chain) that establish it.
 * An any-of group (`any_of`) is checkable when ANY member is.
 */
export function resolveRequirementRoutes(
  criteria: readonly MissionCriterion[],
  proves: ReadonlyMap<ProofDimension, readonly string[]>,
): RequirementRoute[] {
  const routes = criteria.map((c): RequirementRoute => {
    const required = c.kind === "hard";
    const needs = proofNeeded(c as never);
    const by = needs.flatMap((d) => [...(proves.get(d) ?? [])]);
    const checkable = needs.length > 0 && needs.every((d) => (proves.get(d)?.length ?? 0) > 0);
    const label = String(c.label ?? c.dimension);
    if (!required) {
      return { criterionId: c.id, label, necessity: "preferred", dimension: String(c.dimension), needs, route: "ranked_only", checkedBy: checkable ? [...new Set(by)] : [],
        explanation: "a preference: it orders the results and never rejects a company" };
    }
    return checkable
      ? { criterionId: c.id, label, necessity: "required", dimension: String(c.dimension), needs, route: "checked", checkedBy: [...new Set(by)],
        explanation: `required; checked by ${[...new Set(by)].join(" + ")}` }
      : { criterionId: c.id, label, necessity: "required", dimension: String(c.dimension), needs, route: "not_checkable", checkedBy: [],
        explanation: needs.length
          ? `required, but no approved tool in this plan can establish ${needs.map((d) => NEEDS_WORDS[d]).join(" or ")}`
          : "required, but no approved tool can check this kind of requirement" };
  });
  // AN ANY-OF GROUP IS ONE REQUIREMENT: met when any member can be checked.
  const groups = new Map<string, RequirementRoute[]>();
  criteria.forEach((c, i) => {
    const g = (c as { any_of?: string[] }).any_of;
    if (Array.isArray(g) && g.length && routes[i].necessity === "required") {
      const k = [...g].sort().join("|");
      groups.set(k, [...(groups.get(k) ?? []), routes[i]]);
    }
  });
  for (const members of groups.values()) {
    if (!members.some((m) => m.route === "checked")) continue;
    for (const m of members) if (m.route === "not_checkable") {
      m.route = "checked";
      m.explanation = "one of several alternatives; the group is met when any alternative is checked";
    }
  }
  return routes;
}

/** The REQUIRED requirements no step can check — what blocks normal execution. */
export const uncheckedRequired = (routes: readonly RequirementRoute[]) => routes.filter((r) => r.route === "not_checkable");

/** The question the approval card asks for each unchecked REQUIRED requirement. */
export function uncheckedQuestion(r: RequirementRoute): string {
  return `Your request requires "${r.label}", but ${r.explanation.replace(/^required, but /, "")}. ` +
    "You can run it as review-only (companies stay \"needs verification\" on this requirement and are never counted as qualified), " +
    "change the request so it is a preference, or cancel.";
}
