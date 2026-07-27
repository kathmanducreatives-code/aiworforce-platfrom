// THE RUN-AGENT BRIDGE — the one place Phase 2 touches the live Lead path.
//
// Kept deliberately small and pure so the change inside run-agent is a handful of
// lines and every decision here is unit-testable without an edge-function harness.
//
// WHAT IT DOES: when Claude-first planning is permitted for THIS workspace, it
// replaces the role keywords the deterministic compiler produced with the ones a
// validated Claude strategy approved. Nothing else.
//
// WHAT IT DOES NOT TOUCH: the company-first executor, the quota controller, the
// provider adapters, qualification, employer verification, decision-maker
// verification, CONTACT/WATCH/REJECT/SKIP logic, checkpointing, continuation, or
// the canonical run diagnostics. `requested_person_roles`, `location`, `country`
// and `company_vertical` are all passed through untouched — a planner does not get
// to redefine who we contact or where.
//
// ENABLEMENT REQUIRES TWO INDEPENDENT THINGS (see `isClaudeFirstLeadPlanningEnabled`):
// the flag AND an explicit workspace allow-list. Flipping one environment variable
// cannot turn this on globally, which is the property that makes shipping it safe.
//
// PURE. No network, no database, no provider calls. The model is injected.

import { isIntelligenceFlagEnabled, type EnvReader } from "../intelligenceFlags.ts";
import {
  resolveRuntimeEnvironment,
  environmentFallbackReason,
  type EnvironmentResolution,
} from "../runtimeEnvironment.ts";
import type { MissionContext } from "../missionContext.ts";
import type { GenerateJsonFn } from "../plannerWrapper.ts";
import type { EvidenceItem } from "../promptAssembly.ts";
import { buildLeadMission, type LeadSourcingMission } from "./leadMission.ts";
import { planInitialLeadSourcing, type LeadPlanOutcome } from "./leadPlanner.ts";

/** Env var holding the comma-separated workspace allow-list. */
export const CLAUDE_FIRST_WORKSPACES_ENV = "CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES";

export interface EnablementDecision {
  enabled: boolean;
  /** Why, for diagnostics. Never rendered to a user. */
  reason: "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed" | "enabled";
}

function parseAllowlist(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Is Claude-first planning permitted for this workspace?
 *
 * BOTH conditions are required, and the allow-list has no wildcard. An empty or
 * missing allow-list resolves to DISABLED even when the flag is on — "on for
 * everyone" is not a state this function can return, so there is no single switch
 * that globally enables planning.
 */
export function isClaudeFirstLeadPlanningEnabled(
  workspaceId: string,
  read?: EnvReader,
): EnablementDecision {
  if (!isIntelligenceFlagEnabled("CLAUDE_FIRST_LEAD_PLANNING", read)) {
    return { enabled: false, reason: "flag_off" };
  }
  let allow: string[] = [];
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    allow = parseAllowlist(get(CLAUDE_FIRST_WORKSPACES_ENV));
  } catch {
    return { enabled: false, reason: "no_workspace_allowlist" };
  }
  if (allow.length === 0) return { enabled: false, reason: "no_workspace_allowlist" };
  if (!allow.includes(String(workspaceId))) return { enabled: false, reason: "workspace_not_allowed" };
  return { enabled: true, reason: "enabled" };
}

/** The slice of the compiled job-search spec this bridge may rewrite. */
export interface JobSearchSpecSlice {
  keyword_queries: string[];
  requested_person_roles: string[];
  location: string | null;
  country: string | null;
  original_query: string;
  [k: string]: unknown;
}

export interface LeadPlanningBridgeInput {
  workspaceId: string;
  /** The user's instruction, verbatim. */
  originalInstruction: string;
  spec: JobSearchSpecSlice;
  missionId: string;
  taskId?: string | null;
  context?: MissionContext | null;
  requestedLeadCount?: number | null;
  generate?: GenerateJsonFn;
  evidence?: EvidenceItem[] | null;
  /** Injected in tests; production reads the real environment. */
  readEnv?: EnvReader;
}

export interface LeadPlanningBridgeResult {
  /** The spec to execute. IDENTICAL to the input unless Claude planning applied. */
  spec: JobSearchSpecSlice;
  /**
   * True only when a validated Claude strategy actually replaced the keywords.
   *
   * Reported explicitly rather than left to a reference comparison at the call
   * site: the caller holds a differently-typed view of the spec, and `a !== b`
   * across those two types is both a type error and a fragile way to ask a
   * question the bridge already knows the answer to.
   */
  specRewritten: boolean;
  /** Null when planning did not run at all — the ordinary, default case. */
  outcome: LeadPlanOutcome | null;
  mission: LeadSourcingMission | null;
  enablement: EnablementDecision;
  /**
   * The resolved runtime environment, or NULL when the workspace was never
   * eligible and resolution was therefore never attempted.
   *
   * This is what distinguishes "Phase 2 does not apply here" from "Phase 2 applied
   * and could not proceed" — a distinction `bridgeDiagnostics` needs in order to
   * stay silent in the first case and speak in the second.
   */
  environment: EnvironmentResolution | null;
}

