// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, normalizeApifySourceType } from "../_shared/toolRegistry.ts";
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

  // --- Tool layer: hawk + scout get live tools (Firecrawl scrape, Apify sourcing). Broad web search is optional. ---
  let toolContext: string | null = null;
  let scrapedContext: string | null = null;
  let apifyContext: string | null = null;
  const toolNotices: string[] = [];

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

    // 2) Apify sourcing — sourcing-intent instructions on scout (and jobs/companies on hawk).
    const sourcingRe = /\b(find|source|sourcing|discover|prospects?|leads?|founders?|companies|hiring|job openings|roles|recruit(?:ers?|ing)|candidates?|engineers?|marketers?|linkedin posts?|comments?)\b/i;
    const planned_actor_key: string | null = tool_input_body?.selected_actor_key ?? null;
    const shouldUseApify = tool_input_body?.tool_name === "source_with_apify" ||
      !!planned_actor_key ||
      sourcingRe.test(`${instruction ?? ""} ${input ?? ""}`);

    if (shouldUseApify) {
      const raw_source_type: string | null = tool_input_body?.source_type ?? null;
      let source_type = normalizeApifySourceType(raw_source_type);
      if (!raw_source_type && !planned_actor_key) {
        const text = `${instruction ?? ""} ${input ?? ""}`.toLowerCase();
        if (/\b(hiring|job openings?|jobs?|roles?|engineers?|marketers?|developers?|candidates?|people|companies|founders?|prospects?|startups?|orgs?)\b/.test(text)) {
          source_type = "jobs";
        } else if (/\blinkedin\b|\bposts?\b|\bcomments?\b/.test(text)) {
          source_type = "jobs";
        }
      }

      const shouldRun = agent_slug === "scout" || agent_slug === "hawk";

      if (shouldRun) {
        let location: string | null = tool_input_body?.location ?? null;
        let roleKeywords: string[] = Array.isArray(tool_input_body?.role_keywords) ? tool_input_body.role_keywords : [];
        let max_results: number = typeof tool_input_body?.max_results === "number"
          ? Math.max(1, Math.min(200, tool_input_body.max_results))
          : 25;

        if (!location) {
          const locMatch = (instruction ?? "").match(/\bin\s+([A-Z][A-Za-z\s\-]+?)(?:[.,]|$)/);
          location = locMatch?.[1]?.trim() ?? null;
        }
        if (roleKeywords.length === 0) {
          roleKeywords = Array.from(
            new Set(((instruction ?? "").toLowerCase().match(/\b(marketing|marketer|sales|engineer|developer|designer|founder|product|react|frontend|backend|growth|recruiter)\b/g) ?? [])),
          );
        }

        const apifyInput = {
          selected_actor_key: planned_actor_key ?? undefined,
          source_type,
          search_goal: tool_input_body?.query ?? instruction,
          query: tool_input_body?.query ?? instruction,
          location: location ?? undefined,
          role_keywords: roleKeywords.length > 0 ? roleKeywords : undefined,
          max_results,
        };

        console.log("[run-agent] apify input", {
          requested_source_type: raw_source_type,
          normalized_source_type: source_type,
          ...apifyInput,
        });
        const r = await runTool("source_with_apify", apifyInput, baseCtx);
        if (r.ok && r.data) {
          const d = r.data as { items?: any[]; total?: number; summary?: string; run_id?: string };
          const sample = (d.items ?? []).slice(0, Math.min(max_results, 25));
          const lens = source_type === "jobs"
            ? "\n\nNOTE: These are companies/jobs hiring for the requested role, not individual people profiles."
            : "";
          apifyContext = `APIFY SOURCING (run ${d.run_id ?? "?"} — ${d.total ?? sample.length} results):\n${d.summary ?? ""}${lens}\n\nITEMS:\n${JSON.stringify(sample, null, 2).slice(0, 8000)}`;
        } else if (r.unavailable) {
          const dbg = (r.data ?? {}) as Record<string, unknown>;
          const reason = r.error === "apify_actor_not_configured"
            ? `Apify is connected, but no actor is configured for source_type=${source_type} (requested=${raw_source_type ?? "null"}, expected_actor_key=${dbg.expected_actor_key ?? source_type}).`
            : `Apify unavailable (${r.error ?? "not configured"}).`;
          toolNotices.push(reason);
        } else if (!r.ok) {
          toolNotices.push(`Apify failed: ${r.error ?? "unknown"}.`);
        }
      }
    }


    // 3) Optional broad research — only attempt if Perplexity is actually configured AND
    //    we're not in fast mode (fast mode skips this entirely to keep cost low).
    const skipBroadResearch = execution_mode_body === "fast" || tool_input_body?.tool_name === "source_with_apify";
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

  const ai = await generateText({
    taskType: "agent_execution",
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.6,
    maxTokens: 2048,
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
        tool_input: tool_input_body ?? nextStep.metadata?.tool_input ?? null,
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
