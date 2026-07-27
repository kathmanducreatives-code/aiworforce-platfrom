// MISSION-AWARE HIRING-SOURCE PLANNING — which approved channels, in what order.
//
// A plan says WHERE to look. It never says whether a company qualifies: that
// stays with the Company Brain gate (PR #104) and the canonical decision, and a
// strong hiring signal from any source cannot buy past it.
//
// This module owns three things and delegates everything else:
//   * the plan CONTRACT a planner may return
//   * VALIDATION and deterministic repair of that contract
//   * a DETERMINISTIC planner for when Claude is off, unavailable or unsafe
//
// It resolves capabilities through `hiringSourceCatalog`, compiles through
// `actorInputPlanner`, hashes through `planHash`, and reads flags through the
// existing intelligence flag resolver. No second authority for any of those.
//
// ENABLEMENT mirrors `leadPlanningBridge`: the flag AND an explicit workspace
// allow-list, with no wildcard. Flipping one environment variable cannot turn
// this on globally.
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import { isIntelligenceFlagEnabled, type EnvReader } from "./intelligence/intelligenceFlags.ts";
import {
  HIRING_SOURCE_CATALOG, isHiringSourceCapability, resolveHiringSourceActor,
  type HiringSourceCapabilityId,
} from "./hiringSourceCatalog.ts";

export const HIRING_SOURCE_PLAN_VERSION = "dynamic-hiring-source-plan-v1";
export const DYNAMIC_SOURCE_WORKSPACES_ENV = "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES";

// ------------------------------------------------------------ enablement ----

export interface SourcePlanningEnablement {
  enabled: boolean;
  reason: "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed" | "enabled";
}

/**
 * Both conditions required, no wildcard. An empty allow-list enables nobody even
 * with the flag on, so "on for everyone" is not a state this can return.
 */
export function isDynamicSourcePlanningEnabled(workspaceId: string, read?: EnvReader): SourcePlanningEnablement {
  if (!isIntelligenceFlagEnabled("DYNAMIC_HIRING_SOURCE_PLANNING", read)) {
    return { enabled: false, reason: "flag_off" };
  }
  let allow: string[] = [];
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    allow = String(get(DYNAMIC_SOURCE_WORKSPACES_ENV) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    return { enabled: false, reason: "no_workspace_allowlist" };
  }
  if (allow.length === 0) return { enabled: false, reason: "no_workspace_allowlist" };
  if (!allow.includes(String(workspaceId))) return { enabled: false, reason: "workspace_not_allowed" };
  return { enabled: true, reason: "enabled" };
}

// ---------------------------------------------------------- the contract ----

export interface SourcePlanLane {
  capability: HiringSourceCapabilityId;
  priority: number;
  purpose: "discovery" | "cross_check" | "fallback" | "verification";
  candidateTarget: number;
  rationale: string;
}

export interface HiringSourcePlan {
  version: typeof HIRING_SOURCE_PLAN_VERSION;
  lanes: SourcePlanLane[];
  fallbackLanes: SourcePlanLane[];
  verification: { capability: "ats_job_verification"; maximumCompanies: number } | null;
  joinStrategy: "canonical_company_identity";
  stopCondition: "contact_ready_quota_or_valid_exhaustion";
}

export interface SourcePlanMission {
  /** Does the mission actually require CURRENT hiring evidence? */
  hiringSignalRequired: boolean;
  industries: string[];
  companyStages: string[];
  geography: string | null;
  requestedContactReady: number;
  /** Absolute ceiling on discovery lanes for this round. */
  maximumLanes?: number;
}

// ---------------------------------------------------------- deterministic ----

const lane = (
  capability: HiringSourceCapabilityId, priority: number,
  purpose: SourcePlanLane["purpose"], candidateTarget: number, rationale: string,
): SourcePlanLane => ({ capability, priority, purpose, candidateTarget, rationale });

/** Does this mission describe early-stage startups? */
function looksEarlyStage(m: SourcePlanMission): boolean {
  const stages = m.companyStages.map((s) => s.toLowerCase()).join(" ");
  const inds = m.industries.map((s) => s.toLowerCase()).join(" ");
  return /pre-?seed|seed|series a|early/.test(stages)
    || /saas|developer tool|devtool|technology|software/.test(inds);
}

/**
 * The deterministic source strategy.
 *
 * Used whenever Claude is off, unavailable, or produced something unsafe — and
 * as the baseline a Claude plan is measured against. It is mission-DEPENDENT
 * rather than one fixed mix: YC is a precision lane for early-stage technology
 * missions and is simply absent otherwise, because proposing it for a
 * manufacturer or a dental clinic would spend budget on a source that structurally
 * cannot serve them.
 */
