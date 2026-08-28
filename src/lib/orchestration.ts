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
// Uses getSession() (in-memory, no network, lightweight on the navigator
// auth lock) so concurrent callers on app mount don't contend with
// useAuth / ClientContext for the same Supabase auth lock. Falls back to
// getUser() only if no cached session is available.
export async function getCurrentWorkspaceId(): Promise<string | null> {
  let userId: string | null = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id ?? null;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[orchestration] getSession failed', e);
  }
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId) return null;

  const { data, error } = await supabase
    .from('workspace_members' as any)
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    const { data: rpc } = await supabase.rpc('provision_workspace_for_user' as any, { _user_id: userId });
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

// Per-call random suffix so duplicate mounts (StrictMode, parallel
// components subscribing to the same workspace+table) don't collide
// on a single shared channel instance. supabase.channel(name) returns
// the same instance for the same name; subsequent .on() calls on an
// already-subscribed channel throw
//   "cannot add 'postgres_changes' callbacks ... after subscribe()".
function uniqueTopic(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}:${rand}`;
}

function subscribeTable(table: string, workspaceId: string, onChange: () => void): Unsub {
  const ch: RealtimeChannel = supabase
    .channel(uniqueTopic(`realtime:${table}:${workspaceId}`))
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
  /**
   * `partial` is written by run-agent when a checkpoint is taken — the plan did
   * real work and still owes the user leads. It was missing from this union
   * while production was already writing it.
   */
  // `blocked` is terminal but not a failure: a guard declined before any paid
  // work, and `error_message` plus `result.terminal_record.blocked_by` say
  // exactly what was missing.
  status: 'planning' | 'executing' | 'awaiting_approval' | 'complete' | 'failed' | 'partial' | 'blocked';
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DBTask {
  id: string;
  plan_id: string;
  agent_id: string | null;
  agent_slug?: string | null;
  step_index: number;
  description: string;
  /**
   * DATABASE LIFECYCLE only. `ready` means checkpointed and available for
   * continuation — it is NOT complete. Legacy rows may still carry `partial`,
   * `completed` or `done`, which the status adapter reads.
   */
  status: 'pending' | 'running' | 'ready' | 'awaiting_approval' | 'complete' | 'failed' | 'skipped'
    | 'partial' | 'completed' | 'done';
  input: any;
  output: any;
  payload?: any;
  /** run-agent writes the structured run result here (incl. `company_first`). */
  result?: any;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface DBToolCall {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  tool_name: string;
  provider: string;
  input_json: any;
  output_json: any;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unavailable' | 'awaiting_approval' | string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
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

/**
 * The parts of `tasks.result` the UI actually reads — and none of the engine's.
 *
 * ── WHY THIS IS NOT `select('*')` ─────────────────────────────────────────
 *
 * `tasks.result` is where run-agent persists the whole structured run, and most
 * of it exists so the NEXT slice can resume: `lead_resume_checkpoint` alone is
 * 626 kB of the 890 kB the five most recent tasks weigh on the wire — 70% of
 * every byte sent, for a key no component has ever read. `capability_execution_
 * state` (269 kB), `evaluation_paths` (129 kB) and `pool_evaluation_checkpoint`
 * are the same: backend state, shipped to a browser that discards it.
 *
 * This function runs on mount, on every realtime event and on a 4-second
 * heartbeat. At roughly 800 kB a read that is ~700 MB per hour of egress from a
 * single open tab watching a single unfinished plan — which is how a project on
 * a 5 GB monthly allowance transferred 15 GB.
 *
 * So the keys are projected server-side and reassembled into the `result` shape
 * the components already read. Two are narrowed further to the one field their
 * reader touches: `capability_execution_state.provider_attempts` (for
 * `hasStoredCompanyRun`) and `company_first_state.candidate_diagnostics`. The
 * checkpoint is never sent, because nothing in the browser resumes a run.
 */
const TASK_LIST_COLUMNS = [
  'id', 'plan_id', 'agent_id', 'agent_slug', 'workspace_id', 'user_id',
  'step_index', 'description', 'status', 'input', 'output', 'payload',
  'error_message', 'started_at', 'finished_at', 'completed_at', 'created_at',
  'checkpoint_version',
  // `result`, minus the engine's resume state. Each is read by a named module.
  'r_task_status:result->task_status',
  'r_terminal_status:result->terminal_status',
  'r_quota:result->quota',
  'r_company_first:result->company_first',
  'r_workbench_progress:result->workbench_progress',
  'r_workbench_evaluation_rows:result->workbench_evaluation_rows',
  'r_workbench_portfolio:result->workbench_portfolio',
  'r_candidate_diagnostics:result->company_first_state->candidate_diagnostics',
  'r_provider_attempts:result->capability_execution_state->provider_attempts',
].join(',');

export async function fetchTasksForPlan(planId: string): Promise<DBTask[]> {
  const { data, error } = await supabase
    .from('tasks' as any).select(TASK_LIST_COLUMNS).eq('plan_id', planId)
    .order('step_index', { ascending: true });
  if (error) { console.error('fetchTasksForPlan', error); return []; }
  return ((data ?? []) as any[]).map((row) => {
    const {
      r_task_status, r_terminal_status, r_quota, r_company_first,
      r_workbench_progress, r_workbench_evaluation_rows, r_workbench_portfolio,
      r_candidate_diagnostics, r_provider_attempts, ...rest
    } = row;

    // ABSENT, NOT EMPTY. A task with no result at all must stay `null` —
    // `taskResultIsPartial` and `taskQuotaUnmet` both return false for a
    // non-object, and handing them a `{}` full of undefined would make a task
    // that never ran indistinguishable from one that ran and reported nothing.
    const present = [
      r_task_status, r_terminal_status, r_quota, r_company_first,
      r_workbench_progress, r_workbench_evaluation_rows, r_workbench_portfolio,
      r_candidate_diagnostics, r_provider_attempts,
    ].some((v) => v !== null && v !== undefined);

    return {
      ...rest,
      result: present
        ? {
          task_status: r_task_status ?? undefined,
          terminal_status: r_terminal_status ?? undefined,
          quota: r_quota ?? undefined,
          company_first: r_company_first ?? undefined,
          workbench_progress: r_workbench_progress ?? undefined,
          workbench_evaluation_rows: r_workbench_evaluation_rows ?? undefined,
          workbench_portfolio: r_workbench_portfolio ?? undefined,
          // Rebuilt at the path its reader expects, carrying only that field.
          company_first_state: r_candidate_diagnostics
            ? { candidate_diagnostics: r_candidate_diagnostics }
            : undefined,
          capability_execution_state: r_provider_attempts
            ? { provider_attempts: r_provider_attempts }
            : undefined,
          result_truncated: true,
        }
        : null,
    };
  }) as unknown as DBTask[];
}

/** The complete stored result for ONE task, fetched only when something needs it. */
export async function fetchTaskResult(taskId: string): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('tasks' as any).select('result').eq('id', taskId).maybeSingle();
  if (error) { console.error('fetchTaskResult', error); return null; }
  return (data as { result?: unknown } | null)?.result ?? null;
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

/**
 * The columns the plan view actually renders, and NOT the provider payload.
 *
 * ── WHY THIS IS NOT `select('*')` ─────────────────────────────────────────
 *
 * `tool_calls.output_json` holds raw provider output — a discovery call
 * carries a hundred companies with their open jobs. Across the table that is
 * 37 MB in 729 rows, with single rows up to 1.4 MB.
 *
 * This function is called on mount AND from a realtime subscription on
 * `tool_calls`, so every insert refetched every row of the plan at full size.
 * For one plan that was 2.4 MB per poll, and while a plan sits unfinished the
 * poll never stops: the REST endpoint began returning 500s and then 504s, and
 * the whole project felt slow — chats included, because they share the same
 * connection pool.
 *
 * The list needs seven small scalars out of that payload. They are projected
 * server-side and reassembled into the `output_json` shape the components
 * already read, so nothing downstream changes. The one place that needs the
 * whole document — the raw output viewer — fetches a single row on demand via
 * `fetchToolCallOutput`.
 */
const TOOL_CALL_LIST_COLUMNS = [
  'id', 'workspace_id', 'plan_id', 'task_id', 'agent_id',
  'tool_name', 'provider', 'status', 'error',
  'started_at', 'completed_at', 'created_by', 'created_at',
  'input_json',
  // Scalars only — each is a value the plan/workbench header renders.
  'o_total:output_json->total',
  'o_run_id:output_json->run_id',
  'o_error:output_json->error',
  'o_code:output_json->code',
  'o_actor_output_type:output_json->actor_output_type',
  'o_selected_actor_key:output_json->selected_actor_key',
  'o_actor_key:output_json->actor_key',
].join(',');

export async function fetchToolCallsForPlan(planId: string): Promise<DBToolCall[]> {
  const { data, error } = await supabase
    .from('tool_calls' as any).select(TOOL_CALL_LIST_COLUMNS).eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) { console.error('fetchToolCallsForPlan', error); return []; }
  return ((data ?? []) as any[]).map((r) => {
    const {
      o_total, o_run_id, o_error, o_code,
      o_actor_output_type, o_selected_actor_key, o_actor_key, ...rest
    } = r;
    return {
      ...rest,
      // REASSEMBLED, NOT INVENTED. Only the keys the list reads are present;
      // everything else is absent rather than wrong, and the raw viewer loads
      // the real document when it is opened.
      output_json: {
        total: o_total ?? undefined,
        run_id: o_run_id ?? undefined,
        error: o_error ?? undefined,
        code: o_code ?? undefined,
        actor_output_type: o_actor_output_type ?? undefined,
        selected_actor_key: o_selected_actor_key ?? undefined,
        actor_key: o_actor_key ?? undefined,
      },
      output_truncated: true,
    };
  }) as unknown as DBToolCall[];
}

/** The full provider payload for ONE tool call, fetched only when displayed. */
export async function fetchToolCallOutput(id: string): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('tool_calls' as any).select('output_json').eq('id', id).maybeSingle();
  if (error) { console.error('fetchToolCallOutput', error); return null; }
  return (data as { output_json?: unknown } | null)?.output_json ?? null;
}

export const subscribePlan = (planId: string, cb: () => void) => {
  const ch = supabase.channel(uniqueTopic(`realtime:plan:${planId}`))
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'task_plans', filter: `id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tasks', filter: `plan_id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'activity_feed', filter: `plan_id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'approvals', filter: `plan_id=eq.${planId}` }, cb)
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tool_calls', filter: `plan_id=eq.${planId}` }, cb)
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

