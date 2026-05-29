import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));

    // Health-check ping used by VerificationPanel.tsx / pingOrchestrate.
    // Must precede the required-fields check.
    if (body?.ping === true) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { user_instruction, workspace_id } = body ?? {};

    if (!user_instruction || !workspace_id) {
      return new Response(
        JSON.stringify({ error: "user_instruction and workspace_id required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch workspace
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("company_brain, daily_run_limit, tokens_used_today")
      .eq("id", workspace_id)
      .single();

    if (!workspace) {
      return new Response(
        JSON.stringify({ error: "Workspace not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (workspace.tokens_used_today >= workspace.daily_run_limit) {
      return new Response(
        JSON.stringify({ error: "Daily run limit reached" }),
        { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch all agent capabilities
    const { data: capabilities } = await supabase
      .from("agent_capabilities")
      .select(`
        capability, input_type, output_type, priority,
        agents ( id, name, model, department, status )
      `);

    const capabilityMap = (capabilities ?? []).map((c: any) => ({
      agent_id: c.agents?.id,
      agent_name: c.agents?.name,
      model: c.agents?.model,
      department: c.agents?.department,
      capability: c.capability,
      input_type: c.input_type,
      output_type: c.output_type,
      priority: c.priority,
    }));

    // Ask Claude to build the dynamic plan
    const orchestratorPrompt = `
You are the orchestrator for ScreeningPilot, an AI workforce platform.
Read the user instruction and decide which agents to involve, in what order, to complete the task.

COMPANY CONTEXT:
${workspace.company_brain}

AVAILABLE AGENTS AND CAPABILITIES:
${JSON.stringify(capabilityMap, null, 2)}

USER INSTRUCTION:
"${user_instruction}"

RULES:
- Only use agents whose input_type matches the previous step's output_type
- First agent must accept raw text input
- Only include agents actually needed — no unnecessary steps
- If a step produces output needing human review before proceeding (emails to send, content to publish), set needs_approval to true
- If the task needs only one agent, return one step

Return ONLY valid JSON, no explanation, no markdown:
{
  "plan_summary": "one sentence describing what will happen",
  "steps": [
    {
      "step_index": 0,
      "agent_id": "uuid",
      "agent_name": "name",
      "capability": "capability being used",
      "input_type": "what this step receives",
      "output_type": "what this step produces",
      "needs_approval": false,
      "instruction": "specific instruction for this agent based on the user request"
    }
  ]
}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: orchestratorPrompt }],
      }),
    });

    const anthropicData = await anthropicRes.json();
    const rawPlan = anthropicData.content?.[0]?.text ?? "";

    let parsedPlan: any;
    try {
      parsedPlan = JSON.parse(rawPlan.replace(/```json|```/g, "").trim());
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to parse orchestrator plan", raw: rawPlan }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Save task plan
    const { data: taskPlan, error: planError } = await supabase
      .from("task_plans")
      .insert({
        workspace_id,
        user_instruction,
        plan: parsedPlan,
        status: "running",
        current_step: 0,
      })
      .select()
      .single();

    if (planError || !taskPlan) {
      return new Response(
        JSON.stringify({ error: "Failed to save plan", detail: planError }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Log plan creation to activity feed
    await supabase.from("activity_feed").insert({
      workspace_id,
      task_plan_id: taskPlan.id,
      event_type: "plan_created",
      title: "Plan created",
      body: parsedPlan.plan_summary,
      metadata: { total_steps: parsedPlan.steps.length },
    });

    // Fire first step immediately
    const firstStep = parsedPlan.steps[0];
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        task_plan_id: taskPlan.id,
        step_index: 0,
        agent_id: firstStep.agent_id,
        workspace_id,
        instruction: firstStep.instruction,
        input: user_instruction,
        needs_approval: firstStep.needs_approval,
      }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        task_plan_id: taskPlan.id,
        plan_summary: parsedPlan.plan_summary,
        total_steps: parsedPlan.steps.length,
        plan: parsedPlan,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
