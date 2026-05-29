// orchestrate: plan a multi-agent workflow and kick off the first step.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { workspace_id | workspaceId, user_instruction | userInstruction,
//           conversation_id? | conversationId? }
// Auth:   Bearer JWT (forwarded by pilot-chat). Membership validated via
//         workspace_members using the service-role client.
//
// Resilience:
//   - Tolerates fenced / preamble-wrapped JSON from Claude.
//   - Repairs unbalanced braces/brackets.
//   - Falls back to a deterministic intent-based planner if the model fails
//     or returns an empty plan, so common workforce requests never bubble
//     up "empty_plan" to the user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ---------- JSON parsing helpers ----------

function stripFences(s: string): string {
  return s.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function extractJson(raw: string): unknown {
  const cleaned = stripFences(raw);
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("no JSON found");
  const opener = cleaned[start];
  const closer = opener === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(closer);
  const slice = end > start ? cleaned.slice(start, end + 1) : cleaned.slice(start);

  try {
    return JSON.parse(slice);
  } catch {
    // Repair: pad missing closers + strip control chars.
    let braces = 0, brackets = 0;
    for (const ch of slice) {
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
    let repaired = slice.replace(/[\x00-\x1F\x7F]/g, "");
    while (brackets-- > 0) repaired += "]";
    while (braces-- > 0) repaired += "}";
    return JSON.parse(repaired);
  }
}

// ---------- Intent fallback planner ----------

type Step = {
  step_index: number;
  agent_slug: string;
  agent_name: string;
  capability?: string;
  needs_approval: boolean;
  instruction: string;
};

const KNOWN_AGENTS: Record<string, string> = {
  scout: "Scout",
  aria: "Aria",
  penn: "Penn",
  hawk: "Hawk",
  scribe: "Scribe",
};

function normalizeSlug(s: string | undefined | null): string | null {
  if (!s) return null;
  const slug = String(s).trim().toLowerCase();
  return KNOWN_AGENTS[slug] ? slug : null;
}

function fallbackPlan(instruction: string): { plan_summary: string; steps: Step[] } {
  const t = instruction.toLowerCase();
  const mk = (slug: keyof typeof KNOWN_AGENTS, step_index: number, body: string, approval = false): Step => ({
    step_index,
    agent_slug: slug,
    agent_name: KNOWN_AGENTS[slug],
    needs_approval: approval,
    instruction: body,
  });

  // Sourcing / find candidates
  if (/(find|source|sourc(?:e|ing)|candidates?|engineers?|developers?|hires?|recruit)/.test(t)) {
    return {
      plan_summary: `Source, rank, and prepare outreach for: ${instruction}`,
      steps: [
        mk("scout", 0, `Source candidates for: ${instruction}`),
        mk("aria", 1, `Rank and score the sourced candidates against the requirements in: ${instruction}`),
        mk("penn", 2, `Draft personalized outreach for the strongest candidates from: ${instruction}`, true),
      ],
    };
  }
  // Outreach / email
  if (/(outreach|email|message|dm|reach out|follow.?up)/.test(t)) {
    return {
      plan_summary: `Draft outreach: ${instruction}`,
      steps: [mk("penn", 0, instruction, true)],
    };
  }
  // Competitive / market intelligence
  if (/(competitor|competitive|market|intel|intelligence|changed|news)/.test(t)) {
    return {
      plan_summary: `Gather competitive intelligence: ${instruction}`,
      steps: [mk("hawk", 0, instruction)],
    };
  }
  // Content / LinkedIn / blog
  if (/(linkedin|post|blog|content|write|article|jd|job description)/.test(t)) {
    return {
      plan_summary: `Draft content: ${instruction}`,
      steps: [mk("scribe", 0, instruction)],
    };
  }
  // Screening / ranking only
  if (/(rank|screen|score|shortlist|evaluate)/.test(t)) {
    return {
      plan_summary: `Screen candidates: ${instruction}`,
      steps: [mk("aria", 0, instruction)],
    };
  }
  // Default: Scout as research entrypoint.
  return {
    plan_summary: `Investigate request: ${instruction}`,
    steps: [mk("scout", 0, instruction)],
  };
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;


    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    if ((body as { ping?: unknown })?.ping === true) return json({ ok: true });

    const b = body as Record<string, unknown>;
    const workspace_id = (b.workspace_id ?? b.workspaceId) as string | undefined;
    const user_instruction = (b.user_instruction ?? b.userInstruction) as string | undefined;
    const conversation_id = (b.conversation_id ?? b.conversationId ?? null) as string | null;

    if (!user_instruction || !workspace_id) {
      return json({ error: "missing_parameter", details: "workspace_id and user_instruction are required" }, 400);
    }

    // Auth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Membership.
    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    if (!member) {
      return json({ error: "workspace_not_found", details: "User is not a member", workspace_id }, 404);
    }
    const { data: workspace } = await admin
      .from("workspaces").select("id, name").eq("id", workspace_id).maybeSingle();
    if (!workspace) {
      return json({ error: "workspace_not_found", details: "Workspace row missing", workspace_id }, 404);
    }

    // Agent lookup (slug → id).
    const { data: agentsRows, error: agentsErr } = await admin
      .from("agents")
      .select("id, slug, name, model, department");
    if (agentsErr || !agentsRows || agentsRows.length === 0) {
      console.error("[orchestrate] agent_lookup_failed:", agentsErr);
      return json({ error: "agent_lookup_failed", details: agentsErr?.message }, 500);
    }
    const slugToAgent = new Map<string, { id: string; name: string; model: string | null }>();
    for (const a of agentsRows) {
      const slug = (a.slug ?? a.name ?? "").toString().toLowerCase();
      if (slug) slugToAgent.set(slug, { id: a.id, name: a.name, model: a.model });
    }

    console.log("[orchestrate] request", {
      workspace_id, user_id: userId,
      instruction_len: user_instruction.length,
      agent_slugs: [...slugToAgent.keys()],
    });

    // Load company_brain + capabilities (best-effort).
    const { data: brainRow } = await admin
      .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
    const companyBrain = (brainRow?.profile ?? {}) as Record<string, unknown>;

    const { data: capRows } = await admin
      .from("agent_capabilities")
      .select("capability, config, agents ( slug, name )");
    const capabilityMap = (capRows ?? [])
      .map((c: any) => ({
        agent_slug: (c.agents?.slug ?? c.agents?.name ?? "").toString().toLowerCase(),
        capability: c.capability,
        config: c.config ?? {},
      }))
      .filter((c) => c.agent_slug);

    // Try AI planner via shared adapter; fall back deterministically on any failure.
    let parsedPlan: { plan_summary: string; steps: Step[] } | null = null;
    let plannerSource: "ai" | "fallback" = "fallback";
    let aiProvider = "none";
    let aiModel = "";

    const orchestratorPrompt = `You are the orchestrator for ScreeningPilot, an AI workforce platform.
Read the user instruction and decide which agents to involve, in what order.

COMPANY CONTEXT:
${JSON.stringify(companyBrain)}

AVAILABLE AGENTS:
${JSON.stringify([...slugToAgent.keys()])}

CAPABILITIES:
${JSON.stringify(capabilityMap, null, 2)}

USER INSTRUCTION:
"${user_instruction}"

RULES:
- Use agent_slug values from AVAILABLE AGENTS only. Never invent slugs.
- Only include agents actually needed.
- needs_approval=true for irreversible external actions (sending emails, publishing posts).
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

    const ai = await generateJson({
      taskType: "orchestration_plan",
      systemPrompt: "You are a planning assistant. Respond with valid JSON only.",
      messages: [{ role: "user", content: orchestratorPrompt }],
      temperature: 0.3,
      maxTokens: 2048,
      functionName: "orchestrate",
      workspaceId: workspace_id,
    });
    aiProvider = ai.provider;
    aiModel = ai.model;
    await logProviderCall(admin, {
      workspace_id,
      function_name: "orchestrate",
      task_type: "orchestration_plan",
      provider: ai.provider,
      model: ai.model,
      success: ai.ok,
      latency_ms: ai.latencyMs,
      error_code: ai.errorCode,
    });

    if (ai.ok && ai.json) {
      const parsed = ai.json as { plan_summary?: string; steps?: any[] };
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        const normalizedSteps: Step[] = parsed.steps
          .map((s: any, i: number) => {
            const slug = normalizeSlug(s?.agent_slug);
            if (!slug) return null;
            return {
              step_index: typeof s.step_index === "number" ? s.step_index : i,
              agent_slug: slug,
              agent_name: KNOWN_AGENTS[slug],
              capability: typeof s.capability === "string" ? s.capability : undefined,
              needs_approval: s.needs_approval === true,
              instruction: typeof s.instruction === "string" && s.instruction.trim().length > 0
                ? s.instruction
                : user_instruction,
            } as Step;
          })
          .filter((s): s is Step => s !== null);
        if (normalizedSteps.length > 0) {
          parsedPlan = {
            plan_summary: parsed.plan_summary || `Plan for: ${user_instruction}`,
            steps: normalizedSteps,
          };
          plannerSource = "ai";
        }
      }
    } else {
      console.warn("[orchestrate] AI planner unavailable, using fallback:", ai.error);
    }



    if (!parsedPlan) {
      parsedPlan = fallbackPlan(user_instruction);
    }
    console.log("[orchestrate] plan ready", {
      source: plannerSource,
      steps: parsedPlan.steps.length,
      agents: parsedPlan.steps.map((s) => s.agent_slug),
    });

    // Persist task_plan.
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
      console.error("[orchestrate] task_plan_insert_failed:", planError);
      return json({ error: "task_plan_insert_failed", details: planError?.message }, 500);
    }

    // Activity feed entry.
    await admin.from("activity_feed").insert({
      workspace_id,
      plan_id: taskPlan.id,
      event_type: "plan_created",
      title: "Plan created",
      body: parsedPlan.plan_summary,
      metadata: {
        total_steps: parsedPlan.steps.length,
        conversation_id,
        planner: plannerSource,
        agents: parsedPlan.steps.map((s) => s.agent_slug),
      },
    });

    // Kick off first step (non-blocking).
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
      task_plan_id: taskPlan.id,
      plan_summary: parsedPlan.plan_summary,
      total_steps: parsedPlan.steps.length,
      steps_count: parsedPlan.steps.length,
      planner: plannerSource,
      plan: parsedPlan,
    });
  } catch (err) {
    console.error("[orchestrate] unexpected:", err);
    return json({ error: "internal_error", details: String(err) }, 500);
  }
});
