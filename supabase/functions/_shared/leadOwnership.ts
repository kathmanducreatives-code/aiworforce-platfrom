// ONE TASK, ONE PLANNER, ONE EXECUTION OWNER.
//
// WHAT WENT WRONG WITHOUT THIS.
//
// Four generations of lead architecture ship simultaneously, each gated by its
// own flag read in its own file. Nothing compared them, so "which planner
// planned this task?" and "which engine executed it?" had more than one true
// answer at once:
//
//   * PLANNING. `applyLeadStrategyInitialPlanning` (GPT) ran first, and
//     `applyClaudeFirstLeadPlanning` (Claude) ran immediately afterwards unless
//     GPT had rewritten the spec. A GPT run that fell back deterministically —
//     a timeout, a rejected plan, an escalation that also failed — left
//     `specRewritten` false, so BOTH stacks made model calls for one task and
//     the second silently outvoted the first.
//
//   * EXECUTION. `runCapabilityPlan` owns a mission task and runs its own
//     rounds. `executeRunAgentCompanyFirstSourcing` was then called
//     UNCONDITIONALLY afterwards. For most missions it was neutered by
//     `legacyLoopReachable` returning false — but a mission whose graph legally
//     contains `job_discovery` returns TRUE, so the quota loop executed for real
//     on top of an engine run that had already sourced, qualified and persisted.
//     The two were reconciled by unioning their persisted contact identities.
//
// DEDUPLICATION IS NOT OWNERSHIP. Reconciling two writers after the fact answers
// "how many leads" and never answers "why did this run do that", which is the
// question a failed run actually needs answered.
//
// WHAT THIS MODULE IS.
//
// A ledger, claimed once per role per task. A second claim for an already-owned
// role THROWS. That is the point: the guarantee must not depend on a flag being
// configured correctly, on a call site remembering to check a boolean, or on a
// comment asserting that two paths "cannot" both run. A second owner is a
// programming error and is raised as one.
//
// The ledger records rather than decides. Adapter SELECTION is
// `leadPlannerInterface.ts`; this module only enforces that whatever was
// selected is the only thing that claims.
//
// PURE. No network, provider, model or database access.

export const LEAD_OWNERSHIP_VERSION = "lead-ownership-v1" as const;

/**
 * The single adapter that owns initial lead strategy for a task.
 *
 * These are ADAPTERS BEHIND ONE INTERFACE, not competing subsystems. Exactly one
 * is selected per task by `selectLeadPlannerAdapter`, and only the selected one
 * is ever invoked — which is why a flag combination can no longer produce two
 * plans.
 */
export type LeadPlanningOwner =
  /** A plan artifact decided upstream and threaded on the request. Replay, not planning. */
  | "persisted_plan_artifact_v1"
  /** GPT adapter — `leadStrategyBridge.applyLeadStrategyInitialPlanning`. */
  | "gpt_lead_strategy_v1"
  /** Claude adapter — `leadPlanningBridge.applyClaudeFirstLeadPlanning`. */
  | "claude_lead_planner_v1"
  /** No model call at all. The deterministic ladder owns the titles. */
  | "deterministic_registry_v1";

export const LEAD_PLANNING_OWNERS: readonly LeadPlanningOwner[] = [
  "persisted_plan_artifact_v1",
  "gpt_lead_strategy_v1",
  "claude_lead_planner_v1",
  "deterministic_registry_v1",
] as const;

// ── PLANNER PROVENANCE ──────────────────────────────────────────────────────
//
// WHY A TRIPLE AND NOT A LABEL.
//
// `deterministic_registry` collapsed two states that mean opposite things to
// anyone debugging a run:
//
//   A. No model planner was used, BY DESIGN. The workspace has no adapter
//      enabled; the deterministic ladder is the intended planner and the run is
//      working exactly as configured.
//
//   B. A model adapter WAS selected, ran, and fell back — a timeout, a
//      schema-rejected plan, an escalation that also failed. The run is degraded
//      and somebody should know why.
//
// Both produced the same label, so "why did this task use deterministic titles?"
// could not be answered from the plan row. Worse, B is the state where
// `fallback_reason` is the only interesting field in the record, and nothing
// forced it to be populated.
//
// The triple makes the two structurally different rather than
// distinguishable-if-you-know-to-look: an adapter of "none" can only pair with
// `selected_directly`, and `deterministic_fallback` can only occur with a real
// adapter and a reason. `assertPlannerProvenance` enforces that.

/** Which model adapter owned planning. `none` means the ladder owned it. */
export type PlannerAdapterId = "gpt" | "claude" | "none";

export type PlannerOutcome =
  /** No adapter ran. The deterministic ladder was the intended planner. */
  | "selected_directly"
  /** An adapter ran and its plan was accepted. */
  | "model_validated"
  /** An adapter ran and fell back to the ladder. `fallback_reason` says why. */
  | "deterministic_fallback";

