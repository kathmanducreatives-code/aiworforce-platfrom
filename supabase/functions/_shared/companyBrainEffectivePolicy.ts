// THE EFFECTIVE QUALIFICATION POLICY = Company Brain AND mission.
//
// Two things decide whether a company belongs in a sourcing run, and they are
// not equals. The Company Brain says who this workspace can sell to at all. The
// mission says which slice of that the user wants right now.
//
// So the merge is INTERSECTION, and it is one-directional: a mission may narrow
// a hard Brain constraint, never widen it. "Find me SaaS companies hiring Sales
// Ops" cannot quietly raise a 200-employee ceiling, because the user asking for
// a role is not the user changing who they sell to. Widening is surfaced as a
// requested approval instead of being applied.
//
// This module produces the constraint object the gate consumes plus the
// provenance needed to explain a decision afterwards: which Brain version, which
// size mapping, which constraints were hard, and a deterministic hash of the
// whole thing.
//
// It deliberately does NOT re-implement matching. `companyIcpFilter` owns the
// tables and the tri-state evaluation; this owns only what the constraints ARE.
//
// PURE. No network, database, provider or model access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import { resolveCompanySizeBounds, SIZE_REGISTRY_VERSION, type ResolvedSizeBounds } from "./companyBrainSizeRegistry.ts";
import type { CompanyBrainHardConstraints, UnknownEvidencePolicy } from "./companyIcpFilter.ts";

export const EFFECTIVE_POLICY_VERSION = "company-brain-effective-policy-1.0.0";

/** The Brain slice this compiler reads. Loose so it works on the wire shape. */
export interface BrainPolicyInput {
  industries?: string[];
  categories?: string[];
  business_models?: string[];
  company_size_min?: number | null;
  company_size_max?: number | null;
  maturity_stage?: string[];
  target_customer_segments?: string[];
  disqualifier_industries?: string[];
  disqualifier_company_types?: string[];
  disqualifier_keywords?: string[];
  require_founder_led?: boolean;
  unknown_evidence?: UnknownEvidencePolicy;
  /** Brain version or updated_at, for provenance. Never content. */
  brainVersion?: string | null;
}

/** The mission slice that may NARROW the policy. */
export interface MissionPolicyInput {
  industries?: string[];
  maxEmployees?: number | null;
  minEmployees?: number | null;
  allowedStages?: string[];
}

export type BroadeningKind =
  | "industry" | "business_model" | "company_stage" | "employee_range" | "founder_led";

export interface PolicyProvenance {
  policy_version: string;
  brain_version: string | null;
  size: {
    min: number | null;
    max: number | null;
    source: ResolvedSizeBounds["source"];
    mapping_id: string | null;
    mapping_version: string;
    confirmation_required: boolean;
  };
  hard_constraints: string[];
  unknown_evidence: UnknownEvidencePolicy;
  /** Mission requests that would have WIDENED the Brain. Not applied. */
  rejected_broadening: Array<{ kind: BroadeningKind; reason: string }>;
}

export interface EffectiveCompanyPolicy {
  constraints: CompanyBrainHardConstraints;
  provenance: PolicyProvenance;
  /** Deterministic over constraints + provenance-affecting inputs. */
  policyHash: string;
}

function clean(xs: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((xs ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean))].sort();
}

/**
 * Compile the effective policy.
 *
 * SIZE PRECEDENCE: an explicit numeric Brain range wins outright; otherwise the
 * reviewed semantic registry interprets the segment phrasing; otherwise the
 * range is unresolved and no size gate is imposed (rather than a guessed one).
 */
