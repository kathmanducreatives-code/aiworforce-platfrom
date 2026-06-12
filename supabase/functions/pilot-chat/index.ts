// pilot-chat: the user-facing chat entry point.
// Decides whether to reply directly or delegate to the workforce via orchestrate.
// Input: { message, workspace_id, conversation_id? }
// Auth:  verify_jwt = true (user identity needed for conversations.user_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { classifyIntent } from "../_shared/intentRouter.ts";
import { planToolInput, type ToolInput } from "../_shared/toolInputPlanner.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { classifyWorkflow, SHORT_VAGUE_CLARIFICATION } from "../_shared/workflowClassifier.ts";
import { validateAgainstCapabilities } from "../_shared/capabilityValidator.ts";
import { loadConversationMemory, renderMemoryForPrompt, isFollowUpReference, extractTopN, type ConversationMemory } from "../_shared/memoryReader.ts";


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

  if (!message || !workspaceId) {
    return json({ error: "message and workspace_id are required" }, 400);
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

  // 5. Persist user message
  await admin.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message,
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

  // 5c.0 Phase 2: follow-up shortcuts driven by persistent memory.
  // Only triggers when message references previous results AND we have memory.
  const followUpRef = isFollowUpReference(message);
  const hasLeads = memory.lead_candidates.length > 0;
  const draftOutreachRe = /\b(draft|write|send)\s+(outreach|emails?|messages?)\b/i;
  const filterRe = /\b(only keep|filter|narrow|just keep|drop the|exclude)\b/i;
  const enrichRe = /\b(enrich|research|look up|dig into)\b/i;

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

  // 5c.iii Capabilities / agent_management / approval_review / simple_chat
  // → direct conversational reply.
  if (decision.workflow_category === "simple_chat") {
    return await replyAndReturn("Hi — I'm Pilot. What would you like to work on?");
  }

  if (decision.workflow_category === "capabilities") {
    const msg =
      "Agentory is an AI workforce OS for founders and small teams. I coordinate a five-agent team: Scout (sourcing/signals), Aria (ranking/scoring), Hawk (research/URL analysis), Penn (outreach drafts — approval-gated), Scribe (content/reports). Tools include Apify for structured sourcing, Firecrawl for URL/website analysis, Gemini/Claude for reasoning and writing, and approval-gated email. Tell me what you'd like to do — find leads, analyze a careers page, write a post, draft outreach, or get a daily brief.";
    return await replyAndReturn(msg);
  }

  if (decision.workflow_category === "agent_management") {
    const msg =
      "Your AI workforce: Scout (sources companies hiring + candidate profiles), Aria (ranks and scores leads), Hawk (researches URLs and competitors with Firecrawl), Penn (drafts outreach — never sends without your approval), Scribe (writes posts, briefs, reports). Pilot (me) routes the work. Ask me to do something concrete and I'll assign the right agent.";
    return await replyAndReturn(msg);
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

  // 5c.v-b Phase 3 — LinkedIn engagement signal sourcing. The actor is enabled
  // (validator passed above; if it were disabled we'd have returned the honest
  // fallback already). Delegate to orchestrate's staged LinkedIn plan.
  if (decision.workflow_category === "signal_sourcing" && decision.selected_actor_key === "apify_linkedin_posts") {
    return await delegateToOrchestrate({
      admin, SUPABASE_URL, SUPABASE_ANON_KEY, authHeader,
      conversationId, workspaceId, instruction: message,
      toolInput: {
        intent: "signal_sourcing",
        tool_name: "source_with_apify",
        selected_actor_key: "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: decision.query ?? message,
        role_keywords: [],
        location: decision.location ?? null,
        max_results: Math.max(1, Math.min(20, decision.max_results ?? 10)),
        needs_enrichment: false,
        needs_outreach: !!decision.needs_dm_drafts,
        execution_mode: decision.execution_mode,
        confidence: decision.confidence,
        missing_fields: [],
        reason: "linkedin_engagement signal sourcing",
        keywords: decision.keywords ?? [],
        needs_comment_drafts: !!decision.needs_comment_drafts,
        needs_dm_drafts: !!decision.needs_dm_drafts,
      } as unknown as ToolInput,
      modelUsed: "google/gemini-3-flash-preview",
      providerUsed: "lovable-ai",
    });
  }

  // 5c.vi signal_sourcing (vague) → ask one clarification.
  if (decision.workflow_category === "signal_sourcing" && decision.needs_clarification) {
    return await replyAndReturn(
      decision.clarification_question ??
        "Which buying signal should I target first: companies hiring GTM roles, companies hiring engineering roles, founder profiles, or a specific niche?",
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
