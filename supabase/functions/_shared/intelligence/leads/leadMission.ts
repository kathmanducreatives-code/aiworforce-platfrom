// THE LEAD MISSION — the Phase 1 mission envelope, specialised for Leads.
//
// This ADAPTS existing structures; it does not re-derive them. The deterministic
// intent compiler (`resolveJobIntent`) and the qualified-lead contract stay the
// source of truth for what the request means. This module's job is to arrange that
// meaning into the shape a planner may see, with the provenance intact.
//
// THE INVARIANT THAT MATTERS: `hiring_role` and `decision_maker` are INDEPENDENT.
// The whole Phase 0 defect was that "Find founders of SaaS startups hiring Sales
// Operations" read `founders` — the person to CONTACT — as the seniority of the JOB.
// They are carried in separate objects here, populated from separate clauses, and
// nothing in this file copies a value from one into the other.
//
// PURE. No network, no database, no environment reads, no provider calls.

import { resolveJobIntent, type ResolvedJobIntent } from "../../jobFamilyRegistry.ts";
import { extractRequestedLeadCount } from "../../qualifiedLeadRouting.ts";
import { buildMission, type AgentoryMission, type MissionGeographyContext, type AgentoryEnvironmentMode } from "../mission.ts";
import { emptyMissionContext, type MissionContext } from "../missionContext.ts";
import { buildLeadGeographyContext } from "./leadGeography.ts";

export type LeadTargetEntity = "account" | "company_and_person" | "contact_ready_lead";
export type LeadCountEntity = "account" | "contact_ready_lead";
export type LeadQuotaPolicy = "account" | "contact_only" | "contact_and_watch";

export interface LeadSourcingMission extends AgentoryMission {
  department: "leads";

  target_entity: LeadTargetEntity;

  signal: {
    types: string[];
    required: boolean;
    recency_days?: number;
  };

  /** The role BEING HIRED. Never carries decision-maker seniority. */
  hiring_role: {
    raw_text: string;
    function?: string;
    department?: string;
    seniority: string[];
    team_stage?: string;
    /** Titles the user typed themselves. Highest authority. */
    explicit_titles: string[];
    /** Titles the deterministic registry resolved. */
    resolved_titles: string[];
    canonical_family?: string;
    industry_context: string[];
  };

  /** The person to CONTACT. Never carries hiring-role seniority. */
  decision_maker: {
    roles: string[];
    seniority: string[];
    current_employer_required: boolean;
  };

  company_target: {
    verticals: string[];
    company_types: string[];
    employee_range?: { min?: number; max?: number };
    company_stages: string[];
    geography: MissionGeographyContext;
  };

  output: {
    requested_count: number;
    count_entity: LeadCountEntity;
    quota_policy: LeadQuotaPolicy;
  };
}

export const DEFAULT_REQUESTED_LEAD_COUNT = 5;

export interface BuildLeadMissionInput {
  missionId: string;
  workspaceId: string;
  /** The user's instruction, verbatim. Never edited here. */
  originalInstruction: string;
  context?: MissionContext | null;
  environmentMode: AgentoryEnvironmentMode;
  /** Overrides from explicit workflow configuration (authority #2). */
  workflow?: {
    target_entity?: LeadTargetEntity;
    count_entity?: LeadCountEntity;
    quota_policy?: LeadQuotaPolicy;
    requested_count?: number;
    signal_types?: string[];
    signal_required?: boolean;
    recency_days?: number;
  } | null;
  budget?: { maximum_calls?: number; maximum_estimated_cost_usd?: number; maximum_rounds?: number } | null;
  /** Titles the user typed verbatim, if the caller extracted any. */
  explicitTitles?: string[] | null;
}

/**
 * Build a Lead mission.
 *
 * Authority is applied in the Phase 1 order: explicit workflow configuration may
 * override a derived default, but nothing overrides `original_instruction`, and
 * the requested count comes from the user's own sentence before any default.
 */
