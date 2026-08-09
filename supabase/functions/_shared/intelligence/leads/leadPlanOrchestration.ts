// THE SINGLE LEAD-PLANNING CALL SITE.
//
// Called from orchestrate in the few lines before `task_plans` is inserted, and
// it answers one question: "is there a validated strategy that should BE the
// plan?" This is the ONLY place in the codebase that invokes a lead-planning
// adapter. run-agent holds none.
//
// WHY PLANNING LIVES HERE AND NOT IN THE EXECUTOR. The plan is persisted and
// shown to the user from this function's output. If the executor planned
// instead, orchestrate would persist a generic template and run-agent would
// execute something else — which is the defect this seam was originally written
// to fix. Planning before persistence is what keeps "the plan on screen" and
// "the plan that runs" the same object.
//
// WHAT IT DOES NOT DO. It is not a planner, a router or a validator — it calls
// the existing ones:
//
//   routeQualifiedLead            is this a qualified-Lead mission?
//   selectLeadPlannerAdapter      which ONE adapter owns this task
//   compileLeadEntityIntent       the canonical Lead contract
//   loadMissionContext            the bounded Company Brain projection
//   applyLeadStrategyInitialPlanning  the GPT adapter, with its own schema,
//                                 validator, escalation and fallback
//   applyClaudeFirstLeadPlanning  the Claude adapter, with its own schema,
//                                 repair, policy validation and fallback
//   buildQualifiedLeadPlanSteps   renders the already-decided outcome
//
// EXACTLY ONE ADAPTER IS AWAITED PER TASK. The choice is made from eligibility
// before either is called, so an adapter that fails falls back deterministically
// and never hands the task to the other one.
//
// Returning null means "not applicable" and orchestrate proceeds with exactly the
// plan it would have built before — which is what keeps every other workflow, and
// every workspace that has not opted in, byte-identical.

import { routeQualifiedLead } from "../../qualifiedLeadRouting.ts";
import { compileLeadEntityIntent } from "../../leadEntityIntent.ts";
import { loadMissionContext } from "../missionContext.ts";
import type { BrainDbClient } from "../../getCompiledCompanyBrainForWorkspace.ts";
import {
  applyClaudeFirstLeadPlanning, isClaudeFirstLeadPlanningEnabled,
} from "./leadPlanningBridge.ts";
import {
  applyLeadStrategyInitialPlanning, isGptLeadStrategyEnabled,
} from "../../leadStrategyBridge.ts";
import { selectLeadPlannerAdapter } from "../../leadPlannerInterface.ts";
import type { LeadStrategyModelFn } from "../../leadStrategyModels.ts";
import { constraintsFromBrain } from "../../leadStrategistContext.ts";
import {
  buildQualifiedLeadPlanSteps, buildQualifiedLeadPlanSummary, planArtifactHash,
  QUALIFIED_LEAD_PLAN_VERSION,
  type AuthoritativePlanSource, type QualifiedLeadPlanArtifact,
  type QualifiedLeadPlanContract, type QualifiedLeadPlanStep,
} from "./leadPlanAuthority.ts";
import type { EnvReader } from "../intelligenceFlags.ts";
import type { GenerateJsonFn } from "../plannerWrapper.ts";

// THE SEAM IS THE ONLY DOOR. orchestrate imports exactly one kernel module — this
// one — which is the blast-radius contract asserted by
// _shared/intelligence/intelligenceFlags.test.ts (32.E). Rendering the response
// plan is a plan-shape concern owned by leadPlanAuthority, so it is re-exported
// here rather than reached for directly.
export {
  buildOrchestrateResponsePlan,
  type OrchestrateResponsePlan,
  type ResponsePlanStep,
} from "./leadPlanAuthority.ts";

export interface QualifiedLeadPlanOutcome {
  summary: string;
  steps: QualifiedLeadPlanStep[];
  artifact: QualifiedLeadPlanArtifact;
}

export interface PlanQualifiedLeadInput {
  admin: BrainDbClient;
  workspaceId: string;
  userInstruction: string;
  toolInput?: Record<string, unknown> | null;
  /** The generic plan orchestrate already built. Used only for provenance. */
  fallbackSteps?: Array<Record<string, unknown>>;
  fallbackSummary?: string;
  /** Injected in tests; production uses the existing gateway. */
  generate?: GenerateJsonFn;
  /**
   * The GPT adapter's model seam, injected in tests.
   *
   * Threaded for the same reason `generate` is: with planning consolidated onto
   * this one call site, "exactly one planner invocation per task" is only
   * provable if a test can COUNT invocations of both adapters. Production passes
   * neither and each adapter uses its configured gateway.
   */
  callModel?: LeadStrategyModelFn;
  readEnv?: EnvReader;
  missionId?: string;
}

