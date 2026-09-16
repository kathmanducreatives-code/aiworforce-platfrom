// LEAD V2 P2 — WHAT EACH CRITERION IS ALLOWED TO DO IN EXECUTION.
//
// P1 made meaning explicit: every mission states which criteria are hard,
// which are targets, which are opportunity signals and which are hypotheses.
// Execution still read the older carriers, so a Company Brain size band became
// memo23's `maxEmployeeSize` filter and a Brain-filled location made geography
// a "mission-owned" rejecting axis — while the confirmation card said both were
// preferences. The card promised one behaviour and the run did another.
//
// This module is the single answer execution consults:
//
//   hard               → may filter retrieval and may reject a company
//   target             → may guide retrieval and ranking; never filters, never rejects
//   opportunity_signal → evidence and ranking only
//   hypothesis         → research thesis only
//
// A criterion is HARD for execution only when its kind is `hard` AND its source
// is the user's own words or a Company Brain POLICY rule. A Brain preference or
// a model inference is never hard here, whatever a legacy carrier says.
//
// Pure. No network, no model, no database.

import type { LeadMissionV1 } from "./leadMission.ts";
import { deriveMissionCriteria, type MissionCriterion } from "./missionCriteria.ts";

export const CRITERIA_EXECUTION_POLICY_VERSION = "criteria-execution-policy-v1" as const;

export type ExecutionDimension =
  | "geography" | "industry" | "company_size" | "company_stage" | "company_kind" | "exclusion";

export interface DimensionAuthority {
  dimension: ExecutionDimension;
  /** Values of hard criteria that may filter and reject. */
  hard_values: unknown[];
  /** Values of target/preference criteria: guidance and ranking only. */
  target_values: unknown[];
  may_filter: boolean;
  may_reject: boolean;
  /** Where the hard values came from. */
  hard_sources: string[];
}

export interface CriteriaExecutionPolicy {
  version: typeof CRITERIA_EXECUTION_POLICY_VERSION;
  dimensions: Record<ExecutionDimension, DimensionAuthority>;
  opportunity_signals: string[];
  hypotheses: string[];
}

/** Funding-round stages a provider stage filter may express. */
const ROUND_STAGES = new Set(["pre-seed", "seed", "series_a", "series_b", "series_c", "series_d", "series_e"]);

const HARD_SOURCES = new Set(["user_explicit", "company_brain_policy"]);

function dimensionOf(c: MissionCriterion): ExecutionDimension | null {
  switch (c.dimension) {
    case "geography": return "geography";
    case "industry":
    case "business_model": return "industry";
    case "company_size": return "company_size";
    case "exclusion": return "exclusion";
    case "company_stage":
      return ROUND_STAGES.has(String(c.value)) || String(c.value) === "early_stage"
        ? "company_stage" : "company_kind";
    default: return null;
  }
}

export function criteriaExecutionPolicy(mission: LeadMissionV1): CriteriaExecutionPolicy {
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  const dims = {} as Record<ExecutionDimension, DimensionAuthority>;
  for (const d of ["geography", "industry", "company_size", "company_stage", "company_kind", "exclusion"] as const) {
    dims[d] = { dimension: d, hard_values: [], target_values: [], may_filter: false, may_reject: false, hard_sources: [] };
  }
  const policy: CriteriaExecutionPolicy = {
    version: CRITERIA_EXECUTION_POLICY_VERSION, dimensions: dims, opportunity_signals: [], hypotheses: [],
  };
  for (const c of criteria) {
    if (c.status === "unrecognised" || c.status === "unrepresentable") continue;
    if (c.kind === "hypothesis") { policy.hypotheses.push(c.label); continue; }
    if (c.kind === "opportunity_signal") { policy.opportunity_signals.push(c.label); continue; }
    const dim = dimensionOf(c);
    if (!dim) continue;
    const a = dims[dim];
    if (c.kind === "hard" && HARD_SOURCES.has(c.source)) {
      a.hard_values.push(c.value);
      if (!a.hard_sources.includes(c.source)) a.hard_sources.push(c.source);
      a.may_filter = true;
      a.may_reject = true;
    } else {
      a.target_values.push(c.value);
    }
  }
  return policy;
}

export const mayFilter = (p: CriteriaExecutionPolicy, d: ExecutionDimension) => p.dimensions[d].may_filter;
export const mayReject = (p: CriteriaExecutionPolicy, d: ExecutionDimension) => p.dimensions[d].may_reject;

/** Hard geography values as plain strings. */
export function hardLocations(p: CriteriaExecutionPolicy): string[] {
  return p.dimensions.geography.hard_values.map(String).filter(Boolean);
}

/** Hard size bound, when one exists. */
export function hardSizeBound(p: CriteriaExecutionPolicy): { min: number | null; max: number | null } | null {
  const v = p.dimensions.company_size.hard_values[0] as { min?: number | null; max?: number | null } | undefined;
  return v ? { min: v.min ?? null, max: v.max ?? null } : null;
}

/**
 * The axes a mission may REJECT on, for qualification.
 *
 * Replaces "the field is non-empty" as the test. A location the Company Brain
 * filled is not an axis the user decided, so it ranks and never rejects.
 */
export function rejectingAxes(p: CriteriaExecutionPolicy): {
  employee_count: boolean; industry: boolean; geography: boolean; stage: boolean;
} {
  return {
    employee_count: p.dimensions.company_size.may_reject,
    industry: p.dimensions.industry.may_reject,
    geography: p.dimensions.geography.may_reject,
    stage: p.dimensions.company_stage.may_reject || p.dimensions.company_kind.may_reject,
  };
}

/**
 * The mission's hard constraints that a HARD criterion backs. The rest move out
 * of evaluation's rejecting set: a Brain-filled location or a model-inferred
 * constraint may rank, never reject.
 */
export function hardConstraintsBackedByCriteria(
  mission: LeadMissionV1, hard: Record<string, unknown>,
): Record<string, unknown> {
  const policy = criteriaExecutionPolicy(mission);
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hard ?? {})) {
    if (key === "company_profile.locations" || key === "geography" || key === "location") {
      if (policy.dimensions.geography.may_reject) out[key] = value;
      continue;
    }
    if (key === "stage") {
      if (policy.dimensions.company_stage.may_reject) out[key] = value;
      continue;
    }
    const backed = criteria.some((c) => c.kind === "hard" && (c.source === "user_explicit" || c.source === "company_brain_policy") &&
      (c.dimension === "constraint" || c.dimension === "exclusion") &&
      (c.value as { field?: string } | null)?.field === key);
    if (backed) out[key] = value;
  }
  return out;
}
