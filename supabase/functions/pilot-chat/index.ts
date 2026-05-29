// pilot-chat: the user-facing chat entry point.
// Decides whether to reply directly or delegate to the workforce via orchestrate.
// Input: { message, workspace_id, conversation_id? }
// Auth:  verify_jwt = true (user identity needed for conversations.user_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, generateText, logProviderCall } from "../_shared/aiProvider.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...extra },
  });


const PILOT_SYSTEM_PROMPT = `You are Pilot, the orchestrator of a five-agent AI workforce. Your job is
to decide what to do with each user message.

The five agents you can delegate to:
  - Scout    — sourcing. Finds candidates / leads / target companies.
  - Aria     — screening. Ranks and scores candidates from a list.
  - Penn     — outreach. Writes personalized emails or DMs.
  - Hawk     — competitive intelligence. Monitors competitors, market signals.
  - Scribe   — content writing. LinkedIn posts, blog intros, job descriptions.

You can do one of two things:

1. REPLY directly. Use this for:
   - Greetings, small talk, thanks, clarifications
   - Questions about how the system works ("what can you do?", "who's on the team?")
   - Status questions about plans/agents the user just asked you about
   - Brief advice that doesn't need the agents to act
   Keep replies short (1-3 sentences). Friendly but not chatty. No emojis.
   When describing the team, use the specialisations above verbatim — do not
   invent or reshuffle them.

2. DELEGATE to the workforce. Use this when the user wants real work done.
   Examples: "find me X candidates" (Scout/Aria), "draft outreach to Y" (Penn),
   "what's competitor Z doing" (Hawk), "write a LinkedIn post about Q" (Scribe).
   You do NOT do the work — you hand the instruction off to the team and
   orchestrate plans the multi-step workflow.

Default to REPLY for ambiguous cases. Only DELEGATE when the user is
clearly asking for output from the team.

Respond with ONLY a JSON object, no prose, no markdown fences:

For a reply:
{ "decision": "reply", "text": "<your short reply>" }

For a delegation:
{ "decision": "delegate", "instruction": "<reworded user request, clear and complete enough for the team to act on>" }`;

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

  // 7. Ask Pilot brain via the AI provider adapter (Lovable AI Gateway default).
  const ai = await generateJson({
    taskType: "pilot_chat",
    systemPrompt: PILOT_SYSTEM_PROMPT,
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
        model_used: PILOT_MODEL,
        tokens_used: tokensUsed,
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
  // Deployed orchestrate returns `task_plan_id` and `total_steps` (not
  // plan_id / steps_count). Accept both for forward compatibility.
  const planId: string = orchBody?.task_plan_id ?? orchBody?.plan_id ?? "";
  const stepsCount: number = orchBody?.total_steps ?? orchBody?.steps_count ?? 0;

  // Synthetic assistant message announcing the plan
  const announce = `On it. Here's the plan: ${planSummary} (${stepsCount} step${stepsCount === 1 ? "" : "s"})`;
  const { data: announced } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: announce,
      agent_slug: "pilot",
      model_used: PILOT_MODEL,
      tokens_used: tokensUsed,
    })
    .select("*")
    .single();

  return json({
    type: "plan",
    conversation_id: conversationId,
    plan_id: planId,
    plan_summary: planSummary,
    steps_count: stepsCount,
    message: announced,
  });
});
