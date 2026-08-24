// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the ohsdatpvfdjdemstoiuj backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, normalizeApifySourceType } from "../_shared/toolRegistry.ts";
import { buildInvoker, readPendingRun } from "../_shared/capabilityExecution.ts";
import { invokeInBackground, describeFailure } from "../_shared/backgroundInvoke.ts";
import { generateText, logProviderCall } from "../_shared/aiProvider.ts";
import { preferredProviderForAgent } from "../_shared/providerRouting.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { renderCompanyBrainBlock } from "../_shared/companyBrainContext.ts";
import { decideWorkspaceAccess } from "../_shared/workspaceAccessGuard.ts";
import {
  isDirectLeadActionAttempt,
  validateDirectLeadActionRequest,
  resolveTaskUserId,
  type DirectLeadActionRequest,
} from "../_shared/leadActionRequestContract.ts";
import { classifyLeadOutcome, summarizeDirectAction } from "../_shared/leadActionOutcome.ts";
import { stepAllowedInMode } from "../_shared/executionMode.ts";
import { parseScoutCandidates, guardScoutToAria, type NormalizedProviderIndex, type ProvenanceCtx } from "../_shared/leadHandoffGuard.ts";
import { newRejectionCounter, buildNoResults, type RejectionCounter } from "../_shared/leadPersistenceGuard.ts";
import { classifyProviderSourceOutcome, type ProviderSourceReason } from "../_shared/leadSourcingGate.ts";
import { resolvePlannedTool, isProviderSourcingTool, resolveProviderSource } from "../_shared/plannedToolResolver.ts";
import { compileLeadEntityIntent, applyMissionEntityAuthority, compileActorPlan, detectRoutingConflict, type LeadEntityIntent, type ProviderActorPlan, type RoutingConflictResult } from "../_shared/leadEntityIntent.ts";
// Compound-intent bridge: detect a company-first request + enforce the
// verified-company CONTACT ceiling. Deterministic company-first sourcing +
// verification live in _shared/compoundSourcingPipeline.ts (unit-tested offline).
import { isCompanyFirstRequest } from "../_shared/runAgentCompoundBridge.ts";
import { executeRunAgentCompanyFirstSourcing } from "../_shared/executeRunAgentCompanyFirstSourcing.ts";
import { compileCompanyBrainContext } from "../_shared/companyBrainCompiler.ts";
import { compileEffectiveCompanyPolicy } from "../_shared/companyBrainEffectivePolicy.ts";
// PHASE 2 — Claude-first INITIAL planning. Gated by CLAUDE_FIRST_LEAD_PLANNING
// *and* an explicit workspace allow-list, so no single environment variable can
// enable it globally. With either absent this is inert: no mission is built, no
// prompt assembled, no model contacted, and the spec below is passed through by
// reference. See _shared/intelligence/leads/leadPlanningBridge.ts.
// NOTE THE ABSENCE. `applyClaudeFirstLeadPlanning` and
// `isClaudeFirstLeadPlanningEnabled` are deliberately NOT imported: run-agent
// holds no lead-planning call site and no planner enablement decision. Only the
// reconstitution helper, the diagnostics reader and the adaptive binding remain,
// none of which can make a model request. Re-adding either name here would
// re-create the second planner this consolidation removed, and the architecture
// tests fail if it happens.
import { adaptiveStrategyBinding, bridgeDiagnostics, claudeFirstFromPersistedPlan, type LeadPlanningBridgeInput } from "../_shared/intelligence/leads/leadPlanningBridge.ts";
// ONE PLANNER, ONE EXECUTION OWNER — see _shared/leadOwnership.ts for what these
// replace. The selector is pure and runs before any adapter is invoked, so a
// flag combination can no longer put two planners on one task.
import { createLeadOwnershipLedger, assertPlannerProvenance, describePlannerProvenance } from "../_shared/leadOwnership.ts";
// Task-level funnel outcomes, recorded apart from provider calls so no Actor is
// credited with numbers several calls produced.
import { createLedgerWriter, recordStageResult } from "../_shared/executionLedger.ts";
import { selectLeadPlannerAdapter } from "../_shared/leadPlannerInterface.ts";
import { loadAuthoritativeLeadPlan } from "../_shared/intelligence/leads/leadPlanAuthority.ts";
// PR #108 — SEQUENTIAL execution of the validated ordered hiring-source plan.
// Gated by DYNAMIC_HIRING_SOURCE_PLANNING *and* an explicit workspace allow-list.
// When either is absent the bridge returns `invokeJobs` UNCHANGED — the same
// function object, so the default path is not merely equivalent to today's
// behavior, it is today's behavior.
import { applySequentialSourceExecution, sequentialSourceDiagnostics } from "../_shared/sequentialSourceBridge.ts";
import { createPlanAwareActionBudget } from "../_shared/planAwareBudgetBinding.ts";
import {
  actorLimitationBriefing, inferRouteFromRequest, newRouteExecutionRecord,
  routeDrift, validateHiringRoute,
} from "../_shared/hiringRouteContract.ts";
import { executeCompanyFirstRoute } from "../_shared/companyFirstRouteExecutor.ts";
import { buildCapabilityGraph } from "../_shared/leadCapabilityGraph.ts";
// GPT chooses the discovery Actors. `validateDiscoveryStrategy` in the engine
// decides which of its choices are allowed; this only supplies the proposal.
import { makeGptDiscoveryPlanner } from "../_shared/gptDiscoveryPlanner.ts";
import { DiscoveryStrategyBlockedError } from "../_shared/leadDiscoveryStrategy.ts";
import { makeGptExecutionPlanner } from "../_shared/gptExecutionPlanner.ts";
import { ModelRoutingLedger } from "../_shared/gptModelRouter.ts";
import { buildLeadRunTrace, describeLeadRunTrace } from "../_shared/leadRunTrace.ts";
import { gptAvailable } from "../_shared/gptProvider.ts";

/** Env reader passed to the GPT layer, so tests can inject one. */
const readEnvSafe = (key: string): string | undefined => {
  try { return Deno.env.get(key); } catch { return undefined; }
};
import {
  legacyLoopReachable, missionRouteRequest, readPersistedLeadMission,
} from "../_shared/leadMissionRuntime.ts";
import {
  CAPABILITY_EXECUTION_STATE_VERSION, compileFirstProviderCall, finalizedProgress,
  missionFunnelFor,
  runCapabilityPlan, summariseEvaluationPaths, toPortfolioCandidates, toRouteResultShape,
  type CapabilityExecutionState, type CapabilityRunResult,
} from "../_shared/leadCapabilityEngine.ts";
import {
  assertPaidExecutionAllowed, buildPaidExecutionPreflight,
} from "../_shared/leadPaidExecutionPreflight.ts";
import {
  createRunTerminalGuard, supabaseTerminalGuardDb,
} from "../_shared/leadRunTerminalGuard.ts";
import {
  readProviderResultItems, resolveResponseKind, structuredRowsLookIntact,
} from "../_shared/providerResponseContract.ts";
import { projectEvaluationRows } from "../_shared/leadWorkbenchProjection.ts";
import { formatFunnel, unbalancedStages } from "../_shared/leadMissionFunnel.ts";
import { buildPortfolio, interpretTargets } from "../_shared/opportunityPortfolio.ts";
// `applyMissionPrecedence`, `buildClassifierPayload`, `parseSemanticFitStrict`
// and `SEMANTIC_INPUT_SCHEMA_VERSION` are no longer imported here: they existed
// to adapt the second semantic evaluator onto the capability engine, which no
// longer accepts one. They remain exported for the legacy company-first route,
// which is a separate execution path and is not part of the Mission pipeline.
import {
  buildCheckpoint, CHECKPOINT_RESERVE_MS, LINEAGE_ROOT_RESULT_KEY,
  lineageRootTaskId, readCheckpointCompanies, type CompanyResumeRecord,
} from "../_shared/leadResumeState.ts";
import { identityIsActionable } from "../_shared/companyIdentityResolution.ts";
import { missionHash } from "../_shared/leadMission.ts";
import {
  selectResearchPlaybooks, playbookSelectionSummary,
} from "../_shared/leadResearchPlaybooks.ts";
import {
  authorizePlaybookExecution, playbookAuthorizationSummary,
} from "../_shared/leadPlaybookExecution.ts";
import {
  projectMissionCompanyRows, missionPersistenceSummary,
  MISSION_PERSISTENCE_PROJECTION_VERSION,
} from "../_shared/leadMissionPersistenceProjection.ts";

/**
 * Reload persisted capability state for a resume.
 *
 * Structural only — `runCapabilityPlan` re-checks `mission_hash` and discards a
 * state that belongs to a different question, so a stale or hand-edited body
 * cannot make the engine continue somebody else's run.
 */
function readCapabilityExecutionState(
  body: Record<string, unknown>,
): CapabilityExecutionState | null {
  const s = body.capability_execution_state;
  if (!s || typeof s !== "object") return null;
  const c = s as Record<string, unknown>;
  return c.version === CAPABILITY_EXECUTION_STATE_VERSION &&
    Array.isArray(c.completed_capabilities)
    ? (s as CapabilityExecutionState)
    : null;
}

/**
 * Per-company work a previous invocation already paid for — LOADED, NOT ACCEPTED.
 *
 * WHAT THIS REPLACES, AND WHY.
 *
 * The previous version read `body.lead_resume_records` and merely re-validated
 * its SHAPE. Shape was never the risk. A caller who is a member of this
 * workspace could send a well-formed record under a real company key carrying
 * someone else's LinkedIn URL, and the engine would restore it as that
 * company's identity — attaching the wrong employer to a real lead — or mark
 * an unbought operation "completed" and suppress a call the run needed.
 *
 * The records now come from the DATABASE, addressed by a task id, and every one
 * of these must hold:
 *
 *   * the parent task exists;
 *   * its `workspace_id` equals the workspace this run is authorised for —
 *     so a task id from another workspace yields nothing, not a cross-tenant read;
 *   * the checkpoint parses at the expected version.
 *
 * The client may therefore say WHICH run to continue. It may not say what that
 * run found. The lineage root is read from the same row, so the operation keys
 * stay stable across the chain without the client being able to move them.
 */
async function loadLeadResumeRecords(
  db: { from: (t: string) => any },
  parentTaskId: string | null,
  workspaceId: string,
): Promise<{
  records: CompanyResumeRecord[];
  lineageRoot: string | null;
  rejection: string | null;
  /** The verified row, for readers that need more than resume records. */
  parentResult: unknown;
}> {
  const none = (rejection: string | null) =>
    ({ records: [], lineageRoot: null, rejection, parentResult: null });
  if (!parentTaskId) return none(null);
  try {
    const { data } = await db.from("tasks")
      .select("id, workspace_id, result").eq("id", parentTaskId).maybeSingle();
    if (!data) return none("resume_parent_task_not_found");
    // THE WORKSPACE CHECK IS THE WHOLE GUARD. Without it a task id is a
    // capability, and task ids travel.
    if (String((data as { workspace_id?: unknown }).workspace_id ?? "") !== String(workspaceId)) {
      console.log("[run-agent][resume][cross-workspace-refused]", {
        parent_task_id: parentTaskId, requested_workspace: workspaceId,
      });
      return none("resume_cross_workspace_refused");
    }
    const result = (data as { result?: unknown }).result ?? null;
    return {
      records: readCheckpointCompanies(result),
      lineageRoot: lineageRootTaskId(parentTaskId, result),
      rejection: null,
      // SAME VERIFIED ROW. Anything reading this has already passed the
      // workspace-ownership check above; there is no second, looser path.
      parentResult: result,
    };
  } catch (e) {
    // A FAILED LOAD IS NOT A LICENCE TO TRUST THE CLIENT. It means nothing is
    // known to be done, so the run re-buys rather than skipping wrongly.
    console.log("[run-agent][resume][load-error]", String(e));
    return none("resume_load_failed");
  }
}

/**
 * Client-supplied fields that are IGNORED, and named when present.
 *
 * None of these is something a browser may decide. The mission, the graph, the
 * provider and every provider input are derived server-side from the task's own
 * plan; a body carrying them is either a stale caller or someone testing what
 * the boundary accepts. Either way the answer is the same, and it is recorded.
 */
const CLIENT_CONTROLLED_FIELDS_IGNORED = [
  "actor_id", "actorId", "actor_key", "selected_actor_key",
  "provider", "providers", "provider_input", "raw_actor_input",
  "compiled_actor_input", "capability_plan", "capability_graph",
  "allowed_providers", "budget", "budget_override", "max_spend",
  "lead_resume_records", "lead_resume_checkpoint",
] as const;

export function rejectedClientFields(body: Record<string, unknown>): string[] {
  return CLIENT_CONTROLLED_FIELDS_IGNORED.filter((k) => body[k] !== undefined);
}

/**
 * The diagnostics shape the existing persistence projection expects.
 *
 * The engine's own telemetry is richer and is persisted separately; this only
 * satisfies the legacy structure so `persistPlan` keeps working unchanged.
 */
function emptyCapabilityDiagnostics(run: CapabilityRunResult): Record<string, unknown> {
  return {
    route: { requested: "lead_mission_v1", validated: "lead_mission_v1",
      executed: run.state.entry_capability, fallback_reason: run.state.fallback_reason },
    capability_outcomes: run.capability_outcomes,
    provider_attempts: run.state.provider_attempts,
    cost: { estimated_max_usd: 0,
      note: "capability engine reports cost in graph units; see capability_execution_state" },
  };
}
import {
  collectCompanyFirstContactIdentities, collectLegacyContactIdentities,
  combineContactIdentities, computeCompanyFirstQuotaProgress, createPersistPlan,
  loadPriorContactIdentities, nextAdaptiveAction, reconcilePriorIdentities,
  type PersistedOutcome,
} from "../_shared/qualifiedLeadPersistence.ts";
import { projectCompanyFirstPersistence } from "../_shared/companyFirstPersistenceProjection.ts";
import { employerGatePasses, verifyCurrentEmployer } from "../_shared/employerVerification.ts";
import {
  buildSemanticClassificationBinding, classificationTaskDiagnostics,
} from "../_shared/semanticClassificationBinding.ts";
import {
  buildGroundedBrainBinding, buildShadowComparison,
} from "../_shared/groundedBrainBinding.ts";
import {
  buildMissionEvaluationBinding, evaluationTaskDiagnostics,
} from "../_shared/missionEvaluationBinding.ts";
import {
  buildMissionTriageBinding, triageTaskDiagnostics,
} from "../_shared/missionTriageBinding.ts";
import { parseMissionEvaluationStrict } from "../_shared/missionEvaluation.ts";
// The SAME sizing function the engine shortlists with, so the evaluation budget
// and the set of companies that can be evaluated are derived from one rule
// rather than two that may drift.
import { resolveInvestigationBudget } from "../_shared/leadInvestigationBudget.ts";
import { buildWorkbenchExplanation } from "../_shared/groundedClaims.ts";
import { buildPoolBinding } from "../_shared/poolEvaluationBinding.ts";
import {
  buildMultiRoundBinding,
} from "../_shared/multiRoundBinding.ts";
import {
  runMultiRoundSourcing, roundSummaryForWorkbench, type RoundExecution,
} from "../_shared/multiRoundController.ts";
import { applyRoundPlanToMission } from "../_shared/roundPlanContract.ts";
import {
  getLeadIntelligenceCapabilities,
} from "../_shared/leadIntelligencePolicy.ts";
import {
  runtimeIdentity, checkContractCompatibility,
} from "../_shared/leadRuntimeIdentity.ts";
import {
  POOL_EVAL_RESULT_KEY, readPoolCheckpoint, buildPoolCheckpoint,
} from "../_shared/poolCheckpoint.ts";
import { SOURCE_EXECUTION_KEY } from "../_shared/sourceExecutionState.ts";
import { FUSION_STATE_KEY } from "../_shared/hiringEvidenceFusion.ts";
import { SOURCE_FEEDBACK_KEY } from "../_shared/sourceFeedbackContract.ts";
import { resolveRequestedLeadCount } from "../_shared/leadQuotaPolicy.ts";
// NOTE THE ABSENCE. `createBroadeningPlanner` (broadeningPlannerAdapter.ts) is
// deliberately NOT imported: it reaches Gemini via Lovable and falls through to
// Anthropic — Claude — whenever ANTHROPIC_API_KEY is set, which it is on TEST.
// Broadening's unauthorized path must make zero model calls of any kind, so it
// uses `deterministicOnlyBroadeningPlanner` instead. Re-adding this import
// would reopen the Claude-fallback path the ownership fix closed.
import { createLeadStrategyPlanner, isGptBroadeningAuthorized, deterministicOnlyBroadeningPlanner } from "../_shared/leadStrategyOwner.ts";
import { projectStrategyMissionSemantics } from "../_shared/leadStrategyContract.ts";
// Same absence, same reason: the GPT adapter is invoked in orchestrate, and only
// its already-decided output is rebuilt here.
import { gptStrategyFromPersistedPlan, isGptLeadStrategyEnabled } from "../_shared/leadStrategyBridge.ts";
// The missing edge between the GPT strategy and the sequential runtime: without
// it the strategist's separate query packs never reach the Actor calls.
import { gptAdaptiveStrategyBinding } from "../_shared/leadStrategyAdaptiveBinding.ts";

import { supabaseToolCallReader } from "../_shared/durableIdempotency.ts";
import { supabaseSourcingStateStore } from "../_shared/companyFirstSourcingState.ts";
import { decideResume, RESUME_REFUSAL_MESSAGE, type ResumableTaskRow } from "../_shared/sourcingContinuation.ts";
import { buildQualifiedLeadRunContext } from "../_shared/qualifiedLeadRunContext.ts";
import { decideClaimAttempt, claimContinuation, claimContinuationViaRpc, releaseContinuationViaRpc, newClaim, releaseClaim, CLAIM_KEY, CLAIM_REFUSAL_MESSAGE, type ContinuationClaim, type ClaimDb, type RpcDb } from "../_shared/continuationClaim.ts";
import {
  decideAutoContinuation, foldSlice, readLineageProgress,
  resolveMaxContinuations, resolveMaxLineageCostUnits,
  AUTO_CONTINUATION_VERSION, LINEAGE_PROGRESS_KEY, type LineageProgress,
} from "../_shared/leadAutoContinuation.ts";
import {
  dispatchContinuation, type DispatchOutcome,
} from "../_shared/leadContinuationDispatch.ts";
import { isFrontier, wasInvestigated } from "../_shared/leadInvestigationBudget.ts";
import { projectStatus, RESUMABLE_ROW_STATUS } from "../_shared/taskStatusContract.ts";
import { compileJobIntent } from "../_shared/jobIntentTaxonomy.ts";
import { emptyCompanyEnrichmentObservability } from "../_shared/companyEnrichmentObservability.ts";
// From the module that OWNS the type. Importing it from
// `runAgentCompanyEnrichment.ts` — even type-only — put that 65 KB module and
// its subtree into the deployment, because the deploy uploads every file in the
// graph whether or not the import is erased at build.
import type { CandidateEnrichmentOutcome } from "../_shared/finalCandidateState.ts";
import { shouldSkipBroadResearch } from "../_shared/broadResearchPolicy.ts";
import type { CompanyEnrichmentObservability } from "../_shared/companyEnrichmentObservability.ts";
import { emptySignalEnrichmentObservability, type SignalEnrichmentObservability } from "../_shared/signalEnrichmentObservability.ts";
import type { TimingAssessment } from "../_shared/timingAssessment.ts";


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
function humanizeApifyError(error: string | null | undefined): string {
  switch (error) {
    case "apify_unauthorized": return "Apify authentication failed";
    case "apify_insufficient_credits": return "the Apify account is out of credits";
    case "actor_missing":
    case "actor_key_unknown":
    case "apify_actor_not_configured":
    case "apify_not_configured": return "the required Apify actor isn't configured";
    default: return "Apify could not run the search";
  }
}

function buildUserMessage(instruction: string, input: string | null | undefined): string {
  if (!input) return `Task: ${instruction}`;
  return `Task: ${instruction}\n\nInput from previous step:\n${input}`;
}

type CompanyBrain = Record<string, unknown> | null;

// Compact, labeled Company Brain summary for agent prompts — name, one-line
// description, ICP, target roles, industries, geography, goals, competitors,
// plus an explicit note when context is missing. Delegates to the shared
// renderer so the block is identical across features and unit-testable.
//
// NOTE: `onboardingCompleted` MUST be the workspace's real flag. Passing a
// hardcoded null here silently suppressed the entire brain block for every
// agent (Scout/Aria/Penn/Hawk/Scribe) — the active brain never reached them.
function renderBrainForAgent(brain: CompanyBrain, onboardingCompleted?: boolean | null): string {
  return renderCompanyBrainBlock(brain as Record<string, unknown>, onboardingCompleted);
}



/**
 * Project a finished company-first task onto its parent plan row.
 *
 * WHY THIS EXISTS. The company-first branch has its own exit, so it never reaches
 * the finalization at the bottom of this file — the only place that writes
 * `task_plans.status`. Every company-first run therefore left the plan on the
 * `executing` it was created with, and the UI, which reads the plan, waited on a
 * transition that was never going to be written.
 *
 * NO SECOND STATUS AUTHORITY. The mapping consumes the `StatusProjection` the
 * caller already computed from `projectStatus`. `task_plans` has no CHECK
 * constraint and its live vocabulary is complete / partial / failed /
 * awaiting_approval / executing, so the three outcomes below are all legal values
 * already in use.
 *
 * `continuation_required` maps to `partial`, never `complete`: the run is
 * resumable and saying otherwise would claim work that has not happened.
 *
 * IDEMPOTENT. Writing the same projection twice is a no-op at the row level, and
 * the guard below stops a second write from resurrecting a plan a later step has
 * already moved on from.
 */
/**
 * Persist the Pilot message that opens the Workbench on the qualified-lead table.
 *
 * ChatView's auto-open hook watches for a MESSAGE carrying
 * `metadata.ui_panel.kind === "lead_results"`, and WorkbenchPanel renders the
 * qualified-lead table only when that panel is present. The company-first path
 * returned the panel on an HTTP response that orchestrate never reads, so neither
 * ever happened.
 *
 * IDEMPOTENT. A continuation or a retried invocation re-finalises the same plan;
 * the guard means the user gets one panel message, not one per attempt.
 *
 * Best-effort: a failure here must never fail the run, which has already done its
 * paid work and written its result.
 */
async function persistLeadResultsPanel(
  db: { from: (t: string) => any },
  planId: string | null | undefined,
  uiPanel: Record<string, unknown>,
  summary: {
    eligible: number; requested: number; rawJobs: number; terminalStatus: string;
    /**
     * The task that owns this Workbench.
     *
     * WITHOUT THIS THE PANEL CANNOT READ ITS OWN PROGRESS. The engine writes
     * stage counts to `tasks.result.workbench_progress`, and the frontend
     * auto-open path builds its selection from THIS metadata. On task 41342269
     * the id was absent, the selection carried `taskId: null`, and a run that had
     * recorded 25 discovered companies displayed "Accounts found: 0".
     */
    taskId?: string | null;
    /**
     * Capability-engine counts. Present ONLY for LeadMissionV1 runs.
     *
     * The legacy `rawJobs` counter belongs to `companyFirstQuotaController`,
     * which does not run on this path — it is structurally 0 here, and reporting
     * it produced "I reviewed 0 raw jobs" for a run that had just read 177
     * embedded YC roles.
     */
    mission?: {
      companies_discovered: number;
      companies_evaluated: number;
      open_jobs_evaluated: number;
      commercially_eligible: number;
      shortlisted: number;
      /** Named separately so "0 qualified" can say WHICH stage stopped it. */
      identities_resolved: number;
      identities_unresolved: number;
      qualified: number;
      contact_ready: number;
    } | null;
  },
): Promise<void> {
  if (!planId) return;
  try {
    const { data: planMsg } = await db.from("messages")
      .select("conversation_id").filter("metadata->>plan_id", "eq", planId).limit(1).maybeSingle();
    const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;
    if (!conversationId) return;

    // One panel per plan. `metadata->ui_panel->>kind` is the same key ChatView
    // keys its auto-open on, so this asks exactly the question that matters.
    const { data: existing } = await db.from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .filter("metadata->>plan_id", "eq", planId)
      .filter("metadata->ui_panel->>kind", "eq", "lead_results")
      .limit(1).maybeSingle();
    if (existing) return;

    // COUNTS STAY SEPARATE. Raw jobs are sourcing evidence; the quota is
    // CONTACT-ready people. Collapsing them is what produced "25 results" for a
    // run that delivered nothing.
    const delivered = `${summary.eligible} of ${summary.requested} CONTACT-ready ${summary.requested === 1 ? "lead" : "leads"}`;
    const m = summary.mission ?? null;
    // THE COUNTS COME FROM THE PATH THAT ACTUALLY RAN.
    //
    // A capability-engine run never touches the legacy quota controller, so its
    // `rawJobs` is structurally zero. Reporting the engine's own numbers is both
    // truthful and useful: it says where the funnel stopped.
    // NAME THE STAGE THAT STOPPED IT.
    //
    // "0 qualified" on its own makes the user do the diagnosis. On task 42e39fb1
    // the honest sentence was available and unsaid: six companies had strong
    // signals and their LinkedIn identities could not be resolved.
    const stalled = m && m.qualified === 0 && m.shortlisted > 0
      ? m.identities_unresolved === m.shortlisted
        ? ` Their LinkedIn company identities could not be resolved, so none reached final qualification.`
        : m.identities_resolved === 0
        ? ` None of them reached an actionable company identity, so verification could not run.`
        : ` ${m.identities_resolved} identities resolved but none passed the Company Brain.`
      : "";
    const evidence = m
      ? `I discovered ${m.companies_discovered} ${m.companies_discovered === 1 ? "company" : "companies"} and ` +
        `evaluated ${m.open_jobs_evaluated} embedded open ` +
        `${m.open_jobs_evaluated === 1 ? "role" : "roles"} across them. ` +
        `${m.commercially_eligible} showed strong commercial expansion signals and ` +
        `${m.shortlisted} ${m.shortlisted === 1 ? "was" : "were"} shortlisted; ` +
        `${m.identities_resolved} ${m.identities_resolved === 1 ? "identity" : "identities"} resolved, ` +
        `${m.qualified} qualified.${stalled}`
      : `I reviewed ${summary.rawJobs} raw job${summary.rawJobs === 1 ? "" : "s"}.`;
    // The shortlisted companies ARE in the Workbench now, as non-actionable
    // evaluation rows — so "nothing produced a lead" is no longer the same
    // claim as "nothing is there to look at".
    const tail = m && m.shortlisted > 0 && summary.eligible === 0
      ? ` The shortlisted ${m.shortlisted === 1 ? "company is" : "companies are"} in Workbench for review, marked not qualified.`
      : summary.eligible > 0 ? "" : " None produced a contact-ready lead yet.";
    const content = `I opened the results in Workbench — ${delivered}. ${evidence}${tail} Nothing was sent.`;

    await db.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      agent_slug: "pilot",
      metadata: {
        ui_panel: uiPanel,
        plan_id: planId,
        // The third link in the ownership chain, and the one that was missing.
        task_id: summary.taskId ?? null,
        agent_id: "pilot",
        workflow_kind: "qualified_lead_sourcing",
        terminal_status: summary.terminalStatus,
        // Evidence counts, kept distinct from the quota on purpose. The legacy
        // job counter is emitted ONLY when the legacy path produced it.
        ...(m ? { mission_counts: m } : { raw_jobs_reviewed: summary.rawJobs }),
        contact_ready_leads: summary.eligible,
        requested_leads: summary.requested,
      },
    });
  } catch (e) {
    console.warn("[run-agent] lead_results panel persistence failed:", e);
  }
}

