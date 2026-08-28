// pilot-chat: the user-facing chat entry point.
// Decides whether to reply directly or delegate to the workforce via orchestrate.
// Input: { message, workspace_id, conversation_id? }
// Auth:  verify_jwt = true (user identity needed for conversations.user_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The client type this function actually holds.
 *
 * `ReturnType<typeof createClient>` looks like the obvious way to say this, but
 * it resolves the DECLARED generic defaults rather than the ones a call without
 * a `Database` type produces. In current supabase-js v2 typings those defaults
 * make the schema `never`, so every table resolved to `never` and every
 * `.insert({...})` failed to typecheck against a value of type `never` — while
 * the same call at runtime is completely fine.
 *
 * Spelling the permissive generics explicitly says what is true: this function
 * has no generated `Database` type, so its tables are untyped. The honest fix is
 * to generate and apply that type, which would make these calls genuinely
 * checked instead of merely accepted — recorded here as the real remedy.
 */
type UntypedClient = SupabaseClient<any, any, any>;
import { generateJson, generateText, logProviderCall } from "../_shared/aiProvider.ts";
import type { ToolInput } from "../_shared/toolInputPlanner.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import {
  recordUnderstanding, type UnderstandingWriter,
} from "../_shared/requestUnderstandingLog.ts";
import { understandRequest } from "../_shared/chatBrain.ts";
import { REQUEST_V1_VERSION } from "../_shared/requestV1.ts";
import {
  webSearchAvailable, SEARCH_WEB_UNAVAILABLE,
} from "../_shared/marketResearchSurface.ts";
import {
  planCompose, OUTREACH_WITHOUT_LEADS,
} from "../_shared/composeSurface.ts";
import {
  COMPETITORS_NEED_CONTEXT, PROFILE_POSTS_NEED_URLS,
} from "../_shared/signalSourcingSurface.ts";
import { shouldGateObjective } from "../_shared/companyBrainGate.ts";
import {
  failureMetadata, OUTCOME_CONTRACT_VERSION,
} from "../_shared/outcomeContract.ts";
import { buildMissionPreview } from "../_shared/missionPreview.ts";
import { assessRequestFeasibility } from "../_shared/requestFeasibility.ts";
import {
  asksForUnsafeAction, UNSAFE_REQUEST_REPLY,
} from "../_shared/unsafeRequestGuard.ts";
import {
  converseSystemPrompt, CONVERSE_UNAVAILABLE,
} from "../_shared/converseSurface.ts";
import { routeRequest, type Route } from "../_shared/objectiveRouter.ts";
import { bindRoute, type BindingOutcome } from "../_shared/chatBrainBinding.ts";
import {
  planRead, executeRead, renderReadAnswer, presentedCompanies, type ReadDb,
} from "../_shared/readSurface.ts";
import {
  resolveReferents, type ResolvedReferentBinding,
} from "../_shared/referentBinding.ts";
import {
  buildPresentedReferents, presentedFromIdentifier, requestHasBackReference,
  PRESENTED_REFERENTS_KEY,
} from "../_shared/referentPersistence.ts";
import { loadLatestReferents, type ReferentDb } from "../_shared/referentLookup.ts";
import { toBrainTurns, TURN_LOOKBACK } from "../_shared/conversationTurns.ts";
import {
  pendingClarification, clarificationOwnedBy,
} from "../_shared/clarificationContract.ts";
import {
  compileRequestMission, unrepresentedRequirements,
} from "../_shared/requestToMission.ts";
import {
  planMonitor, executeMonitor, type MonitorDb,
} from "../_shared/monitorSurface.ts";
import {
  heldEvidenceFor, renderHeldEvidence, type EvidenceDb,
} from "../_shared/researchEvidenceGate.ts";
import { loadConversationMemory, renderMemoryForPrompt, isFollowUpReference, extractTopN, type ConversationMemory } from "../_shared/memoryReader.ts";
import { shouldGateForOnboarding, ONBOARDING_GATE_REPLY } from "../_shared/companyBrainGate.ts";
import { isLeadIntakeRequest, hasNewSourcingIntent, isSaveExistingResultsRequest, extractLeadDetails, hasEnoughToRun, buildLeadSourceSelector, leadRequestToToolInput, leadRequestToInstruction, leadRequestToLinkedInFallbackInstruction, leadRequestToCompaniesInstruction, modeFromLabel, type LeadRequest, type LeadMode, type LeadSourceType, type ToolAvailability } from "../_shared/leadIntake.ts";
import { normalizeTerm } from "../_shared/inputNormalize.ts";
import { getSourceCapability } from "../_shared/sourceCapabilities.ts";
import { getActorByKey, isActorRuntimeEnabled } from "../_shared/actorRegistry.ts";
import { isFindContactsRequest, personaForAccounts, buildContactSearchQueries, contactDiscoveryFallback, resolveCompanyContactTarget, type AccountForContacts } from "../_shared/contactDiscovery.ts";
import { buildCompanyBrainContext, hasUsableBrain, brainCompetitors } from "../_shared/companyBrainContext.ts";
import { leadIntentFromMission, planJobsActorInput, type LeadIntent, type BrainLite } from "../_shared/leadIntent.ts";
import { roleFamilyAliases, type RoleFamily } from "../_shared/roleFamilies.ts";
import { routeQualifiedLead, qualifiedLeadRouteFromMission, normalizeCompanyVertical, inferCompanyStage, contractJobTitles } from "../_shared/qualifiedLeadRouting.ts";
import { inferFamilyKey, getJobFamily } from "../_shared/jobFamilyRegistry.ts";
import {
  mergeCompanyBrainIntoMission, parseLeadMissionDeterministic, type LeadMissionV1,
  effectiveRequestedCount, DEFAULT_REQUESTED_COUNT,
} from "../_shared/leadMission.ts";
import { buildCapabilityGraph } from "../_shared/leadCapabilityGraph.ts";
import { MissionCompilationBlockedError } from "../_shared/leadMissionCompiler.ts";
import { compileLeadMission } from "../_shared/leadMissionCompiler.ts";
import {
  runtimeIdentity, LEAD_INTELLIGENCE_CONTRACT_VERSION,
} from "../_shared/leadRuntimeIdentity.ts";
import {
  buildMissionCompilerBinding, MissionCompilationFailedError,
} from "../_shared/leadMissionCompilerBinding.ts";
import {
  createLedgerWriter, type LedgerDb, type LedgerWriter, ModelCallCollector,
} from "../_shared/executionLedger.ts";
import { getLeadIntelligenceCapabilities } from "../_shared/leadIntelligencePolicy.ts";
import { compileFirstProviderCall } from "../_shared/leadCapabilityEngine.ts";
import {
  buildPaidExecutionPreflight, preflightDryRun,
} from "../_shared/leadPaidExecutionPreflight.ts";


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...extra },
  });


const PILOT_SYSTEM_PROMPT = `You are Pilot, the orchestrator/router/planner of a five-agent AI workforce.
You are NOT a chatbot. Your job is to convert user intent into real work
delegated to the team, or to give a short conversational reply when there's
nothing to delegate.

THE TEAM:
  - Scout    — sourcing: candidates, leads, target companies, research collection
  - Aria     — screening: ranking, scoring, fit analysis
  - Penn     — outreach: personalized messages and email drafts (approval-gated sending)
  - Hawk     — intelligence: competitor/market signals, monitoring, scraping
  - Scribe   — content: posts, briefs, reports, summaries

DECISION RULES — default to DELEGATE for any work request. Only REPLY for:
  - Greetings, thanks, small talk
  - Capability questions ("what can you do?", "who's on the team?")
  - Direct clarification questions from the user

DELEGATE whenever the user asks for any of these (trigger words):
  A. Sourcing:      find, source, identify, discover, candidates, engineers, founders, leads, prospects, companies
  B. Extraction:    extract, scrape, analyze, summarize, pull data, from this URL/website/page
  C. Intelligence:  competitor, market, signals, today, latest, monitor, changed, funding, hiring, pricing, launches
  D. Outreach:      draft outreach, email, follow up, message, sequence, send
  E. Content:       write, post, linkedin, blog, brief, memo, report, summary
  F. Screening:     rank, screen, evaluate, score, shortlist, compare, fit
  G. Brief:         "brief me on today", daily brief

When DELEGATING, the "instruction" you forward must be a complete restated
work order. Preserve every concrete detail from the user — URL, count, role,
geography, criteria, recipient, timeframe.

Never claim live data was retrieved. The orchestrator and agents do the work.

Respond with ONLY a JSON object, no prose, no markdown fences:

For a reply:
{ "decision": "reply", "text": "<short reply, 1-3 sentences>" }

For a delegation:
{ "decision": "delegate", "instruction": "<complete restated work order>" }`;


type Msg = { role: "user" | "assistant"; content: string };

type Decision =
  | { decision: "reply"; text: string }
  | { decision: "delegate"; instruction: string };

function coerceDecision(obj: unknown): Decision | null {
  const o = obj as { decision?: string; text?: string; instruction?: string } | null;
  if (!o) return null;
  if (o.decision === "reply" && typeof o.text === "string" && o.text.length > 0) {
    return { decision: "reply", text: o.text };
  }
  if (o.decision === "delegate" && typeof o.instruction === "string" && o.instruction.length > 0) {
    return { decision: "delegate", instruction: o.instruction };
  }
  return null;
}

type UserIntent =
  | "workflow_request"
  | "question"
  | "smalltalk"
  | "edit_existing_result"
  | "approval_action"
  | "navigation_help"
  | "unknown";

async function classifyUserIntent(prompt: string, workspaceId: string): Promise<UserIntent> {
  const t = prompt.trim().toLowerCase();
  
  // 1. Check smalltalk via regex
  const GREETING_RE = /^\s*(hi|hello|hey|yo|sup|gm|good (morning|afternoon|evening)|thanks|thank you|ty|cool|nice|ok|okay|got it|cheers)[\s.!?]*$/i;
  if (GREETING_RE.test(t)) return "smalltalk";

  // 2. Check navigation help
  const NAV_RE = /\b(go to|open|show|navigate to)\s+(dashboard|workbench|workflows?|conversations?|settings?|brain)\b/i;
  if (NAV_RE.test(t)) return "navigation_help";

  // 3. Check approval action
  const APPROVAL_RE = /\b(approve|send|reject|cancel|review)\b.*\b(drafts?|outreach|emails?|messages?)\b/i;
  if (APPROVAL_RE.test(t) && !/\b(find|source|get)\b/i.test(t)) return "approval_action";

  // 4. Use LLM for precise classification
  const systemPrompt = `You classify the user's message into exactly one of these intents for a GTM AI Workforce platform:
- "workflow_request": The user wants to start or run business work (e.g. find leads, source companies, find decision-makers, enrich leads, audit a website, draft outreach, create content, analyze competitors, summarize results, export CSV, etc.).
- "question": The user is asking an informational or help question (e.g. "What can you do?", "How does Workbench work?", "Who is Scout?", "How do I setup Firecrawl?").
- "smalltalk": Greeting, thanking, or casual chit-chat (e.g. "hi", "thanks", "how are you").
- "edit_existing_result": Request to modify, filter, or change existing inputs/parameters (e.g. "change the count to 10", "make it USA strict").
- "approval_action": Action related to approving or sending drafted outreach.
- "navigation_help": Request to navigate to a page.
- "unknown": Anything else that doesn't fit the above.

Respond with ONLY a JSON object containing the "intent" key. Example: {"intent": "workflow_request"}`;

  try {
    const ai = await generateJson({
      taskType: "helper",
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 50,
      jsonMode: true,
      functionName: "classifyUserIntent",
      workspaceId,
    });
    if (ai.ok && ai.json) {
      const res = (ai.json as any).intent;
      const valid = ["workflow_request", "question", "smalltalk", "edit_existing_result", "approval_action", "navigation_help", "unknown"];
      if (valid.includes(res)) return res as UserIntent;
    }
  } catch (e) {
    console.error("classifyUserIntent failed:", e);
  }

  return "unknown";
}

// Human-readable label for a Lead Intelligence Engine role family.
function roleFamilyLabel(fam: RoleFamily): string {
  switch (fam) {
    case "assistant_founder_support": return "Assistant / Founder-Support";
    case "sales_operations": return "Sales / Revenue Operations";
    case "gtm_sales": return "GTM / Sales";
    case "marketing_growth": return "Marketing / Growth";
    case "engineering": return "Engineering";
    case "ops": return "Operations";
    case "finance": return "Finance";
    case "customer_success": return "Customer Success";
    default: return "Hiring";
  }
}

// Build the workflow-confirmation card for a HIRING intent from the Lead
// Intelligence Engine. The card SEPARATES the user's product, the target buyer,
// and the hiring role/industry — the product never becomes the industry and the
// persona is never a founder/growth title. `lead_intent` is threaded so run-agent
// can use planJobsActorInput + filterHiringCandidates without re-parsing.
/**
 * Build the canonical mission for a prompt.
 *
 * Deterministic interpretation of the user's own sentence, then the Company
 * Brain fills what the user left open. The Brain cannot widen what the user
 * closed — a "SaaS startups" request does not silently acquire the Brain's
 * "Recruiting Agencies" — and anything it wanted to add but could not is carried
 * back on the payload so the UI can offer it as an explicit choice.
 *
 * `required_capabilities` is filled from the graph the mission itself implies,
 * so the preview and run-agent cannot disagree about what will run.
 */
/**
 * The workspace ICP the compiler may show the model.
 *
 * Read from the Company Brain profile ONLY. It must never be derived from the
 * user's sentence: doing so hands a regex reading back to the model as though
 * it were configuration, and the model then agrees with it.
 */
export interface CompilerBrainContext {
  industries: string[];
  stages: string[];
  locations: string[];
}

function companyBrainContextForCompiler(brain: any): CompilerBrainContext {
  const icp = brain?.icp ?? {};
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : (typeof v === "string" && v.trim() ? [v.trim()] : []);
  return {
    industries: arr(icp.industries ?? icp.industry ?? icp.target_industry),
    stages: arr(icp.company_stage ?? icp.stages ?? icp.funding_stage),
    locations: arr(icp.geography ?? icp.locations ?? icp.location),
  };
}

function buildMissionForPrompt(
  prompt: string, requestedCount: number | null, brain: CompilerBrainContext,
  /**
   * The model's raw proposal, already fetched by the async caller.
   *
   * Threaded in rather than awaited here so this function — and
   * `buildHiringConfirmation` above it — stay synchronous. `undefined` means no
   * model ran, which `compileLeadMission` reads as "nothing proposed" and
   * answers deterministically.
   */
  gptProposal?: unknown,
): LeadMissionV1 & {
  brain_rejected_broadening: unknown[];
  preflight_dry_run: unknown;
  query_interpretation: unknown;
} {
  // ONE INTERPRETATION, HERE. The model proposes, `compileLeadMission`
  // validates and repairs, the Company Brain fills what is still open, and the
  // user's own words outrank both. Everything downstream reads the result.
  const compiled = compileLeadMission({
    originalUserQuery: prompt,
    proposal: gptProposal,
    companyBrain: brain,
    requestedCount,
  });
  const merged = mergeCompanyBrainIntoMission(compiled.final_mission, brain);
  const plan = buildCapabilityGraph(merged.mission);
  // THE DRY RUN THE USER APPROVES IS THE RECORD THAT GATES SPENDING.
  //
  // Built from the SAME `buildPaidExecutionPreflight` run-agent calls before its
  // first paid boundary, so the card cannot describe a plan the backend will
  // refuse — or, as on TEST task e8abeb8f-…-cfcbc6a416d4, a plan the backend
  // never even saw.
  const firstCall = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission: merged.mission,
    plan,
    firstProvider: firstCall.provider,
    firstProviderInput: firstCall.compiled?.ok ? firstCall.compiled.input : null,
    firstProviderCompileOk: firstCall.compiled ? firstCall.compiled.ok : undefined,
    firstProviderErrors: firstCall.compiled && !firstCall.compiled.ok ? firstCall.compiled.errors : [],
  });
  return {
    ...merged.mission,
    // ── WHICH BUILD COMPILED THIS, AND WHAT CONTRACT IT SPEAKS ────────────
    // Stamped here because this is where the mission is actually produced, and
    // carried ON the mission because that is the object that survives every hop
    // to run-agent. Without it, a stale planner and a fresh executor were
    // indistinguishable from a task row — which cost half a day on 2026-08-07.
    planner_runtime: runtimeIdentity("planner", "pilot-chat") as unknown as Record<string, unknown>,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION,
    // WHETHER THE MODEL ACTUALLY CONTRIBUTED. Carried from the compiler's own
    // `parser_source` rather than inferred from the presence of directives,
    // which the deterministic path also produces.
    mission_parser_source: compiled.parser_source,
    required_capabilities: plan.steps.map((s) => s.capability),
    prohibited_capabilities: plan.prohibited,
    brain_rejected_broadening: merged.rejected_broadening,
    preflight_dry_run: preflightDryRun(preflight),
    // ── OBSERVABILITY ──────────────────────────────────────────────────────
    // Enough to answer "why did it choose YC for this query?" and "why did it
    // run a job search?" without reading an Actor payload by hand. Structured
    // outputs and short reasons only — never the model's reasoning text.
    query_interpretation: {
      schema_version: compiled.schema_version,
      parser_source: compiled.parser_source,
      original_query: compiled.original_query,
      gpt_proposal: compiled.gpt_proposal,
      validator_changes: compiled.validator_changes,
      confidence: compiled.confidence,
      unknowns: compiled.unknowns,
      safety_violations: compiled.safety_violations,
      workspace_context: compiled.workspace_context,
      capability_plan: {
        requested: compiled.capability_decision.requested,
        approved: compiled.capability_decision.approved,
        rejected: compiled.capability_decision.rejected,
        offers: compiled.capability_decision.offers,
        entry_capability: plan.entry_capability,
        routing_reason: plan.routing_reason,
        steps: plan.steps.map((s) => ({
          capability: s.capability,
          providers: s.providers,
          reason: s.reason,
        })),
        offered_capabilities: plan.offered_capabilities,
        // The two questions the audit could not answer.
        paid_provider_work_required: plan.steps.some((s) => s.providers.length > 0),
        embedded_evidence_preferred:
          !plan.steps.some((s) => s.capability === "hiring_verification"),
      },
    },
  };
}

/**
 * THE PREVIEW CARD, DESCRIBED FROM THE MISSION.
 *
 * Every semantic field here used to come from `extractLeadIntent(prompt)`: the
 * role family, the persona, the industry, the geography, the stage, the count,
 * and — through `routeQualifiedLead(prompt)` — whether this was a qualified-lead
 * mission at all. So the card described a regex's reading of the sentence while
 * the run executed the Mission's reading of the same sentence, and nothing
 * compared them. The card is what the user APPROVES; a preview that describes a
 * different interpretation than the one that runs is the worst place of all for
 * a second opinion.
 *
 * `intent` is now a PROJECTION of the Mission (`leadIntentFromMission`), and the
 * Mission is compiled by the caller. The remaining deterministic work — alias
 * expansion, registry titles, canonical vertical/stage vocabulary — is display
 * and provider-input formatting over already-decided fields.
 */
