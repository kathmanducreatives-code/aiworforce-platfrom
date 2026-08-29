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
  MAX_BARREN_SLICES,
} from "./leadAutoContinuation.ts";
import { RESUMABLE_ROW_STATUS } from "./taskStatusContract.ts";
import { assessCheckpointResume } from "./workflowContinuation.ts";

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
 * After this much SILENCE, a stalled task is abandoned rather than resumed.
 *
 * A checkpoint does not rot, but the user's attention does: nobody is watching
 * a Workbench for a request that has not moved in three hours, and silently
 * spending their credits on it is worse than leaving it.
 *
 * ── MEASURED FROM THE LAST ACTIVITY, NOT FROM CREATION ────────────────────
 *
 * It was `created_at`, and that is wrong in both directions. A healthy lineage
 * that continues on the SAME row keeps its original `created_at` for ever, so a
 * long, productive run would be abandoned mid-flight at the two-hour mark. And
 * a dead one was judged by when it started rather than when it stopped.
 *
 * `updated_at` answers the question actually being asked: has anything happened
 * here recently. Task 43355471 is the case — created 08:42, untouched since,
 * and by 15:00 it had been silently ignored for six hours.
 *
 * ABANDONING IS NOW AN OUTCOME, NOT A SHRUG. It carries `disposition:
 * "terminate"`, so the sweeper writes a terminal status and tells the user,
 * instead of refusing the same row every three minutes until it ages out of the
 * scan and disappears.
 */
export const MAX_RESUMABLE_AGE_MS = 2 * 60 * 60_000;

/** The exact terminal status a claimable checkpoint carries. */
export const CLAIMABLE_TERMINAL_STATUS = "continuation_required";

export type IneligibleReason =
  | "not_ready" | "already_terminal" | "no_checkpoint" | "claim_held"
  | "too_fresh" | "abandoned" | "continuation_ceiling" | "cost_ceiling"
  | "nothing_to_resume" | "no_mission"
  /** Consecutive slices that qualified and investigated nobody. */
  | "no_progress";

/**
 * What the sweeper should DO about this row.
 *
 * ── WHY THREE ANSWERS AND NOT TWO ─────────────────────────────────────────
 *
 * The old shape was eligible / not-eligible, and "not eligible" meant "look
 * again in three minutes". Both live failures came out of that single bucket.
 *
 * Lineage 9da530ae reached `barren_slices: 9` and `continuations_used: 10` —
 * the in-process controller had already stopped it with `continuation_ceiling`
 * — and the sweeper re-dispatched it anyway, at 09:09, 09:18 and 09:27, each
 * time producing a slice that made zero provider calls and changed nothing.
 *
 * Task 43355471 was scanned every three minutes for two hours, refused
 * `nothing_to_resume` every time, and then aged out of the scan window and was
 * never looked at again — holding 50 restorable companies and $0.153 of paid
 * discovery.
 *
 * One of those needed to STOP and one needed to CONTINUE, and the shape could
 * express neither. `skip` is the only transient answer; the other two are
 * decisions.
 */
