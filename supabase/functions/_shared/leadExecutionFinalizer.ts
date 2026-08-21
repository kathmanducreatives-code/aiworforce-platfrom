// A RUN ALWAYS ENDS SOMEWHERE.
//
// TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec sat in `running` with
// `updated_at == created_at` — the row was created and never touched again —
// because the edge function was killed mid-Actor-call and nothing wrote a
// terminal status. The plan showed Running indefinitely, and the only way to
// learn what had happened was to read the tool-call ledger by hand.
//
// The fix is not "handle that error". It is that no code path may end a run
// without recording how it ended, including the path where the process simply
// stops existing.
//
// TWO MECHANISMS, because one is not enough:
//
//   * A DEADLINE the engine checks before starting anything new, so the run
//     stops itself while it still has time to write state.
//   * A FINALIZER that runs in `finally`, so an exception or an early return
//     still produces a terminal record.
//
// The finalizer NEVER overwrites a successful completion. A late throw during
// cleanup must not turn a finished run into a failure.
//
// PURE. No network, provider or database access — the caller supplies the
// writer, which is what lets this be tested without a database.

export const FINALIZER_VERSION = "lead-execution-finalizer-v1" as const;

/** How a run ended. Ordered from best to worst outcome. */
export type TerminalStatus = "completed" | "partial" | "pending_external_run" | "failed";

export type TerminalReason =
  | "capability_plan_complete"
  | "execution_deadline_reached"
  | "partial_capability_progress"
  | "provider_run_pending"
  | "provider_failure"
  | "provider_input_validation_failed"
  | "no_qualified_companies"
  | "unhandled_exception";

/** Statuses that mean the run genuinely finished its work. Never overwritten. */
const SUCCESSFUL: ReadonlySet<TerminalStatus> = new Set<TerminalStatus>(["completed"]);

export interface TerminalRecord {
  version: typeof FINALIZER_VERSION;
  status: TerminalStatus;
  reason: TerminalReason;
  detail: string | null;
  last_completed_capability: string | null;
  pending_capabilities: string[];
  failed_capabilities: string[];
  provider_attempts: number;
  pending_runs: Array<{ run_id: string; dataset_id: string | null; provider: string }>;
  accumulated_cost_units: number;
  elapsed_ms: number;
  /** True when a resume can pick this up without re-paying. */
  resumable: boolean;
}

// -------------------------------------------------------------- deadline ----

/**
 * The wall-clock budget for one invocation.
 *
 * Supabase edge functions are killed around 150s. The engine must stop starting
 * new Actor calls well before that, because a memo23 start alone took 24s and a
 * company-details start 7-11s. `SAFETY_MARGIN_MS` is what remains for writing
 * state after the last call returns — the thing task c8a6e53d never got to do.
 */
export const EDGE_WALL_CLOCK_MS = 150_000;
export const SAFETY_MARGIN_MS = 25_000;
export const DEFAULT_BUDGET_MS = EDGE_WALL_CLOCK_MS - SAFETY_MARGIN_MS;

/**
 * WHICH OPERATION IS BEING SCHEDULED.
 *
 * A free-form key — in practice the provider name, because that is the unit
 * whose latency actually varies. Callers that do not know or care pass nothing
 * and get the global estimate, which is the behaviour that existed before.
 */
export type DeadlineOperation = string;

// ── WHAT EACH STAGE IS ASSUMED TO COST ──────────────────────────────────────

export const QUALIFICATION_OP = "company_qualification";

/**
 * The deadline operation key for a company the batch stage ALREADY GROUNDED.
 *
 * ── WHY THIS IS A SEPARATE PRICE ────────────────────────────────────────────
 *
 * `QUALIFICATION_OP` prices a company that needs both model calls: the
 * per-company grounder AND the Mission evaluator. A company whose verification
 * came back from the Stage-2 batch needs only the second — the engine reads its
 * result out of `groundedByKey` and never calls the grounder at all.
 *
 * Charging it for a call that will not happen is not a rounding error, it is
 * the difference between finishing and discarding. On run df00b2cd the batch
 * stage spent 13 seconds grounding three companies, and one millisecond later
 * the admission gate refused to start the loop — 23.9s remaining against a
 * 12s + 18s requirement priced for work already done. The funnel recorded
 * `company_brain: 4 -> 0 UNACCOUNTED=4`: three paid-for verifications thrown
 * away to protect a reserve they were never going to spend.
 *
 * MONEY ALREADY SPENT IS THE CHEAPEST WORK IN THE RUN. Finishing it should be
 * the LAST thing a deadline gives up, not the first.
 */
