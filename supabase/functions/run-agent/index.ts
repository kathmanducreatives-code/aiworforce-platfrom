// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, normalizeApifySourceType } from "../_shared/toolRegistry.ts";
import { generateText, logProviderCall } from "../_shared/aiProvider.ts";
import { preferredProviderForAgent } from "../_shared/providerRouting.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { renderCompanyBrainBlock } from "../_shared/companyBrainContext.ts";
import { decideWorkspaceAccess } from "../_shared/workspaceAccessGuard.ts";
import { separateIntent } from "../_shared/leadIntentModel.ts";
import { classifyRoleFamily, type RoleFamily } from "../_shared/roleFamilyMatcher.ts";
import { buildCanonicalStamp } from "../_shared/leadCanonicalStamp.ts";
import { stepAllowedInMode, isSourceAndQualifyOnly } from "../_shared/executionMode.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria, buildProvenanceRecord, assertPersistenceProvenance, type NormalizedProviderIndex, type ProvenanceCtx } from "../_shared/leadHandoffGuard.ts";
import { newRejectionCounter, sealProvenance, buildNoResults, type RejectionCounter } from "../_shared/leadPersistenceGuard.ts";
import { classifyProviderSourceOutcome, type ProviderSourceReason } from "../_shared/leadSourcingGate.ts";
import { resolvePlannedTool, isProviderSourcingTool, resolveProviderSource } from "../_shared/plannedToolResolver.ts";
import { parsePeopleSearchIntent, buildPeopleSearchAttempts } from "../_shared/peopleSearchQueryBuilder.ts";
import { extractCandidateLocationEvidence } from "../_shared/locationMatch.ts";


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



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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

  if (!plan_id || step_index === undefined || (!agent_slug && !agent_id_in) || !workspace_id || !instruction) {
    return json({ error: "missing_required_fields" }, 400);
  }

  // ---- Workspace access guard ------------------------------------------------
  // orchestrate calls with the SERVICE_ROLE bearer (already gated the user). A
  // direct browser call carries a user JWT and MUST be a member of workspace_id,
  // so a frontend-supplied workspace_id cannot reach another workspace's brain.
  {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bearerIsServiceRole = !!bearer && bearer === serviceRoleKey;

    let authenticatedUserId: string | null = null;
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

  // Insert task row with real columns.
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      plan_id,
      agent_slug,
      user_id: user_id ?? null,
      status: "running",
      payload: { instruction, input, step_index },
    })
    .select("id")
    .single();

  if (taskErr || !task) {
    console.error("[run-agent] failed to insert task:", taskErr);
    return json({ error: "task_insert_failed", details: taskErr?.message }, 500);
  }

  await supabase.from("activity_feed").insert({
    workspace_id,
    plan_id,
    agent_id: agent.id,
    event_type: "agent_started",
    title: `${agent.name} started`,
    body: instruction,
    metadata: { step_index, task_id: task.id, agent_slug },
  });

  // ---- Live Workbench lead actions (Research company / Find decision-makers /
  // Generate outreach). Additive early-return: only runs when the caller passes
  // tool_input.lead_action + lead_candidate_ids. Evidence-first + approval-gated;
  // Firecrawl/Apify are called per-company via runTool; nothing is ever sent.
  const leadAction = tool_input_body?.lead_action as string | undefined;
  if (leadAction === "research_company" || leadAction === "find_decision_makers" || leadAction === "generate_outreach") {
    // A lead action operates on EXISTING selected rows. Never fall through to
    // Scout sourcing: with no ids, refuse explicitly instead of starting a search.
    const { validateLeadActionRequest } = await import("../_shared/leadActionExecutor.ts");
    const valid = validateLeadActionRequest(leadAction, tool_input_body?.lead_candidate_ids);
    if (!valid.ok) {
      await supabase.from("tasks").update({ status: "failed", error_message: valid.error }).eq("id", task.id);
      return json({ success: false, task_id: task.id, status: "failed", error: valid.error, message: valid.message }, 400);
    }
    const leadIds = valid.ids;
    const toolCtx = { admin: supabase, workspace_id, agent_slug, agent_id: agent.id, agent_name: agent.name, plan_id, task_id: task.id, user_id: user_id ?? null };
    try {
      const { executeLeadAction } = await import("../_shared/leadActionExecutor.ts");
      const outcome = await executeLeadAction(leadAction as "research_company" | "find_decision_makers" | "generate_outreach", leadIds, {
        admin: supabase, workspace_id, plan_id, task_id: task.id, agent_id: agent.id,
        agent_slug, agent_name: agent.name, user_id: user_id ?? null, runTool, toolCtx,
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
          title: `${agent.name} needs approval`, description: instruction, status: "pending",
        });
      }
      await supabase.from("activity_feed").insert({
        workspace_id, plan_id, agent_id: agent.id,
        event_type: outcome.needs_approval ? "awaiting_approval" : "agent_completed",
        title: `${agent.name}: ${leadAction.replace(/_/g, " ")}`, body: outcome.summary,
        metadata: { step_index, task_id: task.id, lead_action: leadAction },
      });
      return json({ success: true, task_id: task.id, status: outcome.needs_approval ? "awaiting_approval" : "complete", summary: outcome.summary, per_lead: outcome.per_lead });
    } catch (e) {
      console.error("[run-agent] lead_action failed:", e);
      await supabase.from("tasks").update({ status: "failed", error_message: String(e) }).eq("id", task.id);
      return json({ success: false, task_id: task.id, status: "failed", error: "lead_action_failed" }, 500);
    }
  }

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
  // AI Source Planner artifacts (carried into the Scout task result so the final
  // step can render Workbench Insights + a definitive process narrative).
  let sourcePlanMeta: Record<string, unknown> | null = null;
  let sourceQualityMeta: Record<string, unknown> | null = null;
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
      user_id: user_id ?? null,
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
      if (!raw_source_type && !planned_actor_key) {
        const resolvedSource = resolveProviderSource(instruction ?? input ?? "");
        if (resolvedSource) {
          source_type = resolvedSource.source_type;
          derivedActorKey = resolvedSource.actor_key;
        }
      }

      const shouldRun = agent_slug === "scout" || agent_slug === "hawk";

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

        const effectiveAccepted = lieAcceptedItems ?? gateAcceptedItems ?? adaptive.accepted;
        const effectiveFound = (lieAcceptedItems ?? gateAcceptedItems) ? (lieAcceptedItems ?? gateAcceptedItems)!.length : adaptive.found;

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
            role: criteria.role, industry: criteria.industry ?? (strict.industry ? null : criteria.query), location: criteria.location,
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
            providerProvenanceCtx = { provider: "apify", actor_id: planned_actor_key ?? "apify", provider_run_id: run_id, workflow_run_id: run_id, plan_id: String(plan_id ?? ""), trace_id: run_id, query_id: null };
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
        if (gatedAccepted.length > 0) {
          // Persist ONLY the role-family-filtered + gate-passing set so
          // wrong-role / no-proof / off-ICP rows never reach Workbench.
          const rawItems = gatedAccepted.map((a) => a.raw);
          const attachAccounts = Array.isArray(tool_input_body?.attach_to_accounts) ? tool_input_body.attach_to_accounts : null;

          if (attachAccounts && attachAccounts.length > 0) {
            // Contact discovery: ATTACH discovered decision-makers to existing
            // account rows (no new leads, no invented contacts) instead of creating.
            try {
              const { planContactAttachments } = await import("../_shared/contactDiscovery.ts");
              const plan = planContactAttachments(rawItems, attachAccounts as Array<{ lead_candidate_id: string; company: string; signal_role?: string | null }>);
              
              const candidateIds = attachAccounts.map(a => a.lead_candidate_id).filter(Boolean);
              if (candidateIds.length > 0) {
                await supabase.from("lead_candidates").update({ plan_id }).in("id", candidateIds);
              }

              for (const att of plan) {
                const { data: c } = await supabase.from("contacts").insert({
                  workspace_id,
                  full_name: att.contact.name,
                  title: att.contact.title,
                  linkedin_url: att.contact.linkedin_url,
                  email: att.contact.email,
                  raw: { source: att.contact.source, via: "contact_discovery", confidence: att.contact.confidence },
                }).select("id").maybeSingle();
                if (c?.id) await supabase.from("lead_candidates").update({ contact_id: c.id }).eq("id", att.lead_candidate_id);
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
                selected_actor_key: planned_actor_key ?? null,
                // Provider provenance context — invalid provenance now BLOCKS the
                // lead_candidates insert (no verified=false ride-along).
                provider: "apify",
                actor_id: planned_actor_key ?? "apify",
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
          toolNotices.push(`Scout reviewed ${rawAllItems.length} raw result${rawAllItems.length === 1 ? "" : "s"} but found 0 verified matches. I did not fill the table with weak results.${reasonStr}`);
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
    const skipBroadResearch = execution_mode_body === "fast"
      || tool_input_body?.tool_name === "source_with_apify"
      || tool_input_body?.competitor_discovery === true
      || !!tool_input_body?.discovery_mode;
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
    await supabase.from("tasks").update({ status: "failed", error_message: sourcingFailure.error, result: { error: sourcingFailure.error, message: failMsg, result_status: "no_results", reason: failReason, qualified_count: 0, contact_ready_count: 0, persisted_lead_count: 0, provider_calls: 0, next_step: null } }).eq("id", task.id);
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
          source_type: (tool_input_body?.source_type as string) ?? source_type ?? null,
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
        result_status: "no_results",
        qualified_count: 0,
        contact_ready_count: 0,
        persisted_lead_count: 0,
        rejected_provenance_count: noResults.rejected_provenance_count,
        rejected_provenance_reasons: provenanceRejections.reasons,
        next_step: null,
        provider_calls: providerSourceReason ? 0 : undefined,
        reason: providerSourceReason ?? undefined,
        attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined,
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
    result: { output: apiText, tokens_in: tokensIn, tokens_out: tokensOut, attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined, source_plan: sourcePlanMeta ?? undefined, source_quality: sourceQualityMeta ?? undefined },
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
        user_id,
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
        const outcome = buildOutcomeReport({ counts: qCounts, requested, has_contacts: canDraft });
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
