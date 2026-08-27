// A CHECKPOINT NOBODY EVER PICKS UP IS NOT A CHECKPOINT.
//
// ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
//
// Continuations are dispatched IN PROCESS: a slice writes its checkpoint and
// fires the next one before exiting. `leadContinuationDispatch` states the
// trade openly — "a slice which dies between writing its checkpoint and firing
// the next one stalls the chain… the existing claim/lease means a sweeper (or a
// user pressing Continue) can pick it up later". Every part of that was true
// except the sweeper, which did not exist.
//
// Run fafd9912: slice 2 enriched eleven companies, POSTed job search
// `ub2qunSMAKTNf5AKv`, and was killed mid-poll. The task sat `ready` with
// `auto_continuation.continuing: true` and a paid Apify run completing in the
// background. The only crons were `monitoring-tick` and `sweep-stuck-runs`, and
// the latter only rescues rows stuck at `running`. Nothing on this machine
// would ever have looked at that task again.
//
// ── WHAT THIS MODULE IS, AND IS NOT ────────────────────────────────────────
//
// It is the ELIGIBILITY DECISION and nothing else — pure, so every rule can be
// exercised without a database. It owns no executor: the resume is dispatched
// through `dispatchContinuation` into `run-agent`, the same endpoint the
// in-process handoff and the Continue button use, and `run-agent` claims the
// task through `claim_sourcing_continuation` exactly as it always has. There is
// one executor and one claim; this only decides who to nudge.
//
// ── WHY EACH GUARD IS HERE ─────────────────────────────────────────────────
//
// `too_fresh` is the one that prevents a race. The in-process handoff resolves
// in `HANDOFF_WINDOW_MS` (2s) and a slice runs ~125s, so a task touched in the
// last five minutes may still have a live successor. Waiting is free; racing
// costs a duplicate claim attempt on every tick.
//
// `abandoned` and `continuation_ceiling` bound the loop. A task that dies at
// the same point forever would otherwise be resumed every five minutes for
// ever. The ceilings are the EXISTING ones — `continuations_used` against
// `DEFAULT_MAX_CONTINUATIONS`, `cost_units_used` against the lineage budget —
// so this introduces no new counter and no new spend authority.
//
// `nothing_to_resume` is what stops the sweeper being a retry loop for runs
// that simply finished with less than they wanted. There must be either paid
// work to adopt or an explicit `continuing: true` decision that lost its
// handoff.
//
// Pure. No network, no database, no clock of its own.

import {
  DEFAULT_MAX_CONTINUATIONS, DEFAULT_MAX_LINEAGE_COST_UNITS, LINEAGE_PROGRESS_KEY,
} from "./leadAutoContinuation.ts";
import { RESUMABLE_ROW_STATUS } from "./taskStatusContract.ts";

export const STALLED_LEAD_RESUME_VERSION = "stalled-lead-resume-v1" as const;

/**
 * How long a task must be untouched before a sweep may consider it stalled.
 *
 * Longer than a slice (~125s) plus its handoff window, so a live chain is never
 * interrupted. Matches `tasks_sweep_stuck_runs`, deliberately: the two sweepers
 * compose — that one moves a killed `running` row to `ready`, this one resumes
 * a `ready` row — and giving them different notions of "dead" would let a task
 * be judged stalled by one and alive by the other.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * After this, a stalled task is abandoned rather than resumed.
 *
 * A checkpoint does not rot, but the user's attention does: nobody is watching
 * a Workbench for a request they made three hours ago, and silently spending
 * their credits on it is worse than leaving it. It also hard-bounds the resume
 * loop independently of any counter.
 */
export const MAX_RESUMABLE_AGE_MS = 2 * 60 * 60_000;

/** The exact terminal status a claimable checkpoint carries. */
export const CLAIMABLE_TERMINAL_STATUS = "continuation_required";

export type IneligibleReason =
  | "not_ready" | "already_terminal" | "no_checkpoint" | "claim_held"
  | "too_fresh" | "abandoned" | "continuation_ceiling" | "cost_ceiling"
  | "nothing_to_resume" | "no_mission";

export interface StalledTaskRow {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  plan_id: string | null;
  agent_slug: string | null;
  step_index: number | null;
  status: string | null;
  updated_at: string | null;
  created_at: string | null;
  continuation_claim_expires_at: string | null;
  result: Record<string, unknown> | null;
}