export const QUALIFICATION_PREGROUNDED_OP = "company_qualification_pregrounded";

/**
 * The deadline operation key for one Stage-2 batch evaluation.
 *
 * Kept separate from `QUALIFICATION_OP` because a batch judges many companies
 * in one call and a per-company estimate would badly under-price it — and this
 * table's whole purpose is that one stage's latency never speaks for another's.
 */
export const BATCH_EVALUATION_OP = "stage2_batch_evaluation";

/**
 * Per-operation floors, for stages whose real cost is known to differ from the
 * global assumption.
 *
 * `assumedCallMs` is one conservative number covering every provider call, and
 * conservative is right when nothing is known. But a stage the engine KNOWS is
 * cheaper — a company the batch already grounded needs one model call, not two —
 * is not served by pessimism: it gets refused admission for work it will never
 * do, and the money already spent on it is discarded. A floor below the global
 * one is only ever declared here, never inferred.
 */
const ASSUMED_MS_BY_OP: Readonly<Record<string, number>> = Object.freeze({
  // One evaluator call. Observed evaluator latency is ~5s; 7s leaves headroom
  // and is still less than half the two-call assumption.
  [QUALIFICATION_PREGROUNDED_OP]: 7_000,
});

/**
 * Ceilings on what ONE observation may do to an operation's estimate.
 *
 * ── AN ESTIMATE BOUNDS THE TYPICAL COMPANY; A CEILING BOUNDS THE PATHOLOGICAL ONE
 *
 * That is `qualificationClockReserve.test.ts`'s own summary of why the
 * admission gate and `withDeadlineBudget` both exist. `observeCall` was quietly
 * breaking it: it keeps a MONOTONIC MAXIMUM per operation, so the slowest
 * company in an invocation becomes the price of every company after it for the
 * rest of that invocation. That is the ceiling's job being done by the
 * estimate, and done permanently.
 *
 * TEST run 958c86bc, 2026-08-21. The `company_qualification_pregrounded`
 * estimate — floor 7,000ms — climbed across the run:
 *
 *     7,000  →  8,626  →  14,860  →  62,347
 *
 * At 62,347ms admission needs 14,000 + 62,347 = 76 seconds, more than a slice
 * ever has, so the stage was unreachable for the remainder of the invocation on
 * the evidence of one company.
 *
 * ── AND WHY ONLY THESE OPERATIONS ───────────────────────────────────────────
 *
 * The safety argument is NOT "an under-estimate is probably fine". It holds for
 * these two operations and for no others.
 *
 * A qualification call is a MODEL call, and it is bounded twice: the admission
 * gate here, and `withDeadlineBudget`, which cuts the company off at
 * `remaining - reserve`. A company cut off is NOT REACHED — no verdict, no
 * rejection, still on the frontier. So the failure modes are asymmetric.
 * Over-estimating means nothing runs at all and paid work already done is
 * discarded; under-estimating means one company is interrupted and resumes.
 *
 * A PROVIDER call has no such second gate. Starting an Actor the run cannot
 * wait for spends real money on a result nobody reads — task 1e67725f exactly.
 * So `apify_linkedin_company_search` and every other provider operation keeps
 * the uncapped monotonic maximum, and a genuinely slow provider still prices
 * itself out. Declared here one operation at a time, never inferred, for the
 * same reason the floors above are.
 *
 * WHY THESE NUMBERS. Three times the floor. Every non-pathological estimate
 * observed on run 958c86bc sits under 3x — 7,000 (1.0x), 8,626 (1.2x), 14,860
 * (2.1x), and 18,293 against the 12,000 default (1.5x). The 62,347 outlier is
 * 8.9x. Three separates them with room, and still leaves the estimate
 * conservative: 21s for a stage whose evaluator is observed at ~5s.
 */
