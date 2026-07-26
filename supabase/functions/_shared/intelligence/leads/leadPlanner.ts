// THE LEAD PLANNER — mission in, executable plan out, deterministic either way.
//
// This is the ONE entry point Phase 2 adds to the Lead path, and its contract is
// deliberately narrow:
//
//   planInitialLeadSourcing(...)  ->  { plan, source, diagnostics }
//
// `plan` is ALWAYS present. `source` says whether Claude produced it or the
// deterministic registry did. A caller that ignores `source` entirely still gets a
// correct, executable plan — which is what makes wiring this in safe.
//
// THE FALLBACK CHAIN, in full:
//
//   flag off                      -> deterministic
//   planner disabled / no model   -> deterministic
//   invalid JSON / bad schema     -> one constrained repair -> re-validate
//   still invalid                 -> deterministic
//   timeout / provider error      -> deterministic
//   injection in the response     -> deterministic (never repaired)
//   policy violation              -> deterministic
//   approval required             -> deterministic, with the request surfaced
//   compile failure               -> deterministic
//   structurally incomplete plan  -> deterministic (checked AFTER filtering)
//
// "Approval required" is worth stating plainly: Phase 2 does NOT block the run
// waiting for a human. It falls back to the deterministic plan and REPORTS what
// would have needed approval. Blocking a run on a question nobody is watching
// would be worse than sourcing the role the user actually asked for.
//
// NO PROVIDER CALLS. NO DATABASE ACCESS. The model is injected.

import { runPlanner, type GenerateJsonFn, type PlannerCallDiagnostics } from "../plannerWrapper.ts";
import { validateStrategy, type StrategyViolation } from "../strategyValidation.ts";
import { buildPlannerDiagnostics, type PlannerDiagnosticsRecord } from "../plannerDiagnostics.ts";
import { plannerCapabilityMenu } from "../capabilityRegistry.ts";
import { emptyMissionContext, type MissionContext } from "../missionContext.ts";
import type { EvidenceItem } from "../promptAssembly.ts";
import type { AgentoryEnvironmentMode } from "../mission.ts";

import type { LeadSourcingMission } from "./leadMission.ts";
import { parseLeadStrategy, LEAD_STRATEGY_OUTPUT_SCHEMA, type LeadInitialStrategy } from "./leadStrategy.ts";
import { reviewStrategyTitles, checkLeadPreservation, registryFallbackTitles, type TitleDecision } from "./leadStrategyValidation.ts";
import { compileLeadStrategy, compileDeterministicPlan, assessPlanCompleteness, type CompiledLeadPlan } from "./leadStrategyCompiler.ts";

export type LeadPlanSource = "claude" | "deterministic_registry";

export interface LeadPlanDiagnostics extends PlannerDiagnosticsRecord {
  planner_source: LeadPlanSource;
  selected_capabilities: string[];
  approved_titles: string[];
  rejected_titles: Array<{ title: string; reason: string }>;
  approval_required: boolean;
  approval_requests: Array<{ code: string; message: string }>;
  plan_hash: string;
}

export interface LeadPlanOutcome {
  /** Always present. The workflow can always run. */
  plan: CompiledLeadPlan;
  source: LeadPlanSource;
  /** The accepted Claude strategy, when one was accepted. */
  strategy: LeadInitialStrategy | null;
  /** Why the deterministic plan was used, when it was. */
  fallbackReason: string | null;
  diagnostics: LeadPlanDiagnostics;
}

export interface PlanLeadSourcingInput {
  mission: LeadSourcingMission;
  context?: MissionContext | null;
  environment: AgentoryEnvironmentMode;
  /**
   * Resolved by the CALLER from the feature flag. Phase 2 never reads the
   * environment here, so a planner call is impossible unless a caller has already
   * decided this workspace is permitted.
   */
  enabled: boolean;
  generate?: GenerateJsonFn;
  evidence?: EvidenceItem[] | null;
  attemptedStrategyHashes?: string[];
  taskId?: string | null;
  round?: number | null;
  timeoutMs?: number;
}

function emptyCall(status: PlannerCallDiagnostics["status"]): PlannerCallDiagnostics {
  return {
    planner_version: "agentory-planner-1.0.0",
    model: "", provider: "none", status,
    latency_ms: 0, input_hash: "", output_hash: null, repair_attempted: false,
  };
}

