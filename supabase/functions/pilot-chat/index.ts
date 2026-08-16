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
import { classifyIntent } from "../_shared/intentRouter.ts";
import { planToolInput, type ToolInput } from "../_shared/toolInputPlanner.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { classifyWorkflow, SHORT_VAGUE_CLARIFICATION } from "../_shared/workflowClassifier.ts";
import { validateAgainstCapabilities } from "../_shared/capabilityValidator.ts";
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
import { compileLeadMission } from "../_shared/leadMissionCompiler.ts";
import {
  runtimeIdentity, LEAD_INTELLIGENCE_CONTRACT_VERSION,
} from "../_shared/leadRuntimeIdentity.ts";
import {
  buildMissionCompilerBinding, MissionCompilationFailedError,
} from "../_shared/leadMissionCompilerBinding.ts";
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
  const compilerBinding = buildMissionCompilerBinding({ workspaceId: i.workspaceId });
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
  });

  const mission = buildMissionForPrompt(i.prompt, i.requestedCount, brainContext, gptProposal);

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
  const intelligence = getLeadIntelligenceCapabilities(i.workspaceId);
  if (
    intelligence.mode === "new_architecture" &&
    mission.mission_parser_source === "deterministic_fallback"
  ) {
    throw new MissionCompilationFailedError(i.workspaceId, compilerBinding.enablement.reason);
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
    const cardMission = buildMissionForPrompt(prompt, null, cardBrainContext, gptProposal);
    if (
      getLeadIntelligenceCapabilities(workspaceId).mode === "new_architecture" &&
      cardMission.mission_parser_source === "deterministic_fallback"
    ) {
      throw new MissionCompilationFailedError(workspaceId, compilerBinding.enablement.reason);
    }
    return buildHiringConfirmation(prompt, cardMission, company, cardBrainLite);
  }

  const systemPrompt = `You are a GTM AI workforce coordinator. The user wants to run a business workflow.
Your goal is to parse their request and generate a structured workflow confirmation object.
Use the following templates as your reference for matching workflows:
1. ID: "find_hiring_signal_accounts"
   Name: "Find hiring-signal accounts"
   Team: ["pilot", "scout", "aria"]
   Inputs: {"count": number (default 5), "source": "hiring signals", "industry": "...", "location": "...", "persona": "..."}
   Output: "Account opportunities in Workbench"
   Safety: "Nothing will be sent. Draft-only by default."
   Estimated Credits: 5

2. ID: "find_decision_makers"
   Name: "Find decision-makers"
   Team: ["pilot", "scout"]
   Inputs: {"count": number (default 5), "industry": "...", "location": "...", "persona": "..."}
   Output: "Decision-maker contacts in Workbench"
   Safety: "Nothing will be sent. Draft-only by default."
   Estimated Credits: 5

3. ID: "enrich_companies"
   Name: "Enrich target companies"
   Team: ["pilot", "hawk"]
   Inputs: {"count": number (default 5), "industry": "...", "location": "..."}
   Output: "Company details and context in Workbench"
   Safety: "Nothing will be sent."
   Estimated Credits: 5

4. ID: "draft_outreach"
   Name: "Draft outreach sequences"
   Team: ["pilot", "penn"]
   Inputs: {"count": number (default 5), "persona": "..."}
   Output: "Outreach drafts in Awaiting You"
   Safety: "Nothing will be sent. Draft-only by default."
   Estimated Credits: 5

5. ID: "linkedin_post_from_signals"
   Name: "Create LinkedIn content"
   Team: ["pilot", "scribe"]
   Inputs: {"topic": "...", "style": "tactical insight"}
   Output: "Social post drafts in content draft panel"
   Safety: "Nothing will be sent."
   Estimated Credits: 5

6. ID: "website_audit"
   Name: "Website Audit"
   Team: ["pilot", "hawk", "scribe"]
   Inputs: {"url": "..."}
   Output: "Website audit report in report panel"
   Safety: "Nothing will be sent."
   Estimated Credits: 5

7. ID: "competitor_snapshot"
   Name: "Competitor Snapshot"
   Team: ["pilot", "hawk", "aria"]
   Inputs: {"competitor": "..."}
   Output: "Competitor analysis report"
   Safety: "Nothing will be sent."
   Estimated Credits: 5

Use these default company values if the user's prompt is missing them:
- Company Industry: "\${company.industry ?? "B2B SaaS"}"
- Company Location: "\${company.location ?? "USA"}"
- Target Persona: "\${icp.buyer_roles?.[0] ?? "Founder / Head of Growth"}"

Response format: Return ONLY a JSON object of this structure:
{
  "workflow_id": "string",
  "workflow_name": "string",
  "goal": "string (clear, concise description of the user request)",
  "agent_team": ["pilot", "scout", ...],
  "inputs": { ... },
  "output": "string",
  "safety": "string",
  "estimated_credits": number
}`;

  try {
    const ai = await generateJson({
      taskType: "helper",
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 500,
      jsonMode: true,
      functionName: "generateWorkflowConfirmation",
      workspaceId,
    });
    if (ai.ok && ai.json) {
      return ai.json;
    }
  } catch (e) {
    console.error("generateWorkflowConfirmation failed:", e);
  }

  return {
    workflow_id: "find_hiring_signal_accounts",
    workflow_name: "Find hiring-signal accounts",
    goal: prompt,
    agent_team: ["pilot", "scout", "aria"],
    inputs: { count: 5, source: "hiring signals", location: company.location ?? "USA", industry: company.industry ?? "B2B SaaS" },
    output: "Account opportunities in Workbench",
    safety: "Nothing will be sent. Draft-only by default.",
    estimated_credits: 5,
  };
}

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
      tool_input: toolInput ?? null,
    }),
  });
  const orchBody = await orchResponse.json().catch(() => ({} as any));

  if (!orchResponse.ok) {
    console.error("[pilot-chat] orchestrate failed:", orchResponse.status, orchBody);
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

Deno.serve(async (req) => {
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

  // 5. Persist user message (carries card-action metadata when applicable)
  await admin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message,
    metadata: actionSource ? { action_source: actionSource, ...(actionMetadata ?? {}) } : null,
  });

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
    if (meta && meta.pending_clarification === true) {
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
              pending_clarification: true,
              clarification_type: "people_unavailable",
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
                pending_clarification: true,
                clarification_type: "agency_unavailable",
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
              pending_clarification: true,
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

  // 5b. Daily-brief intent: deterministic route to daily-brief function.
  const DAILY_BRIEF_RE =
    /^\s*(brief me( on today)?|daily brief|today'?s (command )?brief|give me today'?s (command )?brief|what should i know today\??|what happened today\??|plan my day|what needs my attention\??)\s*[.!?]?\s*$/i;
  if (DAILY_BRIEF_RE.test(message)) {
    try {
      const briefResp = await fetch(`${SUPABASE_URL}/functions/v1/daily-brief`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ workspace_id: workspaceId, conversation_id: conversationId }),
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
      console.warn("[pilot-chat] daily-brief non-2xx, falling through:", briefResp.status);
    } catch (e) {
      console.warn("[pilot-chat] daily-brief threw, falling through:", e);
    }
  }

  // 5c. NEW: Workflow Classifier (Phase 1) — single source of truth.
  // Regex-first with Gemini fallback. Short-circuits direct-reply categories
  // and degraded paths; falls through to the legacy planner for sourcing,
  // url_analysis, and outreach categories so the existing pending-clarification
  // persistence keeps working unchanged.
  const wf = await classifyWorkflow(message);
  const validated = validateAgainstCapabilities(wf);
  const decision = validated.decision;

  // Lead Intelligence Engine — confirmed-Start honor. When the user clicks Start
  // on a workflow-confirmation card, the card threads back the ORIGINAL
  // lead_intent (workflow_type + source_type + role family + aliases/excludes).
  // Trust it instead of re-classifying the "Run workflow: …" command string,
  // which would otherwise misroute an assistant-hiring Start to people search.
  const confirmedLeadIntent = (isPreConfirmed && actionMetadata?.lead_intent && typeof actionMetadata.lead_intent === "object")
    ? actionMetadata.lead_intent as Record<string, unknown>
    : null;
  if (confirmedLeadIntent && typeof confirmedLeadIntent.workflow_type === "string") {
    decision.workflow_category = confirmedLeadIntent.workflow_type as typeof decision.workflow_category;
    if (typeof confirmedLeadIntent.source_type === "string") decision.source_type = confirmedLeadIntent.source_type;
    if (confirmedLeadIntent.workflow_type === "company_hiring_sourcing") decision.selected_actor_key = "apify_jobs";
    decision.needs_clarification = false;
    console.log("[pilot-chat] confirmed lead_intent honored:", { category: decision.workflow_category, source_type: decision.source_type, role_family: confirmedLeadIntent.role_family });
  }

  console.log("[pilot-chat] workflow_classifier:", {
    category: decision.workflow_category,
    confidence: decision.confidence,
    needs_clarification: decision.needs_clarification,
    selected_actor_key: decision.selected_actor_key,
    execution_mode: decision.execution_mode,
    validator_ok: validated.ok,
    validator_reason: validated.reason,
  });

  // Phase 2: load persistent signal memory for this conversation.
  const memory: ConversationMemory = await loadConversationMemory({
    admin,
    workspace_id: workspaceId,
    conversation_id: conversationId,
    limit: 50,
  });
  console.log("[pilot-chat] memory:", {
    has_any_memory: memory.has_any_memory,
    leads: memory.lead_candidates.length,
    drafts: memory.outreach_drafts.length,
    outputs: memory.saved_outputs.length,
    last_plan_id: memory.last_plan_id,
  });

  const baseMeta = {
    workflow_category: decision.workflow_category,
    business_goal: decision.business_goal,
    intent: decision.intent,
    confidence: decision.confidence,
    execution_mode: decision.execution_mode,
    selected_actor_key: decision.selected_actor_key,
    selected_tool: decision.selected_tool,
    requires_approval: decision.requires_approval,
    classifier_source: decision.source,
    prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
  };

  async function replyAndReturn(content: string, extraMeta: Record<string, unknown> = {}): Promise<Response> {
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content,
        agent_slug: "pilot",
        model_used: "google/gemini-3-flash-preview",
        metadata: { ...baseMeta, ...extraMeta },
      })
      .select("*")
      .single();
    return json({
      type: "reply",
      conversation_id: conversationId,
      workflow_category: decision.workflow_category,
      message: saved,
    });
  }

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
  if (decision.workflow_category === "unsafe_or_unsupported") {
    return await replyAndReturn(
      "I can't run that as described — it would involve unsafe or unsupported actions (e.g. scraping private personal data or sending without your approval). I can help with: public business contact research, approval-gated email outreach, LinkedIn outreach drafts, or call scripts. Which of those would you like?",
      { unsafe: true },
    );
  }

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
      return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, baseMeta, "outreach");
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
  const SOURCING_CATEGORIES = ["company_hiring_sourcing", "people_sourcing", "signal_sourcing"];
  const isSourcingFollowup = SOURCING_CATEGORIES.includes(decision.workflow_category);

  if (followUpRef && !isSourcingFollowup) {
    if (!memory.has_any_memory) {
      // Honest fallback — no prior results to act on. For outreach we surface
      // the specific guard reason so the UI/metadata can distinguish it.
      const isOutreach = decision.workflow_category === "outreach" || draftOutreachRe.test(message);
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
        return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, baseMeta, "outreach");
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
        return await showWorkflowConfirmation(message, conversationId!, workspaceId, admin, baseMeta, "url_analysis");
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
  if (!validated.ok && validated.clarification && !hasSubmittedBrief) {
    return await replyAndReturn(validated.clarification, {
      clarification: true,
      validator_reason: validated.reason ?? null,
    });
  }

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
      }));
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId: conversationId!, workspaceId, instruction,
      leadMission: briefMission,
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
        }));
      return await delegateToOrchestrate({
        admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
        conversationId, workspaceId, instruction: intakeInstruction,
        leadMission: intakeMission,
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
  if (decision.workflow_category === "simple_chat") {
    const greeting = brainReady
      ? `Hi — I'm Pilot for your workspace. What would you like to work on?`
      : "Hi — I'm Pilot. What would you like to work on?";
    return await replyAndReturn(greeting);
  }

  const CAPABILITIES_GENERIC =
    "Agentory is an AI workforce OS for founders and small teams. I coordinate a five-agent team: Scout (sourcing/signals), Aria (ranking/scoring), Hawk (research/URL analysis), Penn (outreach drafts — approval-gated), Scribe (content/reports). Tools include Apify for structured sourcing, Firecrawl for URL/website analysis, Gemini/Claude for reasoning and writing, and approval-gated email. Tell me what you'd like to do — find leads, analyze a careers page, write a post, draft outreach, or get a daily brief.";
  if (decision.workflow_category === "capabilities") {
    if (brainReady) {
      return await personalizedReply(
        `The user asked what Agentory can do. Briefly name the five agents (Scout sourcing/signals, Aria ranking, Hawk research/URLs, Penn approval-gated outreach, Scribe content) and the tools (Apify, Firecrawl, Gemini/Claude, approval-gated email). THEN recommend the 2–3 most useful workflows for THIS company given its ICP and goals. User message: "${message}"`,
        CAPABILITIES_GENERIC,
        { capabilities: true },
      );
    }
    return await replyAndReturn(CAPABILITIES_GENERIC);
  }

  const AGENT_MGMT_GENERIC =
    "Your AI workforce: Scout (sources companies hiring + candidate profiles), Aria (ranks and scores leads), Hawk (researches URLs and competitors with Firecrawl), Penn (drafts outreach — never sends without your approval), Scribe (writes posts, briefs, reports). Pilot (me) routes the work. Ask me to do something concrete and I'll assign the right agent.";
  if (decision.workflow_category === "agent_management") {
    if (brainReady) {
      return await personalizedReply(
        `The user is asking about the AI team/agents. Describe the five agents (Scout, Aria, Hawk, Penn — approval-gated — and Scribe) and, given this company's goals, note which agents are most relevant to them right now. Keep it tight. User message: "${message}"`,
        AGENT_MGMT_GENERIC,
        { agent_management: true },
      );
    }
    return await replyAndReturn(AGENT_MGMT_GENERIC);
  }

  if (decision.workflow_category === "approval_review") {
    // Phase 1 patch: pending approvals live in the `approvals` table (Penn writes
    // them there). Prefer it; fall back to tasks.status='awaiting_approval' for
    // older flows that only created tasks.
    let pending: any[] = [];
    let approvalSource: "approvals" | "tasks" = "approvals";
    const { data: approvalRows, error: approvalsErr } = await admin
      .from("approvals")
      .select("id, agent_slug, title, summary, description, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    if (!approvalsErr && approvalRows && approvalRows.length > 0) {
      pending = approvalRows;
    } else {
      approvalSource = "tasks";
      const { data: taskRows } = await admin
        .from("tasks")
        .select("id, agent_slug, description, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "awaiting_approval")
        .order("created_at", { ascending: false })
        .limit(10);
      pending = taskRows ?? [];
    }
    if (pending.length === 0) {
      return await replyAndReturn(
        "No drafts are waiting for approval right now. When Penn drafts outreach, it will appear here for you to review.",
        { approval_source: approvalSource },
      );
    }
    const lines = pending
      .map((t: any) => `• ${t.agent_slug ?? "agent"}: ${t.title ?? t.description ?? t.summary ?? t.id}`)
      .join("\n");
    return await replyAndReturn(
      `You have ${pending.length} pending approval${pending.length === 1 ? "" : "s"}:\n${lines}\n\nOpen the Workbench to approve or edit each draft.`,
      { approval_source: approvalSource, pending_count: pending.length },
    );
  }

  // 5c.iii-b Phase 7 — Founder Content + Engagement Loop. content_creation +
  // engagement search. Deterministic staged plan in orchestrate: Scribe (post,
  // Claude-preferred) → Scout (LinkedIn search) → Aria (rank) → [Scribe comments]
  // → [Penn DMs]. Must precede the Scribe-only content_creation branch.
  if (decision.execution_mode === "content_engagement_loop") {
    return await delegateToOrchestrate({
      admin,
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      authHeader,
      conversationId,
      workspaceId,
      instruction: message,
      toolInput: {
        intent: "content_engagement_loop",
        tool_name: "source_with_apify",
        selected_actor_key: "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: decision.query ?? message,
        role_keywords: [],
        location: null,
        max_results: Math.max(1, Math.min(10, decision.max_results ?? 5)),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_dm_drafts,
        execution_mode: "content_engagement_loop",
        confidence: decision.confidence,
        missing_fields: [],
        reason: decision.reason,
        signal_type: decision.signal_type ?? "linkedin_engagement",
        needs_content: true,
        needs_engagement_search: true,
        needs_comment_drafts: !!decision.needs_comment_drafts,
        needs_dm_drafts: !!decision.needs_dm_drafts,
        competitor_related: !!decision.competitor_related,
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.iv content_creation → Scribe-only delegation. No Apify/Firecrawl.
  if (decision.workflow_category === "content_creation") {
    return await delegateToOrchestrate({
      admin,
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      authHeader,
      conversationId,
      workspaceId,
      instruction: message,
      // ToolInput drives the legacy orchestrator's mode; content mode tells it
      // to skip sourcing tools and go straight to Scribe. NOTE: orchestrate's
      // Scribe-only staged template keys off intent === "content_creation".
      toolInput: {
        intent: "content_creation",
        tool_name: null,
        selected_actor_key: null,
        source_type: null,
        query: message,
        role_keywords: [],
        location: null,
        max_results: 1,
        needs_enrichment: false,
        needs_outreach: false,
        // execution_mode "content" is supported by the legacy ToolInput type
        // ("fast"|"deep"|"outreach"), so we coerce to "fast" and pass content
        // intent — orchestrate keys off intent=create_content for Scribe-only.
        execution_mode: "fast",
        confidence: decision.confidence,
        missing_fields: [],
        reason: decision.reason,
      } as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.v market_research → if validator degraded (no search_web), honest reply.
  if (decision.workflow_category === "market_research" && !decision.selected_actor_key) {
    const msg =
      "Broad live web search isn't configured in this workspace, so I can't pull current market or competitor news on demand. What I can do: analyze a specific URL with Hawk + Firecrawl (paste the link), or collect structured signals with Scout + Apify (e.g. \"find companies hiring AI engineers in the US\"). Which would help most?";
    return await replyAndReturn(msg, { degraded: "search_web_unavailable" });
  }

  // 5c.v-0 Phase 4.2 — extract commenters from a specific post (opt-in actor;
  // validator already returned the honest fallback above if it's disabled).
  if (decision.extract_commenters) {
    const urls = (decision.post_urls ?? []).filter((u) => /linkedin\.com/i.test(u));
    if (urls.length === 0) {
      return await replyAndReturn(
        "Which LinkedIn post should I pull commenters from? Paste the post URL.",
        { clarification: true, clarification_type: "commenters_need_post_url" },
      );
    }
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId, workspaceId, instruction: message,
      toolInput: {
        intent: "extract_commenters",
        tool_name: "source_with_apify",
        selected_actor_key: "apify_linkedin_post_comments",
        source_type: "linkedin_comments",
        query: message,
        role_keywords: [],
        location: null,
        max_results: Math.max(1, Math.min(50, decision.max_results ?? 20)),
        needs_enrichment: false,
        needs_outreach: false,
        execution_mode: "fast",
        confidence: decision.confidence,
        missing_fields: [],
        reason: "extract_commenters",
        extract_commenters: true,
        user_input: { postUrls: urls },
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.v-a Phase 4 (dynamic) — Competitor DISCOVERY. Resolve business context
  // from inline (decision) + company_brain; if none, ask for it. Otherwise
  // delegate to orchestrate's discovery plan (website → Firecrawl-first).
  if (decision.competitor_discovery) {
    let website = decision.business_website ?? null;
    let description = decision.business_description ?? null;
    // Always load the company brain so we can seed KNOWN competitors (source
    // order steps 1-2: user-provided + company_brain.competitors.known) and fall
    // back to the saved profile for website/description.
    const { data: cbRow } = await admin
      .from("company_brain").select("profile").eq("workspace_id", workspaceId).maybeSingle();
    const profile = (cbRow?.profile ?? {}) as Record<string, unknown>;
    if (!website && !description) {
      const what = [profile.what_we_do, profile.who_we_sell_to].filter((x) => typeof x === "string" && x).join(". ");
      if (typeof profile.website === "string" && profile.website) website = profile.website as string;
      else if (what) description = what;
    }
    // Known competitors: user-provided (matched by classifier) ∪ brain. These let
    // Scout search real names even if Hawk infers nothing — and never require Perplexity.
    const knownCompetitors = Array.from(new Set([
      ...((decision.competitors ?? []) as string[]),
      ...brainCompetitors(profile),
    ].map((c) => String(c).trim()).filter(Boolean)));
    const mode = website ? "website" : (description ? "description" : (knownCompetitors.length > 0 ? "description" : "needs_context"));
    if (mode === "needs_context") {
      return await replyAndReturn(
        "To find your competitors, share your website, LinkedIn company page, or a one-line description of what you sell — or set up your company profile and I'll use that.",
        { clarification: true, clarification_type: "competitor_discovery_needs_context" },
      );
    }
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId, workspaceId, instruction: message,
      toolInput: {
        intent: "competitor_discovery",
        tool_name: "source_with_apify",
        selected_actor_key: "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: description ?? website ?? message,
        role_keywords: [],
        location: null,
        max_results: Math.max(1, Math.min(20, decision.max_results ?? 5)),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_dm_drafts,
        execution_mode: decision.execution_mode,
        confidence: decision.confidence,
        missing_fields: [],
        reason: `competitor_discovery (${mode})`,
        signal_type: "competitor_engagement",
        competitor_discovery: true,
        discovery_mode: mode,
        business_website: website,
        business_description: description,
        // Known competitors flow to Scout (and the inference→search threading) so
        // the LinkedIn search uses real names/categories, never the raw description.
        competitors: knownCompetitors,
        needs_comment_drafts: !!decision.needs_comment_drafts,
        needs_dm_drafts: !!decision.needs_dm_drafts,
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.v-b Phase 3 — LinkedIn engagement signal sourcing. The actor is enabled
  // (validator passed above; if it were disabled we'd have returned the honest
  // fallback already). Delegate to orchestrate's staged LinkedIn plan.
  if (decision.workflow_category === "signal_sourcing" &&
      (decision.selected_actor_key === "apify_linkedin_posts" || decision.selected_actor_key === "apify_linkedin_profile_posts")) {
    const isProfilePosts = decision.selected_actor_key === "apify_linkedin_profile_posts";
    // Profile-posts needs target URLs; extract LinkedIn URLs from the message.
    const targetUrls = isProfilePosts
      ? (message.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company|school|showcase)\/[A-Za-z0-9_\-%.]+/ig) ?? [])
      : [];
    if (isProfilePosts && targetUrls.length === 0) {
      return await replyAndReturn(
        "Which LinkedIn profile or company page should I pull recent posts from? Paste one or more LinkedIn URLs.",
        { clarification: true, clarification_type: "linkedin_profile_posts_needs_urls" },
      );
    }
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId, workspaceId, instruction: message,
      toolInput: {
        intent: "signal_sourcing",
        tool_name: "source_with_apify",
        selected_actor_key: decision.selected_actor_key,
        source_type: "linkedin_engagement",
        query: decision.query ?? message,
        role_keywords: [],
        location: decision.location ?? null,
        max_results: Math.max(1, Math.min(20, decision.max_results ?? 5)),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_dm_drafts,
        execution_mode: decision.execution_mode,
        confidence: decision.confidence,
        missing_fields: [],
        reason: (decision.signal_type === "competitor_engagement" ? "competitor_engagement" : "linkedin_engagement") + " signal sourcing",
        signal_type: decision.signal_type ?? "linkedin_engagement",
        competitors: decision.competitors ?? [],
        keywords: decision.keywords ?? [],
        needs_comment_drafts: !!decision.needs_comment_drafts,
        needs_dm_drafts: !!decision.needs_dm_drafts,
        // Pass expanded search queries + (profile mode) target URLs to the actor adapter.
        user_input: {
          ...(decision.keywords && decision.keywords.length > 0 ? { keywords: decision.keywords } : {}),
          ...(isProfilePosts ? { targetUrls } : {}),
        },
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.vi signal_sourcing (vague) → brain-aware recommendation, or gate.
  if (decision.workflow_category === "signal_sourcing" && decision.needs_clarification) {
    // Business-specific prompt with NO usable brain → ask for Company Brain.
    // Never scrape random leads, never fall back to a generic signal menu.
    if (!brainReady) {
      return await replyAndReturn(ONBOARDING_GATE_REPLY, {
        gated: "missing_brain",
        clarification: true,
      });
    }
    // Brain ready → recommend contextual lead strategies grounded in the brain.
    return await personalizedReply(
      `The user asked to find leads/prospects but didn't specify a buying signal. Using the Company Brain, recommend a contextual lead strategy — do NOT ask a generic "which signal" menu. Reference their ICP, goals, and competitors naturally. Prefer this order: (1) LinkedIn engagement signals tied to their ICP/category, (2) competitor engagement if competitors are known, (3) companies hiring relevant (GTM/eng) roles, (4) website/company research. End by offering to start with 5 signals saved to the Signal Feed — no outreach, nothing sent without approval. User message: "${message}"`,
      decision.clarification_question ??
        "Tell me a bit more about the buying signal you want to target and I'll start sourcing.",
      { clarification: true, possible_actions: decision.possible_actions },
    );
  }

  // 5c.vii unclear → targeted clarification menu. No plan, no tool.
  if (decision.workflow_category === "unclear") {
    return await replyAndReturn(
      decision.clarification_question ?? SHORT_VAGUE_CLARIFICATION,
      { clarification: true, clarification_type: "unclear" },
    );
  }

  // Phase 4 (consolidation) — workflowClassifier is the PRIMARY decision layer.
  // company_hiring_sourcing and people_sourcing are resolved deterministically
  // here (no second classifyIntent + planToolInput round-trip, no chance of the
  // legacy people-vs-companies two-option card overriding the 7-option Lead
  // Source Selector). Disabled-actor cases were already returned honestly by the
  // validator (5c.i) and lead intake (5c.ii-b) above, so reaching here means the
  // selected actor is available.

  // Phase 5 — Workflow Confirmation Gate.
  // When a user types a workflow request in chat (not from Dashboard, Workflows,
  // or an already-confirmed card action), show a structured confirmation card
  // instead of immediately running. Pre-confirmed sources bypass this.
  const CONFIRMABLE_CATEGORIES = ["company_hiring_sourcing", "people_sourcing", "signal_sourcing", "outreach", "content_creation", "url_analysis", "market_research"];
  const needsConfirmation = !isPreConfirmed && CONFIRMABLE_CATEGORIES.includes(decision.workflow_category);

  if (needsConfirmation) {
    console.log("[pilot-chat] workflow_confirmation_gate: showing card", { category: decision.workflow_category, actionSource });
    const confirmation = await generateWorkflowConfirmation(
      message, workspaceId, admin, decision.workflow_category);
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
      workflow_category: decision.workflow_category,
      workflow_confirmation: true,
      message: saved,
    });
  }

  if (decision.workflow_category === "company_hiring_sourcing") {
    // ── COMPILE THE CANONICAL MISSION FOR THE RUN THAT IS ABOUT TO HAPPEN ──
    //
    // Once, here, on the Start request. The confirmation card compiled one for
    // the PREVIEW, but that was a different HTTP request and its result was
    // never carried forward — which is why execution had been running on
    // `planToolInput()` output alone.
    //
    // It is compiled FIRST because everything below is now derived from it.
    const compiledLeadMission = canonicalMissionForTransport(
      await compileCanonicalLeadMission({
        prompt: message,
        workspaceId,
        brain: brainProfile,
        requestedCount: null,
      }));

    // Lead Intelligence Engine: prefer the lead_intent the confirmation card
    // threaded back on Start (the ORIGINAL request's role family + aliases +
    // excludes); otherwise project it from the Mission just compiled. It used to
    // be re-derived with `extractLeadIntent(message)` — a regex reading of the
    // same sentence, deciding the run's role family beside the Mission.
    const leadIntent = confirmedLeadIntent ?? leadIntentForToolInput(compiledLeadMission, brainProfile);
    const li = leadIntent as Record<string, unknown> | null;
    const liRoleKeywords = (li && Array.isArray(li.role_keywords) && li.role_keywords.length) ? li.role_keywords as string[] : (decision.role_keywords ?? []);
    const liQuery = (li && Array.isArray(li.role_keywords) && li.role_keywords.length) ? (li.role_keywords as string[]).slice(0, 12).join(" OR ") : (decision.query ?? message);

    // ROUTING PRECEDENCE — the Mission's qualified-Lead decision wins over the
    // legacy jobs-actor pin. When the Mission says the user asked for people to
    // contact (e.g. "find 5 founders of SaaS startups hiring Sales Operations"),
    // we MUST NOT hardcode `selected_actor_key: "apify_jobs"` / `source_type:
    // "jobs"` here: doing so pins the request to the legacy fast/account_first
    // branch in run-agent (index.ts:638 gate `!raw_source_type &&
    // !planned_actor_key`) and the whole company-first sourcing stack (Company
    // Brain gate → founder/CEO search → CONTACT-only quota) becomes
    // unreachable. Instead we leave both fields unset so run-agent's entity
    // router picks the actor from the Mission's decided entity, and we flip
    // execution_mode to "company_first" so orchestrate + run-agent both
    // recognise the contract. Non-qualified account/job-only requests keep the
    // previous deterministic apify_jobs behavior.
    //
    // This used to be `routeQualifiedLead(message)`, a phrase table re-reading
    // the sentence the Mission had just been compiled from.
    const qlRoute = compiledLeadMission
      ? qualifiedLeadRouteFromMission(compiledLeadMission)
      : routeQualifiedLead(message);
    const isQualifiedLead = qlRoute.workflowKind === "qualified_lead_sourcing";

    // THE QUOTA IS THE MISSION'S. It used to be
    // `extractRequestedLeadCount(message) ?? clamp(decision.max_results ?? 5)`:
    // a regex reading of the same sentence the Mission had just been compiled
    // from, followed by the CLASSIFIER's number — two more answers to a question
    // already answered. `effectiveRequestedCount` applies the one default.
    const requestedLeadCount = isQualifiedLead
      ? (compiledLeadMission
        ? effectiveRequestedCount(compiledLeadMission)
        : DEFAULT_REQUESTED_COUNT)
      : undefined;
    console.log("[pilot-chat][canonical-mission]", {
      workspace_id: workspaceId,
      qualified_lead: isQualifiedLead,
      compiled: compiledLeadMission != null,
      has_directives: compiledLeadMission?.directives != null,
      contract: compiledLeadMission?.lead_intelligence_contract_version ?? null,
      signals: compiledLeadMission?.required_signals?.map((s) => s.type) ?? [],
    });

    return await delegateToOrchestrate({
      leadMission: compiledLeadMission,
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader, conversationId: conversationId!, workspaceId,
      instruction: message,
      toolInput: {
        intent: isQualifiedLead ? "source_qualified_leads" : "source_companies_hiring",
        tool_name: "source_with_apify",
        // Only pin the actor/source when this is NOT a qualified-Lead mission.
        // See comment above.
        ...(isQualifiedLead ? {} : { selected_actor_key: "apify_jobs", source_type: "jobs" }),
        query: liQuery,
        role_keywords: liRoleKeywords,
        location: decision.location ?? null,
        max_results: Math.max(1, Math.min(50, decision.max_results ?? 5)),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_outreach,
        execution_mode: isQualifiedLead
          ? "company_first"
          : (decision.needs_outreach ? "outreach" : "fast"),
        // Qualified-Lead contract fields. Orchestrate ALSO calls
        // routeQualifiedLead and stamps these on the top-level body, but we
        // thread them here as well so the tool_input carries provenance
        // downstream (run-agent inspects tool_input for requested_lead_count).
        ...(isQualifiedLead ? {
          workflow_kind: "qualified_lead_sourcing",
          quota_policy: "contact_only",
          count_entity: "contact_ready_lead",
          requested_lead_count: requestedLeadCount,
        } : {}),
        confidence: decision.confidence,
        missing_fields: [],
        lead_intent: leadIntent,
        reason: isQualifiedLead
          ? `classifier: company_hiring_sourcing → qualified_lead_sourcing (routeQualifiedLead reasons: ${qlRoute.reasonCodes.join(",")})`
          : "classifier: company_hiring_sourcing → jobs (deterministic, no legacy round-trip)",
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview", providerUsed: "lovable-ai",
      workflowInputs: actionWorkflowInputs,
    });
  }

  if (decision.workflow_category === "people_sourcing") {
    // ── A LEAD PATH, SO IT CARRIES THE CANONICAL MISSION ────────────────────
    //
    // This branch delegated with NO mission at all, and with the CLASSIFIER's
    // reading of the sentence — `decision.query`, `decision.role_keywords`,
    // `decision.location`, `decision.max_results` — as the run's semantics. So
    // for a people request the regex-first workflow classifier WAS the
    // interpreter, and under `new_architecture` orchestrate then refused the
    // task outright (422 `mission_not_compiled`) because no mission arrived.
    //
    // The classifier still answers the question it owns — WHICH branch this is —
    // and its fields survive only as the fallback for a workspace with no
    // compiler enabled.
    const peopleMission = canonicalMissionForTransport(
      await compileCanonicalLeadMission({
        prompt: message, workspaceId, brain: brainProfile, requestedCount: null,
      }));
    const peopleBrain = brainProfile as any;
    const peopleIntent = peopleMission
      ? leadIntentFromMission(peopleMission, {
        icp: peopleBrain?.icp, company: peopleBrain?.company,
        competitors: peopleBrain?.competitors, positioning: peopleBrain?.positioning,
      })
      : null;
    console.log("[pilot-chat][canonical-mission]", {
      workspace_id: workspaceId,
      branch: "people_sourcing",
      compiled: peopleMission != null,
      has_directives: peopleMission?.directives != null,
    });

    return await delegateToOrchestrate({
      leadMission: peopleMission,
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader, conversationId: conversationId!, workspaceId,
      instruction: message,
      toolInput: {
        intent: "source_people",
        tool_name: "source_with_apify",
        selected_actor_key: decision.selected_actor_key ?? "apify_people_search",
        source_type: "people_profiles",
        query: decision.query ?? message,
        // WHO to look for is the Mission's decision-maker set; the classifier's
        // keyword list is what it fell back to before a mission existed.
        role_keywords: peopleIntent?.target_buyer?.length
          ? peopleIntent.target_buyer
          : (decision.role_keywords ?? []),
        location: peopleIntent?.target_geography?.[0] ?? decision.location ?? null,
        // The Mission's count, through the one runtime default; still clamped to
        // this branch's provider ceiling.
        max_results: Math.max(1, Math.min(25,
          peopleMission ? effectiveRequestedCount(peopleMission) : (decision.max_results ?? 5))),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_outreach,
        execution_mode: decision.needs_outreach ? "outreach" : "fast",
        confidence: decision.confidence,
        missing_fields: [],
        reason: "classifier: people_sourcing → people search (mission-carried)",
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview", providerUsed: "lovable-ai",
      workflowInputs: actionWorkflowInputs,
    });
  }

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

  // 6c. Intent routing — short-circuit when we don't need full Pilot reasoning.
  const intentResult = await classifyIntent(message);
  console.log("[pilot-chat] intent:", intentResult);

  // 6c.0 Onboarding gate — if Company Brain is incomplete and the user asked
  // for content/GTM work, ask them to complete onboarding instead of running
  // expensive workflows that would produce generic output.
  if (shouldGateForOnboarding(intentResult.intent, {
    onboarding_completed: brainRow?.onboarding_completed === true,
    profile: brain as Record<string, unknown>,
  })) {
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: ONBOARDING_GATE_REPLY,
        agent_slug: "pilot",
        model_used: "google/gemini-3-flash-preview",
        metadata: {
          intent: intentResult.intent,
          onboarding_gate: true,
          open_onboarding: true,
        },
      })
      .select("*")
      .single();
    return json({
      type: "reply",
      conversation_id: conversationId,
      intent: intentResult.intent,
      onboarding_gate: true,
      open_onboarding: true,
      message: saved,
    });
  }

  // 6c.i Unclear → ask one clarification, no orchestration.
  if (intentResult.intent === "unclear") {
    const clarification = "I'm not sure what you'd like me to do. Could you add a bit more detail — for example, the role/company type and a location, or a specific URL?";
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: clarification,
        agent_slug: "pilot",
        model_used: "google/gemini-3-flash-preview",
        metadata: { intent: "unclear", clarification: true },
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: conversationId, intent: "unclear", message: saved });
  }

  // 6c.ii Source-style intent → run tool input planner; may ask clarification.
  let toolInput: ToolInput | null = null;
  if (
    intentResult.intent === "source_signals" ||
    intentResult.intent === "analyze_url" ||
    intentResult.intent === "enrich_existing_leads" ||
    intentResult.intent === "draft_outreach" ||
    intentResult.intent === "send_requires_approval" ||
    intentResult.intent === "rank_existing_leads"
  ) {
    toolInput = await planToolInput(message, intentResult.intent, brain);
    console.log("[pilot-chat] tool_input:", toolInput);

    if (toolInput.ask_clarification) {
      const q = toolInput.clarification ?? "Could you share a bit more — role/company type and location would help.";
      const { data: saved } = await admin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: q,
          agent_slug: "pilot",
          model_used: "google/gemini-3-flash-preview",
          metadata: {
            intent: intentResult.intent,
            clarification: true,
            missing_fields: toolInput.missing_fields,
            pending_clarification: !!(toolInput.people_action || toolInput.companies_action || toolInput.agency_action),
            clarification_type: toolInput.clarification_type ?? "generic",
            original_request: message,
            people_action: toolInput.people_action ?? null,
            companies_action: toolInput.companies_action ?? null,
            agency_action: toolInput.agency_action ?? null,
            prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
          },
        })
        .select("*")
        .single();
      return json({
        type: "reply",
        conversation_id: conversationId,
        intent: intentResult.intent,
        clarification: true,
        message: saved,
      });
    }
  }

  // 6c.iii When we have a confident tool_input, skip the Pilot AI decision and delegate directly.
  if (toolInput && toolInput.tool_name) {
    return await delegateToOrchestrate({
      admin,
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      authHeader,
      conversationId,
      workspaceId,
      instruction: message,
      toolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
      workflowInputs: actionWorkflowInputs,
    });
  }

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
});
