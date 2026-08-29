// RESUME WHERE IT STOPPED, NOT WHERE IT STARTED.
//
// Continuation 90bad481 hit `execution_deadline_reached` at 109,009 ms with
// seven companies at `verifying`. Everything expensive was already done for
// them — identity resolved, enrichment complete — and none of it was recorded
// per company. A resume could only replay the whole capability, buying the same
// searches and the same enrichment a second time.
//
// TWO THINGS FIX THAT.
//
//   * A RESERVE. The engine stops starting paid calls while it still has time to
//     write a checkpoint, instead of discovering the deadline by being killed.
//   * PER-COMPANY STAGE STATE. Each company records how far it individually got,
//     so a continuation resumes the unfinished stage for each one rather than
//     the unfinished capability for all of them.
//
// AND A STABLE OPERATION KEY, so a completed provider call is recognisable
// across invocations. Without it "already done" is a guess.
//
// PURE. No network, no provider, no database.

export const RESUME_STATE_VERSION = "lead-resume-state-v1" as const;

// ------------------------------------------------------------- the reserve ----

/**
 * Wall-clock kept back for writing state, on top of the engine's own budget.
 *
 * WHY 18 SECONDS. The checkpoint is a read-modify-write of `tasks.result` plus a
 * plan update — normally well under a second. The reserve is not sized for the
 * write; it is sized so that the LAST call the engine allows can still finish
 * inside the budget. Observed starts on TEST: memo23 24.3s, company search
 * ~9s, company details ~11s, job search ~6s. A reserve below the slowest
 * downstream call would let the engine authorise a call it cannot complete,
 * which is exactly how the previous run died holding work it never read.
 * 18s covers every downstream provider (max ~11s) with margin, and is small
 * enough not to waste a third of the budget.
 */
export const CHECKPOINT_RESERVE_MS = 18_000;

/**
 * The reserve the QUALIFICATION loop admits work against.
 *
 * WHY IT IS ITS OWN NUMBER. The 18s above is sized for the slowest downstream
 * PROVIDER call — "a reserve below the slowest downstream call would let the
 * engine authorise a call it cannot complete". That argument does not apply to
 * qualification: its model calls are already hard-bounded by the engine's
 * `clockBound`, which caps each one at `remaining − reserve`, so a
 * qualification call physically cannot run into the reserve. And a company the
 * clock stops mid-flight is NOT REACHED — no verdict, no rejection, still
 * resumable. Borrowing the provider reserve here bought safety that was
 * already guaranteed, and paid for it in leads.
 *
 * WHAT IT COST. TEST run b7a9e112 stopped qualification three times:
 *
 *     evaluated: 1, not_reached: 2, remaining_ms: 22206
 *     evaluated: 1, not_reached: 6, remaining_ms: 22984
 *     evaluated: 2, not_reached: 2, remaining_ms: 23658
 *
 * Admission needs `reserve + estimate` — 18,000 + 7,000 = 25,000 — so every one
 * fell one to three seconds short and left between two and six ALREADY ENRICHED
 * companies without a verdict. Run 9b5ad99b lost all four of its at 19,137ms.
 *
 * WHY 14 SECONDS. Measured, not chosen. The work that actually happens after
 * qualification stops — persistence, the quota pass, auto-continuation dispatch
 * and the terminal guard — across five slices on three builds:
 *
 *     5.96s   6.27s   7.80s   7.86s   9.38s
 *
 * 14s clears all three admissions above (needing 21,000 against 22.2–23.7s
 * available) and keeps 4.6s of margin over the worst tail ever observed. A
 * smaller reserve would admit no more companies than this one does — after one
 * ~7s evaluation the remaining clock is ~15s, below every candidate threshold —
 * so 14s is the LARGEST value that unblocks, which is the one to pick.
 */
export const QUALIFICATION_RESERVE_MS = 14_000;

export interface ReserveClock {
  elapsedMs(): number;
  remainingMs(): number;
}

/** Should the engine stop starting new paid work and checkpoint instead? */
export function shouldCheckpoint(
  clock: ReserveClock, reserveMs: number = CHECKPOINT_RESERVE_MS,
): boolean {
  return clock.remainingMs() <= reserveMs;
}

