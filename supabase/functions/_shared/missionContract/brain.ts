// COMPANY BRAIN → MISSION CONTRACT, with an explicit authority model.
//
// The Brain supplies context; it never silently changes what the user asked for. Before
// approval, each Brain value either becomes a contract requirement with a Brain origin
// (shown on the card, part of the approved hash), or is reported as not applied. Nothing
// Brain-derived is added after approval.
//
// PRECEDENCE (strongest first):
//   1. The user's request (user_explicit / user_inferred). Always wins.
//   2. An approved organization POLICY (`company_brain_policy`): today the Brain's enforced
//      numeric size rule (`employee_policy`). Hard — but only for a dimension the user left
//      open. When the user stated that dimension, the policy is NOT applied and the conflict
//      is reported (the newer, explicit instruction outranks stored memory).
//   3. A Brain PREFERENCE (`company_brain_preference`): ICP industries, stages, locations.
//      Fills only a dimension the user left open, and only as `preferred` — it ranks, it can
//      never reject a candidate.
//      The workspace's industry exclusions are policy too: an EXPLICIT one that conflicts
//      with what the request asks for blocks approval as a question (neither side wins
//      silently); a GENERIC, inferred one yields to the request, as at run time.
//   4. Historical context (outreach history, previously contacted companies): NOT a
//      requirement. Out of scope here; it may rank or deduplicate results, never gate them.
//   5. System defaults (`system_default`): named policies, listed as assumptions.
//
// Same semantics as the v1 merge (`mergeCompanyBrainIntoMission` + lead-pipeline
// `compileWithBrain`): Brain fill-ins are targets; the size policy is hard unless the user
// stated a size. Pure.

import type { BrainMergeInput } from "../leadMission.ts";
import { namesSameCategory } from "../industryPrecedence.ts";

/**
 * The Brain input a contract reads: the v1 merge input, plus the workspace's industry
 * exclusions. `explicit` exclusions are the workspace's own rule; `generic` ones (agencies,
 * staffing…) yield to an industry the request itself asks for — the run-time rule
 * (`resolveIndustryExclusions`), applied here, before approval, against the contract.
 */
export type ContractBrainInput = BrainMergeInput & {
  excluded_industries_explicit?: string[];
  excluded_industries_generic?: string[];
};
import { assumptionsOf, type MissionContract, type Requirement } from "./contract.ts";

export const BRAIN_SIZE_POLICY = "company_brain_size_rule" as const;