export function deterministicSourcePlan(m: SourcePlanMission): HiringSourcePlan {
  // A mission with no hiring requirement gets NO job scrapers at all.
  if (!m.hiringSignalRequired) {
    return {
      version: HIRING_SOURCE_PLAN_VERSION, lanes: [], fallbackLanes: [],
      verification: null, joinStrategy: "canonical_company_identity",
      stopCondition: "contact_ready_quota_or_valid_exhaustion",
    };
  }

  const target = Math.max(20, Math.min(200, m.requestedContactReady * 12));
  const lanes: SourcePlanLane[] = [];

  if (looksEarlyStage(m)) {
    lanes.push(lane("yc_job_discovery", 1, "discovery", Math.round(target * 0.35),
      "Early-stage technology mission: YC is the highest-precision startup channel."));
    lanes.push(lane("indeed_job_discovery", 2, "discovery", Math.round(target * 0.35),
      "Broad role-first discovery beyond the startup ecosystem."));
    lanes.push(lane("linkedin_job_discovery", 3, "cross_check", Math.round(target * 0.30),
      "Company identity and cross-check; strongest LinkedIn company evidence."));
  } else {
    lanes.push(lane("indeed_job_discovery", 1, "discovery", Math.round(target * 0.55),
      "General B2B hiring discovery with the widest coverage."));
    lanes.push(lane("linkedin_job_discovery", 2, "discovery", Math.round(target * 0.45),
      "Professional-company discovery and company identity."));
    // YC is deliberately ABSENT for non-startup missions.
  }

  const maxLanes = m.maximumLanes ?? 3;
  return {
    version: HIRING_SOURCE_PLAN_VERSION,
    lanes: lanes.slice(0, maxLanes),
    fallbackLanes: [lane("glassdoor_job_discovery", 9, "fallback", Math.round(target * 0.4),
      "Recall expansion only when qualified-company volume is insufficient.")],
    verification: { capability: "ats_job_verification", maximumCompanies: Math.max(3, m.requestedContactReady) },
    joinStrategy: "canonical_company_identity",
    stopCondition: "contact_ready_quota_or_valid_exhaustion",
  };
}

// ------------------------------------------------------------ validation ----

export interface SourcePlanViolation { code: string; message: string; severity: "block" | "repair" }

export interface SourcePlanValidation {
  ok: boolean;
  plan: HiringSourcePlan;
  approvedLanes: SourcePlanLane[];
  rejectedLanes: Array<{ lane: SourcePlanLane; reason: string }>;
  repairs: string[];
  violations: SourcePlanViolation[];
}

/**
 * Validate and deterministically repair a proposed plan.
 *
 * Repairs are for things with an obviously correct narrower answer (a target
 * above the capability ceiling). Blocks are for things with no safe
 * interpretation: an unknown or disabled capability, a job scraper on a mission
 * that never asked for hiring evidence, or a plan left with nothing to run.
 */
export function validateSourcePlan(proposed: HiringSourcePlan, m: SourcePlanMission): SourcePlanValidation {
  const approvedLanes: SourcePlanLane[] = [];
  const rejectedLanes: Array<{ lane: SourcePlanLane; reason: string }> = [];
  const repairs: string[] = [];
  const violations: SourcePlanViolation[] = [];
  const seen = new Set<string>();

  for (const l of proposed.lanes ?? []) {
    if (!isHiringSourceCapability(l.capability)) {
      rejectedLanes.push({ lane: l, reason: `unknown_capability:${l.capability}` }); continue;
    }
    const resolved = resolveHiringSourceActor(l.capability);
    if (!resolved.ok) { rejectedLanes.push({ lane: l, reason: resolved.reason }); continue; }

    // A verification-authority source is not a discovery lane.
    const cap = HIRING_SOURCE_CATALOG[l.capability];
    if (cap.operatingPolicy.requiresKnownCompany && l.purpose !== "verification") {
      rejectedLanes.push({ lane: l, reason: "requires_known_company_not_a_discovery_lane" }); continue;
    }
    if (!m.hiringSignalRequired) {
      rejectedLanes.push({ lane: l, reason: "mission_does_not_require_hiring_evidence" }); continue;
    }
    if (seen.has(l.capability)) {
      rejectedLanes.push({ lane: l, reason: "duplicate_lane" });
      repairs.push(`deduplicated_lane:${l.capability}`);
      continue;
    }
    seen.add(l.capability);

    const ceiling = cap.operatingPolicy.maximumResultsPerCall;
    let target = l.candidateTarget;
    if (!Number.isFinite(target) || target <= 0) {
      target = 25; repairs.push(`lane_target_defaulted:${l.capability}->25`);
    } else if (target > ceiling) {
      target = ceiling; repairs.push(`lane_target_capped:${l.capability}:${l.candidateTarget}->${ceiling}`);
    }
    approvedLanes.push({ ...l, candidateTarget: target });
  }

  if (m.hiringSignalRequired && approvedLanes.length === 0) {
    violations.push({
      code: "no_executable_hiring_source",
      message: "The mission requires current hiring evidence but no approved source lane survived validation.",
      severity: "block",
    });
  }

  const plan: HiringSourcePlan = {
    version: HIRING_SOURCE_PLAN_VERSION,
    lanes: approvedLanes.sort((a, b) => a.priority - b.priority),
    fallbackLanes: proposed.fallbackLanes ?? [],
    verification: proposed.verification ?? null,
    joinStrategy: "canonical_company_identity",
    stopCondition: "contact_ready_quota_or_valid_exhaustion",
  };

  return {
    ok: violations.every((v) => v.severity !== "block"),
    plan, approvedLanes, rejectedLanes, repairs, violations,
  };
}

/** Deterministic hash over the EXECUTABLE plan. */
export async function sourcePlanHash(plan: HiringSourcePlan): Promise<string> {
  return await sha256Hex(canonicalJson({
    version: plan.version,
    lanes: plan.lanes.map((l) => ({ c: l.capability, p: l.priority, t: l.candidateTarget, u: l.purpose })),
    fallback: plan.fallbackLanes.map((l) => l.capability),
    verification: plan.verification?.capability ?? null,
    join: plan.joinStrategy,
  }));
}