export interface Eligibility {
  eligible: boolean;
  reason: IneligibleReason | "resumable";
  /** Why it is resumable, for the log. */
  evidence?: "pending_provider_run" | "continuation_intended";
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/**
 * May this stalled task be resumed automatically?
 *
 * `hasStartedProviderRun` is supplied by the caller from
 * `lead_execution_calls` — a row still `started` with a `provider_run_id` is
 * paid work waiting to be adopted, and it is the strongest reason to resume.
 */
export function eligibleForAutoResume(
  row: StalledTaskRow,
  now: number,
  opts: {
    hasStartedProviderRun?: boolean;
    maxContinuations?: number;
    maxCostUnits?: number;
    staleAfterMs?: number;
    maxAgeMs?: number;
  } = {},
): Eligibility {
  const no = (reason: IneligibleReason): Eligibility => ({ eligible: false, reason });

  if (row.status !== RESUMABLE_ROW_STATUS) return no("not_ready");

  const result = obj(row.result);
  // THE CLAIM'S OWN VOCABULARY. `claim_sourcing_continuation` refuses anything
  // that is not this string, so a task carrying anything else cannot be
  // resumed no matter how much we would like to — nudging it would produce a
  // 409 on every tick for ever.
  if (result.terminal_status !== CLAIMABLE_TERMINAL_STATUS) return no("already_terminal");

  // The claim requires `company_first_state`; without it the RPC answers
  // `no_checkpoint` and refuses, so there is nothing to gain by asking.
  if (result.company_first_state === undefined || result.company_first_state === null) {
    return no("no_checkpoint");
  }
  // `run-agent` reads the mission from the REQUEST, not the checkpoint, and
  // refuses a continuation that arrives without one. A dispatch we cannot build
  // a mission for would be rejected 400 on every tick.
  if (!result.lead_mission) return no("no_mission");

  const held = ms(row.continuation_claim_expires_at);
  if (held !== null && held > now) return no("claim_held");

  const touched = ms(row.updated_at) ?? ms(row.created_at);
  if (touched !== null && now - touched < (opts.staleAfterMs ?? STALE_AFTER_MS)) {
    return no("too_fresh");
  }

  const born = ms(row.created_at);
  if (born !== null && now - born > (opts.maxAgeMs ?? MAX_RESUMABLE_AGE_MS)) {
    return no("abandoned");
  }

  const progress = obj(result[LINEAGE_PROGRESS_KEY]);
  if (int(progress.continuations_used) >= (opts.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS)) {
    return no("continuation_ceiling");
  }
  if (int(progress.cost_units_used) >= (opts.maxCostUnits ?? DEFAULT_MAX_LINEAGE_COST_UNITS)) {
    return no("cost_ceiling");
  }

  // ── IS THERE ANYTHING TO COME BACK FOR? ──────────────────────────────────
  const state = obj(result.capability_execution_state);
  const checkpointedPending = Array.isArray(state.pending_runs) && state.pending_runs.length > 0;
  if (checkpointedPending || opts.hasStartedProviderRun) {
    return { eligible: true, reason: "resumable", evidence: "pending_provider_run" };
  }
  if (obj(result.auto_continuation).continuing === true) {
    return { eligible: true, reason: "resumable", evidence: "continuation_intended" };
  }
  return no("nothing_to_resume");
}

/**
 * The continuation request for a stalled task, rebuilt from the row.
 *
 * Every field comes from what was persisted. `toolInput` is deliberately null:
 * `dispatchContinuation` omits the key entirely when it is, and `run-agent`
 * reads the mission from `body.lead_mission`, which is carried here — the
 * "BOTH CARRIERS" note on `DispatchRequest.leadMission` is about a caller that
 * has a tool input, and a sweeper does not.
 */
export function resumeRequestFor(row: StalledTaskRow): {
  resumeTaskId: string; workspaceId: string; userId: string; planId: string | null;
  agentSlug: string; stepIndex: number; instruction: string;
  toolInput: null; leadMission: Record<string, unknown> | null; continuationIndex: number;
} | null {
  const result = obj(row.result);
  const mission = obj(result.lead_mission);
  // ATTRIBUTED TO THE PERSON WHO ASKED. `run-agent` honours `user_id` only for
  // service-role callers, and without it the continuation's results would land
  // outside the requester's Workbench.
  if (!row.workspace_id || !row.user_id) return null;
  const instruction =
    (typeof mission.original_user_query === "string" && mission.original_user_query) ||
    (typeof result.original_user_query === "string" && result.original_user_query) || "";
  if (!instruction) return null;
  const progress = obj(result[LINEAGE_PROGRESS_KEY]);
  return {
    resumeTaskId: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    planId: row.plan_id ?? null,
    agentSlug: row.agent_slug ?? "pilot",
    stepIndex: row.step_index ?? 0,
    instruction,
    toolInput: null,
    leadMission: mission as Record<string, unknown>,
    continuationIndex: int(progress.continuations_used) + 1,
  };
}