export const MAX_LEARNED_ESTIMATE_MULTIPLE = 3;

/** The operations a learned estimate may not run away with. Model calls only. */
export const CAPPED_ESTIMATE_OPS: readonly string[] = [
  QUALIFICATION_OP, QUALIFICATION_PREGROUNDED_OP,
];


export interface ExecutionDeadline {
  startedAt: number;
  budgetMs: number;
  /** Longest a single provider call has been observed to take, across ALL operations. */
  slowestCallMs: number;
  elapsedMs(): number;
  remainingMs(): number;
  /**
   * True once there is no longer room for another provider call plus writing state.
   *
   * Pass `op` to ask about a SPECIFIC operation. Without it the answer is the
   * conservative global one.
   */
  expired(op?: DeadlineOperation): boolean;
  /** Record how long a call actually took, so the estimate tracks reality. */
  observeCall(ms: number, op?: DeadlineOperation): void;
  /** The duration currently assumed for `op` — the number `expired` compares against. */
  estimateFor(op?: DeadlineOperation): number;
}

export function createExecutionDeadline(
  opts: { budgetMs?: number; now?: () => number; assumedCallMs?: number } = {},
): ExecutionDeadline {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const assumed = opts.assumedCallMs ?? 12_000;
  let slowest = assumed;

  // ── PER-OPERATION LATENCY, BECAUSE ONE NUMBER WAS A LIE ────────────────────
  //
  // `slowest` is a monotonic maximum across every provider. On a real TEST run
  // a memo23 discovery start took 51s, which permanently raised the estimate
  // for the ~9s LinkedIn identity searches that followed. The identity stage
  // then stopped with 31s of a 125s budget unspent and nine shortlisted
  // candidates never attempted — stranded by a number that described a
  // different provider entirely.
  //
  // Each operation now carries its own observed maximum. An operation with no
  // history assumes `assumedCallMs` — the conservative default the deadline was
  // constructed with — rather than inheriting an unrelated stage's worst case.
  //
  // THE FLOOR IS THE POINT. A per-op estimate is never allowed BELOW `assumed`,
  // so one unusually fast call cannot talk the deadline into authorising work it
  // cannot finish. The estimate may only ever move up from the safe baseline.
  const byOp = new Map<DeadlineOperation, number>();
  const estimateFor = (op?: DeadlineOperation): number => {
    if (!op) return slowest;
    // The floor is `assumed` unless this operation declares a cheaper one it is
    // KNOWN to beat. Observation still only ever moves the estimate UP —
    // and now only so far. See `MAX_LEARNED_ESTIMATE_MULTIPLE`: one
    // pathological company was pricing every company after it out of the run.
    const floor = ASSUMED_MS_BY_OP[op] ?? assumed;
    const learned = Math.max(floor, byOp.get(op) ?? 0);
    // A PROVIDER operation keeps the uncapped maximum: there is no second gate
    // behind it, so a slow Actor must be allowed to price itself out.
    return CAPPED_ESTIMATE_OPS.includes(op)
      ? Math.min(learned, floor * MAX_LEARNED_ESTIMATE_MULTIPLE)
      : learned;
  };

  return {
    startedAt,
    budgetMs,
    get slowestCallMs() { return slowest; },
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
    estimateFor,
    // EXPIRED MEANS "no room for another call", not "out of time". Starting a
    // call that cannot finish is how the previous run died holding a paid run
    // it never read.
    expired: (op?: DeadlineOperation) =>
      (budgetMs - (now() - startedAt)) <= estimateFor(op),
    observeCall: (ms: number, op?: DeadlineOperation) => {
      // BOTH, always. The global figure still backs every unscoped caller —
      // the terminal guard and the finalizer among them — so scoping the
      // estimate never weakens the run-level answer.
      if (ms > slowest) slowest = ms;
      if (op && ms > (byOp.get(op) ?? 0)) byOp.set(op, ms);
    },
  } as ExecutionDeadline;
}