export function buildLeadMission(input: BuildLeadMissionInput): LeadSourcingMission {
  const instruction = input.originalInstruction;
  const intent: ResolvedJobIntent = resolveJobIntent(instruction);
  const context = input.context ?? emptyMissionContext(input.workspaceId);
  const geography = buildLeadGeographyContext(instruction);

  // The count the USER asked for outranks any workflow default.
  const requestedCount =
    extractRequestedLeadCount(instruction)
    ?? input.workflow?.requested_count
    ?? DEFAULT_REQUESTED_LEAD_COUNT;

  const base = buildMission({
    missionId: input.missionId,
    department: "leads",
    workspaceId: input.workspaceId,
    originalInstruction: instruction,
    companyBrain: context.company_brain,
    icp: context.icp,
    geography,
    // The parser's reading, carried where a planner can SEE it but not mistake it
    // for the user's words.
    parserContext: {
      hiring_role: intent.hiring_role,
      decision_maker: intent.decision_maker,
      vertical: intent.vertical,
      geography: intent.geography,
      family_key: intent.family_key,
      family_label: intent.family_label,
      resolved_titles: intent.titles,
      excluded_titles: intent.excluded_titles,
    },
    requestedOutcome: {
      requested_count: requestedCount,
      count_entity: input.workflow?.count_entity ?? "contact_ready_lead",
      quota_policy: input.workflow?.quota_policy ?? "contact_only",
    },
    hardConstraints: {
      geography: geography.explicit_raw_locations,
      requested_count: requestedCount,
      count_entity: input.workflow?.count_entity ?? "contact_ready_lead",
      quota_policy: input.workflow?.quota_policy ?? "contact_only",
      decision_maker_roles: intent.decision_maker.roles,
      current_employer_required: intent.decision_maker.currentEmployerRequired,
      excluded_titles: intent.excluded_titles,
    },
    softConstraints: {
      vertical: intent.vertical,
      company_stages: context.icp.company_stages,
      industries: context.icp.industries,
    },
    approvalPolicy: {
      autonomously_allowed: ["exact_synonym", "same_language_safe_synonym", "local_language_equivalent", "search_order_change"],
      approval_required: ["geography_expansion", "adjacent_job_function", "seniority_change", "requested_count_change"],
    },
    budget: {
      maximum_calls: input.budget?.maximum_calls ?? 12,
      maximum_estimated_cost_usd: input.budget?.maximum_estimated_cost_usd ?? 5,
      maximum_rounds: input.budget?.maximum_rounds ?? 3,
    },
    environmentMode: input.environmentMode,
  });

  return {
    ...base,
    department: "leads",
    target_entity: input.workflow?.target_entity ?? "company_and_person",

    signal: {
      types: input.workflow?.signal_types ?? ["hiring"],
      required: input.workflow?.signal_required ?? true,
      ...(input.workflow?.recency_days !== undefined ? { recency_days: input.workflow.recency_days } : {}),
    },

    // ---- the role being hired. Reads ONLY from the hiring clause. ----
    hiring_role: {
      raw_text: intent.hiring_role.rawText,
      ...(intent.hiring_role.function ? { function: intent.hiring_role.function } : {}),
      ...(intent.hiring_role.department ? { department: intent.hiring_role.department } : {}),
      seniority: [...intent.hiring_role.seniority],
      ...(intent.hiring_role.teamStage ? { team_stage: intent.hiring_role.teamStage } : {}),
      explicit_titles: [...(input.explicitTitles ?? [])],
      resolved_titles: [...intent.titles],
      ...(intent.family_key ? { canonical_family: intent.family_key } : {}),
      industry_context: [...context.icp.industries],
    },

    // ---- the person to contact. Reads ONLY from the person clause. ----
    decision_maker: {
      roles: [...intent.decision_maker.roles],
      seniority: [...intent.decision_maker.seniority],
      current_employer_required: intent.decision_maker.currentEmployerRequired,
    },

    company_target: {
      verticals: intent.vertical ? [intent.vertical] : [...context.icp.company_verticals],
      company_types: [...context.icp.company_types],
      ...(context.icp.employee_range ? { employee_range: context.icp.employee_range } : {}),
      company_stages: [...context.icp.company_stages],
      geography,
    },

    output: {
      requested_count: requestedCount,
      count_entity: input.workflow?.count_entity ?? "contact_ready_lead",
      quota_policy: input.workflow?.quota_policy ?? "contact_only",
    },
  };
}

/**
 * The titles a planner may execute WITHOUT approval, from the mission alone.
 *
 * Explicit user titles first (their own words), then the registry's resolved
 * titles. This is the deterministic baseline a Claude strategy is measured against
 * and the set the fallback uses.
 */
export function missionBaselineTitles(mission: LeadSourcingMission): string[] {
  const out: string[] = [];
  for (const t of [...mission.hiring_role.explicit_titles, ...mission.hiring_role.resolved_titles]) {
    const s = String(t ?? "").trim();
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}