function buildHiringConfirmation(
  prompt: string, mission: ReturnType<typeof buildMissionForPrompt>, company: any,
  brainLite?: BrainLite | null,
): any {
  const intent = leadIntentFromMission(mission, brainLite);
  const fam = intent.hiring_signal.role_family;
  const job = planJobsActorInput(intent);
  const roleDisplay = (job.role_keywords.length ? job.role_keywords : roleFamilyAliases(fam)).slice(0, 6).join(", ");
  const buyer = intent.target_buyer.join(", ");
  const industry = intent.target_industry.join(", ");
  const location = intent.target_geography[0] ?? company?.location ?? "USA";

  // THE ROUTE THE MISSION IMPLIES. This used to be `routeQualifiedLead(prompt)`
  // — a phrase table deciding, after compilation, whether the user had asked for
  // people to contact. The Mission states what the user asked to receive, so the
  // route is read off it.
  const route = qualifiedLeadRouteFromMission(mission);
  const isQualifiedLead = route.workflowKind === "qualified_lead_sourcing";
  // WHO to contact, as the Mission decided. The hard-coded founder set survives
  // only as the fallback for a mission that named no decision maker.
  const personRoles = isQualifiedLead
    ? (intent.target_buyer.length ? intent.target_buyer : ["Founder", "Co-Founder", "CEO"])
    : [];

  // The count is the Mission's; `effectiveRequestedCount` applies the single
  // runtime default when the request named no number.
  const requestedLeadCount = effectiveRequestedCount(mission);

  // The title says "hiring X" only when the Mission actually carries a hiring
  // signal. It used to say it unconditionally, because a card was only ever
  // built for a request a hiring regex had recognised; now that a lead request
  // with no hiring signal reaches this card too, `roleFamilyLabel(null)`
  // would have previewed the words "companies hiring Hiring".
  const hiringClause = intent.hiring_signal.requested
    ? ` hiring ${roleFamilyLabel(fam)}` : "";

  return {
    workflow_id: isQualifiedLead ? "find_qualified_leads" : "find_hiring_signal_accounts",
    workflow_name: isQualifiedLead
      ? `Find ${personRoles[0].toLowerCase()}s at ${industry || "target"} companies${hiringClause}`
      : (intent.hiring_signal.requested
        ? `Find ${roleFamilyLabel(fam)} hiring-signal accounts`
        : `Find ${industry || "target"} companies`),
    // ROUTE CONTRACT — the frontend renders from these, and run-agent routes on them.
    workflow_kind: route.workflowKind,
    execution_mode: route.executionMode,
    execution_mode_label: isQualifiedLead ? "Company-first qualified lead sourcing" : "Fast account sourcing",
    route_reason_codes: route.reasonCodes,
    // The ORIGINAL instruction stays authoritative; the generated title never
    // replaces it as the thing we execute.
    original_instruction: prompt,
    goal: prompt,
    agent_team: ["pilot", "scout", "aria"],
    inputs: {
      count: requestedLeadCount,
      count_entity: route.countEntity,
      quota_policy: route.quotaPolicy,
      source: "hiring signals",
      hiring_role: roleDisplay,
      decision_makers: personRoles,
      target_buyer: buyer,
      target_industry: industry, // never the user's product
      location,
      user_product: intent.user_product?.category, // shown as product, not industry
    },
    // THE CANONICAL MISSION, compiled above so the card's fields can be read
    // off it rather than re-derived beside it.
    lead_mission: mission,
    output: isQualifiedLead
      ? "Qualified company + verified decision-maker leads in Workbench"
      : "Account opportunities in Workbench",
    safety: "Nothing will be sent. Draft-only by default.",
    estimated_credits: Math.max(5, requestedLeadCount),
    // Structured contract carried through Start Workflow → orchestrate → run-agent.
    qualified_lead_contract: isQualifiedLead
      ? {
          workflow_kind: "qualified_lead_sourcing",
          execution_mode: "company_first",
          target_entity: "company_and_person",
          // The signal the MISSION carries. Hard-coded "hiring" was safe only
          // while a hiring regex gated the card into existence.
          signal_type: mission.required_signals?.[0]?.type ?? "hiring",
          job_family: fam,
          // The family's canonical titles — never widened into quota-carrying
          // sales roles for a Sales-Operations request. The backend registry wins
          // when it recognises the request, because the UI families are coarser
          // (gtm_sales leads with SDR/BDR, which is wrong for a first salesperson).
          // The registry is consulted with the terms the MISSION recorded, not
          // with the raw sentence: `inferFamilyKey([], [prompt, …])` scanned the
          // user's words a second time to pick a title set.
          job_titles: contractJobTitles(
            roleFamilyAliases(fam),
            getJobFamily(inferFamilyKey([], [
              ...(mission.required_signal_terms ?? []), ...job.role_keywords,
            ]))?.exact,
          ),
          // CANONICAL vocabulary, not whatever wording the industry string had:
          // the preview renders from this contract, so it must be stable. The
          // sources are the Mission's decided verticals and stages — `prompt`
          // used to be passed here as one more thing to pattern-match.
          company_vertical: normalizeCompanyVertical(industry, ...(intent.target_industry ?? [])),
          company_stage: inferCompanyStage(...(intent.company_stage ?? [])),
          geography: intent.target_geography?.length ? intent.target_geography : [location],
          requested_person_roles: personRoles,
          current_employer_required: true,
          requested_lead_count: requestedLeadCount,
          quota_policy: route.quotaPolicy,
          count_entity: route.countEntity,
          original_instruction: prompt,
        }
      : null,
    // Company-Brain transparency (Phase 11): what we target vs. exclude.
    target_company: icpTargetSummary(intent),
    excluded_company: icpExcludedSummary(intent),
    // Thread to run-agent: role family drives the jobs query; the full ICP block
    // drives the Company-Brain post-source filter (industry/size/type/negatives).
    lead_intent: {
      workflow_type: intent.workflow_type,
      source_type: intent.source_type,
      role_family: fam,
      role_keywords: job.role_keywords,
      exclude_role_keywords: job.exclude_keywords,
      target_geography: intent.target_geography,
      target_industry: intent.target_industry,
      count: intent.count,
      strictness: intent.strictness,
      ...icpLeadIntentBlock(intent),
    },
  };
}

// The Company-Brain ICP constraints threaded to run-agent (target company def).
function icpLeadIntentBlock(intent: LeadIntent): Record<string, unknown> {
  return {
    positive_industries: intent.positive_industries ?? intent.target_industry,
    negative_industries: intent.negative_industries ?? [],
    excluded_company_types: intent.excluded_company_types ?? [],
    preferred_company_types: intent.preferred_company_types ?? [],
    target_company_size: intent.target_company_size,
    disqualifiers: intent.disqualifiers,
    negative_keywords: intent.negative_keywords ?? [],
    positive_keywords: intent.positive_keywords ?? [],
    competitors: intent.competitors,
    allow_enterprise: intent.allow_enterprise ?? false,
  };
}
// Human-readable target / excluded chips for the confirmation card.
function icpTargetSummary(intent: LeadIntent): string[] {
  return [
    ...(intent.target_industry ?? []),
    ...(intent.target_company_size ?? []),
    ...(intent.target_geography ?? []),
    ...(intent.company_stage ?? []),
    ...(intent.preferred_company_types ?? []),
  ].filter(Boolean).slice(0, 8);
}
function icpExcludedSummary(intent: LeadIntent): string[] {
  const defaults = intent.allow_enterprise ? [] : ["Enterprise / Fortune 500"];
  const brainDefaults = (intent.positive_industries?.length || intent.target_industry?.length)
    ? ["Manufacturing", "Oil & Gas", "Banks", "Hospitals", "Government", "Universities"] : [];
  return [
    ...(intent.negative_industries ?? []),
    ...(intent.excluded_company_types ?? []),
    ...(intent.disqualifiers ?? []),
    ...defaults,
    ...brainDefaults,
  ].filter(Boolean).slice(0, 8);
}

// The Lead Intelligence Engine hiring intent threaded to run-agent, so the scout
// step receives role_family + aliases + excludes. PROJECTED FROM THE MISSION, not
// re-parsed: this used to call `extractLeadIntent(message)` at delegation time,
// which meant the run's role family came from a regex reading of the sentence
// while the Mission — compiled from the same sentence, in the same request —
// carried its own. Null when the Mission names no hiring role family, which is
// the same condition the regex version declined on.
function leadIntentForToolInput(mission: LeadMissionV1 | null, brain: any): any {
  if (!mission) return null;
  const intent = leadIntentFromMission(mission, {
    icp: brain?.icp, company: brain?.company,
    competitors: brain?.competitors, positioning: brain?.positioning,
  });
  if (!intent.hiring_signal.requested || !intent.hiring_signal.role_family) return null;
  const job = planJobsActorInput(intent);
  return {
    workflow_type: intent.workflow_type,
    source_type: intent.source_type,
    role_family: intent.hiring_signal.role_family,
    role_keywords: job.role_keywords,
    exclude_role_keywords: job.exclude_keywords,
    target_geography: intent.target_geography,
    target_industry: intent.target_industry,
    count: intent.count,
    strictness: intent.strictness,
    ...icpLeadIntentBlock(intent),
  };
}

/**
 * THE ONE PLACE A CANONICAL LEADMISSION IS COMPILED.
 *
 * Both the confirmation card and the Start request need this mission, and until
 * now only the card computed it — so the mission the user approved was
 * discarded and execution ran on `planToolInput()` output instead. Orchestrate
 * then manufactured a deterministic replacement, which is how task 1d73e23f
 * reached run-agent with confidence 0.6 and no directives.
 *
 * COMPILED SERVER-SIDE ON EACH REQUEST, NOT THREADED BACK FROM THE CARD.
 * `actionMetadata` is `body.metadata` — client-supplied — so carrying the
 * mission through it would let a caller define its own qualification contract,
 * broadening allowances and evidence requirements, i.e. exactly the fields that
 * decide what gets bought. Recompiling costs one model call and keeps the
 * mission a server fact.
 *
 * Returns null when the request carries no hiring signal, which is the same
 * condition under which the card path declines to build one.
 */
/**
 * What a caller must supply for model spend to be recorded.
 *
 * `correlationId` seeds the idempotency key so a replayed request does not
 * double-count. Deliberately explicit rather than read from ambient state: two
 * runs can share an isolate, and a misattributed cost row is worse than a
 * missing one.
 */
interface MissionLedgerContext {
  writer: LedgerWriter;
  taskId?: string | null;
  correlationId: string;
}

async function compileCanonicalLeadMission(i: {
  prompt: string;
  workspaceId: string;
  brain: any;
  /**
   * DEPRECATED AS A SEMANTIC INPUT — always null from the lead paths.
   *
   * It used to be `extractRequestedLeadCount(sentence)`, a regex reading handed
   * to `compileLeadMission` as `opts.requestedCount`, where it OVERRODE what the
   * model read. The count is a semantic field like any other: the Mission states
   * it, or states null, and execution applies `effectiveRequestedCount()`.
   */
  requestedCount: number | null;
  /**
   * Where this compilation's model spend is recorded.
   *
   * Optional. Absent, the call runs and logs exactly as before and only the
   * ledger row is missing — so a caller with no admin client is not a broken
   * caller. Present, every model call this stage makes lands in
   * `lead_execution_calls` under `record_kind = 'model_call'`, including the
   * ones that FAILED, which are the rows an outage is diagnosed from.
   */
  ledger?: MissionLedgerContext | null;
}): Promise<ReturnType<typeof buildMissionForPrompt> | null> {
  // ── NO REGEX MAY DECIDE WHETHER THE MODEL GETS TO READ THE SENTENCE ──────
  //
  // This used to begin with `extractLeadIntent(i.prompt)` and return null
  // unless it recognised a hiring signal WITH a role family. A regex therefore
  // decided whether the request reached the interpreter at all: "Find 5 AI
  // workflow companies in Europe" names no hiring signal, so it compiled no
  // mission, and everything downstream ran on the legacy carrier union instead.
  // GPT was authoritative only over requests a regex had already recognised.
  //
  // The gate was also redundant as ROUTING. All three callers are already on a
  // lead-sourcing branch — the submitted brief, the lead intake, and the
  // confirmed start — so "is this a lead request?" was answered before this
  // function was reached. Its only remaining effect was to suppress lead
  // requests whose shape the regex table did not happen to contain.
  //
  // Nothing replaces it. That is the point: a lead request now reaches the
  // compiler directly, and what the sentence means is the model's answer.
  const brainContext = companyBrainContextForCompiler(i.brain);

  // ── THE INTERPRETIVE MODEL CALL ──────────────────────────────────────────
  // Gated by flag AND workspace allow-list, and bounded at
  // MAX_COMPILATION_ATTEMPTS tries. Disabled, `proposeMission` is null and
  // `compileLeadMission` answers deterministically — correct for a workspace
  // that has deliberately not adopted the compiler, and refused below for one
  // that has.
  // COLLECT NOW, WRITE LATER. The sink is synchronous and cannot fail; the
  // drain below is awaited, so a row is never left to a floating promise that
  // the response can outrun.
  const modelCalls = new ModelCallCollector();
  const compilerBinding = buildMissionCompilerBinding({
    workspaceId: i.workspaceId,
    onModelCall: modelCalls.sink,
  });
  const gptProposal = compilerBinding.proposeMission
    ? await compilerBinding.proposeMission({
      originalUserQuery: i.prompt,
      // THE WORKSPACE PROFILE, AND ONLY THE WORKSPACE PROFILE.
      //
      // This used to be built from `extractLeadIntent`, whose target_geography
      // is `extractGeo(message)` UNIONED with the Brain's ICP geography. So a
      // regex reading of the user's sentence was handed to the model labelled
      // as workspace configuration — the regex got to influence the model's own
      // reading of the same sentence, under a name that hid it.
      companyBrain: brainContext,
      // No count hint from a regex either. The model reads the sentence; if it
      // names no number the model answers null, which the schema now permits.
      requestedCount: null,
    })
    : undefined;
  console.log("[pilot-chat][mission-compiler]", {
    workspace_id: i.workspaceId,
    ...compilerBinding.diagnostics,
    proposal_received: gptProposal != null,
    model_calls: modelCalls.length,
  });

  // DRAINED BEFORE ANY THROW BELOW. A compilation that fails is exactly the one
  // whose model rows matter — an outage with no ledger rows is indistinguishable
  // from a quiet period.
  if (i.ledger) {
    await modelCalls.drain(i.ledger.writer, {
      workspace_id: i.workspaceId,
      task_id: i.ledger.taskId ?? null,
      logical_call_key: `mission_compilation:${i.ledger.correlationId}`,
    });
  }

  // ── THE REFUSAL MOVED UPSTREAM, AND IS TRANSLATED HERE ──────────────────
  //
  // `compileLeadMission` now THROWS rather than returning a regex reading, so
  // the `deterministic_fallback` check below is unreachable in practice — kept
  // because it is a cheap invariant and an unreachable guard that costs nothing
  // is better than a removed one that used to matter.
  //
  // Translated into this function's existing error so every downstream handler,
  // status code and user message is unchanged.
  let mission: ReturnType<typeof buildMissionForPrompt>;
  try {
    mission = buildMissionForPrompt(i.prompt, i.requestedCount, brainContext, gptProposal);
  } catch (e) {
    if (e instanceof MissionCompilationBlockedError) {
      console.log("[pilot-chat][mission-compilation-blocked]", {
        workspace_id: i.workspaceId, reasons: e.reasons,
      });
      throw new MissionCompilationFailedError(i.workspaceId, "compilation_blocked");
    }
    throw e;
  }

  // ── NO SILENT REGEX SUBSTITUTION FOR A COMPILED-MISSION WORKSPACE ────────
  //
  // Every attempt failed, or the proposal was refused. For a workspace running
  // the compiled-mission architecture, `mission` at this point is a REGEX
  // READING of the sentence wearing the compiler's output shape — it validates,
  // it carries a mission_parser_source, and nothing downstream would have told
  // the user which reading it answered.
  //
  // That is the substitution the architectural rule forbids. Refuse instead.
  // This mirrors orchestrate's 422 `mission_not_compiled`; both exist because
  // the check has to happen wherever a mission is produced, not only where one
  // is transported.
  //
  // A workspace NOT in `new_architecture` mode is unaffected: there the
  // deterministic reading is the intended planner, not error recovery.
  // ── UNCONDITIONAL. THIS IS WHAT MAKES THE DETERMINISTIC READING UNREACHABLE.
  //
  // The guard used to fire only for a workspace in `new_architecture` mode —
  // which required all five intelligence flags, none of which were ever set. So
  // on every real run this check was skipped and the regex reading was returned
  // as the mission.
  //
  // There is now ONE interpretation path. `deterministic()` still exists inside
  // the compiler and is still used as the SCAFFOLD that a validated proposal is
  // overlaid onto — that part is structure, not interpretation, and removing it
  // would mean rewriting the validator for no gain. What it can no longer be is
  // the ANSWER: any mission that reaches here still carrying
  // `deterministic_fallback` means the model did not produce a usable reading,
  // and the run is refused rather than silently answered by a different
  // interpreter.
  if (mission.mission_parser_source === "deterministic_fallback") {
    // The legacy enablement reason is passed through unchanged — it is a closed
    // union, and the error class already states the part that matters: that no
    // deterministic mission was substituted and nothing was scheduled.
    // THE PROVIDER'S REASON, CARRIED. Without it a quota outage and a model
    // that misread the sentence raise the identical error, which is what made
    // 2026-08-21 take a manual API call to diagnose.
    throw new MissionCompilationFailedError(
      i.workspaceId, compilerBinding.enablement.reason,
      compilerBinding.lastModelFailure(),
    );
  }

  return mission;
}

/**
 * Strip the card-only decoration so the WIRE carries the canonical mission.
 *
 * `buildMissionForPrompt` returns the mission plus three fields that exist for
 * the preview card. They are not part of the mission contract and orchestrate
 * has no use for them.
 */
function canonicalMissionForTransport(
  m: ReturnType<typeof buildMissionForPrompt> | null,
): LeadMissionV1 | null {
  if (!m) return null;
  const {
    brain_rejected_broadening: _a, preflight_dry_run: _b, query_interpretation: _c,
    ...mission
  } = m;
  return mission as LeadMissionV1;
}

/**
 * Workflow categories whose confirmation card is a LEAD card.
 *
 * The classifier already decided this upstream, before any card is built, so the
 * lead branch reads a decided field. It is deliberately NOT a second question
 * asked of the sentence — which is what the removed
 * `lieIntent.hiring_signal.requested && role_family` gate was: a regex deciding
 * whether a lead request got a lead card, so "Find 5 AI workflow companies in
 * Europe" (no hiring words) fell through to the generic template.
 */
// `signal_sourcing` is deliberately NOT here: that branch is LinkedIn
// engagement/post sourcing, which executes through orchestrate's staged social
// plan and has no Mission provider yet (the Mission can SAY `social_posts`; R3
// owns discovery for it). Giving it a lead card would preview a run that does
// not exist.
const LEAD_CONFIRMATION_CATEGORIES = new Set([
  "company_hiring_sourcing", "people_sourcing",
]);