/**
 * Apply Claude-first planning, if permitted.
 *
 * The disabled path returns the caller's own object by reference and performs no
 * work whatsoever — no mission is built, no prompt assembled, no model contacted.
 * That is what makes "flag off means byte-identical behavior" true by construction
 * rather than by careful maintenance.
 */
export async function applyClaudeFirstLeadPlanning(
  input: LeadPlanningBridgeInput,
): Promise<LeadPlanningBridgeResult> {
  // GATE FIRST, ALWAYS. Nothing above this line may do work: not resolving the
  // environment, not reading a project ref, not building a mission. When Phase 2
  // does not apply, the only thing that happens is this one comparison.
  const enablement = isClaudeFirstLeadPlanningEnabled(input.workspaceId, input.readEnv);
  if (!enablement.enabled) {
    return {
      spec: input.spec, specRewritten: false,
      outcome: null, mission: null, enablement, environment: null,
    };
  }

  // WHICH ENVIRONMENT, TRULY. Resolved from the running project rather than
  // assumed, because it decides which capabilities may be selected. It fails
  // closed: an unrecognised project is not planned for at all.
  const environment = resolveRuntimeEnvironment(input.readEnv);
  if (!environment.ok) {
    return {
      spec: input.spec, specRewritten: false,
      outcome: null, mission: null, enablement, environment,
    };
  }
  const environmentMode = environment.mode;

  const mission = buildLeadMission({
    missionId: input.missionId,
    workspaceId: input.workspaceId,
    originalInstruction: input.originalInstruction,
    context: input.context ?? null,
    environmentMode,
    workflow: input.requestedLeadCount ? { requested_count: input.requestedLeadCount } : null,
  });

  const outcome = await planInitialLeadSourcing({
    mission,
    context: input.context ?? null,
    environment: environmentMode,
    enabled: true,
    generate: input.generate,
    evidence: input.evidence ?? null,
    taskId: input.taskId ?? null,
    round: 1,
  });

  // The deterministic fallback already IS today's behavior. Rewriting the spec with
  // it would be a no-op at best and a subtle divergence at worst, so the original
  // spec is returned untouched and only the diagnostics carry the attempt.
  if (outcome.source !== "claude") {
    return { spec: input.spec, specRewritten: false, outcome, mission, enablement, environment };
  }

  const discovery = outcome.plan.searches.find((s) => s.purpose === "discover_hiring_companies");
  const titles = discovery?.titles ?? [];
  if (titles.length === 0) {
    return { spec: input.spec, specRewritten: false, outcome, mission, enablement, environment };
  }

  return {
    // ONLY the role keywords change. Person roles, location, country and vertical
    // are carried through by the spread exactly as the deterministic compiler set
    // them.
    spec: { ...input.spec, keyword_queries: titles },
    specRewritten: true,
    outcome,
    mission,
    enablement,
    environment,
  };
}

/**
 * The diagnostics block for the task result. Safe fields only.
 *
 * Returns NULL when Phase 2 never engaged — flag off, no allow-list, or a
 * workspace that is not on it. THE ABSENCE OF THIS BLOCK IS THE DISABLED SIGNAL.
 *
 * Reporting a `{ status: "disabled" }` record instead would put a Phase 2 key into
 * every task result of every workspace that never opted in, which is a change to
 * the stored task shape, the run context the Workbench reads back, and anything
 * exporting it. "Off" has to mean the feature is not there.
 *
 * A record IS produced once a workspace is eligible, including when the run could
 * not proceed — an eligible workspace that fell back deserves an explanation.
 */
export function bridgeDiagnostics(result: LeadPlanningBridgeResult): Record<string, unknown> | null {
  if (!result.enablement.enabled) return null;

  // Eligible, but the environment could not be resolved, so nothing was planned.
  if (result.environment && !result.environment.ok) {
    return {
      planner_source: "deterministic_registry",
      claude_first_enabled: true,
      enablement_reason: result.enablement.reason,
      fallback_reason: environmentFallbackReason(result.environment.reason),
    };
  }

  if (!result.outcome) {
    return {
      planner_source: "deterministic_registry",
      claude_first_enabled: true,
      enablement_reason: result.enablement.reason,
      fallback_reason: "planner_not_run",
    };
  }
  const d = result.outcome.diagnostics;
  return {
    planner_source: d.planner_source,
    claude_first_enabled: true,
    enablement_reason: result.enablement.reason,
    planner_status: d.status,
    planner_version: d.planner_version,
    model: d.model,
    latency_ms: d.latency_ms,
    input_hash: d.input_hash,
    output_hash: d.output_hash,
    strategy_hash: d.strategy_hash,
    plan_hash: d.plan_hash,
    validation: d.validation,
    fallback_reason: d.fallback_reason,
    selected_capabilities: d.selected_capabilities,
    approved_titles: d.approved_titles,
    rejected_titles: d.rejected_titles,
    approval_required: d.approval_required,
    approval_requests: d.approval_requests,
  };
}