/**
 * IS THERE ROOM FOR THIS UNIT OF WORK, plus the reserve, plus a stop?
 *
 * `shouldCheckpoint` answers a WEAKER question: "is there still room to write a
 * checkpoint?" A loop that only asks that will admit an iteration with 100ms to
 * spare and then run it for a minute, because admitting work and bounding work
 * are different things. Task 1e67725f died exactly there — the qualification
 * loop's guard passed at 91s of a 125s budget, entered a company, and the
 * isolate was killed at 146s with no checkpoint written and the row left
 * `running` forever.
 *
 * So the question a loop must actually ask is "is there room for what I am
 * about to start, AND to stop cleanly afterwards?" — which needs an estimate of
 * the work, not just the reserve.
 *
 * `estimatedWorkMs` should come from `ExecutionDeadline.estimateFor(op)`, whose
 * floor is the conservative assumed duration and which only ever moves UP from
 * observed reality. A stage with no history is therefore admitted pessimistically,
 * which is the safe direction: the cost of guessing high is one company deferred
 * to a continuation, and the cost of guessing low is the whole run lost.
 *
 * THIS IS NECESSARY BUT NOT SUFFICIENT. An estimate bounds the TYPICAL
 * iteration; it cannot bound a pathological one. The work itself must also be
 * capped — see `withDeadlineBudget` — or a single call three times slower than
 * its estimate defeats the admission that let it in.
 */
export function shouldStartWork(
  clock: ReserveClock,
  estimatedWorkMs: number,
  reserveMs: number = CHECKPOINT_RESERVE_MS,
): boolean {
  return clock.remainingMs() > reserveMs + Math.max(0, estimatedWorkMs);
}

// ------------------------------------------------------ per-company stages ----

/**
 * How far identity resolution got for ONE company — five outcomes, not three.
 *
 * The three that existed collapsed distinct facts into one. A company the
 * deadline never reached recorded `not_started`, which is also what a company
 * nobody had scheduled yet recorded; a company whose provider call ERRORED
 * recorded `unresolved`, which is what a company with no LinkedIn presence
 * records. So "we ran out of time" and "this company does not exist on
 * LinkedIn" were the same value, and the second is terminal.
 *
 *   not_started     scheduled, not yet reached by this run
 *   resolved        an actionable identity was found
 *   unresolved      the provider answered, and nothing matched  — TERMINAL
 *   mismatch        the provider answered, and the match was rejected — TERMINAL
 *   deferred        selected and budgeted, but the deadline fired first
 *   provider_error  the call was made and failed — says nothing about the company
 *
 * `deferred` and `provider_error` are RESUMABLE. Neither is evidence about the
 * company, so neither may end its journey.
 */
export type IdentityStage =
  | "not_started" | "resolved" | "unresolved" | "mismatch"
  | "deferred" | "provider_error";

/** Identity outcomes that are a real, final answer ABOUT THE COMPANY. */
const IDENTITY_TERMINAL: ReadonlySet<IdentityStage> =
  new Set<IdentityStage>(["unresolved", "mismatch"]);

/**
 * Identity outcomes that mean "this company still owes an identity attempt".
 *
 * A resume MUST pick these up. Treating either as finished is how nine of
 * twenty candidates disappeared from a run that reported itself complete.
 */
export const IDENTITY_RESUMABLE: ReadonlySet<IdentityStage> =
  new Set<IdentityStage>(["not_started", "deferred", "provider_error"]);
/**
 * ENRICHMENT MAKES THE SAME DISTINCTION IDENTITY ALREADY DOES.
 *
 * `not_started` used to absorb four different outcomes: never reached, answered
 * with nothing, the call failed, and the call was never started. A resume
 * therefore could not tell a company that still owes a paid lookup from one
 * that has already been answered — so it re-bought the answered ones and left
 * the deferred ones looking finished.
 *
 *   empty           ANSWERED. The provider has no record of this company.
 *                   Asking again buys the same silence, so it is terminal.
 *   deferred        never started; the checkpoint reserve was reached first.
 *   provider_error  started and failed.
 */
