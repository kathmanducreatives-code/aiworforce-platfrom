// PLANNING A QUALIFIED-LEAD MISSION BEFORE THE PLAN IS PERSISTED.
//
// This is the seam the whole change turns on. It is called from orchestrate, in
// the few lines before `task_plans` is inserted, and it answers one question:
// "is there a validated strategy that should BE the plan?"
//
// WHAT IT DOES NOT DO. It is not a planner, a router or a validator — it calls
// the existing ones:
//
//   routeQualifiedLead            is this a qualified-Lead mission?
//   isClaudeFirstLeadPlanningEnabled  flag + workspace allow-list
//   compileLeadEntityIntent       the canonical Lead contract
//   loadMissionContext            the bounded Company Brain projection
//   applyClaudeFirstLeadPlanning  the ONE Claude planner, with its own schema,
//                                 repair, policy validation and fallback
//   buildQualifiedLeadPlanSteps   renders the already-decided outcome
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
  buildQualifiedLeadPlanSteps, buildQualifiedLeadPlanSummary, planArtifactHash,
  QUALIFIED_LEAD_PLAN_VERSION,
  type AuthoritativePlanSource, type QualifiedLeadPlanArtifact,
  type QualifiedLeadPlanContract, type QualifiedLeadPlanStep,
} from "./leadPlanAuthority.ts";
import type { EnvReader } from "../intelligenceFlags.ts";
import type { GenerateJsonFn } from "../plannerWrapper.ts";

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

  // GATE. Both conditions, exactly as every other intelligence feature.
  const enablement = isClaudeFirstLeadPlanningEnabled(input.workspaceId, input.readEnv);
  if (!enablement.enabled) return null;

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

  // THE ONE PLANNER. Its schema, repair, policy validation, approval gate and
  // deterministic fallback all apply unchanged.
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
  const plan_source: AuthoritativePlanSource = usedClaude ? "claude_validated" : "deterministic_registry";

  // The titles that will actually be searched: Claude's approved set when its
  // strategy was accepted, the compiled deterministic set otherwise.
  const approved_titles = usedClaude
    ? [...outcome.spec.keyword_queries]
    : [...spec.keyword_queries];

  const artifact: QualifiedLeadPlanArtifact = {
    version: QUALIFIED_LEAD_PLAN_VERSION,
    plan_source,
    strategy: usedClaude ? (outcome.outcome?.strategy ?? null) : null,
    strategy_hash: usedClaude ? (outcome.outcome?.diagnostics.strategy_hash ?? null) : null,
    approved_titles,
    contract: { ...contract, hiringRoles: approved_titles },
    // TRUTHFUL PROVENANCE. A deterministic plan says so, and says why, rather
    // than being displayed as though Claude had produced it.
    fallback_reason: usedClaude ? null : (outcome.outcome?.fallbackReason ?? "claude_first_not_applied"),
    planner: outcome.outcome ? safePlannerRecord(outcome.outcome.diagnostics as unknown as Record<string, unknown>) : null,
  };

  const summary = buildQualifiedLeadPlanSummary(artifact.contract, plan_source);
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