export interface ContractBrainReport {
  status: "applied" | "nothing_to_apply" | "absent";
  /** Requirements the Brain added, with their authority. */
  applied: { requirementId: string; authority: "policy" | "preference"; dimension: string }[];
  /** Brain values deliberately not applied, and why (the user's words outrank them). */
  notApplied: { dimension: string; values: string[]; authority: "policy" | "preference"; reason: string }[];
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const fromUser = (r: Requirement) => r.origin.source === "user_explicit" || r.origin.source === "user_inferred";

/**
 * The contract with the Brain applied, and the report the card shows. A contract that
 * already carries Brain requirements is returned unchanged (never applied twice).
 */
export function applyCompanyBrain(contract: MissionContract, brain: ContractBrainInput | null): { contract: MissionContract; report: ContractBrainReport } {
  if (!brain) return { contract, report: { status: "absent", applied: [], notApplied: [] } };
  if (contract.requirements.some((r) => r.origin.source === "company_brain_policy" || r.origin.source === "company_brain_preference")) {
    return { contract, report: { status: "nothing_to_apply", applied: [], notApplied: [] } };
  }
  const reqs = [...contract.requirements];
  const report: ContractBrainReport = { status: "nothing_to_apply", applied: [], notApplied: [] };
  const userStates = (pred: (r: Requirement) => boolean) => contract.requirements.some((r) => fromUser(r) && pred(r));
  const ids = new Set(reqs.map((r) => r.id));
  const add = (r: Requirement, authority: "policy" | "preference") => {
    if (ids.has(r.id)) return;
    ids.add(r.id);
    reqs.push(r);
    report.applied.push({ requirementId: r.id, authority, dimension: r.dimension });
  };
  const base = (id: string, necessity: "required" | "preferred", source: "company_brain_policy" | "company_brain_preference", policy: string | null, label: string, rationale: string) => ({
    id, necessity, evaluability: "ok" as const, alternatives: null,
    origin: { source, span: "", policy },
    display: { label, rationale },
  });

  // 2. Policy: the enforced size rule.
  if (brain.employee_policy && (brain.employee_min != null || brain.employee_max != null)) {
    const min = brain.employee_min ?? null, max = brain.employee_max ?? null;
    const range = `${min ?? ""}–${max ?? ""}`;
    if (userStates((r) => r.dimension === "company_size")) {
      report.notApplied.push({ dimension: "company_size", values: [range], authority: "policy", reason: "the request states its own size, which outranks the Company Brain's size rule" });
    } else if (min !== null && max !== null && min > max) {
      report.notApplied.push({ dimension: "company_size", values: [range], authority: "policy", reason: "the Company Brain's size rule is contradictory (min above max)" });
    } else {
      add({ ...base("brain:company_size", "required", "company_brain_policy", BRAIN_SIZE_POLICY, `Company size: ${range} employees (workspace rule)`,
        "your Company Brain's size rule, applied because the request states no size"), dimension: "company_size", min, max }, "policy");
    }
  }
  // 3. Preferences: fill only what the user left open, never required.
  const prefer = (dimension: "geography" | "industry" | "company_stage", values: readonly string[] | undefined, closed: boolean, make: (v: string) => Requirement) => {
    const vs = [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
    if (!vs.length) return;
    if (closed) {
      report.notApplied.push({ dimension, values: vs, authority: "preference", reason: "the request already states this; the Company Brain does not add to or narrow it" });
      return;
    }
    for (const v of vs) add(make(v), "preference");
  };
  prefer("geography", brain.locations, userStates((r) => r.dimension === "geography" && r.polarity === "include"), (v) => ({
    ...base(`brain:geography:${slug(v)}`, "preferred", "company_brain_preference", null, `Geography preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "geography", polarity: "include", place: v, scope: null,
  }));
  prefer("industry", brain.industries, userStates((r) => r.dimension === "industry" && r.facet === "industry" && r.polarity === "include"), (v) => ({
    ...base(`brain:industry:${slug(v)}`, "preferred", "company_brain_preference", null, `Industry preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "industry", facet: "industry", polarity: "include", value: v,
  }));
  prefer("company_stage", brain.stages, userStates((r) => r.dimension === "company_stage"), (v) => ({
    ...base(`brain:company_stage:${slug(v)}`, "preferred", "company_brain_preference", null, `Stage preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "company_stage", stage: v,
  }));

  // 2b. Policy: the workspace's industry exclusions (hard, attributed, visible).
  const asked = contract.requirements.filter((r): r is Extract<Requirement, { dimension: "industry" }> =>
    r.dimension === "industry" && r.polarity === "include" && fromUser(r)).map((r) => r.value);
  const conflicts: MissionContract["ambiguities"] = [];
  const exclude = (values: readonly string[] | undefined, generic: boolean) => {
    for (const v of [...new Set((values ?? []).map((x) => x.trim()).filter(Boolean))]) {
      const claimed = asked.find((a) => namesSameCategory(v, a) || a.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(a.toLowerCase()));
      if (claimed && generic) {
        // A generic, inferred exclusion yields to the request (the run-time rule).
        report.notApplied.push({ dimension: "exclusion", values: [v], authority: "policy",
          reason: `the request asks for "${claimed}", which outranks the Company Brain's generic exclusion` });
        continue;
      }
      if (claimed) {
        // The workspace's OWN rule against what the request asks for: neither wins
        // silently. Approval is blocked until the user decides.
        conflicts.push({ span: claimed, question: `Your Company Brain excludes "${v}", but this request asks for "${claimed}". Should this search include them anyway?` });
        report.notApplied.push({ dimension: "exclusion", values: [v], authority: "policy",
          reason: `conflicts with the request ("${claimed}"); approval needs your decision` });
        continue;
      }
      add({ ...base(`brain:exclusion:industry:${slug(v)}`, "required", "company_brain_policy", generic ? "company_brain_generic_exclusion" : "company_brain_excluded_industry",
        `Excluding: ${v} (workspace rule)`, "your Company Brain excludes this industry"), dimension: "exclusion", field: "excluded_company_types", values: [v] }, "policy");
    }
  };
  exclude(brain.excluded_industries_explicit, false);
  exclude(brain.excluded_industries_generic, true);

  if (report.applied.length || report.notApplied.length) report.status = "applied";
  return { contract: { ...contract, requirements: reqs, assumptions: assumptionsOf(reqs), ambiguities: [...contract.ambiguities, ...conflicts] }, report };
}
