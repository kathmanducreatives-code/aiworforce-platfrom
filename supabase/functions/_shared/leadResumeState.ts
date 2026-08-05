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

// ------------------------------------------------------ per-company stages ----

export type IdentityStage = "not_started" | "resolved" | "unresolved" | "mismatch";
export type EnrichmentStage = "not_started" | "completed" | "failed" | "not_required";
export type HiringStage =
  | "not_started" | "verified_from_existing_evidence" | "verified_externally"
  | "verification_needed" | "not_verified" | "failed";
export type BrainStage = "not_started" | "qualified" | "review" | "rejected" | "failed";
export type FounderStage =
  | "not_started" | "completed" | "unresolved" | "failed" | "not_eligible";

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
  if (r.identity === "not_started") return "identity";
  if (r.identity === "unresolved" || r.identity === "mismatch") return null;
  if (r.enrichment === "not_started") return "enrichment";
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
  if (record.identity === "unresolved" || record.identity === "mismatch") {
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
