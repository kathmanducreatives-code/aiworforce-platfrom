// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool } from "../_shared/toolRegistry.ts";
import { generateText, logProviderCall } from "../_shared/aiProvider.ts";


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
function buildUserMessage(instruction: string, input: string | null | undefined): string {
  if (!input) return `Task: ${instruction}`;
  return `Task: ${instruction}\n\nInput from previous step:\n${input}`;
}

type CompanyBrain = Record<string, unknown> | null;

function renderCompanyBrain(brain: CompanyBrain): string {
  if (!brain || Object.keys(brain).length === 0) {
    return `<company_brain>\n(empty — workspace has not completed onboarding yet.)\n</company_brain>`;
  }
  return `<company_brain>\n${JSON.stringify(brain, null, 2)}\n</company_brain>`;
}

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

  if (!plan_id || step_index === undefined || (!agent_slug && !agent_id_in) || !workspace_id || !instruction) {
    return json({ error: "missing_required_fields" }, 400);
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

  // Load company_brain.
  const { data: brainRow } = await supabase
    .from("company_brain")
    .select("profile")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const brain = (brainRow?.profile ?? null) as CompanyBrain;

  const systemPrompt = `${agent.role_prompt ?? `You are ${agent.name}.`}\n\n${renderCompanyBrain(brain)}`;
  const model = resolveModel(agent.model);

  // --- Tool layer: hawk + scout get live web research via Perplexity. ---
  let toolContext: string | null = null;
  let toolNotice: string | null = null;
  if (agent_slug === "hawk" || agent_slug === "scout") {
    const toolRes = await runTool("research_web", { query: instruction }, {
      admin: supabase,
      workspace_id,
      agent_slug,
      agent_id: agent.id,
      agent_name: agent.name,
      plan_id,
      task_id: task.id,
      user_id: user_id ?? null,
    });
    if (toolRes.ok && toolRes.data) {
      const d = toolRes.data as { content?: string; citations?: string[] };
      const citations = (d.citations ?? []).slice(0, 8).map((c, i) => `[${i + 1}] ${c}`).join("\n");
      toolContext = `LIVE RESEARCH (Perplexity):\n${d.content ?? ""}\n\nCITATIONS:\n${citations}`;
    } else if (toolRes.unavailable) {
      toolNotice = agent_slug === "scout"
        ? "Live candidate discovery requires the Perplexity / Firecrawl / Apollo connector. I can still produce the sourcing plan."
        : "Live research requires the Perplexity connector to be configured.";
    } else if (!toolRes.ok) {
      toolNotice = `Research tool failed: ${toolRes.error ?? "unknown"}.`;
    }
  }

  const userMessage = toolContext
    ? `${buildUserMessage(instruction, input)}\n\n${toolContext}`
    : toolNotice
      ? `${buildUserMessage(instruction, input)}\n\nNOTE TO AGENT: ${toolNotice} Do NOT fabricate live data. Acknowledge the limitation, then produce the best plan/analysis you can from available context.`
      : buildUserMessage(instruction, input);

  const result = await callAnthropicWithRetry(
    {
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    },
    Deno.env.get("ANTHROPIC_API_KEY")!,
  );

  let apiText = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let apiError: string | null = null;

  if (result.ok) {
    apiText = result.data?.content?.[0]?.text ?? "";
    tokensIn = result.data?.usage?.input_tokens ?? 0;
    tokensOut = result.data?.usage?.output_tokens ?? 0;
    if (!apiText) apiError = "empty content from Anthropic";
  } else {
    apiError = result.error ?? "unknown anthropic error";
  }

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
    result: { output: apiText, tokens_in: tokensIn, tokens_out: tokensOut },
  }).eq("id", task.id);

  // Load plan steps to find next.
  const { data: plan } = await supabase
    .from("task_plans")
    .select("steps, plan_summary")
    .eq("id", plan_id)
    .maybeSingle();
  const steps: any[] = Array.isArray(plan?.steps) ? (plan!.steps as any[]) : [];
  const nextStep = steps[(step_index as number) + 1] ?? null;

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

  if (nextStep) {
    await supabase.from("handoffs").insert({
      workspace_id,
      plan_id,
      task_id: task.id,
      from_agent_slug: agent_slug ?? null,
      to_agent_slug: nextStep.agent_slug ?? null,
      payload: { instruction: nextStep.instruction, input: apiText },
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
        input: apiText,
        needs_approval: nextStep.needs_approval === true,
      }),
    }).catch((e) => console.error("[run-agent] chain fetch failed:", e));

    return json({
      success: true,
      task_id: task.id,
      status: "complete",
      next_agent: nextStep.agent_name ?? nextStep.agent_slug,
    });
  }

  // Final step.
  await supabase.from("activity_feed").insert({
    workspace_id,
    plan_id,
    agent_id: agent.id,
    event_type: "plan_complete",
    title: "Plan complete",
    body: `${plan?.plan_summary ?? "Plan"} — complete.`,
    metadata: { step_index, task_id: task.id },
  });
  await supabase.from("task_plans").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", plan_id);

  return json({ success: true, task_id: task.id, status: "complete", complete: true });
});