export type ResumeDisposition =
  /** Dispatch it. */
  | "resume"
  /** Not now, not ours, or not yet — ask again next tick. */
  | "skip"
  /** It will never proceed. Write a terminal status and tell the user. */
  | "terminate";

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
  /** Retained: exactly `disposition === "resume"`. */
  eligible: boolean;
  reason: IneligibleReason | "resumable";
  /** Why it is resumable, for the log. */
  evidence?: "pending_provider_run" | "continuation_intended" | "restorable_checkpoint";
  disposition: ResumeDisposition;
  /** A sentence for the terminal record. Set only when terminating. */
  detail?: string;
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
  // SKIP is the transient answer: not ours, not yet, or somebody else's turn.
  const no = (reason: IneligibleReason): Eligibility =>
    ({ eligible: false, reason, disposition: "skip" });
  // STOP is a decision. It ends the row rather than deferring it, and it owes
  // the user a sentence explaining why.
  const stop = (reason: IneligibleReason, detail: string): Eligibility =>
    ({ eligible: false, reason, disposition: "terminate", detail });
  const go = (evidence: NonNullable<Eligibility["evidence"]>): Eligibility =>
    ({ eligible: true, reason: "resumable", evidence, disposition: "resume" });

  if (row.status !== RESUMABLE_ROW_STATUS) return no("not_ready");

  const result = obj(row.result);
  // THE CLAIM'S OWN VOCABULARY. `claim_sourcing_continuation` refuses anything
  // that is not this string, so a task carrying anything else cannot be
  // resumed no matter how much we would like to — nudging it would produce a
  // 409 on every tick for ever.
  // ── "ALREADY TERMINAL" MEANS SOMETHING ELSE FINISHED IT ─────────────────
  //
  // A row whose terminal status is ABSENT has not been finished by anybody —
  // it is a run that stopped without ever writing an outcome. Calling that
  // `already_terminal` was a mislabel with a cost: eight rows, silent for
  // between 71 and 294 hours, were skipped under a reason that said they had
  // been dealt with. They had not; nothing had ever looked at them again.
  //
  // Absent falls through, and is judged below on silence, ceilings and whether
  // its checkpoint restores. `claim_sourcing_continuation` agrees: it refuses a
  // terminal status that is present and unclaimable, and accepts a null one.
  const terminalStatus = typeof result.terminal_status === "string"
    ? result.terminal_status : null;
  if (terminalStatus !== null && terminalStatus !== CLAIMABLE_TERMINAL_STATUS) {
    return no("already_terminal");
  }

  // The claim requires `company_first_state`; without it the RPC answers
  // `no_checkpoint` and refuses, so there is nothing to gain by asking.
  const held = ms(row.continuation_claim_expires_at);
  if (held !== null && held > now) return no("claim_held");

  const touched = ms(row.updated_at) ?? ms(row.created_at);
  if (touched !== null && now - touched < (opts.staleAfterMs ?? STALE_AFTER_MS)) {
    return no("too_fresh");
  }

  // ── SILENCE IS JUDGED BEFORE SHAPE ──────────────────────────────────────
  //
  // Deliberately ahead of the structural checks below. After hours of silence
  // it no longer matters WHY a row cannot be resumed — a missing checkpoint, a
  // missing mission, an unrecognisable state — it matters that nothing will
  // ever pick it up, and that saying so is better than refusing it every three
  // minutes for ever. Every one of the eight stranded rows failed a structural
  // check and was therefore skipped rather than ended.
  const lastActivity = touched ?? ms(row.created_at);
  const quietMs = lastActivity === null ? 0 : now - lastActivity;
  if (quietMs > (opts.maxAgeMs ?? MAX_RESUMABLE_AGE_MS)) {
    return stop("abandoned",
      `nothing has happened here for ${Math.round(quietMs / 60_000)} minutes; ` +
      `the saved state is kept but the run will not resume itself`);
  }

  if (result.company_first_state === undefined || result.company_first_state === null) {
    return no("no_checkpoint");
  }
  // `run-agent` reads the mission from the REQUEST, not the checkpoint, and
  // refuses a continuation that arrives without one. A dispatch we cannot build
  // a mission for would be rejected 400 on every tick.
  if (!result.lead_mission) return no("no_mission");

  const progress = obj(result[LINEAGE_PROGRESS_KEY]);
  const continuationsUsed = int(progress.continuations_used);
  const costUnitsUsed = int(progress.cost_units_used);
  const maxContinuations = opts.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const maxCostUnits = opts.maxCostUnits ?? DEFAULT_MAX_LINEAGE_COST_UNITS;

  // ── A CEILING IS REACHED ONCE, NOT EVERY THREE MINUTES ──────────────────
  //
  // These were `skip`, so a lineage that had spent its budget was re-examined
  // and re-refused for ever. Reaching a ceiling is final by definition — the
  // counters only go up.
  if (continuationsUsed >= maxContinuations) {
    return stop("continuation_ceiling",
      `${continuationsUsed} of ${maxContinuations} continuations were used`);
  }
  if (costUnitsUsed >= maxCostUnits) {
    return stop("cost_ceiling",
      `${costUnitsUsed} of ${maxCostUnits} cost units were used`);
  }

  // ── NOTHING TWICE RUNNING IS EVIDENCE ───────────────────────────────────
  //
  // The SAME rule `decideAutoContinuation` already stops on, read from the SAME
  // folded counter. The in-process controller honoured it and the sweeper did
  // not, which is how lineage 9da530ae was re-dispatched three times at
  // `barren_slices: 9` — each successor making zero provider calls and changing
  // nothing. A second opinion that ignores the first is not a safety net.
  const barren = int(progress.barren_slices);
  if (barren >= MAX_BARREN_SLICES) {
    return stop("no_progress",
      `${barren} consecutive slices qualified and investigated nobody`);
  }

  // ── IS THERE ANYTHING TO COME BACK FOR? ──────────────────────────────────
  const state = obj(result.capability_execution_state);
  const checkpointedPending = Array.isArray(state.pending_runs) && state.pending_runs.length > 0;
  if (checkpointedPending || opts.hasStartedProviderRun) return go("pending_provider_run");
  if (obj(result.auto_continuation).continuing === true) return go("continuation_intended");

  // ── A COHERENT CHECKPOINT IS ITSELF A REASON TO COME BACK ───────────────
  //
  // The two answers above ask "is a provider mid-sentence?" and "did the last
  // slice INTEND to continue?". Neither asks the obvious third question: is
  // there work left that we already paid to discover.
  //
  // `continue-workflow` learned this and this path did not. Its comment names
  // the very task the sweeper then went on refusing:
  //
  //   "A run that saved a coherent checkpoint carries its own answer…
  //    Requiring one refused task 43355471 — 50 companies with snapshots,
  //    10 shortlisted, `pending_runs: []`"
  //
  // Same function, so the two resume paths cannot drift again: a checkpoint
  // either restores or it does not, and both callers get the same verdict.
  const checkpoint = assessCheckpointResume(result);
  if (checkpoint.resumable) return go("restorable_checkpoint");

  // NOTHING LEFT, AND SAYING SO IS THE POINT. This was `skip`, which meant the
  // row was re-examined every three minutes until it aged out of the scan and
  // vanished — 43355471 was refused roughly forty times and then forgotten.
  return stop("nothing_to_resume",
    checkpoint.refusal === "nothing_left_to_do"
      ? "every step it was asked to do is accounted for"
      : `there is no work left to pick up (${checkpoint.refusal ?? "no checkpoint"})`);
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
