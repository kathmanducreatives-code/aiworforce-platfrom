// approve-and-continue: human acts on a pending approval, then we either
// resume the plan (approve) or fail it (reject).
// Input: { approval_id: string, action: 'approve' | 'reject' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: 'Unauthorized' }, 401);
    const userId = userData.user.id;

    const { approval_id, action } = await req.json().catch(() => ({}));
    if (typeof approval_id !== 'string') return json({ error: 'approval_id required' }, 400);
    if (action !== 'approve' && action !== 'reject') {
      return json({ error: 'action must be "approve" or "reject"' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: approval } = await admin
      .from('approvals')
      .select('id, workspace_id, plan_id, agent_id, task_id, description, status')
      .eq('id', approval_id)
      .single();
    if (!approval) return json({ error: 'approval not found' }, 404);
    if (approval.status !== 'pending') return json({ ok: true, already_decided: true });

    // Membership check
    const { data: member } = await admin
      .from('workspace_members')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', approval.workspace_id)
      .maybeSingle();
    if (!member) return json({ error: 'Forbidden' }, 403);

    const decidedAt = new Date().toISOString();
    await admin
      .from('approvals')
      .update({ status: action === 'approve' ? 'approved' : 'rejected', decided_by: userId, decided_at: decidedAt })
      .eq('id', approval.id);

    await admin.from('activity_feed').insert({
      workspace_id: approval.workspace_id,
      plan_id: approval.plan_id,
      agent_id: approval.agent_id,
      event_type: action === 'approve' ? 'approved' : 'rejected',
      title: action === 'approve' ? 'You approved' : 'You rejected',
      body: approval.description,
    });

    if (action === 'approve') {
      // Mark the gating task complete and resume from the next pending task
      if (approval.task_id) {
        await admin
          .from('tasks')
          .update({ status: 'complete', finished_at: decidedAt, output: { approved: true } })
          .eq('id', approval.task_id);
      }
      // Reset agent to idle
      if (approval.agent_id) {
        await admin
          .from('agents')
          .update({ status: 'idle', progress: 0, current_task: null })
          .eq('id', approval.agent_id);
      }

      const { data: nextTasks } = await admin
        .from('tasks')
        .select('id')
        .eq('plan_id', approval.plan_id!)
        .eq('status', 'pending')
        .order('step_index', { ascending: true })
        .limit(1);
      const next = nextTasks?.[0];

      if (next) {
        await admin.from('task_plans').update({ status: 'executing' }).eq('id', approval.plan_id!);
        admin.functions
          .invoke('run-agent', { body: { task_id: next.id } })
          .catch((e) => console.error('resume run-agent failed', e));
      } else {
        await admin
          .from('task_plans')
          .update({ status: 'complete', completed_at: decidedAt })
          .eq('id', approval.plan_id!);
        await admin.from('activity_feed').insert({
          workspace_id: approval.workspace_id,
          plan_id: approval.plan_id,
          event_type: 'plan_complete',
          title: 'Plan complete',
          body: 'All steps finished.',
        });
      }
    } else {
      // Reject: fail plan, idle agent
      if (approval.agent_id) {
        await admin
          .from('agents')
          .update({ status: 'idle', progress: 0, current_task: null })
          .eq('id', approval.agent_id);
      }
      await admin.from('task_plans').update({ status: 'failed' }).eq('id', approval.plan_id!);
    }

    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('approve-and-continue error', msg);
    return json({ error: msg }, 500);
  }
});
