// Company Brain memory — browser data access.
//
// READS go straight to the tables over RLS (members read their own workspace;
// nobody reads another). WRITES go through the `company-brain-memory` edge
// function, which checks the role and then calls SECURITY DEFINER functions
// that re-check it inside the write's own transaction. The browser cannot write
// these tables at all (no grant), so there is no client-side bypass to guard.
//
// Every write carries a fresh idempotency key, created once per user action and
// reused on retry, so a double-click or a network retry records one change.
import { supabase } from '@/integrations/supabase/client';
import {
  MEMORY_COLUMNS, type MemoryItem,
} from '../../../supabase/functions/_shared/brainMemoryModel.ts';

export interface MemoryProposal {
  id: string;
  proposed_by_agent: string;
  kind: 'fact' | 'preference';
  category: string;
  fact_key: string;
  value_type: string;
  value: unknown;
  rationale: string;
  evidence: Array<{ source_url?: string; source_ref?: string; observed_at?: string; excerpt?: string }>;
  source_type: string;
  confidence: 'high' | 'medium' | 'low';
  status: string;
  contradicts_memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryHistoryRow {
  id: string;
  memory_id: string | null;
  proposal_id: string | null;
  change_kind: string;
  from_version: number | null;
  to_version: number | null;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  actor_kind: string;
  actor_id: string | null;
  actor_agent: string | null;
  reason: string | null;
  created_at: string;
}

export interface RevisionRow {
  id: string;
  revision: number;
  changed_sections: string[];
  actor_kind: string;
  actor_id: string | null;
  written_at: string;
  redacted_at: string | null;
}

export interface MemorySnapshot {
  items: MemoryItem[];
  proposals: MemoryProposal[];
  history: MemoryHistoryRow[];
  revisions: RevisionRow[];
}

/** Thrown when this environment has no memory tables (the migration is not applied there). */
export class MemoryUnavailableError extends Error {
  constructor() { super('Company Brain memory is not enabled on this environment yet.'); }
}

const missing = (e: { message?: string; code?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? ''));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (t: string) => (supabase as any).from(t);

export async function fetchMemorySnapshot(workspaceId: string): Promise<MemorySnapshot> {
  const [items, proposals, history, revisions] = await Promise.all([
    from('company_brain_memory').select(MEMORY_COLUMNS).eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }).limit(500),
    from('company_brain_memory_proposals')
      .select('id, proposed_by_agent, kind, category, fact_key, value_type, value, rationale, evidence, source_type, confidence, status, contradicts_memory_id, created_at, updated_at')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(200),
    from('company_brain_memory_history')
      .select('id, memory_id, proposal_id, change_kind, from_version, to_version, previous, current, actor_kind, actor_id, actor_agent, reason, created_at')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(200),
    from('company_brain_revisions')
      .select('id, revision, changed_sections, actor_kind, actor_id, written_at, redacted_at')
      .eq('workspace_id', workspaceId).order('revision', { ascending: false }).limit(50),
  ]);
  for (const r of [items, proposals, history, revisions]) {
    if (missing(r.error)) throw new MemoryUnavailableError();
    if (r.error) throw r.error;
  }
  return {
    items: (items.data ?? []) as MemoryItem[],
    proposals: (proposals.data ?? []) as MemoryProposal[],
    history: (history.data ?? []) as MemoryHistoryRow[],
    revisions: (revisions.data ?? []) as RevisionRow[],
  };
}

export interface MemoryWriteResult {
  outcome: string;
  memory_id?: string;
  version?: number;
  reason?: string;
  replayed?: boolean;
  status?: string;
}

/** A user-facing error that carries the server's outcome (stale, forbidden_role, …). */
export class MemoryWriteError extends Error {
  constructor(public outcome: string, message: string) { super(message); }
}

