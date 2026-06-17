// pilot-chat: the user-facing chat entry point.
// Decides whether to reply directly or delegate to the workforce via orchestrate.
// Input: { message, workspace_id, conversation_id? }
// Auth:  verify_jwt = true (user identity needed for conversations.user_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, generateText, logProviderCall } from "../_shared/aiProvider.ts";
import { classifyIntent } from "../_shared/intentRouter.ts";
import { planToolInput, type ToolInput } from "../_shared/toolInputPlanner.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { classifyWorkflow, SHORT_VAGUE_CLARIFICATION } from "../_shared/workflowClassifier.ts";
import { validateAgainstCapabilities } from "../_shared/capabilityValidator.ts";
import { loadConversationMemory, renderMemoryForPrompt, isFollowUpReference, extractTopN, type ConversationMemory } from "../_shared/memoryReader.ts";
import { shouldGateForOnboarding, ONBOARDING_GATE_REPLY } from "../_shared/companyBrainGate.ts";
import { isLeadIntakeRequest, hasNewSourcingIntent, extractLeadDetails, hasEnoughToRun, buildLeadSourceSelector, leadRequestToToolInput, leadRequestToInstruction, leadRequestToLinkedInFallbackInstruction, leadRequestToCompaniesInstruction, type LeadRequest, type ToolAvailability } from "../_shared/leadIntake.ts";
import { getActorByKey, isActorRuntimeEnabled } from "../_shared/actorRegistry.ts";
import { isFindContactsRequest, personaForAccounts, buildContactSearchQueries, contactDiscoveryFallback, type AccountForContacts } from "../_shared/contactDiscovery.ts";
import { buildCompanyBrainContext, hasUsableBrain, brainCompetitors } from "../_shared/companyBrainContext.ts";


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

// ---------- Delegation helper ----------

interface DelegateArgs {
  admin: ReturnType<typeof createClient>;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  authHeader: string;
  conversationId: string;
  workspaceId: string;
  instruction: string;
  toolInput?: ToolInput | null;
  modelUsed: string;
  providerUsed: string;
}

async function delegateToOrchestrate(a: DelegateArgs): Promise<Response> {
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
      tool_input: a.toolInput ?? null,
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
  // pipeline so "save these leads" can't trigger a re-source.
  const saveOnlyRe = /\b(save|keep)\b[^.!?]*\b(signal feed|for (?:now|later)|review(?:\s+later)?|saved)\b/i;
  if (saveOnlyRe.test(message) && hasLeads && !newSourcing) {
    return await replyAndReturn(
      `Kept your ${memory.lead_candidates.length} leads in the Signal Feed — nothing was sent. Ask me to rank, enrich, or draft outreach whenever you're ready.`,
      { post_lead_action: "save_only", reused_memory: true, credits: 0 },
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
  // unknown actor) → surface its clarification and stop.
  if (!validated.ok && validated.clarification) {
    return await replyAndReturn(validated.clarification, {
      clarification: true,
      validator_reason: validated.reason ?? null,
    });
  }

  // 5c.ii Unsafe / unsupported → safe canned reply with alternatives.
  if (decision.workflow_category === "unsafe_or_unsupported") {
    const msg =
      "I can't run that as described — it would involve unsafe or unsupported actions (e.g. scraping private personal data or sending without your approval). I can help with: public business contact research, approval-gated email outreach, LinkedIn outreach drafts, or call scripts. Which of those would you like?";
    return await replyAndReturn(msg, { unsafe: true });
  }

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
    })).filter((a) => a.company);
    const persona = personaForAccounts(accounts);
    const peopleOn = (() => { const a = getActorByKey("apify_people_search"); return !!a && isActorRuntimeEnabled(a); })();

    if (!peopleOn) {
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
        intent: "source_people", tool_name: "source_with_apify", selected_actor_key: "apify_people_search",
        source_type: "people_profiles", query: queries.join(", "), role_keywords: persona.personas.map((p) => p.toLowerCase()),
        location: null, max_results: Math.max(1, Math.min(25, accounts.length)),
        needs_enrichment: false, needs_outreach: false, execution_mode: "fast", confidence: 0.85, missing_fields: [],
        reason: "contact discovery: attach decision-makers to account opportunities",
        // run-agent attaches results to these accounts (match by company; no invent).
        attach_to_accounts: accounts.map((a) => ({ lead_candidate_id: a.lead_candidate_id, company: a.company, signal_role: a.signal_role })),
        user_input: { keywords: queries },
      } as unknown as ToolInput,
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
      return await delegateToOrchestrate({
        admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
        conversationId, workspaceId, instruction: leadRequestToInstruction(req),
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

  // For url_analysis / people_sourcing / company_hiring_sourcing / outreach
  // we fall through to the legacy classifyIntent + planToolInput pipeline,
  // which already handles people-vs-companies clarification persistence and
  // Apify/Firecrawl ToolInput building.



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
