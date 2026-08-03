// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, normalizeApifySourceType } from "../_shared/toolRegistry.ts";
import { writeContactWithVerifiedAccount, type ContactPersistenceDb } from "../_shared/attachContactAccount.ts";
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
import { separateIntent } from "../_shared/leadIntentModel.ts";
import { classifyRoleFamily, type RoleFamily } from "../_shared/roleFamilyMatcher.ts";
import { buildCanonicalStamp } from "../_shared/leadCanonicalStamp.ts";
import { stepAllowedInMode, isSourceAndQualifyOnly } from "../_shared/executionMode.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria, buildProvenanceRecord, assertPersistenceProvenance, type NormalizedProviderIndex, type ProvenanceCtx } from "../_shared/leadHandoffGuard.ts";
import { newRejectionCounter, sealProvenance, buildNoResults, type RejectionCounter } from "../_shared/leadPersistenceGuard.ts";
import { classifyProviderSourceOutcome, type ProviderSourceReason } from "../_shared/leadSourcingGate.ts";
import { resolvePlannedTool, isProviderSourcingTool, resolveProviderSource } from "../_shared/plannedToolResolver.ts";
import { parsePeopleSearchIntent, buildPeopleSearchAttempts, buildSourcingAttemptAudit } from "../_shared/peopleSearchQueryBuilder.ts";
import { extractCandidateLocationEvidence } from "../_shared/locationMatch.ts";
import { compileLeadEntityIntent, compileActorPlan, detectRoutingConflict, artifactTypeForActor, expectedArtifactType, ACTOR_IMPL, type LeadEntityIntent, type ProviderActorPlan, type RoutingConflictResult } from "../_shared/leadEntityIntent.ts";
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
import { applyClaudeFirstLeadPlanning, adaptiveStrategyBinding, bridgeDiagnostics, claudeFirstFromPersistedPlan } from "../_shared/intelligence/leads/leadPlanningBridge.ts";
import { readPlanArtifact } from "../_shared/intelligence/leads/leadPlanAuthority.ts";
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
import {
  legacyLoopReachable, missionRouteRequest, readPersistedLeadMission,
} from "../_shared/leadMissionRuntime.ts";
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
import { SOURCE_EXECUTION_KEY } from "../_shared/sourceExecutionState.ts";
import { FUSION_STATE_KEY } from "../_shared/hiringEvidenceFusion.ts";
import { SOURCE_FEEDBACK_KEY } from "../_shared/sourceFeedbackContract.ts";
import type { CompoundPersistencePlan } from "../_shared/runAgentCompoundPersistenceAdapter.ts";
import { resolveRequestedLeadCount } from "../_shared/leadQuotaPolicy.ts";
import { createBroadeningPlanner } from "../_shared/broadeningPlannerAdapter.ts";
import { createLeadStrategyPlanner, leadStrategyOwnerApplies } from "../_shared/leadStrategyOwner.ts";
import { applyLeadStrategyInitialPlanning } from "../_shared/leadStrategyBridge.ts";
import { constraintsFromBrain } from "../_shared/leadStrategistContext.ts";
// The missing edge between the GPT strategy and the sequential runtime: without
// it the strategist's separate query packs never reach the Actor calls.
import { gptAdaptiveStrategyBinding } from "../_shared/leadStrategyAdaptiveBinding.ts";

