// The reads behind Recent Activity — narrow columns only.
//
// `tasks.result` can weigh hundreds of kilobytes; nothing here selects it or
// `*`. Task outcomes are read as three JSON paths, computed by PostgREST on the
// server, so a row costs a few bytes. Every read is filtered by workspace and
// RLS (has_workspace_access) enforces the same boundary underneath.

import { supabase } from '@/integrations/supabase/client';
import {
  CURATED_EVENT_TYPES, outcomeFromNumbers,
  type ActivityRow, type DraftRow, type FailedTaskRow, type SignalRow, type TaskOutcome,
} from './activityFeedModel';

// Typed as plain `string` on purpose: the client's select-string parser does
// not follow JSON paths and recurses until TypeScript gives up. Rows are cast
// to the model's narrow types below.
const ACTIVITY_COLUMNS: string = 'id,workspace_id,agent_id,event_type,title,body,metadata,plan_id,task_plan_id,created_at';
const SIGNAL_COLUMNS: string = 'id,workspace_id,signal_type,created_at,verification_status,lifecycle_status,title:normalized_value->>title,company:normalized_value->>company_name';
const FAILED_TASK_COLUMNS: string = 'id,workspace_id,agent_slug,status,updated_at,error_message,plan_id,task_plan_id,terminal:result->>terminal_status';
// Three JSON paths, computed by PostgREST — never the multi-hundred-KB `result`.
const TASK_OUTCOME_COLUMNS: string = 'id,status,terminal:result->>terminal_status,discovered:result->run_outcome->funnel->>discovered,relevant:result->workbench_triage_counts->>relevant';

export async function fetchActivityRows(workspaceId: string, limit = 40): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('activity_feed')
    .select(ACTIVITY_COLUMNS)
    .eq('workspace_id', workspaceId)
    .in('event_type', CURATED_EVENT_TYPES as unknown as string[])
    // In-workflow tool errors are retries (hundreds of them); only plan-less
    // ones — scheduled jobs — are activity.
    .or('event_type.neq.tool_failed,and(plan_id.is.null,task_plan_id.is.null)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

export async function fetchSignalRows(workspaceId: string, limit = 15): Promise<SignalRow[]> {
  const { data, error } = await supabase
    .from('signal_events')
    .select(SIGNAL_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as SignalRow[];
}

export async function fetchDraftRows(workspaceId: string, limit = 10): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from('outreach_drafts')
    .select('id,workspace_id,channel,subject,status,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as DraftRow[];
}

export async function fetchFailedTaskRows(workspaceId: string, limit = 10): Promise<FailedTaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(FAILED_TASK_COLUMNS)
    .eq('workspace_id', workspaceId)
    .in('status', ['failed', 'blocked'])
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as FailedTaskRow[];
}

/** Outcome facts for the tasks a completion event reports on. */
export async function fetchTaskOutcomes(workspaceId: string, taskIds: readonly string[]): Promise<Record<string, TaskOutcome>> {
  if (!taskIds.length) return {};
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_OUTCOME_COLUMNS)
    .eq('workspace_id', workspaceId)
    .in('id', taskIds as string[]);
  if (error) throw error;
  type Row = { id: string; status: string | null; terminal: string | null; discovered: unknown; relevant: unknown };
  return Object.fromEntries(((data ?? []) as unknown as Row[]).map((r) => [r.id, outcomeFromNumbers(r.id, r.status, r.terminal, r.discovered, r.relevant)]));
}

/** What the person asked for, per plan — the entity line of a workflow event. */
export async function fetchPlanInstructions(workspaceId: string, planIds: readonly string[]): Promise<Record<string, string>> {
  if (!planIds.length) return {};
  const { data, error } = await supabase
    .from('task_plans')
    .select('id,user_instruction,goal')
    .eq('workspace_id', workspaceId)
    .in('id', planIds as string[]);
  if (error) throw error;
  type Row = { id: string; user_instruction: string | null; goal: string | null };
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as unknown as Row[]) out[r.id] = (r.user_instruction ?? r.goal ?? '').trim();
  // Plans that came back empty are remembered too, so they are not asked again.
  for (const id of planIds) if (!(id in out)) out[id] = '';
  return out;
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * activity_feed INSERTs for one workspace (it is in the supabase_realtime
 * publication; RLS scopes delivery). Returns the unsubscribe.
 */
export function subscribeActivityInserts(
  workspaceId: string,
  onRow: (row: ActivityRow) => void,
  onStatus: (s: LiveStatus) => void,
): () => void {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const channel = supabase.channel(`recent-activity:${workspaceId}:${rand}`);
  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'activity_feed', filter: `workspace_id=eq.${workspaceId}` },
    (payload) => onRow(payload.new as ActivityRow),
  );
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onStatus('live');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('offline');
  });
  return () => { void supabase.removeChannel(channel); };
}
