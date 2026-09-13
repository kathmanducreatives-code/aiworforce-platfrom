// The reads behind an agent's visual state — scalar columns only.
//
// `tasks.result` can weigh hundreds of kilobytes per row (see the note on
// TASK_LIST_COLUMNS in orchestration.ts), and this runs from the home page.
// So nothing here selects `*` or any JSON column: a read is a handful of ids,
// statuses and timestamps, a few kilobytes at most.

import { supabase } from '@/integrations/supabase/client';
import { RUNNING_FRESH_MS, type LivePlan, type LiveTask } from './visualState.ts';

const TASK_COLUMNS = 'id,agent_slug,status,started_at,finished_at,completed_at,updated_at,created_at';

type TaskRow = { id: string; agent_slug: string | null; status: string | null; started_at: string | null; finished_at: string | null; completed_at: string | null; updated_at: string | null; created_at: string | null };

/**
 * Tasks that could change a visual right now: anything still `running` or
 * `pending` (staleness is judged later, by the pure layer), plus anything
 * touched inside the freshness window — which is where recent finishes live.
 */
export async function fetchLiveTasks(workspaceId: string, now: number): Promise<LiveTask[]> {
  const since = new Date(now - RUNNING_FRESH_MS).toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('workspace_id', workspaceId)
    .or(`status.in.(running,pending),updated_at.gte."${since}"`)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return ((data ?? []) as unknown as TaskRow[]).map((r) => ({
    id: r.id, agentSlug: r.agent_slug, status: r.status,
    startedAt: r.started_at, finishedAt: r.finished_at, completedAt: r.completed_at,
    updatedAt: r.updated_at, createdAt: r.created_at,
  }));
}

/** Plans still being planned — the only plan status that says someone is thinking. */
export async function fetchPlanningPlans(workspaceId: string): Promise<LivePlan[]> {
  const { data, error } = await supabase
    .from('task_plans')
    .select('id,status,created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'planning')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; status: string | null; created_at: string | null }[])
    .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at }));
}

/** agents.id → slug, for attributing approvals. Changes rarely; read once per workspace. */
export async function fetchAgentSlugs(workspaceId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('agents').select('id,slug').eq('workspace_id', workspaceId);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as unknown as { id: string; slug: string }[]).map((r) => [r.id, r.slug]));
}

/** task id → agent slug, for approvals whose task is older than the live window. */
export async function fetchTaskSlugs(taskIds: readonly string[]): Promise<Record<string, string | null>> {
  if (!taskIds.length) return {};
  const { data, error } = await supabase.from('tasks').select('id,agent_slug').in('id', taskIds as string[]);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as unknown as { id: string; agent_slug: string | null }[]).map((r) => [r.id, r.agent_slug]));
}
