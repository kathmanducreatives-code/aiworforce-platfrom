import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "gpt-4o": "claude-haiku-4-5-20251001",
  "gemini-1.5-pro": "claude-sonnet-4-5-20250929",
};
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function resolveModel(raw: string): string {
  if (MODEL_MAP[raw]) {
    if (raw === "gpt-4o" || raw === "gemini-1.5-pro") {
      console.error(`[run-agent] remapping non-Anthropic model "${raw}" -> ${MODEL_MAP[raw]}`);
    }
    return MODEL_MAP[raw];
  }
  console.error(`[run-agent] unknown model "${raw}" — defaulting to ${DEFAULT_MODEL}`);
  return DEFAULT_MODEL;
}

function buildUserMessage(instruction: string, input: string | null | undefined): string {
  if (!input || input.length === 0) return `Task: ${instruction}`;
  return `Task: ${instruction}\n\nInput from previous step:\n${input}`;
}

type CompanyBrain = {
  company_name: string | null;
  what_we_do: string | null;
  who_we_sell_to: string | null;
  voice_and_tone: string | null;
  do_not_say: unknown;
  examples: unknown;
} | null;

function renderCompanyBrain(brain: CompanyBrain): string {
  if (!brain || (!brain.company_name && !brain.what_we_do && !brain.who_we_sell_to)) {
    return `<company_brain>
(empty — workspace has not completed onboarding yet. Rely on the task description for context. Do not invent a company name; refer to it generically as "the company".)
</company_brain>`;
  }
  const donts = Array.isArray(brain.do_not_say) ? (brain.do_not_say as string[]) : [];
  const examples = Array.isArray(brain.examples) ? (brain.examples as Array<{ label?: string; sample?: string }>) : [];
  const exampleBlock = examples.length
    ? `\nExamples of on-brand output:\n${examples.slice(0, 3).map((e, i) => `  ${i + 1}. ${e.label ? `[${e.label}] ` : ''}${e.sample ?? ''}`).join('\n')}`
    : '';
  const dontBlock = donts.length ? `\nNever say: ${donts.map((d) => `"${d}"`).join(', ')}` : '';
  return `<company_brain>
Company: ${brain.company_name ?? '(unspecified)'}
What we do: ${brain.what_we_do ?? '(unspecified)'}
Who we sell to: ${brain.who_we_sell_to ?? '(unspecified)'}
Voice and tone: ${brain.voice_and_tone ?? '(unspecified)'}${dontBlock}${exampleBlock}
</company_brain>`;
}