export interface LeadPlannerProvenance {
  /** The adapter the selector named. Unchanged by that adapter's outcome. */
  owner: LeadPlanningOwner;
  adapter: PlannerAdapterId;
  outcome: PlannerOutcome;
  /** Required for `deterministic_fallback`, null otherwise. */
  fallback_reason: string | null;
}

/** The adapter that backs each planning owner. */
export function adapterForOwner(owner: LeadPlanningOwner): PlannerAdapterId {
  switch (owner) {
    case "gpt_lead_strategy_v1": return "gpt";
    case "claude_lead_planner_v1": return "claude";
    // A replayed plan's adapter is whatever originally planned it; the artifact
    // carries its own provenance, so this is only the fallback for a plan that
    // predates provenance being recorded.
    case "persisted_plan_artifact_v1": return "none";
    case "deterministic_registry_v1": return "none";
  }
}

/**
 * Reject provenance that cannot describe a real run.
 *
 * The combinations this refuses are exactly the ones that would recreate the
 * ambiguity: an adapter that "fell back" without a reason, a fallback with no
 * adapter, or a model outcome attributed to no adapter at all.
 */
export function assertPlannerProvenance(p: LeadPlannerProvenance): LeadPlannerProvenance {
  if (p.adapter === "none" && p.outcome !== "selected_directly") {
    throw new Error(
      `planner provenance is not describable: adapter "none" cannot have outcome "${p.outcome}"`,
    );
  }
  if (p.outcome === "deterministic_fallback" && !p.fallback_reason) {
    throw new Error(
      "planner provenance is not describable: a deterministic fallback must say why it fell back",
    );
  }
  if (p.outcome === "selected_directly" && p.adapter !== "none") {
    throw new Error(
      `planner provenance is not describable: adapter "${p.adapter}" ran, so the ladder was not selected directly`,
    );
  }
  return p;
}

/** True when the ladder planned because it was meant to — state A, not B. */
export function isDeterministicByDesign(p: LeadPlannerProvenance | null | undefined): boolean {
  return p?.outcome === "selected_directly";
}

/** True when a model adapter ran and degraded to the ladder — state B. */
export function isModelFallback(p: LeadPlannerProvenance | null | undefined): boolean {
  return p?.outcome === "deterministic_fallback";
}

/** One human-readable line for logs and diagnostics. Never rendered to a user. */
export function describePlannerProvenance(p: LeadPlannerProvenance): string {
  if (p.outcome === "selected_directly") {
    return "deterministic ladder, selected directly — no adapter was enabled for this workspace";
  }
  if (p.outcome === "model_validated") return `${p.adapter} planned and its plan was accepted`;
  return `${p.adapter} ran and fell back to the deterministic ladder: ${p.fallback_reason}`;
}

/**
 * The single engine that owns execution for a task.
 *
 * `company_first_v1` is deliberately ONE owner covering two ordered stages —
 * `executeCompanyFirstRoute` (route executor) followed by
 * `executeRunAgentCompanyFirstSourcing` (quota loop). They are stages of one
 * design that composes on purpose: the route executor runs the primary source,
 * the quota loop rounds until the requested count is met or a stop condition
 * fires. Splitting them into two owners would have made the honest, working
 * multi-round path look like a violation, and would have forced a change to
 * stop-at-quota semantics that this phase must not touch.
 *
 * What is NOT one owner is `capability_engine_v1` running alongside either of
 * them. The capability engine sources, qualifies, rounds and persists on its
 * own; anything else executing after it is a second engine for the same task.
 */
export type LeadExecutionOwner =
  /** `runCapabilityPlan` — the authority for any task carrying a LeadMissionV1. */
  | "capability_engine_v1"
  /** Route executor + quota loop. The pre-mission path, still authoritative where no mission exists. */
  | "company_first_v1";

export const LEAD_EXECUTION_OWNERS: readonly LeadExecutionOwner[] = [
  "capability_engine_v1",
  "company_first_v1",
] as const;

/** Ordered stages within one execution owner. Recorded, never claimed as owners. */
export type LeadExecutionStage =
  | "capability_rounds"
  | "route_executor"
  | "quota_loop";

/** Which stages legitimately belong to which owner. */
export const STAGES_BY_OWNER: Readonly<Record<LeadExecutionOwner, readonly LeadExecutionStage[]>> = {
  capability_engine_v1: ["capability_rounds"],
  company_first_v1: ["route_executor", "quota_loop"],
};

/**
 * Raised when a second owner tries to claim a role this task already has.
 *
 * A distinct class so a call site can tell an ownership bug apart from a
 * provider failure. Nothing in the runtime should catch this and continue.
 */
export class LeadOwnershipViolation extends Error {
  readonly role: "planning" | "execution" | "persistence";
  readonly held: string;
  readonly attempted: string;
  constructor(role: "planning" | "execution" | "persistence", held: string, attempted: string) {
    super(
      `lead ownership violation: ${role} is already owned by "${held}"; ` +
      `"${attempted}" attempted to claim it. One task has exactly one ${role} owner.`,
    );
    this.name = "LeadOwnershipViolation";
    this.role = role;
    this.held = held;
    this.attempted = attempted;
  }
}