/**
 * Plan the FIRST sourcing round.
 *
 * Everything downstream — the company-first executor, the quota controller,
 * qualification, employer verification, CONTACT/WATCH logic — is untouched. This
 * only decides which titles and locations that machinery starts from.
 */
export async function planInitialLeadSourcing(input: PlanLeadSourcingInput): Promise<LeadPlanOutcome> {
  const { mission, environment } = input;
  const context = input.context ?? emptyMissionContext(mission.workspace_id);

  const deterministicTitles = registryFallbackTitles(mission);

  // Compiled at most once, and reused: it is both the fallback plan AND the
  // baseline the accepted Claude plan is measured against for completeness.
  let deterministicMemo: CompiledLeadPlan | null = null;
  const deterministicPlan = async (): Promise<CompiledLeadPlan> => {
    if (deterministicMemo) return deterministicMemo;
    const compiled = await compileDeterministicPlan(mission, deterministicTitles, environment);
    if (!compiled.ok) {
      // The deterministic path itself could not compile. Surfaced honestly rather
      // than papered over — an empty plan is not a plan.
      throw new Error(`deterministic_plan_uncompilable:${compiled.reason}`);
    }
    deterministicMemo = compiled.plan;
    return compiled.plan;
  };

  const fallback = async (
    reason: string,
    call: PlannerCallDiagnostics,
    extra: Partial<LeadPlanDiagnostics> = {},
  ): Promise<LeadPlanOutcome> => {
    const plan = await deterministicPlan();
    return {
      plan,
      source: "deterministic_registry",
      strategy: null,
      fallbackReason: reason,
      diagnostics: {
        ...buildPlannerDiagnostics({
          missionId: mission.mission_id, taskId: input.taskId ?? null,
          workspaceId: mission.workspace_id, department: "leads",
          call, fallbackReason: reason, round: input.round ?? null,
        }),
        selected_capabilities: [],
        rejected_titles: [],
        approval_required: false,
        approval_requests: [],
        // The caller's review findings — WHY the fallback happened — are carried
        // through, so a rejected title or an approval request is still reportable.
        ...extra,
        // AUTHORITATIVE, applied last. These describe the plan that will actually
        // execute, and `extra` describes the strategy that did NOT. Letting the
        // spread win here would label a deterministic run as a Claude run and
        // attach the abandoned strategy's hash to it.
        planner_source: "deterministic_registry",
        approved_titles: plan.approvedTitles,
        plan_hash: plan.planHash,
        fallback_reason: reason,
      },
    };
  };

  // FLAG OFF. No mission is sent anywhere, no model is contacted.
  if (!input.enabled) {
    return fallback("flag_disabled", emptyCall("fallback_disabled"));
  }

  const outcome = await runPlanner<LeadInitialStrategy>({
    mission,
    context,
    capabilities: plannerCapabilityMenu({ department: "leads", environment }),
    evidence: input.evidence ?? null,
    outputSchema: LEAD_STRATEGY_OUTPUT_SCHEMA,
    validateStrategy: parseLeadStrategy,
    fallbackStrategy: {} as LeadInitialStrategy,
    generate: input.generate,
    enabled: true,
    workspaceId: mission.workspace_id,
    timeoutMs: input.timeoutMs,
  });

  if (!outcome.ok) {
    return fallback(outcome.reason, outcome.diagnostics);
  }

  const strategy = outcome.envelope.strategy;

  // ---- shared policy validation -------------------------------------------
  const shared = await validateStrategy<LeadInitialStrategy>({
    strategy,
    department: "leads",
    environment,
    originalInstruction: mission.original_instruction,
    workspaceId: mission.workspace_id,
    read: {
      // The strategy shape carries no echo fields; the mission's own values are
      // supplied, so these checks assert the mission was not mutated in flight.
      echoedInstruction: () => mission.original_instruction,
      workspaceId: () => mission.workspace_id,
      capabilities: (s) => s.searches.map((x) => x.capability_key),
      plannedGeography: (s) => s.searches.flatMap((x) => x.locations ?? []),
      requestedCount: () => mission.output.requested_count,
      outputEntity: () => mission.output.count_entity,
      quotaPolicy: () => mission.output.quota_policy,
      budget: (s) => ({
        estimated_calls: s.searches.length,
        estimated_cost_usd: 0,
        rounds: 1,
      }),
    },
    expected: {
      requiredGeography: [],  // Lead-specific geography check is richer; see below.
      requestedCount: mission.output.requested_count,
      outputEntity: mission.output.count_entity,
      quotaPolicy: mission.output.quota_policy,
    },
    budgetLimits: mission.budget,
    attemptedStrategyHashes: input.attemptedStrategyHashes,
  });

  const violations: StrategyViolation[] = shared.valid ? [] : shared.violations;
  const leadViolations = checkLeadPreservation(mission, strategy);
  const allViolations = [
    ...violations,
    ...leadViolations.map((v) => ({ code: v.code, message: v.message, severity: v.severity })),
  ];

  const blocking = allViolations.filter((v) => v.severity === "block");
  const approvals = allViolations.filter((v) => v.severity === "approval_required");

  const review = reviewStrategyTitles(mission, strategy);
  const rejected: TitleDecision[] = review.rejected;

  const diagBase = (extra: Partial<LeadPlanDiagnostics>): LeadPlanDiagnostics => ({
    ...buildPlannerDiagnostics({
      missionId: mission.mission_id, taskId: input.taskId ?? null,
      workspaceId: mission.workspace_id, department: "leads",
      call: outcome.diagnostics,
      strategyHash: shared.valid ? shared.strategy_hash : null,
      validation: { valid: blocking.length === 0, violations: allViolations },
      round: input.round ?? null,
    }),
    planner_source: "claude",
    selected_capabilities: [...new Set(strategy.searches.map((s) => s.capability_key))].sort(),
    approved_titles: review.approved,
    rejected_titles: rejected.map((d) => ({ title: d.title, reason: d.reason })),
    approval_required: approvals.length > 0 || review.approvalRequired.length > 0,
    approval_requests: [
      ...approvals.map((v) => ({ code: v.code, message: v.message })),
      ...review.approvalRequired.map((d) => ({ code: "adjacent_or_unknown_title", message: d.reason })),
    ],
    plan_hash: "",
    ...extra,
  });

  if (blocking.length > 0) {
    return fallback(`validation_blocked:${blocking[0].code}`, outcome.diagnostics, diagBase({}));
  }

  // APPROVAL, HANDLED AT TWO DIFFERENT LEVELS.
  //
  // A TITLE that needs approval is simply not executed: the compiler filters to the
  // approved set, so the rest of a good strategy still runs and the title is
  // surfaced for a human. Throwing away a correct plan because one adjacent
  // suggestion came attached would punish the planner for being informative.
  //
  // A POLICY change is different. "Search these three countries" or "target this
  // other vertical" describes the strategy AS A WHOLE having redefined the request
  // — there is no partial version of it to honour. Phase 2 has no approval
  // execution yet, so the honest response is the deterministic plan plus a clear
  // record of what was asked for.
  if (approvals.length > 0) {
    return fallback(`approval_required:${approvals[0].code}`, outcome.diagnostics, diagBase({}));
  }

  // A strategy whose titles all failed review has nothing safe to execute.
  if (review.approved.length === 0) {
    return fallback("no_autonomously_approved_titles", outcome.diagnostics, diagBase({}));
  }

  // ---- compile through the EXISTING adapters ------------------------------
  const compiled = await compileLeadStrategy({
    mission, strategy, approvedTitles: review.approved, environment,
  });
  if (!compiled.ok) {
    return fallback(`compile_failed:${compiled.reason}`, outcome.diagnostics, diagBase({}));
  }

  // STRUCTURAL COMPLETENESS, checked on what will ACTUALLY execute.
  //
  // Everything above validates the strategy Claude PROPOSED. This is the last gate,
  // and the only one that sees the plan after rejected and approval-required titles
  // have been filtered out and title-less searches dropped. A strategy can clear
  // every policy check and still compile into something that cannot find anything —
  // and without this it would run, and be recorded as a Claude-planned run.
  //
  // Falling back here also keeps the diagnostics honest: `fallback()` re-labels the
  // record as deterministic with a reason, so the source, plan hash and status
  // always describe the plan that really ran.
  const completeness = assessPlanCompleteness(compiled.plan, await deterministicPlan());
  if (!completeness.ok) {
    return fallback(`plan_incomplete:${completeness.reason}`, outcome.diagnostics, diagBase({}));
  }

  return {
    plan: compiled.plan,
    source: "claude",
    strategy,
    fallbackReason: null,
    diagnostics: diagBase({ plan_hash: compiled.plan.planHash }),
  };
}
