// PERSISTED COMPANY-FIRST SOURCING STATE.
//
// The 2026-07-26 run (task 71db3ced) returned 504 after 152.2s: round 1 took
// ~124s, round 2 started, the isolate was killed, and because the result JSON is
// only written at the very END, everything was lost — the task sat at `running`
// forever and a retry would have re-paid for round 1.
//
// State lives in `tasks.result.company_first_state` — an EXISTING jsonb column, so
// there is NO migration. It is rewritten after every completed round, so a platform
// kill can never cost more than the round in flight.

export const SOURCING_STATE_VERSION = "company-first-state-1.0.0";
export const SOURCING_STATE_KEY = "company_first_state";

export type SourcingNextAction =
  | "start_round" | "continue_round" | "finalize" | "stopped";

export interface CompletedProviderCall {
  idempotency_key: string;
  round: number;
  actor_key: string;
  /** Company dedupe key for people calls; null for jobs calls. */
  company_key: string | null;
  item_count: number;
  completed_at: string;
}

export interface RoundCheckpoint {
  round_number: number;
  strategy_hash: string;
  title_queries: string[];
  /** Titles this round actually SENT (delta only — never re-sent earlier titles). */
  delta_titles: string[];
  plan_source: string;
  planner_status: string | null;
  funnel: Record<string, number>;
  eligible_after: number;
  remaining_after: number;
  estimated_cost: number;
  actual_provider_calls: number;
  completed_at: string;
}

export interface CompanyFirstSourcingState {
  version: string;
  workspace_id: string;
  task_id: string;
  /** Quota contract, preserved across invocations. */
  requested_lead_count: number;
  quota_policy: string;
  eligible_leads: number;
  remaining_leads: number;
  current_round: number;
  completed_rounds: RoundCheckpoint[];
  /** Every title already searched — the source of delta-only expansion. */
  attempted_titles: string[];
  attempted_strategy_hashes: string[];
  /** Cross-round dedupe identities. */
  seen_job_urls: string[];
  seen_company_keys: string[];
  seen_lead_keys: string[];
  /** Lead keys already written by the guarded adapter — persistence happens ONCE. */
  persisted_lead_keys: string[];
  /** Durable identities of paid calls that already completed. */
  completed_calls: CompletedProviderCall[];
  estimated_cost: number;
  actual_cost: number;
  /** Sanitized per-candidate diagnostics carried across rounds. */
  candidate_diagnostics: Array<Record<string, unknown>>;
  planner_metadata: Array<Record<string, unknown>>;
  next_action: SourcingNextAction;
  terminal_status: string | null;
  terminal_reason: string | null;
  checkpoint_at: string;

  /**
   * Slices owned by OTHER authorities, carried in this same record.
   *
   * PR #108 and #109 both describe their state as living "inside the existing
   * company-first checkpoint" — which was the right design and was never actually
   * written anywhere. They belong here rather than in a parallel store because a
   * resumed run must restore step progress, fused evidence and the feedback ledger
   * at the SAME instant as the quota and dedupe state they were derived from. A
   * separate store could be restored out of step, and then a resumed task would
   * disagree with itself about what it had already paid for.
   *
   * Untyped on purpose: this module is the envelope, not the owner. Each slice is
   * validated by its own authority on the way back in — `stateMatchesPlan` for
   * source execution, the version check for fusion and feedback — so a slice from
   * an older contract is discarded rather than trusted.
   *
   * No migration: `tasks.result.company_first_state` is already jsonb.
   */
  slices?: Record<string, unknown>;
}

export function newSourcingState(args: {
  workspaceId: string; taskId: string; requestedLeadCount: number; quotaPolicy: string; now: string;
}): CompanyFirstSourcingState {
  return {
    version: SOURCING_STATE_VERSION,
    workspace_id: args.workspaceId, task_id: args.taskId,
    requested_lead_count: args.requestedLeadCount, quota_policy: args.quotaPolicy,
    eligible_leads: 0, remaining_leads: args.requestedLeadCount,
    current_round: 1, completed_rounds: [],
    attempted_titles: [], attempted_strategy_hashes: [],
    seen_job_urls: [], seen_company_keys: [], seen_lead_keys: [], persisted_lead_keys: [],
    completed_calls: [], estimated_cost: 0, actual_cost: 0,
    candidate_diagnostics: [], planner_metadata: [],
    next_action: "start_round", terminal_status: null, terminal_reason: null,
    checkpoint_at: args.now,
  };
}

/** Reject a checkpoint from another tenant/task — defence in depth on resume. */
export function stateBelongsTo(s: CompanyFirstSourcingState | null, workspaceId: string, taskId: string): boolean {
  return !!s && s.workspace_id === workspaceId && s.task_id === taskId && s.version === SOURCING_STATE_VERSION;
}

/** A task is resumable when a checkpoint exists and no terminal status was set. */
export function isResumable(s: CompanyFirstSourcingState | null): boolean {
  return !!s && s.terminal_status === null && s.next_action !== "stopped" && s.completed_rounds.length > 0;
}

/** Titles that have never been searched — the ONLY ones a new round may send. */
export function deltaTitles(state: CompanyFirstSourcingState, plannedTitles: string[]): string[] {
  const seen = new Set(state.attempted_titles.map((t) => t.toLowerCase()));
  return plannedTitles.filter((t) => !seen.has(t.toLowerCase()));
}

export function hasCompletedCall(state: CompanyFirstSourcingState, key: string): CompletedProviderCall | null {
  return state.completed_calls.find((c) => c.idempotency_key === key) ?? null;
}

export function recordCompletedCall(state: CompanyFirstSourcingState, call: CompletedProviderCall): void {
  if (!hasCompletedCall(state, call.idempotency_key)) state.completed_calls.push(call);
}

// ------------------------------------------------------------ persistence ----

/** Minimal write surface so tests inject a fake instead of a live client. */
export interface SourcingStateStore {
  load(taskId: string): Promise<CompanyFirstSourcingState | null>;
  save(taskId: string, state: CompanyFirstSourcingState, taskStatus: string, resultPatch?: Record<string, unknown>): Promise<void>;
}

/**
 * Store backed by the EXISTING `tasks.result` jsonb column. No migration:
 * `result.company_first_state` is a new key inside a column that already exists.
 */
export function supabaseSourcingStateStore(db: {
  from: (t: string) => {
    select: (c: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown }> } };
    update: (v: Record<string, unknown>) => { eq: (c: string, v: unknown) => Promise<unknown> };
  };
}): SourcingStateStore {
  return {
    async load(taskId) {
      try {
        const { data } = await db.from("tasks").select("result").eq("id", taskId).maybeSingle();
        const result = (data as { result?: Record<string, unknown> } | null)?.result ?? null;
        const s = result?.[SOURCING_STATE_KEY] as CompanyFirstSourcingState | undefined;
        return s && s.version === SOURCING_STATE_VERSION ? s : null;
      } catch { return null; }
    },
    async save(taskId, state, taskStatus, resultPatch) {
      try {
        const { data } = await db.from("tasks").select("result").eq("id", taskId).maybeSingle();
        const prior = ((data as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>;
        await db.from("tasks").update({
          status: taskStatus,
          result: { ...prior, ...(resultPatch ?? {}), [SOURCING_STATE_KEY]: state },
        }).eq("id", taskId);
      } catch (e) {
        console.error("[company-first] checkpoint save failed:", (e as Error)?.message);
      }
    },
  };
}