async function generateWorkflowConfirmation(
  prompt: string, workspaceId: string, admin: any, category: string,
): Promise<any> {
  const { data: cbRow } = await admin
    .from("company_brain")
    .select("profile")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const profile = cbRow?.profile ?? {};
  const company = profile?.company ?? {};
  const icp = profile?.icp ?? {};

  // The Company Brain, in the shape the LeadIntent projection reads its ICP
  // from. Never derived from the sentence — the card SEPARATES what the user
  // sells (user_product) from who they target (target_buyer) from the hiring
  // signal (role family), and every one of those now has a non-textual source:
  // the Brain for the first, the Mission for the rest.
  const cardBrainLite: BrainLite = {
    icp,
    company: { category: company?.category, industry: company?.industry },
    competitors: profile?.competitors ?? profile?.positioning?.competitors,
    positioning: profile?.positioning,
  };
  // Brain-only ICP context for the compiler. Derived from the Company Brain
  // profile, never from the sentence — see `companyBrainContextForCompiler`.
  const cardBrainContext = companyBrainContextForCompiler({ icp });
  if (LEAD_CONFIRMATION_CATEGORIES.has(category)) {
    // ── THE ONE INTERPRETIVE MODEL CALL, BEFORE ANYTHING IS PLANNED ────────
    //
    // Gated OFF by default; both a flag and a workspace allow-list must pass.
    // Disabled, `proposeMission` is null and the deterministic parser answers —
    // which is exactly what happens today, so this is inert until switched on.
    //
    // A model failure currently degrades the same way. That is MIGRATION-ERA
    // behaviour, not the design: the rule is retry, then an explicit compilation
    // failure, because a regex reading of the sentence answers a differently-read
    // request rather than a less precise version of the same one. Calling it "a
    // less precise mission, never a failed workflow" understated what changes.
    // See the doctrine block in _shared/leadMissionCompilerBinding.ts; R2 owns it.
    const compilerBinding = buildMissionCompilerBinding({ workspaceId });
    const gptProposal = compilerBinding.proposeMission
      ? await compilerBinding.proposeMission({
        originalUserQuery: prompt,
        // Brain-only, for the same reason as compileCanonicalLeadMission: a
        // regex reading of the sentence must not be handed to the model as
        // workspace configuration.
        companyBrain: cardBrainContext,
        requestedCount: null,
      })
      : undefined;
    console.log("[pilot-chat][mission-compiler]", {
      workspace_id: workspaceId,
      ...compilerBinding.diagnostics,
      proposal_received: gptProposal != null,
    });
    // THE MISSION IS COMPILED HERE AND THE CARD IS DESCRIBED FROM IT. Same
    // refusal rule as `compileCanonicalLeadMission`: a workspace running the
    // compiled-mission architecture may not be shown a card built from a
    // deterministic reading wearing the compiler's shape.
    let cardMission: ReturnType<typeof buildMissionForPrompt>;
    try {
      cardMission = buildMissionForPrompt(prompt, null, cardBrainContext, gptProposal);
    } catch (e) {
      if (e instanceof MissionCompilationBlockedError) {
        console.log("[pilot-chat][card-mission-compilation-blocked]", {
          workspace_id: workspaceId, reasons: e.reasons,
        });
        throw new MissionCompilationFailedError(workspaceId, "compilation_blocked");
      }
      throw e;
    }
    // UNCONDITIONAL, for the same reason as the canonical path above: the mode
    // gate required five flags nobody set, so a card built from a regex reading
    // was shown on every real run. The card is what the user approves before
    // money is spent, which makes an unverified reading here worse than one
    // deeper in the pipeline, not better.
    if (cardMission.mission_parser_source === "deterministic_fallback") {
      throw new MissionCompilationFailedError(
        workspaceId, compilerBinding.enablement.reason,
        compilerBinding.lastModelFailure(),
      );
    }
    return buildHiringConfirmation(prompt, cardMission, company, cardBrainLite);
  }

  // ── NO EXECUTABLE GRAPH, NO PRICED WORKFLOW ──────────────────────────────
  //
  // This branch used to ask a helper model to pick a "workflow" from a
  // seven-item menu written into its own prompt, each with
  // a hardcoded five-credit estimate on every option, and on model failure it returned
  // `find_hiring_signal_accounts` — a Lead workflow — whatever the user had
  // actually asked for. Nothing behind it compiled a mission, built a graph or
  // ran a preflight, so the card stated a price and a plan that no executable
  // object backed.
  //
  // Only `LEAD_CONFIRMATION_CATEGORIES` reaches the branch above, which is the
  // one that has a real graph. Everything else is handled conversationally by
  // orchestrate, and the honest card says so: what will happen, and that no
  // planned provider spend is attached to it. `planned_workflow: false` is the
  // flag the card reads to suppress the credits line rather than print a
  // number nobody computed.
  //
  // This is deliberately not a refusal. These requests still run; they simply
  // stop being described as costed workflows they never were. When Signals and
  // Content gain real objectives and graphs, they graduate into the branch
  // above and get a real preview with a real estimate.
  return {
    workflow_id: `assistant_${category}`,
    workflow_name: ASSISTANT_WORKFLOW_NAMES[category] ?? "Work on this request",
    goal: prompt,
    agent_team: ["pilot"],
    output: "Answered in chat, with anything produced saved where it belongs.",
    safety: "Nothing will be sent.",
    planned_workflow: false,
    estimated_credits: null,
    unplanned_reason:
      "This request is handled conversationally. There is no compiled plan " +
      "behind it yet, so no provider spend is scheduled or estimated.",
  };
}

/**
 * Honest names for the conversational categories.
 *
 * Deterministic, because a model picking a label from a menu is what produced
 * a Lead workflow name for a content request.
 */
const ASSISTANT_WORKFLOW_NAMES: Record<string, string> = {
  signal_sourcing: "Look at your signals",
  content_creation: "Work on content",
  market_research: "Research this",
  url_analysis: "Analyse this link",
  outreach: "Draft outreach",
};

// Short, natural Pilot reply shown ABOVE the compact workflow card. This is the
// "conversational handoff" — Pilot acknowledges the request and previews who
// will do what, in 2-3 sentences. Keyed on workflow_id with a graceful generic
// fallback built from the agent team so it stays consistent if the planner
// picks an unexpected workflow. Never promises to send anything.
function buildWorkflowHandoffMessage(confirmation: any): string {
  const id = String(confirmation?.workflow_id ?? "");
  switch (id) {
    case "find_hiring_signal_accounts":
      return "Got it — I'll turn this into a sourcing workflow.\n\nScout will look for account opportunities, Aria will rank the best matches, and I'll open the results in Workbench. Nothing will be sent.";
    case "find_decision_makers":
      return "Got it — I'll prepare the next step.\n\nScout will search for decision-makers at these accounts and attach only verified company-matched contacts. Nothing will be sent.";
    case "enrich_companies":
      return "Got it — I'll set up enrichment.\n\nHawk will gather company context and open the details in Workbench. Nothing will be sent.";
    case "draft_outreach":
      return "Got it — Penn can prepare drafts for your review.\n\nNothing will be sent automatically. Drafts will wait for your approval.";
    case "linkedin_post_from_signals":
      return "Got it — Scribe can draft this content.\n\nScribe will prepare post drafts for your review. Nothing will be posted.";
    case "website_audit":
      return "Got it — I'll set this up as a website audit.\n\nHawk will review the site, Aria will prioritize issues, and Scribe can summarize the recommendations.";
    case "competitor_snapshot":
      return "Got it — I'll set up a competitor snapshot.\n\nHawk will gather competitor signals and Aria will highlight what matters. Nothing will be sent.";
    default: {
      const team: string[] = Array.isArray(confirmation?.agent_team) ? confirmation.agent_team : [];
      const names = team.filter((s) => s && s !== "pilot").map((s) => s[0].toUpperCase() + s.slice(1));
      const who = names.length ? `${names.join(" and ")} will handle this` : "I'll handle this";
      const out = confirmation?.output ? ` and I'll open the results in Workbench` : "";
      return `Got it — I'll set up "${confirmation?.workflow_name ?? "this workflow"}".\n\n${who}${out}. Nothing will be sent.`;
    }
  }
}

async function showWorkflowConfirmation(
  message: string,
  conversationId: string,
  workspaceId: string,
  admin: any,
  baseMeta: any,
  category: string
): Promise<Response> {
  console.log("[pilot-chat] showWorkflowConfirmation: showing card", { category, message });
  const confirmation = await generateWorkflowConfirmation(message, workspaceId, admin, category);
  const confirmContent = buildWorkflowHandoffMessage(confirmation);
  const { data: saved } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: confirmContent,
      agent_slug: "pilot",
      model_used: "google/gemini-3-flash-preview",
      metadata: {
        ...baseMeta,
        type: "workflow_confirmation",
        workflow_confirmation: confirmation,
        prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
      },
    })
    .select("*")
    .single();
  return json({
    type: "reply",
    conversation_id: conversationId,
    workflow_category: category,
    workflow_confirmation: true,
    message: saved,
  });
}

// ---------- Delegation helper ----------

interface DelegateArgs {
  admin: UntypedClient;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  authHeader: string;
  conversationId: string;
  workspaceId: string;
  instruction: string;
  toolInput?: ToolInput | null;
  /**
   * The canonical compiled LeadMission for lead-sourcing requests.
   *
   * Optional because most delegate branches are not lead sourcing — content,
   * URL analysis, remembered-lead enrichment — and forcing a mission onto them
   * would invent semantics nobody asked for. Every branch that CAN reach
   * orchestrate with a lead-sourcing request must supply it; under
   * `new_architecture` orchestrate now refuses the request without one.
   */
  leadMission?: LeadMissionV1 | null;
  /**
   * WHICH branch produced `leadMission`, for the failure record.
   *
   * Four call sites supply a mission and three of them can supply null; the
   * failure message named none of them.
   */
  missionOrigin?: string;
  /**
   * THE IDENTITY SIDECAR, TRAVELLING BESIDE THE MISSION.
   *
   * Which real company each resolved referent meant. It cannot go inside
   * `leadMission`: `missionHash` is computed from the mission, so a new field
   * would change checkpoint identity for every run, and a binding carries the
   * URLs `scanProposalForViolations` refuses. So it rides as a sibling key and
   * `readPersistedBindings` reads it back at the engine.
   *
   * Absent for every request that names its own companies, which is most.
   */
  leadBindings?: readonly ResolvedReferentBinding[] | null;
  modelUsed: string;
  providerUsed: string;
  workflowInputs?: Record<string, any> | null;
}

