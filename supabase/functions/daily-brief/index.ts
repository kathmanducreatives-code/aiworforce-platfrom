// daily-brief: deterministic founder command brief for a workspace.
// Reads workspace data (task_plans, tasks, approvals, activity_feed, company_brain),
// detects connector availability, formats with AI (or falls back to deterministic markdown).
// Auth: validates JWT in code (verify_jwt=false at platform). Membership check via workspace_members.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateText } from "../_shared/aiProvider.ts";
import { isToolConfigured } from "../_shared/toolRegistry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function fmtTime(ts?: string | null): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
  } catch { return ts; }
}

function safeArr<T>(v: any): T[] { return Array.isArray(v) ? v : []; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json body" }, 400); }
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id : "";
  let conversationId: string | null = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  if (!workspaceId) return json({ error: "workspace_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // membership
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id")
    .eq("user_id", userId).eq("workspace_id", workspaceId).maybeSingle();
  if (!member) return json({ error: "Forbidden — not a member of this workspace" }, 403);

  // ensure conversation
  if (conversationId) {
    const { data: existing } = await admin.from("conversations")
      .select("id, user_id").eq("id", conversationId).maybeSingle();
    if (!existing || existing.user_id !== userId) {
      return json({ error: "Conversation not found or not yours" }, 404);
    }
  } else {
    const { data: created } = await admin.from("conversations").insert({
      user_id: userId, agent_slug: "pilot", channel: "dashboard",
      title: "Daily Brief", status: "active",
    }).select("id").single();
    conversationId = created?.id ?? null;
  }

  // ---- Collect facts in parallel ----
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [plansRes, tasksRes, approvalsRes, activityRes, brainRes] = await Promise.all([
    admin.from("task_plans")
      .select("id, goal, plan_summary, status, created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "running", "pending", "in_progress"])
      .order("created_at", { ascending: false }).limit(10),
    admin.from("tasks")
      .select("id, plan_id, agent_slug, status, description, error_message, created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "waiting", "failed", "requires_approval", "blocked"])
      .order("created_at", { ascending: false }).limit(25),
    admin.from("approvals")
      .select("id, title, description, agent_id, task_id, plan_id, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }).limit(20),
    admin.from("activity_feed")
      .select("id, title, body, event_type, agent_id, created_at, metadata")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since24h)
      .order("created_at", { ascending: false }).limit(10),
    admin.from("company_brain")
      .select("profile, onboarding_completed").eq("workspace_id", workspaceId).maybeSingle(),
  ]);

  const plans = safeArr<any>(plansRes.data);
  const tasks = safeArr<any>(tasksRes.data);
  const approvals = safeArr<any>(approvalsRes.data);
  const activity = safeArr<any>(activityRes.data);
  const brainProfile = (brainRes.data?.profile ?? {}) as Record<string, unknown>;
  const onboardingCompleted = !!brainRes.data?.onboarding_completed;

  // For each plan, count tasks + next pending task
  const planEnriched = await Promise.all(plans.map(async (p) => {
    const { data: ts } = await admin.from("tasks")
      .select("id, description, agent_slug, status, step_index")
      .eq("plan_id", p.id).order("step_index", { ascending: true });
    const all = safeArr<any>(ts);
    const next = all.find((t) => t.status === "pending" || t.status === "waiting");
    return {
      title: p.goal || p.plan_summary || "(untitled plan)",
      status: p.status,
      created_at: p.created_at,
      task_count: all.length,
      next_task: next ? `${next.agent_slug}: ${next.description ?? ""}`.trim() : null,
    };
  }));

  // Outreach (Penn)
  const outreachTasks = tasks.filter((t) => t.agent_slug === "penn");
  const outreachApprovals = approvals.filter((a: any) =>
    (a.title || "").toLowerCase().includes("email") ||
    (a.title || "").toLowerCase().includes("outreach") ||
    (a.title || "").toLowerCase().includes("penn"));

  // Connectors
  const connectors = {
    source_with_apify: isToolConfigured("source_with_apify").ready,
    scrape_url: isToolConfigured("scrape_url").ready,
    search_web: isToolConfigured("search_web").ready,
    research_web: isToolConfigured("research_web").ready,
    send_email: isToolConfigured("send_email").ready,
    lovable_ai: !!Deno.env.get("LOVABLE_API_KEY"),
  };

  // ---- Recommended Next Actions (deterministic) ----
  const actions: string[] = [];
  if (!onboardingCompleted) actions.push("Complete Company Brain setup at /onboarding/company-brain so agents can personalize work.");
  if (!connectors.source_with_apify) actions.push("Connect Apify (APIFY_API_TOKEN) to enable hiring-signal sourcing.");
  if (!connectors.scrape_url) actions.push("Connect Firecrawl (FIRECRAWL_API_KEY) to enable site/page extraction.");
  const failed = tasks.filter((t) => t.status === "failed");
  if (failed.length) actions.push(`Fix ${failed.length} failed task${failed.length > 1 ? "s" : ""}.`);
  if (approvals.length) actions.push(`Review ${approvals.length} pending approval${approvals.length > 1 ? "s" : ""}.`);
  if (!plans.length) actions.push("Start a new plan — try 'Find 20 React engineers in Berlin'.");
  const nextPending = planEnriched.find((p) => p.next_task);
  if (nextPending) actions.push(`Resume "${nextPending.title}" — next: ${nextPending.next_task}.`);
  while (actions.length > 5) actions.pop();

  // ---- Build deterministic markdown skeleton ----
  const sectionPlans = planEnriched.length
    ? planEnriched.map((p) =>
        `- **${p.title}** — ${p.status} · ${p.task_count} task(s)${p.next_task ? ` · next: ${p.next_task}` : ""} · created ${fmtTime(p.created_at)}`
      ).join("\n")
    : "No active plans yet.";

  const sectionTasks = tasks.length
    ? tasks.map((t) =>
        `- ${t.agent_slug ?? "agent"} · **${t.status}** — ${t.description ?? "(no description)"}${t.error_message ? ` · _${t.error_message}_` : ""}`
      ).join("\n")
    : "No tasks currently need attention.";

  const sectionApprovals = approvals.length
    ? approvals.map((a: any) =>
        `- **${a.title}**${a.description ? ` — ${a.description}` : ""}`
      ).join("\n")
    : "No pending approvals.";

  const sectionActivity = activity.length
    ? activity.map((a: any) =>
        `- ${fmtTime(a.created_at)} · ${a.event_type} — ${a.title}${a.body ? `: ${a.body}` : ""}`
      ).join("\n")
    : "No recent agent activity yet.";

  const sectionOutreach = (outreachTasks.length || outreachApprovals.length)
    ? [
        outreachTasks.length ? `${outreachTasks.length} Penn task(s) in flight.` : "",
        outreachApprovals.length ? `${outreachApprovals.length} outreach approval(s) waiting.` : "",
      ].filter(Boolean).join(" ")
    : "No outreach activity yet.";

  const connectorStatusLines = [
    `Lovable AI Gateway: ${connectors.lovable_ai ? "active" : "missing"}`,
    `Apify hiring signals: ${connectors.source_with_apify ? "configured" : "token missing"}`,
    `Firecrawl page extraction: ${connectors.scrape_url ? "configured" : "missing"}`,
    `Broad web search: ${connectors.search_web ? "configured" : "unavailable (no grounded search connector)"}`,
    `Perplexity (optional fallback): ${connectors.research_web ? "configured" : "not configured"}`,
  ].join(" · ");

  const sectionIntel = (connectors.search_web || connectors.research_web)
    ? "Live broad research is available. Ask 'Have Hawk gather today's market signals' to run it."
    : "Broad web search is not configured. I can still pull hiring signals via Apify and extract specific URLs via Firecrawl.";


  const sectionActions = actions.length
    ? actions.map((a, i) => `${i + 1}. ${a}`).join("\n")
    : "1. Send Pilot a work request to get started.";

  const summary = (() => {
    const bits: string[] = [];
    if (plans.length) bits.push(`${plans.length} active plan${plans.length > 1 ? "s" : ""}`);
    if (tasks.length) bits.push(`${tasks.length} task${tasks.length > 1 ? "s" : ""} needing attention`);
    if (approvals.length) bits.push(`${approvals.length} pending approval${approvals.length > 1 ? "s" : ""}`);
    if (activity.length) bits.push(`${activity.length} agent event${activity.length > 1 ? "s" : ""} in the last 24h`);
    if (!bits.length) return "Workspace is quiet — no active plans, tasks, approvals, or recent agent activity. Good moment to kick off your first run.";
    return `You have ${bits.join(", ")}.`;
  })();

  const deterministicMd =
`# Today's Command Brief

## Summary
${summary}

## Active Plans
${sectionPlans}

## Tasks Needing Attention
${sectionTasks}

## Pending Approvals
${sectionApprovals}

## Recent Agent Activity
${sectionActivity}

## Outreach Status
${sectionOutreach}

## Intelligence Status
${sectionIntel}

## Recommended Next Actions
${sectionActions}`;

  // ---- Optional AI polish (formatting only, no fabrication) ----
  let finalMd = deterministicMd;
  let modelUsed = "deterministic";
  try {
    const facts = {
      summary, plans: planEnriched, tasks, approvals, activity,
      outreach: { tasks: outreachTasks.length, approvals: outreachApprovals.length },
      connectors, intelligence_text: sectionIntel,
      recommended_actions: actions,
      company_brain_present: Object.keys(brainProfile).length > 0,
      onboarding_completed: onboardingCompleted,
    };
    const ai = await generateText({
      taskType: "helper",
      systemPrompt:
        "You format a founder daily command brief. Use ONLY the JSON facts provided. " +
        "Do NOT invent plans, tasks, approvals, activity, market data, or current events. " +
        "Output GitHub-flavored markdown with EXACTLY these H2 sections in order: " +
        "Summary, Active Plans, Tasks Needing Attention, Pending Approvals, Recent Agent Activity, " +
        "Outreach Status, Intelligence Status, Recommended Next Actions. " +
        "Start with '# Today's Command Brief'. Use the Intelligence Status text verbatim from facts.intelligence_text. " +
        "Be concise, scannable, and tactical. If a list is empty, state it is empty.",
      messages: [{ role: "user", content: "FACTS:\n" + JSON.stringify(facts, null, 2) }],
      temperature: 0.2,
      maxTokens: 1400,
      functionName: "daily-brief",
      workspaceId,
    });
    if (ai.ok && ai.content && ai.content.includes("Today's Command Brief")) {
      finalMd = ai.content.trim();
      modelUsed = ai.model || "lovable-ai";
    }
  } catch (e) {
    console.warn("[daily-brief] AI polish failed, using deterministic markdown:", e);
  }

  // ---- Persist assistant message ----
  const { data: saved } = await admin.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: finalMd,
    agent_slug: "pilot",
    model_used: modelUsed,
  }).select("*").single();

  const connectorsMissing = Object.entries(connectors)
    .filter(([, v]) => !v).map(([k]) => k);

  return json({
    type: "reply",
    intent: "daily_brief",
    conversation_id: conversationId,
    message: saved,
    connectors_missing: connectorsMissing,
  });
});
