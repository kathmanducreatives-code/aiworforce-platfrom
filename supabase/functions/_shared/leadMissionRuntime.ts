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
import {
  REFERENT_BINDING_VERSION, type ResolvedReferentBinding,
} from "./referentBinding.ts";

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

/** The transport key for the binding sidecar. Beside the mission, never in it. */
export const LEAD_BINDINGS_KEY = "lead_referent_bindings" as const;

/**
 * Find the resolved bindings on whatever the caller was given.
 *
 * ── WHY THE SIDECAR TRAVELS SEPARATELY, AND IS RE-VALIDATED HERE ───────────
 *
 * The bindings cannot ride inside `lead_mission`: `missionHash` is computed
 * from the mission, so adding a field would change checkpoint identity for
 * every run, and `scanProposalForViolations` refuses the URLs a binding
 * carries. So they travel as a sibling key and are read back here.
 *
 * STRUCTURALLY CHECKED, NOT TRUSTED. What arrives has been through a JSON
 * round-trip on a plan step, so it is untyped data by the time it is read. A
 * binding missing its version, its entity key or its identity is DROPPED rather
 * than repaired — a half-read binding would decide which real company a paid
 * run investigates, and the honest failure is to resolve the name the ordinary
 * way instead of acting on a fragment.
 */
export function readPersistedBindings(
  toolInput: unknown, bodyBindings?: unknown,
): ResolvedReferentBinding[] {
  const candidates: unknown[] = [bodyBindings];
  if (toolInput && typeof toolInput === "object") {
    const ti = toolInput as Record<string, unknown>;
    candidates.push(ti[LEAD_BINDINGS_KEY]);
    const qlp = ti.qualified_lead_plan;
    if (qlp && typeof qlp === "object") {
      candidates.push((qlp as Record<string, unknown>)[LEAD_BINDINGS_KEY]);
    }
  }
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out = c.filter(isResolvedReferentBinding);
    if (out.length > 0) return out;
  }
  return [];
}

/** The structural guard. Every field the engine and the fingerprint read. */
export function isResolvedReferentBinding(v: unknown): v is ResolvedReferentBinding {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (b.version !== REFERENT_BINDING_VERSION) return false;
  if (b.entity_type !== "company") return false;
  if (typeof b.part_id !== "string" || !b.part_id) return false;
  if (typeof b.entity_key !== "string" || !b.entity_key) return false;
  const id = b.identity;
  if (!id || typeof id !== "object") return false;
  const i = id as Record<string, unknown>;
  // THE STRONG IDENTIFIERS ARE THE POINT. A binding that arrives with neither
  // proves nothing the mission's own name did not already prove, and seeding a
  // pool row from it would claim a certainty that did not survive transport.
  const strong = typeof i.canonicalDomain === "string" && i.canonicalDomain
    || typeof i.linkedinUrl === "string" && i.linkedinUrl;
  return !!strong;
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
        // THE CAPABILITY TRAVELS WITH THE CALL, so containment can ask the
        // question that matters: not "may this mission use this Actor at all?"
        // but "may THIS STEP use it?".
        const capability = (call as { capabilityId?: string }).capabilityId;
        assertProviderAllowed(plan, actorKey, capability ? { capability } : {});
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