async function delegateToOrchestrate(a: DelegateArgs): Promise<Response> {
  const toolInput = a.toolInput;
  if (toolInput && a.workflowInputs) {
    const inputs = a.workflowInputs;
    if (typeof inputs.count === "number") {
      toolInput.max_results = inputs.count;
    }
    if (typeof inputs.location === "string") {
      toolInput.location = inputs.location;
    }
    if (typeof inputs.industry === "string") {
      toolInput.query = inputs.industry;
    }
    if (typeof inputs.persona === "string") {
      toolInput.role_keywords = [inputs.persona];
    }
    if (typeof inputs.url === "string") {
      toolInput.query = inputs.url;
    }
  }

  const orchResponse = await fetch(`${a.SUPABASE_URL}/functions/v1/orchestrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: a.authHeader,
      apikey: a.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      user_instruction: a.instruction,
      workspace_id: a.workspaceId,
      // THE CANONICAL MISSION, TRANSPORTED — not rebuilt downstream. Its
      // absence here is the whole defect this fixes: the mission was compiled,
      // shown on the card, then dropped before execution, leaving
      // `planToolInput()` as the de facto planner.
      lead_mission: a.leadMission ?? null,
      // BESIDE THE MISSION, NEVER IN IT — see `leadBindings`. Sent at the top
      // level AND on `tool_input` below, because the two reach the plan step by
      // different routes depending on which planner branch runs, and a sidecar
      // that survives only one of them is a sidecar that silently vanishes.
      ...(a.leadBindings?.length
        ? { lead_referent_bindings: a.leadBindings }
        : {}),
      tool_input: a.leadBindings?.length
        ? { ...(toolInput ?? {}), lead_referent_bindings: a.leadBindings }
        : toolInput ?? null,
    }),
  });
  const orchBody = await orchResponse.json().catch(() => ({} as any));

  if (!orchResponse.ok) {
    console.error("[pilot-chat] orchestrate failed:", orchResponse.status, orchBody);
    // ── A DELEGATION FAILURE MUST SAY WHAT IT SENT ────────────────────────
    //
    // `mission_not_compiled` means orchestrate received no valid mission. This
    // handler reported only that word, with EMPTY metadata, so which of the
    // four delegate branches produced the null — and whether a mission was
    // sent at all — could not be recovered afterwards. One live Start failed
    // exactly this way and left nothing to diagnose from.
    //
    // The same lesson as `blocked_by` on the executor: a refusal that cannot
    // be read after the fact cannot be fixed. Recorded on the message rather
    // than only logged, because logs roll off and this one already had.
    const delegation = {
      orchestrate_status: orchResponse.status,
      orchestrate_error: orchBody?.error ?? null,
      orchestrate_details: typeof orchBody?.details === "string"
        ? orchBody.details.slice(0, 300) : null,
      mission_sent: a.leadMission != null,
      mission_origin: a.missionOrigin ?? "unspecified",
      mission_signals: Array.isArray(
          (a.leadMission as { required_signals?: Array<{ type?: string }> } | null)?.required_signals)
        ? (a.leadMission as { required_signals: Array<{ type?: string }> })
          .required_signals.map((x) => String(x?.type ?? "")).slice(0, 6)
        : null,
      tool_input_had_mission: (toolInput as { lead_mission?: unknown } | null)?.lead_mission != null,
      instruction_preview: String(a.instruction ?? "").slice(0, 160),
    };
    console.error("[pilot-chat][delegation-failed]", delegation);
    const errMsg = `I started building a plan but the orchestrator failed: ${orchBody?.error ?? "unknown"}`;
    const { data: saved } = await a.admin
      .from("messages")
      .insert({
        conversation_id: a.conversationId,
        role: "assistant",
        content: errMsg,
        agent_slug: "pilot",
        model_used: a.modelUsed,
        is_error: true,
        metadata: { delegation_failure: delegation },
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: a.conversationId, message: saved, error: `orchestrate ${orchResponse.status}` }, 502);
  }

  const planSummary: string = orchBody?.plan_summary ?? "(no summary)";
  const planId: string = orchBody?.task_plan_id ?? orchBody?.plan_id ?? "";
  const stepsCount: number = orchBody?.total_steps ?? orchBody?.steps_count ?? 0;
  const agents: string[] = Array.isArray(orchBody?.agents) ? orchBody.agents : [];
  const connectorsMissing: string[] = Array.isArray(orchBody?.connectors_missing) ? orchBody.connectors_missing : [];
  const planSteps: any[] = Array.isArray(orchBody?.plan?.steps) ? orchBody.plan.steps : [];
  const executionMode: string = orchBody?.execution_mode ?? a.toolInput?.execution_mode ?? "fast";

  const agentNames: Record<string, string> = { scout: "Scout", aria: "Aria", penn: "Penn", hawk: "Hawk", scribe: "Scribe" };
  const chain = planSteps.map((s) => `${agentNames[s.agent_slug] ?? s.agent_slug} will ${(s.task_title || "").toString().toLowerCase() || "work the step"}`).join(", ");

  const needsApproval = planSteps.some((s) => s.requires_approval && s.tool_needed === "send_email");
  const approvalNote = needsApproval ? " Penn will pause for your approval before sending." : "";
  const connectorNote = connectorsMissing.length ? ` Heads up: ${connectorsMissing.join(" ")} I'll continue with available tools.` : "";

  let modeNote = "";
  if (a.toolInput) {
    const intent = (a.toolInput as any)?.intent;
    const isContent = intent === "create_content" || intent === "content_creation";
    // Phase 1 patch: content workflows must NOT claim "I'll source signals and rank them".
    if (isContent) modeNote = " Scribe will draft the content. I'll ask for source context if needed.";
    else if (executionMode === "fast") modeNote = " (fast mode — I'll source signals and rank them; ask me to enrich or draft outreach next.)";
    else if (executionMode === "deep") modeNote = ` (deep mode — I'll enrich the top ${Math.min(5, a.toolInput.max_results)} after sourcing.)`;
    else if (executionMode === "outreach") modeNote = ` (outreach mode — I'll draft messages for the top ${Math.min(5, a.toolInput.max_results)}; nothing will be sent without your approval.)`;
  }

  const announce = stepsCount > 0
    ? `I created a ${stepsCount}-step plan: ${chain}.${approvalNote}${connectorNote}${modeNote}`
    : `On it. ${planSummary}`;

  const planTitle: string = (orchBody?.plan_title || planSummary || "Execution plan").toString().slice(0, 140);
  const announceMetadata = planId
    ? {
        type: "execution_plan",
        plan_id: planId,
        plan_title: planTitle,
        task_count: stepsCount,
        agents,
        connector_limitations: connectorsMissing,
        execution_mode: executionMode,
        tool_input: a.toolInput ?? null,
        prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
      }
    : {};

  const { data: announced } = await a.admin
    .from("messages")
    .insert({
      conversation_id: a.conversationId,
      role: "assistant",
      content: announce,
      agent_slug: "pilot",
      model_used: a.modelUsed,
      metadata: announceMetadata,
    })
    .select("*")
    .single();

  return json({
    type: "plan",
    conversation_id: a.conversationId,
    plan_id: planId,
    plan_title: planTitle,
    plan_summary: planSummary,
    steps_count: stepsCount,
    agents,
    connector_limitations: connectorsMissing,
    execution_mode: executionMode,
    message: announced,
  });
}

async function handlePilotChat(req: Request, fail: FailureContext): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log("[pilot-chat] people_actor_runtime", {
    apify_token: !!Deno.env.get("APIFY_API_TOKEN"),
    enable_people: Deno.env.get("APIFY_ENABLE_PEOPLE_SEARCH") ?? null,
    actor_override: Deno.env.get("APIFY_ACTOR_PEOPLE_SEARCH") ?? null,
  });


  // 1. JWT → user_id
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  // 2. Parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id : "";
  let conversationId: string | null = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  const actionSource: string | null = typeof body?.action_source === "string" ? body.action_source : null;
  const actionMetadata: Record<string, unknown> | null = body?.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : null;
  /**
   * `metadata.workflow_inputs`, accepted only if it is actually an object.
   *
   * This is CLIENT-SUPPLIED — see the note on `actionMetadata` above — so it is
   * `unknown`, and it was being handed to `delegateToOrchestrate` as though it
   * were a record. A cast would have silenced the compiler while still passing a
   * string, a number or an array straight through to the orchestrator as
   * "workflow inputs". Validating instead means a malformed value becomes null,
   * which every consumer already handles, rather than a shape nothing downstream
   * expects.
   */
  const actionWorkflowInputs: Record<string, any> | null =
    actionMetadata?.workflow_inputs &&
      typeof actionMetadata.workflow_inputs === "object" &&
      !Array.isArray(actionMetadata.workflow_inputs)
      ? actionMetadata.workflow_inputs as Record<string, any>
      : null;
  const isPreConfirmed = !!actionMetadata?.confirmed;

  if (!message || !workspaceId) {
    return json({ error: "message and workspace_id are required" }, 400);
  }

  // Card actions MUST carry the origin conversation_id. Refuse to silently
  // create a new conversation — that's the bug we're fixing.
  if (actionSource && !conversationId) {
    console.warn("[pilot-chat] card action missing conversation_id", { actionSource, workspaceId });
    return json({ error: "Action could not continue because conversation context was missing. Please retry." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // HANDED OVER THE MOMENT IT EXISTS. The catch at the bottom of this file can
  // only answer in the conversation if it has these two, and it is reached from
  // anywhere below — so they are given away early rather than at the end.
  fail.admin = admin;

  // ── WHERE MODEL SPEND GETS RECORDED ─────────────────────────────────────
  //
  // Built once, here, because this is the first point at which the admin client
  // exists — the same reason `fail.admin` is handed over on this line. Every
  // mission compilation below shares it, so a request's model rows carry one
  // correlation id and a replay cannot double-count them.
  const missionLedger: MissionLedgerContext = {
    writer: createLedgerWriter(admin as unknown as LedgerDb),
    correlationId: crypto.randomUUID(),
  };

  // 3. Membership check via workspace_members
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!member) return json({ error: "Forbidden — not a member of this workspace" }, 403);

  // 4. Get or create conversation (conversations table is user-scoped; no workspace_id column)
  if (conversationId) {
    const { data: existing } = await admin
      .from("conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!existing || existing.user_id !== userId) {
      return json({ error: "Conversation not found or not yours" }, 404);
    }
  } else {
    const { data: created, error: convErr } = await admin
      .from("conversations")
      .insert({
        user_id: userId,
        agent_slug: "pilot",
        channel: "dashboard",
        title: message.slice(0, 60),
        status: "active",
      })
      .select("id")
      .single();
    if (convErr || !created) {
      console.error("[pilot-chat] create conversation failed:", convErr);
      return json({ error: "failed to create conversation", detail: convErr?.message ?? convErr }, 500);
    }
    conversationId = created.id;
  }

  // NARROWED BY A REAL CHECK, NOT A CAST.
  //
  // Both branches above are meant to leave a conversation id: one validated the
  // supplied one, the other created a row and read its id back. The compiler
  // cannot see that, and the usual fix — asserting non-null — would hide the
  // case that actually matters: an insert that returns a row whose `id` is
  // missing. That would persist `conversation_id: null` on every message of the
  // turn, producing messages attached to no conversation, invisible to the
  // history query and impossible to attribute afterwards.
  //
  // Failing loudly here costs one request; the silent version costs the
  // conversation.
  if (!conversationId) {
    console.error("[pilot-chat] no conversation id after resolve/create");
    return json({ error: "failed to resolve conversation" }, 500);
  }
  const conversation_id: string = conversationId;
  fail.conversationId = conversation_id;

  // 5. Persist user message (carries card-action metadata when applicable)
  //
  // ── `{}`, NOT `null` ────────────────────────────────────────────────────
  //
  // `messages.metadata` is NOT NULL DEFAULT '{}'. A default only applies when
  // the column is OMITTED, so sending an explicit null is not "take the
  // default" — it is a constraint violation, and every plainly typed message
  // took this branch.
  //
  // AND IT FAILED IN SILENCE, which is why it survived. The insert's error was
  // never read, so pilot-chat carried on, answered "Got it — I'll turn this
  // into a sourcing workflow", and produced no plan and no task. The user saw a
  // reply and nothing else happened. Observed 2026-08-20 09:46:04Z:
  // `null value in column "metadata" of relation "messages" violates not-null
  // constraint`, on a 400 that nothing in the request path reported.
  //
  // So the fix is both halves: send a value the column accepts, and refuse to
  // continue quietly when the turn was not recorded. A conversation missing its
  // user turn cannot be classified, cannot be resumed, and cannot be audited.
  const { data: insertedUserMessage, error: userMessageError } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
      metadata: actionSource
        ? { action_source: actionSource, ...(actionMetadata ?? {}) }
        : {},
    })
    // THE ID IS READ, NOT DECORATION. The prior turns are loaded below to give
    // Chat Brain something to point back at, and this row IS the current
    // message — including it would show the model its own utterance twice, once
    // as history and once as the thing to understand.
    .select("id")
    .single();
  if (userMessageError) {
    console.error("[pilot-chat] user message insert failed", {
      conversation_id: conversationId,
      code: userMessageError.code,
      message: userMessageError.message,
      details: userMessageError.details,
    });
    return json({
      error: "failed to record your message",
      detail: userMessageError.message,
    }, 500);
  }

  // 5a. Resolve pending clarification (people-vs-companies) BEFORE classifying intent.
  // Look at the most recent assistant message in this conversation.
  {
    const { data: lastAssistant } = await admin
      .from("messages")
      .select("id, metadata")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const meta: any = lastAssistant?.metadata ?? null;
    // ── ONLY THIS RESOLVER'S OWN QUESTIONS ──────────────────────────────
    //
    // This read a bare `pending_clarification === true` written by five
    // different sites, so it claimed turns belonging to workflows the user had
    // never entered — Chat Brain asked which company was meant, and this
    // answered with "individual profiles or companies hiring", then re-armed
    // the flag. A question nobody claims now falls through to normal
    // understanding, which is the correct default and was unreachable before.
    if (meta && clarificationOwnedBy(meta, "lead_source_selector")) {
      const reply = message.toLowerCase();
      const peopleRe = /\b(individual|individuals|profiles?|people|candidates?|persons?|linkedin profiles?|engineers? to hire|hire (someone|engineers?|developers?))\b/i;
      const companiesRe = /\b(compan(?:y|ies)|hiring|jobs?|roles?|openings?|careers?|recruit)\b/i;
      const agencyRe = /\b(agenc(?:y|ies)|firms?|consultanc(?:y|ies)|studio|outsourc|dev shop)\b/i;
      const wantsPeople = peopleRe.test(reply);
      const wantsCompanies = companiesRe.test(reply);
      const wantsAgency = agencyRe.test(reply);

      let resolved: { kind: "people" | "companies" | "agency"; action: ToolInput } | null = null;
      if (wantsAgency && !wantsPeople && !wantsCompanies && meta.agency_action) {
        resolved = { kind: "agency", action: meta.agency_action as ToolInput };
      } else if (wantsPeople && !wantsCompanies && !wantsAgency && meta.people_action) {
        resolved = { kind: "people", action: meta.people_action as ToolInput };
      } else if (wantsCompanies && !wantsPeople && !wantsAgency && meta.companies_action) {
        resolved = { kind: "companies", action: meta.companies_action as ToolInput };
      } else if (wantsPeople && !wantsCompanies && !wantsAgency && !meta.people_action && meta.companies_action) {
        // People requested but unavailable — surface fallback offer, do not run silently.
        const fallbackMsg =
          "Individual people/profile sourcing isn't configured yet. I can find companies hiring for that role instead — reply \"companies\" to proceed.";
        const { data: saved } = await admin
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fallbackMsg,
            agent_slug: "pilot",
            model_used: "google/gemini-3-flash-preview",
            metadata: {
              ...meta,
              ...pendingClarification("lead_source_selector", "people_unavailable"),
              prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
            },
          })
          .select("*")
          .single();
        return json({ type: "reply", conversation_id: conversationId, clarification: true, message: saved });
      }

      if (resolved) {
        // Mark prior message resolved.
        if (lastAssistant?.id) {
          const nextMeta = { ...meta };
          delete nextMeta.pending_clarification;
          nextMeta.resolved_with = resolved.kind;
          await admin.from("messages").update({ metadata: nextMeta }).eq("id", lastAssistant.id);
        }
        const originalInstruction: string = typeof meta.original_request === "string" && meta.original_request.trim()
          ? meta.original_request
          : message;

        // Agency branch has no dedicated actor yet — surface a clear capability
        // message instead of crashing the orchestrator with a null tool.
        if (resolved.kind === "agency" && !resolved.action?.tool_name) {
          const agencyMsg =
            "Dedicated agency sourcing isn't configured yet. I can either (a) find companies hiring for the roles you need (reply \"companies\"), or (b) run a Hawk web research pass on dev agencies — say which you'd prefer.";
          const { data: saved } = await admin
            .from("messages")
            .insert({
              conversation_id: conversationId,
              role: "assistant",
              content: agencyMsg,
              agent_slug: "pilot",
              model_used: "google/gemini-3-flash-preview",
              metadata: {
                ...meta,
                ...pendingClarification("lead_source_selector", "agency_unavailable"),
                prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
              },
            })
            .select("*")
            .single();
          return json({ type: "reply", conversation_id: conversationId, clarification: true, message: saved });
        }

        return await delegateToOrchestrate({
          admin,
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
          authHeader,
          conversationId,
          workspaceId,
          instruction: originalInstruction,
          toolInput: resolved.action,
          modelUsed: "google/gemini-3-flash-preview",
          providerUsed: "lovable-ai",
        });
      }

      if (!wantsPeople && !wantsCompanies && !wantsAgency) {
        // Couldn't classify — ask once more, preserve context.
        const hasAgency = !!meta.agency_action;
        const reAsk = hasAgency
          ? "Please choose one: individual profiles, companies hiring, or an agency."
          : "Please choose one: individual profiles or companies hiring.";
        const { data: saved } = await admin
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: reAsk,
            agent_slug: "pilot",
            model_used: "google/gemini-3-flash-preview",
            metadata: {
              ...meta,
              ...pendingClarification("lead_source_selector", "reask_people_or_companies"),
              prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
            },
          })
          .select("*")
          .single();
        return json({ type: "reply", conversation_id: conversationId, clarification: true, message: saved });
      }
      // If multiple matched, fall through to normal planner.
    }
  }

  // ── 5b REMOVED: THE DAILY-BRIEF REGEX GATE ──────────────────────────────
  //
  // It sat here, ahead of Chat Brain, and matched an anchored list of nine exact
  // phrasings. Anything outside that list was not a brief however plainly it
  // asked, and a request that WAS one never reached the semantic layer at all —
  // a regex decided meaning before the brain was consulted.
  //
  // The brief is now a READ whose output shape is prose (`readSurface`'s "brief"
  // target), so Chat Brain decides it from the request like every other
  // objective and the surface below serves it. Same `daily-brief` function, same
  // response; one fewer thing that can outrank understanding.

  // 5c. NEW: Workflow Classifier (Phase 1) — single source of truth.
  // Regex-first with Gemini fallback. Short-circuits direct-reply categories
  // and degraded paths; falls through to the legacy planner for sourcing,
  // url_analysis, and outreach categories so the existing pending-clarification
  // persistence keeps working unchanged.
  // ── 5c REMOVED: THE WORKFLOW CLASSIFIER ─────────────────────────────────
  //
  // `classifyWorkflow` ran here on every message — regex-first with a Gemini
  // fallback — and `validateAgainstCapabilities` then filled or cleared the
  // fields it produced. Between them they owned WHICH of twelve categories a
  // request was, and thirty fields of what it meant.
  //
  // Nothing reads either any more. Every branch that switched on
  // `decision.workflow_category` has been replaced by a route that carries its
  // own payload, and the last field-level reads — the onboarding gate, the
  // outreach follow-up, the search-web capability — now ask the request or the
  // deployment directly.
  //
  // A message is understood once.

  // ══ CHAT BRAIN — THE AUTHORITATIVE UNDERSTANDING PATH ══════════════════
  //
  // The old classifiers above still RUN and are still logged; they are simply
  // no longer what decides. `CHAT_BRAIN_ENABLED=false` restores them as
  // authoritative in one variable, with no deploy — the whole stack is still
  // present.
  //
  // What crosses this seam is a CATEGORY, nothing more. Every deterministic
  // boundary below — Stage 0 feasibility, Stage 1 preview, identity, unlocks,
  // credits, provider selection, execution validation — is downstream of that
  // category and is untouched. In particular spend authority is computed by
  // the router from workspace policy and can never be raised by anything the
  // model returned; `parseRequestStrict` forces `may_spend: false` on every
  // request before it is even routed.
  // C0 — THE DURABLE WORKSPACE BLOCK. Already built by `companyBrainContext`;
  // this is wiring, not authoring. It tells the model what "my ICP" refers to,
  // and is explicitly not a source of requirements the user did not state.
  //
  // Fetched HERE rather than reused from further down: the Company Brain read
  // at the reply layer happens after this point, and understanding cannot wait
  // for it. One extra `maybeSingle` on an indexed key, and a failure yields no
  // context rather than no answer — grounding is an improvement to
  // understanding, never a precondition for it.
  // The same read serves understanding AND compilation: the compiler applies the
  // workspace profile under its own precedence rules, and fetching it twice
  // would let the two layers disagree about what the workspace says.
  let brainProfileForMission: Record<string, unknown> | null = null;
  let brainOnboardedForGate = false;
  /**
   * What the request asked to WRITE, if anything — read once, above, and reused
   * by the memory follow-up section so it does not have to ask again.
   */
  let composeIntentForFollowUp: "outreach" | "content" | null = null;
  /** The model's own confidence in its reading, for message provenance. */
  let brainConfidence: number | null = null;
  const workspaceContextBlock: string | null = await (async () => {
    try {
      const { data } = await admin.from("company_brain")
        .select("profile, onboarding_completed")
        .eq("workspace_id", workspaceId).maybeSingle();
      const profile = (data?.profile ?? null) as Record<string, unknown> | null;
      brainProfileForMission = profile;
      brainOnboardedForGate = data?.onboarding_completed === true;
      if (!profile || !hasUsableBrain(profile, data?.onboarding_completed === true)) {
        return null;
      }
      return buildCompanyBrainContext(profile) || null;
    } catch { return null; }
  })();
  const readEnvSafe = (k: string): string | undefined => {
    try { return Deno.env.get(k); } catch { return undefined; }
  };
  // ── CONVERSATION MEMORY, HOISTED ABOVE UNDERSTANDING ────────────────────
  //
  // It used to load below the whole classifier chain, which meant the semantic
  // layer could not see what the conversation already held — so a request to
  // "draft outreach to the top 5" could be understood but not served, because
  // the leads it referred to were not readable yet at the point of routing.
  //
  // It depends on nothing the classifier produces: a workspace, a conversation
  // and a limit. Reading it first costs one query that was already being made.
  const memory: ConversationMemory = await loadConversationMemory({
    admin,
    workspace_id: workspaceId,
    conversation_id: conversationId,
    limit: 50,
  });

  let brainRoute: Route | null = null;
  let brainBinding: BindingOutcome | null = null;
  /**
   * WHICH REAL COMPANIES THIS TURN'S REFERENTS RESOLVED TO.
   *
   * Produced by `resolveReferents` below and read by everything downstream that
   * needs an exact entity — the router's projection, the monitor surface, and
   * the sidecar delegated to orchestrate. Empty for a request that names its own
   * subject, which is most of them.
   */
  let resolvedBindings: ResolvedReferentBinding[] = [];
  /**
   * WHAT EVERY ASSISTANT MESSAGE CARRIES.
   *
   * ── WHY THIS IS A FUNCTION AND WHY IT LIVES HERE ────────────────────────
   *
   * It was `const baseMeta = { … }`, declared AFTER the Chat Brain block that
   * calls `replyAndReturn`. `replyAndReturn` is a function declaration and
   * hoists; the `const` it closes over does not. So all seven refusal paths
   * inside the block — the whole of `converse`, the market-research
   * "not configured" reply, outreach-without-leads, the signal-sourcing
   * clarifications, the onboarding gate and the unsafe-request refusal —
   * threw `ReferenceError: Cannot access 'baseMeta' before initialization`
   * and surfaced as "Something went wrong handling that message."
   *
   * Every one of those is a path whose entire job is to answer honestly, so
   * the failure mode was: the moment Pilot had something careful to say, it
   * crashed instead. `hello` reproduced it.
   *
   * A function, not a const, because `brainRoute` and `brainConfidence` are
   * `let` bindings that are still being assigned when the block runs. A
   * snapshot taken at declaration time would record nulls for every reply the
   * block produces.
   */
  const replyMeta = () => ({
    classifier_source: "chat_brain",
    objective: brainRoute?.objective ?? null,
    route: brainRoute?.kind ?? null,
    confidence: brainConfidence,
    prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
  });

  async function replyAndReturn(
    content: string, extraMeta: Record<string, unknown> = {},
  ): Promise<Response> {
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content,
        agent_slug: "pilot",
        model_used: "google/gemini-3-flash-preview",
        metadata: { ...replyMeta(), ...extraMeta },
      })
      .select("*")
      .single();
    return json({
      type: "reply",
      conversation_id: conversationId,
      route: brainRoute?.kind ?? null,
      message: saved,
    });
  }

  // ══ START OF THE CHAT BRAIN BLOCK ═════════════════════════════════════════
  //
  // A stable landmark, paired with the end marker below. Tests slice this
  // function between the two to assert what may and may not appear inside the
  // understood path; they used to key on `if (chatBrainEnabled(readEnvSafe))`,
  // which was a feature flag rather than a boundary and vanished with it.
  //
  // UNCONDITIONAL. There is no flag and no alternative path: understanding is
  // the only way in.
  {
    // ── THE TURNS BEFORE THIS ONE ──────────────────────────────────────
    //
    // Without these, every message arrives as the first message in the
    // conversation and "which of those" cannot be a back-reference — the
    // prompt says so explicitly, and Chat Brain obeyed it. Loaded once, used
    // twice: understanding, and the conversational answer below.
    const { data: priorRows } = await admin
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(TURN_LOOKBACK + 1);
    const priorTurns = toBrainTurns(
      (priorRows ?? []).filter((r) => r.id !== insertedUserMessage?.id),
    ).slice(-TURN_LOOKBACK);

    const understood = await understandRequest(message, {
      workspaceContext: workspaceContextBlock,
      conversation: priorTurns,
      log: (m, meta) => console.log(`[pilot-chat][chat-brain] ${m}`, meta ?? ""),
    }, { readEnv: readEnvSafe });

    if (understood.ok) {
      // ══ PHASE E — WHICH REAL ENTITY THE REQUEST POINTS AT ═══════════════
      //
      // BEFORE THE ROUTER, AND THEREFORE BEFORE ANY SPEND. A reference that
      // cannot be resolved is a question about WHICH company, and the cheapest
      // place to ask it is before a surface has been chosen, before a mission
      // is projected and before a credit is reserved. Routing first and
      // discovering the ambiguity later would mean the refusal arrives after
      // the commitment.
      //
      // The database is touched only for a request that actually points
      // backwards. A request naming its own subject resolves to no bindings and
      // costs no query.
      const referents = requestHasBackReference(understood.request)
        ? await loadLatestReferents(admin as unknown as ReferentDb, conversationId)
        : null;
      // DETERMINISTIC, AND THE MODEL IS NOT CONSULTED. Chat Brain said a
      // reference EXISTS; `resolveReferents` decides what it resolves to, from
      // records this system wrote, using the same `resolveCompanyIdentity` the
      // rest of the pipeline uses. A `resolved_key` the model invented is not
      // read by anything on this path.
      const resolution = resolveReferents(understood.request, referents?.source ?? null);
      resolvedBindings = resolution.bindings;

      if (resolution.failures.length > 0) {
        // ── ASK, NEVER GUESS ─────────────────────────────────────────────
        //
        // Two prior companies and "check them" is a genuine ambiguity, and the
        // nearest-name fallback that would resolve it is exactly how a
        // follow-up silently investigates a company the user never mentioned.
        // Nothing has been routed, no provider has been reached and no credit
        // has been reserved at this point — which is the property that makes
        // asking cheap.
        const first = resolution.failures[0];
        const { data: saved } = await admin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: first.question,
          agent_slug: "pilot",
          metadata: {
            ...pendingClarification("referent", `referent:${first.reason}`, {
              request_part_id: first.part_id,
              required_fields: ["subject.references"],
            }),
            chat_brain: {
              route: "referent_unresolved",
              reason: `referent:${first.reason}`,
              part_id: first.part_id,
              source_message_id: referents?.message_id ?? null,
              candidates: referents?.set?.entities.length ?? 0,
            },
          },
        }).select("*").single();
        await recordUnderstanding(admin as unknown as UnderstandingWriter, {
          workspaceId, conversationId,
          source: "chat_brain_shadow",
          utterance: message,
          objective: understood.request.objective,
          confidence: understood.request.confidence,
          metadata: {
            authoritative: true,
            route: "referent_unresolved",
            route_reason: `referent:${first.reason}`,
            spent: false,
            failures: resolution.failures.map((f) => f.reason),
          },
        });
        return json({
          type: "reply", conversation_id: conversationId,
          clarification: true, message: saved,
        });
      }

      composeIntentForFollowUp = planCompose(understood.request)?.kind ?? null;
      brainConfidence = understood.request.confidence;

      brainRoute = routeRequest(understood.request, {
        // WORKSPACE POLICY, NOT THE MODEL'S OPINION. A paid run still needs the
        // user's explicit Start; this only says spending is possible at all.
        spendAllowed: true,
        confirmationRequired: true,
        // READ BY THE PROJECTION, so a bound referent contributes the company's
        // real name to `known_companies` instead of the word the user used for
        // it. The exact identity does NOT travel this way — it stays in the
        // sidecar, so no proposal gains a URL and no safety gate is relaxed.
        bindings: resolvedBindings,
      });
      brainBinding = bindRoute(brainRoute);

      await recordUnderstanding(admin as unknown as UnderstandingWriter, {
        workspaceId, conversationId,
        source: "chat_brain_shadow",
        utterance: message,
        objective: understood.request.objective,
        confidence: understood.request.confidence,
        metadata: {
          authoritative: true,
          route: brainRoute.kind,
          route_reason: brainRoute.reason,
          binding: brainBinding.kind,
          bound_referents: resolvedBindings.length,
          may_spend: brainRoute.may_spend,
          parts: understood.request.parts.map((x) => x.objective),
          repaired: understood.repaired,
        },
      });

      // A BLOCKED OR UNSERVABLE REQUEST ANSWERS NOW AND STOPS. Nothing is
      // executed and nothing is bought.
      if (brainBinding.kind === "reply") {
        const { data: saved } = await admin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: brainBinding.message,
          agent_slug: "pilot",
          metadata: {
            ...pendingClarification("objective_route", brainRoute.reason),
            chat_brain: { route: brainRoute.kind, reason: brainRoute.reason },
          },
        }).select("*").single();
        return json({
          type: "reply", conversation_id: conversationId,
          clarification: true, message: saved,
        });
      }
      // ── READ: ANSWERED FROM HELD EVIDENCE, NO PROVIDER REACHED ────────
      if (brainBinding.kind === "read") {
        // SCOPED BY THE BINDING, IF ONE RESOLVED. "What about the second
        // company?" resolved to a real company; answering it with a
        // workspace-wide count answers a different question. This changes what
        // is read, never what may be spent — `readSurface` reaches no provider
        // either way.
        const plan = planRead(understood.request, resolvedBindings);

        // ── THE BRIEF: SERVED BY THE FUNCTION THAT ALREADY BUILDS IT ──────
        //
        // Reached from the read route rather than from a regex gate, so the
        // request was understood before it was routed here. `daily-brief`
        // remains the single implementation — assembling a second one from
        // `executeRead` would give the chat and the dashboard two answers to
        // the same question, free to drift apart.
        //
        // A NON-2xx FALLS THROUGH to the ordinary read, which is honest: the
        // workspace summary is unavailable, but "what do I hold?" still has an
        // answer that costs nothing.
        if (plan.target === "brief") {
          try {
            const briefResp = await fetch(`${SUPABASE_URL}/functions/v1/daily-brief`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                apikey: SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                workspace_id: workspaceId, conversation_id: conversationId,
              }),
            });
            if (briefResp.ok) {
              const briefBody = await briefResp.json();
              return json({
                type: "reply",
                intent: "daily_brief",
                conversation_id: conversationId,
                message: briefBody?.message ?? null,
                connectors_missing: briefBody?.connectors_missing ?? [],
              });
            }
            console.warn("[pilot-chat][brief] non-2xx, degrading to read:",
              briefResp.status);
          } catch (e) {
            console.warn("[pilot-chat][brief] threw, degrading to read:", e);
          }
        }
        const result = plan.target
          ? await executeRead(admin as unknown as ReadDb, plan, workspaceId)
          : null;
        const answer = renderReadAnswer(plan, result);
        // ── WHAT THIS ANSWER PUT ON SCREEN, SO A FOLLOW-UP CAN POINT AT IT ─
        //
        // `presentedCompanies` is the function the renderer itself calls, so
        // the persisted order IS the displayed order rather than a second walk
        // of the rows that could filter or slice differently. A read answer
        // lists only the watched half and only the first few of those; "the
        // second company" indexes that list, not the query behind it.
        const shown = presentedCompanies(result);
        // ── A SCOPED ANSWER IS ITSELF A REFERENT ─────────────────────────
        //
        // After "what about the second company?" the thing on screen is ONE
        // company, and "monitor them" means that one. Without this the newest
        // presented set is still the three-company list that came before, so
        // the follow-up would ask which of three the user meant — having just
        // been told about exactly one. The narrower, more recent set is the
        // honest answer to what "them" now refers to.
        const scoped = plan.target === "company_detail" && plan.subject
          ? [{
            label: plan.subject.label,
            name: plan.subject.label,
            domain: plan.subject.domain,
            linkedin_url: plan.subject.linkedin_url,
          }]
          : [];
        const { data: saved } = await admin.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: answer, agent_slug: "pilot",
          metadata: {
            chat_brain: { route: "read", target: plan.target,
              scoped_to: plan.subject?.entity_key ?? null,
              counts: result?.counts ?? null, reason: brainRoute.reason },
            ...(scoped.length > 0
              ? {
                [PRESENTED_REFERENTS_KEY]: buildPresentedReferents(
                  scoped, "watched_companies"),
              }
              : shown.length > 0
              ? {
                // A LEAD CARRIES ITS OWN IDENTITY. The account embed supplies
                // name, domain and LinkedIn URL directly, so there is nothing
                // to classify from a bare identifier string; a watched subject
                // still has only `identifier`, and falls back to it.
                [PRESENTED_REFERENTS_KEY]: buildPresentedReferents(
                  shown.map((e) =>
                    (e.domain || e.linkedin_url)
                      ? {
                        label: e.label, name: e.label,
                        domain: e.domain, linkedin_url: e.linkedin_url,
                      }
                      : presentedFromIdentifier(e.label, e.identifier)),
                  "lead_results",
                ),
              }
              : {}),
          },
        }).select("*").single();
        return json({ type: "reply", conversation_id: conversationId, message: saved });
      }

      // ── MONITOR: RECORDS AN INTENTION, BUYS NOTHING NOW ───────────────
      if (brainBinding.kind === "monitor") {
        // THE BINDING IS THE IDENTITY. Without it `planMonitor` would fall back
        // to the user's own words, and a subject created for the wrong company
        // spends every cadence period, unattended, forever.
        const plan = planMonitor(understood.request, resolvedBindings);
        const outcome = await executeMonitor(
          admin as unknown as MonitorDb, plan, workspaceId);
        const answer = outcome.error
          ? "I couldn't work out exactly what to watch. Tell me the company and I'll set it up."
          : outcome.already_watching
          ? `You're already watching ${outcome.label}. I've left it as it is.`
          : `Done — I'm watching ${outcome.label}${plan.signals.length ? ` for ${plan.signals.join(", ")}` : ""}. It'll be checked on the workspace's normal schedule.`;
        const { data: saved } = await admin.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: answer, agent_slug: "pilot",
          metadata: {
            chat_brain: { route: "monitor", created: outcome.created,
              already_watching: outcome.already_watching, reason: brainRoute.reason },
          },
        }).select("*").single();
        return json({ type: "reply", conversation_id: conversationId, message: saved });
      }
      // The held-evidence reuse moved INTO the lead route, below — see there.

      // ══ SOURCE / RESEARCH: THE UNDERSTANDING BECOMES THE MISSION ═══════
      //
      // The seam Phase A designed and nothing connected. The projection Chat
      // Brain produced is compiled by the EXISTING `compileLeadMission` and
      // delegated — no second model reads the sentence, and no route is
      // expressed as a category string.
      //
      // What this replaces: `decision.workflow_category = "qualified_lead_sourcing"`,
      // a value absent from `WorkflowCategory`, which matched no branch, fell
      // through to a deep fallback and delegated with no mission at all. That
      // is the whole of `mission_not_compiled`.
      // The last translation is gone with the categories it translated into:
      // `converse` has its own surface now, handled below.

      // ── A PAGE THE USER NAMED: ONE FIRECRAWL FETCH, NO SEARCH ─────────
      //
      // Reached from the route, so no regex read the sentence to find the URL.
      // Three used to: `workflowClassifier.looksLikeURL`, `intentRouter`'s URL
      // test and `toolInputPlanner`'s `hasUrl`, each over the raw message and
      // each deciding meaning. The link is now a REFERENCE Chat Brain produced,
      // and only its format is checked.
      //
      // The tool contract is the one `planToolInput` already produces for this
      // case — same actor, same shape — so orchestrate and run-agent see nothing
      // new.
      if (brainRoute.kind === "url_analysis" && brainRoute.url?.url) {
        console.log("[pilot-chat][url-analysis]", {
          workspace_id: workspaceId,
          host: (() => { try { return new URL(brainRoute.url.url).host; } catch { return null; } })(),
        });
        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId,
          instruction: message,
          missionOrigin: "chat_brain_url_analysis",
          toolInput: {
            tool_name: "scrape_url",
            selected_actor_key: "firecrawl_scrape_url",
            source_type: null,
            query: brainRoute.url.url,
            max_results: 1,
            execution_mode: "research",
            confidence: understood.request.confidence,
            missing_fields: [],
            reason: "chat brain: research on a page the user named",
          } as unknown as ToolInput,
          modelUsed: "chat-brain",
          providerUsed: "openai",
        });
      }

      // ── THE SAFETY REFUSAL, AHEAD OF EVERY SURFACE ────────────────────
      //
      // Defence in depth, not the enforcement: Penn writes drafts, `approvals`
      // gates them, and nothing can dispatch without an approval row. What this
      // adds is an ANSWER — "DM everyone on this list automatically" gets a
      // refusal that explains the alternatives, instead of a silent pile of
      // drafts that technically complies.
      if (asksForUnsafeAction(message)) {
        return await replyAndReturn(UNSAFE_REQUEST_REPLY, {
          unsafe: true,
          chat_brain: { route: brainRoute.kind, refused: "unsafe_request" },
        });
      }

      // ── COMPANY BRAIN GATE, ON THE OBJECTIVE ──────────────────────────
      //
      // Work that GOES AND DOES SOMETHING for this business is generic without
      // knowing the business. It used to be gated on `classifyIntent`'s
      // vocabulary — a second classifier's reading of the same sentence, and
      // one of the last things keeping that classifier alive. The objective
      // carries the distinction directly.
      //
      // `read`, `converse` and `monitor` stay ungated: refusing "what leads do
      // I have?" until onboarding is finished would hide the workspace from its
      // owner.
      if (shouldGateObjective(understood.request.objective,
            { onboarding_completed: brainOnboardedForGate })) {
        return await replyAndReturn(ONBOARDING_GATE_REPLY, {
          gated: "missing_brain",
          clarification: true,
          chat_brain: { route: brainRoute.kind, objective: understood.request.objective },
        });
      }

      // ── WRITE IT, THEN GO AND FIND ENGAGEMENT ON IT ───────────────────
      //
      // One delegation carrying both halves; orchestrate stages Scribe then
      // Scout. The classifier expressed this as an `execution_mode` on a single
      // category, because it had no way to say a message contained two asks.
      if (brainRoute.kind === "content_engagement_loop" && brainRoute.signals) {
        const sp = brainRoute.signals;
        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId, instruction: message,
          missionOrigin: "chat_brain_content_engagement_loop",
          toolInput: {
            intent: "content_engagement_loop",
            tool_name: "source_with_apify",
            selected_actor_key: "apify_linkedin_posts",
            source_type: "linkedin_engagement",
            query: sp.keywords.join(", ") || message,
            role_keywords: [], location: sp.location,
            max_results: Math.max(1, Math.min(10, sp.count ?? 5)),
            needs_enrichment: false,
            needs_outreach: sp.wants_drafts,
            execution_mode: "content_engagement_loop",
            confidence: understood.request.confidence,
            missing_fields: [],
            reason: "chat brain: content plus engagement search",
            signal_type: sp.competitors.length > 0
              ? "competitor_engagement" : "linkedin_engagement",
            needs_content: true,
            needs_engagement_search: true,
            competitor_related: sp.competitors.length > 0,
          } as unknown as ToolInput,
          modelUsed: "chat-brain", providerUsed: "openai",
        });
      }

      // ── CONVERSATION: A GROUNDED ANSWER, NOT A GREETING ───────────────
      //
      // `converse` used to bind to the category `simple_chat`, whose handler
      // returned a hardcoded "Hi — I'm Pilot for your workspace. What would you
      // like to work on?" — no model call, no context, the message unread. So
      // "what should I focus on first?" and "hello" got the same sentence, and
      // the objective that most needs the model was the one wired to a constant.
      //
      // The facts below are the ONLY state the answer may use, and they are
      // counts this turn already has in hand — no new queries, and nothing that
      // could be mistaken for having looked something up.
      if (brainRoute.kind === "converse") {
        // ── SCOPED, BECAUSE THE MODEL READ THEM AS WORKSPACE-WIDE ──────
        //
        // These are counts of what THIS CONVERSATION produced, and they were
        // handed over under a heading that said `workspace_facts`. Live, one
        // turn after being told the workspace holds 32 leads, converse said
        // "I don't have any leads or prospects in the workspace yet. We're
        // starting from zero." The numbers were right; the scope was invented.
        const facts = [
          `Leads this conversation has produced so far: ${memory.lead_candidates.length} (this is NOT the number of leads saved in the workspace, which you have not been told).`,
          `Outreach drafts this conversation has produced so far: ${memory.outreach_drafts.length}.`,
          `Company Brain onboarding complete: ${brainOnboardedForGate ? "yes" : "no"}.`,
        ];
        const ai = await generateText({
          taskType: "pilot_chat",
          systemPrompt: converseSystemPrompt({
            workspaceContext: workspaceContextBlock, facts,
          }),
          messages: [
            // THE SAME TURNS UNDERSTANDING SAW. A conversational answer that
            // cannot see the previous turn restarts the conversation on every
            // message, which is how "hello" mid-thread read as a first hello.
            ...priorTurns,
            { role: "user", content: message },
          ],
          temperature: 0.5,
          maxTokens: 420,
          functionName: "pilot-chat-converse",
          workspaceId,
        });
        return await replyAndReturn(
          ai.ok && ai.content?.trim() ? ai.content.trim() : CONVERSE_UNAVAILABLE,
          {
            chat_brain: { route: "converse", grounded: !!workspaceContextBlock,
              answered: ai.ok },
          },
        );
      }

      // ── SOURCING ACTIVITY: THREE KINDS, ONE ROUTE ─────────────────────
      //
      // `signal_sourcing` carried eight `WorkflowDecision` fields because the
      // classifier had no entity to say which of itself it meant. The entity
      // says it now, and each kind keeps the actor contract it always had.
      if (brainRoute.kind === "signal_sourcing" && brainRoute.signals) {
        const sp = brainRoute.signals;

        if (sp.kind === "post_commenters") {
          return await delegateToOrchestrate({
            admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
            conversationId, workspaceId, instruction: message,
            missionOrigin: "chat_brain_post_commenters",
            toolInput: {
              intent: "extract_commenters",
              tool_name: "source_with_apify",
              selected_actor_key: "apify_linkedin_post_comments",
              source_type: "linkedin_comments",
              query: message, role_keywords: [], location: null,
              max_results: Math.max(1, Math.min(50, sp.count ?? 20)),
              needs_enrichment: false,
              needs_outreach: sp.wants_drafts,
              execution_mode: "fast",
              confidence: understood.request.confidence,
              missing_fields: [],
              reason: "chat brain: commenters on a post the user linked",
              extract_commenters: true,
              user_input: { postUrls: sp.post_urls },
            } as unknown as ToolInput,
            modelUsed: "chat-brain", providerUsed: "openai",
          });
        }

        if (sp.kind === "competitor_discovery") {
          // THE WORKSPACE'S OWN PROFILE IS THE STARTING POINT — that is what
          // makes a competitor different from a company. Unchanged resolution
          // order: what the user said, then the saved profile, then refuse.
          const profile = (brainProfileForMission ?? {}) as Record<string, unknown>;
          const website = typeof profile.website === "string" && profile.website
            ? profile.website : null;
          const described = [profile.what_we_do, profile.who_we_sell_to]
            .filter((x) => typeof x === "string" && x).join(". ");
          const description = described || null;
          const known = Array.from(new Set([
            ...sp.competitors, ...brainCompetitors(profile),
          ].map((c) => String(c).trim()).filter(Boolean)));
          const mode = website ? "website"
            : (description || known.length > 0) ? "description" : "needs_context";
          if (mode === "needs_context") {
            return await replyAndReturn(COMPETITORS_NEED_CONTEXT, {
              clarification: true,
              clarification_type: "competitor_discovery_needs_context",
            });
          }
          return await delegateToOrchestrate({
            admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
            conversationId, workspaceId, instruction: message,
            missionOrigin: "chat_brain_competitor_discovery",
            toolInput: {
              intent: "competitor_discovery",
              tool_name: "source_with_apify",
              selected_actor_key: "apify_linkedin_posts",
              source_type: "linkedin_engagement",
              query: description ?? website ?? message,
              role_keywords: [], location: null,
              max_results: Math.max(1, Math.min(20, sp.count ?? 5)),
              needs_enrichment: false,
              needs_outreach: sp.wants_drafts,
              execution_mode: "research",
              confidence: understood.request.confidence,
              missing_fields: [],
              reason: `chat brain: competitor discovery (${mode})`,
              signal_type: "competitor_engagement",
              competitor_discovery: true,
              discovery_mode: mode,
              business_website: website,
              business_description: description,
              competitors: known,
            } as unknown as ToolInput,
            modelUsed: "chat-brain", providerUsed: "openai",
          });
        }

        // ENGAGEMENT. Profile posts when the user named profiles, topic search
        // otherwise — the same two actors, chosen by what was referenced rather
        // than by which key a classifier pinned.
        const isProfilePosts = sp.target_urls.length > 0;
        if (!isProfilePosts && sp.keywords.length === 0 && sp.competitors.length === 0) {
          return await replyAndReturn(PROFILE_POSTS_NEED_URLS, {
            clarification: true,
            clarification_type: "linkedin_profile_posts_needs_urls",
          });
        }
        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId, instruction: message,
          missionOrigin: "chat_brain_engagement",
          toolInput: {
            intent: "signal_sourcing",
            tool_name: "source_with_apify",
            selected_actor_key: isProfilePosts
              ? "apify_linkedin_profile_posts" : "apify_linkedin_posts",
            source_type: "linkedin_engagement",
            query: sp.keywords.join(", ") || message,
            role_keywords: [],
            location: sp.location,
            max_results: Math.max(1, Math.min(20, sp.count ?? 5)),
            needs_enrichment: false,
            needs_outreach: sp.wants_drafts,
            execution_mode: "fast",
            confidence: understood.request.confidence,
            missing_fields: [],
            reason: "chat brain: linkedin engagement signal sourcing",
            signal_type: "linkedin_engagement",
            competitors: sp.competitors,
            keywords: sp.keywords,
            user_input: {
              ...(sp.keywords.length > 0 ? { keywords: sp.keywords } : {}),
              ...(isProfilePosts ? { targetUrls: sp.target_urls } : {}),
            },
          } as unknown as ToolInput,
          modelUsed: "chat-brain", providerUsed: "openai",
        });
      }

      // ── WRITING: PENN FOR A RECIPIENT, SCRIBE FOR A POST ──────────────
      //
      // `compose` used to return "content generation isn't wired up yet" from
      // the router, because the objective was absent from `SERVABLE`. Both
      // surfaces existed and worked; the refusal simply returned before either
      // could be reached.
      if (brainRoute.kind === "compose" && brainRoute.compose) {
        const plan = brainRoute.compose;

        if (plan.kind === "outreach") {
          // NOBODY TO WRITE TO IS NOT A DRAFT. It is a question about who.
          if (memory.lead_candidates.length === 0) {
            return await replyAndReturn(OUTREACH_WITHOUT_LEADS, {
              followup: "no_memory", reason: "outreach_requires_existing_leads",
              chat_brain: { route: "compose", kind: "outreach", served: false },
            });
          }
          // THE APPROVAL GATE IS UNCHANGED. Drafting still needs an explicit
          // confirmation, and nothing is ever sent without one.
          if (!isPreConfirmed) {
            // THE CARD DESCRIBES THE REQUEST, NOT A CLASSIFIER VERDICT.
            // `baseMeta` below is built entirely from `decision` — the
            // classifier's category, its confidence, its chosen actor. Carrying
            // that onto a card for a route Chat Brain decided would record the
            // wrong provenance for the run the user is about to confirm.
            return await showWorkflowConfirmation(
              message, conversationId!, workspaceId, admin,
              {
                workflow_category: "outreach",
                business_goal: "draft outreach to remembered leads",
                intent: "draft_outreach",
                confidence: understood.request.confidence,
                execution_mode: "outreach",
                requires_approval: true,
                classifier_source: "chat_brain",
                objective: understood.request.objective,
                prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
              },
              "outreach");
          }
          const n = plan.count ?? extractTopN(message, 5);
          const top = memory.lead_candidates.slice(0, n);
          const seed = top
            .map((l, i) => `${i + 1}. ${l.contact?.full_name ?? l.account?.name ?? "Lead"}${
              l.account?.domain ? ` (${l.account.domain})` : ""} — ${l.reason ?? ""}`)
            .join("\n");
          return await delegateToOrchestrate({
            admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
            conversationId, workspaceId,
            instruction:
              `Draft personalized outreach for the following ${top.length} leads from our prior results. Do not source new leads. Approval is required before sending.\n\n${seed}`,
            missionOrigin: "chat_brain_compose_outreach",
            toolInput: {
              intent: "draft_outreach",
              tool_name: null, selected_actor_key: null, source_type: null,
              query: message, role_keywords: [], location: null,
              max_results: top.length,
              lead_candidate_ids: top.map((l) => l.id),
              needs_enrichment: false,
              needs_outreach: true,
              execution_mode: "outreach",
              confidence: understood.request.confidence,
              missing_fields: [],
              reason: "chat brain: draft outreach to remembered leads",
            } as unknown as ToolInput,
            modelUsed: "chat-brain", providerUsed: "openai",
          });
        }

        // CONTENT: no recipient, no approval gate, no sourcing tools.
        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId,
          instruction: message,
          missionOrigin: "chat_brain_compose_content",
          toolInput: {
            intent: "content_creation",
            tool_name: null, selected_actor_key: null, source_type: null,
            query: message, role_keywords: [], location: null,
            max_results: plan.count ?? 1,
            needs_enrichment: false, needs_outreach: false,
            execution_mode: "fast",
            confidence: understood.request.confidence,
            missing_fields: [],
            reason: "chat brain: content with no recipient",
          } as unknown as ToolInput,
          modelUsed: "chat-brain", providerUsed: "openai",
        });
      }

      // ── A TOPIC: LIVE SEARCH, OR AN HONEST "NOT CONFIGURED" ───────────
      //
      // The capability is ASKED, not inferred. This used to be decided by
      // testing whether the validator had cleared `selected_actor_key` — three
      // components agreeing on the meaning of one null, for a question that was
      // never semantic: is web search configured in this deployment?
      if (brainRoute.kind === "market_research" && brainRoute.market?.topic) {
        if (!webSearchAvailable(readEnvSafe)) {
          return await replyAndReturn(SEARCH_WEB_UNAVAILABLE, {
            degraded: "search_web_unavailable",
            chat_brain: { route: "market_research", served: false },
          });
        }
        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId,
          instruction: message,
          missionOrigin: "chat_brain_market_research",
          toolInput: {
            tool_name: "search_web",
            selected_actor_key: null,
            source_type: null,
            query: brainRoute.market.topic,
            max_results: 10,
            execution_mode: "research",
            confidence: understood.request.confidence,
            missing_fields: [],
            reason: "chat brain: research on a topic, not an organisation",
          } as unknown as ToolInput,
          modelUsed: "chat-brain",
          providerUsed: "openai",
        });
      }

      if (brainRoute.kind === "lead_mission" && brainRoute.lead) {
        const compiled = compileRequestMission(understood.request, brainRoute.lead, {
          originalUserQuery: message,
          companyBrain: companyBrainContextForCompiler(brainProfileForMission),
        });

        if (!compiled.ok) {
          // A STATED REFUSAL, NOT A DETERMINISTIC GUESS. Nothing is delegated
          // and nothing is charged.
          console.warn("[pilot-chat][mission] not compiled", {
            reason: compiled.reason, violations: compiled.violations,
          });
          const { data: saved } = await admin.from("messages").insert({
            conversation_id: conversationId, role: "assistant",
            content: compiled.message, agent_slug: "pilot",
            metadata: {
              ...pendingClarification("objective_route", compiled.reason),
              chat_brain: { route: "lead_mission", compiled: false,
                reason: compiled.reason, violations: compiled.violations },
            },
          }).select("*").single();
          return json({
            type: "reply", conversation_id: conversationId,
            clarification: true, message: saved,
          });
        }

        // ALREADY CANONICAL. `canonicalMissionForTransport` exists to strip the
        // three card-only fields `buildMissionForPrompt` adds; the compiler's
        // `final_mission` never carries them, so there is nothing to strip and
        // routing it through that helper would only invite one to be added.
        const mission = compiled.result.final_mission;
        console.log("[pilot-chat][mission] compiled from RequestV1", {
          workspace_id: workspaceId,
          objective: understood.request.objective,
          parser_source: compiled.result.parser_source,
          requested_output: mission?.requested_output ?? null,
          known_companies: mission?.company_profile?.known_companies?.length ?? 0,
          unrepresented: unrepresentedRequirements(brainRoute.lead),
          bound_referents: resolvedBindings.length,
        });

        // ── DO NOT BUY WHAT IS ALREADY HELD ───────────────────────────────
        //
        // `research` asks a fresh question about a company the user named. When
        // `signal_events` already holds a current answer, paying a provider to
        // re-establish it is spending to learn what we know. `signalFreshness`
        // owns what "current" means, and this fails TOWARD spending — an
        // unreadable table produces a real run rather than a false silence.
        //
        // THIS WAS SILENTLY DISABLED. It was guarded on
        // `brainBinding.kind === "category"`, and once the lead route became
        // typed `bindRoute` returned `lead_route` instead — so the condition
        // could never be true and every research request went straight to a
        // paid run. A spend regression with no symptom: the answer was still
        // correct, it was just bought twice.
        //
        // It also belongs here rather than before the surfaces: it is a
        // decision about executing THIS mission, and it now runs after the
        // safety refusal and the Company Brain gate.
        if (brainRoute.reason === "named_entity_investigation") {
          const known = brainRoute.lead.proposal.known_companies ?? [];
          const needed = [...new Set(understood.request.parts
            .flatMap((x) => (x.requirements ?? []).map((q) => String(q.event))))];
          if (known.length > 0 && needed.length > 0) {
            const held = await heldEvidenceFor(
              admin as unknown as EvidenceDb, workspaceId, known, needed);
            if (held.sufficient) {
              return await replyAndReturn(renderHeldEvidence(known.join(", "), held), {
                outcome: {
                  version: OUTCOME_CONTRACT_VERSION, state: "SATISFIED",
                  gaps: [], reason: "served_from_held_evidence",
                },
                chat_brain: { route: "research", served_from: "held_evidence",
                  fresh: held.fresh.length, stale: held.stale, spent: false },
              });
            }
            console.log("[pilot-chat][research] held evidence insufficient, running", {
              known, needed, missing: held.missing, stale: held.stale,
            });
          }
        }

        // ── STAGE 0 AND STAGE 1, BEFORE ANYTHING IS BOUGHT ────────────────
        //
        // The graph the ENGINE will execute, assessed by the same feasibility
        // check the engine uses, and described from that graph and nothing
        // else. `generateWorkflowConfirmation` makes its own model call and
        // compiles its own mission — a second interpretation whose narration
        // could describe a run the executor was never going to perform. This
        // path does not use it.
        const previewPlan = buildCapabilityGraph(mission as never);
        const feasibility = assessRequestFeasibility(mission, previewPlan);
        const preview = buildMissionPreview(
          mission, previewPlan, feasibility, brainRoute.lead);

        // ── AN INFEASIBLE MISSION IS NOT PREVIEWED, IT IS REFUSED ─────────
        if (!preview.feasible) {
          return await replyAndReturn(
            preview.gaps.length > 0
              ? `I understood that, but I can't run it as asked. ${preview.gaps.map((g) => g.detail).join("; ")}.`
              : "I understood that, but I couldn't turn it into a run I can execute.",
            {
              outcome: {
                version: OUTCOME_CONTRACT_VERSION, state: "UNSUPPORTED",
                category: "not_feasible", gaps: preview.gaps,
                reason: "stage0_refused",
              },
              chat_brain: { route: "lead_mission", previewed: false },
            },
          );
        }

        // ── AND NOTHING SPENDS WITHOUT AN EXPLICIT START ──────────────────
        //
        // THIS WAS MISSING. Deleting the category-list confirmation gate
        // removed the only thing standing between a sourcing request and a paid
        // run, and this route delegated straight to orchestrate. The route has
        // carried `requires_confirmation: true` the whole time; nothing read it.
        if (brainRoute.requires_confirmation && !isPreConfirmed) {
          return await replyAndReturn(preview.narration, {
            outcome: {
              version: OUTCOME_CONTRACT_VERSION, state: "REQUIRES_UNLOCK",
              category: "requires_approval", gaps: preview.gaps,
              reason: "awaiting_start",
            },
            type: "workflow_confirmation",
            mission_preview: preview,
            // The mission the Start will execute, so confirming runs exactly
            // what was previewed rather than re-reading the sentence.
            lead_mission: mission,
            chat_brain: { route: "lead_mission", previewed: true },
          });
        }

        return await delegateToOrchestrate({
          admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
          conversationId, workspaceId,
          // THE USER'S OWN WORDS. Not a rewrite — the compiler already read
          // them, and every downstream reader expects the original.
          instruction: message,
          leadMission: mission,
          leadBindings: resolvedBindings,
          missionOrigin: "chat_brain_request_v1",
          modelUsed: "chat-brain",
          providerUsed: "openai",
        });
      }
    } else {
      // ── A MODEL FAILURE DOES NOT RESURRECT A SECOND BRAIN ───────────────
      //
      // This deferred to the old classifier, which was the right answer while
      // one existed: a malformed reading must never become `source` or
      // `research` on its own. There is no classifier now, and reintroducing
      // one for the failure case would rebuild exactly what this cleanup
      // removed — a quieter second interpreter, reached only when nobody is
      // watching.
      //
      // So the request is UNREAD, and says so. It falls through to the
      // conversational tail, which answers without deciding any work: no
      // objective, no surface, no spend. An honest "I did not follow that"
      // costs a retry; a guess costs a run.
      console.warn("[pilot-chat][chat-brain] unreadable — no fallback interpreter",
        { reason: understood.reason, violations: understood.violations });

      // ── AND IT DOES NOT LEAK INTO A MISSIONLESS RUN ────────────────────
      //
      // Falling through was not free. The tail below ends in a generic
      // delegate that hands orchestrate a restated instruction and NO mission,
      // so an unread sourcing request became `422 mission_not_compiled` — an
      // internal contract name, shown to the user, for what was actually a
      // model failure. On a second attempt the same fall-through produced a
      // five-step plan with no mission, which `run-agent` then refused.
      //
      // Both traces are in the production audit and both start here.
      //
      // A CARD ACTION IS EXEMPT. "Run workflow: …" and a submitted lead brief
      // carry their own structured metadata and are executed deterministically
      // below; they never needed the model to read a sentence, so a model
      // outage must not block them.
      if (!actionSource && !isPreConfirmed) {
        return await replyAndReturn(
          "I couldn't read that request just now — that's my understanding layer, not your data. Nothing was started and nothing was charged. Try again, or say it a different way.",
          {
            outcome: {
              version: OUTCOME_CONTRACT_VERSION,
              state: "FAILED",
              category: "model_failure",
              gaps: [],
              reason: `chat_brain_unreadable:${understood.reason ?? "unknown"}`,
            },
            chat_brain: {
              route: null,
              understood: false,
              reason: understood.reason ?? null,
              violations: understood.violations ?? null,
            },
          },
        );
      }
    }
  }

  // ══ END OF THE CHAT BRAIN BLOCK ═══════════════════════════════════════════
  //
  // A stable landmark. Several tests slice this function between the Chat Brain
  // entry and here to assert what may and may not appear inside the understood
  // path; they used to key on the Phase 0 baseline header, which was content
  // rather than a boundary and moved when that content was retired.
  //
  // ── THE PHASE 0 BASELINE IS RETIRED WITH ITS SUBJECT ────────────────────
  //
  // This wrote one `request_understanding_log` row per message recording what
  // `workflowClassifier` decided, so the new path's equivalence could be
  // measured against the old one. The old one no longer exists, so there is
  // nothing left to compare against and a row sourced from a deleted component
  // would be a fiction.
  //
  // Chat Brain still logs its own verdict above, which is now the whole record.

  // Lead Intelligence Engine — confirmed-Start honor. When the user clicks Start
  // on a workflow-confirmation card, the card threads back the ORIGINAL
  // lead_intent (workflow_type + source_type + role family + aliases/excludes).
  // Trust it instead of re-classifying the "Run workflow: …" command string,
  // which would otherwise misroute an assistant-hiring Start to people search.
  const confirmedLeadIntent = (isPreConfirmed && actionMetadata?.lead_intent && typeof actionMetadata.lead_intent === "object")
    ? actionMetadata.lead_intent as Record<string, unknown>
    : null;
  if (confirmedLeadIntent && typeof confirmedLeadIntent.workflow_type === "string") {
    // IT USED TO OVERWRITE THE CLASSIFIER'S VERDICT so a "Run workflow: …"
    // Start command was not re-read as a fresh request. There is no verdict to
    // overwrite now — the card threads the original instruction and Chat Brain
    // reads that — so this is kept as provenance only.
    console.log("[pilot-chat] confirmed lead_intent:", {
      workflow_type: confirmedLeadIntent.workflow_type,
      source_type: confirmedLeadIntent.source_type ?? null,
      role_family: confirmedLeadIntent.role_family ?? null,
    });
  }

  // Loaded ABOVE the Chat Brain block — see the hoist there.
  console.log("[pilot-chat] memory:", {
    has_any_memory: memory.has_any_memory,
    leads: memory.lead_candidates.length,
    drafts: memory.outreach_drafts.length,
    outputs: memory.saved_outputs.length,
    last_plan_id: memory.last_plan_id,
  });

  // `replyMeta` and `replyAndReturn` are declared ABOVE the Chat Brain block —
  // see the hoist there for why.

  // Company Brain context — load once, reuse for all brain-aware direct replies.
  // (Content/outreach DRAFTING already gets the brain downstream in run-agent;
  // this covers the chat-reply layer that never reaches an agent.)
  const { data: cbRow } = await admin
    .from("company_brain")
    .select("profile, onboarding_completed")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const brainProfile = (cbRow?.profile ?? null) as Record<string, unknown> | null;
  const brainReady = hasUsableBrain(brainProfile, cbRow?.onboarding_completed === true);
  const brainCtx = brainReady ? buildCompanyBrainContext(brainProfile) : "";

  // Personalized reply: a single Gemini call seeded with the compact brain
  // context + a category-specific instruction. Falls back to a static string
  // if the provider fails, so chat never hard-errors.
  async function personalizedReply(
    instruction: string,
    fallback: string,
    extraMeta: Record<string, unknown> = {},
  ): Promise<Response> {
    const sys =
      "You are Pilot for Agentory, an AI workforce OS. Use the Company Brain below to make your answer specific to THIS business — naturally, not by dumping it or repeating every field. Be concise (≤120 words). Never invent fields that aren't present; if something's missing, say you don't have it yet. Never claim live data was fetched. No emojis.\n\n<company_brain>\n" +
      brainCtx + "\n</company_brain>";
    const ai = await generateText({
      taskType: "pilot_chat",
      systemPrompt: sys,
      messages: [{ role: "user", content: instruction }],
      temperature: 0.5,
      maxTokens: 420,
      functionName: "pilot-chat-personalize",
      workspaceId,
    });
    const text = ai.ok && ai.content?.trim() ? ai.content.trim() : fallback;
    return await replyAndReturn(text, { brain_aware: brainReady, personalized: ai.ok, ...extraMeta });
  }

  // Safety FIRST — an unsafe/auto-send ask wins over memory follow-ups and lead
  // intake (e.g. "these leads, automatically DM them" must refuse, not ask for
  // leads). Draft-only/approval-gated alternatives offered; nothing is sent.
  // REMOVED: unsafe_or_unsupported -> `asksForUnsafeAction`, run ahead of every surface.

  // Submitted Lead Search Brief detection (computed early so no intermediate
  // handler — validator clarification, etc. — can intercept it). When present,
  // the dedicated handler below trusts this structured metadata and never
  // reopens the Lead Source Selector.
  const submittedBrief = (actionSource === "lead_source_card" || actionSource === "lead_source_brief")
    && actionMetadata?.lead_request && typeof actionMetadata.lead_request === "object" && !Array.isArray(actionMetadata.lead_request)
    ? actionMetadata.lead_request as Record<string, unknown>
    : null;
  const submittedSourceType = typeof actionMetadata?.source_type === "string"
    ? actionMetadata.source_type as LeadSourceType
    : null;
  const hasSubmittedBrief = !!(submittedBrief && submittedSourceType);

  // 5c.0 Phase 2: follow-up shortcuts driven by persistent memory.
  // Only triggers when message references previous results AND we have memory.
  const followUpRef = isFollowUpReference(message);
  const hasLeads = memory.lead_candidates.length > 0;
  const draftOutreachRe = /\b(draft|write|send)\s+(outreach|emails?|messages?)\b/i;
  const filterRe = /\b(only keep|filter|narrow|just keep|drop the|exclude)\b/i;
  const enrichRe = /\b(enrich|research|look up|dig into)\b/i;
  // A NEW sourcing brief (e.g. a Lead Search Brief: "Find 5 founders … Save them
  // to Signal Feed.") must NEVER be captured by the memory save/refine/enrich
  // handlers just because it mentions "save"/"signal feed". New sourcing wins.
  const newSourcing = hasNewSourcingIntent(message);

  // Phase 2 (P2-02) — refine/filter/rank over REMEMBERED results must ALWAYS win
  // over re-sourcing. "only keep early-stage", "rank these", "top 5", "keep US
  // only", "prioritize", "sort by"… are memory operations: never launch a new
  // Apify run, never use a 25-result default. This precedes (and overrides) the
  // classifier's sourcing categorization, which previously re-sourced.
  const refineRe = /\b(only keep|just keep|keep only|narrow(?:\s+down)?|drop the|exclude|remove the|prioriti[sz]e|sort by|rank (?:these|them|the (?:results|leads|signals|candidates))|keep (?:us|u\.s\.|early[- ]stage|seed|series\s+[a-c]|enterprise|smb)\b)/i;
  const refineTopOnly = /^\s*(?:keep|show|give me)?\s*(?:the\s+)?top\s+\d+\s*\.?\s*$/i;
  const isRefine = (refineRe.test(message) || refineTopOnly.test(message)) && !draftOutreachRe.test(message) && !newSourcing;
  if (isRefine) {
    if (!hasLeads) {
      return await replyAndReturn(
        "I don't have any leads or signals saved in this conversation yet to refine. Run a sourcing workflow first — for example \"find 10 companies hiring GTM roles in the US\" — and I'll keep the results in memory so you can filter, rank, or narrow them next.",
        { followup: "no_memory", reason: "refine_requires_existing_results" },
      );
    }
    const total = memory.lead_candidates.length;
    const stageKnown = memory.lead_candidates.filter((l) => l.account?.stage).length;
    const preview = memory.lead_candidates
      .slice(0, 10)
      .map((l) => `• ${l.account?.name ?? l.contact?.full_name ?? "Lead"}${l.account?.stage ? ` — ${l.account.stage}` : ""}${l.account?.industry ? ` (${l.account.industry})` : ""}`)
      .join("\n");
    const msg = stageKnown < total
      ? `I have ${total} leads in memory from your last search, but stage/industry data is missing on ${total - stageKnown} of them, so I can't apply that filter precisely yet. Want me to enrich them with Hawk + Firecrawl first? Quick preview:\n${preview}`
      : `Refined against the ${total} leads already in memory (no new sourcing). Matches:\n${preview}\n\nReply "draft outreach to the top 5" or "enrich the top 3" to continue.`;
    return await replyAndReturn(msg, { followup: "filter_applied", filter_target: message, reused_memory: true });
  }

  // Post-lead "Enrich + draft" — enrich the remembered leads (Firecrawl) then
  // Penn drafts. Memory-only, approval-gated, nothing sent. Placed before the
  // sourcing pipeline so the word "leads" can't trigger a re-source.
  const enrichAndDraft = /\benrich\b/i.test(message) && draftOutreachRe.test(message);
  if (enrichAndDraft && hasLeads && !newSourcing) {
    if (!isPreConfirmed) {
      return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, replyMeta(), "outreach");
    }
    const n = extractTopN(message, 5);
    const top = memory.lead_candidates.slice(0, n);
    const urls = top.map((l) => l.account?.domain).filter(Boolean).map((d) => `https://${d}`);
    const seed = top.map((l, i) => `${i + 1}. ${l.contact?.full_name ?? l.account?.name ?? "Lead"}${l.account?.domain ? ` (${l.account.domain})` : ""} — ${l.reason ?? ""}`).join("\n");
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader, conversationId, workspaceId,
      instruction: `Enrich, then draft outreach for these ${top.length} remembered leads. Analyze their company websites first, then write personalized drafts. Do not source new leads. Approval is required before sending.\n\nWebsites: ${urls.join(", ") || "(none on file)"}\n\n${seed}`,
      toolInput: {
        intent: "draft_outreach", tool_name: null, selected_actor_key: null, source_type: null,
        query: message, role_keywords: [], location: null, max_results: top.length,
        lead_candidate_ids: top.map((l) => l.id), needs_enrichment: true, needs_outreach: true,
        execution_mode: "outreach", confidence: 0.9, missing_fields: [], reason: "follow-up: enrich + draft from memory",
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview", providerUsed: "lovable-ai",
    });
  }

  // Post-lead "Save only" / "Review later" — 0 credits, no tool runs. Leads are
  // already persisted by sourcing; just acknowledge. Must precede the sourcing
  // pipeline so bare "save these leads" / "save them" / "add to signal feed"
  // can't trigger a re-source or fall through to the generic-sourcing fallback.
  // isSaveExistingResultsRequest already excludes fresh sourcing briefs
  // ("find 5 founders and save them"), so the !newSourcing check is belt-and-braces.
  const isSaveExisting = isSaveExistingResultsRequest(message);
  if (isSaveExisting && !newSourcing) {
    if (hasLeads) {
      return await replyAndReturn(
        `Kept your ${memory.lead_candidates.length} leads in the Signal Feed — nothing was sent. Ask me to rank, enrich, or draft outreach whenever you're ready.`,
        { post_lead_action: "save_only", reused_memory: true, credits: 0 },
      );
    }
    // Save intent but nothing in memory yet — acknowledge honestly. Do NOT
    // re-source and do NOT fall through to the generic-sourcing fallback.
    return await replyAndReturn(
      "There aren't any leads or results in this conversation to save yet. Run a sourcing workflow first (for example \"find 10 companies hiring GTM roles in the US\"), and I'll keep the results so you can save, rank, enrich, or draft outreach next.",
      { post_lead_action: "save_only", reason: "no_results_to_save", credits: 0 },
    );
  }

  // Phase 2 patch — no-memory outreach guard must NOT block explicit
  // sourcing+outreach prompts ("Find companies hiring GTM roles and draft
  // outreach"). isFollowUpReference matches "draft outreach", so we exclude
  // messages the classifier routed to a sourcing category — those must run the
  // sourcing pipeline (which will draft outreach as a downstream step).
  // FROM THE ROUTE, NOT A CATEGORY LIST. "Find companies hiring GTM roles and
  // draft outreach" reads as a follow-up because it says "draft outreach", but
  // it is a sourcing run whose drafts are a downstream step. The route already
  // decided that; it does not need re-deriving from a list of category names.
  const isSourcingFollowup = brainRoute?.kind === "lead_mission"
    || brainRoute?.kind === "signal_sourcing"
    || brainRoute?.kind === "content_engagement_loop";

  if (followUpRef && !isSourcingFollowup) {
    if (!memory.has_any_memory) {
      // Honest fallback — no prior results to act on. For outreach we surface
      // the specific guard reason so the UI/metadata can distinguish it.
      // The last read of a classifier category, replaced by the understanding
      // that already happened: an outreach ask is a `compose` part aimed at
      // people, which `planCompose` decided from the request above.
      const isOutreach = composeIntentForFollowUp === "outreach"
        || draftOutreachRe.test(message);
      const noMemoryReply = isOutreach
        ? "I need leads or a saved result set first. Run a sourcing workflow, choose leads from Workbench, or paste the leads you want me to draft outreach for."
        : "I don't have any leads or results saved in this conversation yet. Tell me what to source first — for example: \"find 20 companies hiring growth marketers in the US\" or \"find 10 React developer profiles in London\" — and I'll keep the results in memory so you can filter, enrich, or draft outreach against them next.";
      return await replyAndReturn(noMemoryReply, {
        followup: "no_memory",
        reason: isOutreach ? "outreach_requires_existing_leads" : "followup_requires_existing_results",
      });
    }

    // Draft outreach to top N
    if (draftOutreachRe.test(message) && hasLeads) {
      if (!isPreConfirmed) {
        return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, replyMeta(), "outreach");
      }
      const n = extractTopN(message, 5);
      const top = memory.lead_candidates.slice(0, n);
      // Draft-outreach gate: personalized outreach needs a real contact. If these
      // are account opportunities (no decision-maker attached), don't fabricate a
      // recipient — point the user to find contacts first (or a generic template).
      const withContact = top.filter((l) => l.contact?.full_name || (l.contact as { linkedin_url?: string })?.linkedin_url);
      const wantsGeneric = /\b(generic|template|account[- ]level)\b/i.test(message);
      if (withContact.length === 0 && !wantsGeneric) {
        return await replyAndReturn(
          `These are account opportunities — I have ${top.length} compan${top.length === 1 ? "y" : "ies"} showing intent, but no decision-maker contact attached yet. I won't fabricate a recipient. Reply "find decision-makers" to locate contacts, or "draft a generic account-level template" if you want a non-personalized version. Nothing will be sent.`,
          { followup: "draft_needs_contact", reused_memory: true, can_draft: false },
        );
      }
      const seedSummary = top
        .map((l, i) => {
          const who = l.contact?.full_name ?? l.account?.name ?? "Lead";
          const ctx = l.account?.name && l.contact?.full_name ? ` (${l.account.name})` : "";
          return `${i + 1}. ${who}${ctx} — ${l.reason ?? ""}`;
        })
        .join("\n");
      return await delegateToOrchestrate({
        admin,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        authHeader,
        conversationId,
        workspaceId,
        instruction:
          `Draft personalized outreach for the following ${top.length} leads from our prior results. Do not source new leads. Approval is required before sending.\n\n${seedSummary}`,
        toolInput: {
          intent: "draft_outreach",
          tool_name: null,
          selected_actor_key: null,
          source_type: null,
          query: message,
          role_keywords: [],
          location: null,
          max_results: top.length,
          // Carry the remembered lead ids so orchestrate's Penn-only staged
          // template and memoryWriter can link each draft to its lead/account/contact.
          lead_candidate_ids: top.map((l) => l.id),
          needs_enrichment: false,
          needs_outreach: true,
          execution_mode: "outreach",
          confidence: 0.9,
          missing_fields: [],
          reason: "follow-up: draft outreach to top N from memory",
        } as unknown as ToolInput,
        modelUsed: "google/gemini-3-flash-preview",
        providerUsed: "lovable-ai",
      });
    }

    // Filter / "only keep" — apply via LLM reply over memory (no new sourcing).
    if (filterRe.test(message) && hasLeads) {
      const stageKnown = memory.lead_candidates.filter((l) => l.account?.stage).length;
      const total = memory.lead_candidates.length;
      const missingStage = stageKnown < total;
      const preview = memory.lead_candidates
        .slice(0, 10)
        .map((l) => `• ${l.account?.name ?? l.contact?.full_name ?? "Lead"}${l.account?.stage ? ` — ${l.account.stage}` : ""}${l.account?.industry ? ` (${l.account.industry})` : ""}`)
        .join("\n");
      const msg = missingStage
        ? `I have ${total} leads in memory from your last search, but stage/industry data is missing on ${total - stageKnown} of them. Want me to enrich them with Hawk + Firecrawl so I can apply that filter accurately? Quick preview:\n${preview}`
        : `Filtered against the ${total} leads in memory. Matches:\n${preview}\n\nReply "draft outreach to the top 5" or "enrich the top 3" to continue.`;
      return await replyAndReturn(msg, { followup: "filter_applied", filter_target: message });
    }

    // Enrich top N — delegate to Hawk via Firecrawl on remembered account domains.
    if (enrichRe.test(message) && hasLeads) {
      if (!isPreConfirmed) {
        return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, replyMeta(), "url_analysis");
      }
      const n = extractTopN(message, 3);
      const top = memory.lead_candidates.slice(0, n);
      const urls = top
        .map((l) => l.account?.domain)
        .filter(Boolean)
        .map((d) => `https://${d}`)
        .join(", ");
      const seedSummary = top
        .map((l, i) => `${i + 1}. ${l.account?.name ?? l.contact?.full_name ?? "Lead"}${l.account?.domain ? ` (${l.account.domain})` : ""}`)
        .join("\n");
      return await delegateToOrchestrate({
        admin,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        authHeader,
        conversationId,
        workspaceId,
        instruction:
          `Enrich these ${top.length} accounts from our prior results using Hawk + Firecrawl. Do not start a new sourcing run.\n\n${seedSummary}${urls ? `\n\nURLs to analyze: ${urls}` : ""}`,
        toolInput: {
          intent: "enrich_existing_leads",
          tool_name: urls ? "scrape_url" : null,
          selected_actor_key: urls ? "firecrawl_scrape_url" : null,
          source_type: null,
          query: urls || message,
          role_keywords: [],
          location: null,
          max_results: top.length,
          needs_enrichment: true,
          needs_outreach: false,
          execution_mode: "deep",
          confidence: 0.85,
          missing_fields: [],
          reason: "follow-up: enrich top N from memory",
        } as ToolInput,
        modelUsed: "google/gemini-3-flash-preview",
        providerUsed: "lovable-ai",
      });
    }
  }


  // 5c.i Validator rejected (e.g. people actor disabled, Firecrawl missing,
  // unknown actor) → surface its clarification and stop. Skipped for a submitted
  // Lead Search Brief — that flows to the deterministic handler below (which has
  // its own honest people-actor fallback) so it never reopens the selector.
  // ── 5c.i REMOVED: THE CAPABILITY VALIDATOR ──────────────────────────────
  //
  // `validateAgainstCapabilities` existed to check the actor the CLASSIFIER had
  // chosen: unknown key, disabled actor, missing Firecrawl. No classifier
  // chooses an actor any more — each route names the one it needs, and those are
  // registered and enabled by construction.
  //
  // Admissibility is still enforced, and in the place that can actually stop a
  // call: `buildCapabilityGraph` decides which providers a mission may reach,
  // and `assertProviderAllowed` refuses the rest at the invocation boundary.
  // Validating a guess earlier was never what made a run safe.

  // 5c.ii — the unsafe/unsupported reply used to be repeated here.
  //
  // DELETED AS PROVABLY DEAD, not as a guess: the "Safety FIRST" check earlier
  // in this same function returns unconditionally for this category, so the
  // compiler had already narrowed it out of `decision.workflow_category` by this
  // point and reported the comparison as having no overlap. The two blocks
  // carried the identical message and the identical `{ unsafe: true }` metadata,
  // so nothing observable is lost — and a second copy of a safety refusal is
  // worse than none, because the next person to reword one will not know to
  // reword the other.

  // 5c.ii-a Contact discovery — "Find decision-makers at these companies".
  // Operates over the remembered ACCOUNT opportunities; targets the inferred
  // persona; attaches discovered contacts to those accounts. Honest fallback if
  // the people-search actor is off — never invents contacts. Must precede lead
  // intake (which would otherwise treat "find decision-makers" as a new search).
  if (isFindContactsRequest(message)) {
    const accountLeads = memory.lead_candidates.filter((l) => !l.contact); // account opportunities (no contact yet)
    if (accountLeads.length === 0) {
      return await replyAndReturn(
        "I don't have account opportunities in this conversation to find contacts for yet. Source companies first (e.g. \"find 5 companies hiring GTM roles in the US\"), then I'll find decision-makers at them.",
        { followup: "no_accounts_for_contacts" },
      );
    }
    const accounts: AccountForContacts[] = accountLeads.map((l) => ({
      lead_candidate_id: l.id,
      company: l.account?.name ?? "",
      signal_role: l.reason ?? null,
      linkedin_company_url: l.account?.linkedin_url ?? null,
      website_url: l.account?.website_url ?? null,
      domain: l.account?.domain ?? null,
    })).filter((a) => a.company);
    
    const persona = personaForAccounts(accounts);
    
    const resolvedTargets = accountLeads.map((l) => resolveCompanyContactTarget({
      account_id: l.id,
      company: l.account?.name ?? "",
      signal_role: l.reason ?? null,
      account: l.account,
      signal: l.signal,
    }));
    
    const linkedinUrls = resolvedTargets
      .map((t) => t.linkedin_company_url)
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
      
    const hasCompanyUrls = linkedinUrls.length > 0;
    const selectedActorKey = hasCompanyUrls ? "apify_linkedin_company_employees" : "apify_people_search";
    
    const actorEnabled = (() => { const a = getActorByKey(selectedActorKey); return !!a && isActorRuntimeEnabled(a); })();

    if (!actorEnabled) {
      return await replyAndReturn(
        `${contactDiscoveryFallback()}\n\nFor these ${accounts.length} ${accounts.length === 1 ? "company" : "companies"} I'd target: ${persona.personas.slice(0, 3).join(" / ")}.`,
        { followup: "contacts_unavailable", recommended_persona: persona, account_count: accounts.length, can_draft: false },
      );
    }
    
    const queries = buildContactSearchQueries(accounts, persona, { maxQueries: Math.min(10, accounts.length * 2) });
    
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader, conversationId, workspaceId,
      instruction: `Find decision-makers (${persona.personas.slice(0, 3).join(", ")}) at these companies: ${accounts.map((a) => a.company).join(", ")}. Attach each contact to its company. Do not invent contacts.`,
      toolInput: {
        intent: "source_people", tool_name: "source_with_apify", selected_actor_key: selectedActorKey,
        source_type: "people_profiles", query: hasCompanyUrls ? linkedinUrls.join(", ") : queries.join(", "), role_keywords: persona.personas.map((p) => p.toLowerCase()),
        location: null, max_results: Math.max(1, Math.min(25, accounts.length)),
        needs_enrichment: false, needs_outreach: false, execution_mode: "fast", confidence: 0.85, missing_fields: [],
        reason: "contact discovery: attach decision-makers to account opportunities",
        // run-agent attaches results to these accounts (match by company; no invent).
        attach_to_accounts: accounts.map((a) => ({
          lead_candidate_id: a.lead_candidate_id,
          company: a.company,
          signal_role: a.signal_role,
          linkedin_company_url: a.linkedin_company_url,
          website_url: a.website_url,
          domain: a.domain
        })),
        user_input: hasCompanyUrls 
          ? { companies: linkedinUrls, jobTitles: persona.personas }
          : { keywords: queries },
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview", providerUsed: "lovable-ai",
    });
  }

  // 5c.ii-a2 Submitted Lead Search Brief — the user already picked a source in
  // the Lead Source Selector and filled the brief. TRUST the structured metadata
  // (source_type + lead_request); never re-parse the text and never reopen the
  // selector. Run the selected workflow deterministically, or ask for the ONE
  // specific missing field. This is the fix for "brief submit reopens selector".
  if (submittedBrief && submittedSourceType) {
    const norm = (s: unknown) => { const t = typeof s === "string" ? s.trim() : ""; return t ? (normalizeTerm(t) || t) : ""; };
    const lr = submittedBrief;
    const count = Math.max(1, Math.min(25, parseInt(String(lr.count ?? "5"), 10) || 5));
    const role = norm(lr.target_role);
    const industry = norm(lr.industry);
    const location = norm(lr.location);
    const category = norm(lr.company_category);
    const topic = norm(lr.topic);
    const competitorsRaw = norm(lr.competitors);
    const postUrl = typeof lr.post_url === "string" ? lr.post_url.trim() : "";
    const stage = norm(lr.stage);
    const modeLabel = typeof lr.mode === "string" ? lr.mode : "";

    // Resolve the effective source_type + mode. ICP / normal leads decides
    // people vs. company opportunities (account-first unless people is explicit).
    let effSource: LeadSourceType = submittedSourceType;
    let mode: LeadMode = modeFromLabel(modeLabel);
    const PERSON_ROLE_RE = /\b(founder|co-?founder|ceo|cto|cfo|coo|cmo|vp|head|owner|partner|director|chief|president|operator)\b/i;
    if (submittedSourceType === "icp_search") {
      const wantsPeople = /\b(people|profile|person|individual)\b/i.test(modeLabel);
      const wantsCompanies = /\b(compan|account|agenc|firm|org)/i.test(modeLabel);
      if (wantsPeople) { effSource = "people_profiles"; mode = "people"; }
      else if (wantsCompanies) { effSource = "company_search"; mode = "companies"; }
      else if (category) { effSource = "company_search"; mode = "companies"; }       // role+category → account opportunities first
      else if (role && PERSON_ROLE_RE.test(role)) { effSource = "people_profiles"; mode = "people"; }
      else { effSource = "company_search"; mode = "companies"; }
    }

    const sourceLabel = ({
      icp_search: "ICP / normal leads", hiring_signal: "Hiring signals", company_search: "Company / category search",
      people_profiles: "Founder / profile search", linkedin_posts: "LinkedIn intent posts",
      linkedin_comments: "LinkedIn comments / engagement", competitor_engagement: "Competitor engagement", memory_refine: "Refine",
    } as Record<string, string>)[submittedSourceType] ?? "that source";

    // Minimum-field check — ask for the SPECIFIC missing field, never the selector.
    const hasFocus = !!(role || category || industry || topic || competitorsRaw);
    const missingField =
      (effSource === "linkedin_comments" && !postUrl && !topic && !category) ? "a LinkedIn post URL or a topic"
      : (effSource === "competitor_engagement" && !competitorsRaw && !category && !topic) ? "a competitor name or category"
      : (!hasFocus && !location) ? "a role/persona, company category, or location"
      : null;
    if (missingField) {
      return await replyAndReturn(
        `I have ${sourceLabel} selected — I just need ${missingField} to run the search. Reply with that and Scout will start. Nothing will be sent.`,
        { lead_brief_missing_field: true, source_type: submittedSourceType, lead_request: lr },
      );
    }

    const competitors = competitorsRaw ? competitorsRaw.split(/[,;]+/).map((c) => c.trim()).filter(Boolean) : undefined;
    const req: LeadRequest = {
      source_type: effSource, mode,
      target_role: role || undefined, industry: industry || undefined, location: location || undefined,
      company_category: category || undefined, topic: topic || undefined, stage: stage || undefined,
      competitors, post_url: postUrl || undefined,
      count, needs_outreach: false,
      original_user_request: message, company_brain_context_used: brainReady,
    };
    const ti = leadRequestToToolInput(req);

    // Capability gate — if the selected source's actor isn't runtime-configured,
    // show an HONEST unavailable state + fallback. Never reopen the selector,
    // never silently reroute to jobs. (Main product rule.)
    const runActor = getActorByKey(ti.selected_actor_key);
    const actorReady = !!runActor && isActorRuntimeEnabled(runActor);
    if (!actorReady) {
      const cap = getSourceCapability(effSource);
      const companiesReq: LeadRequest = { ...req, source_type: "company_search", mode: "companies" };
      if (ti.selected_actor_key === "apify_people_search") {
        return await replyAndReturn(
          `People/profile search isn't configured yet, so I can't pull individual ${role || "founder"} profiles. I can instead find matching companies/accounts${category ? ` (${category})` : ""}, or LinkedIn engagement signals — which would you like? Nothing will be sent.`,
          { lead_people_unavailable: true, source_unavailable: true, source_type: submittedSourceType,
            ui_actions: [
              { label: "Search companies / accounts instead", message: leadRequestToCompaniesInstruction(companiesReq) },
              { label: "Use LinkedIn engagement instead", message: leadRequestToLinkedInFallbackInstruction(req) },
            ] },
        );
      }
      // Comments / posts-disabled / other sources → honest message + LinkedIn/company fallback.
      return await replyAndReturn(
        cap?.unavailable_message ?? "That lead source isn't configured yet. I can search companies/accounts or LinkedIn intent posts instead. Nothing will be sent.",
        { source_unavailable: true, source_type: submittedSourceType,
          ui_actions: [
            { label: "Search LinkedIn intent posts instead", message: leadRequestToLinkedInFallbackInstruction(req) },
            { label: "Search companies / accounts instead", message: leadRequestToCompaniesInstruction(companiesReq) },
          ] },
      );
    }

    // Clearer instruction copy (Fix 3) for the ICP people/company shapes.
    const ind = industry ? ` in ${industry}` : "";
    const where = location && !/^any/i.test(location) ? ` in ${location}` : "";
    let instruction: string;
    if (effSource === "people_profiles") {
      instruction = `Find ${count} ${role || "founder"} profiles${category ? ` at ${category}` : ""}${ind}${where}. Open results in Workbench. Do not send outreach.`;
    } else if (effSource === "company_search") {
      instruction = `Find ${count} ${category || "companies"}${ind}${where}${role ? ` where a ${role.toLowerCase()} or owner is likely the decision-maker` : ""}. Open results in Workbench. Do not send outreach.`;
    } else {
      instruction = leadRequestToInstruction(req);
    }

    console.log("[pilot-chat] submitted lead brief", { source_type: submittedSourceType, effSource, mode, actor: ti.selected_actor_key });
    // A LEAD-SOURCING PATH, SO IT CARRIES THE CANONICAL MISSION. Compiled from
    // the instruction actually being sent, not from the raw chat message —
    // this branch rewrites the instruction above and that rewrite is what
    // executes. Null when the request carries no hiring signal, which
    // orchestrate handles per mode.
    const briefMission = canonicalMissionForTransport(
      await compileCanonicalLeadMission({
        prompt: instruction, workspaceId, brain: brainProfile,
        // NO REGEX COUNT. The Mission states the count the user asked for, or
        // states null; nothing here re-reads the sentence to second-guess it.
        requestedCount: null,
        ledger: missionLedger,
      }));
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId: conversationId!, workspaceId, instruction,
      leadMission: briefMission,
      // The sidecar follows the mission on every branch that can reach a paid
      // run, so a bound company is never re-resolved by name downstream.
      leadBindings: resolvedBindings,
    missionOrigin: "brief_rewrite",
      toolInput: { ...ti, confidence: 0.95, missing_fields: [] } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview", providerUsed: "lovable-ai",
    });
  }

  // 5c.ii-b Lead intake — "Find me leads / prospects / buyers / companies".
  // Load brain → if the brief is complete, run Scout directly with a
  // deterministic source + count; otherwise render the interactive Lead Search
  // Brief card (prefilled from the Company Brain; the user's input still wins).
  if (isLeadIntakeRequest(message)) {
    const details = extractLeadDetails(message);
    if (hasEnoughToRun(details)) {
      const req: LeadRequest = {
        mode: details.mode!,
        target_role: details.target_role ?? undefined,
        industry: details.industry ?? undefined,
        location: details.location ?? undefined,
        company_category: details.company_category ?? undefined,
        buying_signal: details.buying_signal ?? undefined,
        count: details.count ?? 5,
        needs_outreach: details.needs_outreach,
        original_user_request: message,
        company_brain_context_used: brainReady,
      };
      const ti = leadRequestToToolInput(req);
      // Capability check — never promise/run a missing actor. People/profile
      // search requires the people actor to be enabled; if not, offer an honest
      // fallback (LinkedIn engagement or companies) instead of delegating.
      if (req.mode === "people" && ti.selected_actor_key === "apify_people_search") {
        const actor = getActorByKey("apify_people_search");
        if (!actor || !isActorRuntimeEnabled(actor)) {
          return await replyAndReturn(
            "People/profile search is not configured yet. I can still find likely founders through LinkedIn engagement signals, or you can enable the people-search actor.",
            {
              lead_people_unavailable: true,
              note: "Enable the people-search actor by setting APIFY_ENABLE_PEOPLE_SEARCH (+ actor id).",
              ui_actions: [
                { label: "Use LinkedIn engagement search instead", message: leadRequestToLinkedInFallbackInstruction(req) },
                { label: "Search companies / accounts instead", message: leadRequestToCompaniesInstruction(req) },
              ],
            },
          );
        }
      }
      const intakeInstruction = leadRequestToInstruction(req);
      // ── THE MISSION IS COMPILED FROM THE USER'S OWN SENTENCE ───────────────
      //
      // Same rule as the submitted-brief path above: a lead-sourcing branch
      // carries the canonical mission rather than letting orchestrate infer one.
      //
      // But it is compiled from `req.original_user_request`, NOT from
      // `intakeInstruction`. That instruction is a machine rewrite: this branch
      // ran `extractLeadDetails(message)` — a regex reading of role, industry,
      // location, category and count — and `leadRequestToInstruction` reassembles
      // those fields into a synthetic sentence. Compiling from it meant a regex
      // decided the semantics and the model only re-read its summary, and the
      // Mission's `original_user_query` — the field the whole contract calls
      // immutable — held a rewrite rather than what the user typed.
      //
      // The rewrite is still what EXECUTES as the step instruction, and `ti` is
      // still the provider input the parse produced. Only the interpretation
      // moves back to the user's words.
      const intakeMission = canonicalMissionForTransport(
        await compileCanonicalLeadMission({
          prompt: req.original_user_request || intakeInstruction,
          workspaceId, brain: brainProfile,
          requestedCount: null,
          ledger: missionLedger,
        }));
      return await delegateToOrchestrate({
        admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
        conversationId, workspaceId, instruction: intakeInstruction,
        leadMission: intakeMission,
        // The sidecar follows the mission on every branch that can reach a paid
        // run, so a bound company is never re-resolved by name downstream.
        leadBindings: resolvedBindings,
    missionOrigin: "lead_intake",
        toolInput: {
          ...ti, confidence: 0.9, missing_fields: [],
        } as unknown as ToolInput,
        modelUsed: "google/gemini-3-flash-preview",
        providerUsed: "lovable-ai",
      });
    }
    // Vague / incomplete → Lead Source Selector (7 engines, brain-prefilled,
    // with honest fallbacks for unconfigured actors). No Apify runs from here.
    const actorOn = (key: string): boolean => { const a = getActorByKey(key); return !!a && isActorRuntimeEnabled(a); };
    const availability: ToolAvailability = {
      people: actorOn("apify_people_search"),
      comments: actorOn("apify_linkedin_post_comments"),
      firecrawl: !!Deno.env.get("FIRECRAWL_API_KEY"),
    };
    const selector = buildLeadSourceSelector(details, brainProfile, brainReady, availability);
    const intro = brainReady
      ? "Choose the type of leads you want Scout to find — I've prefilled defaults from your Company Brain. Nothing will be sent."
      : "Choose the type of leads you want Scout to find. (Completing your Company Brain lets me prefill these and rank results to your ICP.)";
    return await replyAndReturn(intro, { ui_form: selector, clarification: true, lead_intake: true, lead_source_selector: true });
  }

  // 5c.iii Capabilities / agent_management / approval_review / simple_chat
  // → direct conversational reply.
  // REMOVED: simple_chat -> the converse route, which reads the message instead of greeting.

  const CAPABILITIES_GENERIC =
    "Agentory is an AI workforce OS for founders and small teams. I coordinate a five-agent team: Scout (sourcing/signals), Aria (ranking/scoring), Hawk (research/URL analysis), Penn (outreach drafts — approval-gated), Scribe (content/reports). Tools include Apify for structured sourcing, Firecrawl for URL/website analysis, Gemini/Claude for reasoning and writing, and approval-gated email. Tell me what you'd like to do — find leads, analyze a careers page, write a post, draft outreach, or get a daily brief.";
  // REMOVED: capabilities -> the converse route.

  const AGENT_MGMT_GENERIC =
    "Your AI workforce: Scout (sources companies hiring + candidate profiles), Aria (ranks and scores leads), Hawk (researches URLs and competitors with Firecrawl), Penn (drafts outreach — never sends without your approval), Scribe (writes posts, briefs, reports). Pilot (me) routes the work. Ask me to do something concrete and I'll assign the right agent.";
  // REMOVED: agent_management -> the converse route.

  // REMOVED: approval_review -> the read route, entity `approval`.

  // 5c.iii-b Phase 7 — Founder Content + Engagement Loop. content_creation +
  // engagement search. Deterministic staged plan in orchestrate: Scribe (post,
  // Claude-preferred) → Scout (LinkedIn search) → Aria (rank) → [Scribe comments]
  // → [Penn DMs]. Must precede the Scribe-only content_creation branch.
  // REMOVED: content_engagement_loop -> the compound route, which reads it as the two parts it is.

  // 5c.iv content_creation → Scribe-only delegation. No Apify/Firecrawl.
  // REMOVED: content_creation -> the compose route, kind `content`.

  // 5c.v market_research → honest reply when live search is not configured.
  //
  // ASKS THE CAPABILITY DIRECTLY. This tested `!decision.selected_actor_key`,
  // which the classifier leaves unset so the validator can fill or clear it —
  // so whether the user got the truth depended on three components agreeing
  // about one null. The sentence and the rule both live in
  // `marketResearchSurface` now, reached identically from here and from the
  // route above.
  // REMOVED: market_research -> the market_research route, which asks the capability directly.

  // 5c.v-0 Phase 4.2 — extract commenters from a specific post (opt-in actor;
  // validator already returned the honest fallback above if it's disabled).
  // REMOVED: extract_commenters -> the signal_sourcing route, kind `post_commenters`.

  // 5c.v-a Phase 4 (dynamic) — Competitor DISCOVERY. Resolve business context
  // from inline (decision) + company_brain; if none, ask for it. Otherwise
  // delegate to orchestrate's discovery plan (website → Firecrawl-first).
  // REMOVED: competitor_discovery -> the signal_sourcing route, kind `competitor_discovery`.

  // 5c.v-b Phase 3 — LinkedIn engagement signal sourcing. The actor is enabled
  // (validator passed above; if it were disabled we'd have returned the honest
  // fallback already). Delegate to orchestrate's staged LinkedIn plan.
  // REMOVED: signal_sourcing (engagement) -> the signal_sourcing route, kind `engagement`.

  // 5c.vi signal_sourcing (vague) → brain-aware recommendation, or gate.
  // REMOVED: vague signal sourcing -> the converse route, which already reasons over the Brain.

  // 5c.vii unclear → targeted clarification menu. No plan, no tool.
  // REMOVED: unclear -> the converse route answers, grounded, instead of a canned menu.

  // Phase 4 (consolidation) — workflowClassifier is the PRIMARY decision layer.
  // company_hiring_sourcing and people_sourcing are resolved deterministically
  // here (no second classifyIntent + planToolInput round-trip, no chance of the
  // legacy people-vs-companies two-option card overriding the 7-option Lead
  // Source Selector). Disabled-actor cases were already returned honestly by the
  // validator (5c.i) and lead intake (5c.ii-b) above, so reaching here means the
  // selected actor is available.

  // ── PHASE 5 REMOVED: THE CATEGORY-LIST CONFIRMATION GATE ────────────────
  //
  // It showed a confirmation card when `decision.workflow_category` was one of
  // seven names. Reaching this point now means Chat Brain did NOT route the
  // request — every route returns above — so there is no category here to check
  // and nothing generic left to confirm.
  //
  // Confirmation itself is unchanged and is owned by the paths that spend: the
  // compose route gates outreach through `showWorkflowConfirmation`, the lead
  // brief and intake paths gate themselves, and `Route.requires_confirmation`
  // states the rule for anything new.

  // REMOVED: company_hiring_sourcing -> the lead_mission route compiles and delegates a mission.

  // REMOVED: people_sourcing -> the lead_mission route compiles and delegates a mission.

  // For url_analysis / outreach (and any residual) we fall through to the legacy
  // classifyIntent + planToolInput pipeline as a DEEP FALLBACK only. It still
  // handles Firecrawl URL analysis and the explicit "people or companies?"
  // clarification for genuinely ambiguous asks the classifier left unresolved.



  // 6. Load last 20 messages for context
  const { data: history } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const msgs: Msg[] = (history ?? [])
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .map((m: any) => ({ role: m.role, content: m.content }));

  // 6b. Load company brain for context
  const { data: brainRow } = await admin
    .from("company_brain")
    .select("profile, onboarding_completed")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const brain = (brainRow?.profile ?? {}) as Record<string, unknown>;
  const pilotSystem = getAgentorySystemPrompt({
    taskType: "pilot_router",
    currentAgent: "pilot",
    companyBrain: brain,
    actorRegistrySummary: summarizeRegistryForPrompt(),
    availableTools: ["apify", "firecrawl", "resend"],
  }) + "\n\n" + PILOT_SYSTEM_PROMPT + "\n\n" + renderMemoryForPrompt(memory);

  // ── 6c REMOVED: THE SECOND SEMANTIC CLASSIFIER ──────────────────────────
  //
  // `classifyIntent(message)` ran here — a THIRD reader of the user's sentence,
  // after `workflowClassifier` and after Chat Brain. It fed `planToolInput`,
  // which read the sentence again to pick an actor. So a message that Chat Brain
  // had already understood could be reinterpreted twice more, and the last
  // reading won.
  //
  // It is also where `mission_not_compiled` came from. A correctly understood
  // sourcing request fell past every category branch into this fallback, which
  // delegated on `tool_input` alone with no mission, and orchestrate refused it.
  //
  // WHAT REPLACES IT: nothing. That is the point. A request is understood once;
  // if Chat Brain cannot read it, the honest outcome is a conversational reply
  // or a stated failure, never a second brain quietly having another go. The
  // onboarding gate that lived at 6c.0 moved to the objective, where it no
  // longer needs a classifier vocabulary to express itself.

  // 7. Otherwise let Pilot decide (simple_chat / daily_brief fallthrough / content).
  const ai = await generateJson({
    taskType: "pilot_chat",
    systemPrompt: pilotSystem,
    messages: msgs,
    temperature: 0.4,
    maxTokens: 1024,
    functionName: "pilot-chat",
    workspaceId,
  });

  await logProviderCall(admin, {
    workspace_id: workspaceId,
    function_name: "pilot-chat",
    task_type: "pilot_chat",
    provider: ai.provider,
    model: ai.model,
    success: ai.ok,
    latency_ms: ai.latencyMs,
    error_code: ai.errorCode,
    prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
  });

  const providerUsed = ai.provider !== "none" ? ai.provider : "lovable-ai";
  const modelUsed = ai.model || "google/gemini-3-flash-preview";

  // 7b. Total provider failure — return a safe message but 200 so chat keeps working.
  if (!ai.ok || (!ai.content && !ai.json)) {
    console.error("[pilot-chat] provider failed:", ai.error);
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Pilot is online, but the AI provider is temporarily unavailable. I saved your message — you can retry.",
        agent_slug: "pilot",
        model_used: modelUsed,
        is_error: true,
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: conversationId, message: saved, provider: providerUsed, error: ai.error });
  }

  const pilotDecision = coerceDecision(ai.json);

  // 8a. Unparseable — degrade gracefully: treat the raw text as a plain reply.
  if (!pilotDecision) {
    const fallback = (ai.content || "").trim() || "I'm not sure how to respond to that. Could you rephrase?";
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: fallback,
        agent_slug: "pilot",
        model_used: modelUsed,
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: conversationId, message: saved, parse_fallback: true, provider: providerUsed });
  }

  // 8b. Reply branch
  if (pilotDecision.decision === "reply") {
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: pilotDecision.text,
        agent_slug: "pilot",
        model_used: modelUsed,
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: conversationId, message: saved, provider: providerUsed });
  }


  // 8c. Delegate branch — call the shared orchestrate helper.
  return await delegateToOrchestrate({
    admin,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    authHeader,
    conversationId,
    workspaceId,
    instruction: pilotDecision.instruction,
    toolInput: null,
    modelUsed,
    providerUsed,
  });
}


