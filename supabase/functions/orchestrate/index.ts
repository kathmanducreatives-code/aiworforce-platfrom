// orchestrate: plan a multi-agent workflow and kick off the first step.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { workspace_id | workspaceId, user_instruction | userInstruction,
//           conversation_id? | conversationId? }
// Auth:   Bearer JWT (forwarded by pilot-chat). Membership validated via
//         workspace_members using the service-role client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // Health-check ping (used by VerificationPanel).
    if ((body as { ping?: unknown })?.ping === true) {
      return json({ ok: true });
    }

    // Accept snake_case + camelCase.
    const b = body as Record<string, unknown>;
    const workspace_id = (b.workspace_id ?? b.workspaceId) as string | undefined;
    const user_instruction = (b.user_instruction ?? b.userInstruction) as string | undefined;
    const conversation_id = (b.conversation_id ?? b.conversationId ?? null) as string | null;

    if (!user_instruction || !workspace_id) {
      return json(
        { error: "missing_parameter", details: "workspace_id and user_instruction are required" },
        400,
      );
    }

    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Validate JWT and derive user_id.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Membership check (bypass RLS via service role, then verify explicitly).
    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId)
      .eq("workspace_id", workspace_id)
      .maybeSingle();

    if (!member) {
      return json(
        {
          error: "workspace_not_found",
          details: "User is not a member of the specified workspace",
          workspace_id,
        },
        404,
      );
    }

    // Workspace lookup (real columns only).
    const { data: workspace } = await admin
      .from("workspaces")
      .select("id, name")
      .eq("id", workspace_id)
      .maybeSingle();

    if (!workspace) {
      return json(
        {
          error: "workspace_not_found",
          details: "Workspace row not found in database",
          workspace_id,
        },
        404,
      );
    }

    // Load company_brain profile (separate table; optional).
    const { data: brainRow } = await admin
      .from("company_brain")
      .select("profile")
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    const companyBrain = (brainRow?.profile ?? {}) as Record<string, unknown>;

    // Load agents + capabilities (using real columns: capability, config).
    const { data: capabilities } = await admin
      .from("agent_capabilities")
      .select("capability, config, agents ( id, slug, name, model, department )");

    const capabilityMap = (capabilities ?? [])
      .map((c: any) => ({
        agent_slug: c.agents?.slug,
        agent_name: c.agents?.name,
        department: c.agents?.department,
        model: c.agents?.model,
        capability: c.capability,
        config: c.config ?? {},
      }))
      .filter((c) => c.agent_slug);

    // Plan with Claude.
    const orchestratorPrompt = `You are the orchestrator for ScreeningPilot, an AI workforce platform.
Read the user instruction and decide which agents to involve, in what order.

COMPANY CONTEXT:
${JSON.stringify(companyBrain)}

AVAILABLE AGENTS AND CAPABILITIES:
${JSON.stringify(capabilityMap, null, 2)}

USER INSTRUCTION:
"${user_instruction}"

RULES:
- Use agent_slug values from the list above. Never invent slugs.
- Only include agents actually needed.
- If a step produces output that needs human review before continuing (sending emails, publishing content), set needs_approval to true.
- If only one agent is needed, return one step.

Return ONLY valid JSON, no explanation, no markdown:
{
  "plan_summary": "one sentence describing what will happen",
  "steps": [
    {
      "step_index": 0,
      "agent_slug": "scout",
      "agent_name": "Scout",
      "capability": "search_linkedin",
      "needs_approval": false,
      "instruction": "specific instruction for this agent"
    }
  ]
}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: orchestratorPrompt }],
      }),
    });

    const anthropicData = await anthropicRes.json();
    const rawPlan: string = anthropicData?.content?.[0]?.text ?? "";

    let parsedPlan: { plan_summary: string; steps: any[] };
    try {
      parsedPlan = JSON.parse(rawPlan.replace(/```json|```/g, "").trim());
    } catch {
      return json({ error: "plan_parse_failed", raw: rawPlan }, 500);
    }

    if (!Array.isArray(parsedPlan?.steps) || parsedPlan.steps.length === 0) {
      return json({ error: "empty_plan", raw: rawPlan }, 500);
    }

    // Persist task_plan with real columns.
    const { data: taskPlan, error: planError } = await admin
      .from("task_plans")
      .insert({
        workspace_id,
        user_id: userId,
        created_by: userId,
        goal: user_instruction,
        user_instruction,
        plan_summary: parsedPlan.plan_summary,
        steps: parsedPlan.steps,
        status: "executing",
      })
      .select("id")
      .single();

    if (planError || !taskPlan) {
      console.error("[orchestrate] failed to save task_plan:", planError);
      return json({ error: "plan_save_failed", details: planError?.message }, 500);
    }

    // Activity feed: plan_created.
    await admin.from("activity_feed").insert({
      workspace_id,
      plan_id: taskPlan.id,
      event_type: "plan_created",
      title: "Plan created",
      body: parsedPlan.plan_summary,
      metadata: { total_steps: parsedPlan.steps.length, conversation_id },
    });

    // Fire first step (best-effort; failures don't block the response).
    const firstStep = parsedPlan.steps[0];
    fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        plan_id: taskPlan.id,
        step_index: 0,
        agent_slug: firstStep.agent_slug,
        workspace_id,
        user_id: userId,
        instruction: firstStep.instruction,
        input: user_instruction,
        needs_approval: firstStep.needs_approval === true,
      }),
    }).catch((e) => console.error("[orchestrate] run-agent kickoff failed:", e));

    return json({
      success: true,
      plan_id: taskPlan.id,
      task_plan_id: taskPlan.id, // backward-compat alias
      plan_summary: parsedPlan.plan_summary,
      total_steps: parsedPlan.steps.length,
      steps_count: parsedPlan.steps.length,
      plan: parsedPlan,
    });
  } catch (err) {
    console.error("[orchestrate] unexpected:", err);
    return json({ error: "internal_error", details: String(err) }, 500);
  }
});
