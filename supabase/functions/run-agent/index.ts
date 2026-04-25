// run-agent: executes a single task in a plan. Internal-only (called by orchestrate
// and by approve-and-continue). Uses the service role for all writes.
// Input: { task_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Heuristic: certain verbs in a step description require human approval
function requiresApproval(description: string): boolean {
  const d = description.toLowerCase();
  return /\b(send|email|post|publish|message|dm|invite|schedule|book|launch|deploy|reach out|contact)\b/.test(d);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { task_id } = await req.json().catch(() => ({}));
    if (typeof task_id !== 'string') return json({ error: 'task_id required' }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load task + plan + agent
    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('id, plan_id, agent_id, step_index, description, status')
      .eq('id', task_id)
      .single();
    if (taskErr || !task) return json({ error: 'task not found' }, 404);
    if (task.status !== 'pending') return json({ ok: true, skipped: true });

    const { data: plan } = await admin
      .from('task_plans')
      .select('id, workspace_id')
      .eq('id', task.plan_id)
      .single();
    if (!plan) return json({ error: 'plan not found' }, 404);

    const { data: agent } = await admin
      .from('agents')
      .select('id, slug, name, department')
      .eq('id', task.agent_id!)
      .single();

    // Mark task running + agent running
    const startedAt = new Date().toISOString();
    await admin.from('tasks').update({ status: 'running', started_at: startedAt }).eq('id', task.id);
    if (agent) {
      await admin
        .from('agents')
        .update({ status: 'running', current_task: task.description, last_active_at: startedAt, progress: 25 })
        .eq('id', agent.id);
      await admin.from('activity_feed').insert({
        workspace_id: plan.workspace_id,
        plan_id: plan.id,
        agent_id: agent.id,
        event_type: 'agent_started',
        title: `${agent.name} started`,
        body: task.description,
      });
    }

    // Simulate work — small delay so the UI shows the running state
    await new Promise((r) => setTimeout(r, 600));

    // Decide: needs approval or completes
    if (requiresApproval(task.description)) {
      await admin
        .from('approvals')
        .insert({
          workspace_id: plan.workspace_id,
          plan_id: plan.id,
          agent_id: agent?.id ?? null,
          task_id: task.id,
          title: `${agent?.name ?? 'Agent'} needs approval`,
          description: task.description,
          payload: { step_index: task.step_index },
          status: 'pending',
        });
      if (agent) {
        await admin.from('agents').update({ status: 'awaiting_approval', progress: 80 }).eq('id', agent.id);
      }
      await admin.from('task_plans').update({ status: 'awaiting_approval' }).eq('id', plan.id);
      await admin.from('activity_feed').insert({
        workspace_id: plan.workspace_id,
        plan_id: plan.id,
        agent_id: agent?.id ?? null,
        event_type: 'awaiting_approval',
        title: `Awaiting your approval`,
        body: task.description,
      });
      return json({ ok: true, awaiting_approval: true });
    }

    // Complete task
    const finishedAt = new Date().toISOString();
    await admin
      .from('tasks')
      .update({ status: 'complete', finished_at: finishedAt, output: { note: 'auto-completed' } })
      .eq('id', task.id);

    // Find next task
    const { data: nextTasks } = await admin
      .from('tasks')
      .select('id, agent_id, step_index, description')
      .eq('plan_id', plan.id)
      .eq('status', 'pending')
      .order('step_index', { ascending: true })
      .limit(1);
    const next = nextTasks?.[0];

    if (next) {
      // Handoff
      if (agent && next.agent_id) {
        await admin.from('handoffs').insert({
          plan_id: plan.id,
          from_agent_id: agent.id,
          to_agent_id: next.agent_id,
          payload: { from_step: task.step_index, to_step: next.step_index },
        });
        const { data: nextAgent } = await admin
          .from('agents')
          .select('name')
          .eq('id', next.agent_id)
          .single();
        await admin.from('activity_feed').insert({
          workspace_id: plan.workspace_id,
          plan_id: plan.id,
          agent_id: next.agent_id,
          event_type: 'handoff',
          title: `${agent.name} → ${nextAgent?.name ?? 'next agent'}`,
          body: next.description,
          metadata: { from_agent: agent.name, to_agent: nextAgent?.name },
        });
      }
      if (agent) {
        await admin.from('agents').update({ status: 'idle', progress: 0, current_task: null }).eq('id', agent.id);
      }
      // Recurse
      admin.functions
        .invoke('run-agent', { body: { task_id: next.id } })
        .catch((e) => console.error('next run-agent invoke failed', e));
      return json({ ok: true, next_task_id: next.id });
    }

    // No more tasks — plan complete
    if (agent) {
      await admin.from('agents').update({ status: 'idle', progress: 0, current_task: null }).eq('id', agent.id);
    }
    await admin
      .from('task_plans')
      .update({ status: 'complete', completed_at: finishedAt })
      .eq('id', plan.id);
    await admin.from('activity_feed').insert({
      workspace_id: plan.workspace_id,
      plan_id: plan.id,
      event_type: 'plan_complete',
      title: 'Plan complete',
      body: 'All steps finished.',
    });
    return json({ ok: true, complete: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('run-agent error', msg);
    return json({ error: msg }, 500);
  }
});