export type EnrichmentStage =
  | "not_started" | "completed" | "failed" | "not_required"
  | "empty" | "deferred" | "provider_error";

/**
 * Enrichment outcomes that mean "this company still owes an enrichment attempt".
 *
 * `empty` is deliberately ABSENT: it is a real answer, and retrying it spends
 * money to be told the same thing.
 */
export const ENRICHMENT_RESUMABLE: ReadonlySet<EnrichmentStage> =
  new Set<EnrichmentStage>(["not_started", "deferred", "provider_error"]);
export type HiringStage =
  | "not_started" | "verified_from_existing_evidence" | "verified_externally"
  | "verification_needed" | "not_verified" | "failed";
export type BrainStage = "not_started" | "qualified" | "review" | "rejected" | "failed";
export type FounderStage =
  | "not_started" | "completed" | "unresolved" | "failed" | "not_eligible";

/**
 * ENOUGH OF A COMPANY TO REBUILD IT WITHOUT RE-DISCOVERING IT.
 *
 * THE WORKING SET IS BUILT ONLY BY DISCOVERY. A continuation whose state says
 * `startup_company_discovery` is already complete skips that step — correctly,
 * because re-running it means paying for the same Actor twice — and then has an
 * EMPTY working set. Every downstream stage iterates over that empty array, so
 * nothing resumes: not the deferred identity candidates, not the enrichment,
 * not the evaluation. The per-company resume ledger was unreachable across
 * invocations, which is the same as not existing.
 *
 * This snapshot is what makes the ledger real. It carries the normalized
 * company, its discovery-time jobs, its prequalification verdict and its
 * shortlist status — the four things `addCompany` and `applyPrequalification`
 * would otherwise have to buy again.
 *
 * OPTIONAL BY DESIGN. A checkpoint written before this existed has no snapshot;
 * such a record restores nothing and the run behaves exactly as it did before,
 * rather than failing to parse.
 *
 * Typed structurally so this module stays free of runtime imports — the shapes
 * are `NormalizedHiringCompany`, `NormalizedHiringJob[]` and
 * `PrequalifiedCompany`, and the engine owns the casts.
 */
