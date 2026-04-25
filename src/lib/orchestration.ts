// Centralized data layer for the orchestration backend (workspaces, agents,
// task plans, activity feed, approvals). All queries are workspace-scoped.

import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type AgentDept = 'talent' | 'growth' | 'intelligence' | 'content' | 'operations';
export type AgentStatus = 'idle' | 'running' | 'awaiting_approval' | 'error';

export interface DBAgent {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  department: AgentDept;
  model: string;
  status: AgentStatus;
  current_task: string | null;
  progress: number;
  last_active_at: string | null;
}

export interface DBApproval {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export type ActivityEventType =
  | 'plan_created'
  | 'agent_started'
  | 'handoff'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'plan_complete';

export interface DBActivity {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  agent_id: string | null;
  event_type: ActivityEventType;
  title: string;
  body: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// ---------------- Workspace ----------------
export async function getCurrentWorkspaceId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('workspace_members' as any)
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    // Self-provision via RPC fallback (in case the trigger didn't run for this user)
    const { data: rpc } = await supabase.rpc('provision_workspace_for_user' as any, { _user_id: user.id });
    return (rpc as unknown as string) ?? null;
  }
  return (data as any).workspace_id as string;
}

// ---------------- Fetchers ----------------
export async function fetchAgents(workspaceId: string): Promise<DBAgent[]> {
  const { data, error } = await supabase
    .from('agents' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) { console.error('fetchAgents', error); return []; }
  return (data ?? []) as unknown as DBAgent[];
}

export async function fetchActivityFeed(workspaceId: string, limit = 50): Promise<DBActivity[]> {
  const { data, error } = await supabase
    .from('activity_feed' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('fetchActivityFeed', error); return []; }
  return (data ?? []) as unknown as DBActivity[];
}

export async function fetchPendingApprovals(workspaceId: string): Promise<DBApproval[]> {
  const { data, error } = await supabase
    .from('approvals' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchPendingApprovals', error); return []; }
  return (data ?? []) as unknown as DBApproval[];
}

// ---------------- Subscriptions ----------------
type Unsub = () => void;

function subscribeTable(table: string, workspaceId: string, onChange: () => void): Unsub {
  const ch: RealtimeChannel = supabase
    .channel(`realtime:${table}:${workspaceId}`)
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` },
      () => onChange(),
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

export const subscribeAgents = (ws: string, cb: () => void) => subscribeTable('agents', ws, cb);
export const subscribeActivityFeed = (ws: string, cb: () => void) => subscribeTable('activity_feed', ws, cb);
export const subscribeApprovals = (ws: string, cb: () => void) => subscribeTable('approvals', ws, cb);
export const subscribePlans = (ws: string, cb: () => void) => subscribeTable('task_plans', ws, cb);

// ---------------- Plans / Tasks ----------------
export interface DBPlan {
  id: string;
  workspace_id: string;
  user_instruction: string;
  plan_summary: string | null;
  status: 'planning' | 'executing' | 'awaiting_approval' | 'complete' | 'failed';
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DBTask {
  id: string;
  plan_id: string;
  agent_id: string | null;
  step_index: number;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  input: any;
  output: any;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function fetchPlans(workspaceId: string, limit = 50): Promise<DBPlan[]> {
  const { data, error } = await supabase
    .from('task_plans' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('fetchPlans', error); return []; }
  return (data ?? []) as unknown as DBPlan[];
}

export async function fetchPlan(planId: string): Promise<DBPlan | null> {
  const { data, error } = await supabase
    .from('task_plans' as any).select('*').eq('id', planId).maybeSingle();
  if (error) { console.error('fetchPlan', error); return null; }
  return (data as unknown as DBPlan) ?? null;
}

export async function fetchTasksForPlan(planId: string): Promise<DBTask[]> {
  const { data, error } = await supabase
    .from('tasks' as any).select('*').eq('plan_id', planId).order('step_index', { ascending: true });
  if (error) { console.error('fetchTasksForPlan', error); return []; }
  return (data ?? []) as unknown as DBTask[];
}

export async function fetchActivityForPlan(planId: string): Promise<DBActivity[]> {
  const { data, error } = await supabase
    .from('activity_feed' as any).select('*').eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) { console.error('fetchActivityForPlan', error); return []; }
  return (data ?? []) as unknown as DBActivity[];
}

export async function fetchApprovalsForPlan(planId: string): Promise<DBApproval[]> {
  const { data, error } = await supabase
    .from('approvals' as any).select('*').eq('plan_id', planId)
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchApprovalsForPlan', error); return []; }
  return (data ?? []) as unknown as DBApproval[];
}

export const subscribePlan = (planId: string, cb: () => void) => {
  const ch = supabase.channel(`realtime:plan:${planId}`)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'task_plans', filter: `id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tasks', filter: `plan_id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'activity_feed', filter: `plan_id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'approvals', filter: `plan_id=eq.${planId}` }, cb)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
};

// ---------------- Edge function calls ----------------
export interface SubmitResult {
  plan_id: string;
  plan_summary: string;
  steps_count: number;
  steps?: { agent_slug: string; agent_name: string; description: string }[];
}

export async function submitInstruction(
  workspaceId: string,
  userInstruction: string,
  opts?: { agentSlug?: string },
): Promise<SubmitResult> {
  const { data, error } = await supabase.functions.invoke('orchestrate', {
    body: {
      workspace_id: workspaceId,
      user_instruction: userInstruction,
      ...(opts?.agentSlug ? { target_agent_slug: opts.agentSlug } : {}),
    },
  });
  if (error) throw error;
  return data as SubmitResult;
}

export async function decideApproval(approvalId: string, action: 'approve' | 'reject') {
  const { data, error } = await supabase.functions.invoke('approve-and-continue', {
    body: { approval_id: approvalId, action },
  });
  if (error) throw error;
  return data as { ok: boolean };
}

export async function pingOrchestrate() {
  const { data, error } = await supabase.functions.invoke('orchestrate', { body: { ping: true } });
  if (error) throw error;
  return data as { ok: boolean };
}