export interface LeadOwnershipSnapshot {
  version: typeof LEAD_OWNERSHIP_VERSION;
  task_id: string | null;
  planning_owner: LeadPlanningOwner | null;
  planning_reason: string | null;
  /**
   * How the plan this run is executing was actually made.
   *
   * Distinct from `planning_owner`, which for a replayed plan is always
   * `persisted_plan_artifact_v1` and therefore says nothing about which adapter
   * originally planned. Carried from the artifact so a resumed run reports the
   * same provenance as the run that planned it.
   */
  plan_provenance: LeadPlannerProvenance | null;
  execution_owner: LeadExecutionOwner | null;
  execution_reason: string | null;
  /** Stages actually entered, in order. */
  stages: LeadExecutionStage[];
  /** Owners that persisted lead candidates. More than one is impossible by construction. */
  persistence_owners: LeadExecutionOwner[];
  /** Owners considered and deliberately not run, with why. Diagnostics only. */
  declined: Array<{ owner: string; reason: string }>;
}

export interface LeadOwnershipLedger {
  claimPlanning(owner: LeadPlanningOwner, reason: string): void;
  /**
   * Record how the plan being executed was made.
   *
   * Idempotent for identical provenance; a CONFLICTING record throws, because
   * two different accounts of how one plan was made is the ambiguity this
   * whole triple exists to remove.
   */
  recordPlanProvenance(p: LeadPlannerProvenance): void;
  claimExecution(owner: LeadExecutionOwner, reason: string): void;
  enterStage(stage: LeadExecutionStage): void;
  claimPersistence(owner: LeadExecutionOwner): void;
  decline(owner: string, reason: string): void;
  /** Who owns execution right now, or null if nothing has claimed. */
  executionOwner(): LeadExecutionOwner | null;
  planningOwner(): LeadPlanningOwner | null;
  /** True when `owner` may run — i.e. nothing else already claimed execution. */
  mayExecute(owner: LeadExecutionOwner): boolean;
  snapshot(): LeadOwnershipSnapshot;
}

/**
 * A fresh ledger for one task.
 *
 * Claims are idempotent for the SAME owner — a re-entrant call site (the quota
 * loop entering after the route executor within `company_first_v1`, a resumed
 * round re-claiming the engine) is not a violation. Only a DIFFERENT owner is.
 */
export function createLeadOwnershipLedger(taskId?: string | null): LeadOwnershipLedger {
  let planning: LeadPlanningOwner | null = null;
  let planningReason: string | null = null;
  let provenance: LeadPlannerProvenance | null = null;
  let execution: LeadExecutionOwner | null = null;
  let executionReason: string | null = null;
  const stages: LeadExecutionStage[] = [];
  const persistence: LeadExecutionOwner[] = [];
  const declined: Array<{ owner: string; reason: string }> = [];

  return {
    claimPlanning(owner, reason) {
      if (planning !== null && planning !== owner) {
        throw new LeadOwnershipViolation("planning", planning, owner);
      }
      planning = owner;
      planningReason = planningReason ?? reason;
    },

    recordPlanProvenance(p) {
      assertPlannerProvenance(p);
      if (provenance && JSON.stringify(provenance) !== JSON.stringify(p)) {
        throw new LeadOwnershipViolation(
          "planning",
          describePlannerProvenance(provenance),
          describePlannerProvenance(p),
        );
      }
      provenance = p;
    },

    claimExecution(owner, reason) {
      if (execution !== null && execution !== owner) {
        throw new LeadOwnershipViolation("execution", execution, owner);
      }
      execution = owner;
      executionReason = executionReason ?? reason;
    },

    enterStage(stage) {
      // A stage outside the claimed owner's set means a path from one engine ran
      // under another's claim — the exact confusion this ledger exists to catch.
      if (execution !== null && !STAGES_BY_OWNER[execution].includes(stage)) {
        throw new LeadOwnershipViolation("execution", execution, `stage:${stage}`);
      }
      if (!stages.includes(stage)) stages.push(stage);
    },

    claimPersistence(owner) {
      if (execution !== null && execution !== owner) {
        throw new LeadOwnershipViolation("persistence", execution, owner);
      }
      if (persistence.length > 0 && !persistence.includes(owner)) {
        throw new LeadOwnershipViolation("persistence", persistence[0], owner);
      }
      if (!persistence.includes(owner)) persistence.push(owner);
    },

    decline(owner, reason) {
      declined.push({ owner, reason });
    },

    executionOwner: () => execution,
    planningOwner: () => planning,
    mayExecute: (owner) => execution === null || execution === owner,

    snapshot: () => ({
      version: LEAD_OWNERSHIP_VERSION,
      task_id: taskId ?? null,
      planning_owner: planning,
      planning_reason: planningReason,
      plan_provenance: provenance ? { ...provenance } : null,
      execution_owner: execution,
      execution_reason: executionReason,
      stages: [...stages],
      persistence_owners: [...persistence],
      declined: declined.map((d) => ({ ...d })),
    }),
  };
}