export interface CompanyWorkingSetSnapshot {
  /** The normalized company, as discovery produced it. */
  company: Record<string, unknown>;
  /** Discovery-time open jobs. BOUNDED — see `MAX_SNAPSHOT_JOBS`. */
  yc_open_jobs: Record<string, unknown>[];
  /** The free prequalification verdict, so triage is not recomputed. */
  prequalified: Record<string, unknown> | null;
  prequal_key: string | null;
  /** Whether this company was worth paying to resolve. */
  shortlisted: boolean;
  /**
   * WHERE THIS COMPANY SITS IN THE INVESTIGATION FRONTIER.
   *
   * The field that makes a continuation able to widen the pool. Without it a
   * restored company was only `shortlisted: true/false`, and "false" could not
   * be told apart from "excluded by GPT" — so every continuation restored the
   * same frozen ten and the other ninety were reported pending forever.
   *
   * Optional: a checkpoint written before this existed has no state, and the
   * engine narrows an absent value to `pending_investigation`, which puts those
   * companies back on the frontier rather than stranding them.
   */
  investigation_state?: string | null;
  /** Position in the persisted triage ranking. */
  investigation_rank?: number | null;
  /** The triage verdict, so a continuation never re-pays for triage. */
  triage?: Record<string, unknown> | null;
  /** Enrichment already bought, so a resume never buys it twice. */
  enriched: Record<string, unknown> | null;
  /**
   * WHY there is no `enriched` row — `EnrichmentOutcome`, carried verbatim.
   *
   * Optional: checkpoints written before this field existed simply have no
   * outcome, and the engine narrows an absent or unrecognised value back to
   * `not_attempted` rather than failing to restore.
   */
  enrichment_outcome?: string | null;
  /**
   * WHAT IDENTITY RESOLUTION PRODUCED, not merely that it ran.
   *
   * `CompanyResumeRecord.identity` is a STAGE ("resolved"), and
   * `linkedin_company_url` is one field of the answer. Every paid stage after
   * identity selects on the OBJECT — `hiring_verification` filters
   * `c.identity && identityIsActionable(c.identity)` — so a company restored
   * without it is invisible to them.
   *
   * A resumed slice reported "no company had a relevant commercial role" with
   * `targets: 0`, holding a fully enriched company and a paid hiring run
   * waiting to be adopted, because identity resolution was skipped as complete
   * and nothing rebuilt what it had made.
   *
   * Optional: a checkpoint from before this field existed has none, and the
   * engine simply leaves `c.identity` null rather than failing to restore.
   */
  identity?: Record<string, unknown> | null;
  /**
   * WHAT HIRING VERIFICATION PRODUCED, not merely that it ran.
   *
   * The same distinction as `identity` directly above, one stage later, and it
   * failed the same way. `CompanyResumeRecord.hiring` is a STAGE
   * ("verified_externally"); the Company Brain's eligibility filter reads the
   * OBJECT, and a company whose `hiring_assessment` is null "carried no hiring
   * assessment" however emphatic the stage label is.
   *
   * Task 02ea3aed: four companies verified from 148 paid job rows, resumed, and
   * the Brain reported "the eligible set was empty (50 companies carried no
   * hiring assessment)". `hiring_verification` was already `completed`, so
   * nothing recomputed the verdicts — and nothing could, because
   * `completed_operations` correctly forbids re-buying the search. Evidence the
   * run had paid for, destroyed by the resume built to preserve it.
   *
   * Optional, for the same reason as every field above: an older checkpoint has
   * none and the engine leaves the assessment null rather than failing.
   */
  hiring_assessment?: Record<string, unknown> | null;
  /**
   * The job rows the verdict CITES. BOUNDED — see `MAX_SNAPSHOT_JOBS`.
   *
   * Carried with the assessment because a citation whose evidence is gone is
   * not a citation: `hiringJobsFor` picked these rows, the Workbench renders
   * them, and the evaluator quotes them.
   */
  hiring_jobs?: Record<string, unknown>[];
}

/**
 * Jobs kept per company in the checkpoint.
 *
 * The checkpoint is one jsonb column on `tasks`, and a hundred companies with
 * unbounded job arrays is how a resume record stops being writable. Twenty is
 * far above what prequalification actually reads and keeps a full working set
 * comfortably inside a single row.
 */
export const MAX_SNAPSHOT_JOBS = 20;

export interface CompanyResumeRecord {
  company_key: string;
  company_name: string;
  identity: IdentityStage;
  enrichment: EnrichmentStage;
  hiring: HiringStage;
  brain: BrainStage;
  founder: FounderStage;
  /** LinkedIn URL, once resolved — so a resume never re-searches for it. */
  linkedin_company_url: string | null;
  /** Completed provider operations, by stable key. */
  completed_operations: string[];
  /**
   * Enough of the company to rebuild the working set on a continuation.
   *
   * Absent on checkpoints written before this field existed, and absent is
   * handled: the run simply cannot reconstruct, exactly as before.
   */
  snapshot?: CompanyWorkingSetSnapshot | null;
  updated_at: string;
}

