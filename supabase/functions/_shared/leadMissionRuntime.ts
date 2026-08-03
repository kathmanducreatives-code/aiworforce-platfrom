// THE MISSION AT RUNTIME — reading it, mapping it, and containing what runs.
//
// `leadMission` owns the schema and `leadCapabilityGraph` owns what may execute.
// This module is the thin bridge run-agent uses: find a persisted mission on a
// task, express it in the terms the existing executor already speaks, and turn
// the graph into hard refusals at the provider boundary.
//
// It deliberately holds NO interpretation of its own. If it ever needs to read
// the user's sentence, something upstream failed to persist a mission and the
// compatibility path — not this file — is what should handle it.
//
// PURE. No network, provider, model or database access.

import {
  isLeadMissionV1, type LeadMissionV1,
} from "./leadMission.ts";
import {
  BROAD_JOB_PROVIDERS, CapabilityContainmentError, assertProviderAllowed,
  type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import type { FallbackReason, HiringRoute } from "./hiringRouteContract.ts";

/**
 * Find a persisted mission on whatever the caller was given.
 *
 * Checked in authority order: an explicit body field, then the plan step's
 * `tool_input`, then a nested `lead_mission` inside a qualified-lead plan
 * artifact. Anything that fails the structural guard is treated as absent, so a
 * malformed mission falls back to compatibility rather than half-executing.
 */
export function readPersistedLeadMission(
  toolInput: unknown, bodyMission?: unknown,
): LeadMissionV1 | null {
  const candidates: unknown[] = [bodyMission];
  if (toolInput && typeof toolInput === "object") {
    const ti = toolInput as Record<string, unknown>;
    candidates.push(ti.lead_mission);
    const qlp = ti.qualified_lead_plan;
    if (qlp && typeof qlp === "object") {
      candidates.push((qlp as Record<string, unknown>).lead_mission);
    }
  }
  for (const c of candidates) if (isLeadMissionV1(c)) return c;
  return null;
}

export interface MissionRouteRequest {
  route: HiringRoute;
  fallback_reason: FallbackReason | null;
}

/**
 * Express a mission in the legacy route vocabulary.
 *
 * This is a TRANSLATION, not a second decision: every branch reads a field the
 * mission already settled. A job-output mission is the one case that legitimately
 * reaches the broad-job route, and it carries the structured reason the contract
 * requires — `user_requested_broad_coverage` — because the user did in fact ask
 * for job listings.
 */
export function missionRouteRequest(m: LeadMissionV1): MissionRouteRequest {
  if (m.requested_output === "job_listings") {
    return { route: "broad_job_fallback", fallback_reason: "user_requested_broad_coverage" };
  }
  const startup = m.company_profile.stages.some((s) => /startup|seed|series a|early/i.test(s));
  return {
    route: startup ? "startup_company_first" : "general_company_first",
    fallback_reason: null,
  };
}

/**
 * Is the route-blind legacy sourcing loop reachable for this task?
 *
 * For a mission task the answer is NO unless the mission's own graph contains
 * `job_discovery`. The legacy loop's hardwired source is a broad job board, and
 * a mission that never asked for job listings has no business paying for one —
 * regardless of how little the approved capabilities returned.
 */
export function legacyLoopReachable(
  mission: LeadMissionV1 | null, plan: CapabilityPlan | null,
): { reachable: boolean; reason: string } {
  if (!mission || !plan) {
    return { reachable: true, reason: "legacy_task_without_mission" };
  }
  const hasJobDiscovery = plan.steps.some((s) => s.capability === "job_discovery");
  return hasJobDiscovery
    ? { reachable: true, reason: "job_discovery_is_an_allowed_capability" }
    : {
      reachable: false,
      reason: `mission_graph_excludes_job_discovery:${plan.entry_capability}`,
    };
}

/**
 * Wrap a provider invoker so an out-of-graph Actor cannot run.
 *
 * The guard THROWS. A logged warning is what the previous design had, and it was
 * present and correct on the run that still spent money on the wrong Actors.
 */
export function guardedInvoker<T extends { actorKey?: string; selected_actor_key?: string }>(
  plan: CapabilityPlan | null,
  invoke: (call: T) => Promise<Record<string, unknown>[]>,
  onBlocked?: (actorKey: string, error: CapabilityContainmentError) => void,
): (call: T) => Promise<Record<string, unknown>[]> {
  if (!plan) return invoke;
  return async (call: T) => {
    const actorKey = String(call.actorKey ?? call.selected_actor_key ?? "");
    if (actorKey) {
      try {
        assertProviderAllowed(plan, actorKey);
      } catch (e) {
        if (e instanceof CapabilityContainmentError) {
          onBlocked?.(actorKey, e);
        }
        throw e;
      }
    }
    return await invoke(call);
  };
}

/** Broad job Actor keys, for callers that need to name them in a diagnostic. */
export function broadJobProviders(): readonly string[] {
  return BROAD_JOB_PROVIDERS;
}