// ── A THROWN REQUEST MUST STILL ANSWER THE USER ────────────────────────────
//
// TEST 2026-08-21. The OpenAI balance ran out, so the GPT mission compiler was
// refused twice and raised `MissionCompilationFailedError` — correctly: it
// declines to substitute a regex reading of the user's request for a mission it
// could not compile.
//
// `Deno.serve` had no catch around it. So the correct refusal became an
// unhandled throw, Deno answered 500 with no body the UI could render, and the
// chat showed NOTHING AT ALL. Four messages were sent that afternoon and every
// one of them vanished. The user's report was "the software is not working",
// which is exactly right and says nothing about which of a hundred things it
// might be.
//
// A refusal the user cannot see is indistinguishable from a crash. This turns
// every escape from the handler into a message in the conversation — the same
// shape a normal reply has, so the UI renders it with no change — and leaves
// the throw itself in the logs where it belongs.

interface FailureContext {
  admin?: { from: (t: string) => any };
  conversationId?: string | null;
}

/** What the user is told. Honest about the class, silent about internals. */
function failureMessageFor(e: unknown): string {
  if (e instanceof MissionCompilationFailedError) {
    // NAMES THE STAGE, NOT THE CAUSE — DELIBERATELY, AND NO LONGER FOR LACK OF
    // KNOWING IT.
    //
    // The compiler CAN now tell a quota outage from a timeout: the error
    // carries `providerCode`, and `[pilot-chat][unhandled]` logs it. That is
    // where a cause belongs. Telling an end user "the account is out of
    // credits" exposes an operational detail they cannot act on and would not
    // be true for the other codes that reach this branch, so the message stays
    // exactly as it was: what failed, what it means for them, what to do.
    return "I could not read your request into a plan just now — the AI service " +
      "that interprets it did not respond. Nothing was started and nothing was " +
      "charged. Please try again in a moment; if it keeps happening, the AI " +
      "provider configuration needs checking.";
  }
  return "Something went wrong handling that message. Nothing was started and " +
    "nothing was charged. Please try again.";
}