const OUTCOME_TEXT: Record<string, string> = {
  stale: 'Someone changed this a moment ago. The page now shows the latest version — please review and try again.',
  forbidden_role: 'Your role can view the Company Brain but not change it.',
  brain_role_forbidden: 'Your role can view the Company Brain but not change it.',
  not_member: 'You are no longer a member of this workspace.',
  session_invalid: 'Your session expired. Sign in again to continue.',
  not_pending: 'This proposal was already reviewed.',
  not_found: 'That item no longer exists.',
  idempotency_conflict: 'This request was already used for a different change. Please try again.',
  memory_unavailable: 'Company Brain memory is not enabled on this environment yet.',
};

export function memoryErrorText(outcome: string, reason?: string): string {
  return OUTCOME_TEXT[outcome] ?? (outcome === 'invalid' && reason ? `Not saved: ${reason}.` : 'Something went wrong. Nothing was changed.');
}

async function invokeMemory(body: Record<string, unknown>): Promise<MemoryWriteResult> {
  const { data, error } = await supabase.functions.invoke('company-brain-memory', { body });
  // A non-2xx response arrives as `error` with the JSON body on `context`.
  let payload = data as Record<string, unknown> | null;
  if (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = (error as any).context;
      payload = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
    } catch { payload = null; }
    const outcome = String(payload?.outcome ?? payload?.reason ?? payload?.error ?? 'error');
    throw new MemoryWriteError(outcome, memoryErrorText(outcome, String(payload?.reason ?? '')));
  }
  const out = (payload ?? {}) as unknown as MemoryWriteResult;
  if (!['ok', 'unchanged', 'already_recorded', 'created', 'duplicate_pending', 'already_known', 'contradiction', 'nothing_to_propose'].includes(out.outcome)) {
    throw new MemoryWriteError(out.outcome, memoryErrorText(out.outcome, out.reason));
  }
  return out;
}

export const newIdempotencyKey = (): string => `ui-${crypto.randomUUID()}`;

export function writeMemory(workspaceId: string, op: string, payload: Record<string, unknown>, idempotencyKey = newIdempotencyKey()) {
  return invokeMemory({ action: 'write', workspace_id: workspaceId, op, payload, idempotency_key: idempotencyKey });
}

export function reviewProposal(workspaceId: string, proposalId: string, decision: 'approve' | 'correct' | 'reject', extra: {
  correctedValue?: unknown; note?: string; expectedMemoryVersion?: number | null; idempotencyKey?: string;
} = {}) {
  return invokeMemory({
    action: 'review_proposal', workspace_id: workspaceId, proposal_id: proposalId, decision,
    corrected_value: extra.correctedValue, note: extra.note ?? null,
    expected_memory_version: extra.expectedMemoryVersion ?? null, idempotency_key: extra.idempotencyKey ?? newIdempotencyKey(),
  });
}

export function redactMemory(workspaceId: string, target: 'memory' | 'revision', id: string, reason: string) {
  return invokeMemory({ action: 'redact', workspace_id: workspaceId, target, id, reason });
}

export interface AgentUsage {
  status: string;
  warnings: string[];
  applied: Array<{ memory_id: string; fact_key: string; effect: string }>;
  agents: Record<'orion' | 'atlas' | 'lyra' | 'lisa', string>;
}

export async function fetchAgentUsage(workspaceId: string): Promise<AgentUsage> {
  const { data, error } = await supabase.functions.invoke('company-brain-memory', { body: { action: 'context', workspace_id: workspaceId } });
  if (error) throw error;
  return data as AgentUsage;
}

/**
 * Remember that this signal was dismissed (or restored) — as a decision scoped
 * to THAT signal, so ORION stops briefing it. Best-effort: a viewer's dismissal
 * stays personal (the server refuses their Brain write), and an environment
 * without memory simply keeps the per-user review.
 */
export async function recordSignalDecision(workspaceId: string, signalId: string, dismissed: boolean): Promise<void> {
  try {
    await writeMemory(workspaceId, 'decide', {
      category: 'signal_dismissed', scope: 'signal', scope_ref: signalId,
      value: { outcome: dismissed ? 'dismissed' : 'restored', subject: { type: 'signal', ref: signalId } },
    });
  } catch { /* advisory: the review itself already saved */ }
}