async function callAnthropicWithRetry(
  payload: unknown,
  apiKey: string
): Promise<{ ok: boolean; data: any; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (res.ok) return { ok: true, data };
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return { ok: false, data, error: `Anthropic ${res.status}: ${JSON.stringify(data?.error ?? data)}` };
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return { ok: false, data: null, error: `fetch failed: ${String(e)}` };
    }
  }
  return { ok: false, data: null, error: "retry exhausted" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    console.error("[run-agent] bad json:", e);
    return new Response(JSON.stringify({ error: "invalid json body" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const { task_plan_id, step_index, agent_id, workspace_id, instruction, input, needs_approval } = body;

  if (!task_plan_id || step_index === undefined || !agent_id || !workspace_id || !instruction) {
    return new Response(JSON.stringify({ error: "missing required fields" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // 1. Insert task row (status default 'running')
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({ task_plan_id, agent_id, workspace_id, step_index, input: input ?? null, status: "running" })
    .select()
    .single();

  if (taskErr || !task) {
    console.error("[run-agent] failed to insert task:", taskErr);
    return new Response(JSON.stringify({ error: "failed to insert task", detail: taskErr }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // 3. Load agent
  const { data: agent, error: agentErr } = await supabase
    .from("agents").select("id, name, model, role_prompt, department").eq("id", agent_id).single();

  if (agentErr || !agent) {
    console.error("[run-agent] failed to load agent:", agentErr);
    await supabase.from("tasks").update({ status: "failed", output: "[ERROR] agent not found" }).eq("id", task.id);
    return new Response(JSON.stringify({ error: "agent not found", detail: agentErr }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // 2. step_started event (after agent load so we have the name)
  await supabase.from("activity_feed").insert({
    workspace_id, task_plan_id, agent_id,
    event_type: "step_started",
    title: `${agent.name} started`,
    body: instruction,
    metadata: { step_index, task_id: task.id },
  });

  // 3b. Load company_brain for this workspace (silent on missing).
  const { data: brain } = await supabase
    .from("company_brain")
    .select("company_name, what_we_do, who_we_sell_to, voice_and_tone, do_not_say, examples")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  const systemPrompt = `${agent.role_prompt}\n\n${renderCompanyBrain(brain as CompanyBrain)}`;

  // 4-6. Call Anthropic (30s timeout, 1 retry on 5xx / network error).
  const model = resolveModel(agent.model);
  let apiText = ""; let tokensIn = 0; let tokensOut = 0; let apiError: string | null = null;

  const result = await callAnthropicWithRetry(
    {
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: buildUserMessage(instruction, input) }],
    },
    Deno.env.get("ANTHROPIC_API_KEY")!
  );

  if (result.ok) {
    apiText = result.data?.content?.[0]?.text ?? "";
    tokensIn = result.data?.usage?.input_tokens ?? 0;
    tokensOut = result.data?.usage?.output_tokens ?? 0;
    if (!apiText) apiError = "empty content from Anthropic";
  } else {
    apiError = result.error ?? "unknown anthropic error";
  }

  // 7b. Failure path
  if (apiError) {
    console.error("[run-agent] api failure:", apiError);
    await supabase.from("tasks").update({
      status: "failed", output: `[ERROR] ${apiError}`,
    }).eq("id", task.id);
    await supabase.from("activity_feed").insert({
      workspace_id, task_plan_id, agent_id,
      event_type: "step_failed",
      title: `${agent.name} failed`,
      body: apiError,
      metadata: { step_index, task_id: task.id },
    });
    await supabase.from("task_plans").update({ status: "failed" }).eq("id", task_plan_id);
    return new Response(JSON.stringify({ error: "step failed", detail: apiError, task_id: task.id }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // 7a. Success — update task
  const finalStatus = needs_approval ? "awaiting_approval" : "done";
  await supabase.from("tasks").update({
    output: apiText, tokens_in: tokensIn, tokens_out: tokensOut, status: finalStatus,
  }).eq("id", task.id);

  // 8. Load plan to find next step
  const { data: plan } = await supabase.from("task_plans").select("plan, current_step").eq("id", task_plan_id).single();
  const steps = plan?.plan?.steps ?? [];
  const nextStep = steps[step_index + 1] ?? null;

  // 9. needs_approval branch
  if (needs_approval) {
    await supabase.from("approvals").insert({
      workspace_id, task_id: task.id, task_plan_id, agent_id,
      title: `${agent.name} needs approval`,
      summary: instruction,
      payload: { output: apiText, next_step: nextStep },
      status: "pending",
    });
    await supabase.from("activity_feed").insert({
      workspace_id, task_plan_id, agent_id,
      event_type: "awaiting_approval",
      title: `${agent.name} awaiting approval`,
      body: `${agent.name}'s output needs your review before continuing.`,
      metadata: { step_index, task_id: task.id },
    });
    await supabase.from("task_plans").update({ status: "awaiting_approval" }).eq("id", task_plan_id);
    return new Response(JSON.stringify({ success: true, task_id: task.id, status: "awaiting_approval" }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // 10. Chain to next step
  if (nextStep) {
    await supabase.from("handoffs").insert({
      workspace_id, from_agent_id: agent_id, to_agent_id: nextStep.agent_id,
      task_id: task.id, task_plan_id,
    });
    await supabase.from("activity_feed").insert({
      workspace_id, task_plan_id, agent_id,
      event_type: "step_completed",
      title: `${agent.name} finished`,
      body: `${agent.name} finished. Handing to ${nextStep.agent_name}.`,
      metadata: { step_index, task_id: task.id, next_agent_id: nextStep.agent_id },
    });
    await supabase.from("task_plans").update({ current_step: step_index + 1 }).eq("id", task_plan_id);

    // fire-and-forget
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        task_plan_id,
        step_index: step_index + 1,
        agent_id: nextStep.agent_id,
        workspace_id,
        instruction: nextStep.instruction,
        input: apiText,
        needs_approval: nextStep.needs_approval,
      }),
    }).catch((e) => console.error("[run-agent] chain fetch failed:", e));

    return new Response(JSON.stringify({
      success: true, task_id: task.id, status: "done", next_agent: nextStep.agent_name,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // 11. Final step — plan complete
  await supabase.from("activity_feed").insert({
    workspace_id, task_plan_id, agent_id,
    event_type: "plan_completed",
    title: "Plan completed",
    body: `${plan?.plan?.plan_summary ?? "Plan"} — complete.`,
    metadata: { step_index, task_id: task.id },
  });
  await supabase.from("task_plans").update({ status: "done" }).eq("id", task_plan_id);

  return new Response(JSON.stringify({ success: true, task_id: task.id, status: "done", complete: true }),
    { headers: { ...cors, "Content-Type": "application/json" } });
});