async function finalizeCompanyFirstPlan(
  db: { from: (t: string) => any },
  planId: string | null | undefined,
  taskId: string,
  agentId: string | null | undefined,
  workspaceId: string,
  statuses: { rowStatus: string; taskStatus: string; terminalStatus: string },
  terminalReason: string,
): Promise<void> {
  if (!planId) return;

  const planStatus = statuses.taskStatus === "completed"
    ? "complete"
    : statuses.taskStatus === "failed"
      ? "failed"
      : "partial";

  try {
    // Only advance a plan that is still running. A plan another step already
    // finalized is left alone, which is what makes a repeated call harmless.
    const { data: current } = await db.from("task_plans")
      .select("status").eq("id", planId).maybeSingle();
    const currentStatus = (current as { status?: string } | null)?.status ?? null;
    if (currentStatus && currentStatus !== "executing" && currentStatus !== planStatus) return;
    if (currentStatus === planStatus) return;

    await db.from("task_plans").update({
      status: planStatus,
      // Only a genuinely finished plan gets a completion time. A resumable one has
      // not completed, and stamping it would make the row lie to every reader.
      ...(planStatus === "complete" || planStatus === "failed"
        ? { completed_at: new Date().toISOString() }
        : {}),
    }).eq("id", planId);

    await db.from("activity_feed").insert({
      workspace_id: workspaceId, plan_id: planId, agent_id: agentId ?? null,
      event_type: planStatus === "partial" ? "plan_checkpointed" : "plan_complete",
      title: planStatus === "partial" ? "Round complete — more rounds available" : `Plan ${planStatus}`,
      body: terminalReason,
      metadata: {
        task_id: taskId, workflow_status: planStatus,
        terminal_status: statuses.terminalStatus, task_status: statuses.taskStatus,
      },
    });
  } catch (e) {
    // The task outcome is already committed; a plan-row write failure must not
    // turn a finished run into a failed one. It is logged, not swallowed silently.
    console.error("[run-agent][company-first] plan finalization failed", {
      plan_id: planId, task_id: taskId, target_status: planStatus,
      message: (e as Error)?.message ?? "unknown",
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Invocation start — anchors the LATENCY-BOUNDED company-enrichment deadline so
  // the workflow always reserves wall-clock to finish qualification/persistence/
  // observability/finalization within the Edge Function limit (never a 504).
  const invocationStartMs = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ══ THE TERMINAL GUARD — A RUN ALWAYS ENDS SOMEWHERE ════════════════════════
  //
  // TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec sat in `running` with
  // `updated_at == created_at`: the row was created and never touched again,
  // because this function was killed mid-Actor-call and every status write lives
  // AFTER the work. The plan showed Running indefinitely and the only way to
  // learn what happened was to read the tool-call ledger by hand.
  //
  // The guard's writer runs in `finally`, so a throw, an early return, a
  // deadline stop and a clean completion all leave terminal rows. It READS the
  // current row first and never overwrites a status the handler already wrote,
  // so the forty existing exit paths keep their own, more specific outcomes.
  const terminalGuard = createRunTerminalGuard(supabaseTerminalGuardDb(supabase as never), {
    log: (m, meta) => console.log("[run-agent][terminal-guard]", m, meta),
    onWriteError: (e) => console.error("[run-agent][terminal-guard][write-error]", String(e)),
  });

  // EVERYTHING BELOW RUNS INSIDE THE GUARD.
  //
  // Deliberately NOT re-indented. Re-indenting 4,000 lines would bury a
  // correctness change inside a whitespace diff nobody could review, and this
  // file's own history is the argument: the transport defect survived because a
  // real change was invisible among mechanical ones. The guarded region ends at
  // the matching marker immediately above this handler's closing brace.
  const guardedResponse = await terminalGuard.run(async () => {

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const plan_id: string | undefined = body.plan_id ?? body.task_plan_id;
  const step_index: number | undefined = body.step_index;
  let agent_slug: string | undefined = body.agent_slug;
  const agent_id_in: string | undefined = body.agent_id;
  const workspace_id: string | undefined = body.workspace_id;
  const user_id: string | undefined = body.user_id;
  const instruction: string | undefined = body.instruction;
  const input: string | null | undefined = body.input ?? null;
  const needs_approval: boolean = body.needs_approval === true;
  const tool_input_body: any = body.tool_input ?? null;
  const execution_mode_body: string | undefined = body.execution_mode;
  // WHICH RUN TO CONTINUE — an ID, never the findings themselves. The records
  // are loaded from the database below, after the workspace is verified.
  const leadResumeParentTaskId: string | null =
    typeof body.lead_resume_parent_task_id === "string" && body.lead_resume_parent_task_id
      ? body.lead_resume_parent_task_id
      : (typeof body.continuation_of_task_id === "string" && body.continuation_of_task_id
        ? body.continuation_of_task_id
        // ── A SAME-ROW CONTINUATION IS ITS OWN PARENT ────────────────────
        //
        // The two fields above assume the pre-mission shape: a NEW task row
        // pointing back at the one it continues. The auto-continuation reuses
        // the SAME row — `resume_task_id` — so neither was ever set and
        // `loadLeadResumeRecords` was handed null.
        //
        // Task b4eb3710 is what that costs. Three slices ran and every one
        // logged `records: 0` and `already_investigated: 0`, with the frontier
        // sitting at 89 → 88 → 89. Each continuation re-ran discovery, re-ran
        // triage, and took a FIRST slice of ten from a frontier that never
        // advanced. Qualified went 3 → 5 on the luck of the ranking, not
        // because anything resumed.
        //
        // The checkpoint it needs is on that very row.
        : (typeof body.resume_task_id === "string" && body.resume_task_id
          ? body.resume_task_id
          : null));
  const ignoredClientFields = rejectedClientFields(body as Record<string, unknown>);
  if (ignoredClientFields.length > 0) {
    console.log("[run-agent][client-fields-ignored]", { fields: ignoredClientFields });
  }
  // orchestrate threads the plan step's required tool here (index.ts kickoff). It
  // was previously never read — the root cause of the Scout-fallback failure, where
  // a source_with_apify step whose tool_input carried no tool_name fell through to
  // the generic LLM. Read it now so provider-sourcing steps are routed + gated.
  const tool_needed_body: string | null = body.tool_needed ?? null;
  // CONTINUATION. `continuation_required` writes a checkpoint into
  // tasks.result.company_first_state; resuming must reuse THAT task so the
  // controller finds the checkpoint. Inserting a new task would silently restart
  // round 1 and re-pay for provider calls that already completed.
  const resume_task_id: string | undefined = body.resume_task_id ?? body.continuation_token ?? undefined;

  // ---- Request-mode routing --------------------------------------------------
  // A DIRECT Workbench lead action must be recognised BEFORE the plan-step gate:
  // it legitimately has no plan_id / step_index / caller instruction, and forcing
  // it to invent them would either reject a valid action or push fabricated
  // orchestration metadata into the task trace.
  const isDirectLeadAction = isDirectLeadActionAttempt(tool_input_body);
  let directRequest: DirectLeadActionRequest | null = null;

  if (isDirectLeadAction) {
    const validated = validateDirectLeadActionRequest({ workspace_id, tool_input: tool_input_body });
    if (!validated.ok) {
      return json({ success: false, error: validated.error_code, message: validated.message }, validated.status);
    }
    directRequest = validated.request;
    // Derived internally — never trusted from the browser.
    agent_slug = directRequest.agent_slug;
  } else if (!plan_id || step_index === undefined || (!agent_slug && !agent_id_in) || !workspace_id || !instruction) {
    // Orchestrated plan steps keep their existing contract, unchanged.
    return json({ error: "missing_required_fields" }, 400);
  }

  // Both modes require a workspace by this point (direct validated it as a UUID,
  // orchestrated required it above); restated so it narrows for the code below.
  if (!workspace_id) return json({ error: "missing_required_fields" }, 400);

  const effectiveInstruction: string = directRequest ? directRequest.instruction : instruction!;

  // ---- Workspace access guard ------------------------------------------------
  // orchestrate calls with the SERVICE_ROLE bearer (already gated the user). A
  // direct browser call carries a user JWT and MUST be a member of workspace_id,
  // so a frontend-supplied workspace_id cannot reach another workspace's brain.
  let authenticatedUserId: string | null = null;
  // Derived ONLY from the actual Authorization bearer — never from the body — and
  // hoisted because task attribution below must know whether this is a system
  // call. See resolveTaskUserId's trust-boundary note.
  let bearerIsServiceRole = false;
  {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    bearerIsServiceRole = !!bearer && bearer === serviceRoleKey;

    let isMember = false;
    if (!bearerIsServiceRole) {
      try {
        const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await userClient.auth.getUser(bearer);
        authenticatedUserId = userData?.user?.id ?? null;
        if (authenticatedUserId) {
          const { data: member } = await supabase
            .from("workspace_members").select("workspace_id")
            .eq("workspace_id", workspace_id).eq("user_id", authenticatedUserId).maybeSingle();
          isMember = !!member;
        }
      } catch (_e) { /* treated as unauthenticated below */ }
    }

    const access = decideWorkspaceAccess({ bearerIsServiceRole, authenticatedUserId, isMember });
    if (!access.ok) return json({ error: access.error }, access.status);
  }

  // Resolve agent (by slug, falling back to id) WITHIN THIS WORKSPACE.
  //
  // ── WHY THE WORKSPACE FILTER IS NOT OPTIONAL ───────────────────────────────
  //
  // This query used to match on `slug` alone. That worked only because every
  // agent lived in a single sentinel workspace, so `scout` identified exactly
  // one row globally. Seeding agents per workspace — the fix for users seeing an
  // empty roster — made slugs deliberately non-unique across workspaces, and
  // `maybeSingle()` errors the moment two rows match:
  //
  //   404 agent_not_found / "JSON object requested, multiple (or no) rows returned"
  //
  // which is what stalled every run once a second workspace existed. The
  // unique index is on (workspace_id, slug), so scoping here restores the
  // "exactly one row" the query always assumed.
  //
  // It is also an ISOLATION fix, and would be right even if only one row
  // matched: an unscoped lookup can resolve `scout` to another workspace's
  // agent row and run this step under it. `workspace_id` is validated as
  // present above, before this point, so there is no path where this filter is
  // silently absent.
  let agentQuery = supabase.from("agents")
    .select("id, slug, name, model, role_prompt, department")
    .eq("workspace_id", workspace_id);
  if (agent_slug) agentQuery = agentQuery.eq("slug", agent_slug);
  else agentQuery = agentQuery.eq("id", agent_id_in!);
  const { data: agent, error: agentErr } = await agentQuery.maybeSingle();

  if (agentErr || !agent) {
    console.error("[run-agent] agent not found:", { agent_slug, agent_id_in, agentErr });
    return json({ error: "agent_not_found", details: agentErr?.message }, 404);
  }
  agent_slug = agent.slug ?? agent_slug;

  // Insert task row with real columns. `tasks.user_id` is NOT NULL: orchestrate
  // threads body.user_id, but the direct Workbench action only carries a JWT, so
  // fall back to the user the workspace guard already authenticated. Passing null
  // here is what produced the 500 task_insert_failed / "0/4 succeeded" incident.
  // body.user_id is honoured ONLY for verified service-role callers; a browser
  // request is always attributed to its JWT user, so a spoofed body.user_id has
  // no effect.
  const taskUserId = resolveTaskUserId({ bearerIsServiceRole, bodyUserId: user_id, authenticatedUserId });
  if (!taskUserId) {
    return json({ success: false, error: "unidentified_user", message: "Sign in again to run this action." }, 401);
  }

  // RESUME PATH. A continuation reuses the checkpointed task; only a fresh run
  // inserts. Refusals are explicit — a bad token never degrades into a new
  // (billable) round-1 run.
  let task: { id: string } | null = null;
  // The lease taken on the RPC path lives in COLUMNS, so it must be released
  // explicitly when the round ends. Held here because the claim is taken in this
  // block but released after the sourcing outcome is written, far below.
  let heldClaim: { claimId: string; viaRpc: boolean } | null = null;
  // THE RESUMED ROW'S OWN RESULT. A same-row continuation's engine state and
  // checkpoint live here, not in the request body — see the `state:` argument
  // to `runCapabilityPlan`.
  let resumedTaskResult: Record<string, unknown> = {};
  if (resume_task_id) {
    const { data: existing } = await supabase
      .from("tasks").select("id, workspace_id, status, result, payload")
      .eq("id", resume_task_id).maybeSingle();
    const decision = decideResume(existing as ResumableTaskRow | null, workspace_id, resume_task_id);
    if (!decision.ok) {
      return json({ success: false, error: "continuation_refused", reason: decision.reason, message: RESUME_REFUSAL_MESSAGE[decision.reason] }, 409);
    }

    // SERVER-SIDE CONCURRENCY CONTROL. Frontend double-click guarding cannot see
    // a second tab, a retry, or a poll racing the click — so the claim is taken
    // here, as a compare-and-swap on the status we just read.
    const priorResult = ((existing as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>;
    resumedTaskResult = priorResult;
    const observedStatus = String((existing as { status?: string } | null)?.status ?? "");
    const held = priorResult[CLAIM_KEY] as ContinuationClaim | undefined;
    const attempt = decideClaimAttempt(held ?? null, Date.now());
    if (!attempt.ok) {
      return json({
        success: false, error: "continuation_refused", reason: attempt.reason,
        message: CLAIM_REFUSAL_MESSAGE[attempt.reason], held_since: attempt.heldSince ?? null,
      }, 409);
    }

    const claimId = crypto.randomUUID();
    const claim = newClaim(claimId, new Date().toISOString(), decision.nextRound);

    // DURABLE PATH FIRST. `claim_sourcing_continuation` takes SELECT … FOR UPDATE
    // before deciding, so even two stale reclaimers are serialised. It reports
    // `available: false` when its migration has not been applied, in which case
    // the conditional update below is used — that fallback is exclusive for a
    // LIVE claim but not for two simultaneous stale reclaims.
    const rpc = await claimContinuationViaRpc({
      db: supabase as unknown as RpcDb,
      taskId: decision.taskId, workspaceId: workspace_id, claimId,
    });
    if (rpc.available && !rpc.claimed) {
      // FAIL CLOSED. A conflict, a permission/RLS refusal, a timeout or an
      // unexpected response all stop here — only a genuinely missing function
      // reaches the weaker compatibility path below.
      console.error("[run-agent][company-first] claim refused", {
        task_id: decision.taskId, claim_path: "rpc",
        claim_error_category: rpc.category, claim_error_code: rpc.code,
      });
      return json({
        success: false, error: "continuation_refused", reason: rpc.reason,
        message: CLAIM_REFUSAL_MESSAGE[rpc.reason], held_until: rpc.heldUntil,
        claim_path: "rpc", claim_error_category: rpc.category,
      }, rpc.reason === "not_permitted" ? 403 : 409);
    }

    // COMPATIBILITY PATH — reached only when the RPC's migration is absent. It
    // moves `ready → running`, so a task that is not advertising itself as
    // resumable cannot be claimed by it either.
    const cas = rpc.available
      ? { claimed: true as const }
      : await claimContinuation({
          db: supabase as unknown as ClaimDb,
          taskId: decision.taskId,
          observedStatus,
          resultWithClaim: { ...priorResult, [CLAIM_KEY]: claim },
        });
    if (!cas.claimed) {
      console.error("[run-agent][company-first] claim refused", {
        task_id: decision.taskId, claim_path: "compatibility_fallback",
        claim_error_category: "conflict", claim_error_code: null,
      });
      // Another invocation moved the status first. It owns this checkpoint; this
      // one must NOT run it, or the same round is paid for twice.
      return json({
        success: false, error: "continuation_refused", reason: cas.reason,
        message: CLAIM_REFUSAL_MESSAGE[cas.reason],
        claim_path: "compatibility_fallback", claim_error_category: "conflict",
      }, 409);
    }

    task = { id: decision.taskId };
    heldClaim = { claimId, viaRpc: rpc.available };
    console.log("[run-agent][company-first] resuming task", {
      task_id: decision.taskId, next_round: decision.nextRound,
      claim: attempt.reason, claim_path: rpc.available ? "rpc" : "compatibility_fallback",
    });
  }

  if (!task) {
    const { data: inserted, error: taskErr } = await supabase
      .from("tasks")
      .insert({
        plan_id: plan_id ?? null,
        agent_slug,
        user_id: taskUserId,
        workspace_id,
        status: "running",
        payload: { instruction: effectiveInstruction, input, step_index: step_index ?? null, lead_action: directRequest?.action ?? null },
      })
      .select("id")
      .single();

    if (taskErr || !inserted) {
      console.error("[run-agent] failed to insert task:", taskErr);
      return json({ error: "task_insert_failed", details: taskErr?.message }, 500);
    }
    task = inserted as { id: string };
  }

  // THE GUARD NOW KNOWS WHICH ROWS TO FINALIZE. Bound at the first point both
  // ids exist — before any paid boundary, so a kill during discovery still
  // leaves a terminal task and plan rather than the pair that hung on
  // task c8a6e53d.
  terminalGuard.bind({ taskId: task.id, planId: plan_id ?? null });

  await supabase.from("activity_feed").insert({
    workspace_id,
    plan_id,
    agent_id: agent.id,
    event_type: "agent_started",
    title: `${agent.name} started`,
    body: effectiveInstruction,
    metadata: { step_index, task_id: task.id, agent_slug },
  });

  // ---- Live Workbench lead actions (Research company / Find decision-makers /
  // Generate outreach). Additive early-return: only runs when the caller passes
  // tool_input.lead_action + lead_candidate_ids. Evidence-first + approval-gated;
  // Firecrawl/Apify are called per-company via runTool; nothing is ever sent.
  // ── LEAD ACTIONS MOVED TO `run-lead-action` ─────────────────────────────
  //
  // The Workbench per-row unlock path executed here. It was extracted because
  // `run-agent` reached 5.33 MB against a 5 MB platform limit and could not
  // deploy: `leadActionExecutor` pulls 24 modules — the `workbench` opener
  // generation, the `decisionMaker` people search, contact enrichment — that the
  // sourcing engine never touches, and vice versa. Two entry points with
  // disjoint dependency graphs were sharing one deployment unit.
  //
  // The request is still RECOGNISED here and refused explicitly. A silent
  // fall-through would drop a lead action into the orchestrated path, which
  // would reject it for missing `plan_id`/`instruction` and report a confusing
  // contract error instead of the one fact that matters: this endpoint moved.
  if (directRequest) {
    await supabase.from("tasks").update({
      status: "failed", error_message: "lead_action_endpoint_moved",
    }).eq("id", task.id);
    return json({
      success: false,
      task_id: task.id,
      error: "lead_action_endpoint_moved",
      message: "Workbench lead actions are served by `run-lead-action`.",
    }, 410);
  }

  // Past the direct-action early return, this is the ORCHESTRATED path only, where
  // the plan-step gate above already guaranteed an instruction. Restated so it
  // narrows for the rest of the function.
  if (instruction === undefined) return json({ error: "missing_required_fields" }, 400);

  // Load company_brain. `onboarding_completed` gates whether the ACTIVE brain
  // is injected into the agent prompt (see renderBrainForAgent).
  const { data: brainRow } = await supabase
    .from("company_brain")
    .select("profile, onboarding_completed")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const brain = (brainRow?.profile ?? null) as CompanyBrain;
  const brainOnboardingCompleted = (brainRow as { onboarding_completed?: boolean } | null)?.onboarding_completed === true;

  // Inject a compact, labeled brain summary (not the raw JSON). We omit
  // companyBrain from getAgentorySystemPrompt so it doesn't add its own
  // JSON-trimmed block, then append the labeled summary once.
  const brainBlock = renderBrainForAgent(brain, brainOnboardingCompleted);
  const systemPrompt = `${agent.role_prompt ?? `You are ${agent.name}.`}\n\n${getAgentorySystemPrompt({
    taskType: "agent_execution",
    currentAgent: agent_slug ?? agent.slug ?? undefined,
    actorRegistrySummary: summarizeRegistryForPrompt(),
  })}\n\n${brainBlock}`;

  // --- Tool layer: hawk + scout get live tools (Firecrawl scrape, Apify sourcing). Broad web search is optional. ---
  let toolContext: string | null = null;
  let scrapedContext: string | null = null;
  let apifyContext: string | null = null;
  const toolNotices: string[] = [];
  // Set when an explicitly-selected Apify sourcing actor can't run (auth/config/
  // credits). Triggers a clean plan failure + in-chat error card — never a fake
  // "complete" with zero leads.
  // Attempt log from the adaptive multi-attempt sourcing loop (Scout step).
  // Sanitized per-attempt audit (label, fingerprint, official actor input, actor
  // key/impl, raw/accepted counts). Provider-safe: NEVER contains tokens/keys.
  // Immutable ENTITY intent (compiled from the ORIGINAL user instruction) + its
  // actor plan + any routing conflict. The authoritative "what entity did the user
  // request?" — planner-rewritten Scout prose can never change it.
  let routingEntityIntent: LeadEntityIntent | null = null;
  let routingActorPlan: ProviderActorPlan | null = null;
  let routingConflict: RoutingConflictResult | null = null;
  // Set when an Apify sourcing actor RAN successfully but accepted 0 qualified
  // leads (not a tool failure). We then skip Aria — there is nothing to rank.
  let zeroAcceptedSourcing = false;
  let sourcingAttemptsCount = 0;
  // Provider-provenance rejections accumulated during persistence; surfaced in the
  // no_results terminal payload. Broad scope so the finalizer can read it.
  const provenanceRejections: RejectionCounter = newRejectionCounter();
  // Provider-provenance: the immutable index of accepted provider items + run
  // context, built during sourcing and read at the Scout→Aria hand-off so an
  // LLM-invented company/person/URL can never reach Aria or persistence.
  let providerIndexForHandoff: NormalizedProviderIndex | null = null;
  let providerProvenanceCtx: ProvenanceCtx | null = null;
  // Section 10: the ACCEPTED normalized provider PEOPLE, carried as Aria candidates
  // so a person target hands the provider PersonCandidates to Aria DIRECTLY — the
  // LLM narrative may annotate but can never invent a parallel identity pool nor
  // shrink the pool by under-listing sourced people.
  // AI Source Planner artifacts (carried into the Scout task result so the final
  // step can render Workbench Insights + a definitive process narrative).
  // Candidate-decision observability (funnel + sanitized per-candidate diagnostics).
  // Broad scope so success / partial_results / no_results terminals can all surface
  // it. Reports the source→qualification→persistence path; never changes policy.
  // Company enrichment observability (Phase 2, Section 8). Initialized to an
  // empty reconciling object so EVERY terminal (success / partial / no_results /
  // tool_failed) carries it even when enrichment never ran.
  let companyEnrichmentObservability: CompanyEnrichmentObservability = emptyCompanyEnrichmentObservability(0);
  // Candidate ids that gained verified company evidence but whose fit/timing is
  // STILL insufficient (e.g. a Hot founder proven on firmographics with no timing
  // signal). These are force-staged at the persistence gate — never accepted.
  let companyEnrichmentStaged = new Set<string>();
  // Phase B — structured hiring-signal timing. Populated after company enrichment;
  // read by the persistence gate and the canonical final-state reducer. Timing
  // sufficient NEVER means qualify_now; missing stages; contradicted rejects.
  let signalEnrichmentObservability: SignalEnrichmentObservability = emptySignalEnrichmentObservability(0);
  let timingByCandidate = new Map<string, TimingAssessment>();
  let signalTimingStaged = new Set<string>();
  // Post-enrichment truth per candidate (sufficiency verdict + real remaining gaps +
  // company outcome). Feeds the canonical final-state reducer so the qualification
  // diagnostics agree with the company observability.
  let enrichmentByCandidate = new Map<string, CandidateEnrichmentOutcome>();
  // Source-gate funnel evidence (Section 3/4): normalized candidate count + the
  // sanitized diagnostics for candidates rejected BEFORE qualification.
  let runNormalizedCount = 0;
  let runSourceGateRejectedDiag: Array<Record<string, unknown>> = [];
  // Find Leads provider *identity* sourcing recognition (from the authoritative
  // tool markers, incl. body.tool_needed). Used to (a) route the step into the
  // provider path and (b) fail closed — never let the generic LLM be a lead source.
  const isProviderSourcingStep = isProviderSourcingTool({
    tool_needed: tool_needed_body,
    tool_name: tool_input_body?.tool_name ?? null,
    selected_actor_key: tool_input_body?.selected_actor_key ?? null,
  });
  // Structured reason when a provider-sourcing step yields zero provider-backed
  // candidates; surfaced in the no_results terminal.
  let providerSourceReason: ProviderSourceReason | null = null;

  if (agent_slug === "hawk" || agent_slug === "scout") {
    const baseCtx = {
      admin: supabase,
      workspace_id,
      agent_slug,
      agent_id: agent.id,
      agent_name: agent.name,
      plan_id,
      task_id: task.id,
      // Resolved attribution, not the raw body value: the orchestrated path is
      // reachable from a browser too, so it must honour the same trust boundary.
      user_id: taskUserId,
    };

    // 1) Firecrawl scrape — if instruction/input contains URLs.
    const urlRe = /https?:\/\/[^\s)\]"'<>]+/g;
    const haystack = `${instruction ?? ""}\n${input ?? ""}`;
    const urls = Array.from(new Set((haystack.match(urlRe) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))).slice(0, 3);

    if (urls.length > 0) {
      const blocks: string[] = [];
      for (const u of urls) {
        const r = await runTool("scrape_url", { url: u, extraction_goal: instruction, max_pages: 1 }, baseCtx);
        if (r.ok && r.data) {
          const d = r.data as { source_url?: string; title?: string; markdown?: string; summary?: string };
          blocks.push(`SOURCE: ${d.source_url ?? u}${d.title ? ` — ${d.title}` : ""}${d.summary ? `\nSUMMARY: ${d.summary}` : ""}\n\n${d.markdown ?? ""}`);
        } else if (r.unavailable) {
          toolNotices.push(`Firecrawl unavailable for ${u} (${r.error ?? "not configured"}).`);
        } else if (!r.ok) {
          toolNotices.push(`Scrape failed for ${u}: ${r.error ?? "unknown"}.`);
        }
      }
      if (blocks.length > 0) {
        scrapedContext = `SCRAPED CONTENT (Firecrawl):\n\n${blocks.join("\n\n---\n\n")}`;
      }
    }

    // 2) Apify sourcing — only when the planner explicitly selected an Apify tool/actor,
    //    or (legacy path) when no tool_input was supplied and the instruction looks like sourcing.
    const sourcingRe = /\b(find|source|sourcing|discover|prospects?|leads?|founders?|companies|hiring|job openings|roles|recruit(?:ers?|ing)|candidates?|engineers?|marketers?|linkedin posts?|comments?)\b/i;
    const planned_actor_key: string | null = tool_input_body?.selected_actor_key ?? null;
    const planned_tool_name: string | null = tool_input_body?.tool_name ?? null;
    // Canonical tool resolution — precedence: body.tool_needed > plan-step tool_needed
    // > tool_input.tool_name > tool_input.selected_actor_key. Honours the plan step's
    // tool even when the AI-planned tool_input omits tool_name (the live root cause:
    // a source_with_apify step fell through to the generic LLM and fabricated leads).
    const plannedTool = resolvePlannedTool({
      tool_needed: tool_needed_body,
      tool_name: planned_tool_name,
      selected_actor_key: planned_actor_key,
    });
    const isFirecrawlSelected = plannedTool.tool === "scrape_url";
    const isApifySelected = plannedTool.tool === "source_with_apify";
    const shouldUseApify = !isFirecrawlSelected && (
      isApifySelected
      || (!tool_input_body && sourcingRe.test(`${instruction ?? ""} ${input ?? ""}`))
    );

    if (shouldUseApify) {
      const raw_source_type: string | null = tool_input_body?.source_type ?? null;
      let source_type = normalizeApifySourceType(raw_source_type);
      // Deterministic intent → source/actor selection when the planner did not pin an
      // explicit source_type/actor. A founder/person/decision-maker ask MUST run the
      // people actor, never a jobs scraper (the live mis-route). resolveProviderSource
      // never consults the Company Brain, so buying signals cannot silently convert a
      // person-search request into a jobs-search request. Ambiguous asks keep the
      // normalized default (jobs) — behavior unchanged, never fabricated.
      let derivedActorKey: string | null = null;
      // Enter the deterministic entity-intent router when either (a) the caller
      // did not pin an actor/source (the original condition), OR (b) the top-
      // level body explicitly declares a qualified-Lead / company-first
      // contract. This closes the seam where an upstream classifier (e.g.
      // pilot-chat's `company_hiring_sourcing` branch) pins `apify_jobs` /
      // `jobs` before the qualified-Lead route is evaluated: without this
      // widening, `routingEntityIntent` stays null and the company-first
      // branch at line 686 is unreachable regardless of `body.workflow_kind`.
      const bodyDeclaresCompanyFirst =
        body.workflow_kind === "qualified_lead_sourcing" ||
        execution_mode_body === "company_first" ||
        tool_input_body?.workflow_kind === "qualified_lead_sourcing" ||
        tool_input_body?.execution_mode === "company_first";
      // ── THE MISSION IS ITSELF A ROUTING DECISION ───────────────────────────
      //
      // Read BEFORE the gate, because its PRESENCE is what decides the route.
      //
      // This is the defect the 2026-08-12 forensic run exposed (plan
      // 16952bd6, mission_parser_source "gpt_validated", confidence 0.99).
      // pilot-chat's deterministic classifier pinned
      // `source_type: "jobs"` + `selected_actor_key: "apify_jobs"` and
      // `execution_mode: "fast"`, so every disjunct below was false:
      // `bodyDeclaresCompanyFirst` because "fast" is not "company_first", and
      // `(!raw_source_type && !planned_actor_key)` because both were pinned.
      // `routingEntityIntent` stayed null, the company-first branch was
      // unreachable, and a valid Mission sat unused in the plan record while
      // the legacy Claude planner sourced and the legacy Brain ICP qualified.
      //
      // A compiled LeadMissionV1 is the semantic authority for the run. An
      // actor a classifier pinned upstream is a suggestion; it must not be
      // able to route the Mission out of its own architecture.
      const routingMission = readPersistedLeadMission(
        tool_input_body, (body as Record<string, unknown>).lead_mission);
      if (routingMission || bodyDeclaresCompanyFirst || (!raw_source_type && !planned_actor_key)) {
        // ROUTE FROM THE ORIGINAL USER INSTRUCTION, not the planner-rewritten Scout
        // prose. Compile the immutable entity intent (person/company/job) and select
        // the primary identity actor from it — "hiring signals" the planner injects
        // can never flip a founder (person) request to the jobs actor (plan da79cba3).
        // `input` carries the original user_instruction (orchestrate threads it);
        // fall back to `instruction` only for a direct run-agent call.
        // The DTO's provider-input half is still compiled from the instruction —
        // bounding a provider query is deterministic work this architecture
        // keeps. Its SEMANTIC half is not: `target_entity` decides the actor and
        // the persistable artifact, and the canonical Mission already answered
        // that from the same sentence. `applyMissionEntityAuthority` overlays the
        // Mission's answer, so execution stops re-interpreting the query.
        // (`routingMission` is read above the gate — its presence is what
        // routed us here in the first place.)
        const entityIntent = applyMissionEntityAuthority(
          compileLeadEntityIntent(input ?? instruction ?? ""),
          routingMission,
        );
        routingEntityIntent = entityIntent;
        const ENTITY_SOURCE: Record<string, { source_type: string; actor_key: string }> = {
          person: { source_type: "people_profiles", actor_key: "apify_people_search" },
          job: { source_type: "hiring_signal", actor_key: "apify_jobs" },
          company: { source_type: "company_search", actor_key: "apify_jobs" },
        };
        const byEntity = ENTITY_SOURCE[entityIntent.target_entity];
        if (byEntity && !entityIntent.clarification_required) {
          source_type = byEntity.source_type;
          derivedActorKey = byEntity.actor_key;
        } else if (!routingMission) {
          // AMBIGUITY RESOLUTION, LEGACY PATH ONLY.
          //
          // This re-reads the instruction to guess a provider source. With a
          // Mission that can no longer happen, and not by convention: the
          // Mission decides `target_entity`, ENTITY_SOURCE has an entry for all
          // three of its values, and `applyMissionEntityAuthority` clears
          // `clarification_required` — so the branch above always takes it. The
          // `!routingMission` guard makes that a rule rather than a coincidence
          // that a future edit could quietly break.
          const resolvedSource = resolveProviderSource(input ?? instruction ?? "");
          if (resolvedSource) { source_type = resolvedSource.source_type; derivedActorKey = resolvedSource.actor_key; }
        }
        routingActorPlan = compileActorPlan(entityIntent, "original_user_instruction");
        // Routing-conflict guard (defense in depth): the selected actor must be able
        // to yield the intent's expected final artifact.
        routingConflict = detectRoutingConflict(entityIntent, planned_actor_key ?? derivedActorKey);
        // Compound-intent (company-first) decision: a "founders of <company-type>
        // [hiring <role>]" request must verify the company FIRST and gate CONTACT on
        // it. Surfaced here for observability; the deterministic company-first
        // sourcing + verified-company CONTACT ceiling live in _shared and are the
        // path the (bounded) live TEST run exercises.
        console.log("[run-agent] entity routing", { target_entity: entityIntent.target_entity, output_type: entityIntent.output_type, actor_key: planned_actor_key ?? derivedActorKey, clarification_required: entityIntent.clarification_required, conflict: !!routingConflict, execution_mode: entityIntent.execution_mode, company_first: isCompanyFirstRequest(entityIntent), company_gate_required: entityIntent.company_gate_required, requested_person_role: entityIntent.requested_person_role });
      }

      // Do not call any provider when a routing conflict was detected (the selected
      // actor cannot yield the intent's expected artifact) — fail closed, 0 calls.
      const shouldRun = (agent_slug === "scout" || agent_slug === "hawk") && !routingConflict;

      // ---- COMPANY-FIRST compound path -----------------------------------------
      // A "founders of <company-type> [hiring <role>]" request is sourced COMPANY-
      // FIRST: real bounded jobs actor → verify/dedupe companies → real scoped
      // people actor per verified company → current-employer verification →
      // evidence binding → hard gates → safe persistence (PR #85 writer). The
      // ordinary independent people-first branch is SKIPPED (return below), and
      // there is NO generic founder fallback. Deterministic logic + adapters are
      // unit-tested offline; the live actor/persistence behavior is what the
      // bounded TEST run confirms.
      if (shouldRun && routingEntityIntent && isCompanyFirstRequest(routingEntityIntent)) {
        const cfIntent = routingEntityIntent;
        console.log("[run-agent][company-first] executing", { requested_person_role: cfIntent.requested_person_role, workspace: workspace_id });

        // EVIDENCE MODE: `defer_persistence: true` is set at the TOP level of the
        // tool input — that is where runTool checks it before writeMemoryFromToolCall
        // turns provider output into accounts/lead_candidates. Without it the
        // 2026-07-25 live run wrote 20 unqualified companies into the Lead Library
        // while the company gate was still rejecting all 25 jobs.
        // `envelope` is already the COMPLETE source_with_apify tool input built by
        // buildProviderEnvelope: wrapper controls (selected_actor_key,
        // defer_persistence, max_results) at the TOP level — which is the only place
        // toolRegistry reads them — and the actor-native payload under `input`.
        // Re-nesting max_results under `input` is what made the 2026-07-25 run send
        // an unfiltered LinkedIn search, so the envelope is passed through verbatim.
        // OWNERSHIP TRAVELS WITH EVERY PAID CALL. Stamped in the two wrappers
        // rather than at each of the ~dozen envelope construction sites, so a new
        // caller cannot forget it. The values are READ from the authoritative
        // ledger built earlier in this handler — this does not re-derive
        // ownership, and it cannot disagree with it.
        const auditOwnership = (): Record<string, unknown> => {
          const snap = leadOwnership.snapshot();
          return {
            execution_owner: snap.execution_owner,
            planner_owner: snap.plan_provenance?.owner ?? snap.planning_owner,
            planner_adapter: snap.plan_provenance?.adapter ?? null,
            planner_outcome: snap.plan_provenance?.outcome ?? null,
            planner_fallback_reason: snap.plan_provenance?.fallback_reason ?? null,
          };
        };
        // ── THE SHARED EXECUTION SEAM ──────────────────────────────────
        //
        // Provider dispatch, credits, the ledger and the response contract, in
        // one place both Lead routes call — and, from Phase 3F, monitoring too.
        //
        // The envelope this replaces was written out TWICE in this file, byte
        // for byte: once for the capability engine and once for the
        // company-first route. Every field in it has a production incident
        // behind it, and a third copy for monitoring is exactly the second
        // provider stack the convergence exists to prevent.
        const capabilityInvoke = buildInvoker({
          runTool,
          toolCtx: baseCtx,
          // Re-read per call: planning can fall back to a different adapter
          // partway through a run.
          auditOwnership,
          persistenceAuthority: "capability_engine",
          log: (msg, meta) => console.error(`[run-agent][${msg}]`, meta),
        });

        const invokeJobs = async (envelope: Record<string, unknown>): Promise<unknown[]> => {
          const rr = await runTool("source_with_apify", { ...envelope, ...auditOwnership() }, baseCtx);
          if (!rr.ok || !rr.data) {
            // THE FAILURE DATA TRAVELS WITH THE ERROR. A RUNNING Apify run comes
            // back as `!ok` carrying its run_id and dataset_id; throwing a bare
            // string discarded both and abandoned a paid run (TEST run
            // rWikfnKgnp5DazDYr). The engine reads these off the error to record
            // the run as pending and resume it later.
            const err = new Error(rr.error ?? "jobs_actor_failed") as Error & {
              toolResult?: unknown;
            };
            err.toolResult = rr.data ?? null;
            throw err;
          }
          // READ THROUGH THE CONTRACT, NOT A FIELD NAME.
          //
          // This read `data.items` only. The structured-company branch of
          // `runTool` returns its rows under `company_items` and used to set
          // `items: []`, so every company-details call through the capability
          // engine received ZERO rows — a defect that was live and unnoticed
          // because identity resolution never produced a URL to enrich.
          // `readProviderResultItems` reads whichever the contract populated.
          const kind = resolveResponseKind({
            actorKey: (envelope.selected_actor_key as string | null) ?? null,
            actorId: (envelope.actor_id as string | null) ?? null,
            sourceType: (rr.data as { normalized_source_type?: string }).normalized_source_type ?? null,
          });
          const items = readProviderResultItems(rr.data as Record<string, unknown>, kind);
          // A STRUCTURED RESPONSE THAT ARRIVED JOB-NORMALIZED IS A TRANSPORT BUG,
          // not an empty result. Saying so here is what would have caught task
          // 41342269 in the log instead of six hours later in a CSV diff.
          if (kind === "structured_companies") {
            const shape = structuredRowsLookIntact(items);
            if (!shape.intact) {
              console.error("[run-agent][provider-response][shape-violation]", {
                actor_id: envelope.actor_id, reason: shape.reason,
              });
            }
          }
          return items;
        };
        const invokePeople = async (envelope: Record<string, unknown>): Promise<unknown[]> => {
          const rr = await runTool("source_with_apify", { ...envelope, ...auditOwnership() }, baseCtx);
          const items = rr.ok && rr.data ? (rr.data as { items?: unknown[] }).items : [];
          return Array.isArray(items) ? items : [];
        };
        // CANONICAL PERSISTENCE. Extracted to `qualifiedLeadPersistence.ts` so
        // the same function this handler runs can be exercised by a test with an
        // isolated client. Behaviour, SQL and ordering are unchanged.
        const persistPlan = createPersistPlan({
          db: supabase as never, workspaceId: workspace_id, planId: plan_id ?? null,
        });

        // FINAL-LEAD QUOTA — explicit request wins; otherwise the lead-sourcing
        // default. Deliberately NOT DEFAULT_COMPOUND_LIMITS.rawJobs: that is a
        // provider fetch cap, and conflating the two is what made a 25-raw-job
        // batch look like a satisfied 25-lead request.
        //
        // THE LAST RESORT IS THE MISSION, NOT A RE-READ OF THE SENTENCE. The
        // final carrier here used to be `cfIntent.requested_count`, which is
        // `resolveRequestedCount(text)` — a regex scanning the instruction for a
        // number, one layer below the threaded quota. It could quietly disagree
        // with the count the Mission recorded from the same words. The Mission's
        // `requested_count` is nullable on purpose: null means the user asked
        // for no number, and `resolveRequestedLeadCount` then applies the ONE
        // lead-sourcing default rather than anything inventing its own.
        const quotaMission = readPersistedLeadMission(
          tool_input_body, (body as Record<string, unknown>).lead_mission);
        const quota = resolveRequestedLeadCount({
          explicit: (body.requested_lead_count ?? tool_input_body?.requested_lead_count
            ?? quotaMission?.requested_count) as number | null | undefined,
          isLeadSourcingWorkflow: true,
        });

        // ══ ROUND-TO-ROUND BROADENING OWNER — EXPLICITLY AUTHORIZED ══════════
        //
        // A separate capability from initial planning (which moved entirely to
        // orchestrate; run-agent invokes no initial-planning adapter). This is a
        // recovery decision made DURING execution — "quota is short, may another
        // round of titles be proposed?" — and belongs to the execution owner.
        //
        // Authorization requires BOTH the workflow/execution-mode shape AND the
        // same GPT_LEAD_STRATEGY flag + workspace allow-list initial planning
        // already uses (no new flag invented). The shape check alone used to be
        // treated as sufficient, and because `workflow` defaults to
        // "qualified_lead_sourcing" here when the caller omits it, that was
        // satisfied by nearly every company-first task regardless of whether the
        // flag was ever turned on for the workspace.
        //
        // Unauthorized means ZERO model calls, not a fallback to a different
        // model family: `deterministicOnlyBroadeningPlanner` never reaches
        // Gemini or Claude, unlike the module it replaces here. See
        // leadStrategyOwner.ts for why that mattered on TEST specifically.
        //
        // Either way the planner only PROPOSES titles: each proposal is
        // re-validated deterministically (`validateRoundPlan`, unchanged) and
        // cost-approved before any paid call, and any failure falls back to the
        // same deterministic ladder authorization would have landed on anyway.
        const gptBroadeningAuthorized = isGptBroadeningAuthorized({
          workflow: (body.workflow_kind as string) ?? "qualified_lead_sourcing",
          executionMode: "company_first",
          gptStrategyEnabled: isGptLeadStrategyEnabled(workspace_id).enabled,
        });
        const broadeningPlanner = gptBroadeningAuthorized
          ? createLeadStrategyPlanner({
            workspaceId: workspace_id,
            agentSlug: agent_slug,
            // R2: the SEMANTIC constraints are projected from the canonical
            // mission, not re-read from the spec. Everything else here is still
            // the spec's structural shape (titles, geography, vertical), which
            // is what the strategist prompt needs.
            //
            // `readPersistedLeadMission` is pure and reads data already on the
            // request, so calling it here — before the main read at ~1535 —
            // costs nothing and closes the ordering gap that left this call site
            // without a mission to project from.
            mission: projectStrategyMissionSemantics({
              original_query: String(cfIntent.job_search_spec.original_query ?? ""),
              requested_lead_count: quota.requestedLeadCount,
              requested_titles: cfIntent.job_search_spec.keyword_queries ?? [],
              decision_maker_roles: cfIntent.job_search_spec.requested_person_roles ?? [],
              geography: cfIntent.job_search_spec.location ?? null,
              company_vertical: cfIntent.job_search_spec.company_vertical
                ? String(cfIntent.job_search_spec.company_vertical)
                : null,
              company_size: null,
              maturity_stages: [],
            }, readPersistedLeadMission(tool_input_body, (body as Record<string, unknown>).lead_mission)),
          })
          : deterministicOnlyBroadeningPlanner();
        console.log("[run-agent][broadening-owner]", {
          task_id: task.id,
          owner: gptBroadeningAuthorized ? "openai_lead_strategy" : "deterministic_only",
        });


        // CLAUDE-FIRST INITIAL PLANNING. Proposes the role keywords for round one;
        // everything downstream is unchanged. A validated Claude strategy replaces
        // `keyword_queries` only — person roles, location, country and vertical are
        // carried through untouched, so the planner cannot redefine who we contact
        // or where. Any failure, timeout, policy violation or approval requirement
        // returns the deterministic spec, which is exactly today's behavior.
        // EXACTLY ONE INITIAL PLANNER REQUEST PER RUN.
        //
        // When orchestrate planned this mission before persisting the plan, the
        // validated strategy travels with the request. Planning it again here
        // would be a second paid Anthropic call for a question already answered —
        // and could answer it differently, so the plan on screen and the plan
        // executing would diverge. The persisted artifact wins.
        // ══ THE PLAN IS LOADED, NEVER MADE, IN THIS FUNCTION ═════════════════
        //
        // Body first, then the persisted plan row. The row fallback is what
        // closes the resume window: a continuation's body is rebuilt from a
        // token and carries no artifact, so a body-only read returned null and
        // the task planned AGAIN — with whichever adapter the flags happened to
        // select, not the one that produced the plan the user approved.
        //
        // The durable copy already existed on `task_plans.steps[].metadata`; it
        // simply was not consulted. Consulting it makes a plan immutable for the
        // life of a run.
        const leadPlanLoad = await loadAuthoritativeLeadPlan({
          bodyArtifact: body.qualified_lead_plan ?? null,
          planId: plan_id ?? null,
          readPlanSteps: async (id) => {
            const { data } = await supabase
              .from("task_plans").select("steps").eq("id", id).maybeSingle();
            return (data as { steps?: unknown } | null)?.steps ?? null;
          },
        });
        const leadPlanArtifact = leadPlanLoad.artifact;
        console.log("[run-agent][lead-plan-artifact]", {
          task_id: task.id,
          source: leadPlanLoad.source,
          plan_source: leadPlanArtifact?.plan_source ?? null,
          planning_owner: leadPlanArtifact?.planning_owner ?? null,
          missing_reason: leadPlanLoad.missing_reason,
        });

        // ══ THIS FUNCTION NO LONGER OWNS A PLANNER CALL SITE ═════════════════
        //
        // Two adapters used to be invoked here, 1,200 lines apart, and the second
        // was conditioned on the FIRST CALL'S RESULT rather than on whether the
        // first had run — so an ordinary GPT fallback let Claude make a second
        // model call for one task. The previous phase collapsed that to one
        // selection; this phase moves the INVOCATION itself out.
        //
        // Planning happens once, in `planQualifiedLeadBeforePersistence`, which
        // is the only place in the codebase that calls a lead-planning adapter.
        // The selector still runs here, but with `hasPersistedPlan` reflecting a
        // real loaded artifact it can only ever resolve to
        // `persisted_plan_artifact_v1` (a task that was planned) or
        // `deterministic_registry_v1` (one that was not). Both GPT and Claude are
        // structurally unreachable from this function.
        const leadOwnership = createLeadOwnershipLedger(task.id);
        const plannerSelection = selectLeadPlannerAdapter({
          hasPersistedPlan: leadPlanArtifact !== null,
          // FORCED FALSE, and that is the point. These two are what would let a
          // model adapter be named here. The plan for a lead task is made in
          // orchestrate or it is not made at all; run-agent may reuse a plan or
          // fall back deterministically, never plan.
          strategyOwnerApplies: false,
          gptEnabled: false,
          claudeEnabled: false,
        });
        leadOwnership.claimPlanning(plannerSelection.owner, plannerSelection.reason);
        for (const n of plannerSelection.notSelected) leadOwnership.decline(n.owner, n.reason);

        // ── HOW THE PLAN WAS MADE, NOT JUST THAT IT WAS REPLAYED ────────────
        //
        // `plannerSelection.owner` is `persisted_plan_artifact_v1` for every
        // planned task, which is true but useless for debugging — it says the
        // plan was reused and nothing about which adapter produced it, or
        // whether that adapter succeeded or degraded.
        //
        // The artifact carries its own provenance, so a resumed run reports
        // exactly what the run that planned it reported. A task planned before
        // provenance existed, or never planned at all, records the ladder as
        // having been selected directly — which for an unplanned task is the
        // literal truth.
        const planProvenance = leadPlanArtifact?.planner_provenance
          ?? assertPlannerProvenance({
            owner: leadPlanArtifact ? "persisted_plan_artifact_v1" : "deterministic_registry_v1",
            adapter: "none",
            outcome: "selected_directly",
            fallback_reason: null,
          });
        leadOwnership.recordPlanProvenance(planProvenance);
        console.log("[run-agent][planner-owner]", {
          task_id: task.id,
          planning_owner: plannerSelection.owner,
          reason: plannerSelection.reason,
          not_selected: plannerSelection.notSelected,
          plan_provenance: planProvenance,
          provenance_description: describePlannerProvenance(planProvenance),
        });

        // AUTHORITATIVE INITIAL STRATEGY (gated path only).
        //
        // On workflow = qualified_lead_sourcing + execution_mode = company_first,
        // the OpenAI strategy owner — Luna, escalating once to Terra, then the
        // deterministic plan — owns round-one titles. It runs BEFORE the legacy
        // Claude-first bridge and, when it produces a validated strategy, that
        // bridge is not consulted at all: one workflow, one strategy authority.
        // THE COMPANY BRAIN IS COMPILED BEFORE THE STRATEGIST RUNS.
        //
        // It used to be compiled ~60 lines BELOW this point, which is the
        // structural reason the strategist envelope was thin: at the moment GPT
        // was asked to plan sourcing, the workspace's ICP did not yet exist in
        // this scope, so `missionFromSpec` could only send `company_size: null`.
        // `brain`/`brainRow` are loaded at the top of the handler, so nothing in
        // this block depends on the code it moved above.
        const brainIcpCtx = compileCompanyBrainContext({ workspace_id, profile: brain as unknown as Record<string, unknown> });
        const effectivePolicy = await compileEffectiveCompanyPolicy({
          industries: brainIcpCtx.icp.industries,
          categories: brainIcpCtx.icp.categories,
          business_models: brainIcpCtx.icp.business_models,
          company_size_min: brainIcpCtx.icp.company_size_min ?? null,
          company_size_max: brainIcpCtx.icp.company_size_max ?? null,
          maturity_stage: brainIcpCtx.icp.maturity_stage,
          target_customer_segments: brainIcpCtx.icp.target_customer_segments,
          disqualifier_industries: brainIcpCtx.disqualifiers?.industries ?? [],
          disqualifier_company_types: brainIcpCtx.disqualifiers?.company_types ?? [],
          disqualifier_keywords: brainIcpCtx.disqualifiers?.keywords ?? [],
          brainVersion: (brainRow as { updated_at?: string } | null)?.updated_at ?? null,
        });
        const brainEnforced = effectivePolicy.provenance.hard_constraints.length > 0;

        // ══ RECONSTITUTED, NEVER RE-PLANNED ══════════════════════════════════
        //
        // run-agent used to INVOKE the GPT adapter here. It no longer holds a
        // lead-planning call site at all: planning happens once, in
        // `planQualifiedLeadBeforePersistence`, and what arrives here is the
        // artifact that call produced.
        //
        // `gptStrategyFromPersistedPlan` rebuilds exactly the shape the eleven
        // downstream readers below already expect — spec rewrite, source order,
        // route, and the validated plan `gptAdaptiveStrategyBinding` consumes —
        // with `model_requests: 0`, which is what distinguishes reusing a plan
        // from making a second one.
        //
        // Null unless the artifact says GPT planned it, so a Claude-planned or
        // deterministic task reads exactly as it did before.
        const gptStrategy = (leadPlanArtifact?.plan_source === "gpt_validated")
          ? gptStrategyFromPersistedPlan(
            leadPlanArtifact,
            cfIntent.job_search_spec as unknown as Record<string, unknown>,
          )
          : null;
        // ── VALIDATED HIRING ROUTE ──────────────────────────────────────────
        // GPT chooses the route and the source order; this validates that
        // choice deterministically before anything executes. A broad job board
        // now requires a structured reason, which is what stops the old
        // broad-job-first default reasserting itself for a tight ICP.
        const requestedSourceOrder: string[] =
          (gptStrategy?.diagnostics?.source_order as string[] | undefined) ?? [];
        // THE REQUEST TEXT, FROM EVERY CARRIER THE PLAN USES.
        //
        // Production plans never populate `tool_input.user_request`. They carry
        // the user's words in the top-level `instruction`, in `tool_input.query`
        // and in the top-level `input`.
        //
        // Reading only `user_request` resolved to null on every real plan, and
        // `inferRouteFromRequest(null)` returns `general_company_first`. A startup
        // mission therefore lost its route SILENTLY — no error, just the wrong
        // sources. Proven on production task
        // a090311d-4d08-4cb8-895b-516e9135b803 (plan
        // 15c385c3-fc88-43ff-a531-fb714a234875), whose tool_input carries 18
        // fields and no `user_request`, and which ran Indeed -> LinkedIn Jobs ->
        // Glassdoor for a SaaS-startup query.
        //
        // PREFERRING ONE CARRIER WAS STILL WRONG. `instruction` is the PLANNER'S
        // REWRITE, not the user's words, and the rewrite drops company stage. On
        // TEST task 8af17651-5fa2-48e2-af87-4bc923146243 (plan
        // c2cf285d-fa72-43fe-9506-33195aefadf3) the user asked for "founders of
        // SaaS startups hiring Sales Operations" while `instruction` read "Find 5
        // jobs matching: Sales Operations OR Revenue Operations OR ...". Only
        // `input` still carried the word "startups", so ranking `instruction`
        // first resolved the mission to `general_company_first` ->
        // harvestapi/linkedin-company-search (0 rows) and then two broad
        // LinkedIn Jobs rounds: 50 raw jobs, 0 qualified leads.
        //
        // Route inference is a NARROW company-stage marker scan, so the sound
        // reading is the UNION of every carrier rather than a priority winner. A
        // stage marker in ANY carrier is genuine evidence of startup intent, and
        // choosing exactly one carrier is what keeps losing it.
        //
        // ══ AND ONLY WHEN THERE IS NO MISSION ════════════════════════════════
        // A task carrying a `LeadMissionV1` was interpreted ONCE, upstream, from
        // the user's own words. Re-deriving intent here would recreate the very
        // disagreement the mission exists to remove, so for those tasks every
        // carrier is ignored and the persisted mission is the only authority.
        // The union below survives solely for tasks planned before missions
        // existed.
        const persistedMission = readPersistedLeadMission(
          tool_input_body, (body as Record<string, unknown>).lead_mission);
        const missionPlan = persistedMission ? buildCapabilityGraph(persistedMission) : null;
        console.log("[run-agent][lead-mission]", {
          task_id: task.id,
          has_mission: persistedMission !== null,
          mission_version: persistedMission?.version ?? null,
          mission_type: persistedMission?.mission_type ?? null,
          requested_output: persistedMission?.requested_output ?? null,
          entry_capability: missionPlan?.entry_capability ?? null,
          capabilities: missionPlan?.steps.map((s) => s.capability) ?? null,
          allowed_providers: missionPlan?.allowed_providers ?? null,
          // The compatibility path is a fact worth seeing, not an implementation
          // detail: it is the only way carrier inference can still run.
          authority: persistedMission ? "lead_mission_v1" : "legacy_carrier_union",
        });

        // ── WHICH RESEARCH PLAYBOOK THIS MISSION ASKS FOR ───────────────────
        //
        // `mission.strategies` — the model's declared research shape — had no
        // consumer at all before the playbook boundary, so a mission asking to
        // be researched through social posts or news was indistinguishable in
        // the logs from one asking for a company-profile search, and the shape
        // that was never attempted left no trace.
        //
        // The selection is computed once here and travels to the paid preflight
        // as an AUTHORIZATION. See `authorizePlaybookExecution` for what it
        // governs: a hiring-only selection, and nothing else in this phase.
        const playbookSelection = persistedMission
          ? selectResearchPlaybooks(persistedMission)
          : null;
        const playbookAuthorization = (persistedMission && playbookSelection)
          ? authorizePlaybookExecution(playbookSelection, missionPlan, persistedMission)
          : null;
        if (playbookSelection) {
          console.log("[run-agent][playbook-selection]", {
            task_id: task.id,
            ...playbookSelectionSummary(playbookSelection),
          });
        }
        if (playbookAuthorization) {
          console.log("[run-agent][playbook-authorization]", {
            task_id: task.id,
            ...playbookAuthorizationSummary(playbookAuthorization),
          });
        }

        const routeUserRequest: string | null = persistedMission
          ? persistedMission.original_user_query
          : [
            tool_input_body?.user_request as string | undefined,
            input ?? undefined,
            instruction,
            tool_input_body?.query as string | undefined,
          ].filter((c): c is string => typeof c === "string" && c.trim().length > 0)
            .join("\n") || null;
        const routeResolution = persistedMission
          // The mission already decided this. `validateHiringRoute` is called
          // only to compile the legacy source order the executor still consumes,
          // and it is given the mission's route — never a re-inference.
          ? validateHiringRoute({
            ...missionRouteRequest(persistedMission),
            source_order: missionPlan?.allowed_providers ?? [],
          }, { userRequest: persistedMission.original_user_query })
          : validateHiringRoute({
            route: (gptStrategy?.diagnostics as Record<string, unknown> | undefined)?.route as string
              ?? inferRouteFromRequest(routeUserRequest),
            source_order: requestedSourceOrder,
            fallback_reason:
              (gptStrategy?.diagnostics?.fallback_reason as string | undefined) ?? null,
          }, { userRequest: routeUserRequest });
        const routeRecord = routeResolution.ok
          ? newRouteExecutionRecord(routeResolution, requestedSourceOrder)
          : null;
        console.log("[run-agent][hiring-route]", {
          task_id: task.id,
          ok: routeResolution.ok,
          requested: routeResolution.requested_route,
          validated: routeResolution.ok ? routeResolution.validated_route : null,
          source_order: routeResolution.ok ? routeResolution.validated_source_order : null,
          fallback_reason: routeResolution.ok ? routeResolution.fallback_reason : null,
          repairs: routeResolution.ok ? routeResolution.repairs : routeResolution.errors,
          // The limitation briefing GPT was given, by count — the content itself
          // travels in the strategist context, not only in a prompt hash.
          actor_limitation_briefing_size: actorLimitationBriefing().length,
        });

        if (gptStrategy?.diagnostics) {
          console.log("[run-agent][lead-strategy-initial]", {
            task_id: task.id,
            authority: gptStrategy.diagnostics.authority,
            model: gptStrategy.diagnostics.model,
            packs: gptStrategy.diagnostics.query_pack_ids,
            sources: gptStrategy.diagnostics.source_order,
            plan_hash: gptStrategy.diagnostics.plan_hash,
            fallback_reason: gptStrategy.diagnostics.fallback_reason,
          });
        }

        // ══ COMPANY-FIRST EXECUTION ══════════════════════════════════════════
        // The validated route now DRIVES execution. For a tight ICP this reaches
        // memo23 first; broad job boards are only reachable through the
        // fallback route, which requires a recorded structured reason.
        let companyFirstRoute: Awaited<ReturnType<typeof executeCompanyFirstRoute>> | null = null;
        let companyFirstPersisted = 0;
        let companyFirstQuotaCredit = 0;
        let companyFirstProjection: Record<string, number> | null = null;
        let companyFirstQuotaProgress:
          ReturnType<typeof computeCompanyFirstQuotaProgress> | null = null;
        let companyFirstAdaptive: ReturnType<typeof nextAdaptiveAction> | null = null;
        let companyFirstIdentities: ReturnType<typeof collectCompanyFirstContactIdentities> | null = null;
        let combinedQuota: ReturnType<typeof combineContactIdentities> | null = null;
        let legacySourcingRan = false;
        let legacySkipReason: string | null = null;
        let legacyBlockedCalls = 0;
        // ══ RESUME STATE, FROM CANONICAL PERSISTENCE ═════════════════════════
        // Loaded BEFORE any paid provider boundary, so a resumed task that has
        // already met its quota spends nothing. The source of truth is the
        // lead_candidates rows persistPlan wrote — never the request body, which
        // no caller populates and which a stale client could otherwise use to
        // inflate quota and stop a task early.
        const priorContactState = await loadPriorContactIdentities(
          supabase as never,
          { workspaceId: workspace_id, planId: plan_id ?? null, taskId: task.id },
        );
        const priorReconciled = reconcilePriorIdentities(
          priorContactState,
          (body.resumed_contact_identities ?? null) as string[] | null,
        );
        const priorLegacyContactIdentities: string[] = priorReconciled.identities;
        console.log("[run-agent][prior-contact-state]", {
          task_id: task.id,
          prior_contact_credit: priorLegacyContactIdentities.length,
          scanned_rows: priorContactState.scanned_rows,
          unidentifiable: priorContactState.unidentifiable,
          ignored_request_identities: priorReconciled.ignored_request_identities,
          lookup_error: priorContactState.error,
          // Digests only — never a raw lead or contact identifier.
          identity_digests: priorContactState.identity_digests,
          source: priorContactState.source,
        });
        // PRE-LOOP RESUME STOP. Prior CONTACT credit is canonical persisted
        // state, so a resumed task whose quota is already met performs ZERO
        // discovery, enrichment, job-search, founder and contact calls. This is
        // checked before the FIRST paid boundary, not after it.
        const priorQuotaProgress = computeCompanyFirstQuotaProgress({
          persisted: [],
          legacyContactIdentities: priorLegacyContactIdentities,
          requestedQuota: quota.requestedLeadCount,
        });
        const priorDecision = nextAdaptiveAction(priorQuotaProgress);
        const resumeSatisfied = priorDecision.action === "stop_quota_satisfied";
        console.log("[run-agent][resume-precheck]", {
          task_id: task.id,
          prior_contact_credit: priorQuotaProgress.deduplicated_contact_credit,
          requested_quota: quota.requestedLeadCount,
          remaining_quota: priorQuotaProgress.remaining_quota,
          decision: priorDecision.action, reason: priorDecision.reason,
          company_first_will_run: !resumeSatisfied,
        });

        // SEMANTIC CLASSIFICATION BINDING. Constructed here rather than further
        // down because the capability engine is what consults it: an UNKNOWN
        // Company Brain verdict is resolved, not rejected, and this is the thing
        // that resolves it. OFF by default — both SEMANTIC_COMPANY_CLASSIFICATION
        // and the workspace allow-list must pass.
        const classificationBinding = buildSemanticClassificationBinding({
          workspaceId: workspace_id,
          requestedLeadCount: quota.requestedLeadCount,
        });

        // ── THE MISSION EVALUATOR ────────────────────────────────────────────
        //
        // THE SEMANTIC AUTHORITY FOR QUALIFICATION, and the reason this block
        // exists at all: the evaluator was built, tested and committed without
        // ever being constructed in production. `deps.evaluateMission` was
        // supplied only by test fixtures, so every live company fell to the
        // no-evaluator branch and the pre-Phase-4 classifier kept deciding.
        //
        // ── THE EVALUATOR BUDGET IS THE INVESTIGATION BUDGET ────────────────
        //
        // It used to be `shortlistSize(quota.requestedLeadCount)` —
        // `min(10, max(5, requested * 2))` — which is the requested lead count
        // deciding how many companies a model may read. That is the coupling
        // `leadInvestigationBudget` was written to break, and it survived here
        // because the comment above ("Budget is the SHORTLIST, not the requested
        // count") described an intent the code did not implement: the helper it
        // called takes the requested count as its only input.
        //
        // Only shortlisted companies are ever resolved and enriched, so only
        // they can be evaluated. This binding is built BEFORE the engine runs,
        // so it takes the COUNT budget — the upper bound on what could be
        // investigated. The wall clock can only reduce the real shortlist, so
        // an allowance sized here is never too small, and the engine's own
        // `gpt_budget.evaluation_budget` records what it actually needed.
        // ── ONE LEDGER FOR EVERY MODEL DECISION THIS RUN MAKES ─────────────
        //
        // Which model ran which stage is spread across six modules, and a cost
        // regression and a quality regression look identical without it: both
        // read as "the bill went up" or "the answers got worse", and only the
        // routing decision says which one somebody chose.
        const modelRouting = new ModelRoutingLedger();
        const missionEvaluationBinding = buildMissionEvaluationBinding({
          workspaceId: workspace_id,
          requestedCount: quota.requestedLeadCount,
          shortlistSize: resolveInvestigationBudget({
            requestedCount: quota.requestedLeadCount,
            // The discovery ceiling, not MAX_SAFE_INTEGER: the pool bound is
            // meaningful and passing infinity made `pool_bound` unreachable.
            poolSize: Math.max(10, quota.requestedLeadCount * 10),
          }).budget,
        });
        console.log("[run-agent][mission-evaluation][binding]", {
          task_id: task.id, ...missionEvaluationBinding.diagnostics,
        });
        // ACROSS ROUNDS, NOT PER ROUND. A multi-round run must not buy the
        // allowance again each time it broadens; the cap is what one TASK may
        // spend, which is the number the diagnostics report.
        let evaluationCallsMade = 0;
        let evaluationCompaniesEvaluated = 0;
        let evaluationBudgetExhausted = false;

        // ── STAGE 2: GPT MISSION INTELLIGENCE ────────────────────────────────
        //
        // The FREE stage that decides where the paid stages spend. It replaces
        // a substring match over a fixed role vocabulary — the thing that
        // excluded ML Engineer, Founding Engineer and Member of Technical Staff
        // from a Mission asking for software engineers, before any model was
        // consulted and before any evidence was bought.
        //
        // Batched, so a hundred candidates cost a handful of cheap calls. Off by
        // default: with the flag down no call is made and the deterministic
        // prequalification verdict stands exactly as it does today.
        const triageBinding = buildMissionTriageBinding({
          workspaceId: workspace_id,
          poolSize: Math.max(10, quota.requestedLeadCount * 10),
          // THE ROUTER'S SIGNAL. Triage is the same work at any quota; what the
          // quota changes is whether a misordering costs a position or a lead.
          requestedCount: quota.requestedLeadCount,
        });
        console.log("[run-agent][mission-triage][binding]", {
          task_id: task.id, ...triageBinding.diagnostics,
        });
        let triageBatchesMade = 0;

        // ── THE GROUNDED COMPANY BRAIN ───────────────────────────────────────
        //
        // A SEPARATE flag from the classifier, because it answers a separate
        // question: not "may we interpret this company?" but "may an
        // interpretation change what qualifies?". Off, nothing here runs. In
        // `shadow` it runs, is verified, and is recorded WITHOUT touching the
        // user-facing decision. Only `enforce` lets it decide.
        //
        // NO EXTRA BUDGET. It draws on the classification allowance rather than
        // adding one, so a grounded run cannot cost more than an ungrounded run
        // was already permitted to.
        const groundedBinding = buildGroundedBrainBinding({
          workspaceId: workspace_id,
          originalUserQuery: persistedMission?.original_user_query ?? null,
          missionDirectives: persistedMission?.directives
            ? {
              hard_constraints: persistedMission.hard_constraints,
              soft_preferences: persistedMission.soft_preferences,
              execution_preference: persistedMission.directives.execution_preference ?? "balanced",
              ...persistedMission.directives,
            }
            : null,
          callsRemaining: classificationBinding.classificationCallsRemaining,
        });
        console.log("[run-agent][grounded-brain][binding]", {
          task_id: task.id, ...groundedBinding.diagnostics,
        });

        // ── STAGE 2: FULL-POOL EVALUATION AND RANKING ────────────────────────
        // Separate flags from the grounded Brain, because they are separate
        // risks: one changes how many companies are assessed, the other changes
        // what the user sees first. Off, `evaluateBatch` and `rankPool` are null
        // and the engine keeps the per-company path exactly as it was.
        const poolBinding = buildPoolBinding({
          workspaceId: workspace_id,
          originalUserQuery: persistedMission?.original_user_query ?? null,
          missionDirectives: (persistedMission?.directives ?? null) as never,
        });
        console.log("[run-agent][stage2][binding]", {
          task_id: task.id, ...poolBinding.diagnostics,
        });

        // ── STAGE 4: MULTI-ROUND SOURCING ───────────────────────────────────
        // Its own flag, because it is its own risk: this one decides how many
        // times a run may SPEND on discovery. Off, `planNextRound` is null and
        // the run stays exactly single-round.
        // ── THE CANONICAL ANSWER, RESOLVED ONCE ─────────────────────────────
        // Five stages used to answer this independently and could disagree.
        // This is now the single record of what architecture the workspace is
        // in, and the preflight refuses to spend on a partial one.
        const intelligence = getLeadIntelligenceCapabilities(workspace_id);
        console.log("[run-agent][intelligence-policy]", {
          task_id: task.id, mode: intelligence.mode,
          stages: intelligence.stages,
          missing_required: intelligence.missing_required,
          reason: intelligence.reason,
        });

        // ── WHICH BUILD IS EXECUTING, AND MAY IT ACT ON THIS PLAN? ──────────
        //
        // The contract is mandatory ONLY under `new_architecture`. A workspace
        // deliberately on the deterministic path has no compiled mission and
        // therefore no planner stamp; demanding one would break a legitimate
        // workflow to guard against a problem it cannot have.
        const executorRuntime = runtimeIdentity("executor", "run-agent");
        const plannerRuntime =
          (persistedMission?.planner_runtime as Record<string, unknown> | undefined) ?? null;
        const contractCheck = intelligence.mode === "new_architecture"
          ? checkContractCompatibility(
            persistedMission?.lead_intelligence_contract_version ?? null,
            typeof plannerRuntime?.git_sha === "string" ? plannerRuntime.git_sha : null)
          : null;
        console.log("[run-agent][runtime]", {
          task_id: task.id,
          executor: executorRuntime,
          planner: plannerRuntime,
          contract: contractCheck,
        });

        const multiRoundBinding = buildMultiRoundBinding({ workspaceId: workspace_id });
        let multiRoundSummary:
          ReturnType<typeof roundSummaryForWorkbench> | null = null;
        console.log("[run-agent][stage4][binding]", {
          task_id: task.id, ...multiRoundBinding.diagnostics,
        });

        // ══ PAID-EXECUTION PREFLIGHT — PROVE THE PLAN BEFORE SPENDING ════════
        // Runs before EVERY paid boundary on this path, mission or not. On TEST
        // task e8abeb8f-9503-4dfe-84cc-cfcbc6a416d4 the plan step carried no
        // `lead_mission`, so `persistedMission` was null, `guardedInvoker`
        // degraded to the raw invoker, `legacyLoopReachable` said yes, and five
        // harvestapi people searches were bought off LinkedIn job rows. Every
        // guard was deployed; every guard was conditioned on the one field that
        // was missing. An absent mission now BLOCKS spending instead of relaxing
        // it.
        const firstCall = missionPlan
          ? compileFirstProviderCall(missionPlan, {
            maxCandidates: Math.max(10, quota.requestedLeadCount * 10),
          })
          : { provider: null, compiled: null };
        const paidPreflight = buildPaidExecutionPreflight({
          mission: persistedMission,
          plan: missionPlan,
          firstProvider: firstCall.provider,
          firstProviderInput: firstCall.compiled?.ok ? firstCall.compiled.input : null,
          firstProviderCompileOk: firstCall.compiled ? firstCall.compiled.ok : undefined,
          firstProviderErrors: firstCall.compiled && !firstCall.compiled.ok
            ? firstCall.compiled.errors : [],
          intelligence,
          contract: contractCheck,
          // THE PLAYBOOK IS THE BOUNDARY. Inert for every mission the boundary
          // does not govern — `applies:false` — which in this phase is
          // everything except a hiring-only selection.
          playbook: playbookAuthorization,
        });
        console.log("[run-agent][paid-preflight]", {
          task_id: task.id,
          ok: paidPreflight.ok,
          mission_authority: paidPreflight.mission_authority,
          entry_capability: paidPreflight.entry_capability,
          ordered_capabilities: paidPreflight.ordered_capabilities,
          first_provider: paidPreflight.first_provider,
          input_valid: paidPreflight.first_provider_input_valid,
          blocked: paidPreflight.blocked,
        });
        // PERSISTED BEFORE THE THROW, so a blocked run is still auditable. The
        // failed task left no route telemetry at all, which is why its intent had
        // to be reconstructed from Actor payloads after the money was gone.
        try {
          await supabase.from("tasks").update({
            // ── MERGED, NOT REPLACED. THIS IS A CONTINUATION'S OWN ROW. ──────
            //
            // This was a wholesale `result: { … }` replace, and on a
            // continuation `task.id` is the PARENT's id — so a successor's very
            // first write destroyed everything the parent had persisted,
            // including `lead_resume_checkpoint`, roughly four seconds before
            // `loadLeadResumeRecords` below tried to read it back.
            //
            // Production run 85192217 (2026-08-19) is the case. The parent
            // qualified 1 of 10, left 51 candidates on the frontier, wrote a
            // checkpoint of 100 companies and dispatched correctly. The
            // successor then wiped the row, restored 0 records, and the
            // empty-restore guard did exactly its job:
            //
            //   continuation-restore-empty  expected_companies: 100,
            //                               restored_records: 0
            //   terminal_guard_disarmed     reason: continuation_restore_empty
            //
            // The guard was right and the ordering was right — the dispatch
            // already happens after the parent's final write, as the comment at
            // the dispatch site says. What was wrong is that the successor
            // deleted the thing it was about to depend on.
            //
            // `resumedTaskResult` is the parent's result as read UNDER THE
            // CLAIM (see the resume branch above), so merging against it needs
            // no second read and cannot race: the parent has already finished
            // and released the lease by the time a successor exists. For a
            // fresh task it is `{}`, so this is identical to the old behaviour.
            result: {
              ...resumedTaskResult,
              paid_execution_preflight: paidPreflight,
              // ONE ROW ANSWERS "WHICH CODE DID THIS?". Persisted alongside the
              // preflight — the same record that authorises spending — so a
              // blocked run carries its provenance too.
              lead_runtime: {
                planner_runtime: plannerRuntime,
                executor_runtime: executorRuntime,
                contract: contractCheck,
                intelligence_mode: intelligence.mode,
              },
            },
          }).eq("id", task.id);
        } catch (e) {
          console.log("[run-agent][paid-preflight][persist-error]", String(e));
        }
        if (!resumeSatisfied) assertPaidExecutionAllowed(paidPreflight);

        // ══ THE CAPABILITY ENGINE IS THE AUTHORITY FOR MISSION TASKS ═════════
        // For a task carrying a LeadMissionV1, the graph's own steps ARE the
        // state machine: entry capability, ordering, evidence gates, provider
        // attempts, cost and resume all come from `runCapabilityPlan`.
        // `executeCompanyFirstRoute` is not consulted at all, so the two cannot
        // disagree about the same run — it survives only for pre-mission tasks.

        // ── RESUME STATE, LOADED SERVER-SIDE ────────────────────────────────
        // Addressed by task id, gated on workspace ownership, read from the
        // database. The client says which run to continue; the database says
        // what that run found.
        const resumeLoad = await loadLeadResumeRecords(
          supabase as never, leadResumeParentTaskId, workspace_id);
        const leadResumeRecords = resumeLoad.records;

        // ══ A CONTINUATION THAT RESTORED NOTHING MUST NOT PROCEED ═══════════
        //
        // ARCHITECTURE: "Results are monotonic and cannot regress" and "once
        // qualified, a company cannot be unqualified by later slices."
        //
        // Task 528c2266 broke both. The parent discovered 100 companies,
        // qualified one and left 83 on the frontier. Its continuation loaded
        // ZERO checkpoint records, skipped discovery as already-complete, and
        // so ran with an EMPTY working set — finishing in 0.3s. It then wrote
        // that emptiness over the parent: `qualified` 1 → 0, the funnel 100 → 0,
        // and the checkpoint's own company list 100 → 0, destroying the
        // frontier that made the run resumable.
        //
        // The row itself carries the contradiction: `capability_execution_state`
        // still listed 100 `company_keys` while `lead_resume_checkpoint`
        // listed none. That combination is never legitimate — a run cannot have
        // investigated a hundred companies and hold zero — so it is refused
        // here, before anything is written.
        //
        // Refusing costs one slice. Proceeding costs the whole run's results.
        if (resume_task_id && leadResumeRecords.length === 0) {
          const priorState = readCapabilityExecutionState(resumedTaskResult);
          const priorKeys = priorState?.company_keys?.length ?? 0;
          if (priorKeys > 0) {
            console.error("[run-agent][continuation-restore-empty] refusing to overwrite", {
              task_id: task.id,
              expected_companies: priorKeys,
              restored_records: 0,
              rejection: resumeLoad.rejection,
            });
            if (heldClaim?.viaRpc) {
              await releaseContinuationViaRpc({
                db: supabase as unknown as RpcDb,
                taskId: task.id, workspaceId: workspace_id,
                claimId: heldClaim.claimId, rowStatus: RESUMABLE_ROW_STATUS,
              });
            }
            // AND THE GUARD MUST NOT WRITE EITHER. Returning early stopped the
            // ENGINE overwriting the row; the terminal guard's `finally` then
            // did it anyway, stamping `completed / no_qualified_companies` over
            // five qualified companies on task 7cd5cfb1.
            terminalGuard.disarm("continuation_restore_empty");
            return json({
              success: false,
              error: "continuation_restore_empty",
              reason: "checkpoint_records_missing",
              message:
                `The continuation could not restore the ${priorKeys} companies this ` +
                `run already holds, so it stopped rather than overwrite them. The ` +
                `previous slice's results and checkpoint are unchanged.`,
              task_id: task.id,
            }, 409);
          }
        }
        console.log("[run-agent][resume][loaded]", {
          task_id: task.id,
          parent_task_id: leadResumeParentTaskId,
          records: leadResumeRecords.length,
          rejection: resumeLoad.rejection,
          client_fields_ignored: ignoredClientFields,
        });

        // THE CHAIN'S ROOT. A continuation inherits it; a first run becomes it.
        // Inheriting is what keeps a third invocation computing the same
        // operation keys as the second instead of re-buying everything. Read
        // from the same verified row as the records, never from the body.
        const leadResumeLineageRoot = resumeLoad.lineageRoot ?? task.id;

        // ── STAGE 2 CHECKPOINT, LOADED SERVER-SIDE ──────────────────────────
        //
        // Same trust rule as the provider resume ledger: the client may say
        // WHICH run to continue, the database says what that run evaluated. A
        // client-supplied grounded result would let a caller mark a company
        // evaluated — and QUALIFIED — without one ever having been.
        //
        // The fingerprint is the mission hash here rather than the discovered
        // set, because discovery has not run yet at this point. A mission change
        // already invalidates the whole capability state, so a stale pool cannot
        // survive one.
        const poolFingerprint = persistedMission
          ? await missionHash(persistedMission) : "no-mission";
        const poolRestore = readPoolCheckpoint(resumeLoad.parentResult, poolFingerprint);
        const restoredPoolResults = poolRestore.results;
        if (poolRestore.stale) {
          console.log("[run-agent][stage2][checkpoint-stale]", {
            task_id: task.id,
            note: "pool fingerprint changed; evaluation and ranking will be redone",
          });
        }
        console.log("[run-agent][stage2][restored]", {
          task_id: task.id, restored: restoredPoolResults.size, stale: poolRestore.stale,
        });

        let capabilityRun: Awaited<ReturnType<typeof runCapabilityPlan>> | null = null;
        if (!resumeSatisfied && persistedMission && missionPlan) {
          // THE ENGINE OWNS THIS TASK FROM HERE. The claim throws if anything
          // else has already claimed execution, so a second engine is a raised
          // error rather than a silent second run reconciled by dedup later.
          leadOwnership.claimExecution(
            "capability_engine_v1",
            "the task carries a LeadMissionV1; the capability graph is the state machine",
          );
          leadOwnership.enterStage("capability_rounds");
          try {
            // ── ONE ROUND OF SOURCING ────────────────────────────────────
            //
            // Extracted as a closure so the round controller can run it more
            // than once WITHOUT a second sourcing engine existing. Rounds 2 and
            // 3 differ only in the mission and graph handed in; every guard,
            // budget, containment rule and evidence path below is the same code
            // that ran when there was only ever one round.
            //
            // `roundResume` carries the previous round's per-company records, so
            // a later round restores identity and enrichment already paid for
            // instead of re-buying them.
            const executeRound = async (
              roundMission: NonNullable<typeof persistedMission>,
              roundGraph: NonNullable<typeof missionPlan>,
              roundResume: typeof leadResumeRecords,
              roundGrounded: typeof restoredPoolResults,
            ) => await runCapabilityPlan({
              invoke: capabilityInvoke,
              verifyEmployer: (person, companyUrl) => {
                const v = verifyCurrentEmployer(
                  {
                    title: person.title,
                    currentCompany: person.current_employer,
                    currentCompanyLinkedinUrl: person.current_employer_linkedin_url,
                    isCurrent: person.current_employer_is_current ?? null,
                  },
                  { name: null, normalizedName: null, canonicalDomain: null,
                    linkedinUrl: companyUrl, linkedinCompanyId: null, location: null,
                    dedupeKey: companyUrl, dedupeKeyKind: "linkedin_url" } as never,
                );
                return { verified: employerGatePasses(v.outcome), outcome: String(v.outcome) };
              },
              // ── THE SECOND EVALUATOR IS NOT WIRED, BECAUSE IT IS GONE ───
              //
              // `classifyCompany` used to be passed here, adapting the
              // pre-Phase-4 semantic classifier onto the engine. The engine no
              // longer accepts it: one semantic authority, one call site, and
              // that is `evaluateMission` below.
              // ── STAGE 3/4 WIRING: GPT CHOOSES THE DISCOVERY ACTORS ───────
              //
              // The seam the engine has accepted since `leadDiscoveryStrategy`
              // landed, finally filled. Before this, `planDiscovery` was never
              // constructed, so `resolveDiscoveryStrategy` always took the
              // deterministic branch and the request had no influence on which
              // Actors ran.
              //
              // GPT proposes; `validateDiscoveryStrategy` decides. An
              // unregistered Actor, an unsupported filter and an invalid enum
              // are all rejected there, so nothing the model returns can become
              // a call the catalog does not permit.
              //
              // ── UNCONDITIONAL. THE CREDENTIAL GATE IS GONE TOO. ──────────
              //
              // This was `gptAvailable(readEnvSafe) ? planner : undefined`, on
              // the reasoning that a missing key should leave "the floor
              // unchanged". The floor was the problem: `undefined` meant the
              // engine ran the YC/B2B literal, so an absent credential produced
              // a confident search for something the user had not asked for.
              //
              // Now the planner is always supplied. With no key the provider
              // returns `no_api_key`, the planner returns null, and the engine
              // blocks the run with a stated reason — which is the honest
              // answer to "we cannot decide what to search for".
              //
              // ── AND IT SEES THE COMPANY BRAIN ───────────────────────────
              //
              // Second argument, previously hardcoded `null` inside the planner
              // with a comment admitting the Brain "is not threaded to this seam
              // yet". The stage that decides which paid Actors run could not see
              // who the workspace sells to, so it could not prefer a source whose
              // cohort matches the ICP, and could not say when the request and
              // the ICP genuinely disagree.
              //
              // SAFE BY CONSTRUCTION, not by omission: `companyBrainSection`
              // states the precedence in the prompt — the sentence the user just
              // typed outranks the standing ICP, always — which is the same rule
              // `mergeCompanyBrainIntoMission` enforces on the mission itself.
              planDiscovery: makeGptDiscoveryPlanner({
                readEnv: readEnvSafe,
                log: (m, meta) => console.log(`[gpt-discovery] ${m}`, meta ?? ""),
              }, {
                brain: {
                  positive_industries: brainIcpCtx.icp.industries ?? [],
                  excluded_industries:
                    effectivePolicy.constraints.negative_industries ?? [],
                  employee_min: effectivePolicy.constraints.min_employees ?? null,
                  employee_max: effectivePolicy.constraints.max_employees ?? null,
                  required_geography: null,
                  disqualifiers: brainIcpCtx.disqualifiers?.keywords ?? [],
                  business_models: brainIcpCtx.icp.business_models ?? [],
                },
                requestedCount: quota.requestedLeadCount,
                onRoute: (r) => modelRouting.record(r),
              }),

              // ── STAGE 3/4 WIRING: GPT PLANS THE WHOLE CHAIN ──────────────
              //
              // `planDiscovery` above chooses Actors for ONE stage. This chooses
              // the chain — discover → verify → enrich — and, the part nothing
              // could express before, which stages are UNNECESSARY because an
              // earlier Actor's output already carries what they exist to fetch.
              //
              // Wired unconditionally, like the discovery planner. Its absence
              // is a test seam, not a production mode: with no key the provider
              // returns `no_api_key`, the planner returns null, and the engine
              // runs the graph's own authorised order — which is code, and is
              // the sequence this system ran before chains existed.
              planExecution: makeGptExecutionPlanner({
                readEnv: readEnvSafe,
                log: (m, meta) => console.log(`[gpt-execution-plan] ${m}`, meta ?? ""),
              }, {
                brain: {
                  positive_industries: brainIcpCtx.icp.industries ?? [],
                  excluded_industries:
                    effectivePolicy.constraints.negative_industries ?? [],
                  employee_min: effectivePolicy.constraints.min_employees ?? null,
                  employee_max: effectivePolicy.constraints.max_employees ?? null,
                  required_geography: null,
                  disqualifiers: brainIcpCtx.disqualifiers?.keywords ?? [],
                  business_models: brainIcpCtx.icp.business_models ?? [],
                },
                requestedCount: quota.requestedLeadCount,
                onRoute: (r) => modelRouting.record(r),
              }),

              // ── STAGE 2 WIRING: GPT MISSION INTELLIGENCE ─────────────────
              //
              // Undefined when the flag is down, and the engine then keeps the
              // deterministic verdict. A failure here is never an exclusion —
              // the strict parser degrades a bad batch to `uncertain`, which
              // costs a company its priority and never its place in the run.
              triageCompanies: triageBinding.triageCompanies
                ? async ({ input, company_keys }) => {
                  triageBatchesMade++;
                  const raw = await triageBinding.triageCompanies!(
                    input as unknown as Record<string, unknown>);
                  console.log("[run-agent][mission-triage][batch]", {
                    task_id: task.id,
                    batch: triageBatchesMade,
                    companies: company_keys.length,
                    answered: raw !== null,
                  });
                  return raw;
                }
                : undefined,
              triageBatchesAllowed: triageBinding.batchesRemaining,
              triageBatchSize: triageBinding.batchSize,
              // ── THE MISSION EVALUATOR, IN PRODUCTION ─────────────────────
              //
              // THE SINGLE SEMANTIC AUTHORITY FOR MISSION QUALIFICATION.
              //
              // The engine calls this before it consults anything else; only
              // when it is absent or returns null does the company fall to
              // `insufficient_evidence`. Undefined here — the flag off, the
              // workspace not allow-listed — is the honest "no evaluator was
              // available", never a fabricated pass.
              //
              // Budget is enforced HERE rather than inside the engine, because
              // the binding is the thing that knows what was authorised. Once
              // the allowance is spent every further company returns null, and
              // null is `insufficient_evidence` — held, resumable, not rejected.
              evaluateMission: missionEvaluationBinding.evaluateMission
                ? async ({ input, registry, company_key }) => {
                  if (evaluationCallsMade >= missionEvaluationBinding.callsRemaining) {
                    evaluationBudgetExhausted = true;
                    console.log("[run-agent][mission-evaluation][budget-exhausted]", {
                      task_id: task.id, company_key,
                      calls_made: evaluationCallsMade,
                      calls_allowed: missionEvaluationBinding.callsRemaining,
                    });
                    return null;
                  }
                  evaluationCallsMade++;
                  const raw = await missionEvaluationBinding.evaluateMission!(
                    input as unknown as Record<string, unknown>);
                  // A NULL OR MALFORMED RESPONSE IS NOT A VERDICT. The strict
                  // parser turns anything unusable into `insufficient_evidence`
                  // with a parse status that says so — the company is held for
                  // a later run, never failed for a provider's bad day.
                  // THE REGISTRY THE ENGINE BUILT, not one reconstructed here:
                  // the parser refuses any citation that is not in it, which is
                  // what stops the evaluator inventing evidence.
                  const parsed = parseMissionEvaluationStrict(raw, registry);
                  evaluationCompaniesEvaluated++;
                  console.log("[run-agent][mission-evaluation]", {
                    task_id: task.id, company_key,
                    parse_status: parsed.parse_status,
                    decision: parsed.evaluation.decision,
                    mission_fit: parsed.evaluation.mission_fit,
                    match_score: parsed.evaluation.match_score,
                    repaired: parsed.raw_shape.repaired_fields,
                  });
                  return parsed;
                }
                : undefined,
              // ── THE GROUNDED SECOND OPINION ──────────────────────────────
              // Null unless the flag AND the workspace allow-list both pass, so
              // this is inert until deliberately switched on for one workspace.
              // The engine builds the registry and hands it over already built.
              groundCompany: groundedBinding.groundCompany
                ? async ({ registry, requiresCommercialSignal, company_key }) => {
                  const v = await groundedBinding.groundCompany!({
                    registry, requiresCommercialSignal,
                  });
                  console.log("[run-agent][grounded-brain]", {
                    task_id: task.id, company_key,
                    mode: groundedBinding.mode,
                    available: v !== null,
                    grounding_score: v?.grounding_score ?? null,
                    decision: v?.final_grounded_decision ?? null,
                    validated: v?.validated_claims.length ?? 0,
                    rejected: v?.rejected_claims.length ?? 0,
                  });
                  return v;
                }
                : undefined,
              groundingMode: groundedBinding.mode,
              // ── STAGE 2 WIRING ──────────────────────────────────────────
              ...(poolBinding.evaluateBatch
                ? {
                  evaluateBatch: poolBinding.evaluateBatch,
                  batchLimits: poolBinding.limits,
                  // RESTORED SERVER-SIDE, from the verified parent task only.
                  // A client-supplied grounded result would let a caller mark a
                  // company evaluated without one ever having been.
                  restoredGroundedResults: roundGrounded,
                  // WHAT SET THOSE RESTORED VERDICTS WERE COMPUTED OVER, so the
                  // engine can tell at ranking time whether this run discovered
                  // the same companies. The mission hash cannot answer that.
                  restoredPoolFingerprint: poolRestore.discoveredFingerprint,
                  onBatchComplete: async ({ evaluated, next_offset, pool_fingerprint }) => {
                    try {
                      const { data: cur } = await supabase
                        .from("tasks").select("result").eq("id", task.id).maybeSingle();
                      const prior = (cur?.result && typeof cur.result === "object")
                        ? cur.result as Record<string, unknown> : {};
                      await supabase.from("tasks").update({
                        result: {
                          ...prior,
                          [POOL_EVAL_RESULT_KEY]: buildPoolCheckpoint({
                            missionHash: poolFingerprint,
                            discoveredPoolFingerprint: pool_fingerprint,
                            evaluated, next_offset,
                            accounting: poolBinding.accounting,
                          }),
                        },
                      }).eq("id", task.id);
                    } catch (e) {
                      console.log("[run-agent][stage2][checkpoint-error]", String(e));
                    }
                  },
                }
                : {}),
              // THE RANKER RUNS IN BOTH MODES; THE MODE DECIDES ITS AUTHORITY.
              // Passing `rankPool` only under enforce meant shadow computed
              // nothing, persisted nothing, and left enforce to be switched on
              // with no evidence of what it would reorder. The engine ships the
              // deterministic order in shadow and records the difference.
              ...(poolBinding.rankPool
                ? {
                  rankPool: poolBinding.rankPool,
                  rankingMode: poolBinding.rankingMode,
                }
                : {}),
              readPendingRun,
              // THE SAME BUDGET THE TERMINAL GUARD FINALIZES AGAINST. One clock,
              // so "the engine stopped early" and "the run was written partial"
              // can never disagree about why.
              deadline: terminalGuard.deadline,
              // INCREMENTAL, AND NEVER PREMATURELY QUALIFIED. Each stage's counts
              // are persisted as soon as they are true, so the Workbench fills in
              // as the run proceeds instead of staying empty until the end.
              // `qualified_companies` stays 0 until the Brain has spoken.
              //
              // READ-MODIFY-WRITE, because `update({result})` REPLACES the whole
              // jsonb — a blind write here would delete the paid-execution
              // preflight persisted a few lines above, which is the one record
              // that explains a blocked run.
              onProgress: async (p) => {
                try {
                  const { data: cur } = await supabase
                    .from("tasks").select("result").eq("id", task.id).maybeSingle();
                  const prior = (cur?.result && typeof cur.result === "object")
                    ? cur.result as Record<string, unknown> : {};
                  await supabase.from("tasks").update({
                    result: { ...prior, workbench_progress: p },
                  }).eq("id", task.id);
                } catch (e) {
                  console.log("[run-agent][capability-engine][progress-error]", String(e));
                }
              },
              // THE GUARD SEES THE LATEST STATE, so a kill after enrichment is
              // finalized with the attempts, cost and pending runs that existed
              // at that moment — not an empty state.
              onStateChange: (s) => terminalGuard.observe({
                completed_capabilities: s.completed_capabilities,
                pending_capabilities: s.pending_capabilities,
                failed_capabilities: [],
                provider_attempts: s.provider_attempts,
                pending_runs: s.pending_runs.map((r) => ({
                  run_id: r.run_id, dataset_id: r.dataset_id, provider: r.provider,
                })),
                accumulated_cost_units: s.accumulated_cost_units,
                terminal_reason: s.terminal_reason,
                qualified_company_keys: s.qualified_company_keys,
              }),
              log: (m, meta) => console.log("[run-agent][capability-engine]", m, meta),
            }, {
              mission: roundMission,
              plan: roundGraph,
              // THE FALLBACK IS CONFIGURED, so an unconfigured-fallback skip can
              // no longer masquerade as a memo23 input failure. One call per
              // band: this Actor ANDs multiple values and returns zero rows.
              solidcodeTeamSizes: ["2-10", "11-50", "51-200"],
              // ── THE ENGINE STATE, FROM THE ROW ON A CONTINUATION ────────
              //
              // This read the state from the REQUEST BODY only, which is right
              // for the legacy caller that ships it. The auto-continuation does
              // not — the state is large and belongs to the server — so a
              // continuation started with a null state: no
              // `completed_capabilities`, so DISCOVERY RAN AGAIN and was paid
              // for again, and no `investigation_ranking`, so the frontier
              // restarted at pass one.
              //
              // Loaded from the resumed row instead, where the previous slice
              // already wrote it. Body-supplied state still wins when present,
              // so the legacy path is unchanged.
              state: readCapabilityExecutionState(body as Record<string, unknown>) ??
                readCapabilityExecutionState(resumedTaskResult),
              // THE RESUME GUARD'S SCOPE — supplied on EVERY run, not only on a
              // continuation.
              //
              // The scope is what lets a call be given a stable operation key,
              // and the key is what a LATER run reads. Passing it only when
              // records already exist would mean no run ever wrote the ledger
              // and no run could ever read one: the first run must record what
              // it bought for the second to know not to buy it again. `records`
              // is empty on a first run, which correctly means "nothing is known
              // to be done" — so nothing is skipped.
              resume: {
                workspace_id,
                lineage_root_task_id: leadResumeLineageRoot,
                records: roundResume,
              },
              // WHO THIS RUN BELONGS TO, for observations kept beyond it.
              //
              // Supplied separately from `resume` on purpose: reusing the
              // resume workspace would tie headcount collection to RESUMED
              // runs, so a company's first enrichment — the reading that starts
              // its series — would be the one never kept.
              identity: { workspace_id, task_id: task.id },
              // ── THE BRAIN THE EVALUATOR READS ───────────────────────────
              //
              // TWO KINDS OF FIELD, and which side of the line each one falls
              // on is decided by `resolveBrainAuthority`, not by intuition.
              //
              // REJECTING (tier 2 — absolute on an axis the Mission never
              // mentions): `excluded_industries`, `required_geography` AND
              // `disqualifier_keywords`. All three stay behind `brainEnforced`,
              // exactly as before. `disqualifier_keywords` belongs here despite
              // reading like an ICP hint: the authority resolver files it under
              // `rejecting`, so supplying it unconditionally would hand an
              // unenforced Brain a brand-new way to reject companies. That is a
              // product-behaviour change, not a wiring fix, so it is not made
              // here.
              //
              // PREFERENCES (tier 3 — ranking only, never a rejection):
              // `business_models`, `buyer_roles`, `target_signals`. These are
              // supplied ALWAYS. They cannot change who qualifies; withholding
              // them only meant the evaluator judged a company without knowing
              // who the workspace actually sells to.
              brain: {
                ...(brainEnforced
                  ? {
                    employee_min: effectivePolicy.constraints.min_employees ?? null,
                    employee_max: effectivePolicy.constraints.max_employees ?? null,
                    positive_industries: effectivePolicy.constraints.positive_industries ?? [],
                    excluded_industries: effectivePolicy.constraints.negative_industries ?? [],
                    required_geography: null,
                    disqualifier_keywords: brainIcpCtx.disqualifiers?.keywords ?? [],
                  }
                  : {}),
                business_models: brainIcpCtx.icp.business_models ?? [],
                buyer_roles: brainIcpCtx.buyer_personas?.titles ?? [],
                target_signals: [...new Set([
                  ...(brainIcpCtx.buying_triggers?.hiring ?? []),
                  ...(brainIcpCtx.jobs_to_watch ?? []),
                ])],
              },
              // THE WORKSPACE'S OWN WORDS, handed over as context and never
              // compiled into a gate. Written by the user during onboarding and
              // read by nothing in the qualification path until now.
              brainQualificationRules: brainIcpCtx.qualification_rules ?? null,
              maxCandidates: Math.max(10, quota.requestedLeadCount * 10),
            });

            // ── ROUND 1 IS THE EXACT MISSION, ALWAYS ─────────────────────
            // Never broadened because a large number was requested. Asking for
            // 100 does not make a weaker company a better match.
            // ── A REFUSAL IS AN ANSWER, AND MUST READ LIKE ONE ───────────
            //
            // `DiscoveryStrategyBlockedError` was thrown by the engine and
            // caught by nothing on this path, so the honest outcome the
            // architecture chose — stop rather than answer with the wrong tool —
            // reached the user as an unhandled failure. "0 of 10 leads" and
            // "nothing I have can discover that cohort" are different facts and
            // only the second one is actionable.
            //
            // Rethrown, deliberately: the run genuinely did not produce a pool
            // and must not continue into stages that assume one. What changes is
            // that it now carries a stated reason and a sentence for the user.
            try {
              capabilityRun = await executeRound(
                persistedMission, missionPlan, leadResumeRecords, restoredPoolResults);
            } catch (e) {
              if (!(e instanceof DiscoveryStrategyBlockedError)) throw e;
              console.log("[run-agent][discovery-refused]", {
                task_id: task.id,
                violations: e.violations.map((v) => v.code),
              });
              await supabase.from("tasks").update({
                status: "failed",
                error_message: e.userMessage,
                result: {
                  discovery_refusal: {
                    version: "discovery-refusal-v1",
                    // NO SPEND. Asserted by the tests, and the reason a refusal
                    // is a better product than a pool of newsletters.
                    provider_calls_made: 0,
                    violations: e.violations.map((v) => ({
                      code: v.code, actor_key: v.actor_key ?? null, message: v.message,
                    })),
                    user_message: e.userMessage,
                  },
                },
                finished_at: new Date().toISOString(),
              }).eq("id", task.id);
              throw e;
            }

            // ── ROUNDS 2-3, QA-FLAGGED ──────────────────────────────────
            //
            // Off, this block does nothing and the run is byte-for-byte the
            // single-round run it was. On, the controller decides whether a
            // further round is worth it, the planner proposes HOW to broaden,
            // and `validateRoundPlan` decides whether it may — the people
            // stages are unreachable from that plan by construction.
            if (multiRoundBinding.enabled && capabilityRun) {
              try {
                const groundedAcross = new Map(restoredPoolResults);
                for (const c of capabilityRun.companies) {
                  if (c.grounded) groundedAcross.set(c.key, c.grounded);
                }
                let latest = capabilityRun;
                // ── THE RUN THE WORKBENCH GETS IS THE BEST ONE, NOT THE LAST ─
                //
                // `latest` is the right thing to RESUME from — it holds the
                // newest checkpoint and the widest discovery. It is not
                // necessarily the right thing to SHIP. A later round that
                // reached nobody still carries a complete, empty engine state,
                // and adopting it wholesale is what turned two qualified
                // companies into `deferred` rows in task cc556f5e.
                let best = capabilityRun;
                const qualifiedIn = (r: NonNullable<typeof capabilityRun>) =>
                  r.state.qualified_company_keys.length;
                /**
                 * Adopt a later round only when it actually did better.
                 *
                 * Ties keep the EARLIER run: an equal count from a round that
                 * evaluated nobody is the unmeasured zero again, and preferring
                 * the proven run costs at most some extra discovery rows while
                 * preferring the newer one can cost every verdict in hand.
                 */
                const adopt = (r: NonNullable<typeof capabilityRun>) => {
                  if (qualifiedIn(r) > qualifiedIn(best)) best = r;
                };
                const asExecution = (
                  run: NonNullable<typeof capabilityRun>,
                ): RoundExecution => ({
                  candidates: run.companies.map((c) => ({
                    company_key: c.key,
                    company_name: (c.enriched ?? c.company).company_name ?? null,
                    linkedin_company_url:
                      c.identity?.linkedin_company_url ?? c.company.linkedin_company_url ?? null,
                    website: (c.enriched ?? c.company).website ?? null,
                    discovered_round: 0,
                  })),
                  groundedByKey: new Map(run.companies
                    .filter((c) => c.grounded)
                    .map((c) => [c.key, c.grounded as unknown])),
                  pool: run.pool
                    ? {
                      hard_gated: run.pool.eligible.hard_gated,
                      eligible: run.pool.eligible.eligible,
                      evaluated: run.pool.delivery.metrics.evaluated,
                      qualified: run.pool.delivery.metrics.qualified,
                      review: run.pool.delivery.metrics.review,
                      watch: run.pool.delivery.metrics.watch,
                      delivered: run.pool.delivery.metrics.delivered,
                    }
                    : null,
                  providerCostUnits: run.state.accumulated_cost_units,
                  modelCostUnits: poolBinding.accounting.completed_calls,
                  providerOperations: run.state.provider_attempts.map((a) => a.capability),
                });

                const multi = await runMultiRoundSourcing({
                  runRound: async ({ round, plan }) => {
                    // Round 1 already ran above; the controller is handed its
                    // result rather than paying for it twice.
                    if (round === 1) return asExecution(latest);
                    const roundMission = plan
                      ? applyRoundPlanToMission(persistedMission, plan)
                      : persistedMission;
                    const roundGraph = buildCapabilityGraph(roundMission);
                    latest = await executeRound(
                      roundMission, roundGraph,
                      // WHAT THE PREVIOUS ROUND ALREADY PROVED, so identity and
                      // enrichment are restored rather than re-bought.
                      latest.resume_records, groundedAcross);
                    for (const c of latest.companies) {
                      if (c.grounded) groundedAcross.set(c.key, c.grounded);
                    }
                    adopt(latest);
                    return asExecution(latest);
                  },
                  planNextRound: multiRoundBinding.planNextRound,
                  limits: () => ({
                    maxProviderCostUnits: multiRoundBinding.maxProviderCostUnits,
                    maxModelOperations: multiRoundBinding.maxModelOperations,
                    // THE SAME RESERVE THE ENGINE AND CHECKPOINT USE. A round
                    // that cannot finish before the reserve must not start:
                    // starting one is how a run dies holding paid work it never
                    // wrote down.
                    deadlineReserveReached: terminalGuard.deadline
                      ? terminalGuard.deadline.remainingMs() <= CHECKPOINT_RESERVE_MS
                      : false,
                  }),
                  log: (m, meta) => console.log("[run-agent][multi-round]", m, meta),
                }, {
                  mission: persistedMission,
                  requestedCount: quota.requestedLeadCount,
                  maxRounds: multiRoundBinding.maxRounds,
                });

                multiRoundSummary = roundSummaryForWorkbench(multi);
                capabilityRun = best;
                console.log("[run-agent][multi-round][complete]", {
                  task_id: task.id, ...multiRoundSummary,
                  // WHICH ROUND'S ENGINE STATE IS BEING SHIPPED, and whether
                  // that differs from the last one executed.
                  adopted_qualified: qualifiedIn(best),
                  latest_qualified: qualifiedIn(latest),
                  adopted_latest_round: best === latest,
                });
              } catch (e) {
                // A ROUND-CONTROLLER FAILURE COSTS THE EXTRA ROUNDS, NOT THE
                // RUN. Round 1's result is already in hand and ships.
                console.error("[run-agent][multi-round][failed]", String(e));
              }
            }

            // ── THE TRACE, ASSEMBLED WHERE EVERY PIECE IS IN SCOPE ──────────
            //
            // The 2026-08-18 audit needed two Supabase projects, seven queries
            // and a `git show` to establish that the mission asked for one
            // capability, the gate approved it, and the router ran another.
            // Every piece was persisted; no row contained the contradiction.
            //
            // Built defensively — a trace that throws while explaining a failed
            // run is the worst possible time to throw.
            let leadRunTrace: Record<string, unknown> | null = null;
            try {
              leadRunTrace = buildLeadRunTrace({
                mission: persistedMission,
                graph: missionPlan,
                state: capabilityRun.state as never,
                capability_outcomes: capabilityRun.capability_outcomes,
                model_routing: modelRouting.summary(),
                funnel: capabilityRun.funnel as unknown as Record<string, unknown>,
                qualified: capabilityRun.companies.filter(
                  (c) => c.verdict === "pass").length,
                requested: quota.requestedLeadCount,
              }) as unknown as Record<string, unknown>;
              for (const line of describeLeadRunTrace(leadRunTrace as never)) {
                console.log("[run-agent][trace]", line);
              }
            } catch (e) {
              console.error("[run-agent][trace][failed]", String(e));
            }

            companyFirstRoute = {
              ...toRouteResultShape(capabilityRun),
              diagnostics: emptyCapabilityDiagnostics(capabilityRun),
              ...(leadRunTrace ? { agentory_trace: leadRunTrace } : {}),
            } as never;
            // THE EVIDENCE OF WORK DONE, kept apart from the leads.
            //
            // Six companies on task 42e39fb1 had real commercial signals inside
            // the size range and vanished, because only Brain passes are
            // persisted. These rows make that work visible WITHOUT calling any
            // of it qualified: they carry no lead_candidate_id, so no action
            // path can reach them.
            // THE PORTFOLIO, built from the run that just happened.
            //
            // `requested_opportunity_count` is what the user asked to SEE;
            // contact-ready is what they can act on today. Collapsing the two is
            // what made "find 100" mean "return 100 perfect leads or fail".
            const portfolioTargets = interpretTargets(
              persistedMission.original_user_query, quota.requestedLeadCount);
            const portfolio = buildPortfolio(
              toPortfolioCandidates(capabilityRun.companies),
              portfolioTargets,
              { sourcesExhausted: capabilityRun.state.pending_capabilities.length === 0 },
            );
            console.log("[run-agent][capability-engine][portfolio]", {
              task_id: task.id,
              requested: portfolioTargets.requested_opportunity_count,
              // ROWS SHOWN AND OPPORTUNITIES FOUND, separately. Logging only
              // `delivered` reported "10 delivered, 0 shortfall" for a run that
              // qualified three and filled the rest with watch items.
              rows_shown: portfolio.counts.delivered,
              opportunities: portfolio.counts.opportunities,
              tiers: [portfolio.counts.tier_a, portfolio.counts.tier_b, portfolio.counts.tier_c],
              qualified: portfolio.counts.qualified,
              watch: portfolio.counts.watch,
              contact_ready: portfolio.counts.contact_ready,
              shortfall: portfolio.shortfall.opportunities,
            });

            const evaluation = projectEvaluationRows(capabilityRun.companies.map((c) => ({
              key: c.key,
              shortlisted: c.shortlisted,
              // THE AUTHORITATIVE FIELDS, enrichment first. Without these the
              // projection fell back to the key — which on this path is a
              // LinkedIn URL — and reported a null size for every company whose
              // enrichment had already been bought.
              companyName: (c.enriched ?? c.company).company_name ?? null,
              employeeCount: (c.enriched ?? c.company).employee_count ?? null,
              prequalified: c.prequalified
                ? {
                  name: c.prequalified.name,
                  canonical_domain: c.prequalified.canonical_domain,
                  team_size: c.prequalified.team_size,
                  best_tier: c.prequalified.best_tier,
                  score: c.prequalified.score,
                  strongest_signal: c.prequalified.strongest_signal,
                  exclusion: c.prequalified.exclusion,
                  eligible: c.prequalified.eligible,
                  jobs: c.prequalified.jobs,
                  reasons: c.prequalified.reasons,
                  yc_url: c.prequalified.yc_url,
                }
                : null,
              // THE CANONICAL PREDICATE, the same one progress counters and
              // downstream eligibility use. "not unresolved" silently counted an
              // ambiguous match as resolved.
              identityResolved: !!c.identity && identityIsActionable(c.identity),
              identityAttempted: c.identity !== null,
              enriched: c.enriched !== null,
              hiringVerified: c.hiring_jobs.length > 0,
              verdict: c.verdict,
              contactCount: c.contact_identities.length,
              // ── WHY, NOT JUST WHAT ────────────────────────────────────────
              //
              // The engine has carried all five of these per company since the
              // evaluator inversion landed, and the projection received none of
              // them — so a company the budget never reached and one the
              // evaluator explicitly failed arrived at the Workbench
              // indistinguishable, and were captioned identically as "not
              // qualified". These are the fields that tell them apart.
              decisionSource: c.decision_source,
              triage: c.triage
                ? {
                  relevance: c.triage.relevance,
                  confidence: c.triage.confidence,
                  signal_strength: c.triage.signal_strength,
                  reasons: c.triage.reasons,
                }
                : null,
              shortlistExclusion: c.shortlist_exclusion,
              investigationState: c.investigation_state,
              enrichmentOutcome: c.enrichment_outcome,
              stageBlock: c.stage_block,
              missionEvaluation: c.mission_evaluation
                ? {
                  decision: c.mission_evaluation.decision,
                  match_score: c.mission_evaluation.match_score,
                  confidence: c.mission_evaluation.confidence,
                  reasoning: c.mission_evaluation.reasoning,
                  rejection_reasons: c.mission_evaluation.rejection_reasons,
                  failed_requirements: c.mission_evaluation.failed_requirements,
                }
                : null,
            })));
            console.log("[run-agent][capability-engine][evaluation-rows]", {
              task_id: task.id, rows: evaluation.rows.length, counts: evaluation.counts,
            });

            // ── ONE ORDERED WALK OF THE PIPELINE ────────────────────────────
            //
            // "I asked for 5 leads and got 1" is answerable today only by
            // joining eight separate structures by hand. This is that join,
            // read from the same companies every other view is built from, so
            // it can explain the shortfall without being able to disagree with
            // the Workbench about it.
            //
            // `unaccounted` is the assertion that matters: a stage that loses
            // companies without attributing them to decided / withheld /
            // excluded has lost them silently, and that is logged loudly.
            const funnel = missionFunnelFor(capabilityRun.companies);
            for (const line of formatFunnel(funnel)) {
              console.log("[run-agent][mission-funnel]", { task_id: task.id, line });
            }
            const unbalanced = unbalancedStages(funnel);
            if (unbalanced.length > 0) {
              console.error("[run-agent][mission-funnel][UNACCOUNTED]", {
                task_id: task.id,
                stages: unbalanced.map((s) => ({
                  stage: s.stage, entered: s.entered, advanced: s.advanced,
                  unaccounted: s.unaccounted,
                })),
              });
            }

            // ── THE SAME RESULT, ALSO INTO THE CANONICAL LEAD LIBRARY ───────
            //
            // The mission path produced `tasks.result.workbench_*` and nothing
            // else: the Workbench could render the run and the Lead Library
            // stayed empty. `projectEvaluationRows` above SKIPS a company once
            // it qualifies — by design, because a qualified company is a record
            // rather than progress — and nothing was picking it up there.
            //
            // ONE writer, not two. `projectMissionCompanyRows` maps the engine's
            // qualified companies onto the SAME `buildCompanyRowPersistencePlan`
            // the company-first pipeline uses, and `persistPlan` is the SAME
            // canonical writer. Only an explicit Brain pass is projected, an
            // account row is never CONTACT and never quota-eligible, and dedup
            // uses the existing `companyRowKey`.
            //
            // BEST-EFFORT, DELIBERATELY. A persistence failure must not discard
            // the Workbench result the user can already see: the run is
            // reported either way and the outcome of each write is recorded, so
            // a partial write is visible rather than silent. The two views are
            // built from the same `capabilityRun.companies`, so they cannot
            // disagree about what the run found.
            // GATED ON THE PLAYBOOK BOUNDARY, NOT MERELY PLACED AFTER IT.
            //
            // The engine still runs for a mission whose shape this build cannot
            // research — that behaviour is unchanged and deliberate — so an
            // ungated write here would give `social`, `news` and `funding`
            // missions Lead Library records they have never had. The boundary
            // decides what executes; it therefore decides what persists.
            const missionPersistence = (playbookAuthorization?.applies &&
                playbookAuthorization.authorized)
              ? projectMissionCompanyRows(capabilityRun.companies, workspace_id)
              : { version: MISSION_PERSISTENCE_PROJECTION_VERSION, rows: [], skipped: [] };
            const missionPersistPlan = createPersistPlan({
              db: supabase as never, workspaceId: workspace_id, planId: plan_id ?? null,
            });
            // ── THE HEADCOUNT SERIES GROWS BY ONE ROW PER ENRICHED COMPANY ──
            //
            // Written BEFORE the lead rows and independently of them: a reading
            // is worth keeping whether or not the company went on to qualify,
            // and a company rejected today may be the one whose growth matters
            // in three months.
            //
            // The insert IGNORES DUPLICATES rather than failing. The table's
            // unique index is (workspace, company, source, day), so a second
            // enrichment of the same company on the same day is a repeat, not
            // an error — and a growth series must never be able to take a run
            // down.
            let headcountSnapshotsWritten = 0;
            let headcountSnapshotError: string | null = null;
            if (capabilityRun?.headcount_snapshots.length) {
              try {
                const { error: hsErr } = await supabase
                  .from("company_headcount_snapshots")
                  .upsert(capabilityRun.headcount_snapshots, {
                    onConflict: "workspace_id,company_key,source,observed_on",
                    ignoreDuplicates: true,
                  });
                if (hsErr) {
                  headcountSnapshotError = hsErr.message ?? String(hsErr);
                } else {
                  headcountSnapshotsWritten = capabilityRun.headcount_snapshots.length;
                }
              } catch (he) {
                headcountSnapshotError = he instanceof Error ? he.message : String(he);
              }
            }

            const missionPersistResults: Array<{
              key: string; ok: boolean; lead_candidate_id: string | null; reason?: string;
            }> = [];
            for (const row of missionPersistence.rows) {
              try {
                const r = await missionPersistPlan(row.plan);
                missionPersistResults.push({
                  key: row.key, ok: r.ok, lead_candidate_id: r.leadCandidateId,
                  ...(r.reason ? { reason: r.reason } : {}),
                });
              } catch (pe) {
                missionPersistResults.push({
                  key: row.key, ok: false, lead_candidate_id: null, reason: String(pe),
                });
              }
            }
            const missionPersisted = missionPersistResults.filter((r) => r.ok).length;
            console.log("[run-agent][capability-engine][lead-library]", {
              task_id: task.id,
              ...missionPersistenceSummary(missionPersistence, missionPersisted),
              failed: missionPersistResults.filter((r) => !r.ok).map((r) => r.reason ?? "unknown"),
            });

            // THE RUN HAS ENDED — correct the snapshot that said otherwise.
            // The in-run publishes necessarily say `in_progress: true`; only
            // here is it known that no more work will happen in this
            // invocation. Pending capabilities are a partial RESULT, not
            // activity.
            try {
              const finalProgress = finalizedProgress(capabilityRun.state);
              if (finalProgress) {
                const { data: cur } = await supabase
                  .from("tasks").select("result").eq("id", task.id).maybeSingle();
                const prior = (cur?.result && typeof cur.result === "object")
                  ? cur.result as Record<string, unknown> : {};
                await supabase.from("tasks").update({
                  result: {
                    ...prior,
                    workbench_progress: finalProgress,
                    // A SEPARATE KEY, deliberately not merged into any lead
                    // collection. Nothing that reads leads will find these.
                    workbench_evaluation_rows: evaluation.rows,
                    // WHAT REACHED THE LEAD LIBRARY, from the same companies the
                    // Workbench rows were projected from. Persisted so the two
                    // views can be reconciled from one row rather than argued
                    // about from two.
                    lead_library_persistence: {
                      ...missionPersistenceSummary(missionPersistence, missionPersisted),
                      results: missionPersistResults,
                    },
                    // WHAT THIS RUN CONTRIBUTED TO THE GROWTH SERIES.
                    //
                    // Recorded even when zero, because zero is the answer for
                    // every run that enriched nothing — and a growth capability
                    // that stays unanswerable needs to show why rather than
                    // simply staying quiet.
                    headcount_snapshots: {
                      observed: capabilityRun?.headcount_snapshots.length ?? 0,
                      written: headcountSnapshotsWritten,
                      ...(headcountSnapshotError ? { error: headcountSnapshotError } : {}),
                    },
                    workbench_evaluation_counts: evaluation.counts,
                    // THE STAGE-LEVEL TOTALS BEHIND THOSE COUNTS. "0 qualified"
                    // is only explainable next to how many were triaged out,
                    // how many the budget never reached and how many the
                    // enrichment provider never answered for.
                    workbench_triage_counts: evaluation.triage_counts,
                    workbench_enrichment_counts: evaluation.enrichment_counts,
                    // THE FUNNEL, PERSISTED. Rebuilt here from the same
                    // companies with the keys that actually reached the Lead
                    // Library, so the persistence stage reports what was
                    // written rather than what was eligible to be.
                    mission_funnel: missionFunnelFor(capabilityRun.companies, {
                      persistedKeys: missionPersistResults
                        .filter((r) => r.ok).map((r) => r.key),
                    }),
                    // THE CHECKPOINT. Per-company stage state plus the
                    // continuation flag the UI reads, so a run holding pending
                    // verification can never be described as complete.
                    lead_resume_checkpoint: buildCheckpoint({
                      now: Date.now(),
                      deadlineAt: terminalGuard.deadline.startedAt + terminalGuard.deadline.budgetMs,
                      remainingMs: terminalGuard.deadline.remainingMs(),
                      lastCompletedCapability:
                        capabilityRun.state.completed_capabilities.slice(-1)[0] ?? null,
                      nextPendingCapability:
                        capabilityRun.state.pending_capabilities[0] ?? null,
                      companies: capabilityRun.resume_records,
                      reason: capabilityRun.state.terminal_reason === "execution_deadline_checkpoint"
                        ? "execution_deadline_checkpoint" : "all_work_complete",
                    }),
                    // PERSISTED SO THE NEXT CONTINUATION CAN INHERIT IT. Read
                    // back by `lineageRootTaskId`; without it every link in the
                    // chain would compute its own root and skip nothing.
                    [LINEAGE_ROOT_RESULT_KEY]: leadResumeLineageRoot,
                    // ── GROUNDING: WHAT WAS CLAIMED, AND WHAT SURVIVED ──────
                    //
                    // Two separate keys on purpose. `workbench_grounded_*` is
                    // what a user may see and contains ONLY validated claims;
                    // `grounded_brain_diagnostics` keeps the rejected ones, with
                    // their reasons, for whoever has to explain a downgrade.
                    // Nothing here is raw model output.
                    grounded_brain_diagnostics: {
                      mode: groundedBinding.mode,
                      enablement: groundedBinding.diagnostics,
                      companies: capabilityRun.companies
                        .filter((c) => c.grounded !== null || c.evidence_registry !== null)
                        .map((c) => ({
                          company_key: c.key,
                          evidence_ids: (c.evidence_registry?.items ?? [])
                            .map((x) => x.evidence_id),
                          evidence_types: [...new Set(
                            (c.evidence_registry?.items ?? []).map((x) => x.evidence_type))],
                          grounding_score: c.grounded?.grounding_score ?? null,
                          grounded_decision: c.grounded?.final_grounded_decision ?? null,
                          confidence_before_grounding:
                            c.grounded?.classifier_result.confidence ?? null,
                          confidence_after_grounding: c.grounded
                            ? Number((c.grounded.classifier_result.confidence *
                              c.grounded.grounding_score).toFixed(4))
                            : null,
                          validated_claims: (c.grounded?.validated_claims ?? [])
                            .map((x) => ({ claim_type: x.claim_type, claim: x.claim })),
                          rejected_claims: (c.grounded?.rejected_claims ?? [])
                            .map((x) => ({
                              claim_type: x.claim_type, reason: x.reason, detail: x.detail,
                            })),
                          downgrade_reasons: c.grounded?.downgrade_reasons ?? [],
                          unacknowledged_conflicts:
                            c.grounded?.unacknowledged_conflicts ?? [],
                        })),
                      // WHAT ENFORCING WOULD HAVE DONE, recorded without doing it.
                      shadow_comparison: groundedBinding.mode === "shadow"
                        ? capabilityRun.companies
                          .filter((c) => c.grounded !== null)
                          .map((c) => buildShadowComparison({
                            companyKey: c.key,
                            legacyOutcome: c.brain?.outcome ?? "REVIEW",
                            legacyConfidence: c.brain?.confidence ?? 0,
                            grounded: c.grounded,
                          }))
                        : [],
                    },
                    // ── STAGE 2: RANKED WORKBENCH ROWS AND POOL METRICS ──
                    //
                    // `workbench_pool` is what the UI renders. It carries the
                    // semantic rank, the ranking SOURCE (so a deterministic
                    // fallback is visible rather than passed off as a semantic
                    // comparison), and honest coverage — evaluated versus
                    // unevaluated — so an incomplete pool is never presented as
                    // a complete one. Rejected claims and provider names are
                    // absent by construction: every field here comes from a
                    // compact summary, which is built from validated claims.
                    ...(capabilityRun.pool
                      ? {
                        workbench_pool: {
                          ranking_source: capabilityRun.pool.ranking.ranking_source,
                          ranking_confidence:
                            capabilityRun.pool.ranking.portfolio_summary.ranking_confidence,
                          pool_explanation:
                            capabilityRun.pool.ranking.portfolio_summary.pool_explanation,
                          metrics: {
                            ...capabilityRun.pool.delivery.metrics,
                            discovered: capabilityRun.pool.eligible.discovered,
                            hard_gated: capabilityRun.pool.eligible.hard_gated,
                            restored: capabilityRun.pool.restored,
                          },
                          partial: capabilityRun.pool.unevaluated > 0,
                          // ROUND-LEVEL OBSERVABILITY. Counts only — no
                          // provider is named — and the unlock counters are
                          // present and zero so "delivered" is never read as
                          // "contactable". Null when multi-round is off.
                          ...(multiRoundSummary
                            ? { rounds: multiRoundSummary } : {}),
                          rows: capabilityRun.pool.delivery.delivered.map((d) => ({
                            semantic_rank: d.rank,
                            company_key: d.summary.company_key,
                            company_name: d.summary.company_name,
                            brain_decision: d.summary.brain_decision,
                            opportunity_tier: d.summary.opportunity_tier,
                            strongest_signal: d.summary.strongest_signal,
                            reason_to_contact_now: d.summary.reason_to_contact_now,
                            ranking_reason: d.ranking_reason,
                            relative_strength: d.relative_strength,
                            grounding_score: d.summary.grounding_score,
                            confidence_after_grounding: d.summary.confidence_after_grounding,
                            missing_evidence: d.summary.missing_evidence,
                            material_conflicts: d.summary.material_conflicts,
                            recommended_action: d.recommended_action,
                            // NOT AN EXECUTION. Stage 3 owns the unlock; until
                            // then this is a state, not a button that spends.
                            founder_state: "locked",
                          })),
                        },
                        // INTERNAL ONLY. Validator changes and rejected ranking
                        // entries explain a downgrade to whoever has to answer
                        // for it; they are not user-facing content.
                        stage2_ranking_diagnostics: {
                          validator_changes: capabilityRun.pool.ranking.validator_changes,
                          rejected_entries: capabilityRun.pool.ranking.rejected_entries,
                          fallback_reason: capabilityRun.pool.ranking.fallback_reason,
                          eligible_exclusions: capabilityRun.pool.excluded,
                          model_accounting: poolBinding.accounting,
                          // WHY THE ORDER IS WHAT IT IS. Without the mode, a
                          // deterministic `ranking_source` in shadow reads as a
                          // ranking failure rather than a ranking withheld.
                          ranking_mode: capabilityRun.pool.ranking_mode,
                          // WHAT ENFORCE WOULD HAVE DONE, recorded without doing
                          // it — the evidence the enforce decision needs.
                          ranking_shadow_comparison: capabilityRun.pool.ranking_shadow,
                          // The discovered set this ranking describes, and
                          // whether it is the set the restored verdicts came
                          // from. Null ⇒ nothing restored to compare against.
                          pool_fingerprint: capabilityRun.pool.fingerprint,
                          pool_composition_changed:
                            capabilityRun.pool.composition_changed,
                        },
                      }
                      : {}),
                    // WHO ACTUALLY DECIDED EACH COMPANY.
                    //
                    // Diagnostic, not user-facing. `decided_by_model` is the
                    // number the GPT-authority correction is measured on — a run
                    // where it stays 0 means the evaluator never ran, whatever
                    // the other counters say.
                    evaluation_paths: summariseEvaluationPaths(capabilityRun.companies),
                    // WHAT THE EVALUATOR WAS ALLOWED, AND WHAT IT DID.
                    //
                    // Paired with `evaluation_paths` deliberately: paths say who
                    // decided each company, this says whether the evaluator was
                    // even constructed. `enabled:false` with `reason:"flag_off"`
                    // and `decided_by_model:0` is a configuration answer;
                    // `enabled:true` with `calls_made:0` is a bug. Before this
                    // was emitted the two were indistinguishable from the task
                    // row, which is how an unwired evaluator survived a review.
                    // STAGE 2 + STAGE 3 — where the money was pointed, and why.
                    //
                    // `triage_enabled:false` with everything zero is a
                    // configuration answer; `enabled:true` with
                    // `companies_triaged:0` is a bug. The budget block says why
                    // the shortlist was the size it was, which is the question
                    // `requested × 2` could never answer.
                    mission_triage_observability: triageTaskDiagnostics(
                      triageBinding, {
                        batches_made: triageBatchesMade,
                        companies_triaged: capabilityRun.state.triage?.total ?? 0,
                        relevant: capabilityRun.state.triage?.relevant ?? 0,
                        uncertain: capabilityRun.state.triage?.uncertain ?? 0,
                        irrelevant: capabilityRun.state.triage?.irrelevant ?? 0,
                      }),
                    investigation_budget: capabilityRun.state.shortlist_decision,
                    // WHY THE PAID STAGES WERE SIZED AS THEY WERE. The count
                    // budget, the wall clock and the pool are three different
                    // constraints and any of them can bind; `budget.source`
                    // names the one that did. Persisted at the top level so a
                    // starved run is diagnosable from the task row.
                    investigation_capacity: capabilityRun.state.investigation_capacity,
                    mission_evaluation_observability: evaluationTaskDiagnostics(
                      missionEvaluationBinding, {
                        calls_made: evaluationCallsMade,
                        calls_remaining: Math.max(
                          0, missionEvaluationBinding.callsRemaining - evaluationCallsMade),
                        companies_evaluated: evaluationCompaniesEvaluated,
                        budget_exhausted: evaluationBudgetExhausted,
                      }),
                    // USER-FACING, AND VALIDATED-ONLY. A rejected claim cannot
                    // reach this array; `buildWorkbenchExplanation` is built
                    // from `validated_claims` and nothing else.
                    workbench_grounded_explanations: capabilityRun.companies
                      .filter((c) => c.grounded !== null && c.evidence_registry !== null)
                      .map((c) => ({
                        company_key: c.key,
                        company_name: c.company.company_name,
                        recommended_action: c.verdict === "pass"
                          ? "offer_founder_unlock" : null,
                        ...buildWorkbenchExplanation(c.grounded!, c.evidence_registry!),
                      })),
                    // ── THE COMPANY BRAIN'S OWN RECORD ────────────────────────
                    //
                    // Was `semantic_classification_observability`, reporting the
                    // pre-Phase-4 classifier: `parse_status`, `repaired_fields`
                    // and `company_fit` all came from `semantic_parse`, which the
                    // engine no longer populates because that second evaluator is
                    // deleted. The fields degraded to literal
                    // `"invalid_fallback_review"` / `"review"` for every company —
                    // telemetry describing a stage that had stopped running.
                    //
                    // What remains is what the Brain actually produced: the gates
                    // it computed, the evidence it assembled, and its outcome.
                    // The SEMANTIC answer is reported by
                    // `mission_evaluation_observability` and `evaluation_paths`,
                    // which describe the one authority that exists.
                    company_brain_observability: {
                      companies: capabilityRun.companies
                        .filter((c) => c.brain !== null)
                        .map((c) => ({
                          company_key: c.key,
                          evaluated_at: new Date().toISOString(),
                          business_model: c.brain!.business_model,
                          confidence: c.brain!.confidence,
                          agentory_use_case: c.brain!.agentory_use_case,
                          supporting_evidence: c.brain!.supporting_evidence,
                          conflicting_evidence: c.brain!.conflicting_evidence,
                          unknown_fields: c.brain!.unknown_fields,
                          // COMPUTED AND REPORTED, BUT NOT ALL OF THEM DECIDE —
                          // see `gatesThatOutrankTheMission`.
                          failed_hard_gates: c.brain!.failed_hard_gates,
                          final_verdict: c.brain!.outcome,
                          final_reason: c.brain!.reason,
                        })),
                    },
                    // The ranked portfolio the Workbench renders, with its
                    // targets, tier counts and honest shortfall.
                    workbench_portfolio: {
                      version: portfolio.version,
                      targets: portfolio.targets,
                      counts: portfolio.counts,
                      shortfall: portfolio.shortfall,
                      entries: portfolio.entries,
                    },
                  },
                }).eq("id", task.id);
              }
            } catch (e) {
              console.log("[run-agent][capability-engine][final-progress-error]", String(e));
            }
            console.log("[run-agent][capability-engine][done]", {
              task_id: task.id,
              entry: capabilityRun.state.entry_capability,
              completed: capabilityRun.state.completed_capabilities,
              pending: capabilityRun.state.pending_capabilities,
              attempts: capabilityRun.state.provider_attempts.length,
              cost_units: capabilityRun.state.accumulated_cost_units,
              qualified: capabilityRun.state.qualified_company_keys.length,
              unknown: capabilityRun.state.unknown_company_keys.length,
              terminal_reason: capabilityRun.state.terminal_reason,
            });
          } catch (e) {
            // A containment violation is a BUG, not a provider failure, and it
            // must not silently degrade into the legacy path.
            console.log("[run-agent][capability-engine][error]", String(e));
            throw e;
          }
        }

        if (!resumeSatisfied && !capabilityRun && routeResolution.ok && routeRecord &&
            routeResolution.validated_route !== "broad_job_fallback") {
          // STAGE ONE OF `company_first_v1`, not an owner of its own. The route
          // executor and the quota loop below are two ordered stages of ONE
          // design that composes on purpose — primary source, then round until
          // quota. Claiming them as separate owners would have made the working
          // multi-round path look like a violation and forced a change to
          // stop-at-quota semantics, which this phase must not touch.
          leadOwnership.claimExecution(
            "company_first_v1",
            "no mission graph owns this task; the route executor is the entry stage",
          );
          leadOwnership.enterStage("route_executor");
          try {
            companyFirstRoute = await executeCompanyFirstRoute({
              // The SAME provider entry point the rest of run-agent uses. The
              // executor holds no provider import of its own.
              invoke: capabilityInvoke,
              // THE EXISTING canonical verifier — never re-implemented here.
              verifyEmployer: (person, companyUrl) => {
                const v = verifyCurrentEmployer(
                  {
                    title: person.title,
                    currentCompany: person.current_employer,
                    currentCompanyLinkedinUrl: person.current_employer_linkedin_url,
                    isCurrent: person.current_employer_is_current ?? null,
                  },
                  { name: null, normalizedName: null, canonicalDomain: null,
                    linkedinUrl: companyUrl, linkedinCompanyId: null, location: null,
                    dedupeKey: companyUrl, dedupeKeyKind: "linkedin_url" } as never,
                );
                // The existing gate decides; this never re-defines "verified".
                return { verified: employerGatePasses(v.outcome), outcome: String(v.outcome) };
              },
              log: (m, meta) => console.log("[run-agent][company-first-route]", m, meta),
            }, {
              route: routeResolution,
              routeRecord,
              requestedLeadCount: quota.requestedLeadCount,
              taskId: task.id,
              workspaceId: workspace_id,
              // The SAME compiled Brain policy the legacy path enforces, so the
              // company-fit gate and the existing hard gate cannot disagree.
              brain: brainEnforced
                ? {
                  employee_min: effectivePolicy.constraints.min_employees ?? null,
                  employee_max: effectivePolicy.constraints.max_employees ?? null,
                  positive_industries: effectivePolicy.constraints.positive_industries ?? [],
                  excluded_industries: effectivePolicy.constraints.negative_industries ?? [],
                  required_geography: null,
                }
                : undefined,
            });
            // ── CANONICAL PERSISTENCE + CONTACT ENRICHMENT ─────────────────
            // The SAME persistPlan the legacy pipeline uses. It owns accounts,
            // contacts, lead_candidates and the contact-enrichment handoff, so
            // company-first creates no parallel path — it only supplies plans.
            const projection = projectCompanyFirstPersistence(
              companyFirstRoute, workspace_id, task.id);
            const persistedOutcomes: PersistedOutcome[] = [];
            for (const p of projection.plans) {
              if (!p.plan.persistable) continue;
              try {
                const r = await persistPlan(p.plan);
                if (r.ok) companyFirstPersisted++;
                persistedOutcomes.push({
                  identity: p.idempotencyKey, verdict: String(p.plan.verdict),
                  quotaEligible: p.quotaEligible, result: r,
                });
              } catch (pe) {
                console.log("[run-agent][company-first-persist][error]",
                  { key: p.idempotencyKey, error: String(pe) });
                persistedOutcomes.push({
                  identity: p.idempotencyKey, verdict: String(p.plan.verdict),
                  quotaEligible: p.quotaEligible,
                  result: { ok: false, accountId: null, contactId: null,
                    leadCandidateId: null, reason: String(pe) },
                });
              }
            }

            // ── QUOTA FROM PERSISTED OUTCOMES, NOT FROM THE PROJECTION ──────
            // A plan PROJECTED as CONTACT that failed to write, or that lost its
            // account and therefore its contact eligibility, is not a lead. The
            // controller reads what persistence actually returned.
            companyFirstQuotaProgress = computeCompanyFirstQuotaProgress({
              persisted: persistedOutcomes,
              // Legacy CONTACTs already persisted by an EARLIER round or by the
              // run this one resumed. The legacy loop has not run yet at this
              // point, so anything it produces is combined afterwards via
              // combineContactIdentities — this set covers resume only.
              legacyContactIdentities: priorLegacyContactIdentities,
              requestedQuota: quota.requestedLeadCount,
              contactPending: companyFirstRoute.funnel.contact_ready -
                projection.counts.contact_ready >= 0
                ? projection.counts.contact_ready - persistedOutcomes.filter((o) =>
                  o.verdict === "CONTACT" && o.result.ok).length
                : 0,
              qualifiedCompany: companyFirstRoute.funnel.qualified_companies,
              founderPending: companyFirstRoute.funnel.founder_searched -
                companyFirstRoute.funnel.founder_verified,
            });
            companyFirstIdentities = collectCompanyFirstContactIdentities(persistedOutcomes);
            companyFirstQuotaCredit = companyFirstQuotaProgress.company_first_contact_credit;
            companyFirstAdaptive = nextAdaptiveAction(companyFirstQuotaProgress);
            companyFirstProjection = projection.counts;

            console.log("[run-agent][company-first-quota]", {
              task_id: task.id, ...companyFirstQuotaProgress,
              next_action: companyFirstAdaptive.action, reason: companyFirstAdaptive.reason,
              // A projected CONTACT that persistence did not confirm is visible
              // as the gap between these two numbers.
              projected_contact_ready: projection.counts.contact_ready,
            });

            console.log("[run-agent][company-first-route][done]", {
              task_id: task.id,
              executed_source_order: companyFirstRoute.executed_source_order,
              funnel: companyFirstRoute.funnel,
              persisted: companyFirstPersisted,
              projection: projection.counts,
              quota_credit: companyFirstQuotaCredit,
              diagnostics: companyFirstRoute.diagnostics,
            });
          } catch (e) {
            // A route failure must not lose the task; the legacy path still runs
            // and the failure is recorded rather than swallowed.
            console.log("[run-agent][company-first-route][error]", String(e));
          }
        }

        // RECONSTITUTED FROM THE ARTIFACT. NO MODEL CALL LIVES HERE ANY MORE.
        //
        // The chain of guards this replaces is worth remembering. First it was
        // `gptStrategy?.specRewritten ? null : await apply…` — which asked
        // whether the OTHER planner had succeeded, so an ordinary GPT fallback
        // opened a second model call here. Then it asked whether the selector had
        // named this adapter. Now it asks nothing: the adapter is not reachable
        // from this function, and a Claude-planned task is rebuilt from the
        // artifact the one call site produced, with `model_requests: 0`.
        const claudeFirst = leadPlanArtifact
          ? claudeFirstFromPersistedPlan(leadPlanArtifact, cfIntent.job_search_spec as unknown as Record<string, unknown>)
          : null;
        const cfIntentPlanned = gptStrategy?.specRewritten
          ? { ...cfIntent, job_search_spec: gptStrategy.spec as unknown as typeof cfIntent.job_search_spec }
          : claudeFirst?.specRewritten
          ? { ...cfIntent, job_search_spec: claudeFirst.spec as unknown as typeof cfIntent.job_search_spec }
          : cfIntent;
        // NULL whenever this workspace never opted in. The key is then omitted
        // entirely below, so a task result is byte-identical to pre-Phase-2.
        const claudeFirstDiagnostics = claudeFirst ? bridgeDiagnostics(claudeFirst) : null;
        if (claudeFirstDiagnostics) {
          console.log("[run-agent][claude-first]", {
            task_id: task.id,
            planner_source: claudeFirstDiagnostics.planner_source,
            fallback_reason: claudeFirstDiagnostics.fallback_reason,
          });
        }

        // COMPANY BRAIN AS A HARD GATE.
        //
        // Until now the company-first path never consulted the Brain: the ICP
        // filter existed but was only wired into the older lead-search flow, so
        // a company discovered from a hiring signal could reach the accepted set
        // without ever being checked for size, stage, industry or founder-led.
        // That is how a 7,337-employee company appeared under a Brain that asks
        // for small, early-stage, founder-led teams.
        //
        // The policy is compiled once per run and threaded down; the pipeline
        // enforces it before any people call, so a rejected company costs
        // nothing. A missing Brain leaves it unenforced — the previous behavior.
        console.log("[run-agent][company-brain]", {
          task_id: task.id, enforced: brainEnforced,
          policy_hash: effectivePolicy.policyHash,
          hard_constraints: effectivePolicy.provenance.hard_constraints,
          size: effectivePolicy.provenance.size,
        });

        // ORDERED SOURCE EXECUTION. Wraps the existing `invokeJobs` so provider
        // calls follow the validated plan one step at a time. Everything after the
        // call — normalization, Company Brain, decision-maker workflow, employer
        // verification, CONTACT quota, persistence — is untouched.
        // RESTORE the sequential slices from the SAME checkpoint that carries the
        // quota state, so a resumed run continues on the step it reached rather
        // than starting the plan again. Each slice is validated by its own
        // authority on the way in, so a stale one is discarded, not trusted.
        const cfStateStore = supabaseSourcingStateStore(supabase as never);
        const priorSourcingState = await cfStateStore.load(task.id);
        const priorSlices = (priorSourcingState?.slices ?? {}) as Record<string, unknown>;

        const sequentialSources = await applySequentialSourceExecution({
          workspaceId: workspace_id,
          taskId: task.id,
          invokeJobs,
          restoredState: (priorSlices[SOURCE_EXECUTION_KEY] ?? null) as never,
          restoredFusion: (priorSlices[FUSION_STATE_KEY] ?? null) as never,
          restoredFeedback: (priorSlices[SOURCE_FEEDBACK_KEY] ?? null) as never,
          companyBrainPolicyHash: brainEnforced ? effectivePolicy.policyHash : null,
          profile: {
            industries: cfIntent.job_search_spec.company_vertical ? [String(cfIntent.job_search_spec.company_vertical)] : [],
            stages: [],
            triggerRequirements: ["active_hiring"],
            hiring: {
              required: true,
              approvedAliases: cfIntentPlanned.job_search_spec.keyword_queries ?? [],
              geography: cfIntent.job_search_spec.location ?? undefined,
              // THE RECENCY POLICY HAS TO BE STATED HERE OR IT IS NEVER APPLIED.
              //
              // `deterministicOrderedPlan` sets `semanticIntent.postingWindowDays`
              // only when this field is present, and the compiler correctly emits
              // NOTHING when the intent carries no window. Production task
              // 9cb98f67 therefore sent no `datePosted` and no `timePostedRange`
              // at all — not empty strings, absent keys. The compiler was right;
              // nobody had told it the mission wanted fresh postings.
              //
              // 30 days is the mission default; the 60-day ceiling stays the
              // hard bound enforced downstream.
              maximumPostingAgeDays: 30,
            },
            decisionMakerRoles: cfIntent.job_search_spec.requested_person_roles ?? [],
            currentEmployerRequired: true,
            requestedCount: quota.requestedLeadCount,
            countEntity: "contact_ready_lead",
            quotaPolicy: "contact_only",
            requiredEvidence: [],
          },
          // ---- INITIAL ADAPTIVE STRATEGY -------------------------------------
          //
          // NO MODEL CALL AT ALL ON THIS PATH. The one planning request for this
          // task was made in orchestrate, at the single planner call site, and
          // what reaches here is the artifact it produced —
          // `claudeFirstFromPersistedPlan` / `gptStrategyFromPersistedPlan` rebuild
          // the adapter's accepted strategy with `model_requests: 0`.
          // `adaptiveStrategyBinding` then hands that ALREADY-accepted strategy to
          // the adaptive adapter; when the task was never planned, the strategy is
          // null and the sequential bridge keeps `deterministicOrderedPlan` with
          // the exact reason.
          //
          // Built by the gated seam rather than assembled here, so run-agent's
          // kernel surface stays the two modules test 32.E permits.
          // When the GPT owner produced the strategy, the Claude bridge never ran.
          // Its packs are bound HERE — production tasks 4851efb0 / b59b422b proved
          // that without this edge `activePacks` stays empty, `prepareStepPackCalls`
          // is never selected, and every round collapses back into ONE merged
          // Boolean call. There is still exactly one strategy authority.
          ...(gptStrategy?.resolution
            ? {
              ...gptAdaptiveStrategyBinding(gptStrategy.resolution.plan, {
                final_entity: "contact_ready_lead",
                requested_count: quota.requestedLeadCount,
                hiring_role_seed: String(cfIntent.job_search_spec.original_query ?? ""),
                decision_maker_roles: cfIntent.job_search_spec.requested_person_roles ?? [],
                company_constraints: {
                  business_model: cfIntent.job_search_spec.company_vertical
                    ? String(cfIntent.job_search_spec.company_vertical)
                    : undefined,
                  country: cfIntent.job_search_spec.location ?? undefined,
                  employee_count: brainEnforced
                    ? {
                      min: effectivePolicy.constraints?.min_employees ?? undefined,
                      max: effectivePolicy.constraints?.max_employees ?? undefined,
                    }
                    : undefined,
                },
                maximum_age_days: 60,
              }),
              strategyRouteOverride: { enabled: true, reason: "gpt_lead_strategy" },
            }
            : adaptiveStrategyBinding(claudeFirst ?? {
            spec: cfIntent.job_search_spec as unknown as LeadPlanningBridgeInput["spec"],
            specRewritten: false, outcome: null, mission: null,
            enablement: { enabled: false, reason: "flag_off" }, environment: null,
          }, {
            final_entity: "contact_ready_lead",
            requested_count: quota.requestedLeadCount,
            hiring_role_seed: String(cfIntent.job_search_spec.original_query ?? ""),
            decision_maker_roles: cfIntent.job_search_spec.requested_person_roles ?? [],
            company_constraints: {
              business_model: cfIntent.job_search_spec.company_vertical
                ? String(cfIntent.job_search_spec.company_vertical)
                : undefined,
              country: cfIntent.job_search_spec.location ?? undefined,
              // The Brain's own size band, so the validator can refuse a widening.
              employee_count: brainEnforced
                ? {
                  min: effectivePolicy.constraints?.min_employees ?? undefined,
                  max: effectivePolicy.constraints?.max_employees ?? undefined,
                }
                : undefined,
            },
            maximum_age_days: 60,
          })),

          log: (m, meta) => console.log("[run-agent][sequential-source]", m, meta),
        });

        // SEMANTIC COMPANY CLASSIFICATION — the final production edge.
        //
        // OFF by default: both SEMANTIC_COMPANY_CLASSIFICATION and the workspace
        // allow-list must pass, so a merge cannot switch paid classification on.
        // The classifier reaches the model through the SAME provider-independent
        // strategist facade as the strategy and feedback calls, with escalation
        // disabled — a per-company classification never justifies the escalation
        // tier. Ten unique company/evidence combinations per task; cache hits,
        // skips and unresolved identities all cost zero.
        // Built ABOVE, before the capability engine, because the engine is what
        // resolves an UNKNOWN Company Brain verdict.

        // ══ ENFORCED ADAPTIVE DECISION ═══════════════════════════════════════
        // The decision computed from PERSISTED outcomes now controls whether the
        // sourcing loop runs at all. Previously it was logged and ignored, which
        // meant a satisfied quota still paid for another round, and pending
        // founder/contact work still looked like a failed source.
        //
        // Fails CLOSED: an unrecognised decision runs nothing rather than
        // guessing that more spending is safe.
        const adaptiveDecision = companyFirstAdaptive?.action ?? priorDecision.action;
        if (resumeSatisfied) {
          legacySkipReason = "quota_satisfied_by_persisted_prior_contacts";
        } else if (companyFirstAdaptive) {
          if (adaptiveDecision === "stop_quota_satisfied") {
            legacySkipReason = "quota_satisfied_by_company_first";
          } else if (adaptiveDecision === "await_pending_work") {
            // NOT exhausted, NOT failed — work is in flight. Launching another
            // discovery source here is paying twice for one answer.
            legacySkipReason = companyFirstAdaptive.reason;
          } else if (adaptiveDecision !== "continue_sourcing") {
            legacySkipReason = `unrecognised_adaptive_decision:${adaptiveDecision}`;
          }
        }
        console.log("[run-agent][adaptive-enforcement]", {
          task_id: task.id,
          decision: companyFirstAdaptive?.action ?? null,
          reason: companyFirstAdaptive?.reason ?? null,
          requested_quota: quota.requestedLeadCount,
          persisted_contact: companyFirstQuotaProgress?.company_first_contact_credit ?? 0,
          founder_pending: companyFirstQuotaProgress?.founder_pending ?? 0,
          contact_pending: companyFirstQuotaProgress?.contact_pending ?? 0,
          will_run_another_source: legacySkipReason === null,
          skip_reason: legacySkipReason,
        });

        // ══ NO SILENT BROAD-JOB SOURCING UNDER A COMPANY-FIRST ROUTE ═════════
        // The legacy loop discovers through broad job boards. On a validated
        // NON-fallback route those boards are reachable only via
        // `broad_job_fallback`, which by contract requires a structured reason —
        // so reaching them from here without one re-creates exactly the default
        // the route exists to remove.
        //
        // It did. On TEST task 8af17651-5fa2-48e2-af87-4bc923146243 the route
        // executor's primary source returned 0 rows, `legacySkipReason` stayed
        // null because quota was unmet, and two broad LinkedIn Jobs rounds ran
        // anyway: 50 raw jobs, 20 companies, 0 qualified leads, no record that a
        // fallback had occurred.
        //
        // The reason is DERIVED FROM WHAT THE ROUTE ACTUALLY DID and validated
        // against the contract's own closed set — never invented here. A reason
        // the contract rejects blocks the loop instead of excusing it.
        //
        // ══ FOR A MISSION TASK THE LOOP IS SIMPLY UNREACHABLE ════════════════
        // The reasoning below is the LEGACY containment: it justifies a broad
        // sweep after the fact. A mission does not need justifying, because the
        // question was already answered when the capability graph was built — if
        // `job_discovery` is not in the graph, no quota shortfall and no
        // exhausted provider makes a job board appropriate. This runs FIRST so
        // the derived-reason path cannot re-open a door the mission closed.
        let legacyFallbackReason: string | null = null;

        // ══ EXECUTION OWNERSHIP OUTRANKS EVERY REASON BELOW ══════════════════
        //
        // THE HOLE THIS CLOSES. `executeRunAgentCompanyFirstSourcing` was called
        // unconditionally. For most missions it was neutered by chance rather
        // than by design: `legacyLoopReachable` returns false when the capability
        // graph excludes `job_discovery`, which is true of a company-first graph.
        //
        // But it returns TRUE for a mission whose graph legally contains
        // `job_discovery` — `requested_output: job_listings`, or job discovery
        // explicitly allowed. On those tasks the capability engine sourced,
        // qualified and persisted, and then the quota loop ran FOR REAL on top of
        // it with live invokers, and the two were reconciled by unioning their
        // persisted contact identities. That union is the "dedup instead of
        // ownership" the cleanup exists to remove.
        //
        // Ownership is checked FIRST so no downstream reason — an adaptive
        // decision, a justified broad-job fallback — can re-open a door the
        // owning engine already closed.
        if (!leadOwnership.mayExecute("company_first_v1") && legacySkipReason === null) {
          legacySkipReason = `execution_owned_by:${leadOwnership.executionOwner()}`;
          leadOwnership.decline("company_first_v1", legacySkipReason);
        }

        const missionLegacy = legacyLoopReachable(persistedMission, missionPlan);
        if (!missionLegacy.reachable && legacySkipReason === null) {
          legacySkipReason = `lead_mission_forbids_broad_job_sourcing:${missionLegacy.reason}`;
        }
        if (legacySkipReason === null && routeResolution.ok &&
            routeResolution.validated_route !== "broad_job_fallback") {
          const candidateReason = companyFirstRoute === null
            ? "primary_source_unavailable"
            : (companyFirstRoute.funnel.qualified_companies > 0
              ? "remaining_quota_justifies_round"
              : "primary_source_no_candidates");
          const fallbackCheck = validateHiringRoute({
            route: "broad_job_fallback", fallback_reason: candidateReason,
          }, { userRequest: routeUserRequest });
          if (fallbackCheck.ok) {
            legacyFallbackReason = candidateReason;
            if (routeRecord) routeRecord.fallback_reason = fallbackCheck.fallback_reason;
          } else {
            legacySkipReason = `broad_job_fallback_unjustified:${candidateReason}`;
          }
        }
        console.log("[run-agent][broad-job-fallback]", {
          task_id: task.id,
          validated_route: routeResolution.ok ? routeResolution.validated_route : null,
          company_first_ran: companyFirstRoute !== null,
          qualified_companies: companyFirstRoute?.funnel.qualified_companies ?? 0,
          fallback_reason: legacyFallbackReason,
          blocked: legacySkipReason,
        });

        // ENFORCEMENT AT THE PROVIDER BOUNDARY. When the decision says stop or
        // wait, the loop is bounded to zero rounds AND the invokers hard-refuse.
        // Two independent guards, because a bound is a number someone can change
        // and a refusal is a fact.
        const sourcingBlocked = legacySkipReason !== null;
        // STAGE TWO OF `company_first_v1`. Claimed only when the loop may
        // actually source: a blocked call still executes with no-op invokers and
        // zero rounds, and claiming ownership for a run that cannot spend or
        // persist would make the ledger lie about who executed the task.
        if (!sourcingBlocked) {
          leadOwnership.claimExecution(
            "company_first_v1",
            "the quota loop is sourcing for this task",
          );
          leadOwnership.enterStage("quota_loop");
        }
        const cf = await executeRunAgentCompanyFirstSourcing({
          intent: cfIntentPlanned, workspaceId: workspace_id, planId: plan_id ?? null, taskId: task.id,
          brainConstraints: brainEnforced ? effectivePolicy.constraints : null,
          brainPolicyHash: brainEnforced ? effectivePolicy.policyHash : null,
          requestedLeadCount: quota.requestedLeadCount, requestedCountSource: quota.source,
          proposeBroadening: broadeningPlanner.plan,
          plannerMetadata: broadeningPlanner.lastMetadata,
          durableIdempotency: supabaseToolCallReader(supabase as never),
          stateStore: cfStateStore,
          invokeJobs: sourcingBlocked
            ? (() => { legacyBlockedCalls++; return Promise.resolve([]); })
            : sequentialSources.invokeJobs,
          invokePeople: sourcingBlocked
            ? (() => { legacyBlockedCalls++; return Promise.resolve([]); })
            : invokePeople,
          persist: persistPlan,
          // Null when disabled ⇒ the pipeline makes no model call at all.
          classifyCompanyEvidence: classificationBinding.classifyCompanyEvidence ?? undefined,
          classificationCallsRemaining: classificationBinding.classificationCallsRemaining,
          // CLOSES THE SOURCE LOOP. After each round the bridge builds one
          // observation, decides the one next action and folds it into the state
          // the next round reads. Inert when the workspace has not opted in.
          onRoundComplete: sequentialSources.onObservation,
          // TITLE EXHAUSTION IS NOT SEARCH EXHAUSTION. Read-only: it lets the
          // controller ask whether another approved discovery source is still
          // pending before it ends the whole mission. Without it, plan 43fb7313
          // returned `search_exhausted` with LinkedIn, Glassdoor and ATS pending.
          pendingDiscoverySource: sequentialSources.nextPendingDiscoverySource,
          // PLAN-AWARE ACTION BUDGET. `planAwareActionBudget` shipped tested with
          // no production caller, so every run still stopped on the blind
          // three-round limit — including runs with unused exact packs and
          // untried sources. Supplying it here lets useful work continue while
          // quota, money, repeated low-quality sources and the hard provider
          // ceiling each still end the run. Absent when the sequential bridge is
          // disabled, which keeps the pre-existing fixed limits in force.
          ...(sequentialSources.enabled && !sourcingBlocked
            ? { actionBudget: createPlanAwareActionBudget(sequentialSources.planBudgetSnapshot) }
            : {}),
          // ZERO ROUNDS when the adaptive decision blocked sourcing. Without
          // dropping actionBudget above, loopBound would come from the hard
          // provider ceiling instead of maxRounds and the loop would still run.
          ...(sourcingBlocked ? { bounds: { maxRounds: 0 } } : {}),
          log: (m, meta) => console.log("[run-agent][company-first]", m, meta),
        });

        // ══ COMBINED, DEDUPLICATED CONTACT QUOTA ═════════════════════════════
        // Both paths' PERSISTED CONTACT identities, unioned. The same person
        // reached twice is one lead; two different people are two. Identities
        // come from canonical lead-candidate ids first — never a display name or
        // a vanity URL, either of which would silently merge or split leads.
        {
          const thisRunLegacy = collectLegacyContactIdentities((cf.items ?? []) as never);
          // Prior persisted CONTACTs join the legacy side, so a resume cannot
          // re-credit a lead an earlier attempt already produced.
          const legacyIds = {
            ...thisRunLegacy,
            identities: [...new Set([...priorLegacyContactIdentities, ...thisRunLegacy.identities])],
          };
          combinedQuota = combineContactIdentities(
            legacyIds,
            companyFirstIdentities ??
              { identities: [], strategy: "none", unidentifiable: 0 },
            quota.requestedLeadCount,
          );
          legacySourcingRan = !sourcingBlocked;
          console.log("[run-agent][combined-quota]", {
            task_id: task.id, ...combinedQuota,
            legacy_sourcing_ran: legacySourcingRan,
            legacy_blocked_provider_calls: legacyBlockedCalls,
            adaptive_decision: companyFirstAdaptive?.action ?? null,
          });
        }

        // ONE canonical run context, built once and carried unchanged into the
        // response, the UI panel, the task result and the CSV export. Surfaces
        // used to rebuild their own subset from different places, which is why
        // fields the runtime had produced still rendered blank downstream.
        // The controller persists per-company diagnostics into the sourcing state
        // checkpoint. Re-read it here so the run context — and therefore the
        // Workbench panel built from it — carries what the backend evaluated.
        // Task 15c31f55 stored ten of these and the panel still showed zero,
        // because nothing copied them across this seam.
        const finalSourcingState = await cfStateStore.load(task.id).catch(() => null);
        const finalDiagnostics =
          (finalSourcingState?.candidate_diagnostics as Array<Record<string, unknown>> | undefined) ?? null;

        const runContext = buildQualifiedLeadRunContext({
          candidateDiagnostics: finalDiagnostics,
          result: cf,
          jobIntent: compileJobIntent(cf.routing.original_user_query),
          requestedPersonRoles: cfIntent.job_search_spec.requested_person_roles ?? null,
          workflowKind: (body.workflow_kind as string) ?? "qualified_lead_sourcing",
          countEntity: (body.count_entity as string) ?? "contact_ready_lead",
        });

        // Completion is EARNED by delivering eligible leads, never by successful
        // database writes. Anything short of the quota reports why.
        // `continuation_required` is NOT terminal — the task stays `partial` with a
        // checkpoint so a later invocation resumes instead of restarting.
        // STATUS SEPARATION. The COLUMN carries database execution state only
        // (the values every declared constraint agrees on); the sourcing outcome
        // and the quota outcome live in `result`. Overloading the column made it
        // mean two things at once and would break the moment the constraint
        // declared in migration 20260519104244 is actually applied.
        // The CONTACT-only quota is the completion authority. Passing it is what
        // stops a terminal-but-unfilled run (`search_exhausted` with 0 of 5)
        // reporting itself as Complete. `cf.quota` is the existing authority —
        // no second quota controller is introduced.
        // ══ THE FRONTIER DECIDES WHETHER THE JOB IS FINISHED ═══════════════
        //
        // TWO AUTHORITIES DISAGREED AND THE WRONG ONE WON. `cf.status` comes
        // from the legacy quota controller's ROUND COUNT — it reported
        // `round_limit_reached` after its one round — while the capability
        // engine held 88 companies on the investigation frontier and the user
        // had asked for ten leads and been given three.
        //
        // `round_limit_reached` is in NON_RESUMABLE, so `decideResume` refused
        // the automatic continuation with `already_terminal` (HTTP 409) on two
        // separate gates: `result.terminal_status` and the copy inside
        // `company_first_state`. The run declared itself finished and then
        // enforced it against its own successor.
        //
        // A job with candidates still to investigate and an unmet quota is
        // `continuation_required` — the one terminal status that means "not
        // over". This is the same correction already made to the capability
        // ledger, applied to the status the resume gate actually reads.
        const sliceQualified = capabilityRun
          ? capabilityRun.state.qualified_company_keys.length : 0;
        const sliceFrontier = capabilityRun
          ? capabilityRun.companies.filter(
            (c) => isFrontier(c.investigation_state)).length
          : 0;
        const priorTaskRow = await supabase
          .from("tasks").select("result").eq("id", task.id).maybeSingle();
        const priorProgress = readLineageProgress(
          (((priorTaskRow.data as { result?: Record<string, unknown> } | null)
            ?.result ?? {}) as Record<string, unknown>)[LINEAGE_PROGRESS_KEY]);
        // ── COMPANIES AND AUTHORISATIONS ARE DIFFERENT QUANTITIES ──────────
        //
        // `investigation_selected` is a SPEND counter — it re-counts work
        // carried in flight, on purpose, because this invocation buys those
        // searches too. It was being reported as a company count, and summed
        // across slices on top of that.
        //
        // The company count is derived from the working set, which is
        // deduplicated by construction and restored whole on every
        // continuation, so a company investigated in slice one cannot be
        // counted again in slice four.
        const uniqueInvestigated = capabilityRun
          ? capabilityRun.companies.filter(
            (c) => wasInvestigated(c.investigation_state)).length
          : 0;
        const progress = foldSlice(priorProgress, {
          qualifiedInPool: sliceQualified,
          uniqueCompaniesInvestigatedInPool: uniqueInvestigated,
          authorisationsInPool: capabilityRun?.state.investigation_selected ?? 0,
          costUnitsInLineage: capabilityRun?.state.accumulated_cost_units ?? 0,
        });
        const autoDecision = decideAutoContinuation({
          // THE HIGH-WATER MARK, not this slice's count. A slice that evaluated
          // nobody reports zero, and reading that as the total is how a barren
          // round erases a productive one.
          qualified: progress.qualified_high_water,
          requestedCount: quota.requestedLeadCount,
          frontierRemaining: sliceFrontier,
          continuationsUsed: progress.continuations_used,
          maxContinuations: resolveMaxContinuations(),
          costUnitsUsed: progress.cost_units_used,
          maxCostUnits: resolveMaxLineageCostUnits(),
          barrenSlices: progress.barren_slices,
          providerFailed: cf.status === "provider_failure",
        });
        // The status the REST of this branch persists and projects from.
        const effectiveTerminal = autoDecision.continue
          ? "continuation_required"
          : cf.status;
        if (effectiveTerminal !== cf.status) {
          console.log("[run-agent][auto-continuation] terminal_status_overridden", {
            task_id: task.id, from: cf.status, to: effectiveTerminal,
            frontier_remaining: sliceFrontier,
            qualified: progress.qualified_high_water,
            requested: quota.requestedLeadCount,
          });
        }
        const statuses = projectStatus(
          effectiveTerminal, cf.writeBoundary.invariantViolation, {
            contactReady: cf.quota.eligible_leads,
            requested: cf.quota.requested_leads,
          });
        const taskStatus = statuses.taskStatus;
        // The claim is RELEASED here so the next Continue can take it. Leaving it
        // set would make the task look permanently in-flight.
        const { data: finishedRow } = await supabase.from("tasks").select("result").eq("id", task.id).maybeSingle();
        const priorTaskResult = releaseClaim(((finishedRow as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>);
        await supabase.from("tasks").update({
          status: statuses.rowStatus,
          result: {
            ...priorTaskResult,
            task_status: statuses.taskStatus,
            terminal_status: statuses.terminalStatus,
            output: `Company-first sourcing (${cf.status}): ${cf.quota.eligible_leads}/${cf.quota.requested_leads} eligible leads across ${cf.rounds_attempted} round(s); ${cf.counts.verifiedCompanies} verified companies. ${cf.terminal_reason}`,
            executed_sourcing_mode: "company_first",
            company_first: cf,
            // ── WRITTEN BEFORE ANYTHING IS DISPATCHED ────────────────────────
            //
            // The successor is fired further down and immediately begins writing
            // this same row, so anything recorded AFTER the handoff races it.
            // `dispatch` is filled in only when the handoff fails, which is the
            // one case where no successor exists to collide with.
            [LINEAGE_PROGRESS_KEY]: progress,
            // ── WHO CHOSE THESE ACTORS, AND WHY ─────────────────────────────
            //
            // The engine has always computed this and logged it; nothing ever
            // persisted it. Auditing the 2026-08-17 run therefore could not say
            // whether the model had been asked and refused or had never been
            // consulted — the only available evidence was that the live Apify
            // input matched the engine's hardcoded literals exactly, which is
            // inference, not a record.
            //
            // `null` is itself informative: it means discovery never ran in
            // this slice (a resumed run reusing a stored pool), which is a
            // different thing from "ran deterministically".
            discovery_strategy: capabilityRun?.state.discovery_strategy ?? null,
            auto_continuation: {
              version: AUTO_CONTINUATION_VERSION,
              continuing: autoDecision.continue,
              decision: autoDecision.reason,
              detail: autoDecision.detail,
              user_message: autoDecision.continue ? autoDecision.user_message : null,
              dispatch: null,
            },
            // ── THE CHECKPOINT THE RESUME GATE ACTUALLY READS ──────────────
            //
            // `decideResume` inspects `company_first_state.terminal_status`
            // BEFORE the top-level one and refuses on either. The controller
            // writes `round_limit_reached` there from its own round count, so
            // overriding only the top-level status would have changed nothing
            // and the continuation would still 409.
            //
            // Cleared — not rewritten to a different terminal — because the
            // job genuinely has not reached one: candidates remain and the
            // quota is unmet.
            ...(autoDecision.continue
              ? {
                company_first_state: {
                  ...((priorTaskResult.company_first_state ?? {}) as Record<string, unknown>),
                  terminal_status: null,
                  terminal_reason: null,
                  next_action: "start_round",
                },
              }
              : {}),
            // Carried in the task row too, so the Workbench can render the run
            // context after a page reload without re-reading the response.
            qualified_lead_run_context: runContext,
            // Phase 2 planner diagnostics — hashes rather than content, and present
            // ONLY for a workspace that opted in. With the feature off the key does
            // not exist, so the task result, the run context the Workbench reads
            // back, and every export are unchanged from before Phase 2.
            ...(claudeFirstDiagnostics ? { claude_first_planning: claudeFirstDiagnostics } : {}),
            // AUTHORITATIVE INITIAL STRATEGY provenance: model, authority, validation,
            // fallback reason, role family, pack ids, source order and plan hash.
            // Present ONLY for a workspace the GPT strategy owner is enabled for.
            ...(gptStrategy?.diagnostics ? { lead_strategy_initial: gptStrategy.diagnostics } : {}),
            // Ordered-source execution, evidence fusion and bounded feedback.
            // Present ONLY for a workspace that opted in, so a task result is
            // unchanged for everyone else.
            // ALWAYS persisted, enabled or not. Gating this on `enabled` is what
            // made production run c34c0cad unauditable: the runtime was inert and
            // the result recorded nothing about why, so the reason had to be
            // re-derived offline. The disabled payload is safe metadata only —
            // capability keys, rejection codes and booleans.
            sequential_source_execution: sequentialSourceDiagnostics(sequentialSources),
            // Which Company Brain policy actually gated this run. Safe metadata
            // only: versions, a hash and constraint NAMES — never Brain prose.
            company_brain_policy: {
              enforced: brainEnforced,
              policy_hash: effectivePolicy.policyHash,
              policy_version: effectivePolicy.provenance.policy_version,
              brain_version: effectivePolicy.provenance.brain_version,
              hard_constraints: effectivePolicy.provenance.hard_constraints,
              unknown_evidence: effectivePolicy.provenance.unknown_evidence,
              size: effectivePolicy.provenance.size,
              rejected_broadening: effectivePolicy.provenance.rejected_broadening,
            },
            lead_entity_intent: cfIntent,
            routing: { target_entity: cfIntent.target_entity, output_type: cfIntent.output_type, execution_mode: "company_first", company_first: true, company_gate_required: cfIntent.company_gate_required },
            // ── THE MISSION AND WHAT IT AUTHORISED ─────────────────────────
            // Persisted, not response-only. `hiring_route` lived only in the
            // HTTP response, so the one artefact that would have shown the
            // 2026-08-03 route downgrade was absent from the task that failed.
            // Resume reads these instead of re-interpreting the query.
            original_user_query: persistedMission?.original_user_query ?? routeUserRequest,
            lead_mission: persistedMission,
            lead_mission_version: persistedMission?.version ?? null,
            mission_authority: persistedMission ? "lead_mission_v1" : "legacy_carrier_union",
            field_provenance: persistedMission?.field_provenance ?? null,
            capability_graph: missionPlan
              ? {
                version: missionPlan.version,
                entry_capability: missionPlan.entry_capability,
                steps: missionPlan.steps,
                prohibited: missionPlan.prohibited,
                allowed_providers: missionPlan.allowed_providers,
                estimated_cost_units: missionPlan.estimated_cost_units,
              }
              : null,
            legacy_loop_containment: missionLegacy,
            // ── CAPABILITY EXECUTION STATE ─────────────────────────────────
            // What ran, what is still pending, every provider attempt and its
            // outcome, accumulated cost, and the deduplicated/qualified/unknown
            // company sets. A resume reloads THIS and continues at the next
            // incomplete capability — it never re-interprets the query.
            capability_execution_state: capabilityRun?.state ?? null,
            capability_outcomes: capabilityRun?.capability_outcomes ?? null,
            // Companies the Brain could not decide on. Held for evidence
            // resolution, explicitly NOT counted as rejections.
            unknown_companies_pending_evidence:
              capabilityRun?.state.unknown_company_keys ?? null,
            semantic_classification_status: {
              enabled: classificationBinding.enablement.enabled,
              reason: classificationBinding.enablement.reason,
              calls_allowed: classificationBinding.enablement.maxCalls,
              consulted_by_engine: capabilityRun !== null &&
                classificationBinding.classifyCompanyEvidence !== null,
            },
            hiring_route: routeRecord
              ? { ...routeRecord, drift: routeDrift(routeRecord) }
              : { error: routeResolution.ok ? null : routeResolution.errors },
          },
        }).eq("id", task.id);

        // RELEASE THE DURABLE LEASE. `releaseClaim` above only strips the
        // `result` key the compatibility path writes; the RPC's lease lives in
        // `tasks.continuation_claim_*` COLUMNS. Leaving them set makes the next
        // `Continue sourcing` fail `already_claimed` until the lease expires.
        // Best-effort: the outcome is already committed, so a failure here costs
        // one lease interval, never a result.
        if (heldClaim?.viaRpc) {
          const released = await releaseContinuationViaRpc({
            db: supabase as unknown as RpcDb,
            taskId: task.id, workspaceId: workspace_id,
            claimId: heldClaim.claimId, rowStatus: statuses.rowStatus,
          });
          if (!released.released) {
            console.error("[run-agent][company-first] claim release failed", {
              task_id: task.id, claim_path: "rpc",
              claim_error_category: released.category, claim_error_code: released.code,
            });
          }
        }

        // ══ THE REQUEST CONTINUES ITSELF ═══════════════════════════════════
        //
        // "Find 10 qualified AI startups" is the job; this invocation was a
        // ~125s slice of it. Until now the slice ended and the job did not
        // resume — the checkpoint was durable, the task advertised itself as
        // resumable, and across 202 tasks nothing and nobody ever picked one up.
        //
        // ORDER MATTERS AND IS DELIBERATE. The result row is already written and
        // the lease is already released before anything is dispatched, so the
        // slice that resumes finds a durable checkpoint and an unheld claim. A
        // dispatch before either would race its own successor.
        // `progress` and `autoDecision` were computed BEFORE the status
        // projection — the terminal status depends on them, so they cannot be
        // decided after it. Only the dispatch happens here, once the result is
        // durable and the lease released.
        let dispatchOutcome: DispatchOutcome | null = null;
        if (autoDecision.continue) {
          dispatchOutcome = await dispatchContinuation({
            resumeTaskId: task.id,
            workspaceId: workspace_id,
            userId: taskUserId,
            planId: plan_id ?? null,
            agentSlug: agent_slug,
            // THE ORCHESTRATED CONTRACT AND THE COMPILED MISSION. `run-agent`
            // validates both before it ever looks at `resume_task_id`, and the
            // mission is read from the request rather than the checkpoint — a
            // continuation without them is refused, or runs a different job.
            stepIndex: step_index ?? 0,
            // THE MISSION'S OWN QUERY, NOT THE PLANNER'S INSTRUCTION.
            //
            // `effectiveInstruction` on this plan is the deterministic
            // fallback planner's string — "Find 10 jobs matching: Software
            // Engineer OR …" — which is a JOBS instruction. Forwarding it gave
            // the continuation's router exactly the wrong thing to fall back
            // to when the mission failed to arrive, and it duly chose
            // `person_first` / `apify_jobs`. The mission's own words are what
            // the user actually said.
            instruction: persistedMission?.original_user_query ?? effectiveInstruction,
            toolInput: tool_input_body ?? null,
            leadMission: (persistedMission ?? null) as Record<string, unknown> | null,
            continuationIndex: progress.continuations_used,
          }, {
            fetch: (url, init) => fetch(url, init),
            functionsBaseUrl: Deno.env.get("SUPABASE_URL")
              ? `${Deno.env.get("SUPABASE_URL")}/functions/v1`
              : null,
            serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null,
            log: (m, meta) => console.log("[run-agent][auto-continuation]", m, meta),
          });
        }

        // A DISPATCH THAT DID NOT HAPPEN IS A STOP, and must be recorded as one.
        // Otherwise the task claims it is continuing and nothing ever arrives —
        // which is indistinguishable, to the user, from the bug this replaces.
        const effectivelyContinuing = autoDecision.continue &&
          dispatchOutcome?.dispatched === true;
        const finalProgress: LineageProgress = {
          ...progress,
          stopped_reason: effectivelyContinuing
            ? null
            : autoDecision.continue
            // WANTED TO CONTINUE, COULD NOT. Not a provider failure — a fault
            // in the handoff, and it must be named as one.
            ? "dispatch_failed"
            : (autoDecision.reason as LineageProgress["stopped_reason"]),
          stopped_detail: effectivelyContinuing
            ? null
            : autoDecision.continue
            ? `the next slice could not be started: ${
              dispatchOutcome && !dispatchOutcome.dispatched
                ? dispatchOutcome.detail
                : "unknown"
            }`
            : autoDecision.detail,
        };
        console.log("[run-agent][auto-continuation]", {
          task_id: task.id,
          qualified: finalProgress.qualified_high_water,
          requested: quota.requestedLeadCount,
          frontier_remaining: sliceFrontier,
          continuations_used: finalProgress.continuations_used,
          cost_units_used: finalProgress.cost_units_used,
          barren_slices: finalProgress.barren_slices,
          decision: autoDecision.reason,
          detail: autoDecision.detail,
          dispatched: dispatchOutcome?.dispatched ?? false,
          continuing: effectivelyContinuing,
        });
        // ── ONLY A FAILED HANDOFF WRITES AGAIN ─────────────────────────────
        //
        // THE RACE THIS REMOVES. This used to read the row and merge into it
        // AFTER the dispatch — and the dispatch is fire-and-forget, so the
        // successor was already running and writing its own result. Two slices
        // read-modify-writing the same row means the slower one wins with stale
        // data. On task b4eb3710 the final row came back with
        // `auto_continuation: null` and `lead_lineage_progress: null` after
        // three slices, because an earlier slice's late write landed on top of
        // the last one's.
        //
        // The decision and the running totals are now written by the MAIN result
        // update above, which happens before anything is dispatched. Nothing
        // needs to be written here at all unless the handoff FAILED — and if it
        // failed there is no successor to race.
        if (autoDecision.continue && !effectivelyContinuing) {
          const { data: currentRow } = await supabase
            .from("tasks").select("result").eq("id", task.id).maybeSingle();
          await supabase.from("tasks").update({
            result: {
              ...(((currentRow as { result?: Record<string, unknown> } | null)?.result ??
                {}) as Record<string, unknown>),
              [LINEAGE_PROGRESS_KEY]: finalProgress,
              auto_continuation: {
                version: AUTO_CONTINUATION_VERSION,
                continuing: false,
                decision: autoDecision.reason,
                detail: autoDecision.detail,
                user_message: null,
                dispatch: dispatchOutcome,
              },
            },
          }).eq("id", task.id);
        }

        // FINALIZE THE PLAN. The company-first branch returns here, far above the
        // ordinary finalization near the end of this function, so without this the
        // `task_plans` row keeps the `executing` it was created with — forever.
        // That is exactly what production run dc41c9f2 showed: the task finished
        // correctly at 10:40:51 as partial/continuation_required while the plan row
        // still said `executing` with `updated_at` equal to `created_at`, so the UI
        // sat on "Plan is being created" for nine minutes after the work had stopped.
        //
        // The projection is the one already computed above — no second status
        // authority, and `continuation_required` becomes `partial` (resumable),
        // never `complete`.
        // ══ TASK-LEVEL FUNNEL AND STOP REASON, AS STAGE RESULTS ══════════════
        //
        // WHY THESE ARE NOT WRITTEN ONTO A PROVIDER ROW. Several Actor calls
        // contribute to one qualified-company count; attributing the total to
        // whichever call happened to be last would make the ledger state
        // something untrue about that Actor. These are outcomes of Agentory's own
        // gates, so they are recorded as `stage_result` rows with no provider run
        // id, and the summary never sums them into "provider calls".
        //
        // ── THE REASON MUST BELONG TO THE OWNER THAT EXECUTED ───────────────
        //
        // This block runs for BOTH company-first and capability-engine tasks —
        // the engine executes inside this same branch and returns through the
        // same path. So writing `cf.terminal_reason` unconditionally attributed
        // the QUOTA CONTROLLER's reason to rows stamped
        // `execution_owner: capability_engine_v1`, on a run where that
        // controller had been deliberately neutered by the ownership guard.
        //
        // That is worse than recording nothing: a ledger naming the wrong
        // owner's reason reads as evidence. Each owner's own authoritative
        // field is used instead, and neither vocabulary is reinterpreted into a
        // third one. NULL when the owning path recorded no reason — never
        // invented.
        const terminalReasonForOwner = capabilityRun
          ? capabilityRun.state.terminal_reason ?? null
          : cf.terminal_reason ?? null;
        try {
          const ledger = createLedgerWriter(supabase as never);
          const own = auditOwnership();
          const base = {
            workspace_id, task_id: task.id, plan_id: plan_id ?? null,
            reason: "unspecified" as const,
            ...own,
          };
          await recordStageResult(ledger, {
            ...base,
            stage: "company_discovery",
            capability: "company_discovery",
            logical_call_key: `${task.id}:stage:company_discovery`,
            // `rawJobs` and `verifiedCompanies` are the controller's own measured
            // numbers. Anything it did not measure stays absent, and therefore
            // NULL — never 0.
            counts: capabilityRun
              ? {
                // `accounts_found` is the engine's own discovery count and
                // `qualified_companies` its own gate outcome. Neither is
                // defaulted to 0 here: the engine defaults them internally, but
                // a NULL progress snapshot means it never published one, and
                // that is unknown rather than none.
                raw: capabilityRun.state.progress?.accounts_found ?? null,
                normalized: capabilityRun.state.prequalification?.unique_companies ?? null,
                accepted: capabilityRun.state.progress?.qualified_companies ?? null,
              }
              : {
                raw: cf.counts.rawJobs ?? null,
                accepted: cf.counts.verifiedCompanies ?? null,
              },
          });
          await recordStageResult(ledger, {
            ...base,
            stage: "person_resolution",
            capability: "decision_maker",
            logical_call_key: `${task.id}:stage:person_resolution`,
            // The engine keeps its own progress counters; the controller keeps
            // `cf`. Reading the one that did not execute would report zeros as
            // though they were measurements, so each owner reports its own and
            // anything unmeasured stays NULL.
            counts: capabilityRun
              ? {
                raw: capabilityRun.state.progress?.identity_resolved ?? null,
                accepted: capabilityRun.state.progress?.decision_makers_verified ?? null,
              }
              : { raw: cf.counts.candidates ?? null, accepted: cf.quota.eligible_leads ?? null },
            // The last stage result carries the stop reason, so reading the
            // ledger in order ends with why the run ended.
            next_decision: terminalReasonForOwner,
          });
        } catch (e) {
          console.log("[run-agent][ledger][stage-result-error]", String(e));
        }

        await finalizeCompanyFirstPlan(supabase, plan_id, task.id, agent.id, workspace_id, statuses, cf.terminal_reason);

        // THE PANEL HAS TO BE PERSISTED, NOT JUST RETURNED.
        //
        // This object used to exist only inside the JSON below. orchestrate calls
        // run-agent fire-and-forget, so nothing ever read that response and no
        // message carrying `ui_panel` was ever written. Two visible failures came
        // from that one omission:
        //
        //   * ChatView auto-opens the Workbench off a persisted message with
        //     `metadata.ui_panel.kind === "lead_results"`, so it never opened.
        //   * WorkbenchPanel.renderTable() renders <LeadResultsView> only when it
        //     HAS that panel; without one it falls through to AgentOutputViewer —
        //     which is why the Workbench showed raw Indeed job cards with Save
        //     Lead / Enrich / Draft Outreach instead of the qualified-lead table.
        //
        // The spreadsheet Workbench was never lost and needs no restoring. It was
        // starved of its panel.
        const uiPanel = {
          kind: "lead_results",
          title: "Qualified lead sourcing",
          subtitle: `${cf.quota.eligible_leads} of ${cf.quota.requested_leads} CONTACT-ready leads`,
          source_type: "hiring_signal",
          plan_id: plan_id ?? null,
          lead_count: cf.quota.eligible_leads,
          enrichable_count: 0,
          lead_candidate_ids: cf.items.map((i) => i.leadCandidateId).filter(Boolean),
          actions: [],
          qualified_lead_run: runContext,
        };

        // Opens for completed, partial, continuation-required and zero-lead
        // outcomes alike — a run that found nothing still owes the user the
        // honest empty table, the bottleneck and the Continue action.
        await persistLeadResultsPanel(supabase, plan_id, uiPanel, {
          eligible: cf.quota.eligible_leads,
          requested: cf.quota.requested_leads,
          rawJobs: cf.counts.rawJobs,
          terminalStatus: cf.status,
          taskId: task.id,
          // Present only when the capability engine ran. `capabilityRun` is null
          // for legacy tasks, and the legacy counter is then still correct.
          mission: capabilityRun
            ? {
              companies_discovered: capabilityRun.state.company_keys.length,
              companies_evaluated: capabilityRun.state.prequalification?.unique_companies ?? 0,
              open_jobs_evaluated: capabilityRun.state.prequalification?.open_jobs_evaluated ?? 0,
              commercially_eligible: capabilityRun.state.prequalification?.eligible_companies ?? 0,
              // THE SHORTLIST THAT WAS ACTUALLY PAID FOR — summed over every
              // investigation pass. `counts.selected` belongs to the RANKING
              // call, which is given the whole pool on purpose, so reading it
              // here reported every discovered company as shortlisted.
              shortlisted: capabilityRun.state.investigation_selected,
              identities_resolved: capabilityRun.state.progress?.identity_resolved ?? 0,
              identities_unresolved: capabilityRun.state.progress?.identity_unresolved ?? 0,
              qualified: capabilityRun.state.qualified_company_keys.length,
              contact_ready: capabilityRun.state.contact_identities.length,
            }
            : null,
        });

        // Conclusively SKIP the ordinary people-first branch for this request.
        return json({
          success: cf.status === "completed", task_id: task.id,
          executed_sourcing_mode: "company_first",
          terminal_status: cf.status, terminal_reason: cf.terminal_reason,
          // FRONTEND QUOTA CONTRACT. The UI must never re-derive CONTACT progress
          // from accepted accounts or persisted rows, so every number it needs is
          // stated here explicitly — including what the count actually counts.
          task_status: taskStatus,
          workflow_kind: "qualified_lead_sourcing",
          count_entity: "contact_ready_lead",
          quota_policy: cf.quota.quota_policy,
          rounds_completed: cf.rounds_attempted,
          continuation_token: cf.continuation.continuation_token,
          next_round: cf.continuation.next_round,
          checkpoint_at: cf.continuation.checkpoint_at,
          // Per-candidate diagnostics for Workbench cards + CSV export. Company,
          // person and job URL only — no provider payloads, prompts or traces.
          candidates: cf.items,
          // ONE ROW ANSWERS "WHICH PLANNER PLANNED THIS, AND WHICH ENGINE OWNED
          // IT?". Before this, both questions required reading capped diagnostic
          // blobs and inferring from which log lines appeared. `declined` records
          // the adapters and engines that were eligible and deliberately did not
          // run, so a suppressed path is a stated fact rather than an absence.
          lead_ownership: leadOwnership.snapshot(),
          run_context: runContext,
          // The Workbench reads its panel from here; the run context travels with
          // it so the CSV export can populate every diagnostic column.
          // The SAME object that was persisted above — one payload, not two.
          ui_panel: uiPanel,
          requested_leads: cf.quota.requested_leads, eligible_leads: cf.quota.eligible_leads,
          remaining_leads: cf.quota.remaining_leads, requested_count_source: cf.quota.requested_count_source,
          rounds_attempted: cf.rounds_attempted, expansions_attempted: cf.expansions_attempted,
          raw_jobs_processed: cf.counts.rawJobs, verified_companies: cf.counts.verifiedCompanies,
          people_candidates: cf.counts.candidates, provider_calls: cf.provider_calls,
          provider_side_writes: cf.writeBoundary.providerSideWrites, budget_consumed: cf.budget_consumed,
          counts: cf.counts, job_search: cf.routing.job_search_spec, write_boundary: cf.writeBoundary,
          plan_sources: cf.plan_sources, planner_metadata: cf.planner_metadata,
          bottlenecks: cf.bottlenecks, idempotency: cf.idempotency, continuation: cf.continuation,
          // SEMANTIC CLASSIFICATION AUDIT. Counts, reasons, provider and model
          // only — never a prompt, a credential or a claim. Present even when the
          // feature is off, so "no classification" is a recorded fact rather than
          // an absent key the reader has to interpret.
          // COMPANY-FIRST ROUTE EXECUTION — the real funnel, stage by stage,
          // with the diagnostics that prove which Actor ran in what order.
          company_first_route: companyFirstRoute
            ? {
              executed_source_order: companyFirstRoute.executed_source_order,
              funnel: companyFirstRoute.funnel,
              // PERSISTED outcomes, distinct from the in-memory funnel: the
              // Workbench and quota read these, not diagnostics alone.
              persisted_records: companyFirstPersisted,
              projection: companyFirstProjection,
              quota_credit: companyFirstQuotaCredit,
              // The controller's actual inputs, persisted for audit.
              quota_progress: companyFirstQuotaProgress,
              adaptive_action: companyFirstAdaptive,
              // The decision and what execution actually did, side by side, so a
              // disagreement is visible rather than inferred.
              enforcement: {
                decision: companyFirstAdaptive?.action ?? null,
                reason: companyFirstAdaptive?.reason ?? null,
                legacy_sourcing_ran: legacySourcingRan,
                legacy_skip_reason: legacySkipReason,
                blocked_provider_calls: legacyBlockedCalls,
              },
              combined_quota: combinedQuota,
              ...companyFirstRoute.diagnostics,
            }
            : null,
          // FUNNEL, stage by stage. Qualified companies stay visible while
          // founder enrichment is still pending — hiding them is how a run that
          // did real work reports as a failure.
          stage_funnel: cf.stage_funnel ?? null,
          // VALIDATED ROUTE, persisted whole: requested vs validated vs executed
          // are three different facts and are never merged into one field.
          hiring_route: routeRecord
            ? { ...routeRecord, drift: routeDrift(routeRecord) }
            : { error: routeResolution.ok ? null : routeResolution.errors },
          semantic_classification: {
            provider: "lead_strategist_facade",
            escalation_used: false,
            ...classificationTaskDiagnostics(classificationBinding, cf.semantic_classification),
          },
        });
      }

      // ══ THE MISSION ARCHITECTURE IS THE ONLY SOURCING ARCHITECTURE ═══════
      //
      // A 1,893-line legacy sourcing block stood here. It contained the Claude
      // source planner (`actorInputPlanner.planActorInput`), `runAdaptiveSourcing`
      // and its broadening ladder, the Aria/Brain-ICP qualification stack, and
      // the `lead_type='company'` persistence that wrote straight to
      // `lead_candidates` for the frontend to read. It was deleted in the
      // Mission cutover; every capability it provided now belongs to the
      // capability engine above.
      //
      // WHY IT IS NOT KEPT AS A FALLBACK. On TEST run
      // 16952bd6-7d9d-4ce6-a09f-439a48568623 a valid GPT-compiled Mission
      // reached this block and was silently downgraded: `geography_is_hard`
      // was relaxed, the Mission's `verticals: ["AI startups"]` never reached
      // the provider payload, and eight matching companies were scored 28/100
      // against the workspace's generic sales ICP instead of the Mission. The
      // run still spent Apify credits and still looked like a success in the
      // Workbench. A second architecture that can lose the first one's meaning
      // is not a safety net; it is the failure mode.
      //
      // So a sourcing request the capability engine did not accept STOPS here.
      // It does not fall through to the generic LLM path below either — that
      // is what fabricated leads before there was a provider contract at all.
      if (shouldRun) {
        // ── A CONTINUATION MAY NEVER DESTROY THE SLICE BEFORE IT ─────────────
        //
        // This overwrites `result` wholesale. On a FIRST run that is correct —
        // there is nothing to lose. On a CONTINUATION the row already holds a
        // completed slice, and task 9425b3fc is what that costs: three
        // qualified companies, the funnel, the workbench rows and the
        // checkpoint were all replaced by a `blocked: true` stub, and the task
        // went to `failed`. The work was real and the row stopped saying so.
        //
        // A continuation that cannot claim the mission path has established
        // nothing. It releases what it took and leaves the checkpoint exactly
        // as it found it, so the run stays resumable rather than being
        // destroyed by its own successor.
        if (resume_task_id) {
          console.error(
            "[run-agent][continuation-not-accepted] prior slice preserved",
            { task_id: task.id, resume_task_id },
          );
          if (heldClaim?.viaRpc) {
            await releaseContinuationViaRpc({
              db: supabase as unknown as RpcDb,
              taskId: task.id, workspaceId: workspace_id,
              claimId: heldClaim.claimId, rowStatus: RESUMABLE_ROW_STATUS,
            });
          }
          // Same reason as the restore-empty refusal: nothing was established,
          // so nothing may be written.
          terminalGuard.disarm("continuation_not_accepted");
          return json({
            success: false,
            error: "continuation_not_accepted",
            reason: "sourcing_requires_mission_architecture",
            message:
              "The continuation could not claim the mission architecture; the " +
              "previous slice's results and checkpoint are unchanged.",
            task_id: task.id,
          }, 422);
        }
        console.error("[run-agent][sourcing-not-accepted] no mission-driven execution claimed this request", {
          task_id: task.id,
          plan_id,
          has_entity_intent: !!routingEntityIntent,
          company_first: routingEntityIntent ? isCompanyFirstRequest(routingEntityIntent) : null,
          routing_conflict: !!routingConflict,
        });
        await supabase.from("tasks").update({
          status: "failed",
          error_message: "sourcing_requires_mission_architecture",
          result: {
            blocked: true,
            reason: "sourcing_requires_mission_architecture",
            message:
              "Lead sourcing runs only through the Mission architecture " +
              "(mission → playbook selection → capability graph → authorization → " +
              "paid preflight → capability engine). This request produced no " +
              "mission-driven execution plan, and there is no legacy sourcing " +
              "path to fall back to. No provider was called.",
            has_entity_intent: !!routingEntityIntent,
            company_first: routingEntityIntent ? isCompanyFirstRequest(routingEntityIntent) : null,
            routing_conflict: routingConflict ?? null,
          },
        }).eq("id", task.id);
        return json({
          success: false,
          task_id: task.id,
          blocked: true,
          error: "sourcing_requires_mission_architecture",
          terminal_status: "blocked",
          terminal_reason: "sourcing_requires_mission_architecture",
          providers_called: 0,
          message: "Refused: lead sourcing requires the Mission architecture. Nothing was spent.",
        }, 422);
      }
    }


    // 3) Optional broad research — only attempt if Perplexity is actually configured AND
    //    we're not in fast mode (fast mode skips this entirely to keep cost low).
    // Perplexity (research_web) is OPTIONAL and never required. Skip it entirely
    // for fast mode, explicit Apify steps, and ALL competitor-discovery steps —
    // competitor inference is done by Gemini (this step's own output), parsed
    // downstream. This removes the hard Perplexity dependency.
    // Broad research (Perplexity) is optional and never a lead source. Skip it for
    // fast/source_and_qualify_only modes, explicit Apify steps, discovery, and —
    // the v83 Q1 fix — whenever a provider-sourcing step ran (even if every
    // candidate was staged, so apifyContext is null). See broadResearchPolicy.ts.
    const skipBroadResearch = shouldSkipBroadResearch({
      executionMode: execution_mode_body ?? null,
      plannedToolName: (tool_input_body?.tool_name as string | undefined) ?? null,
      competitorDiscovery: tool_input_body?.competitor_discovery === true,
      discoveryMode: tool_input_body?.discovery_mode,
      isProviderSourcingStep,
      hasProviderContext: !!apifyContext,
      hasScrapedContext: !!scrapedContext,
    });
    if (!apifyContext && !scrapedContext && !skipBroadResearch) {
      const toolRes = await runTool("research_web", { query: instruction }, baseCtx);
      if (toolRes.ok && toolRes.data) {
        const d = toolRes.data as { content?: string; citations?: string[] };
        const citations = (d.citations ?? []).slice(0, 8).map((c, i) => `[${i + 1}] ${c}`).join("\n");
        toolContext = `BROAD RESEARCH:\n${d.content ?? ""}\n\nCITATIONS:\n${citations}`;
      } else if (toolRes.unavailable) {
        toolNotices.push(
          "Broad web research is not configured for this workspace. Use Apify for hiring signals or Firecrawl for specific URLs.",
        );
      } else if (!toolRes.ok) {
        toolNotices.push(`Research tool failed: ${toolRes.error ?? "unknown"}.`);
      }
    }
  }


  // GLOBAL fail-closed gate for Find Leads provider *identity* sourcing. If this is
  // a provider-sourcing step (source_with_apify / apify actor) but no provider-backed
  // context was produced — and no hard failure / zero-accepted terminal was already
  // recorded — then the required provider source did not run/yield. The generic LLM
  // below MUST NEVER become a lead source (that fabricated 10 founders live). Force
  // the honest no_results terminal (reused just below) with a structured reason.
  if (isProviderSourcingStep && !apifyContext && !zeroAcceptedSourcing) {
    providerSourceReason = classifyProviderSourceOutcome({
      unavailable: true, // reached with no provider context and no recorded failure
      rawItemCount: 0,
      acceptedItemCount: 0,
      providerBackedCandidateCount: 0,
    });
    zeroAcceptedSourcing = true;
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "provenance_handoff_guard",
      title: "Provider sourcing unavailable — failing closed",
      body: "The required provider lead source did not run or returned nothing; the generic model is not allowed to invent leads.",
      metadata: { step_index, task_id: task.id, reason: providerSourceReason, fail_closed: true },
    });
  }

  // Hard sourcing failure (Apify auth/config/credits) with no results → fail the
  // plan cleanly and surface an in-chat error card. Never let the LLM fabricate a
  // "complete" plan with zero leads, and never chain to Aria with nothing to rank.

  // Sourcing actor RAN but accepted 0 qualified leads (no tool failure). There is
  // nothing to rank, so SKIP Aria (and any downstream step): do not chain, do not
  // call the LLM, do not persist fake rows, do not emit a post-lead actions card.
  // Finalize the plan honestly as no_qualified_matches.
  if (zeroAcceptedSourcing && !apifyContext) {
    const { data: planRow } = await supabase.from("task_plans").select("steps").eq("id", plan_id).maybeSingle();
    const planSteps: any[] = Array.isArray(planRow?.steps) ? (planRow!.steps as any[]) : [];
    const nextStepSlug: string | null = planSteps[(step_index as number) + 1]?.agent_slug ?? null;
    const ariaFollows = planSteps.some((s, i) => i > (step_index as number) && s?.agent_slug === "aria");

    // Decision-maker (contact-discovery) runs get SPECIFIC honest copy — never the
    // generic "0 matching leads". Per-agent messages (Scout/Aria/Pilot) per main.
    const attachAccts = Array.isArray(tool_input_body?.attach_to_accounts) ? tool_input_body.attach_to_accounts : null;
    const isContactDiscovery = !!(attachAccts && attachAccts.length > 0);
    const acctN = attachAccts?.length ?? 0;
    // Specific reject reasons (e.g. "wrong title, weak company match, wrong location")
    // instead of a generic "0 matching leads".
    // The legacy sourcing block used to publish per-run reject statistics here.
    // The capability engine reports its own funnel on the mission path and
    // returns before reaching this copy, so there is nothing left to summarise.
    const scoutMsg = providerSourceReason
      ? `The lead source needed for this search isn't available right now, so I did not run it. I will never invent founders or companies, so no leads were saved, no credits charged, and nothing was sent.`
      : isContactDiscovery
      ? `I searched for decision-makers at ${acctN} account${acctN === 1 ? "" : "s"} but no verified contacts matched the account names closely enough. No contacts were attached.`
      : `I reviewed ${sourcingAttemptsCount} attempt(s) and accepted 0 qualified leads. None of the raw results matched closely enough.`;
    const ariaSkipMsg = "Skipped — there were no accepted leads to rank.";
    const pilotRecMsg = isContactDiscovery
      ? "Try a broader persona, draft an account-level template, or export the accounts. No contacts attached, no credits charged, nothing sent."
      : "Try broadening the role, industry, or location — or pick another lead source. No leads were saved, no credits charged, nothing sent.";

    // Canonical no_results terminal (Section 4). Uses the existing `complete`
    // status enum and records result_status + counts in the result JSON (no
    // migration). Aria/Penn are not invoked; nothing persists.
    const noResults = buildNoResults(provenanceRejections.count);
    await supabase.from("tasks").update({
      status: "complete",
      result: {
        output: scoutMsg,
        no_qualified_matches: true,
        result_status: routingConflict ? "routing_conflict" : "no_results",
        qualified_count: 0,
        contact_ready_count: 0,
        persisted_lead_count: 0,
        rejected_provenance_count: noResults.rejected_provenance_count,
        rejected_provenance_reasons: provenanceRejections.reasons,
        next_step: null,
        provider_calls: providerSourceReason ? 0 : undefined,
        reason: providerSourceReason ?? undefined,
        lead_entity_intent: routingEntityIntent ?? undefined,
        routing: routingActorPlan ? { target_entity: routingActorPlan.target_entity, output_type: routingEntityIntent?.output_type, primary_actor: routingActorPlan.primary_identity_actor, routing_source: routingActorPlan.routing_source, execution_mode: routingActorPlan.execution_mode, company_first: routingActorPlan.company_first, company_gate_required: routingEntityIntent?.company_gate_required } : undefined,
        routing_conflict: routingConflict ?? undefined,
        company_enrichment_observability: companyEnrichmentObservability,
        signal_enrichment_observability: signalEnrichmentObservability,
      },
    }).eq("id", task.id);
    await supabase.from("task_plans").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", plan_id);

    if (ariaFollows && nextStepSlug === "aria") {
      await supabase.from("activity_feed").insert({
        workspace_id, plan_id, agent_id: agent.id, event_type: "handoff",
        title: "Aria skipped — no accepted leads to rank",
        body: "Scout accepted 0 qualified leads, so ranking was skipped.",
        metadata: { step_index, task_id: task.id, skipped_agent: "aria", reason: "no_accepted_leads" },
      });
    }
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "plan_complete",
      title: "Plan failed — no qualified matches",
      body: scoutMsg,
      metadata: { step_index, task_id: task.id, workflow_status: "no_qualified_matches" },
    });
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started",
      title: "Pilot suggested broadening the search",
      body: "Broaden the role/industry/location, edit criteria, or change the source.",
      metadata: { step_index, task_id: task.id, suggestion: "broaden_search" },
    });

    try {
      const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
      const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (conversationId) {
        const failActions = isContactDiscovery
          ? ["broaden_search", "export_csv", "done"]
          : ["broaden_search", "edit_criteria", "change_source", "view_details", "done"];
        // Scout: honest sourcing result
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: scoutMsg, agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: "no_qualified_matches" },
        });
        // Aria: skipped (only when ranking was actually in the plan)
        if (ariaFollows) {
          await supabase.from("messages").insert({
            conversation_id: conversationId, role: "assistant",
            content: ariaSkipMsg, agent_slug: "aria",
            metadata: { plan_id, agent_id: "aria", workflow_step: "rank", status: "skipped", reason: "no_accepted_leads" },
          });
        }
        // Pilot: coordinator recommendation + UI card actions
        const card = {
          kind: "lead_sourcing_error",
          title: isContactDiscovery ? "No decision-makers found" : "No qualified matches found",
          message: pilotRecMsg,
          error: isContactDiscovery ? "no_decision_makers" : "no_qualified_matches",
          retry_command: instruction,
          next_actions: failActions,
          source_brief: instruction,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: pilotRecMsg, agent_slug: "pilot",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "pilot", workflow_status: "no_qualified_matches", aria_skipped: ariaFollows, next_actions: failActions, source_brief: instruction },
        });
      }
    } catch (e) { console.warn("[run-agent] no-qualified-matches card failed:", e); }
    return json({ success: false, task_id: task.id, status: "no_qualified_matches", aria_skipped: ariaFollows });
  }

  const contextParts: string[] = [];
  if (scrapedContext) contextParts.push(scrapedContext);
  if (apifyContext) contextParts.push(apifyContext);
  if (toolContext) contextParts.push(toolContext);
  const toolNotice = toolNotices.length > 0 ? toolNotices.join(" ") : null;

  const userMessage = contextParts.length > 0
    ? `${buildUserMessage(instruction, input)}\n\n${contextParts.join("\n\n")}${toolNotice ? `\n\nNOTE TO AGENT: ${toolNotice} Do NOT fabricate data beyond what is provided.` : ""}`
    : toolNotice
      ? `${buildUserMessage(instruction, input)}\n\nNOTE TO AGENT: ${toolNotice} Do NOT fabricate live data. Acknowledge the limitation, then produce the best plan/analysis you can from available context.`
      : buildUserMessage(instruction, input);

  // Writing agents (Scribe content/comments, Penn outreach/DM copy) prefer
  // Claude/Anthropic for higher-quality writing when ANTHROPIC_API_KEY is set.
  // aiProvider falls back to Gemini/Lovable automatically when the key is absent
  // — planner/controller agents (pilot/scout/hawk/aria) stay on Gemini.
  const preferredProvider = preferredProviderForAgent(agent_slug);
  if (preferredProvider === "anthropic" && !Deno.env.get("ANTHROPIC_API_KEY")) {
    console.log("[run-agent] anthropic preferred for", agent_slug, "but ANTHROPIC_API_KEY missing — falling back to default provider");
  }

  const ai = await generateText({
    taskType: "agent_execution",
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.6,
    maxTokens: 2048,
    preferredProvider,
    functionName: "run-agent",
    agentSlug: agent_slug ?? undefined,
    workspaceId: workspace_id,
  });

  await logProviderCall(supabase, {
    workspace_id,
    plan_id,
    agent_id: agent.id,
    function_name: "run-agent",
    agent_slug: agent_slug ?? null,
    task_type: "agent_execution",
    provider: ai.provider,
    model: ai.model,
    success: ai.ok,
    latency_ms: ai.latencyMs,
    error_code: ai.errorCode,
    prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
  });

  let apiText = ai.ok ? ai.content : "";
  const usage = (ai.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  const tokensIn = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? usage.output_tokens ?? 0;
  let apiError: string | null = null;
  if (!ai.ok) apiError = ai.error ?? "ai provider failed";
  else if (!apiText) apiError = "empty content from AI provider";


  if (apiError) {
    console.error("[run-agent] api failure:", apiError);
    await supabase.from("tasks").update({
      status: "failed",
      error_message: apiError,
      result: { error: apiError },
    }).eq("id", task.id);
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "agent_started",
      title: `${agent.name} failed`,
      body: apiError,
      metadata: { step_index, task_id: task.id, failed: true },
    });
    await supabase.from("task_plans").update({ status: "failed" }).eq("id", plan_id);
    return json({ error: "step_failed", details: apiError, task_id: task.id }, 500);
  }

  const finalStatus = needs_approval ? "awaiting_approval" : "complete";
  await supabase.from("tasks").update({
    status: finalStatus,
    result: { output: apiText, tokens_in: tokensIn, tokens_out: tokensOut, lead_entity_intent: routingEntityIntent ?? undefined, routing: routingActorPlan ? { target_entity: routingActorPlan.target_entity, output_type: routingEntityIntent?.output_type, primary_actor: routingActorPlan.primary_identity_actor, routing_source: routingActorPlan.routing_source, execution_mode: routingActorPlan.execution_mode, company_first: routingActorPlan.company_first, company_gate_required: routingEntityIntent?.company_gate_required } : undefined, company_enrichment_observability: companyEnrichmentObservability, signal_enrichment_observability: signalEnrichmentObservability },
  }).eq("id", task.id);

  // Phase 2: persist agent outputs into structured GTM memory. Fire-and-forget.
  if (agent_slug === "aria" || agent_slug === "penn" || agent_slug === "scribe") {
    try {
      const { writeMemoryFromAgentResult } = await import("../_shared/memoryWriter.ts");
      await writeMemoryFromAgentResult({
        admin: supabase,
        workspace_id,
        plan_id,
        task_id: task.id,
        agent_slug,
        execution_mode: execution_mode_body,
        output_text: apiText,
        // Memory-driven draft_outreach carries the target lead ids so Penn
        // drafts link to the remembered leads (which live in a prior plan).
        lead_candidate_ids: Array.isArray(tool_input_body?.lead_candidate_ids)
          ? tool_input_body.lead_candidate_ids
          : undefined,
        // Phase 7 — content-loop metadata so Scribe drafts are tagged with
        // subtype/topic/audience/angle/engagement_queries in saved_outputs.raw.
        content_loop: (tool_input_body?.content_loop && typeof tool_input_body.content_loop === "object")
          ? tool_input_body.content_loop
          : undefined,
      });
    } catch (e) {
      console.warn("[run-agent] memoryWriter failed:", e);
    }
  }

  // Load plan steps to find next.
  const { data: plan } = await supabase
    .from("task_plans")
    .select("steps, plan_summary")
    .eq("id", plan_id)
    .maybeSingle();
  const steps: any[] = Array.isArray(plan?.steps) ? (plan!.steps as any[]) : [];
  let nextStep = steps[(step_index as number) + 1] ?? null;

  // Safety (defense-in-depth): in source_and_qualify_only never hand off to a
  // forbidden step (Penn / draft_outreach / send / publish). orchestrate already
  // strips these from the plan; this guarantees it even if a stale plan carries
  // one, so no outreach can be generated in this mode.
  if (nextStep && !stepAllowedInMode({ agent_slug: nextStep.agent_slug, tool_needed: nextStep.tool_needed }, execution_mode_body)) {
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id,
      event_type: "mode_blocked_step",
      title: "Outreach step blocked (source_and_qualify_only)",
      body: `Skipped ${nextStep.agent_slug}/${nextStep.tool_needed}: outreach drafting is forbidden in source_and_qualify_only.`,
      metadata: { step_index, blocked_agent: nextStep.agent_slug, blocked_tool: nextStep.tool_needed },
    });
    nextStep = null;
  }

  // Provenance hand-off guard: Scout → Aria. Only provider-backed candidates may
  // reach Aria. Fabricated identities (absent from the accepted provider index)
  // are dropped; if NONE survive, Aria is not invoked with fallback/invented
  // candidates — the chain stops (no Aria → no downstream Penn → no drafts).
  let handoffInput: string | null = apiText ?? null;
  // Global gate: for EVERY Find Leads sourcing Scout→Aria hand-off (not only when an
  // Apify index was built), gate candidates against the provider index. A null/empty
  // index ⇒ guardScoutToAria stops, so raw Scout prose can never reach Aria.
  if (nextStep && agent_slug === "scout" && nextStep.agent_slug === "aria" && (providerIndexForHandoff || isProviderSourcingStep)) {
    try {
      const guard = guardScoutToAria(parseScoutCandidates(apiText, null), providerIndexForHandoff);
      await supabase.from("activity_feed").insert({
        workspace_id, plan_id, agent_id: agent.id,
        event_type: "provenance_handoff_guard",
        title: "Scout→Aria provenance guard",
        body: guard.summary,
        metadata: { step_index, verified: guard.verified.length, rejected: guard.rejected.length, stop: guard.shouldStop },
      });
      // Section 10 — Scout↔Aria pool alignment. For a PERSON target, feed Aria the
      // ACCEPTED provider PersonCandidates directly (all of them), never the subset
      // the LLM narrative happened to re-list. The narrative may annotate but can
      // neither invent a parallel identity pool nor shrink the sourced pool.
      if (guard.shouldStop) {
        zeroAcceptedSourcing = true;
        nextStep = null; // never invoke Aria with unsupported/invented candidates
      } else {
        // Aria receives ONLY the provider-backed candidates, never Scout's prose.
        handoffInput = JSON.stringify({ candidates: guard.verified });
      }
    } catch (e) { console.warn("[run-agent] provenance handoff guard failed:", e); }
  }

  if (needs_approval) {
    await supabase.from("approvals").insert({
      workspace_id,
      plan_id,
      task_id: task.id,
      agent_id: agent.id,
      title: `${agent.name} needs approval`,
      description: instruction,
      status: "pending",
    });
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "awaiting_approval",
      title: `${agent.name} awaiting approval`,
      body: `${agent.name}'s output needs your review before continuing.`,
      metadata: { step_index, task_id: task.id },
    });
    await supabase.from("task_plans").update({ status: "awaiting_approval" }).eq("id", plan_id);
    return json({ success: true, task_id: task.id, status: "awaiting_approval" });
  }

  // Phase 4.2 — inference→search threading. When Hawk (competitor discovery)
  // hands off to Scout's LinkedIn search, parse Hawk's inferred competitors from
  // its output and inject them into Scout's tool_input (queries + discovery
  // context for memory tagging). Inferred competitors are hypotheses, not facts.
  let nextToolInput: any = nextStep?.metadata?.tool_input ?? tool_input_body ?? null;
  if (
    nextStep && agent_slug === "hawk" && nextStep.agent_slug === "scout" &&
    (nextToolInput?.source_type === "linkedin_engagement") &&
    (nextToolInput?.competitor_discovery || tool_input_body?.competitor_discovery || tool_input_body?.discovery_mode)
  ) {
    try {
      const { parseInferredCompetitors, buildCompetitorSearchQueries } = await import("../_shared/competitorDiscovery.ts");
      const inferred = parseInferredCompetitors(apiText ?? "");
      // Source order: known competitors (user-provided / company-brain, carried on
      // tool_input.competitors) take precedence, then Gemini-inferred hypotheses.
      const knownNames: string[] = Array.isArray(tool_input_body?.competitors)
        ? tool_input_body.competitors
        : (Array.isArray((nextToolInput as any)?.competitors) ? (nextToolInput as any).competitors : []);
      const knownHyps = knownNames.filter(Boolean).map((n: string) => ({
        name: n, category: "other", reason: "known competitor (brain/user-provided)",
        confidence: 0.9, source: "seed" as const, keywords: [],
      }));
      const allHyps = [...knownHyps, ...inferred.competitors];
      // buildCompetitorSearchQueries sanitizes the topic, so a raw business
      // description can never become a LinkedIn query; empty → category fallback.
      const queries = buildCompetitorSearchQueries(allHyps, nextToolInput?.query ?? instruction);
      if (queries.length > 0) {
        nextToolInput = {
          ...nextToolInput,
          query: queries.join(", "),
          competitor_discovery: true,
          user_input: {
            ...(nextToolInput?.user_input ?? {}),
            keywords: queries,
            competitor_discovery: true,
            inferred_competitors: inferred.competitors.map((c: any) => c.name).filter(Boolean),
            competitor_category: inferred.category,
            matched_query: queries.join(", "),
            original_business_description: tool_input_body?.business_description ?? nextToolInput?.business_description ?? null,
            original_website_url: tool_input_body?.business_website ?? nextToolInput?.business_website ?? null,
            hypothesis_reason: inferred.competitors[0]?.reason ?? "inferred from business context",
          },
        };
      }
    } catch (e) {
      console.warn("[run-agent] inferred-competitor threading failed:", e);
    }
  }

  if (nextStep) {
    await supabase.from("handoffs").insert({
      workspace_id,
      plan_id,
      task_id: task.id,
      from_agent_slug: agent_slug ?? null,
      to_agent_slug: nextStep.agent_slug ?? null,
      payload: { instruction: nextStep.instruction, input: handoffInput },
    });
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "handoff",
      title: `${agent.name} finished`,
      body: `${agent.name} finished. Handing to ${nextStep.agent_name ?? nextStep.agent_slug}.`,
      metadata: { step_index, task_id: task.id, next_agent_slug: nextStep.agent_slug },
    });

    // THE SAME BACKGROUND HANDOFF AS orchestrate'S KICKOFF, AND THE SAME BUG.
    //
    // This is the second half of the stall: even once a run starts, an
    // unregistered floating fetch could be dropped when this isolate returns,
    // leaving the plan parked one step further along with a completed step 0
    // and nothing driving step 1. Identical symptom, later checkpoint.
    invokeInBackground({
      url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`,
      token: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      log: (m, meta) => console.error("[run-agent][chain]", m, meta),
      body: {
        plan_id,
        step_index: (step_index as number) + 1,
        agent_slug: nextStep.agent_slug,
        workspace_id,
        // Carry the RESOLVED user into the chained step so attribution can't be
        // laundered through a hand-crafted first step.
        user_id: taskUserId,
        instruction: nextStep.instruction,
        input: handoffInput,
        needs_approval: nextStep.needs_approval === true,
        // Per-step tool_input (set on the step's metadata) wins, so a plan can
        // mix tools across steps (e.g. Hawk scrape → Scout apify). Steps without
        // their own metadata inherit the current step's tool_input as before.
        // For competitor discovery, nextToolInput carries Hawk's inferred queries.
        tool_input: nextToolInput,
        execution_mode: execution_mode_body,
      },
      // Step 0's work is already persisted and is NOT discarded — only the plan
      // is marked, so the completed step's findings stay readable and the run
      // stays resumable rather than looking like it never happened.
      onFailure: async (failure) => {
        const reason = describeFailure(failure);
        await supabase.from("task_plans")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", plan_id);
        await supabase.from("activity_feed").insert({
          workspace_id,
          plan_id,
          agent_id: agent.id,
          event_type: "plan_failed",
          title: "Next step could not be started",
          body: reason,
          metadata: {
            stage: "run_agent_chain",
            from_step_index: step_index,
            next_step_index: (step_index as number) + 1,
            failure,
          },
        });
      },
    });

    return json({
      success: true,
      task_id: task.id,
      status: "complete",
      next_agent: nextStep.agent_name ?? nextStep.agent_slug,
    });
  }

  // Final step. Adaptive status — never blindly "complete". For a sourcing plan, derive
  // complete / partial / failed from produced-vs-requested; emit the right card.
  let planStatus = "complete";
  try {
    const { data: srcCalls } = await supabase.from("tool_calls").select("id").eq("plan_id", plan_id).eq("tool_name", "source_with_apify").limit(1);
    const wasSourcing = (srcCalls ?? []).length > 0;

    const { data: leads } = await supabase.from("lead_candidates").select("id, contact_id, account:accounts(name, domain, linkedin_url), contact:contacts(full_name, title, linkedin_url, email)").eq("plan_id", plan_id);
    const leadRows = (leads ?? []) as Array<{ id: string; contact_id?: string | null; account?: { name?: string | null; domain?: string | null; linkedin_url?: string | null } | null; contact?: { full_name?: string | null; title?: string | null; linkedin_url?: string | null; email?: string | null } | null }>;
    const { count: sigCount } = await supabase.from("signals").select("id", { count: "exact", head: true }).eq("plan_id", plan_id);
    const produced = Math.max(leadRows.length, sigCount ?? 0);

    const steps: any[] = Array.isArray(plan?.steps) ? (plan!.steps as any[]) : [];
    const reqStep = steps.find((s) => typeof s?.metadata?.tool_input?.max_results === "number");
    const requested = reqStep?.metadata?.tool_input?.max_results ?? produced;

    const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
    const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;

    // Pull the adaptive attempt log recorded by the Scout step (separate invocation).
    const { data: scoutTask } = await supabase.from("tasks").select("result").eq("plan_id", plan_id).eq("agent_slug", "scout").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const scoutResult = (scoutTask as { result?: Record<string, unknown> } | null)?.result ?? {};
    const attemptLog = (scoutResult.attempt_log as unknown) ?? [];
    const attemptSummary = Array.isArray(attemptLog)
      ? (attemptLog as Array<Record<string, unknown>>).map((a) => `Attempt ${a.n}: ${a.strategy} — ${a.accepted_count} accepted (total ${a.total_accepted})`)
      : [];
    // AI Source Planner artifacts (Phase 8 Workbench Insights).
    const sourcePlan = (scoutResult.source_plan as Record<string, unknown> | undefined) ?? null;
    const sourceQuality = (scoutResult.source_quality as Record<string, unknown> | undefined) ?? null;
    const searchInsights = (sourcePlan || sourceQuality) ? {
      source: sourcePlan?.actor_key ?? null,
      planner: sourcePlan?.source ?? null, // ai | ai_repaired | deterministic
      primary_query: sourcePlan?.primary_query ?? null,
      role_aliases: sourcePlan?.role_aliases ?? [],
      attempts: attemptSummary,
      raw_reviewed: sourceQuality?.raw_result_count ?? null,
      accepted: sourceQuality?.accepted_count ?? null,
      rejected: sourceQuality?.rejected_count ?? null,
      duplicates: sourceQuality?.duplicate_count ?? null,
      main_reject_reasons: sourceQuality?.top_reject_reasons ?? [],
    } : null;

    if (wasSourcing) {
      const { evaluateWorkflowStatus } = await import("../_shared/adaptiveWorkflow.ts");
      const ev = evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested, produced });
      planStatus = ev.status; // complete | partial | failed

      if (produced === 0 && conversationId) {
        // Actor ran but found nothing — honest "no results", never "complete".
        // Scout speaks the operational result, then Pilot wraps with the recommendation card.
        const failBrief = (reqStep?.instruction as string) ?? undefined;
        const failActions = ["broaden_search", "edit_criteria", "change_source", "view_details", "done"];
        const reviewedCount = sourceQuality?.raw_result_count ?? "the";
        const scoutLine = `I reviewed ${reviewedCount} raw result${sourceQuality?.raw_result_count === 1 ? "" : "s"}, but none matched closely enough. I didn't save any leads.`;
        const pilotLine = "Try broadening your criteria or changing the source. No credits charged, nothing sent.";
        const card = {
          kind: "lead_sourcing_error",
          title: "No qualified matches",
          message: `${scoutLine} ${pilotLine}`,
          error: "no_qualified_matches",
          retry_command: failBrief,
          next_actions: failActions,
          source_brief: failBrief,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: scoutLine,
          agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: "no_qualified_matches" },
        });
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: pilotLine,
          agent_slug: "pilot",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "pilot", workflow_status: "failed", next_actions: failActions, source_brief: failBrief },
        });
      } else if (leadRows.length > 0 && conversationId) {
        const lo = await import("../_shared/leadOpportunity.ts");
        const planSummary = String(plan?.plan_summary ?? "").toLowerCase();
        const sourceType: string = planSummary.includes("hiring") ? "hiring_signal"
          : planSummary.includes("linkedin") ? "linkedin_engagement"
          : planSummary.includes("people") || planSummary.includes("profile") ? "people_profiles"
          : planSummary.includes("competitor") ? "competitor_engagement"
          : "company_search";
        // Account vs contact split — contact-ready only with real person data.
        const contactRows = leadRows.filter((l) => !!l.contact_id && lo.canDraftOutreach({ name: l.contact?.full_name, linkedin_url: l.contact?.linkedin_url, email: l.contact?.email }));
        const contacts = contactRows.length;
        const accounts = leadRows.length;
        const canDraft = contacts > 0;
        const allAccountOnly = contacts === 0;
        // Domain discovery before enrichment (fixes "0 websites").
        const domainGuesses = leadRows.map((l) => lo.guessDomain({ website: null, linkedin_url: l.account?.linkedin_url, source_url: null, company: l.account?.name }));
        const realDomains = leadRows.filter((l) => !!l.account?.domain).length;
        const enrichable = Math.max(realDomains, domainGuesses.filter((g) => g.confidence !== "unavailable").length);
        const persona = lo.inferContactPersona((reqStep?.instruction as string) ?? planSummary);
        const nextAction = lo.recommendNextAction({ accounts, contacts, enriched_contacts: 0, requested });
        const recommended_next_action = { action: nextAction.action, label: nextAction.label, reason: nextAction.reason, estimated_credits: allAccountOnly ? leadRows.length : (canDraft ? contacts * 2 : enrichable) };
        const header = lo.buildLeadResultsHeader({ accounts, contacts });
        const { buildPostLeadActionsCard } = await import("../_shared/creditEstimate.ts");
        const card = buildPostLeadActionsCard(leadRows.length, enrichable, leadRows.map((l) => l.id));
        const partial = planStatus === "partial";
        const actions = canDraft
          ? ["enrich", "draft_outreach", "enrich_and_draft", "rank", "export_csv", "save_to_signal_feed"]
          : ["find_contacts", "research_company", "rank", "export_csv", "save_to_signal_feed"];
        // AI-employee outcome report (humanized result + next-action pills).
        const { buildOutcomeReport } = await import("../_shared/sourceQuality.ts");
        const sourceBrief = (reqStep?.instruction as string) ?? planSummary;
        const qCounts = (sourceQuality && typeof sourceQuality === "object")
          ? sourceQuality as unknown as { raw_result_count: number; accepted_count: number; rejected_count: number; duplicate_count: number; persisted_count: number; requested_count: number; reject_reason_counts: Record<string, number>; status: "complete" | "partial" | "failed" }
          : { raw_result_count: produced, accepted_count: produced, rejected_count: 0, duplicate_count: 0, persisted_count: produced, requested_count: requested, reject_reason_counts: {}, status: planStatus as "complete" | "partial" | "failed" };
        const outcome = buildOutcomeReport({ counts: qCounts, requested, has_contacts: canDraft, source_type: sourceType });
        const uiPanel = {
          kind: "lead_results" as const,
          view: "spreadsheet" as const,
          title: header,
          subtitle: lo.LEAD_RESULTS_SUBTITLE,
          source_type: sourceType,
          lead_count: leadRows.length,
          account_count: accounts,
          contact_count: contacts,
          enrichable_count: enrichable,
          can_draft: canDraft,
          recommended_persona: persona,
          contact_status: canDraft ? "contact_found" : "needs_contact",
          next_action: nextAction,
          lead_candidate_ids: leadRows.map((l) => l.id),
          plan_id,
          default_view: "table",
          actions,
          locked_columns: ["decision_maker", "contact_info", "company_enrichment", "personalized_message"],
          available_actions: actions,
          recommended_next_action,
          // Phase 8 — Workbench Insights: summarized search strategy (never raw JSON / dataset IDs).
          insights: searchInsights,
          // Humanized outcome + next-action pills.
          outcome: { status: outcome.status, line: outcome.outcome_line, quality_lines: outcome.quality_lines },
          next_actions: outcome.next_actions,
          source_brief: sourceBrief,
        };

        // Phase 7 — split the post-lead summary into per-agent messages so the
        // chat reads like a Slack-style team: Scout reports sourcing, Aria reports
        // ranking (only if it actually ran), and Pilot wraps with the workbench
        // open + recommended next action card.
        const ariaInPlan = Array.isArray(plan?.steps)
          ? (plan!.steps as any[]).some((s) => s?.agent_slug === "aria")
          : false;
        const reviewedSummary = searchInsights?.raw_reviewed != null
          ? `I reviewed ${searchInsights.raw_reviewed} raw result${searchInsights.raw_reviewed === 1 ? "" : "s"} and accepted ${produced} qualified ${allAccountOnly ? "account opportunit" + (produced === 1 ? "y" : "ies") : "lead" + (produced === 1 ? "" : "s")}.`
          : `I accepted ${produced} qualified ${allAccountOnly ? "account opportunit" + (produced === 1 ? "y" : "ies") : "lead" + (produced === 1 ? "" : "s")}.`;
        const partialPrefix = partial ? `Found ${produced} of ${requested}. ` : "";

        // 1. Scout speaks the sourcing outcome
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: `${partialPrefix}${reviewedSummary}`,
          agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: planStatus, attempt_log: attemptSummary.length ? attemptSummary : [`Sourced ${produced}/${requested}`] },
        });

        // 2. Aria speaks ranking (if it was in the plan)
        if (ariaInPlan) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: "I ranked the accepted opportunities against your Company Brain.",
            agent_slug: "aria",
            metadata: { plan_id, agent_id: "aria", workflow_step: "rank", status: "complete" },
          });
        }

        // 3. Pilot wraps with workbench-open + next action card. The ui_panel
        // stays on this Pilot message so the existing auto-open hook still fires.
        const partialTail = partial ? ` Want me to broaden the search to fill the last ${Math.max(1, requested - produced)}?` : "";
        const pilotWrap = allAccountOnly
          ? `I opened the results in Workbench. Contact/enrichment/outreach columns are locked until you run those actions. Recommended next step: find decision-makers.${partialTail} Nothing was sent.`
          : `I opened the results in Workbench. Recommended next step: ${ariaInPlan ? "review the ranked list" : "rank by fit"}, then research or draft outreach.${partialTail} Nothing was sent.`;
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: pilotWrap,
          agent_slug: "pilot",
          metadata: { ui_card: card, ui_panel: uiPanel, post_lead_actions: true, plan_id, agent_id: "pilot", workflow_status: planStatus, can_draft: canDraft, next_action: nextAction.action, next_actions: outcome.next_actions, source_brief: sourceBrief },
        });
      }
    }
  } catch (e) {
    console.warn("[run-agent] adaptive status/card failed:", e);
  }

  await supabase.from("activity_feed").insert({
    workspace_id, plan_id, agent_id: agent.id, event_type: "plan_complete",
    title: planStatus === "complete" ? "Plan complete" : `Plan ${planStatus}`,
    body: `${plan?.plan_summary ?? "Plan"} — ${planStatus}.`,
    metadata: { step_index, task_id: task.id, workflow_status: planStatus },
  });
  await supabase.from("task_plans").update({ status: planStatus, completed_at: new Date().toISOString() }).eq("id", plan_id);

  return json({ success: planStatus !== "failed", task_id: task.id, status: planStatus });

  // ══ END OF THE TERMINAL-GUARDED REGION ══════════════════════════════════════
  }).catch((e) => {
    // The guard has ALREADY written terminal rows by the time this runs — its
    // writer is in `finally` and the rethrow happens after it. So this only
    // decides what the HTTP caller sees; the plan is no longer Running either
    // way.
    console.error("[run-agent][unhandled]", String(e));
    return json({ error: "run_agent_unhandled_exception", message: String(e) }, 500);
  });

  // The fallback exists because the guard's signature admits `undefined`; a run
  // that produced no Response at all is itself a defect worth reporting rather
  // than hiding behind an empty 200.
  return guardedResponse ?? json({ error: "run_agent_no_response" }, 500);
});