// ---------------- Agent Builder ----------------
export interface CreateAgentCapability {
  capability: string;
  input_type: string;
  output_type: string;
  priority?: number;
}

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  department: AgentDept;
  rolePrompt: string;
  model: string;
  avatarColor: string;
  tools: string[];
  triggerType?: string;
  capabilities: CreateAgentCapability[];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `agent-${Date.now().toString(36)}`;
}

export async function createAgent(input: CreateAgentInput): Promise<DBAgent> {
  const baseSlug = slugify(input.name);
  // Ensure uniqueness within the workspace by appending a short suffix if needed.
  let slug = baseSlug;
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from('agents' as any)
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('slug', slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 5)}`;
  }

  const { data: agent, error } = await supabase
    .from('agents' as any)
    .insert({
      workspace_id: input.workspaceId,
      slug,
      name: input.name,
      department: input.department,
      model: input.model,
      role_prompt: input.rolePrompt,
      avatar_color: input.avatarColor,
      tools: input.tools,
      trigger_type: input.triggerType ?? 'on_demand',
      is_default: false,
      status: 'idle',
      progress: 0,
    })
    .select('*')
    .single();

  if (error || !agent) throw error ?? new Error('Failed to create agent');

  if (input.capabilities.length > 0) {
    const rows = input.capabilities.map((c, idx) => ({
      agent_id: (agent as any).id,
      capability: c.capability,
      input_type: c.input_type,
      output_type: c.output_type,
      priority: c.priority ?? idx + 1,
      enabled: true,
    }));
    const { error: capErr } = await supabase
      .from('agent_capabilities' as any)
      .insert(rows);
    if (capErr) throw capErr;
  }

  return agent as unknown as DBAgent;
}
