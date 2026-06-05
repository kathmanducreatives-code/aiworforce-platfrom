// pilot-chat: the user-facing chat entry point.
// Decides whether to reply directly or delegate to the workforce via orchestrate.
// Input: { message, workspace_id, conversation_id? }
// Auth:  verify_jwt = true (user identity needed for conversations.user_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { classifyIntent } from "../_shared/intentRouter.ts";
import { planToolInput, type ToolInput } from "../_shared/toolInputPlanner.ts";


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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


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
  const brainBlock = Object.keys(brain).length
    ? `\n\nCOMPANY BRAIN (workspace context — use to ground every decision):\n${JSON.stringify(brain, null, 2)}`
    : `\n\nCOMPANY BRAIN: (empty — workspace has not completed onboarding yet. If the user asks for work that requires company context, suggest completing onboarding at /onboarding/company-brain.)`;

  // 7. Ask Pilot brain via the AI provider adapter (Lovable AI Gateway default).
  const ai = await generateJson({
    taskType: "pilot_chat",
    systemPrompt: PILOT_SYSTEM_PROMPT + brainBlock,
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

  const decision = coerceDecision(ai.json);

  // 8a. Unparseable — degrade gracefully: treat the raw text as a plain reply.
  if (!decision) {
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
  if (decision.decision === "reply") {
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: decision.text,
        agent_slug: "pilot",
        model_used: modelUsed,
      })
      .select("*")
      .single();
    return json({ type: "reply", conversation_id: conversationId, message: saved, provider: providerUsed });
  }


  // 8c. Delegate branch — call orchestrate server-to-server, forwarding the user JWT.
  const orchResponse = await fetch(`${SUPABASE_URL}/functions/v1/orchestrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader, // forward user JWT so orchestrate's membership check passes
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      user_instruction: decision.instruction,
      workspace_id: workspaceId,
    }),
  });
  const orchBody = await orchResponse.json().catch(() => ({}));

  if (!orchResponse.ok) {
    console.error("[pilot-chat] orchestrate failed:", orchResponse.status, orchBody);
    const errMsg = `I started building a plan but the orchestrator failed: ${orchBody?.error ?? "unknown"}`;
    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: errMsg,
        agent_slug: "pilot",
        model_used: modelUsed,

        is_error: true,
      })
      .select("*")
      .single();
    return json(
      {
        type: "reply",
        conversation_id: conversationId,
        message: saved,
        error: `orchestrate ${orchResponse.status}: ${JSON.stringify(orchBody)}`,
      },
      502
    );
  }

  const planSummary: string = orchBody?.plan_summary ?? "(no summary)";
  const planId: string = orchBody?.task_plan_id ?? orchBody?.plan_id ?? "";
  const stepsCount: number = orchBody?.total_steps ?? orchBody?.steps_count ?? 0;
  const agents: string[] = Array.isArray(orchBody?.agents) ? orchBody.agents : [];
  const connectorsMissing: string[] = Array.isArray(orchBody?.connectors_missing) ? orchBody.connectors_missing : [];
  const planSteps: any[] = Array.isArray(orchBody?.plan?.steps) ? orchBody.plan.steps : [];

  const agentNames: Record<string, string> = { scout: "Scout", aria: "Aria", penn: "Penn", hawk: "Hawk", scribe: "Scribe" };
  const chain = planSteps
    .map((s) => {
      const name = agentNames[s.agent_slug] ?? s.agent_slug;
      const verb = (s.task_title || "").toString().toLowerCase() || "work the step";
      return `${name} will ${verb}`;
    })
    .join(", ");

  const needsApproval = planSteps.some((s) => s.requires_approval && s.tool_needed === "send_email");
  const approvalNote = needsApproval ? " Penn will pause for your approval before sending." : "";
  const connectorNote = connectorsMissing.length
    ? ` Heads up: ${connectorsMissing.join(" ")} I'll continue with available tools.`
    : "";


  const announce = stepsCount > 0
    ? `I created a ${stepsCount}-step plan: ${chain}.${approvalNote}${connectorNote}`
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
      }
    : {};

  const { data: announced } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: announce,
      agent_slug: "pilot",
      model_used: modelUsed,
      metadata: announceMetadata,
    })
    .select("*")
    .single();

  return json({
    type: "plan",
    conversation_id: conversationId,
    plan_id: planId,
    plan_title: planTitle,
    plan_summary: planSummary,
    steps_count: stepsCount,
    agents,
    connector_limitations: connectorsMissing,
    message: announced,
  });
});