// ------------------------------------------------------- bounded model work ----

/**
 * The deadline operation key for one company's qualification.
 *
 * Qualification is not a provider call, so it never appeared in the per-op
 * latency table and always fell back to the global `assumedCallMs`. Naming it
 * lets the deadline learn what a company actually costs on THIS workspace's
 * data, the same way it learned that memo23 starts take 24s.
 */

/**
 * Raised when a unit of work was still running at the moment the caller had to
 * stop in order to checkpoint. NOT an error about the work — the work may well
 * have been about to succeed. It is a statement about the clock.
 *
 * Callers MUST treat the subject of a budget-exceeded call as NOT REACHED:
 * no verdict, no rejection, still on the frontier. Recording anything else
 * turns "we ran out of time" into evidence about a company, which is the one
 * inference this architecture forbids.
 */
export class DeadlineBudgetExceeded extends Error {
  readonly label: string;
  readonly budgetMs: number;
  constructor(label: string, budgetMs: number) {
    super(`${label} did not return within its ${budgetMs}ms clock budget`);
    this.name = "DeadlineBudgetExceeded";
    this.label = label;
    this.budgetMs = budgetMs;
  }
}

/**
 * RUN `work`, BUT NEVER PAST THE POINT WHERE STOPPING IS STILL POSSIBLE.
 *
 * Admission control (`shouldStartWork`) bounds the typical iteration; this
 * bounds the pathological one. On run 1e67725f a qualification call that
 * normally takes ~7s was still running 55 seconds later, and because nothing
 * capped it the isolate was killed mid-call: no checkpoint, no continuation,
 * a task row stuck at `running` and a spinning card in the UI.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────
 *
 * It returns CONTROL to the caller on time. It does not cancel the underlying
 * request — `groundCompany` and `evaluateMission` are plain promises with no
 * abort plumbing, so the fetch keeps running in the background until the
 * isolate ends. That is deliberate and it is fine: the whole point is that the
 * caller gets its few seconds to write a checkpoint and return a continuation,
 * and the isolate is being torn down immediately afterwards either way. What
 * we buy is a clean stop, not a saved token.
 *
 * The timer is cleared on the happy path, so a completed call leaves no pending
 * handle to keep the isolate alive.
 */