export function newCompanyRecord(
  company_key: string, company_name: string,
): CompanyResumeRecord {
  return {
    company_key, company_name,
    identity: "not_started", enrichment: "not_started", hiring: "not_started",
    brain: "not_started", founder: "not_started",
    linkedin_company_url: null, completed_operations: [],
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * The next stage this company still owes, or null when it is finished.
 *
 * Read in pipeline order and stops at the first unfinished stage, so a company
 * with identity + enrichment + hiring done resumes at the Brain and nowhere
 * earlier. A company whose identity is `unresolved` or `mismatch` is FINISHED —
 * retrying it is what the caps exist to prevent.
 */
export function nextStageFor(r: CompanyResumeRecord):
  "identity" | "enrichment" | "hiring" | "brain" | "founder" | null {
  // DEFERRED AND PROVIDER_ERROR RESUME HERE, exactly like `not_started`. The
  // work was never done; only a real answer from the provider ends it.
  if (IDENTITY_RESUMABLE.has(r.identity)) return "identity";
  if (IDENTITY_TERMINAL.has(r.identity)) return null;
  // DEFERRED AND PROVIDER_ERROR RESUME HERE, for the same reason they do for
  // identity: the work was never done. `empty` does NOT — it is an answer.
  if (ENRICHMENT_RESUMABLE.has(r.enrichment)) return "enrichment";
  if (r.enrichment === "failed") return null;
  if (r.hiring === "not_started") return "hiring";
  if (r.hiring === "verification_needed") return "hiring";
  if (r.hiring === "not_verified" || r.hiring === "failed") return null;
  if (r.brain === "not_started") return "brain";
  if (r.brain === "rejected" || r.brain === "review" || r.brain === "failed") return null;
  // Only an explicit Brain pass may reach people discovery.
  if (r.brain === "qualified" && r.founder === "not_started") return "founder";
  return null;
}

export function companyIsComplete(r: CompanyResumeRecord): boolean {
  return nextStageFor(r) === null;
}

// -------------------------------------------------- provider deduplication ----

/**
 * A stable identifier for one provider operation.
 *
 * Deliberately built from the things that make two calls the SAME QUESTION:
 * workspace, the continuation lineage root, the company, the capability and a
 * normalized input. It excludes the task id and any timestamp, because a
 * continuation is a different task asking the same question — and if the key
 * changed per task, every resume would re-buy everything.
 */
export function providerOperationKey(i: {
  workspace_id: string;
  lineage_root_task_id: string;
  company_key: string;
  capability: string;
  provider: string;
  input_fingerprint: string;
}): string {
  return [
    RESUME_STATE_VERSION, i.workspace_id, i.lineage_root_task_id,
    i.company_key, i.capability, i.provider, i.input_fingerprint,
  ].join("|");
}

/** A short, order-independent fingerprint of a compiled provider input. */
export function inputFingerprint(input: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined && x !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, norm(x)]));
    }
    return v;
  };
  const s = JSON.stringify(norm(input));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export type SkipReason = "already_completed" | "identity_terminal" | "not_eligible" | null;

/**
 * Should this provider call be skipped because the work already exists?
 *
 * Only a COMPLETED, usable result skips. An explicitly failed or invalid prior
 * result is not a reason to give up — it is a reason to try once more.
 */
export function shouldSkipProviderCall(
  record: CompanyResumeRecord | undefined, operationKey: string,
): { skip: boolean; reason: SkipReason } {
  if (!record) return { skip: false, reason: null };
  if (record.completed_operations.includes(operationKey)) {
    return { skip: true, reason: "already_completed" };
  }
  // ONLY A REAL ANSWER IS A REASON NOT TO ASK AGAIN. `deferred` and
  // `provider_error` are deliberately absent: the question was never answered,
  // so a resume must be allowed to ask it.
  if (IDENTITY_TERMINAL.has(record.identity)) {
    return { skip: true, reason: "identity_terminal" };
  }
  return { skip: false, reason: null };
}

// ---------------------------------------------------------- the checkpoint ----

export interface Checkpoint {
  version: typeof RESUME_STATE_VERSION;
  deadline_at: string;
  time_remaining_at_checkpoint_ms: number;
  last_completed_capability: string | null;
  next_pending_capability: string | null;
  pending_company_keys: string[];
  completed_company_keys: string[];
  continuation_required: boolean;
  checkpoint_reason: "execution_deadline_checkpoint" | "all_work_complete";
  companies: CompanyResumeRecord[];
}

/**
 * Build the checkpoint.
 *
 * `continuation_required` is TRUE whenever any company still owes a stage. That
 * is the flag the UI reads, and it is what stops a run with pending verification
 * being described as complete.
 */