import { supabaseToolCallReader } from "../_shared/durableIdempotency.ts";
import { supabaseSourcingStateStore } from "../_shared/companyFirstSourcingState.ts";
import { decideResume, RESUME_REFUSAL_MESSAGE, type ResumableTaskRow } from "../_shared/sourcingContinuation.ts";
import { buildQualifiedLeadRunContext } from "../_shared/qualifiedLeadRunContext.ts";
import { decideClaimAttempt, claimContinuation, claimContinuationViaRpc, releaseContinuationViaRpc, newClaim, releaseClaim, CLAIM_KEY, CLAIM_REFUSAL_MESSAGE, type ContinuationClaim, type ClaimDb, type RpcDb } from "../_shared/continuationClaim.ts";
import { projectStatus, readStatuses } from "../_shared/taskStatusContract.ts";
import { compileJobIntent } from "../_shared/jobIntentTaxonomy.ts";
import { qualificationPersistenceDecision, mapAriaToDecision, isHardEvidenceBlocker, type AriaLike } from "../_shared/qualificationPersistence.ts";
import { resolveFinalCandidateState, refreshEvidenceMissing, type FinalCandidateStateResult } from "../_shared/finalCandidateState.ts";
import { buildQualificationObservability, type CandidateDiagnosticInput, type QualificationObservability } from "../_shared/qualificationObservability.ts";
import { resolveGeographyConstraint, classifyGeography, type GeographyConstraint } from "../_shared/geographyConstraint.ts";
import { runFindLeadsCompanyEnrichment, mapAcceptedPeople, makeCompanyEnrichmentExecutor, emptyCompanyEnrichmentObservability, stillStagedByEnrichmentAfterTiming, type CompanyRawPatch, type CandidateEnrichmentOutcome } from "../_shared/runAgentCompanyEnrichment.ts";
import { enrichmentDeadlineFrom } from "../_shared/companyEnrichmentOrchestrator.ts";
import { shouldSkipBroadResearch } from "../_shared/broadResearchPolicy.ts";
import { DEFAULT_EVIDENCE_BUDGET } from "../_shared/conditionalEnrichmentPlanner.ts";
import type { CompanyEnrichmentObservability } from "../_shared/companyEnrichmentObservability.ts";
import { runJobsSignalEnrichment, makeJobsSignalExecutor, buildSignalCandidates, timingStagesCandidate } from "../_shared/runAgentJobsSignal.ts";
import { compileEvidenceContract } from "../_shared/evidenceContract.ts";
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
  summary: { eligible: number; requested: number; rawJobs: number; terminalStatus: string },
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
    const content = summary.eligible > 0
      ? `I opened the results in Workbench — ${delivered}. Reviewed ${summary.rawJobs} raw job${summary.rawJobs === 1 ? "" : "s"} to get there. Nothing was sent.`
      : `I opened the results in Workbench — ${delivered}. I reviewed ${summary.rawJobs} raw job${summary.rawJobs === 1 ? "" : "s"} and none produced a contact-ready lead yet. Nothing was sent.`;

    await db.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      agent_slug: "pilot",
      metadata: {
        ui_panel: uiPanel,
        plan_id: planId,
        agent_id: "pilot",
        workflow_kind: "qualified_lead_sourcing",
        terminal_status: summary.terminalStatus,
        // Evidence counts, kept distinct from the quota on purpose.
        raw_jobs_reviewed: summary.rawJobs,
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

  // Resolve agent (by slug, falling back to id).
  let agentQuery = supabase.from("agents").select("id, slug, name, model, role_prompt, department");
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
  if (directRequest) {
    const leadAction = directRequest.action;
    // Already validated above (before the plan gate) — ids are known-good UUIDs
    // scoped to this workspace, so a lead action can never fall through to Scout
    // sourcing and start an unrequested provider search.
    const leadIds = directRequest.lead_candidate_ids;

    // Ownership guard: workspace membership alone is not enough — the caller must
    // also own every row it named. Without this, a member of workspace A could
    // pass workspace B's lead ids and have the service-role client happily
    // enrich/draft against them.
    const { data: ownedRows, error: ownErr } = await supabase
      .from("lead_candidates").select("id").eq("workspace_id", workspace_id).in("id", leadIds);
    if (ownErr) {
      await supabase.from("tasks").update({ status: "failed", error_message: "lead_ownership_check_failed" }).eq("id", task.id);
      return json({ success: false, task_id: task.id, error: "lead_ownership_check_failed", message: "Could not verify the selected rows." }, 500);
    }
    const ownedIds = new Set((ownedRows ?? []).map((r: { id: string }) => r.id));
    if (leadIds.some((id) => !ownedIds.has(id))) {
      await supabase.from("tasks").update({ status: "failed", error_message: "lead_not_in_workspace" }).eq("id", task.id);
      return json({ success: false, task_id: task.id, error: "lead_not_in_workspace", message: "Those rows aren't in this workspace." }, 403);
    }

    // Resolved agent always wins; the contract-derived slug is the floor.
    const execAgentSlug: string = agent_slug ?? directRequest.agent_slug;
    const toolCtx = { admin: supabase, workspace_id, agent_slug: execAgentSlug, agent_id: agent.id, agent_name: agent.name, plan_id: plan_id ?? null, task_id: task.id, user_id: taskUserId };
    try {
      const { executeLeadAction } = await import("../_shared/leadActionExecutor.ts");
      const outcome = await executeLeadAction(leadAction, leadIds, {
        admin: supabase, workspace_id, plan_id: plan_id ?? null, task_id: task.id, agent_id: agent.id,
        agent_slug: execAgentSlug, agent_name: agent.name, user_id: taskUserId, runTool, toolCtx,
        // EXPLICIT mode from the validated direct-action contract.
        output_mode: directRequest.output_mode,
      });
      await supabase.from("tasks").update({
        status: outcome.needs_approval ? "awaiting_approval" : "complete",
        result: { output: outcome.summary, lead_action: leadAction, per_lead: outcome.per_lead },
      }).eq("id", task.id);
      if (outcome.needs_approval) {
        // Create the approval review item ONLY. We intentionally do NOT flip the
        // (already-complete) sourcing plan's status — a lead action is a
        // standalone review item, not a re-opening of the sourcing plan.
        await supabase.from("approvals").insert({
          workspace_id, plan_id, task_id: task.id, agent_id: agent.id,
          title: `${agent.name} needs approval`, description: effectiveInstruction, status: "pending",
        });
      }
      await supabase.from("activity_feed").insert({
        workspace_id, plan_id, agent_id: agent.id,
        event_type: outcome.needs_approval ? "awaiting_approval" : "agent_completed",
        title: `${agent.name}: ${leadAction.replace(/_/g, " ")}`, body: outcome.summary,
        metadata: { step_index, task_id: task.id, lead_action: leadAction },
      });
      // Classify once here so the Workbench renders a status it was handed rather
      // than re-deriving one from provider-shaped fields.
      const classified = outcome.per_lead.map((row) => classifyLeadOutcome(leadAction, row));
      const perLead = outcome.per_lead.map((row, i) => ({ ...row, ...classified[i] }));

      return json({
        success: true,
        action: leadAction,
        task_id: task.id,
        status: outcome.needs_approval ? "awaiting_approval" : "complete",
        summary: summarizeDirectAction(classified, leadIds.length),
        summary_text: outcome.summary,
        per_lead: perLead,
      });
    } catch (e) {
      // An executor throw is an infrastructure failure, not a business outcome —
      // but every requested row still gets an honest, retryable per-lead entry so
      // the batch never silently reports "0 succeeded" with no explanation.
      console.error("[run-agent] lead_action failed:", e);
      await supabase.from("tasks").update({ status: "failed", error_message: String(e) }).eq("id", task.id);
      const failed = leadIds.map((id) => ({
        lead_candidate_id: id, status: "failed" as const, reason_code: "provider_failed", retryable: true,
      }));
      return json({
        success: false,
        action: leadAction,
        task_id: task.id,
        status: "failed",
        error: "lead_action_failed",
        summary: summarizeDirectAction(failed, leadIds.length),
        per_lead: failed,
      }, 500);
    }
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
  let sourcingFailure: { error: string; message: string } | null = null;
  // Attempt log from the adaptive multi-attempt sourcing loop (Scout step).
  let adaptiveAttempts: Array<Record<string, unknown>> = [];
  // Sanitized per-attempt audit (label, fingerprint, official actor input, actor
  // key/impl, raw/accepted counts). Provider-safe: NEVER contains tokens/keys.
  let sourcingAttemptAudit: Array<Record<string, unknown>> | null = null;
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
  let personProviderCandidates: Array<{ name: string | null; company: string | null; title: string | null; source_url: string | null }> | null = null;
  // AI Source Planner artifacts (carried into the Scout task result so the final
  // step can render Workbench Insights + a definitive process narrative).
  let sourcePlanMeta: Record<string, unknown> | null = null;
  let sourceQualityMeta: Record<string, unknown> | null = null;
  // Candidate-decision observability (funnel + sanitized per-candidate diagnostics).
  // Broad scope so success / partial_results / no_results terminals can all surface
  // it. Reports the source→qualification→persistence path; never changes policy.
  let qualificationObservability: QualificationObservability | null = null;
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
      if (bodyDeclaresCompanyFirst || (!raw_source_type && !planned_actor_key)) {
        // ROUTE FROM THE ORIGINAL USER INSTRUCTION, not the planner-rewritten Scout
        // prose. Compile the immutable entity intent (person/company/job) and select
        // the primary identity actor from it — "hiring signals" the planner injects
        // can never flip a founder (person) request to the jobs actor (plan da79cba3).
        // `input` carries the original user_instruction (orchestrate threads it);
        // fall back to `instruction` only for a direct run-agent call.
        const entityIntent = compileLeadEntityIntent(input ?? instruction ?? "");
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
        } else {
          // Ambiguous entity — best-effort resolver on the ORIGINAL instruction.
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
        const invokeJobs = async (envelope: Record<string, unknown>): Promise<unknown[]> => {
          const rr = await runTool("source_with_apify", envelope, baseCtx);
          if (!rr.ok || !rr.data) throw new Error(rr.error ?? "jobs_actor_failed");
          const items = (rr.data as { items?: unknown[] }).items;
          return Array.isArray(items) ? items : [];
        };
        const invokePeople = async (envelope: Record<string, unknown>): Promise<unknown[]> => {
          const rr = await runTool("source_with_apify", envelope, baseCtx);
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
        const quota = resolveRequestedLeadCount({
          explicit: (body.requested_lead_count ?? tool_input_body?.requested_lead_count ?? cfIntent.requested_count) as number | null | undefined,
          isLeadSourcingWorkflow: true,
        });

        // SOURCING STRATEGY OWNER.
        //
        // On the gated path — workflow = qualified_lead_sourcing AND
        // execution_mode = company_first — strategy belongs to ONE model family:
        // OpenAI GPT-5.6 Luna (primary) escalating once to Terra, through
        // Lovable's built-in AI gateway. Gemini is not reachable from that path.
        // Every other workflow keeps the existing planner untouched.
        //
        // Either way the planner only PROPOSES titles: each proposal is
        // re-validated deterministically and cost-approved before any paid call,
        // and any failure falls back to the deterministic ladder.
        const useLeadStrategyOwner = leadStrategyOwnerApplies({
          workflow: (body.workflow_kind as string) ?? "qualified_lead_sourcing",
          executionMode: "company_first",
        });
        const broadeningPlanner = useLeadStrategyOwner
          ? createLeadStrategyPlanner({
            workspaceId: workspace_id,
            agentSlug: agent_slug,
            mission: {
              original_query: String(cfIntent.job_search_spec.original_query ?? ""),
              requested_lead_count: quota.requestedLeadCount,
              requested_titles: cfIntent.job_search_spec.keyword_queries ?? [],
              decision_maker_roles: cfIntent.job_search_spec.requested_person_roles ?? [],
              geography: cfIntent.job_search_spec.location ?? null,
              company_vertical: cfIntent.job_search_spec.company_vertical
                ? String(cfIntent.job_search_spec.company_vertical)
                : null,
            },
          })
          : createBroadeningPlanner({ workspaceId: workspace_id, agentSlug: agent_slug });
        console.log("[run-agent][strategy-owner]", {
          task_id: task.id,
          owner: useLeadStrategyOwner ? "openai_lead_strategy" : "legacy_broadening_planner",
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
        // Orchestrate threads the artifact on the request body. That is the
        // authoritative copy at this point in the handler — the plan row is read
        // later, and re-reading it here would only re-derive the same value.
        const persistedPlan = body.qualified_lead_plan
          ? readPlanArtifact([{ metadata: { qualified_lead_plan: body.qualified_lead_plan } }])
          : null;

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

        // Everything else (person roles, geography, vertical, quota, gates)
        // is carried through untouched.
        const gptStrategy = (useLeadStrategyOwner && !persistedPlan)
          ? await applyLeadStrategyInitialPlanning({
            workspaceId: workspace_id,
            spec: cfIntent.job_search_spec as unknown as Parameters<typeof applyLeadStrategyInitialPlanning>[0]["spec"],
            requestedLeadCount: quota.requestedLeadCount,
            companyVertical: cfIntent.job_search_spec.company_vertical
              ? String(cfIntent.job_search_spec.company_vertical)
              : null,
            // The workspace's real ICP, so the strategist plans against it rather
            // than guessing. Absent when the Brain is not enforced.
            companyConstraints: brainEnforced
              ? constraintsFromBrain(effectivePolicy.constraints as never, {
                country: cfIntent.job_search_spec.location ?? null,
                vertical: cfIntent.job_search_spec.company_vertical
                  ? String(cfIntent.job_search_spec.company_vertical)
                  : null,
              })
              : null,
          })
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

        if (!resumeSatisfied && routeResolution.ok && routeRecord &&
            routeResolution.validated_route !== "broad_job_fallback") {
          try {
            companyFirstRoute = await executeCompanyFirstRoute({
              // The SAME provider entry point the rest of run-agent uses. The
              // executor holds no provider import of its own.
              invoke: async (call) => {
                const rows = await invokeJobs({
                  selected_actor_key: call.actorKey,
                  actor_id: call.actorId,
                  ...(call.input as Record<string, unknown>),
                });
                return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
              },
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

        const claudeFirst = persistedPlan
          ? claudeFirstFromPersistedPlan(persistedPlan, cfIntent.job_search_spec as unknown as Record<string, unknown>)
          : gptStrategy?.specRewritten
          ? null
          : await applyClaudeFirstLeadPlanning({
          workspaceId: workspace_id,
          originalInstruction: cfIntent.job_search_spec.original_query,
          spec: cfIntent.job_search_spec as unknown as Parameters<typeof applyClaudeFirstLeadPlanning>[0]["spec"],
          missionId: `${task.id}:1`,
          taskId: task.id,
          requestedLeadCount: quota.requestedLeadCount,
        });
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
          // NO SECOND MODEL CALL. `applyClaudeFirstLeadPlanning` above already made
          // the one Claude-first planning request for this task, through its own
          // gateway, prompt and parser, behind CLAUDE_FIRST_LEAD_PLANNING and the
          // workspace allow-list. `adaptiveStrategyBinding` hands the strategy it
          // ALREADY accepted to the adaptive adapter; when planning was disabled or
          // fell back, the strategy is null and the sequential bridge keeps
          // `deterministicOrderedPlan` with the exact reason.
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
            spec: cfIntent.job_search_spec as unknown as Parameters<typeof applyClaudeFirstLeadPlanning>[0]["spec"],
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
        const classificationBinding = buildSemanticClassificationBinding({
          workspaceId: workspace_id,
          requestedLeadCount: quota.requestedLeadCount,
        });

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
        const statuses = projectStatus(cf.status, cf.writeBoundary.invariantViolation, {
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

      if (shouldRun) {
        let location: string | null = tool_input_body?.location ?? null;
        // Structured Scout query plan (Parts 3/5): precise multi-queries + split
        // locations + match tiers. Null for vague requests → legacy keyword path.
        let scoutPlan: any = null;
        let scoutPlanMod: any = null;
        let roleKeywords: string[] = Array.isArray(tool_input_body?.role_keywords) ? tool_input_body.role_keywords : [];
        let max_results: number = typeof tool_input_body?.max_results === "number"
          ? Math.max(1, Math.min(200, tool_input_body.max_results))
          : 5; // QA-safe default — never silently source 25.

        if (!location) {
          const locMatch = (instruction ?? "").match(/\bin\s+([A-Z][A-Za-z\s\-]+?)(?:[.,]|$)/);
          location = locMatch?.[1]?.trim() ?? null;
        }
        if (roleKeywords.length === 0) {
          // Multi-word assistant/support tokens are listed before bare
          // "assistant"/"admin" so "executive assistant" is captured as one
          // phrase. roleAliases() then expands any support role to the full
          // SUPPORT_ROLE_ALIASES set (EA, Chief of Staff, Founder's Office…).
          roleKeywords = Array.from(
            new Set(((instruction ?? "").toLowerCase().match(/\b(marketing|marketer|sales|engineer|developer|designer|founder|product|react|frontend|backend|growth|recruiter|executive assistant|administrative assistant|admin assistant|operations assistant|operations associate|virtual assistant|personal assistant|founder office|founder'?s office|founder associate|chief of staff|office manager|assistant|admin)\b/g) ?? [])),
          );
        }

        // Adaptive input validation: fix typos (GGTM→GTM, healtcare→healthcare)
        // on the query, roles, and location before the actor runs.
        const { normalizeTerm } = await import("../_shared/inputNormalize.ts");
        const rawQuery = (tool_input_body?.query as string) ?? instruction;
        let normalizedQuery = normalizeTerm(rawQuery) || rawQuery;
        roleKeywords = roleKeywords.map((r) => normalizeTerm(r)).filter(Boolean);
        if (location) location = normalizeTerm(location);

        // Part 1/7 — every sourcing run gets a fresh run_id + the ORIGINAL user
        // query, so the trace is self-contained and a new query can never be
        // confused with a previous run's cached keywords/state. Built here, before
        // any provider input, and threaded through the trace + each lead's raw.
        const run_id = (globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
        const original_user_query = (instruction ?? rawQuery ?? normalizedQuery ?? "").toString();
        const run_started_at = new Date().toISOString();

        let plannedUserInput: Record<string, unknown> | undefined =
          (tool_input_body?.user_input && typeof tool_input_body.user_input === "object")
            ? tool_input_body.user_input as Record<string, unknown> : undefined;

        // ---- AI Source Planner (Phase 4): Gemini shapes the best GENERIC actor
        // input for the (already deterministically-selected) actor; a deterministic
        // planner + validator are the authoritative fallback/guardrail. Never lets
        // the model pick the actor or run a tool. Only runs when we know the actor's
        // schema; otherwise the existing deterministic input is used unchanged.
        try {
          const { getActorInputSchema } = await import("../_shared/actorInputSchemas.ts");
          const plannerSchema = getActorInputSchema(planned_actor_key);
          if (plannerSchema) {
            const { planActorInput } = await import("../_shared/actorInputPlanner.ts");
            const { parseStrictConstraints: _psc } = await import("../_shared/sourcingRetry.ts");
            const strictForPlan = _psc(instruction ?? "");
            const postUrls = Array.isArray((plannedUserInput?.postUrls)) ? plannedUserInput!.postUrls as string[]
              : ((instruction ?? "").match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)"']+/ig) ?? []);
            const planRes = await planActorInput({
              user_request: instruction ?? "",
              actor_key: planned_actor_key!,
              source_type: plannerSchema.source_type,
              count: max_results,
              normalized: {
                role: roleKeywords[0] ?? (tool_input_body?.target_role as string) ?? undefined,
                industry: (tool_input_body?.industry as string) ?? undefined,
                location: location ?? undefined,
                company_category: (tool_input_body?.company_category as string) ?? undefined,
                company_stage: (tool_input_body?.stage as string) ?? undefined,
                topic: (tool_input_body?.query as string) ?? undefined,
                count: max_results,
              },
              competitors: Array.isArray(tool_input_body?.competitors) ? tool_input_body.competitors as string[] : undefined,
              post_urls: postUrls,
              strict: strictForPlan,
              strict_location_value: strictForPlan.location ? (location ?? null) : null,
            });
            const pin = planRes.input as Record<string, unknown>;
            if (typeof pin.query === "string" && pin.query.trim()) normalizedQuery = pin.query.trim();
            if (Array.isArray(pin.role_keywords) && (pin.role_keywords as unknown[]).length) roleKeywords = pin.role_keywords as string[];
            if (typeof pin.location === "string" && pin.location.trim()) location = pin.location.trim();
            if (pin.user_input && typeof pin.user_input === "object") {
              plannedUserInput = { ...(plannedUserInput ?? {}), ...(pin.user_input as Record<string, unknown>) };
            }
            sourcePlanMeta = {
              source: planRes.source,
              planner_mode: planRes.planner_mode,
              provider_used: planRes.provider_used,
              model_used: planRes.model_used,
              ai_calls: planRes.ai_calls,
              gemini_used: planRes.provider_used === "lovable-ai",
              claude_used: planRes.provider_used === "anthropic",
              deterministic_fallback_used: planRes.planner_mode === "deterministic_fallback",
              actor_key: planned_actor_key,
              primary_query: planRes.plan.query_strategy.primary_query,
              role_aliases: planRes.plan.query_strategy.role_aliases ?? [],
              broadening_level: planRes.plan.query_strategy.broadening_level,
              expected_entity_type: planRes.plan.expected_entity_type,
              generated_actor_input: planRes.plan.input,
              sanitized_actor_input: planRes.input,
              validation_ok: planRes.validation.ok,
              validation_warnings: planRes.validation.warnings,
              missing_info: planRes.plan.missing_info,
            };
            console.log("[run-agent] source planner", { mode: planRes.planner_mode, provider: planRes.provider_used, model: planRes.model_used, valid: planRes.validation.ok, query: normalizedQuery, roles: roleKeywords.length });
          }
        } catch (e) { console.warn("[run-agent] source planner failed, using deterministic input:", e); }

        // Lead Intelligence Engine: when pilot-chat threaded a hiring intent, use
        // its OR-joined role-alias query + role_keywords so the jobs actor searches
        // the RIGHT role family (Executive Assistant / Chief of Staff / Founder's
        // Office …), not generic Founder / Head of Growth. The exclude list and
        // role-family match are enforced post-sourcing by filterHiringCandidates.
        const leadIntentBody = (tool_input_body?.lead_intent ?? null) as {
          role_family?: string | null;
          role_keywords?: string[];
          exclude_role_keywords?: string[];
          // Company-Brain ICP constraints (target company definition).
          positive_industries?: string[]; target_industry?: string[];
          negative_industries?: string[]; excluded_company_types?: string[]; preferred_company_types?: string[];
          target_company_size?: string[]; disqualifiers?: string[]; allow_enterprise?: boolean; strictness?: string;
        } | null;
        if (leadIntentBody?.role_family && Array.isArray(leadIntentBody.role_keywords) && leadIntentBody.role_keywords.length) {
          normalizedQuery = leadIntentBody.role_keywords.slice(0, 12).join(" OR ");
          roleKeywords = leadIntentBody.role_keywords;
        }

        // Phase A wiring — separate the request into persona / company profile /
        // signal / role family and route it (account_first vs profile_first). Used
        // to stamp per-lead run-trace + role exactness below; NEVER a provider call.
        // orchestrate may thread an authoritative routing decision (lead_routing);
        // otherwise we derive it here so gating still works without upstream wiring.
        const threadedRouting = (body as { lead_routing?: { source_strategy?: string; requested_role_family?: string | null } }).lead_routing ?? null;
        const separatedIntent = separateIntent({
          message: instruction ?? normalizedQuery ?? "",
          brain: (brain as any)?.icp
            ? { industries: (brain as any).icp.industries, disqualifiers: (brain as any).icp.disqualifiers, geography: (brain as any).icp.geography, buyer_roles: (brain as any).icp.buyer_roles }
            : null,
          hardExclusions: leadIntentBody?.disqualifiers ?? undefined,
        });
        // Requested hiring role family: prefer the threaded lead_intent (explicit),
        // else the separated intent's detection. Drives per-lead role exactness.
        const threadedFamily: RoleFamily | null = (() => {
          if (!leadIntentBody?.role_family) return null;
          const f = classifyRoleFamily(leadIntentBody.role_family);
          return f === "other" ? null : f;
        })();
        const requestedRoleFamily: RoleFamily | null = threadedFamily ?? separatedIntent.requested_role_family;
        const sourceStrategy: "account_first" | "profile_first" =
          (threadedRouting?.source_strategy === "profile_first" || threadedRouting?.source_strategy === "account_first")
            ? threadedRouting.source_strategy
            : separatedIntent.source_strategy;

        // Phase 4 — Company-Brain-aware Scout query for the jobs actor. Prefers
        // revenue/growth/RevOps + SaaS context and drops generic operations terms
        // (the proof gate would cap/reject them anyway). Reports weak ICP context
        // instead of pretending. Only for jobs; other sources unchanged.
        let scoutQueryMeta: Record<string, unknown> | null = null;
        if (source_type === "jobs") {
          try {
            scoutPlanMod = await import("../_shared/scoutSourcingPlan.ts");
            scoutPlan = scoutPlanMod.planScoutQueries({ instruction: instruction ?? normalizedQuery, brain });
            if (scoutPlan) {
              // Structured: PRECISE keywords + ONE concrete LinkedIn location
              // (split from any "US + EU") — never the mega keyword blob.
              plannedUserInput = { ...(plannedUserInput ?? {}), keywords: scoutPlan.primary.keywords };
              normalizedQuery = scoutPlan.primary.keywords;
              location = scoutPlan.primary.location;
              scoutQueryMeta = {
                run_id,
                original_user_query,
                keywords: scoutPlan.primary.keywords,
                location: scoutPlan.primary.location,
                provider_queries: scoutPlan.provider_queries,
                funding_required: scoutPlan.intent.funding_required,
                must_have_categories: scoutPlan.intent.must_have_categories,
                weak_icp_context: scoutPlan.intent.must_have_categories.length === 0,
              };
            } else {
              // Vague request → legacy Company-Brain keyword builder unchanged.
              const { buildScoutJobsKeywords } = await import("../_shared/scoutStrategy.ts");
              const sq = buildScoutJobsKeywords({ roleKeywords, query: normalizedQuery, icp: (brain as any)?.icp ?? null });
              if (sq.keywords && sq.keywords.trim()) plannedUserInput = { ...(plannedUserInput ?? {}), keywords: sq.keywords };
              scoutQueryMeta = { keywords: sq.keywords, used_terms: sq.usedTerms, avoided_terms: sq.avoidedTerms, weak_icp_context: sq.weakIcpContext, saas_context_applied: sq.saasContextApplied };
              if (sq.weakIcpContext) console.warn("[run-agent] Scout: weak ICP context — Company Brain has no structured ICP; query is role-only.");
            }
          } catch (e) { console.warn("[run-agent] scout query planning failed:", e); }
        }

        const apifyInput = {
          // Derived people/company/engagement actor (from resolveProviderSource) is
          // threaded through the registry+enable path so it fails closed if disabled.
          selected_actor_key: planned_actor_key ?? derivedActorKey ?? undefined,
          source_type,
          search_goal: normalizedQuery,
          query: normalizedQuery,
          location: location ?? undefined,
          role_keywords: roleKeywords.length > 0 ? roleKeywords : undefined,
          max_results,
          // Phase 3 — pass whitelisted structured input (e.g. LinkedIn targetUrls,
          // keywords, topics) through to the actor-specific input adapter.
          input: plannedUserInput,
        };

        // People-search input quality: build three MATERIALLY-DISTINCT, structured
        // attempts (exact → broadened → minimal_safe) from parsed lead intent, so
        // the actor filters on real currentJobTitles + locations + a concise market
        // searchQuery instead of the natural-language Scout instruction. Fixes the
        // live "3 identical actor runs → 0 items" failure. Deterministic; no LLM.
        const peopleAttempts = source_type === "people_profiles"
          ? buildPeopleSearchAttempts(
              parsePeopleSearchIntent(`${instruction ?? ""} ${input ?? ""} ${normalizedQuery ?? ""}`),
              { maxItems: max_results, takePages: 1, startPage: 1 },
            )
          : null;
        if (peopleAttempts) {
          console.log("[run-agent] people-search attempts", peopleAttempts.map((a) => ({ label: a.label, fingerprint: a.fingerprint })));
        }

        // Phase 4 — QA cost transparency: the jobs actor floors count at 10 even
        // when we request 1-3; surface requested vs actor vs processed so a
        // $5-capped run is never silently a 10-result run.
        const actorCount = source_type === "jobs" ? Math.max(10, Math.min(100, max_results)) : max_results;

        console.log("[run-agent] apify input", {
          requested_source_type: raw_source_type,
          normalized_source_type: source_type,
          ...apifyInput,
          scout_query: scoutQueryMeta,
          requested_max_results: max_results,
          actor_count: actorCount,
        });
        // Adaptive multi-attempt sourcing: broaden role aliases → industry →
        // relax stage/location and retry until the requested count is met (or
        // caps / strict constraints / a tool failure stop it). Items are
        // validated, deduped across attempts, and capped at the requested count.
        const { runAdaptiveSourcing, parseStrictConstraints, resolveMaxAttempts } = await import("../_shared/sourcingRetry.ts");
        const strict = parseStrictConstraints(instruction ?? "");
        const maxAttempts = resolveMaxAttempts(instruction ?? "", strict);
        const criteria = {
          requested: max_results,
          role: roleKeywords[0] ?? null,
          industry: (tool_input_body?.industry as string) ?? null,
          location: location ?? null,
          stage: (tool_input_body?.stage as string) ?? null,
          category: (tool_input_body?.company_category as string) ?? null,
          source_type: (tool_input_body?.source_type as string) ?? source_type ?? null,
        };
        // Section 5 (v81 fix) — resolve the AUTHORITATIVE source-gate geography for
        // the PERSON path so a COUNTRY intent (Company Brain ICP geography / the
        // actor's country filter) governs the strict gate. A diverged planner/
        // instruction locality can never silently strengthen a country constraint
        // into a strict city/region one; an EXPLICIT user locality still wins. The
        // actor input already ran (uses peopleAttempts), so this only aligns the
        // gate — it never changes what the actor filtered on. Jobs/company unchanged.
        let sourceGateGeography: GeographyConstraint = classifyGeography(criteria.location);
        if (source_type === "people_profiles") {
          sourceGateGeography = resolveGeographyConstraint([
            { value: (tool_input_body?.location as string) ?? null, source: "user_explicit" },
            { value: location, source: "planner" },
            { value: (brain as any)?.icp?.geography ?? null, source: "brain" },
          ]);
          if (sourceGateGeography.value) criteria.location = sourceGateGeography.value;
        }
        const mapItem = (it: any) => {
          // HarvestAPI people profiles nest the useful fields: name = firstName+
          // lastName, title/company live in currentPosition[0], location is an
          // object. Extract those so real profiles aren't rejected as "missing
          // name/company / wrong role".
          const cp = Array.isArray(it?.currentPosition) ? it.currentPosition[0] : (it?.currentPosition ?? null);
          const fullName = [it?.firstName, it?.lastName].filter(Boolean).join(" ").trim();
          const locObj = it?.location;
          const locStr = typeof locObj === "string" ? locObj
            : (locObj?.parsed?.text ?? locObj?.linkedinText ?? locObj?.parsed?.city ?? null);
          // Structured provider geography for country-aware strict-location gating.
          const locEvidence = extractCandidateLocationEvidence(it);
          // Source-proof URL. HarvestAPI profile search returns it as
          // linkedinUrl / publicProfileUrl / profileUrl / url (see contactDiscovery)
          // — earlier we only checked url/linkedinUrl, so real profiles were
          // rejected as "no profile URL". Fall back to deep-scanning for any
          // linkedin.com/in|posts|jobs URL anywhere in the item.
          const deepLinkedinUrl = (() => {
            try {
              const m = JSON.stringify(it).match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|posts|jobs|feed|company)\/[^\s"'\\]+/i);
              return m?.[0] ?? null;
            } catch { return null; }
          })();
          return {
            name: it?.name ?? it?.fullName ?? (fullName || null) ?? it?.author?.name ?? it?.actor?.name ?? null,
            title: it?.title ?? it?.jobTitle ?? it?.position ?? cp?.position ?? cp?.title ?? it?.headline ?? null,
            company: it?.company ?? it?.companyName ?? cp?.companyName ?? it?.organization ?? it?.actor?.name ?? null,
            source_url: it?.url ?? it?.link ?? it?.postUrl ?? it?.linkedinUrl ?? it?.publicProfileUrl ?? it?.profileUrl ?? it?.linkedin_url ?? it?.jobUrl ?? it?.query?.post ?? deepLinkedinUrl ?? null,
            location: locStr ?? it?.companyLocation ?? null,
            location_country: locEvidence.country ?? null,
            location_country_code: locEvidence.country_code ?? null,
            raw: it,
          };
        };
        // Company Brain → derived ICP (Part B): the single ICP object Scout
        // pre-rank, the analyst, gates and Workbench all consume.
        const brainIcpMod = await import("../_shared/companyBrainIcp.ts").catch(() => null);
        const preRankMod = await import("../_shared/leadPreRank.ts").catch(() => null);
        const derivedIcp = brainIcpMod ? brainIcpMod.deriveCompanyIcp((brain as any) ?? null) : null;
        let scoutWeakPool = false;
        const scoutRankByUrl = new Map<string, { scoutRank: number; scoutPreRankScore: number; scoutRankReasons: string[]; scoutPenalties: string[] }>();
        const toPreRank = (a: any) => ({
          company: a.company ?? a.name, jobTitle: a.title, website: a.raw?.website ?? a.raw?.company_website,
          domain: a.raw?.domain, linkedinUrl: a.raw?.company_linkedin_url, jobUrl: a.raw?.job_url ?? a.source_url, source_url: a.source_url,
          industries: a.raw?.industries, companyDescription: a.raw?.company_description, jobDescription: a.raw?.job_description,
          employeeCount: a.raw?.employee_count ?? a.raw?.companyEmployeesCount, raw: a.raw,
        });
        const rawAllItems: ReturnType<typeof mapItem>[] = [];
        let scoutAttemptIdx = 0;
        const runAttempt = async (strategy: { role_keywords: string[]; relax_location: boolean }) => {
          // When a structured plan exists, rotate through its precise queries +
          // split locations across attempts (strict → relaxed tiers, US + EU
          // covered). Otherwise fall back to the existing apifyInput/broaden.
          const pq = (scoutPlan && scoutPlanMod) ? scoutPlanMod.attemptQuery(scoutPlan, scoutAttemptIdx) : null;
          scoutAttemptIdx++;
          const attemptInput = {
            ...apifyInput,
            ...(pq ? { query: pq.keywords, search_goal: pq.keywords, input: { ...(plannedUserInput ?? {}), keywords: pq.keywords } } : {}),
            role_keywords: strategy.role_keywords.length > 0 ? strategy.role_keywords : apifyInput.role_keywords,
            location: strategy.relax_location ? undefined : (pq ? pq.location : apifyInput.location),
            max_results,
            // Don't persist per attempt — we persist ONCE below with the capped,
            // deduped accepted set so DB lead_candidates == accepted count.
            defer_persistence: true,
          };
          // People-search: drive each attempt with the structured, DISTINCT payload
          // (exact → broadened → minimal_safe) so retries materially broaden instead
          // of re-sending an identical natural-language query. searchQuery="" tells
          // the adapter to omit the market phrase (minimal_safe fallback).
          if (peopleAttempts) {
            const pa = peopleAttempts[Math.min(Math.max(0, scoutAttemptIdx - 1), peopleAttempts.length - 1)];
            const pp = pa.payload as Record<string, unknown>;
            attemptInput.input = {
              ...((attemptInput.input as Record<string, unknown> | undefined) ?? plannedUserInput ?? {}),
              currentJobTitles: pp.currentJobTitles,
              searchQuery: typeof pp.searchQuery === "string" ? pp.searchQuery : "",
              takePages: pp.takePages ?? 1,
              profileScraperMode: pp.profileScraperMode ?? "Full",
              ...(Array.isArray(pp.locations) && pp.locations.length ? { locations: pp.locations } : {}),
            };
          }
          const rr = await runTool("source_with_apify", attemptInput, baseCtx);
          if (rr.ok && rr.data) {
            let mapped = ((rr.data as { items?: any[] }).items ?? []).map(mapItem);
            // Part D — pre-rank the fetched POOL against the Company Brain ICP and
            // sort best-first, so the downstream max_results cap keeps the BEST
            // candidate, not the first returned. Uses already-fetched data only.
            if (source_type === "jobs" && preRankMod && derivedIcp && mapped.length > 1) {
              try {
                const pr = preRankMod.preRankCandidates(mapped.map(toPreRank), derivedIcp);
                scoutWeakPool = pr.weakPool;
                const order = new Map<string, number>();
                pr.ranked.forEach((r: any) => {
                  const k = String(r.candidate.source_url ?? "").toLowerCase();
                  order.set(k, r.scoutPreRankScore);
                  if (k) scoutRankByUrl.set(k, { scoutRank: r.scoutRank, scoutPreRankScore: r.scoutPreRankScore, scoutRankReasons: r.scoutRankReasons, scoutPenalties: r.scoutPenalties });
                });
                mapped = [...mapped].sort((a: any, b: any) => (order.get(String(b.source_url ?? "").toLowerCase()) ?? 0) - (order.get(String(a.source_url ?? "").toLowerCase()) ?? 0));
              } catch (e) { console.warn("[run-agent] pre-rank failed:", e); }
            }
            rawAllItems.push(...mapped); // accumulate for source-quality reject reasons
            return { items: mapped };
          }
          // unavailable / !ok = tool failure (auth/config/credits). 0-results is ok+data above.
          return { items: [], tool_failed: true, error: rr.error ?? "apify_failed" };
        };

        const adaptive = await runAdaptiveSourcing({ criteria, strict, maxAttempts, runAttempt });
        adaptiveAttempts = adaptive.attempts as unknown as Array<Record<string, unknown>>;

        // Sanitized attempt audit — records the ACTUAL people-search strategy label
        // (exact/broadened/minimal_safe), fingerprint, official actor input, actor
        // key/implementation, and raw/accepted counts per attempt. Provider-safe:
        // pa.payload is built through the schema allowlist (no tokens/keys/headers).
        if (peopleAttempts && peopleAttempts.length) {
          try {
            const { ACTOR_REGISTRY } = await import("../_shared/actorRegistry.ts");
            const auditActorKey = (apifyInput.selected_actor_key as string | undefined) ?? derivedActorKey ?? "apify_people_search";
            const auditActorImpl = ACTOR_REGISTRY[auditActorKey]?.actor_id ?? null;
            sourcingAttemptAudit = buildSourcingAttemptAudit(
              peopleAttempts,
              (adaptive.attempts as any[]).map((at: any) => ({ result_count: at.result_count, accepted_count: at.accepted_count })),
              { actor_key: auditActorKey, actor_implementation: auditActorImpl },
            ) as unknown as Array<Record<string, unknown>>;
            // Correct the misleading generic strategy label in the attempt log too.
            (adaptive.attempts as any[]).forEach((_at, i) => {
              if (adaptiveAttempts[i]) (adaptiveAttempts[i] as Record<string, unknown>).people_strategy = peopleAttempts[Math.min(i, peopleAttempts.length - 1)].label;
            });
            console.log("[run-agent] sourcing attempt audit", sourcingAttemptAudit);
          } catch (e) { console.warn("[run-agent] attempt audit build failed:", e); }
        }

        // Phase 4 — QA cost report: requested vs actor floor vs processed.
        let qaLimitReport: Record<string, unknown> | null = null;
        try {
          const { computeQaLimit } = await import("../_shared/scoutStrategy.ts");
          qaLimitReport = computeQaLimit(max_results, actorCount, rawAllItems.length) as unknown as Record<string, unknown>;
          console.log("[run-agent] QA limit", qaLimitReport);
        } catch { /* reporting only */ }

        // Lead Intelligence Engine role-family filter: for a threaded hiring
        // intent, gate the accepted set through filterHiringCandidates — it
        // REQUIRES a source URL (CSV source proof), rejects wrong-family titles
        // (Senior AI Engineer, Growth Lead, Product Marketing) and profile/equity
        // titles (Co-Founder, Founder, CEO, CTO). Same-family broadening is
        // inherent: role_keywords already is the family alias set.
        let lieAcceptedItems: typeof adaptive.accepted | null = null;
        let lieTrace: Array<Record<string, unknown>> | null = null;
        if (leadIntentBody?.role_family) {
          try {
            const { filterHiringCandidates } = await import("../_shared/leadIntent.ts");
            const candKey = (c: { company?: string | null; job_title?: string | null; source_url?: string | null }) =>
              `${String(c.company ?? "").toLowerCase()}|${String(c.job_title ?? "").toLowerCase()}|${c.source_url ?? ""}`;
            const candidates = rawAllItems.map((it: any) => ({
              company: it?.company ?? it?.name ?? null,
              job_title: it?.title ?? null,
              source_url: it?.source_url ?? null,
              location: it?.location ?? null,
            }));
            const lieRes = filterHiringCandidates(candidates as any, { hiring_signal: { role_family: leadIntentBody.role_family } } as any);
            lieTrace = lieRes.trace as unknown as Array<Record<string, unknown>>;
            const acceptedKeys = new Set(lieRes.accepted.map(candKey));
            lieAcceptedItems = adaptive.accepted.filter((a: any) =>
              acceptedKeys.has(candKey({ company: a.company ?? a.name, job_title: a.title, source_url: a.source_url })),
            );
            console.log("[run-agent] LIE hiring filter", {
              role_family: leadIntentBody.role_family,
              before: adaptive.accepted.length,
              after: lieAcceptedItems.length,
              rejected: lieRes.rejected.length,
            });
          } catch (e) { console.warn("[run-agent] LIE hiring filter failed:", e); }

          // Company-Brain ICP filter (Phase 5-8): the prompt gave the SIGNAL, the
          // Brain gives the TARGET COMPANY. Reject off-ICP giants (oil/gov/hospital/
          // bank/university/enterprise) unless the Brain targets them, plus wrong
          // industry / too-large / disqualified types. Records why each row matched.
          try {
            const hasIcp = (leadIntentBody?.positive_industries?.length || leadIntentBody?.target_industry?.length
              || leadIntentBody?.negative_industries?.length || leadIntentBody?.excluded_company_types?.length
              || leadIntentBody?.target_company_size?.length || leadIntentBody?.disqualifiers?.length);
            if (hasIcp && lieAcceptedItems && lieAcceptedItems.length > 0) {
              const { filterByIcp, icpConstraintsFromIntent } = await import("../_shared/companyIcpFilter.ts");
              const cons = icpConstraintsFromIntent(leadIntentBody);
              const toCand = (a: any) => ({
                company: a.company ?? a.name ?? null,
                industry: (a.raw?.industry ?? a.raw?.companyIndustry ?? a.raw?.category) as string | null,
                company_category: a.raw?.category as string | null,
                team_size: (a.raw?.companySize ?? a.raw?.company_size ?? a.raw?.employeeCount ?? a.raw?.team_size ?? a.raw?.employees) as string | null,
                company_type: a.raw?.companyType as string | null,
                location: a.location ?? null,
                title: a.title ?? null,
                source_url: a.source_url ?? null,
              });
              const pairs = lieAcceptedItems.map((a: any) => ({ a, cand: toCand(a) }));
              const res = filterByIcp(pairs.map((p) => p.cand), cons);
              const acceptedSet = new Set(res.accepted);
              const before = lieAcceptedItems.length;
              lieAcceptedItems = pairs.filter((p) => acceptedSet.has(p.cand)).map((p) => {
                const why = res.matched.get(p.cand) ?? [];
                // Attach ICP match reasons onto raw for Workbench "why matched".
                if (why.length) (p.a.raw ??= {}).icp_matched = why;
                return p.a;
              });
              // Merge ICP reject reasons into the trace so the summary is honest.
              const icpTraceRows = (res.trace as unknown as Array<Record<string, unknown>>);
              lieTrace = [...(lieTrace ?? []), ...icpTraceRows];
              console.log("[run-agent] Company-Brain ICP filter", { before, after: lieAcceptedItems.length, constraints: cons });
            }
          } catch (e) { console.warn("[run-agent] ICP filter failed:", e); }
        }

        // Non-hiring source gates (people / company / posts / comments / workflow
        // trends) — the SAME trust standard as hiring: require real SOURCE PROOF
        // (profile/website/post/comment URL), a RELEVANCE match (role family,
        // company category, topic, competitor) to what the user asked, dedupe, and
        // produce a transparent reject trace. Only the gated set is persisted.
        //
        // The runtime's normalizeApifySourceType collapses people/company/comments
        // all to "jobs", so we resolve the gate KIND from the un-collapsed signals
        // (LIE workflow_type from the threaded intent OR re-extracted here, the raw
        // requested source_type, the actor key, and the query).
        let gateAcceptedItems: typeof adaptive.accepted | null = null;
        let resolvedGateKind: string | null = null;
        if (!leadIntentBody?.role_family) {
          try {
            const sg = await import("../_shared/sourceGates.ts");
            const { roleAliases } = await import("../_shared/broaden.ts");
            const u = (x: unknown) => String(x ?? "").toLowerCase();

            // Prefer the threaded LIE intent; else re-extract from the instruction so
            // gating still works when the confirmation card didn't thread an intent.
            const threadedIntent = (tool_input_body?.lead_intent ?? null) as { workflow_type?: string; source_type?: string; competitors?: string[]; target_company_type?: string[] } | null;
            let reIntent: any = null;
            if (!threadedIntent?.workflow_type) {
              try {
                const { extractLeadIntent } = await import("../_shared/leadIntent.ts");
                reIntent = extractLeadIntent({ message: instruction ?? "", brain: brain ? { icp: (brain as any).icp, company: (brain as any).company } : null });
              } catch { /* deterministic gate-kind fallback below */ }
            }
            const gateKind = sg.resolveGateKind({
              workflow_type: threadedIntent?.workflow_type ?? reIntent?.workflow_type ?? null,
              raw_source_type,
              normalized_source_type: source_type,
              selected_actor_key: planned_actor_key,
              has_role_family: false,
              query: `${apifyInput.query ?? ""} ${instruction ?? ""}`,
            });
            resolvedGateKind = gateKind;

            // Posts / comments / workflow trends are NOT company/people leads, so the
            // lead-centric adaptive validator drops them ("missing name/company").
            // Gate those over the raw sourced items instead; and normalize each via
            // normalizeLinkedinEngagementItem (the generic mapItem can't extract a
            // post's author/text/url — they're nested under author/commenter), then
            // dedupe by post URL. People/company stay on the lead-validated set.
            const isContentKind = gateKind === "posts" || gateKind === "comments" || gateKind === "workflow";
            // Company via a Google SERP actor also isn't a lead — normalize the
            // organic results ({title,url,displayedUrl,description}) into companies.
            const isSerpCompany = gateKind === "company" && (["serp", "search", "search_fallback"].includes(String(raw_source_type ?? "")) || ["serp", "search_fallback"].includes(String(source_type ?? "")) || /serp|google|search/i.test(String(planned_actor_key ?? "")));
            let gatePool: typeof adaptive.accepted = adaptive.accepted;
            if (isContentKind) {
              const { normalizeLinkedinEngagementItem } = await import("../_shared/linkedinEngagementOutput.ts");
              const seenU = new Set<string>();
              gatePool = rawAllItems.map((a: any) => {
                const n = normalizeLinkedinEngagementItem(a.raw ?? a, apifyInput.query);
                return {
                  ...a,
                  name: n.post_author_name ?? n.commenter_name ?? a.name,
                  title: n.post_author_title ?? a.title,
                  company: n.post_author_company ?? a.company,
                  source_url: n.post_url ?? a.source_url,
                  raw: { ...(a.raw ?? {}), _norm: n },
                };
              }).filter((a: any) => { const k = u(a.source_url); if (!k || seenU.has(k)) return false; seenU.add(k); return true; }) as typeof adaptive.accepted;
            } else if (isSerpCompany) {
              const seenU = new Set<string>();
              gatePool = rawAllItems.map((a: any) => {
                const c = sg.normalizeSerpCompanyItem({ title: a.raw?.title ?? a.title ?? a.name, url: a.raw?.url ?? a.source_url, displayedUrl: a.raw?.displayedUrl, description: a.raw?.description ?? a.raw?.snippet });
                if (!c) return null;
                return { ...a, name: c.company, company: c.company, source_url: c.website, raw: { ...(a.raw ?? {}), website: c.website, _serp: c } };
              }).filter((a: any): a is any => { if (!a) return false; const k = u(a.source_url); if (!k || seenU.has(k)) return false; seenU.add(k); return true; }) as typeof adaptive.accepted;
            }
            const back = (ok: Set<string>) => gatePool.filter((a: any) => ok.has(u(a.source_url)));

            const competitors: string[] = Array.isArray(tool_input_body?.competitors) ? (tool_input_body!.competitors as string[])
              : (threadedIntent?.competitors ?? reIntent?.competitors ?? []);
            const topics = sg.topicTokens(`${apifyInput.query ?? ""} ${criteria.industry ?? ""}`, []);
            // Category is a HARD reject only when we have a clean, SPECIFIC term.
            // extractLeadIntent emits generic placeholders like "Companies" for
            // target_company_type — using those as a category filter falsely
            // rejects every real row ("wrong company category"). Drop generics;
            // when nothing specific remains, rely on proof + role + dedupe (the
            // actor query already encodes the category, e.g. "recruiting agencies").
            const GENERIC_CAT = new Set(["companies", "company", "business", "businesses", "org", "orgs", "organization", "organizations", "organisation", "organisations", "people", "person", "leads", "prospects"]);
            const categoryTerms = [criteria.category, criteria.industry, ...(threadedIntent?.target_company_type ?? reIntent?.target_company_type ?? [])]
              .filter((c): c is string => !!c && !GENERIC_CAT.has(String(c).toLowerCase().trim()));

            if (gateKind === "people") {
              const roleKw = criteria.role ? roleAliases(criteria.role) : [];
              const res = sg.filterPeopleCandidates(
                gatePool.map((a: any) => ({ name: a.name, title: a.title, profile_url: a.source_url, company: a.company, company_category: a.raw?.industry, location: a.location, location_country: a.location_country, location_country_code: a.location_country_code })),
                { role_keywords: roleKw, company_category: categoryTerms, location: criteria.location, strict_location: strict.location },
              );
              lieTrace = res.trace as unknown as Array<Record<string, unknown>>;
              gateAcceptedItems = back(new Set(res.accepted.map((c) => u(c.profile_url))));
            } else if (gateKind === "company") {
              const res = sg.filterCompanyCandidates(
                gatePool.map((a: any) => ({ company: a.company ?? a.name, website: a.raw?.website ?? a.raw?.companyUrl ?? a.raw?.domain, source_url: a.source_url, category: a.raw?.category, industry: a.raw?.industry, location: a.location, profile_url: /linkedin\.com\/in\//i.test(String(a.source_url ?? "")) ? a.source_url : null })),
                { category: categoryTerms, geography: criteria.location, strict_geo: strict.location },
              );
              lieTrace = res.trace as unknown as Array<Record<string, unknown>>;
              gateAcceptedItems = back(new Set(res.accepted.map((c) => u(c.source_url))));
            } else if (gateKind === "posts") {
              const res = sg.filterPostCandidates(
                gatePool.map((a: any) => ({ post_url: a.source_url, author_name: a.raw?._norm?.post_author_name ?? a.name, author_profile_url: a.raw?._norm?.post_author_profile_url, snippet: (a.raw?._norm?.post_text ?? a.raw?.text ?? a.raw?.postText ?? a.raw?.content ?? a.title) })),
                { topics, keywords: competitors },
              );
              lieTrace = res.trace as unknown as Array<Record<string, unknown>>;
              gateAcceptedItems = back(new Set(res.accepted.map((c) => u(c.post_url))));
            } else if (gateKind === "comments") {
              const res = sg.filterCommentCandidates(
                gatePool.map((a: any) => ({ source_url: a.source_url, comment_text: (a.raw?._norm?.post_text ?? a.raw?.text ?? a.raw?.comment ?? a.raw?.commentText), commenter_name: a.raw?._norm?.commenter_name ?? a.raw?._norm?.post_author_name ?? a.name, commenter_profile_url: a.raw?._norm?.commenter_profile_url ?? a.raw?._norm?.post_author_profile_url, competitor_mentioned: (a.raw?._norm?.competitors?.[0] ?? a.raw?._norm?.post_text ?? "") })),
                { competitors, topics },
              );
              lieTrace = res.trace as unknown as Array<Record<string, unknown>>;
              gateAcceptedItems = back(new Set(res.accepted.map((c) => u(c.source_url))));
            } else if (gateKind === "workflow") {
              const res = sg.filterWorkflowCandidates(
                gatePool.map((a: any) => ({ workflow_title: a.title ?? a.name, source_url: a.source_url, source_author: a.name, tools_mentioned: a.raw?.tools_mentioned ?? a.raw?.tools, workflow_steps: a.raw?.workflow_steps ?? a.raw?.steps, snippet: (a.raw?._norm?.post_text ?? a.raw?.text ?? a.raw?.postText ?? a.raw?.content ?? a.title) })),
                { topics, tools: competitors },
              );
              lieTrace = res.trace as unknown as Array<Record<string, unknown>>;
              gateAcceptedItems = back(new Set(res.accepted.map((c) => u(c.source_url))));
            }
            if (gateAcceptedItems) console.log("[run-agent] LIE source gate", { gate_kind: gateKind, raw_source_type, source_type, before: gatePool.length, after: gateAcceptedItems.length });
          } catch (e) { console.warn("[run-agent] LIE source gate failed:", e); }
        }

        let effectiveAccepted = lieAcceptedItems ?? gateAcceptedItems ?? adaptive.accepted;
        let effectiveFound = (lieAcceptedItems ?? gateAcceptedItems) ? (lieAcceptedItems ?? gateAcceptedItems)!.length : adaptive.found;

        // ARTIFACT-TYPE PERSISTENCE GUARD (Section 10/11): the accepted artifact type
        // must match the requested entity's expected final artifact. A JobSignal can
        // NEVER become a person lead. If the selected actor's output type conflicts
        // with the immutable intent (e.g. a founder request that still landed on the
        // jobs actor), drop the accepted set so nothing mismatched persists.
        if (routingEntityIntent && !routingEntityIntent.clarification_required) {
          const acceptedArtifact = artifactTypeForActor(planned_actor_key ?? derivedActorKey)
            ?? (source_type === "people_profiles" ? "person_candidate"
              : (source_type === "jobs" || source_type === "hiring_signal") ? "job_signal"
              : "company_candidate");
          const wantArtifact = expectedArtifactType(routingEntityIntent.target_entity);
          if (acceptedArtifact !== wantArtifact) {
            console.warn("[run-agent] artifact-type mismatch — blocking persistence", { target_entity: routingEntityIntent.target_entity, want: wantArtifact, got: acceptedArtifact, source_type });
            routingConflict = routingConflict ?? { result_status: "routing_conflict", target_entity: routingEntityIntent.target_entity, selected_actor: String(planned_actor_key ?? derivedActorKey ?? ""), selected_actor_output_type: acceptedArtifact, expected_output_type: wantArtifact };
            // Clear EVERY accepted source so nothing mismatched reaches the provider
            // index, Aria hand-off, or persistence.
            lieAcceptedItems = [] as typeof lieAcceptedItems;
            gateAcceptedItems = [] as typeof gateAcceptedItems;
            effectiveAccepted = [] as typeof effectiveAccepted;
            effectiveFound = 0;
          }
        }

        // Run-level artifact type + person-target signal (Section 6/9): all accepted
        // items in one run come from one actor, so the artifact type is uniform.
        // Threaded into evidence scoring (person vs job semantics), the qualification
        // decision, and final provenance/artifact metadata.
        const runArtifactType: "person_candidate" | "company_candidate" | "job_signal" =
          (artifactTypeForActor(planned_actor_key ?? derivedActorKey)
            ?? (source_type === "people_profiles" ? "person_candidate"
              : (source_type === "jobs" || source_type === "hiring_signal") ? "job_signal"
              : "company_candidate")) as "person_candidate" | "company_candidate" | "job_signal";
        const runTargetIsPerson = runArtifactType === "person_candidate";
        // Resolve the SPECIFIC actor implementation once (Section 8). The initial
        // trusted provenance write must stamp the specific actor_id (e.g.
        // harvestapi/linkedin-profile-search), not the generic "apify" — otherwise
        // sealProvenance later rejects the correct value as an overwrite attempt.
        const runActorKey: string | null = planned_actor_key ?? derivedActorKey ?? null;
        const runActorImpl: string = (runActorKey && ACTOR_IMPL[runActorKey]) ? ACTOR_IMPL[runActorKey] : (runActorKey ?? "apify");

        // Source Quality Engine (Phase 6): honest raw vs accepted vs persisted
        // counts + reject reasons, surfaced in Workbench Insights + narrative.
        // Per-lead quality keyed by normalized company name, reused below to
        // persist fit_score + raw.lead_quality onto each Workbench row.
        const normName = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
        type LeadQualityEntry = { score: number; tier: string; why: string; matched_icp: string[]; missing_fields: string[]; confidence: string; reasons: string[]; exact_hiring_signal: string | null; job_title: string | null; source_url: string | null; source_proof: Record<string, unknown>; aria?: Record<string, unknown>; gate?: Record<string, unknown>; gate_rejected?: boolean; analyst?: Record<string, unknown>; scout_rank?: Record<string, unknown>; canonical?: Record<string, unknown> };
        // Run-level search provenance for the per-lead run-trace (search_stage /
        // relaxed_filters), derived from the adaptive attempt that produced the set.
        const runRelaxedFilters: string[] = [];
        if (adaptive.attempts.some((a) => /relax|broad|loosen/i.test(String(a.strategy)))) runRelaxedFilters.push("location");
        const runSearchStage = runRelaxedFilters.length ? "relaxed" : "strict";
        // Lead-quality proof gate (Phase 3): caps/rejects weak/proofless/off-ICP rows.
        const gateMod = await import("../_shared/leadQualityGate.ts").catch(() => null);
        const gateIntent = {
          isHiring: source_type === "jobs" || !!leadIntentBody?.role_family,
          roleQuery: `${criteria.role ?? ""} ${apifyInput.query ?? instruction ?? ""}`.trim(),
          disqualifiers: (leadIntentBody?.disqualifiers ?? ((brain as any)?.icp?.disqualifiers as string[]) ?? []) as string[],
        };
        const gateRejectedKeys = new Set<string>();
        // Aria scoring engine — Company-Brain-first explainable ranking. Built once
        // from the loaded Company Brain + the threaded ICP, applied per accepted row.
        const ariaMod = await import("../_shared/ariaScoring.ts").catch(() => null);
        const brainIcp = (brain as any)?.icp ?? {};
        const ariaBrain = {
          icp: {
            industries: (leadIntentBody?.positive_industries ?? leadIntentBody?.target_industry ?? brainIcp.industries) as string[] | undefined,
            company_size: (leadIntentBody?.target_company_size ?? [])[0] ?? brainIcp.company_size,
            geography: criteria.location ?? brainIcp.geography,
            buyer_roles: (leadIntentBody as any)?.buyer_roles ?? brainIcp.buyer_roles,
            funding_stage: (leadIntentBody as any)?.funding_stage ?? brainIcp.funding_stage,
            disqualifiers: leadIntentBody?.disqualifiers ?? brainIcp.disqualifiers,
            negative_industries: leadIntentBody?.negative_industries,
            allow_enterprise: leadIntentBody?.allow_enterprise ?? false,
          },
          positioning: (brain as any)?.positioning ?? undefined,
          competitors: (leadIntentBody as any)?.competitors ?? (brain as any)?.competitors ?? [],
        };
        const ariaWeights = ariaMod?.resolveWeights((tool_input_body?.aria_weights ?? null) as any);
        const leadQualityByName = new Map<string, LeadQualityEntry>();
        // People/posts/comments accounts are keyed by COMPANY name, but the
        // quality entry is keyed by the PERSON/post name — so also index by the
        // source URL (unique, present on every gated row) to attach proof reliably.
        const leadQualityByUrl = new Map<string, LeadQualityEntry>();
        const normUrl = (s: unknown) => String(s ?? "").toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "").trim();
        // Build the normalized, source-specific proof object Workbench + CSV read
        // (people / company / posts / comments / workflow). Only the gated set
        // reaches this, so a row with proof here is a row that passed the gate.
        const buildSourceProof = (kind: string | null, it: any, r: Record<string, unknown>): Record<string, unknown> => {
          const norm = (r._norm ?? {}) as Record<string, any>;
          const txt = (norm.post_text ?? r.text ?? r.postText ?? r.content ?? r.comment ?? r.commentText ?? "") as string;
          const snippet = typeof txt === "string" ? txt.slice(0, 500) : "";
          const authorUrl = (norm.post_author_profile_url ?? r.authorUrl ?? (r.author as any)?.url ?? r.author_profile_url ?? null) as string | null;
          switch (kind) {
            case "people":
              return { signal_source: "people", person_name: it.name ?? null, title: it.title ?? null, profile_url: it.source_url ?? null, company: it.company ?? null, location: it.location ?? null, source_provider: (r.source_provider ?? "linkedin") as string, next_action: "Review profile, then enrich for contact info" };
            case "company":
              return { signal_source: "company", company_name: it.company ?? it.name ?? null, website: (r.website ?? r.companyUrl ?? r.domain ?? null) as string | null, source_url: it.source_url ?? null, category: (r.category ?? r.industry ?? null) as string | null, location: it.location ?? null, next_action: "Review fit, then find decision-makers" };
            case "posts":
              return { signal_source: "posts", post_url: it.source_url ?? null, author_name: (norm.post_author_name ?? it.name ?? null), author_profile_url: authorUrl, post_snippet: snippet, topic: (norm.topic ?? r.topic ?? null) as string | null, why_it_matters: "Author is publicly discussing this topic — warm engagement opportunity", next_action: "Engage on the post or send a warm note" };
            case "comments":
              return { signal_source: "comments", source_url: it.source_url ?? null, comment_text: snippet, commenter_name: (norm.commenter_name ?? norm.post_author_name ?? it.name ?? null), commenter_profile_url: (norm.commenter_profile_url ?? authorUrl), competitor_mentioned: (norm.competitors?.[0] ?? r.competitor_mentioned ?? null) as string | null, intent_signal: "Engaging on competitor/topic thread", why_it_matters: "Commenter is actively evaluating this space", next_action: "Reply or send a warm DM referencing the thread" };
            case "workflow":
              return { signal_source: "workflow", workflow_title: it.title ?? it.name ?? null, source_url: it.source_url ?? null, tools_mentioned: (r.tools_mentioned ?? r.tools ?? null), workflow_steps: (r.workflow_steps ?? r.steps ?? null), why_it_matters: "Actionable workflow relevant to your use case", matched_use_case: (r.matched_use_case ?? null), next_action: "Review the workflow and adapt it" };
            default:
              return {};
          }
        };
        try {
          const { summarizeSourceQuality, classifyResults, topRejectReasons } = await import("../_shared/sourceQuality.ts");
          const { evaluateLeadQuality, buildWhyThisLead } = await import("../_shared/leadQuality.ts");
          const classified = classifyResults(rawAllItems, criteria, strict);
          // Section 3: normalized_count = every provider item converted into a
          // normalized candidate record the source gate evaluated (accepted +
          // rejected + duplicates). Section 4: build sanitized source-gate reject
          // diagnostics so a country-vs-locality decision is explainable per profile.
          runNormalizedCount = classified.accepted.length + classified.rejected.length + classified.duplicates.length;
          runSourceGateRejectedDiag = (classified.rejected ?? []).map((rj: any) => {
            const it = rj.item ?? {};
            const ev = extractCandidateLocationEvidence(it.raw ?? it);
            const reason = String(rj.reason ?? "");
            const isGeo = /country|city\/region|location/i.test(reason);
            return {
              normalized_candidate_id: it.raw?.normalized_candidate_id ?? null,
              name: it.name ?? it.company ?? null,
              title: it.title ?? null,
              company: it.company ?? null,
              source_url: it.source_url ?? it.raw?.profile_url ?? null,
              provider_verified: !!(it.source_url ?? it.raw?.profile_url),
              actor_key: runActorKey,
              actor_id: runActorImpl,
              artifact_type: runArtifactType,
              requested_geography_value: isGeo ? (sourceGateGeography.value || criteria.location || null) : null,
              requested_geography_type: isGeo ? sourceGateGeography.type : null,
              requested_country_code: isGeo ? (sourceGateGeography.country_code ?? null) : null,
              candidate_location_text: ev.text ?? it.location ?? null,
              candidate_country: ev.country ?? it.location_country ?? null,
              candidate_country_code: ev.country_code ?? it.location_country_code ?? null,
              candidate_region: ev.region ?? null,
              candidate_city: ev.city ?? null,
              matcher_mode: isGeo ? (sourceGateGeography.type === "region" ? "region" : sourceGateGeography.type === "city" ? "city" : sourceGateGeography.type === "country" ? "country" : "text_fallback") : null,
              source_gate_reason: reason,
              source_gate_reason_code: reason.toLowerCase().replace(/\s*\(strict\)\s*$/, "").replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""),
            };
          });

          // Claude-Code-level quality scoring of the accepted set, against
          // Company Brain + the user's request. Surfaced in Workbench Insights
          // (tier mix + why-samples); never fabricates fields.
          const brainLite = brain ? {
            icp: (brain as Record<string, unknown>).icp as Record<string, unknown> | undefined,
            gtm: (brain as Record<string, unknown>).gtm as Record<string, unknown> | undefined,
            positioning: (brain as Record<string, unknown>).positioning as Record<string, unknown> | undefined,
            company: (brain as Record<string, unknown>).company as Record<string, unknown> | undefined,
          } : null;
          const qReq = {
            // For hiring/company sourcing the requested industry is encoded in
            // the query string, so fall back to it when no explicit industry field.
            role: criteria.role, industry: criteria.industry ?? (strict.industry ? null : criteria.category), location: criteria.location,
            stage: criteria.stage, category: criteria.category,
            strict_location: strict.location, strict_industry: strict.industry, strict_stage: strict.stage,
          };
          const qStrictness = (strict.location || strict.industry || strict.stage) ? "strict" as const : "flexible" as const;
          const tierCounts: Record<string, number> = { hot: 0, qualified: 0, weak: 0, rejected: 0 };
          const whySamples: string[] = [];
          let scoreSum = 0;
          // Provenance: build the immutable provider index from the ACCEPTED
          // (normalized) provider items only, plus this run's provider context.
          // Read at the Scout→Aria hand-off + stamped onto each persisted lead.
          try {
            const acceptedForIndex = (((lieAcceptedItems ?? gateAcceptedItems) ?? classified.accepted) ?? []) as any[];
            providerIndexForHandoff = buildProviderIndexFromItems(acceptedForIndex.map((a: any) => ({
              company: a.company ?? a.name, name: a.name, person: a.name,
              source_url: a.source_url, url: a.source_url,
              company_linkedin_url: (a.raw?.company_linkedin_url ?? a.raw?.companyLinkedinUrl) as string | null,
              person_linkedin_url: /linkedin\.com\/in\//i.test(String(a.source_url ?? "")) ? a.source_url : ((a.raw?.profile_url ?? a.raw?.profileUrl) as string | null),
              website: (a.raw?.website ?? a.raw?.companyUrl) as string | null,
              domain: (a.raw?.domain) as string | null,
              job_url: (a.raw?.job_url ?? a.source_url) as string | null,
            })));
            // Provenance actor_id is the SPECIFIC actor implementation, not the
            // literal "apify" (Section 13): resolve from the actor key.
            providerProvenanceCtx = { provider: "apify", actor_key: runActorKey ?? undefined, actor_id: runActorImpl, artifact_type: runArtifactType, provider_run_id: run_id, workflow_run_id: run_id, plan_id: String(plan_id ?? ""), trace_id: run_id, query_id: null };
            // Section 10: hand the accepted provider PEOPLE to Aria directly.
            if (runTargetIsPerson) {
              personProviderCandidates = acceptedForIndex.map((a: any) => ({
                name: (a.name ?? null) as string | null,
                company: (a.company ?? null) as string | null,
                title: (a.title ?? a.raw?.title ?? null) as string | null,
                source_url: (a.source_url ?? a.raw?.profile_url ?? null) as string | null,
              }));
            }
          } catch (e) { console.warn("[run-agent] provider index build failed:", e); }
          for (const it of ((lieAcceptedItems ?? gateAcceptedItems) ?? classified.accepted)) {
            const r = (it.raw ?? {}) as Record<string, unknown>;
            const q = evaluateLeadQuality({
              lead: {
                name: it.name ?? it.company, company: it.company, title: it.title, location: it.location,
                website: (r.companyUrl ?? r.website ?? r.company_website ?? r.url) as string | undefined,
                industry: (r.industry ?? r.category) as string | undefined,
                team_size: (r.team_size ?? r.companySize ?? r.employees) as string | undefined,
                exact_signal: (r.exact_signal ?? r.jobTitle ?? r.positionName ?? r.title) as string | undefined,
                signal_type: source_type === "jobs" ? "hiring" : undefined,
                source_url: it.source_url,
              },
              companyBrain: brainLite,
              sourceType: criteria.source_type ?? source_type,
              userRequest: qReq,
              strictness: qStrictness,
            });
            tierCounts[q.tier] = (tierCounts[q.tier] ?? 0) + 1;
            scoreSum += q.score;
            if (whySamples.length < 3 && q.accepted) whySamples.push(`${(it.name ?? it.company ?? "Lead")}: ${buildWhyThisLead(q)}`);
            const entry: LeadQualityEntry = {
              score: q.score, tier: q.tier, why: buildWhyThisLead(q),
              matched_icp: q.matched_icp_fields, missing_fields: q.missing_fields,
              confidence: q.confidence, reasons: q.reasons,
              // Hiring-signal proof fields for Workbench rows + CSV export.
              exact_hiring_signal: (r.exact_signal ?? r.jobTitle ?? r.positionName ?? it.title ?? null) as string | null,
              job_title: (it.title ?? (r.jobTitle as string) ?? null) as string | null,
              source_url: (it.source_url ?? (r.source_url as string) ?? null) as string | null,
              // Source-specific proof for non-hiring sources (people/company/posts/
              // comments/workflow) — empty for hiring (its proof fields are above).
              source_proof: buildSourceProof(resolvedGateKind, it, r),
            };
            // Aria explainable score (Company-Brain-first) for Workbench + ranking.
            try {
              if (ariaMod) {
                const a = ariaMod.scoreCompany({
                  company: it.company ?? it.name, website: (r.companyUrl ?? r.website ?? r.company_website) as string | null,
                  linkedin: (r.linkedinUrl ?? r.linkedin) as string | null,
                  industry: (r.industry ?? r.category) as string | null, company_category: (r.category) as string | null,
                  team_size: (r.team_size ?? r.companySize ?? r.employees ?? r.employeeCount) as string | null,
                  location: it.location, founder: (r.founder ?? r.founderName) as string | null,
                  funding_stage: (r.funding_stage ?? r.fundingStage ?? r.stage) as string | null,
                  hiring_role: (it.title ?? r.jobTitle) as string | null, exact_signal: (r.exact_signal ?? r.jobTitle ?? it.title) as string | null,
                  growth_signals: (r.growth_signals ?? r.growth) as string | null, source_url: it.source_url, raw: r,
                }, ariaBrain as any, ariaWeights);
                entry.aria = {
                  overall_fit: a.overall_fit, breakdown: a.breakdown, max_breakdown: a.max_breakdown,
                  icp_match: a.icp_match, icp_match_count: a.icp_match_count,
                  confidence: a.confidence, competitor_similarity: a.competitor_similarity,
                  star_tier: a.star_tier, star_label: a.star_label,
                  why_accepted: a.why_accepted, missing_context: a.missing_context,
                };
                // Proof gate: cap Aria fit/confidence; hard reject overrides Aria;
                // never let proofless/off-ICP rows enter Workbench as strong leads.
                if (gateMod) {
                  const nc = gateMod.toNormalizedCandidate(it as any, source_type === "jobs" ? "hiring" : "company_search");
                  const gate = gateMod.applyLeadQualityGate(nc, gateIntent);
                  const cappedFit = Math.min(a.overall_fit, gate.scoreCaps.maxOverallFit ?? 100);
                  let confidence = a.confidence;
                  if (gate.scoreCaps.maxConfidence === "medium" && confidence.level === "high") confidence = { level: "medium", score: Math.min(confidence.score, 69) };
                  if (gate.scoreCaps.maxConfidence === "low") confidence = { level: "low", score: Math.min(confidence.score, 44) };
                  entry.aria = {
                    ...entry.aria,
                    overall_fit: cappedFit, confidence,
                    gate_decision: gate.decision,
                    gate_reasons: gate.reasons,
                    missing_evidence: gate.missingEvidence,
                    disqualifiers_hit: gate.disqualifiersHit,
                    // Aria explains the gate outcome alongside its own reasoning.
                    missing_context: [...new Set([...(a.missing_context ?? []), ...gate.missingEvidence])],
                  };
                  entry.gate = { decision: gate.decision, reasons: gate.reasons, missing_evidence: gate.missingEvidence, disqualifiers_hit: gate.disqualifiersHit, score_caps: gate.scoreCaps };
                  // Hard reject → keep OUT of Workbench (recorded for debugging only).
                  if (gate.decision === "reject") {
                    entry.gate_rejected = true;
                    const rk = normUrl(it.source_url ?? (r.source_url as string));
                    const rn = normName(it.name ?? it.company);
                    if (rk) gateRejectedKeys.add(`u:${rk}`);
                    if (rn) gateRejectedKeys.add(`n:${rn}`);
                  }
                }
              }
            } catch (e) { console.warn("[run-agent] aria/gate score failed:", e); }
            // Part E — analyst-style lead brief (why appeared / why now / evidence /
            // missing / next action). Uses only available evidence; Company-Brain ICP.
            try {
              const analystMod = await import("../_shared/leadAnalyst.ts").catch(() => null);
              if (analystMod && derivedIcp) {
                const uk0 = normUrl(it.source_url ?? (r.source_url as string));
                const pr = uk0 ? scoutRankByUrl.get(uk0) : undefined;
                const summary = analystMod.buildLeadAnalystSummary({
                  artifactType: runArtifactType,
                  candidate: {
                    company: it.company ?? it.name, website: (r.company_website ?? r.website) as string | null, domain: r.domain as string | null,
                    linkedinUrl: r.company_linkedin_url as string | null, jobTitle: (it.title ?? r.job_title) as string | null,
                    jobUrl: (r.job_url ?? it.source_url) as string | null, source_url: it.source_url,
                    industries: (r.industries ?? r.category) as string[] | string | null, companyDescription: r.company_description as string | null,
                    jobDescription: r.job_description as string | null, employeeCount: (r.employee_count ?? r.companyEmployeesCount) as number | null,
                    // Separate funding source only — never claim funding from post text (Part 4).
                    funding_proof_url: (r.funding_source_url ?? r.funding_proof_url) as string | null,
                  },
                  icp: derivedIcp as any,
                  gate: entry.gate ? { decision: (entry.gate as any).decision, disqualifiersHit: (entry.gate as any).disqualifiers_hit, missingEvidence: (entry.gate as any).missing_evidence } : null,
                  aria: entry.aria ? { overall_fit: (entry.aria as any).overall_fit, confidence: (entry.aria as any).confidence } : null,
                  preRank: pr ? { scoutPreRankScore: pr.scoutPreRankScore, weakPool: scoutWeakPool, scoutPenalties: pr.scoutPenalties, scoutRankReasons: pr.scoutRankReasons } : { weakPool: scoutWeakPool },
                  sourceProof: Array.isArray(r.source_proof) ? r.source_proof as any : null,
                });
                entry.analyst = summary as unknown as Record<string, unknown>;
                if (pr) entry.scout_rank = { rank: pr.scoutRank, score: pr.scoutPreRankScore, reasons: pr.scoutRankReasons, penalties: pr.scoutPenalties, weak_pool: scoutWeakPool };
              }
            } catch (e) { console.warn("[run-agent] analyst summary failed:", e); }
            // Phase A canonical stamp — derive the ONE canonical decision, the
            // contact-ready contract, an explainable score and a run-trace from the
            // facts computed above. Additive: never a provider call, never mutates
            // other fields; the persistence step writes it under new `raw` keys.
            try {
              const aria = entry.aria as Record<string, any> | undefined;
              const gate = entry.gate as Record<string, any> | undefined;
              const analyst = entry.analyst as Record<string, any> | undefined;
              const isPersonProfile = /linkedin\.com\/in\//i.test(String(it.source_url ?? ""));
              entry.canonical = buildCanonicalStamp({
                target_is_person: runTargetIsPerson,
                company: it.company ?? it.name ?? null,
                website: (r.company_website ?? r.website ?? r.companyUrl ?? r.domain ?? null) as string | null,
                source_url: it.source_url ?? (r.source_url as string) ?? null,
                job_title: (it.title ?? (r.jobTitle as string) ?? (r.job_title as string) ?? null) as string | null,
                requested_role_family: requestedRoleFamily,
                requested_signal: separatedIntent.requested_signal,
                source_strategy: sourceStrategy,
                exact_hiring_signal: entry.exact_hiring_signal,
                signal_type: source_type === "jobs" ? "hiring" : (resolvedGateKind ?? null),
                evidence_url: (r.job_url ?? r.funding_source_url ?? r.funding_proof_url ?? it.source_url ?? null) as string | null,
                evidence_recent: (r.evidence_recent === true) || (r.funding_recent === true),
                aria_overall_fit: typeof aria?.overall_fit === "number" ? aria.overall_fit : null,
                aria_confidence_score: typeof aria?.confidence?.score === "number" ? aria.confidence.score : null,
                matched_icp: q.matched_icp_fields ?? entry.matched_icp,
                missing_fields: entry.missing_fields,
                missing_evidence: (aria?.missing_evidence ?? gate?.missing_evidence) as string[] | undefined,
                gate_decision: (gate?.decision ?? aria?.gate_decision ?? null) as string | null,
                disqualifiers_hit: (aria?.disqualifiers_hit ?? gate?.disqualifiers_hit ?? null),
                decision_maker_profile_url: (r.decision_maker_profile_url ?? (isPersonProfile ? it.source_url : null)) as string | null,
                why_this_company: (analyst?.whyThisLeadAppeared ?? entry.why) as string | null,
                why_now: (analyst?.whyNow ?? null) as string | null,
                match_tier: (r.match_tier as string) ?? null,
                fit_tier: entry.tier,
                analyst_verdict: (analyst?.analystVerdict ?? null) as string | null,
                search_stage: runSearchStage,
                relaxed_filters: runRelaxedFilters,
              }) as unknown as Record<string, unknown>;
            } catch (e) { console.warn("[run-agent] canonical stamp failed:", e); }
            const nk = normName(it.name ?? it.company);
            if (nk) leadQualityByName.set(nk, entry);
            const uk = normUrl(it.source_url ?? (r.source_url as string));
            if (uk) leadQualityByUrl.set(uk, entry);
          }
          const lieEffectiveCount = (lieAcceptedItems ?? gateAcceptedItems) ? (lieAcceptedItems ?? gateAcceptedItems)!.length : classified.accepted.length;
          const leadQualitySummary = {
            tiers: tierCounts,
            avg_score: lieEffectiveCount ? Math.round(scoreSum / lieEffectiveCount) : 0,
            why_samples: whySamples,
          };
          // Merge the Lead-Intelligence role-family rejections into the reject
          // reason counts so the Workbench "rejected summary" is honest.
          const mergedRejectReasons: Record<string, number> = { ...classified.reject_reason_counts };
          if (lieTrace) {
            for (const t of lieTrace) {
              const rr = (t.rejected_reasons ?? {}) as Record<string, number>;
              for (const [k, v] of Object.entries(rr)) mergedRejectReasons[k] = (mergedRejectReasons[k] ?? 0) + (Number(v) || 0);
            }
          }
          const counts = summarizeSourceQuality({
            attempts: adaptive.attempts,
            accepted_count: effectiveFound,
            requested_count: max_results,
            duplicate_count: classified.duplicates.length,
            reject_reason_counts: mergedRejectReasons,
          });
          // Parts 3/5 — label the gate-accepted leads with match tiers + the
          // funding contract, and compute honest shortage counters. Additive: it
          // never overturns the proof gate's accept/reject decision. The tier +
          // funding fields are written onto each lead's raw so they persist.
          let tierMeta: Record<string, unknown> | null = null;
          if (scoutPlan && scoutPlanMod) {
            try {
              const reviewed = Number((counts as any).raw_result_count ?? rawAllItems.length);
              const tc = scoutPlanMod.tierAndCount(effectiveAccepted as any[], reviewed, scoutPlan.intent);
              (effectiveAccepted as any[]).forEach((it, i) => {
                const l = tc.labels[i]; if (!l || !it) return;
                it.raw = {
                  ...(it.raw ?? {}),
                  // Part 1/7 — stamp the run trace onto every lead so a row can
                  // always be traced back to the exact query that produced it.
                  run_id,
                  original_user_query,
                  provider_query_keywords: scoutPlan.primary.keywords,
                  provider_query_location: scoutPlan.primary.location,
                  intent_tier: l.match_tier === "reject" ? (it.raw?.intent_tier ?? null) : l.match_tier,
                  relaxation_step_used: (l.relaxations ?? []).join(", ") || null,
                  match_tier: l.match_tier,
                  funding_required: l.funding_required,
                  funding_proof_found: l.funding_proof_found,
                  funding_source_url: l.funding_source_url,
                  recruiter_proxy: (l as any).recruiter_proxy ?? false,
                  ...(l.missing_evidence?.length ? { missing_evidence: [...new Set([...(it.raw?.missing_evidence ?? []), ...l.missing_evidence])] } : {}),
                };
              });
              tierMeta = { ...tc.counters, tier_summary: tc.summary };
            } catch (e) { console.warn("[run-agent] tierAndCount failed:", e); }
          }
          sourceQualityMeta = {
            ...counts,
            // Part 1/7 — self-contained run trace (never reused across queries).
            run_id,
            original_user_query,
            run_started_at,
            top_reject_reasons: topRejectReasons(mergedRejectReasons),
            attempt_labels: adaptive.attempts.map((a) => a.strategy),
            needs_permission_to_broaden: !!adaptive.needs_permission_to_broaden,
            lead_quality: leadQualitySummary,
            ...(lieTrace ? { filter_trace: lieTrace } : {}),
            // Phase 4 — Scout query + QA cost transparency.
            ...(scoutQueryMeta ? { scout_query: scoutQueryMeta } : {}),
            ...(qaLimitReport ? { qa_limit: qaLimitReport } : {}),
            // Parts 3/5 — match tiers + shortage counters/reason.
            ...(tierMeta ? { match_tiers: tierMeta } : {}),
          };
          // Phase 5 — clean AI-employee activity timeline (no raw logs/provider noise).
          const plannerLabel = (sourcePlanMeta?.planner_mode === "claude") ? "Claude"
            : (sourcePlanMeta?.planner_mode === "gemini") ? "Gemini" : "deterministic rules";
          await supabase.from("activity_feed").insert([
            { workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started", title: `Scout created actor input with ${plannerLabel}`, body: String(sourcePlanMeta?.primary_query ?? ""), metadata: { step_index, task_id: task.id, source_planner: true } },
            { workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started", title: `Scout reviewed ${counts.raw_result_count} raw result${counts.raw_result_count === 1 ? "" : "s"}`, body: (tierMeta?.tier_summary as string) ?? `Accepted ${counts.accepted_count} qualified · rejected ${counts.rejected_count}`, metadata: { step_index, task_id: task.id, source_quality: true } },
          ]);
        } catch (e) { console.warn("[run-agent] source quality summary failed:", e); }

        const toolFailed = adaptive.status === "failed" && adaptive.attempts.some((a) => !!a.note);
        if (toolFailed && isApifySelected) {
          sourcingFailure = { error: adaptive.reason || "apify_failed", message: humanizeApifyError(adaptive.reason) };
        }
        // Proof gate: drop HARD-REJECTED candidates so they never enter Workbench
        // as opportunities (needs_verification rows are kept but capped/flagged).
        const gatedAccepted = gateRejectedKeys.size === 0 ? effectiveAccepted : effectiveAccepted.filter((a: any) => {
          const uk = normUrl(a.source_url ?? a.raw?.source_url);
          const nn = normName(a.name ?? a.company);
          return !((uk && gateRejectedKeys.has(`u:${uk}`)) || (nn && gateRejectedKeys.has(`n:${nn}`)));
        });
        if (gateRejectedKeys.size) console.log("[run-agent] proof gate dropped", { rejected: effectiveAccepted.length - gatedAccepted.length, kept: gatedAccepted.length });

        // QUALIFICATION PERSISTENCE GATE (Section 4/5): for a PERSON target, a
        // provider-backed profile must NOT become a final lead before it is
        // qualified. Persist ONLY candidates the canonical qualification decision
        // accepts (Aria-accepted + qualified tier + matching artifact, no hard
        // evidence violation); STAGE the rest in task metadata for review. Provider
        // provenance is necessary but never sufficient. Company/job flows keep
        // their existing behavior (this gate is scoped to the audited person path).
        const stagedForReview: Array<{ name: string | null; company: string | null; source_url: string | null; reason: string; tier: string | null; star_label: string | null }> = [];
        const lookupEntry = (a: any): LeadQualityEntry | undefined => {
          const uk = normUrl(a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url);
          const nn = normName(a.name ?? a.company);
          return (uk ? leadQualityByUrl.get(uk) : undefined) ?? (nn ? leadQualityByName.get(nn) : undefined);
        };
        // Records the qualification decision per candidate so both the persistence
        // filter and the observability diagnostics use the SAME verdict.
        const qualDecisionByKey = new Map<string, { persist: boolean; reason: string; evaluated: boolean }>();
        // SINGLE final-state authority: resolveFinalCandidateState decides persistence
        // AND the observability final state, so the two can never disagree. Computed
        // once at the persistence gate and reused in the diagnostics below.
        const finalStateByKey = new Map<string, FinalCandidateStateResult>();
        const candKey = (a: any): string => normUrl(a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url) || normName(a.name ?? a.company) || "";

        // ── Company enrichment (Phase 2, Section 10) ────────────────────────────
        // Sits BETWEEN deterministic scoring and the canonical persistence gate.
        // Enriches the ALREADY source-accepted people with VERIFIED firmographics
        // from the canonical company actor (apify_linkedin_company_details), then
        // lets the existing gate rerun its decision. Invoked ONCE per workflow.
        // Person provenance is preserved; company evidence is appended separately;
        // enrichment can only TIGHTEN (force-stage) — it never forces an accept.
        if (runTargetIsPerson && routingEntityIntent && !routingEntityIntent.clarification_required) {
          try {
            const enrichPeople = mapAcceptedPeople(effectiveAccepted as any[], {
              candidateId: (a) => candKey(a),
              preRankScore: (a) => { const e = lookupEntry(a); return typeof e?.score === "number" ? e.score : null; },
              isHardRejected: (a) => {
                if (gateRejectedKeys.size === 0) return false;
                const uk = normUrl(a.source_url ?? a.raw?.source_url);
                const nn = normName(a.name ?? a.company);
                return !!((uk && gateRejectedKeys.has(`u:${uk}`)) || (nn && gateRejectedKeys.has(`n:${nn}`)));
              },
            });
            const brainConstraints = {
              industries: (brainIcp.industries ?? null) as string[] | null,
              geography: (criteria.location ?? brainIcp.geography ?? null) as string | null,
              company_size: (brainIcp.company_size ?? null) as string | null,
            };
            const enrichment = await runFindLeadsCompanyEnrichment({
              people: enrichPeople,
              intent: routingEntityIntent,
              brain: brainConstraints,
              now: run_started_at ?? new Date().toISOString(),
              budget: { ...DEFAULT_EVIDENCE_BUDGET, finalAcceptedTarget: Math.max(1, Number(max_results) || DEFAULT_EVIDENCE_BUDGET.finalAcceptedTarget) },
              acceptedSoFar: 0,
              // Canonical Apify path; the actor identity is fixed INSIDE the adapter
              // (never from user/tool/planner/model). If the company actor env is
              // not configured this returns provider_error and candidates stage
              // honestly — it never fabricates evidence and never calls Firecrawl.
              execute: makeCompanyEnrichmentExecutor(runTool, baseCtx),
              workflowRunId: run_id, taskId: task.id, workspaceId: workspace_id,
              // Latency bound: stop launching new company calls once the deadline
              // is reached so qualification/persistence/observability still run.
              deadlineMs: enrichmentDeadlineFrom(invocationStartMs),
            });
            companyEnrichmentObservability = enrichment.observability;
            companyEnrichmentStaged = enrichment.stagedByEnrichment;
            enrichmentByCandidate = enrichment.perCandidate;
            if (enrichment.lateProviderCompletions.length) {
              // Audit only: the workflow already finalized these companies as timeouts.
              console.log("[run-agent] late provider completions ignored", {
                count: enrichment.lateProviderCompletions.length, status: "ignored_after_timeout",
              });
            }
            // Merge sanitized company firmographics onto each enriched candidate's
            // raw (append-only; never overwrites an existing value, never carries
            // phone/email/raw payload) so qualification + Workbench + CSV can read
            // website / industry / size / geography. Person provenance stays primary.
            for (const a of effectiveAccepted as any[]) {
              const patch = enrichment.companyPatchById.get(candKey(a)) as CompanyRawPatch | undefined;
              if (!patch) continue;
              const raw = (a.raw ?? (a.raw = {})) as Record<string, unknown>;
              const put = (k: string, v: unknown) => { if (v != null && (raw[k] == null || raw[k] === "")) raw[k] = v; };
              put("company_website", patch.company_website);
              put("company_industries", patch.company_industries);
              put("company_employee_count", patch.company_employee_count);
              put("company_employee_range", patch.company_employee_range);
              put("company_country", patch.company_country);
              put("company_country_code", patch.company_country_code);
              put("company_linkedin_url", patch.company_linkedin_url);
              // SEPARATE, verified company-evidence provenance — never replaces the
              // primary person provenance stamped elsewhere.
              raw.company_evidence_provenance = patch.company_evidence_provenance;
            }
            console.log("[run-agent] company enrichment", {
              considered: companyEnrichmentObservability.summary.candidates_considered,
              planned: companyEnrichmentObservability.summary.companies_planned,
              called: companyEnrichmentObservability.summary.companies_called,
              enriched: companyEnrichmentObservability.summary.companies_enriched,
              requalified: enrichment.requalifyCandidateIds.size,
              staged: companyEnrichmentStaged.size,
            });

            // ── Structured hiring-signal timing (Phase B) ──────────────────────
            // AFTER company enrichment: for candidates whose fit is settled but the
            // typed intent still requires timing, look up the canonical jobs source
            // ONCE per company, normalize verified GTM-hiring SignalEvents, and
            // assess timing. Shares the SAME finalization-reserve deadline. Timing
            // is fed to the EXISTING reducer/gate — it never force-accepts.
            try {
              const timingContract = compileEvidenceContract(routingEntityIntent, brainConstraints);
              const signalCandidates = buildSignalCandidates({
                items: effectiveAccepted as any[],
                candidateIdOf: (a) => candKey(a),
                sufficiencyByCandidate: enrichment.enrichment.sufficiencyAfter,
                hardBlockedIds: new Set(
                  (effectiveAccepted as any[]).filter((a) => {
                    if (gateRejectedKeys.size === 0) return false;
                    const uk = normUrl(a.source_url ?? a.raw?.source_url);
                    const nn = normName(a.name ?? a.company);
                    return !!((uk && gateRejectedKeys.has(`u:${uk}`)) || (nn && gateRejectedKeys.has(`n:${nn}`)));
                  }).map((a) => candKey(a)),
                ),
              });
              const signalRun = await runJobsSignalEnrichment({
                candidates: signalCandidates,
                contract: timingContract,
                workspace_id,
                now: run_started_at ?? new Date().toISOString(),
                execute: makeJobsSignalExecutor(runTool, baseCtx),
                deadlineMs: enrichmentDeadlineFrom(invocationStartMs),
                workflowRunId: run_id, taskId: task.id,
              });
              signalEnrichmentObservability = signalRun.observability;
              timingByCandidate = signalRun.timingByCandidate;
              for (const [id, t] of timingByCandidate) if (timingStagesCandidate(t)) signalTimingStaged.add(id);
              console.log("[run-agent] signal enrichment", {
                considered: signalEnrichmentObservability.summary.candidates_considered,
                called: signalEnrichmentObservability.summary.companies_called,
                enriched: signalEnrichmentObservability.summary.companies_enriched,
                timing_sufficient: signalEnrichmentObservability.summary.candidates_timing_sufficient,
                staged_timing: signalTimingStaged.size,
              });
            } catch (e) { console.warn("[run-agent] signal enrichment failed (non-fatal):", e); }
          } catch (e) { console.warn("[run-agent] company enrichment failed (non-fatal):", e); }
        }

        // RECONCILE the company-enrichment staging flag against the LATER signal stage.
        //
        // Company enrichment runs BEFORE jobs/signal enrichment and force-stages a
        // candidate whenever its post-company sufficiency is not yet `qualify_now` —
        // which includes a fit-COMPLETE founder whose only remaining gap is timing.
        // Signal enrichment then closes exactly that gap (`timing_sufficient`), but the
        // `companyEnrichmentStaged` set captured the pre-signal state, so passing it raw
        // left the reducer's timing-aware qualify_now permanently blocked (the v87
        // defect: 3 candidates timing_sufficient, 0 qualify_now).
        //
        // A candidate REMAINS staged-by-enrichment only when a genuine unresolved
        // enrichment requirement still exists after ALL enrichment stages. Timing being
        // resolved clears the flag ONLY when timing was the sole remaining gap — i.e.
        // fit is settled (post sufficiency is qualify_now / signal_enrichment). A
        // fit-incomplete candidate (structured_company_enrichment / targeted_web_
        // verification / incomplete identity) keeps a real gap and stays staged. The
        // reducer's own `fitVerified` guard enforces the same invariant independently.
        const remainsStagedByEnrichment = (key: string): boolean =>
          stillStagedByEnrichmentAfterTiming({
            companyStaged: companyEnrichmentStaged.has(key),
            sufficiencyDecisionAfter: enrichmentByCandidate.get(key)?.decisionAfter ?? null,
            timingDecision: timingByCandidate.get(key)?.decision ?? null,
          });

        let finalPersistSet = gatedAccepted;
        if (runTargetIsPerson) {
          finalPersistSet = gatedAccepted.filter((a: any) => {
            const key = candKey(a);
            const entry = lookupEntry(a);
            const aria = (entry?.aria ?? null) as AriaLike | null;
            const m = mapAriaToDecision(aria);
            const violations = (((entry?.canonical as any)?.run_trace?.evidence_violations)
              ?? ((entry?.canonical as any)?.evidence_violations) ?? []) as string[];
            // The Aria-accept path (provenance necessary, Aria accept + qualified
            // tier sufficient). This is ONE of two routes to qualify_now — the other
            // is the deterministic timing-aware path inside resolveFinalCandidateState.
            const ariaDecision = qualificationPersistenceDecision({
              targetEntity: routingEntityIntent?.target_entity ?? "person",
              candidateArtifactType: runArtifactType,
              // Provenance is separately ENFORCED at insert (enforce_provenance);
              // a genuine provider profile carries a person URL.
              providerVerified: !!(a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url),
              ariaEvaluated: m.evaluated,
              ariaDecision: m.decision,
              tier: entry?.tier ?? null,
              evidenceViolations: violations,
            });
            const post = enrichmentByCandidate.get(key);
            // ONE authority for persistence AND observability. Enrichment/timing
            // tightening + the deterministic timing-aware acceptance all live in the
            // reducer, so a fit-verified, timing_sufficient founder now reaches
            // qualify_now while a missing/contradicted one stages/rejects truthfully.
            const finalState = resolveFinalCandidateState({
              sourceGateDecision: (entry?.gate as any)?.decision ?? "needs_verification",
              providerVerified: !!(a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url),
              artifactMatches: true,   // gatedAccepted already dropped hard-rejected candidates
              hardEvidenceViolation: violations.find((v) => isHardEvidenceBlocker(v)) ?? null,
              sufficiencyDecision: post?.decisionAfter === "unknown" ? null : (post?.decisionAfter ?? null),
              missingCritical: post?.missingAfter ?? null,
              companyOutcome: post?.companyOutcome ?? null,
              ariaEvaluated: m.evaluated,
              persistDecision: { persist: ariaDecision.persist, reason: ariaDecision.reason },
              // Reconciled: a stage caused only by the now-satisfied timing gap no longer blocks.
              stagedByEnrichment: remainsStagedByEnrichment(key),
              timingDecision: timingByCandidate.get(key)?.decision ?? null,
            });
            finalStateByKey.set(key, finalState);
            qualDecisionByKey.set(key, { persist: finalState.persist, reason: finalState.reason_code, evaluated: m.evaluated });
            if (!finalState.persist) {
              stagedForReview.push({
                name: (a.name ?? null) as string | null,
                company: (a.company ?? null) as string | null,
                source_url: (a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url ?? null) as string | null,
                reason: finalState.reason_code,
                tier: entry?.tier ?? null,
                star_label: (aria?.star_label ?? null) as string | null,
              });
            }
            return finalState.persist;
          });
          console.log("[run-agent] qualification gate", { accepted: gatedAccepted.length, persisted: finalPersistSet.length, staged: stagedForReview.length });
          // Reflect honest persisted vs staged counts in the source-quality meta.
          if (sourceQualityMeta) {
            (sourceQualityMeta as Record<string, unknown>).persisted_count = finalPersistSet.length;
            (sourceQualityMeta as Record<string, unknown>).staged_count = stagedForReview.length;
            (sourceQualityMeta as Record<string, unknown>).staged_candidates = stagedForReview;
          }
        }

        // Candidate-decision observability (Sections 2-6): a reconciling funnel +
        // sanitized per-candidate diagnostics over the FULL source-gate-accepted set.
        // Additive only; the persistence decision above is unchanged. Aria receives
        // the accepted provider people only when the workflow proceeds (some persist).
        try {
          const persistedKeys = new Set(finalPersistSet.map((a: any) => candKey(a)));
          const willRunAria = finalPersistSet.length > 0;
          // ARIA SCREENING ≠ FINAL QUALIFICATION. Aria is handed the WHOLE
          // source-gate-accepted provider-backed person pool to screen/rank
          // (Section 10 pool alignment, see the handoff below) — not the subset that
          // ultimately qualifies. Telemetry must report the set the runtime actually
          // handed over, so it is derived from `personProviderCandidates` (the real
          // handoff set) and NEVER from `qualification_decision === qualify_now`.
          const ariaHandoffKeys = new Set<string>();
          for (const c of personProviderCandidates ?? []) {
            const u = normUrl(c.source_url); if (u) ariaHandoffKeys.add(`u:${u}`);
            const n = normName(c.name); if (n) ariaHandoffKeys.add(`n:${n}`);
          }
          const inAriaHandoff = (a: any): boolean => {
            if (!ariaHandoffKeys.size) return false;
            const u = normUrl(a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url);
            const n = normName(a.name);
            return (!!u && ariaHandoffKeys.has(`u:${u}`)) || (!!n && ariaHandoffKeys.has(`n:${n}`));
          };
          const diagnostics: CandidateDiagnosticInput[] = (effectiveAccepted as any[]).map((a: any) => {
            const key = candKey(a);
            const entry = lookupEntry(a);
            const sourceUrl = (a.source_url ?? a.raw?.source_url ?? a.raw?.profile_url ?? null) as string | null;
            const isHardRejected = gateRejectedKeys.size > 0 && (() => {
              const uk = normUrl(a.source_url ?? a.raw?.source_url);
              const nn = normName(a.name ?? a.company);
              return (uk && gateRejectedKeys.has(`u:${uk}`)) || (nn && gateRejectedKeys.has(`n:${nn}`));
            })();
            const violations = (((entry?.canonical as any)?.run_trace?.evidence_violations)
              ?? ((entry?.canonical as any)?.evidence_violations) ?? []) as string[];
            const evPresent: string[] = [];
            if (sourceUrl && /linkedin\.com\/in\//i.test(String(sourceUrl))) evPresent.push("linkedin person profile");
            else if (sourceUrl) evPresent.push("provider source url");
            if (a.raw?.website ?? a.raw?.companyUrl ?? a.raw?.domain) evPresent.push("company website");
            const decision = qualDecisionByKey.get(key);
            const persisted = persistedKeys.has(key);
            const gateDecision = isHardRejected ? "reject" : ((entry?.gate as any)?.decision ?? "needs_verification");
            // ONE canonical final state per candidate. Previously this collapsed every
            // non-persisted candidate to "reject", which double-counted staged people and
            // labelled company-fit-verified founders `qualification_threshold` while the
            // company observability recommended `signal_enrichment` for the same person.
            const post = enrichmentByCandidate.get(key);
            // Reuse the SAME final state the persistence gate computed (single
            // authority), so observability and finalPersistSet never diverge.
            // Hard-rejected candidates were never in the gate, so compute theirs.
            const finalState = runTargetIsPerson
              ? (finalStateByKey.get(key) ?? resolveFinalCandidateState({
                sourceGateDecision: gateDecision,
                providerVerified: !!sourceUrl,
                artifactMatches: !isHardRejected,
                hardEvidenceViolation: violations.find((v) => isHardEvidenceBlocker(v)) ?? null,
                sufficiencyDecision: post?.decisionAfter === "unknown" ? null : (post?.decisionAfter ?? null),
                missingCritical: post?.missingAfter ?? null,
                companyOutcome: post?.companyOutcome ?? null,
                ariaEvaluated: decision?.evaluated === true,
                persistDecision: { persist: persisted, reason: decision?.reason ?? "no_qualification" },
                // Same reconciliation as the persistence gate (single authority).
                stagedByEnrichment: remainsStagedByEnrichment(key),
                timingDecision: timingByCandidate.get(key)?.decision ?? null,
              }))
              // company/job targets: gate-accepted persist under the existing policy.
              : {
                state: "qualify_now" as const, stage_reason: null, rejection_class: null,
                next_action: null, reason_code: "source_gate_accepted",
                persist: true, sent_to_downstream_aria: true,
              };
            const qualification_decision = finalState.state === "qualify_now" ? "qualify_now"
              : finalState.state === "reject" ? "reject"
              : "stage_missing_evidence";
            // Authoritative post-enrichment gaps: a candidate that gained a verified
            // website/industry must no longer report them missing.
            const refreshedMissingRaw = refreshEvidenceMissing({
              staleMissingFields: (entry?.missing_fields ?? []) as string[],
              patch: (a.raw ?? null) as any,
              sufficiencyMissingAfter: post?.missingAfter ?? null,
            });
            // Verified sufficient timing CLOSES the timing gap: a timing_sufficient
            // candidate must not still report a signal category (e.g. job_signal) as
            // missing (the v86 `missing_timing_signal` artifact).
            const timingSufficient = timingByCandidate.get(key)?.decision === "timing_sufficient";
            const SIGNAL_MISSING = new Set(["job_signal", "funding_signal", "launch_signal", "expansion_signal", "founder_activity_signal", "gtm_signal"]);
            const refreshedMissing = timingSufficient
              ? refreshedMissingRaw.filter((c) => !SIGNAL_MISSING.has(c))
              : refreshedMissingRaw;
            return {
              normalized_candidate_id: a.raw?.normalized_candidate_id ?? (entry?.canonical as any)?.normalized_candidate_id ?? null,
              name: a.name ?? a.company ?? null,
              title: a.title ?? a.raw?.title ?? (entry as any)?.job_title ?? null,
              company: a.company ?? null,
              source_url: sourceUrl,
              provider_verified: !!sourceUrl,
              actor_key: runActorKey,
              actor_id: runActorImpl,
              artifact_type: runArtifactType,
              source_gate_decision: gateDecision,
              deterministic_score: typeof entry?.score === "number" ? entry!.score : ((entry?.aria as any)?.overall_fit ?? null),
              tier: entry?.tier ?? null,
              qualification_decision,
              qualification_reason: finalState.reason_code,
              stage_reason: finalState.stage_reason,
              next_action: finalState.next_action,
              matched_icp: entry?.matched_icp ?? null,
              evidence_present: evPresent,
              evidence_missing: refreshedMissing,
              evidence_violations: violations,
              persisted,
              // OBSERVED screening handoff — true when Aria runs for this workflow and
              // this candidate was in the pool actually handed over. A staged or
              // rejected candidate CAN be screened; being screened is not qualification
              // approval and never implies persistence.
              sent_to_downstream_aria: willRunAria && inAriaHandoff(a),
              // Persistence eligibility is a SEPARATE fact: only qualify_now may persist.
              persistence_eligible: finalState.persist === true,
            } as CandidateDiagnosticInput;
          });
          // Counters are DERIVED from the per-candidate final states, so the funnel and
          // the diagnostics can never disagree (they were computed independently before,
          // which is how staged and rejected both reported 5 for the same five people).
          const hardRejected = diagnostics.filter((d) => d.qualification_decision === "reject"
            && (d.source_gate_decision ?? "").toString().toLowerCase() === "reject").length;
          const qualAccepted = diagnostics.filter((d) => d.qualification_decision === "qualify_now").length;
          const qualStaged = diagnostics.filter((d) => d.qualification_decision === "stage_missing_evidence").length;
          const qualRejected = diagnostics.filter((d) => d.qualification_decision === "reject").length - hardRejected;
          // Section 3: normalized_count is the count of provider items converted to
          // normalized candidate records (accepted + rejected + duplicates at the
          // source gate); source_gate_rejected is everything normalized but not
          // source-accepted (rejected + duplicates + role-family filtered), so
          // normalized == source_gate_accepted + source_gate_rejected reconciles.
          const normalizedCount = Math.max(runNormalizedCount, (effectiveAccepted as any[]).length);
          const sourceGateRejected = Math.max(0, normalizedCount - (effectiveAccepted as any[]).length);
          qualificationObservability = buildQualificationObservability({
            funnel: {
              raw_count: rawAllItems.length,
              normalized_count: normalizedCount,
              source_gate_accepted: (effectiveAccepted as any[]).length,
              source_gate_rejected: sourceGateRejected,
              hard_gate_rejected: hardRejected,
              qualification_accepted: qualAccepted,
              qualification_staged: qualStaged,
              qualification_rejected: Math.max(0, qualRejected),
              persisted_count: finalPersistSet.length,
              // The ACTUAL Aria screening input size (the whole provider-backed pool),
              // never the qualify_now count: 5 screened / 2 qualified reports 5 here
              // and 2 in qualification_accepted + persisted_count.
              downstream_aria_count: willRunAria ? (personProviderCandidates?.length ?? 0) : 0,
            },
            candidates: diagnostics,
            source_gate_rejected: runSourceGateRejectedDiag as any,
            requested_limit: max_results,
            target_entity: routingEntityIntent?.target_entity,
            expected_artifact_type: runArtifactType,
          });
          if (sourceQualityMeta) {
            (sourceQualityMeta as Record<string, unknown>).qualification_observability = qualificationObservability;
            (sourceQualityMeta as Record<string, unknown>).company_enrichment_observability = companyEnrichmentObservability;
            (sourceQualityMeta as Record<string, unknown>).signal_enrichment_observability = signalEnrichmentObservability;
          }
        } catch (e) { console.warn("[run-agent] observability build failed:", e); }

        if (finalPersistSet.length > 0) {
          // Persist ONLY the qualification-accepted set (person) or the role-family-
          // filtered + gate-passing set (company/job) so wrong-role / no-proof /
          // off-ICP / unqualified rows never reach Workbench.
          const rawItems = finalPersistSet.map((a) => a.raw);
          const attachAccounts = Array.isArray(tool_input_body?.attach_to_accounts) ? tool_input_body.attach_to_accounts : null;

          if (attachAccounts && attachAccounts.length > 0) {
            // Contact discovery: ATTACH discovered decision-makers to existing
            // account rows (no new leads, no invented contacts) instead of creating.
            try {
              const { planContactAttachments } = await import("../_shared/contactDiscovery.ts");
              const plan = planContactAttachments(rawItems, attachAccounts as Array<{ lead_candidate_id: string; company: string; signal_role?: string | null }>);
              
              const candidateIds = attachAccounts.map((a: { lead_candidate_id: string | null }) => a.lead_candidate_id).filter(Boolean);
              if (candidateIds.length > 0) {
                await supabase.from("lead_candidates").update({ plan_id }).in("id", candidateIds);
              }

              for (const att of plan) {
                // Attach to the durable account when the employer is verified. This
                // contact-discovery path is scoped to the lead's company. The writer
                // never puts account_id in the insert; it sets it via a guarded
                // update only when verified, so an existing association is never
                // nulled or silently reassigned.
                await writeContactWithVerifiedAccount({
                  db: supabase as unknown as ContactPersistenceDb,
                  mode: "insert",
                  identity: { workspace_id, full_name: att.contact.name, title: att.contact.title, linkedin_url: att.contact.linkedin_url, email: att.contact.email },
                  rawBase: { source: att.contact.source, via: "contact_discovery", confidence: att.contact.confidence },
                  resolve: {
                    workspaceId: workspace_id,
                    leadCandidateId: att.lead_candidate_id,
                    contactLinkedInUrl: att.contact.linkedin_url ?? null,
                    provenance: { source: att.contact.source, via: "contact_discovery", confidence: att.contact.confidence, company_match: (att.contact as { company_match?: unknown }).company_match ?? null },
                    companyScopedSearch: true,
                  },
                  linkLeadCandidateId: att.lead_candidate_id,
                });
              }
              console.log("[run-agent] attached contacts:", plan.length);
            } catch (e) { console.warn("[run-agent] contact attach failed:", e); }
          } else {
            // Normal sourcing: persist ONCE with only the capped/deduped accepted
            // set, so DB lead_candidates/signals == accepted count.
            try {
              const { writeMemoryFromToolCall } = await import("../_shared/memoryWriter.ts");
              await writeMemoryFromToolCall({
                admin: supabase,
                workspace_id,
                plan_id,
                task_id: task.id,
                execution_mode: execution_mode_body,
                tool_call_id: null,
                tool_name: "source_with_apify",
                // Section 8/9: stamp the SPECIFIC actor + artifact type at the first
                // trusted provenance write so sealProvenance never later rejects the
                // correct actor_id as an overwrite, and artifact_type is preserved.
                selected_actor_key: runActorKey,
                // Provider provenance context — invalid provenance now BLOCKS the
                // lead_candidates insert (no verified=false ride-along).
                provider: "apify",
                actor_id: runActorImpl,
                actor_key: runActorKey,
                artifact_type: runArtifactType,
                provider_run_id: run_id,
                workflow_run_id: run_id,
                trace_id: run_id,
                enforce_provenance: true,
                lead_origin: "provider_sourced",
                provenance_rejections: provenanceRejections,
                output: { items: rawItems, total: rawItems.length, summary: `${effectiveFound}/${adaptive.requested} accepted across ${adaptive.attempts.length} attempt(s)` },
              });
              if (provenanceRejections.count > 0) {
                console.warn(`[run-agent] provenance guard blocked ${provenanceRejections.count} unproven lead insert(s):`, provenanceRejections.reasons);
              }
            } catch (e) { console.warn("[run-agent] capped persistence failed:", e); }

            // Phase 3 — persist per-row lead quality onto each Workbench row
            // (fit_score + raw.lead_quality), matched by company name. Uses an
            // existing jsonb column, so no migration. Never overwrites real data.
            try {
              const { data: rows } = await supabase
                .from("lead_candidates")
                .select("id, account_id, raw, fit_score")
                .eq("plan_id", plan_id);
              const acctIds = (rows ?? []).map((r) => (r as Record<string, unknown>).account_id).filter(Boolean) as string[];
              const nameById = new Map<string, string>();
              if (acctIds.length) {
                const { data: accts } = await supabase.from("accounts").select("id, name").in("id", acctIds);
                for (const a of accts ?? []) nameById.set((a as Record<string, unknown>).id as string, String((a as Record<string, unknown>).name ?? ""));
              }
              // Union missing-evidence (funding + analyst + gate) so the analyst
              // update never drops the funding gap ("recent funding proof").
              const { unionMissingEvidence } = await import("../_shared/leadMatchTier.ts");
              for (const row of rows ?? []) {
                const r = row as Record<string, unknown>;
                const existingRaw = (r.raw ?? {}) as Record<string, unknown>;
                // Match by source URL first (reliable for people/posts/comments,
                // whose account is the COMPANY not the person), then account name.
                let rowUrl = (existingRaw.source_url ?? existingRaw.url ?? existingRaw.linkedinUrl ?? existingRaw.publicProfileUrl ?? existingRaw.profileUrl ?? existingRaw.post_url ?? existingRaw.profile_url) as string | undefined;
                if (!rowUrl) { try { rowUrl = JSON.stringify(existingRaw).match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s"'\\]+/i)?.[0]; } catch { /* ignore */ } }
                const q = (rowUrl ? leadQualityByUrl.get(normUrl(rowUrl)) : undefined)
                  ?? leadQualityByName.get(normName(nameById.get(r.account_id as string) ?? ""));
                if (!q) continue;
                const aria = q.aria as Record<string, unknown> | undefined;
                // Company-Brain-first: Aria's overall_fit drives fit_score when available.
                const ariaFit = typeof aria?.overall_fit === "number" ? aria.overall_fit as number : null;
                await supabase.from("lead_candidates").update({
                  fit_score: ariaFit ?? (typeof r.fit_score === "number" ? r.fit_score : q.score),
                  raw: {
                    ...existingRaw,
                    lead_quality: { score: q.score, confidence: q.confidence, reasons: q.reasons },
                    fit_tier: q.tier,
                    why_this_lead: q.why,
                    matched_icp: q.matched_icp,
                    missing_fields: q.missing_fields,
                    // Hiring-signal proof for Workbench rows + CSV export.
                    job_title: q.job_title ?? (existingRaw.job_title as string) ?? null,
                    exact_hiring_signal: q.exact_hiring_signal ?? (existingRaw.exact_hiring_signal as string) ?? null,
                    source_url: q.source_url ?? (existingRaw.source_url as string) ?? null,
                    // Source-specific proof (people/company/posts/comments/workflow);
                    // never overwrites existing keys with null/empty.
                    ...Object.fromEntries(Object.entries(q.source_proof).filter(([, v]) => v != null && v !== "")),
                    // Aria explainable score for the premium Workbench analyst view.
                    ...(aria ? {
                      aria_score: aria,
                      overall_fit: aria.overall_fit,
                      icp_breakdown: aria.icp_match,
                      icp_match_count: aria.icp_match_count,
                      score_breakdown: aria.breakdown,
                      confidence_level: (aria.confidence as any)?.level,
                      confidence_score: (aria.confidence as any)?.score,
                      competitor_similarity: aria.competitor_similarity,
                      star_tier: aria.star_tier,
                      star_label: aria.star_label,
                      why_accepted: aria.why_accepted,
                      missing_context: aria.missing_context,
                      // Proof-gate outcome (Phase 3) for Workbench/CSV + debugging.
                      gate_decision: aria.gate_decision,
                      gate_reasons: aria.gate_reasons,
                      // Union with the funding/tier missing-evidence already on the
                      // row (never clobber "recent funding proof"); deduped.
                      missing_evidence: unionMissingEvidence(existingRaw.missing_evidence, aria.missing_evidence),
                      disqualifiers_hit: aria.disqualifiers_hit,
                      final_overall_fit: aria.overall_fit,
                    } : {}),
                    // Analyst lead brief (Part E) + Scout pre-rank (Part D) for the
                    // Workbench analyst view. Overrides the generic why with the
                    // evidence-based, Agentory-ICP-aware narrative.
                    ...(q.analyst ? {
                      analyst: q.analyst,
                      analyst_verdict: (q.analyst as any).analystVerdict,
                      why_this_lead: (q.analyst as any).whyThisLeadAppeared ?? q.why,
                      why_now: (q.analyst as any).whyNow,
                      icp_fit_summary: (q.analyst as any).icpFitSummary,
                      evidence_summary: (q.analyst as any).evidenceSummary,
                      risk_flags: (q.analyst as any).riskFlags,
                      recommended_next_action: (q.analyst as any).recommendedNextAction,
                      outreach_angle: (q.analyst as any).outreachAngle,
                      company_snapshot: (q.analyst as any).companySnapshot,
                    } : {}),
                    ...(q.scout_rank ? { scout_rank: (q.scout_rank as any).rank, scout_pre_rank_score: (q.scout_rank as any).score, scout_rank_reasons: (q.scout_rank as any).reasons, scout_penalties: (q.scout_rank as any).penalties, weak_pool: (q.scout_rank as any).weak_pool } : {}),
                    // Phase A canonical stamp — the ONE decision + contact-ready
                    // contract + explainable breakdown + run-trace the Workbench,
                    // counters, outreach eligibility and CSV export read. Additive;
                    // does not overwrite the Aria `score_breakdown` above.
                    ...(q.canonical ? {
                      canonical_final_decision: (q.canonical as any).canonical_final_decision,
                      contact_ready: (q.canonical as any).contact_ready,
                      contact_ready_missing: (q.canonical as any).contact_ready_missing,
                      role_exactness: (q.canonical as any).role_exactness,
                      canonical_score_breakdown: (q.canonical as any).score_breakdown,
                      canonical_final_score: (q.canonical as any).final_score,
                      canonical_confidence: (q.canonical as any).confidence,
                      canonical_score_explanation: (q.canonical as any).score_explanation,
                      canonical: q.canonical,
                      run_trace: (q.canonical as any).run_trace,
                      // Flat CSV columns for the Workbench export (item #2).
                      search_stage: (q.canonical as any).run_trace?.search_stage,
                      relaxed_filters: (q.canonical as any).run_trace?.relaxed_filters,
                    } : {}),
                    // Provider-provenance (immutable, from provider data only).
                    // This row IS provider-sourced (memoryWriter created it from an
                    // accepted provider item); stamp the traceable record + verified
                    // flag that draftGate/downstream actions read. verified=false
                    // means required provenance is missing → downstream actions block.
                    // Provenance immutability: a trusted block was stamped at
                    // insert time by memoryWriter. Aria/scoring/LLM output can NOT
                    // overwrite it — sealProvenance keeps the trusted block and
                    // flags any overwrite attempt. Score/confidence never override.
                    ...(() => {
                      const incoming = buildProvenanceRecord({
                        company: (existingRaw.company ?? existingRaw.company_name ?? nameById.get(r.account_id as string)) as string | null,
                        source_url: (existingRaw.source_url ?? existingRaw.url ?? rowUrl) as string | null,
                        domain: (existingRaw.domain ?? existingRaw.company_domain) as string | null,
                        company_linkedin_url: (existingRaw.company_linkedin_url) as string | null,
                        person_linkedin_url: (existingRaw.decision_maker_profile_url ?? existingRaw.person_linkedin_url ?? existingRaw.profile_url) as string | null,
                        evidence_url: (existingRaw.job_url ?? existingRaw.evidence_url ?? existingRaw.source_url) as string | null,
                        provider_item_id: (existingRaw.provider_job_id ?? existingRaw.provider_item_id) as string | null,
                        normalized_candidate_id: (existingRaw.normalized_candidate_id) as string | null,
                      }, providerProvenanceCtx ?? { plan_id: String(plan_id ?? "") });
                      const trusted = (existingRaw.provider_provenance ?? null) as Parameters<typeof sealProvenance>[0];
                      const sealed = sealProvenance(trusted, incoming);
                      return { provider_provenance: sealed.provenance, provenance_overwrite_attempt: sealed.provenance_overwrite_attempt };
                    })(),
                  },
                }).eq("id", r.id as string);
              }
            } catch (e) { console.warn("[run-agent] per-row quality persistence failed:", e); }
          }

          const lens = source_type === "jobs" ? "\n\nNOTE: These are companies/jobs hiring for the requested role, not individual people profiles." : "";
          const log = adaptive.attempts.map((a) => `Attempt ${a.n}: ${a.strategy} — ${a.accepted_count} accepted (total ${a.total_accepted})`).join("\n");
          apifyContext = `APIFY SOURCING (${effectiveFound}/${adaptive.requested} accepted across ${adaptive.attempts.length} attempt(s)):\nATTEMPTS:\n${log}${lens}\n\nITEMS (accepted, capped):\n${JSON.stringify(rawItems, null, 2).slice(0, 8000)}`;
        } else if (!toolFailed) {
          // Honest zero result — never pad the table with weak rows. Surface the
          // raw count reviewed + top reject reasons (from the gate trace) so the
          // user sees WHY nothing qualified.
          const topReasons = (sourceQualityMeta?.top_reject_reasons as Array<{ reason: string; count: number }> | undefined)
            ?? (Array.isArray(lieTrace)
              ? Object.entries(lieTrace.reduce((acc: Record<string, number>, t: any) => {
                  for (const [k, v] of Object.entries((t.rejected_reasons ?? {}) as Record<string, number>)) acc[k] = (acc[k] ?? 0) + (Number(v) || 0);
                  return acc;
                }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([reason, count]) => ({ reason, count }))
              : []);
          const reasonStr = topReasons.length ? ` Main reject reasons: ${topReasons.map((r) => r.reason).join(", ")}.` : "";
          // When provider people were sourced but held back by the qualification
          // gate, say so honestly (they are staged for review, not discarded).
          const stagedStr = stagedForReview.length
            ? ` ${stagedForReview.length} provider-backed profile${stagedForReview.length === 1 ? " was" : "s were"} sourced but staged for review (not qualified for persistence).`
            : "";
          toolNotices.push(`Scout reviewed ${rawAllItems.length} raw result${rawAllItems.length === 1 ? "" : "s"} but found 0 qualified matches. I did not fill the table with weak results.${stagedStr}${reasonStr}`);
          // Actor ran fine but accepted 0 qualified leads. Mark it so we skip
          // Aria (nothing to rank) and finalize as no_results below.
          if (isApifySelected) {
            zeroAcceptedSourcing = true;
            sourcingAttemptsCount = adaptive.attempts.length;
          }
        }
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
  if (isProviderSourcingStep && !apifyContext && !sourcingFailure && !zeroAcceptedSourcing) {
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
  if (sourcingFailure && !apifyContext) {
    const failMsg = `Scout could not run because ${sourcingFailure.message}.`;
    // Structured reason so a hard provider failure is machine-classifiable (and can
    // never be mistaken for a successful/"complete" run). No fabrication, no leads.
    const failReason: ProviderSourceReason = classifyProviderSourceOutcome({ errored: true }) ?? "provider_source_failed";
    await supabase.from("tasks").update({ status: "failed", error_message: sourcingFailure.error, result: { error: sourcingFailure.error, message: failMsg, result_status: "no_results", reason: failReason, qualified_count: 0, contact_ready_count: 0, persisted_lead_count: 0, provider_calls: 0, next_step: null, qualification_observability: qualificationObservability ?? undefined, company_enrichment_observability: companyEnrichmentObservability, signal_enrichment_observability: signalEnrichmentObservability } }).eq("id", task.id);
    await supabase.from("task_plans").update({ status: "failed" }).eq("id", plan_id);
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started",
      title: `${agent.name} could not source leads`, body: failMsg, metadata: { step_index, task_id: task.id, failed: true, error: sourcingFailure.error },
    });
    try {
      const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
      const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (conversationId) {
        const criteria = (tool_input_body?.query as string) ?? instruction;
        const card = {
          kind: "lead_sourcing_error",
          title: "Scout could not source leads",
          message: `${sourcingFailure.message[0].toUpperCase()}${sourcingFailure.message.slice(1)}, so Scout could not run the search. No leads were saved, no credits charged, and nothing was sent.`,
          source_type: (tool_input_body?.source_type as string) ?? null,
          criteria, count: typeof tool_input_body?.max_results === "number" ? tool_input_body.max_results : null,
          error: sourcingFailure.error,
          retry_command: instruction,
          lead_request: (tool_input_body && typeof tool_input_body === "object") ? tool_input_body : null,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: failMsg + " You can update the Apify token and retry, or pick a different lead source.",
          agent_slug: "scout",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "scout", workflow_step: "source_leads", status: "failed" },
        });
      }
    } catch (e) { console.warn("[run-agent] sourcing-error card failed:", e); }
    return json({ success: false, task_id: task.id, status: "failed", error: sourcingFailure.error });
  }

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
    const rawReviewed = Number((sourceQualityMeta as { raw_result_count?: number } | null)?.raw_result_count ?? 0);
    const rejReasons = Array.isArray((sourceQualityMeta as { top_reject_reasons?: string[] } | null)?.top_reject_reasons)
      ? (sourceQualityMeta as { top_reject_reasons: string[] }).top_reject_reasons.map((r) => r.replace(/\s*\(\d+\)$/, "")).join(", ")
      : "";
    const reasonTail = rejReasons ? ` Main reject reasons: ${rejReasons}.` : "";
    const scoutMsg = providerSourceReason
      ? `The lead source needed for this search isn't available right now, so I did not run it. I will never invent founders or companies, so no leads were saved, no credits charged, and nothing was sent.`
      : isContactDiscovery
      ? `I searched for decision-makers at ${acctN} account${acctN === 1 ? "" : "s"} but no verified contacts matched the account names closely enough. No contacts were attached.`
      : rawReviewed > 0
        ? `I reviewed ${rawReviewed} profile${rawReviewed === 1 ? "" : "s"}; 0 matched the requested persona and location closely enough.${reasonTail}`
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
        attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined,
        sourcing_attempts: sourcingAttemptAudit ?? undefined,
        lead_entity_intent: routingEntityIntent ?? undefined,
        routing: routingActorPlan ? { target_entity: routingActorPlan.target_entity, output_type: routingEntityIntent?.output_type, primary_actor: routingActorPlan.primary_identity_actor, routing_source: routingActorPlan.routing_source, execution_mode: routingActorPlan.execution_mode, company_first: routingActorPlan.company_first, company_gate_required: routingEntityIntent?.company_gate_required } : undefined,
        routing_conflict: routingConflict ?? undefined,
        // Section 5: surface the funnel + sanitized staged-candidate diagnostics so
        // an honest no_results explains WHY each provider candidate was held back.
        qualification_observability: qualificationObservability ?? undefined,
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
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: "no_qualified_matches", attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined },
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
    result: { output: apiText, tokens_in: tokensIn, tokens_out: tokensOut, attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined, sourcing_attempts: sourcingAttemptAudit ?? undefined, lead_entity_intent: routingEntityIntent ?? undefined, routing: routingActorPlan ? { target_entity: routingActorPlan.target_entity, output_type: routingEntityIntent?.output_type, primary_actor: routingActorPlan.primary_identity_actor, routing_source: routingActorPlan.routing_source, execution_mode: routingActorPlan.execution_mode, company_first: routingActorPlan.company_first, company_gate_required: routingEntityIntent?.company_gate_required } : undefined, source_plan: sourcePlanMeta ?? undefined, source_quality: sourceQualityMeta ?? undefined, qualification_observability: qualificationObservability ?? undefined, company_enrichment_observability: companyEnrichmentObservability, signal_enrichment_observability: signalEnrichmentObservability },
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
      if (personProviderCandidates && personProviderCandidates.length > 0) {
        handoffInput = JSON.stringify({ candidates: personProviderCandidates });
      } else if (guard.shouldStop) {
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

    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
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
      }),
    }).catch((e) => console.error("[run-agent] chain fetch failed:", e));

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
});
