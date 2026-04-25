// Orchestrate: turn a free-text instruction into a plan, then kick off run-agent.
// Input:  { user_instruction, workspace_id }  OR  { ping: true } for health checks.
// Output: { plan_id, plan_summary, steps_count } | { ok: true } on ping.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const KNOWN_AGENT_SLUGS = ['aria', 'scout', 'penn', 'hawk', 'scribe'];

async function planWithAI(instruction: string, agents: { slug: string; name: string; department: string }[]) {
  if (!LOVABLE_API_KEY) {
    // Fallback heuristic plan: 2 steps, first available agent, then handoff to next
    const a = agents[0];
    const b = agents[1] ?? agents[0];
    return {
      plan_summary: `Working on: ${instruction.slice(0, 120)}`,
      steps: [
        { agent_slug: a.slug, description: `${a.name} kicks off: ${instruction}` },
        { agent_slug: b.slug, description: `${b.name} continues and reports back` },
      ] as { agent_slug: string; description: string }[],
    };
  }

  const sys = `You orchestrate a small AI workforce. Given a user instruction, output a JSON plan.
Available agents (slug · name · department):
${agents.map((a) => `- ${a.slug} · ${a.name} · ${a.department}`).join('\n')}

Return STRICT JSON of the form:
{"plan_summary": "<one sentence, <=120 chars>", "steps": [{"agent_slug":"<slug>","description":"<short verb-led step>"}]}
Pick 1-4 steps. Use only the slugs listed.`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: instruction },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('AI gateway failed', res.status, text);
    throw new Error(`AI gateway ${res.status}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: { plan_summary?: string; steps?: { agent_slug: string; description: string }[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const validSteps = (parsed.steps ?? [])
    .filter((s) => s && typeof s.agent_slug === 'string' && KNOWN_AGENT_SLUGS.includes(s.agent_slug) && typeof s.description === 'string')
    .slice(0, 4);
  if (validSteps.length === 0) {
    const a = agents[0];
    return {
      plan_summary: parsed.plan_summary ?? `Working on: ${instruction.slice(0, 120)}`,
      steps: [{ agent_slug: a.slug, description: `${a.name}: ${instruction}` }],
    };
  }
  return {
    plan_summary: parsed.plan_summary ?? `Working on: ${instruction.slice(0, 120)}`,
    steps: validSteps,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    // Health-check ping (used by VerificationPanel)
    if (body?.ping === true) return json({ ok: true });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: 'Unauthorized' }, 401);
    const userId = userData.user.id;

    const { user_instruction, workspace_id, target_agent_slug } = body ?? {};
    if (typeof user_instruction !== 'string' || user_instruction.trim().length === 0) {
      return json({ error: 'user_instruction is required' }, 400);
    }
    if (typeof workspace_id !== 'string') {
      return json({ error: 'workspace_id is required' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Membership check
    const { data: member } = await admin
      .from('workspace_members')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();
    if (!member) return json({ error: 'Forbidden' }, 403);

    // Pull agents for the workspace
    const { data: agentRows, error: agentsErr } = await admin
      .from('agents')
      .select('id, slug, name, department')
      .eq('workspace_id', workspace_id);
    if (agentsErr || !agentRows || agentRows.length === 0) {
      return json({ error: 'No agents in workspace' }, 400);
    }

    // If a specific agent was targeted (e.g. via @ mention), skip the planner
    // and create a single-step plan assigned to that agent.
    let plan: { plan_summary: string; steps: { agent_slug: string; description: string }[] };
    if (typeof target_agent_slug === 'string') {
      const target = agentRows.find((a) => a.slug === target_agent_slug);
      if (!target) return json({ error: `Unknown agent slug: ${target_agent_slug}` }, 400);
      plan = {
        plan_summary: `${target.name}: ${user_instruction.slice(0, 110)}`,
        steps: [{ agent_slug: target.slug, description: user_instruction }],
      };
    } else {
      plan = await planWithAI(user_instruction, agentRows);
    }

    // Insert plan
    const { data: planRow, error: planErr } = await admin
      .from('task_plans')
      .insert({
        workspace_id,
        user_instruction,
        plan_summary: plan.plan_summary,
        status: 'planning',
        created_by: userId,
      })
      .select('id')
      .single();
    if (planErr || !planRow) return json({ error: planErr?.message ?? 'plan insert failed' }, 500);

    const tasksToInsert = plan.steps.map((s, i) => {
      const a = agentRows.find((ag) => ag.slug === s.agent_slug) ?? agentRows[0];
      return {
        plan_id: planRow.id,
        agent_id: a.id,
        step_index: i,
        description: s.description,
        status: 'pending',
      };
    });
    const { data: insertedTasks, error: tasksErr } = await admin
      .from('tasks')
      .insert(tasksToInsert)
      .select('id, step_index');
    if (tasksErr) return json({ error: tasksErr.message }, 500);

    await admin.from('activity_feed').insert({
      workspace_id,
      plan_id: planRow.id,
      event_type: 'plan_created',
      title: 'Plan created',
      body: plan.plan_summary,
      metadata: { steps: plan.steps },
    });

    await admin.from('task_plans').update({ status: 'executing' }).eq('id', planRow.id);

    const firstTask = insertedTasks?.sort((a, b) => a.step_index - b.step_index)[0];
    if (firstTask) {
      admin.functions
        .invoke('run-agent', { body: { task_id: firstTask.id } })
        .catch((e) => console.error('run-agent kick failed', e));
    }

    const stepsWithNames = plan.steps.map((s) => {
      const a = agentRows.find((ag) => ag.slug === s.agent_slug);
      return { agent_slug: s.agent_slug, agent_name: a?.name ?? s.agent_slug, description: s.description };
    });

    return json({
      plan_id: planRow.id,
      plan_summary: plan.plan_summary,
      steps_count: plan.steps.length,
      steps: stepsWithNames,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('orchestrate error', msg);
    return json({ error: msg }, 500);
  }
});