export async function compileEffectiveCompanyPolicy(
  brain: BrainPolicyInput,
  mission: MissionPolicyInput = {},
): Promise<EffectiveCompanyPolicy> {
  const rejected_broadening: PolicyProvenance["rejected_broadening"] = [];

  // ---- SIZE ---------------------------------------------------------------
  let size: ResolvedSizeBounds;
  if (brain.company_size_min != null || brain.company_size_max != null) {
    size = {
      min: brain.company_size_min ?? null, max: brain.company_size_max ?? null,
      source: "explicit_numeric", mappingId: null, mappingVersion: SIZE_REGISTRY_VERSION,
      confirmationRequired: false, enterprise: false,
    };
  } else {
    // The segment phrasing carries the meaning ("small teams / early-stage").
    //
    // Each segment is resolved INDIVIDUALLY and the first reviewed match wins.
    // Joining them into one blob first would let unrelated prose in a later
    // field bleed into the size decision — a Brain field is user-authored text,
    // not a trusted expression.
    size = { min: null, max: null, source: "unresolved", mappingId: null,
             mappingVersion: SIZE_REGISTRY_VERSION, confirmationRequired: false, enterprise: false };
    for (const segment of [...(brain.target_customer_segments ?? []), ...(brain.maturity_stage ?? [])]) {
      const r = resolveCompanySizeBounds(segment);
      if (r.source !== "unresolved") { size = r; break; }
    }
  }

  // A mission may TIGHTEN the range only.
  let min = size.min, max = size.max;
  if (mission.maxEmployees != null) {
    if (max == null || mission.maxEmployees <= max) max = mission.maxEmployees;
    else rejected_broadening.push({ kind: "employee_range", reason: `mission max ${mission.maxEmployees} exceeds Brain max ${max}` });
  }
  if (mission.minEmployees != null) {
    if (min == null || mission.minEmployees >= min) min = mission.minEmployees;
    else rejected_broadening.push({ kind: "employee_range", reason: `mission min ${mission.minEmployees} is below Brain min ${min}` });
  }

  // ---- INDUSTRY -----------------------------------------------------------
  const brainIndustries = clean([...(brain.industries ?? []), ...(brain.categories ?? [])]);
  const missionIndustries = clean(mission.industries);
  let positive_industries = brainIndustries;
  if (missionIndustries.length) {
    if (!brainIndustries.length) {
      positive_industries = missionIndustries;                // Brain unconstrained: mission defines it.
    } else {
      const narrowed = missionIndustries.filter((m) => brainIndustries.some((b) => b.includes(m) || m.includes(b)));
      const widened = missionIndustries.filter((m) => !brainIndustries.some((b) => b.includes(m) || m.includes(b)));
      if (widened.length) rejected_broadening.push({ kind: "industry", reason: `mission industries outside the Brain: ${widened.join(", ")}` });
      if (narrowed.length) positive_industries = narrowed;    // intersection only
    }
  }

  // ---- STAGE --------------------------------------------------------------
  const brainStages = clean(brain.maturity_stage);
  const missionStages = clean(mission.allowedStages);
  let allowed_stages = brainStages;
  if (missionStages.length) {
    if (!brainStages.length) allowed_stages = missionStages;
    else {
      const narrowed = missionStages.filter((m) => brainStages.includes(m));
      const widened = missionStages.filter((m) => !brainStages.includes(m));
      if (widened.length) rejected_broadening.push({ kind: "company_stage", reason: `mission stages outside the Brain: ${widened.join(", ")}` });
      if (narrowed.length) allowed_stages = narrowed;
    }
  }

  const constraints: CompanyBrainHardConstraints = {
    positive_industries,
    negative_industries: clean(brain.disqualifier_industries),
    excluded_company_types: clean(brain.disqualifier_company_types),
    disqualifiers: clean(brain.disqualifier_keywords),
    business_models: clean(brain.business_models),
    allowed_stages,
    min_employees: min, max_employees: max,
    allow_enterprise: false,
    require_founder_led: brain.require_founder_led === true,
    unknown_evidence: brain.unknown_evidence ?? "research",
    strict_industry: positive_industries.length > 0,
  };

  const hard_constraints = [
    ...(constraints.max_employees != null || constraints.min_employees != null ? ["employee_count"] : []),
    ...(positive_industries.length ? ["industry"] : []),
    ...((constraints.business_models ?? []).length ? ["business_model"] : []),
    ...(allowed_stages.length ? ["company_stage"] : []),
    ...(constraints.require_founder_led ? ["founder_led"] : []),
  ];

  const provenance: PolicyProvenance = {
    policy_version: EFFECTIVE_POLICY_VERSION,
    brain_version: brain.brainVersion ?? null,
    size: {
      min, max, source: size.source, mapping_id: size.mappingId,
      mapping_version: size.mappingVersion, confirmation_required: size.confirmationRequired,
    },
    hard_constraints,
    unknown_evidence: constraints.unknown_evidence ?? "research",
    rejected_broadening,
  };

  // The hash covers the EXECUTABLE constraints and the policy identity — not the
  // Brain's prose. Equivalent inputs hash identically; changing any hard number
  // moves it.
  const policyHash = await sha256Hex(canonicalJson({
    v: EFFECTIVE_POLICY_VERSION,
    sizeRegistry: SIZE_REGISTRY_VERSION,
    constraints,
  }));

  return { constraints, provenance, policyHash };
}