Deno.serve(async (req) => {
  const fail: FailureContext = {};
  try {
    return await handlePilotChat(req, fail);
  } catch (e) {
    // LOUD IN THE LOGS, CALM IN THE CHAT. The stack is what a maintainer needs
    // and the last thing a user does.
    console.error("[pilot-chat][unhandled]", {
      error: String(e),
      // THE PROVIDER'S OWN CODE, where the failure had one. `quota_exhausted`
      // here is the difference between "the chat is broken" and "top up the
      // account" — and it used to be absent, which is why the second reading
      // took a manual API call to reach.
      provider_code: e instanceof MissionCompilationFailedError ? e.providerCode : null,
      provider_detail: e instanceof MissionCompilationFailedError ? e.providerDetail : null,
      kind: e instanceof MissionCompilationFailedError
        ? "mission_compilation_failed" : "unexpected",
      conversation_id: fail.conversationId ?? null,
    });

    const content = failureMessageFor(e);
    // NO CONVERSATION MEANS THE FAILURE HAPPENED BEFORE ONE EXISTED — auth, a
    // malformed body. There is nowhere to put a message, so the status code is
    // the whole answer, and it is at least a truthful one.
    if (!fail.admin || !fail.conversationId) {
      return json({ error: "pilot_chat_failed", message: content }, 500);
    }

    try {
      const { data: saved } = await fail.admin
        .from("messages")
        .insert({
          conversation_id: fail.conversationId,
          role: "assistant",
          content,
          agent_slug: "pilot",
          // ── THE CATEGORY SURVIVES THE TURN ──────────────────────────
          //
          // This wrote `{ type, kind }` and nothing else, discarding
          // `String(e)` and the provider code that were already in scope one
          // line above. So a missing capability, a provider outage and a
          // ReferenceError were all stored as "unexpected", and the six turns
          // taken out by a temporal dead zone were indistinguishable in the
          // database from a transient glitch worth retrying.
          metadata: failureMetadata(e, {
            kind: e instanceof MissionCompilationFailedError
              ? "mission_compilation_failed" : "unexpected",
            provider_code: e instanceof MissionCompilationFailedError
              ? e.providerCode : null,
          }),
        })
        .select("*")
        .single();
      // THE SHAPE OF A NORMAL REPLY, deliberately. A distinct error envelope
      // would need the UI to learn a second one, and the UI is not the thing
      // that was broken.
      return json({
        type: "reply", conversation_id: fail.conversationId, message: saved,
      });
    } catch (saveError) {
      // The database is the last thing standing between the user and silence.
      console.error("[pilot-chat][unhandled][save-failed]", String(saveError));
      return json({ error: "pilot_chat_failed", message: content }, 500);
    }
  }
});