/**
 * Plan a qualified-Lead mission, or decline.
 *
 * Declines — returns null — when the request is not a qualified-Lead mission, or
 * when Claude-first is off for this workspace. In both cases orchestrate keeps
 * its existing plan untouched. There is deliberately no third state where this
 * partially applies.
 */
export async function planQualifiedLeadBeforePersistence(
  input: PlanQualifiedLeadInput,
): Promise<QualifiedLeadPlanOutcome | null> {
  const route = routeQualifiedLead(input.userInstruction);
  if (route.workflowKind !== "qualified_lead_sourcing") return null;

  // ══ THE ONE PLANNER CALL SITE ════════════════════════════════════════════
  //
  // This used to read `isClaudeFirstLeadPlanningEnabled` directly and invoke the
  // Claude adapter unconditionally when it was on. That made orchestrate a
  // SECOND, independent planner owner: with both flags enabled the selector in
  // run-agent designated GPT as the gated-path owner, while orchestrate had
  // already planned with Claude and threaded the artifact — so GPT never ran and
  // nothing recorded that the designated owner had been overruled.
  //
  // The same selector now runs HERE, and this is the only place in the codebase
  // that invokes a lead-planning adapter. run-agent consumes the artifact and
  // holds no adapter call of its own, so "which planner planned this task?" has
  // one answer produced in one place.
  //
  // Declining still means returning null: a workspace with no planner adapter
  // enabled keeps the exact plan orchestrate would have built before, which is
  // what makes this byte-identical for anyone who has not opted in.
  const plannerSelection = selectLeadPlannerAdapter({
    // Planning happens here, before any artifact exists — by construction there
    // is never one to replay at this point.
    hasPersistedPlan: false,
    // orchestrate reached this line only because the route IS qualified-lead
    // sourcing, which is the workflow half of the GPT owner's gate. The
    // execution-mode half is company_first for every route that gets here.
    strategyOwnerApplies: true,
    gptEnabled: isGptLeadStrategyEnabled(input.workspaceId, input.readEnv).enabled,
    claudeEnabled: isClaudeFirstLeadPlanningEnabled(input.workspaceId, input.readEnv).enabled,
  });
  if (plannerSelection.owner === "deterministic_registry_v1") return null;

  const intent = compileLeadEntityIntent(input.userInstruction);
  const spec = intent.job_search_spec;

  const contract: QualifiedLeadPlanContract = {
    requestedCount: intent.requested_count ?? 5,
    decisionMakerRoles: [...spec.requested_person_roles],
    hiringRoles: [...spec.keyword_queries],
    companyVertical: spec.company_vertical,
    companyStage: intent.company_categories.find((c) => /seed|early|series|growth/i.test(c)) ?? null,
    geography: spec.location,
    currentEmployerRequired: intent.company_gate_required,
  };

  // The Company Brain the planner is allowed to see. A failure here is not fatal:
  // the planner simply plans without ICP context, which is what it did before.
  let context = null;
  try {
    const loaded = await loadMissionContext(input.admin, input.workspaceId);
    context = loaded.ok ? loaded.context : null;
  } catch {
    context = null;
  }

  // ── EXACTLY ONE ADAPTER IS AWAITED ──────────────────────────────────────
  //
  // Each adapter keeps its own schema, repair, policy validation, approval gate
  // and deterministic fallback — none of that moved. What changed is that the
  // choice between them is made once, above, from eligibility alone, so an
  // adapter failing never hands the task to the other one.
  let artifact: QualifiedLeadPlanArtifact;
  let approved_titles: string[];

  if (plannerSelection.owner === "gpt_lead_strategy_v1") {
    // THE WORKSPACE'S REAL ICP, NOT A GUESS.
    //
    // run-agent passed this via `constraintsFromBrain(effectivePolicy…)` when it
    // owned the call. The same fact has to reach the strategist from here, or
    // moving the call site would have quietly returned it to planning blind —
    // `missionFromSpec` hard-codes `company_size: null` without it. The bounded
    // mission context loaded above is the same Company Brain projection, in the
    // shape the kernel already sanctions for a planner to see.
    const companyConstraints = context
      ? constraintsFromBrain({
        positive_industries: context.icp.industries,
        negative_industries: context.icp.exclusions,
        excluded_company_types: [],
        min_employees: context.icp.employee_range?.min ?? null,
        max_employees: context.icp.employee_range?.max ?? null,
        allowed_stages: context.icp.company_stages,
        business_models: context.icp.company_verticals,
      }, { country: contract.geography, vertical: contract.companyVertical })
      : null;

    const gpt = await applyLeadStrategyInitialPlanning({
      workspaceId: input.workspaceId,
      spec: spec as unknown as Parameters<typeof applyLeadStrategyInitialPlanning>[0]["spec"],
      requestedLeadCount: contract.requestedCount,
      companyVertical: contract.companyVertical,
      companyConstraints,
      callModel: input.callModel,
      readEnv: input.readEnv,
    });
    const usedGpt = gpt.specRewritten;
    approved_titles = usedGpt ? [...gpt.spec.keyword_queries] : [...spec.keyword_queries];
    const d = (gpt.diagnostics ?? {}) as Record<string, unknown>;

    artifact = {
      version: QUALIFIED_LEAD_PLAN_VERSION,
      plan_source: usedGpt ? "gpt_validated" : "deterministic_registry",
      strategy: null,
      strategy_hash: null,
      approved_titles,
      contract: { ...contract, hiringRoles: approved_titles },
      fallback_reason: usedGpt ? null : (d.fallback_reason as string | null) ?? "gpt_strategy_not_applied",
      planner: gpt.diagnostics ? safePlannerRecord(d) : null,
      // THE ROUTING DECISIONS TRAVEL WITH THE PLAN. run-agent read these off the
      // adapter's return value when it invoked GPT itself; with planning
      // consolidated here, the artifact is the only carrier they have.
      strategy_plan: usedGpt ? (gpt.resolution?.plan ?? null) : null,
      source_order: (d.source_order as string[] | undefined) ?? [],
      route: (d.route as string | undefined) ?? null,
    };
  } else {
    const outcome = await applyClaudeFirstLeadPlanning({
      workspaceId: input.workspaceId,
      originalInstruction: input.userInstruction,
      spec: spec as unknown as Parameters<typeof applyClaudeFirstLeadPlanning>[0]["spec"],
      missionId: input.missionId ?? `orchestrate:${input.workspaceId}`,
      context,
      requestedLeadCount: contract.requestedCount,
      generate: input.generate,
      readEnv: input.readEnv,
    });

    const usedClaude = outcome.outcome?.source === "claude" && outcome.specRewritten;

    // The titles that will actually be searched: Claude's approved set when its
    // strategy was accepted, the compiled deterministic set otherwise.
    approved_titles = usedClaude
      ? [...outcome.spec.keyword_queries]
      : [...spec.keyword_queries];

    artifact = {
      version: QUALIFIED_LEAD_PLAN_VERSION,
      plan_source: usedClaude ? "claude_validated" : "deterministic_registry",
      strategy: usedClaude ? (outcome.outcome?.strategy ?? null) : null,
      strategy_hash: usedClaude ? (outcome.outcome?.diagnostics.strategy_hash ?? null) : null,
      approved_titles,
      contract: { ...contract, hiringRoles: approved_titles },
      // TRUTHFUL PROVENANCE. A deterministic plan says so, and says why, rather
      // than being displayed as though Claude had produced it.
      fallback_reason: usedClaude ? null : (outcome.outcome?.fallbackReason ?? "claude_first_not_applied"),
      planner: outcome.outcome ? safePlannerRecord(outcome.outcome.diagnostics as unknown as Record<string, unknown>) : null,
    };
  }

  // WHO PLANNED THIS, ON THE PLAN ITSELF. A resumed run reads the persisted plan
  // row and finds the owner there — it never has to re-derive it, which is what
  // makes implicit re-planning impossible rather than merely discouraged.
  artifact.planning_owner = plannerSelection.owner;
  artifact.planned_at = new Date().toISOString();

  const summary = buildQualifiedLeadPlanSummary(artifact.contract, artifact.plan_source);
  const steps = buildQualifiedLeadPlanSteps({
    contract: artifact.contract,
    artifact,
    originalInstruction: input.userInstruction,
    toolInput: input.toolInput ?? null,
  });

  // Hash covers the artifact the runtime will consume, so a continuation can
  // prove it is executing the same plan the user approved.
  (artifact as { artifact_hash?: string }).artifact_hash = await planArtifactHash(artifact);

  return { summary, steps, artifact };
}

/**
 * The planner fields safe to persist on a plan row.
 *
 * Provenance and outcome only. No prompt, no reasoning, no credential, and no
 * raw model response — `bridgeDiagnostics` already produced this shape; this
 * picks the subset a PLAN needs, which is smaller than what a task records.
 */
function safePlannerRecord(d: Record<string, unknown>): Record<string, unknown> {
  return {
    planner_source: d.planner_source ?? null,
    planner_status: d.planner_status ?? null,
    requested_provider: d.requested_provider ?? "anthropic",
    provider: d.provider ?? null,
    model: d.model ?? null,
    model_requests: d.model_requests ?? null,
    token_usage: d.token_usage ?? null,
    latency_ms: d.latency_ms ?? null,
    validation: d.validation ?? null,
    fallback_reason: d.fallback_reason ?? null,
    strategy_hash: d.strategy_hash ?? null,
    approval_required: d.approval_required ?? false,
  };
}