export function buildCheckpoint(i: {
  now: number;
  deadlineAt: number;
  remainingMs: number;
  lastCompletedCapability: string | null;
  nextPendingCapability: string | null;
  companies: readonly CompanyResumeRecord[];
  reason: Checkpoint["checkpoint_reason"];
}): Checkpoint {
  const pending = i.companies.filter((c) => !companyIsComplete(c));
  const complete = i.companies.filter(companyIsComplete);
  return {
    version: RESUME_STATE_VERSION,
    deadline_at: new Date(i.deadlineAt).toISOString(),
    time_remaining_at_checkpoint_ms: Math.max(0, i.remainingMs),
    last_completed_capability: i.lastCompletedCapability,
    next_pending_capability: i.nextPendingCapability,
    pending_company_keys: pending.map((c) => c.company_key),
    completed_company_keys: complete.map((c) => c.company_key),
    // A CAPABILITY STILL OWED IS ALSO UNFINISHED WORK, even with no pending
    // company — that is how a run with a whole stage left could look complete.
    continuation_required: pending.length > 0 || i.nextPendingCapability !== null,
    checkpoint_reason: i.reason,
    companies: [...i.companies],
  };
}

/** May the UI say "Run complete"? Only when nothing is owed. */
export function runIsComplete(c: Checkpoint | null): boolean {
  return !!c && !c.continuation_required;
}

/** Should "Continue verification" be offered? */
export function continuationAvailable(c: Checkpoint | null): boolean {
  return !!c && c.continuation_required && c.pending_company_keys.length +
    (c.next_pending_capability ? 1 : 0) > 0;
}

// ------------------------------------------------------ reading it back in ----
//
// A checkpoint nobody reads is a receipt, not a resume. These are the readers
// that turn `tasks.result` back into the two things the guard needs: the prior
// per-company records, and the lineage root the operation key is built from.

/** The key `tasks.result` stores the checkpoint under. */
export const CHECKPOINT_RESULT_KEY = "lead_resume_checkpoint" as const;
/** The key `tasks.result` stores the lineage root task id under. */
export const LINEAGE_ROOT_RESULT_KEY = "lead_resume_lineage_root" as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

function asStage<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? v as T : fallback;
}

const asObjectOrNull = (v: unknown): Record<string, unknown> | null => asRecord(v);
const asStringOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/**
 * THE HALF OF RESUME THAT WAS WRITTEN AND NEVER READ.
 *
 * `toResumeRecord` has written a `snapshot` for every company since the durable
 * working set was introduced. This reader rebuilt each record field by field —
 * identity, enrichment, hiring, brain, founder, url, operations, timestamp —
 * and simply did not mention `snapshot`, so every one was dropped on load.
 *
 * The writer and the reader disagreed, and the reader wins. Measured on TEST
 * run 9105aa67's own persisted checkpoint:
 *
 *     companies in the persisted checkpoint : 100
 *     of those carrying a snapshot          : 100
 *     records returned by this function     : 100
 *     of those carrying a snapshot          :   0
 *
 * `restoreWorkingSet` therefore restored nothing on every continuation. The
 * frontier read empty, the yield gate answered `frontier_exhausted`, and runs
 * reported "every discovered candidate has been investigated" with 88 of 98
 * never touched — while the auto-continuation message promised the user it was
 * "looking for 8 more across 87 remaining companies". Three consecutive TEST
 * runs ended that way. The continuation machinery was complete except for this.
 *
 * VALIDATED, NOT CAST, like everything else here — a checkpoint is JSON another
 * deploy wrote. Only the SHAPE is checked; `restoreWorkingSet` owns the value
 * narrowing (investigation state, enrichment outcome, rank) and already treats
 * every field as untrusted. A snapshot with no `company` object cannot rebuild
 * anything, so it reads as absent rather than as an empty company — which keeps
 * the `snapshots_missing` count honest.
 */