export async function withDeadlineBudget<T>(
  work: () => Promise<T>, budgetMs: number, label: string,
): Promise<T> {
  // A non-positive budget means the caller should not have started at all.
  // Failing before doing the work is strictly better than doing work nobody
  // will be alive to read.
  if (budgetMs <= 0) throw new DeadlineBudgetExceeded(label, budgetMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DeadlineBudgetExceeded(label, budgetMs)), budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ------------------------------------------------------------- finalizer ----

export interface FinalizerState {
  completed_capabilities?: readonly string[];
  pending_capabilities?: readonly string[];
  failed_capabilities?: readonly string[];
  provider_attempts?: readonly unknown[];
  pending_runs?: readonly { run_id: string; dataset_id: string | null; provider: string }[];
  accumulated_cost_units?: number;
  terminal_reason?: string | null;
  qualified_company_keys?: readonly string[];
}

/**
 * Decide the terminal record from whatever state exists.
 *
 * Deliberately total: every combination of inputs yields a status. There is no
 * "unknown" outcome, because an unknown outcome is what leaves a plan Running.
 */
export function decideTerminalRecord(
  state: FinalizerState | null | undefined,
  ctx: { elapsedMs: number; deadlineReached?: boolean; error?: unknown },
): TerminalRecord {
  const s = state ?? {};
  const pending = [...(s.pending_capabilities ?? [])];
  const failed = [...(s.failed_capabilities ?? [])];
  const completed = [...(s.completed_capabilities ?? [])];
  const pendingRuns = [...(s.pending_runs ?? [])];
  const attempts = (s.provider_attempts ?? []).length;
  const cost = s.accumulated_cost_units ?? 0;

  const base = {
    version: FINALIZER_VERSION,
    last_completed_capability: completed.length ? completed[completed.length - 1] : null,
    pending_capabilities: pending,
    failed_capabilities: failed,
    provider_attempts: attempts,
    pending_runs: pendingRuns,
    accumulated_cost_units: cost,
    elapsed_ms: ctx.elapsedMs,
  };

  // An UNCAUGHT ERROR is a failure even if progress was made. Reporting it as
  // partial would hide the exception.
  if (ctx.error !== undefined && ctx.error !== null) {
    return { ...base, status: "failed", reason: "unhandled_exception",
      detail: String(ctx.error).slice(0, 500), resumable: completed.length > 0 };
  }

  // A PAID RUN STILL IN FLIGHT outranks every other outcome: it must be
  // adopted, not restarted.
  if (pendingRuns.length > 0) {
    return { ...base, status: "pending_external_run", reason: "provider_run_pending",
      detail: pendingRuns.map((r) => `${r.provider}:${r.run_id}`).join(", "), resumable: true };
  }

  if (ctx.deadlineReached) {
    return { ...base, status: "partial", reason: "execution_deadline_reached",
      detail: `stopped after ${ctx.elapsedMs}ms with ${pending.length} capability(ies) pending`,
      resumable: true };
  }

  if (s.terminal_reason === "provider_input_validation_failed") {
    return { ...base, status: "failed", reason: "provider_input_validation_failed",
      detail: "a compiled provider input failed validation; no usable result", resumable: false };
  }
  if (s.terminal_reason === "provider_failure") {
    return { ...base, status: "failed", reason: "provider_failure", detail: null, resumable: true };
  }

  if (pending.length > 0) {
    return { ...base, status: "partial", reason: "partial_capability_progress",
      detail: `${completed.length} complete, ${pending.length} pending`, resumable: true };
  }

  // Everything ran. Whether it FOUND anything is a separate, honest answer.
  if ((s.qualified_company_keys ?? []).length === 0) {
    return { ...base, status: "completed", reason: "no_qualified_companies",
      detail: "the capability plan completed and no company passed the Company Brain",
      resumable: false };
  }
  return { ...base, status: "completed", reason: "capability_plan_complete",
    detail: null, resumable: false };
}

export interface FinalizeWriter {
  /** Persist the terminal record for the task AND mark the plan terminal. */
  (record: TerminalRecord): Promise<void> | void;
}

/**
 * Run `body`, and guarantee a terminal record is written afterwards.
 *
 * The writer runs in `finally`, so a throw, an early return and a normal
 * completion all produce one. `alreadyFinal` lets the body report that it wrote
 * a successful terminal state itself — the finalizer then leaves it alone,
 * because a cleanup-time hiccup must never demote a finished run.
 */
export async function withGuaranteedTerminalState<T>(
  body: (deadline: ExecutionDeadline) => Promise<T>,
  opts: {
    write: FinalizeWriter;
    readState: () => FinalizerState | null | undefined;
    deadline?: ExecutionDeadline;
    onWriteError?: (e: unknown) => void;
  },
): Promise<T | undefined> {
  const deadline = opts.deadline ?? createExecutionDeadline();
  let caught: unknown = undefined;
  let result: T | undefined;
  try {
    result = await body(deadline);
    return result;
  } catch (e) {
    caught = e;
    return undefined;
  } finally {
    try {
      const state = opts.readState();
      const record = decideTerminalRecord(state, {
        elapsedMs: deadline.elapsedMs(),
        deadlineReached: deadline.expired(),
        error: caught,
      });
      // NEVER DEMOTE A SUCCESS. `decideTerminalRecord` already returns
      // `completed` when the body finished cleanly, and only reclassifies when
      // there is a real reason to — an error, a deadline, pending work. The
      // assertion below states that invariant rather than re-deciding it.
      if (caught === undefined && SUCCESSFUL.has(record.status)) {
        record.detail = record.detail ?? "completed cleanly; finalizer did not reclassify";
      }
      await opts.write(record);
    } catch (writeErr) {
      opts.onWriteError?.(writeErr);
    }
  }
}