function readWorkingSetSnapshot(raw: unknown): CompanyWorkingSetSnapshot | null {
  const s = asRecord(raw);
  const company = asRecord(s?.company);
  if (!s || !company) return null;
  return {
    company,
    // BOUNDED ON READ AS WELL AS ON WRITE. The cap is this module's promise
    // about how large a restored working set can get, and a checkpoint written
    // by a build with a different cap must not be able to break it.
    yc_open_jobs: (Array.isArray(s.yc_open_jobs) ? s.yc_open_jobs : [])
      .map(asRecord).filter((j): j is Record<string, unknown> => j !== null)
      .slice(0, MAX_SNAPSHOT_JOBS),
    prequalified: asObjectOrNull(s.prequalified),
    prequal_key: asStringOrNull(s.prequal_key),
    shortlisted: s.shortlisted === true,
    investigation_state: asStringOrNull(s.investigation_state),
    investigation_rank: typeof s.investigation_rank === "number" &&
        Number.isFinite(s.investigation_rank)
      ? s.investigation_rank
      : null,
    triage: asObjectOrNull(s.triage),
    enriched: asObjectOrNull(s.enriched),
    enrichment_outcome: asStringOrNull(s.enrichment_outcome),
    // Carried across the JSON boundary like everything else here. A field
    // written but not read back is a field that does not survive a resume.
    identity: asObjectOrNull(s.identity),
  };
}

/**
 * Per-company records from a persisted task result.
 *
 * VALIDATED, not cast. This crosses a trust boundary — the result column is
 * JSON that a previous deploy, or a hand edit, may have written in another
 * shape. A record whose `company_key` is missing is dropped rather than
 * defaulted, because a record under the wrong key would skip a paid call for a
 * company it does not describe. Everything else falls back to the "not started"
 * value, which can only ever cause work to be REDONE, never wrongly skipped.
 */
export function readCheckpointCompanies(taskResult: unknown): CompanyResumeRecord[] {
  const result = asRecord(taskResult);
  const checkpoint = asRecord(result?.[CHECKPOINT_RESULT_KEY]);
  if (!checkpoint || checkpoint.version !== RESUME_STATE_VERSION) return [];
  if (!Array.isArray(checkpoint.companies)) return [];
  const out: CompanyResumeRecord[] = [];
  for (const raw of checkpoint.companies) {
    const c = asRecord(raw);
    const key = c?.company_key;
    if (!c || typeof key !== "string" || !key) continue;
    const base = newCompanyRecord(
      key, typeof c.company_name === "string" ? c.company_name : key);
    out.push({
      ...base,
      identity: asStage(c.identity,
        ["not_started", "resolved", "unresolved", "mismatch"] as const, "not_started"),
      enrichment: asStage(c.enrichment,
        ["not_started", "completed", "failed", "not_required",
          "empty", "deferred", "provider_error"] as const, "not_started"),
      hiring: asStage(c.hiring,
        ["not_started", "verified_from_existing_evidence", "verified_externally",
          "verification_needed", "not_verified", "failed"] as const, "not_started"),
      brain: asStage(c.brain,
        ["not_started", "qualified", "review", "rejected", "failed"] as const, "not_started"),
      founder: asStage(c.founder,
        ["not_started", "completed", "unresolved", "failed", "not_eligible"] as const,
        "not_started"),
      linkedin_company_url: typeof c.linkedin_company_url === "string"
        ? c.linkedin_company_url : null,
      completed_operations: Array.isArray(c.completed_operations)
        ? c.completed_operations.filter((o): o is string => typeof o === "string" && !!o)
        : [],
      updated_at: typeof c.updated_at === "string" ? c.updated_at : base.updated_at,
      // WITHOUT THIS LINE THE LEDGER IS UNREACHABLE. See
      // `readWorkingSetSnapshot` — it was written on every checkpoint and read
      // on none, which is what made every continuation restore zero companies.
      snapshot: readWorkingSetSnapshot(c.snapshot),
    });
  }
  return out;
}

/**
 * The task id every invocation in one continuation chain shares.
 *
 * `providerOperationKey` is only stable if this is. Using the immediate parent
 * would make a THIRD invocation compute different keys from the second and
 * re-buy everything the second had already paid for — the exact failure the key
 * exists to prevent. So the root propagates: a run that has one keeps it, and
 * only a run without one becomes the root.
 */
export function lineageRootTaskId(
  parentTaskId: string, parentTaskResult: unknown,
): string {
  const stored = asRecord(parentTaskResult)?.[LINEAGE_ROOT_RESULT_KEY];
  return typeof stored === "string" && stored ? stored : parentTaskId;
}
