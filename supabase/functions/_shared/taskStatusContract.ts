// TASK STATUS vs SOURCING OUTCOME.
//
// AUDIT (TEST project ohsdatpvfdjdemstoiuj, read-only, 2026-07-26)
//
//   migration 20260519104244  status text CHECK IN
//                             ('pending','ready','running','awaiting_approval','complete','failed')
//   migration 20260425110000  status text CHECK IN
//                             ('pending','running','complete','failed','skipped')
//   generated types           status: string          (no union — the generator
//                                                      saw no constraint)
//   ACTUAL TEST schema        status text NULL DEFAULT 'running',
//                             ZERO check constraints, ZERO triggers
//   values present in TEST    complete(312) awaiting_approval(26) done(11)
//                             failed(11) running(8) completed(2)
//                             — `partial` appears ZERO times
//
// So the database does not currently enforce a vocabulary, but the repository
// declares two different ones and the live data contains a third dialect
// ("done", "completed"). Writing sourcing OUTCOMES into that column makes the
// column mean two things at once and would break the moment the declared
// constraint is ever applied.
//
// The separation below is therefore about correctness of meaning, not about
// working around a constraint:
//
//   tasks.status          DATABASE LIFECYCLE  — pending / running / ready /
//                                               awaiting_approval / complete /
//                                               failed / skipped
//   result.task_status    WORKFLOW PROGRESS   — partial / completed / failed
//   result.terminal_status SOURCING OUTCOME   — why sourcing stopped
//
// Pure — no network, no writes.

/**
 * Values the task ROW may hold — the DATABASE LIFECYCLE, nothing else.
 *
 *   pending  → not yet started
 *   running  → currently executing
 *   ready    → checkpointed and available for continuation
 *   awaiting_approval → blocked on a user decision
 *   complete → a genuine TERMINAL sourcing outcome was reached
 *   failed   → execution failed
 *   skipped  → preserved for backward compatibility
 *
 * `ready` is the important one: a checkpointed run is NOT complete. Writing
 * `complete` for a continuation made a task that still owes the user four leads
 * indistinguishable from one that finished, and made "is this resumable?"
 * unanswerable from the row alone.
 */
export const TASK_ROW_STATUSES = [
  "pending", "running", "ready", "awaiting_approval", "complete", "failed", "skipped",
] as const;
export type TaskRowStatus = typeof TASK_ROW_STATUSES[number];

/** The row state a continuation claim normally moves FROM. */
export const RESUMABLE_ROW_STATUS: TaskRowStatus = "ready";

/**
 * Row states a checkpointed task may legitimately be found in.
 *
 * `ready` is what every new checkpoint writes. The rest are LEGACY: rows written
 * before this change used the column for workflow progress, so a real checkpoint
 * can still be sitting behind `partial`, `running` or `complete`. They are read,
 * never rewritten.
 */
export const LEGACY_RESUMABLE_ROW_STATUSES: readonly string[] = ["partial", "running", "complete"];

export function isResumableRowStatus(status: string | null | undefined): boolean {
  return status === RESUMABLE_ROW_STATUS || LEGACY_RESUMABLE_ROW_STATUSES.includes(String(status ?? ""));
}

/** Sourcing progress, stored in `result.task_status`. */
export const TASK_RESULT_STATUSES = ["partial", "completed", "failed"] as const;
export type TaskResultStatus = typeof TASK_RESULT_STATUSES[number];

/** Quota outcome, stored in `result.terminal_status`. */
export const TERMINAL_STATUSES = [
  "continuation_required", "completed", "quota_not_met", "search_exhausted",
  "budget_exhausted", "round_limit_reached", "provider_failure", "invalid_request",
  /**
   * The provider round succeeded but its outcome could not be folded into source
   * state. Distinct from `provider_failure` on purpose: the paid call WORKED, and
   * reporting a provider fault would send an operator to the wrong system.
   */
  "source_transition_failed",
] as const;
export type TerminalStatus = typeof TERMINAL_STATUSES[number];

/** Terminal outcomes after which no continuation may be offered. */
const NON_RESUMABLE: ReadonlySet<string> = new Set([
  "completed", "search_exhausted", "budget_exhausted",
  "round_limit_reached", "provider_failure", "invalid_request",
  // No AUTOMATIC continuation: the control plane could not establish what happens
  // next, so offering to carry on would be guessing. The checkpoint is intact, so
  // a deliberate re-run still resumes from the recorded state.
  "source_transition_failed",
]);

export interface StatusProjection {
  /** What goes in the `tasks.status` COLUMN. */
  rowStatus: TaskRowStatus;
  /** What goes in `result.task_status`. */
  taskStatus: TaskResultStatus;
  /** What goes in `result.terminal_status`. */
  terminalStatus: TerminalStatus;
}

/**
 * Project one sourcing outcome onto the three fields.
 *
 * `continuation_required` is the interesting case: the ROW becomes `ready` — the
 * invocation is no longer executing, but the workflow is not finished either.
 * Leaving it `running` makes a checkpoint look like a live run; marking it
 * `complete` makes it look finished. Neither is true, and `ready` is.
 */
/**
 * The delivered-versus-requested outcome, when the caller knows it.
 *
 * CONTACT-ready people only. Jobs, companies, hiring signals, WATCH and
 * NEEDS_REVIEW candidates are not leads and never count here.
 */
export interface QuotaOutcome {
  contactReady: number;
  requested: number;
}

/** Was the thing the user actually asked for delivered? */
export function quotaMet(q: QuotaOutcome | null | undefined): boolean {
  if (!q || !Number.isFinite(q.requested) || q.requested <= 0) return false;
  return q.contactReady >= q.requested;
}

export function projectStatus(
  terminal: string,
  invariantViolation?: string | null,
  quota?: QuotaOutcome | null,
): StatusProjection {
  const t = (TERMINAL_STATUSES as readonly string[]).includes(terminal)
    ? (terminal as TerminalStatus)
    : "invalid_request";

  if (invariantViolation || t === "provider_failure" || t === "invalid_request"
    || t === "source_transition_failed") {
    return { rowStatus: "failed", taskStatus: "failed", terminalStatus: t };
  }

  // CHECKPOINT, NOT COMPLETION. The invocation finished cleanly but the workflow
  // owes the user more rounds, so the row advertises itself as resumable.
  if (t === "continuation_required") {
    return { rowStatus: "ready", taskStatus: "partial", terminalStatus: t };
  }

  // A TERMINAL WORKFLOW IS NOT A SATISFIED ONE.
  //
  // This used to return `completed` for every remaining outcome, on the reading
  // that `task_status: completed` means "no further rounds" rather than "quota
  // met". Nothing downstream reads it that way: `tasks.status: complete` plus
  // `task_status: completed` renders as a finished, successful run.
  //
  // Production plan 43fb7313-138e-4496-83de-92c3e0b7392f ended `search_exhausted`
  // having delivered 0 of 5 CONTACT-ready leads, and the UI reported "Complete".
  // Search exhaustion is a reason to STOP, not evidence of delivery.
  //
  // The lifecycle really is over — the row stays `complete`, and no continuation
  // is offered for a non-resumable outcome — but the WORKFLOW is partial, and
  // that is what the user is shown. When the caller cannot supply a quota the
  // previous behaviour is preserved exactly.
  if (quota && !quotaMet(quota)) {
    return { rowStatus: "complete", taskStatus: "partial", terminalStatus: t };
  }

  return { rowStatus: "complete", taskStatus: "completed", terminalStatus: t };
}

/** Projection for a run blocked on user approval. No terminal outcome yet. */
export function projectApprovalPending(): { rowStatus: TaskRowStatus; taskStatus: TaskResultStatus } {
  return { rowStatus: "awaiting_approval", taskStatus: "partial" };
}

/** Is a further continuation allowed for this outcome? */
export function isContinuable(terminalStatus: string | null | undefined): boolean {
  return terminalStatus === "continuation_required";
}

export function isTerminalOutcome(terminalStatus: string | null | undefined): boolean {
  return !!terminalStatus && NON_RESUMABLE.has(terminalStatus);
}

/** `ready` is a checkpoint; `complete` and `failed` are ends of the lifecycle. */
export function isTerminalRowStatus(rowStatus: string | null | undefined): boolean {
  return rowStatus === "complete" || rowStatus === "failed" || rowStatus === "skipped";
}

// ------------------------------------------------------ backward compatibility --

export interface LegacyStatusRow {
  status?: string | null;
  result?: Record<string, unknown> | null;
}

export interface ReadStatuses {
  rowStatus: string | null;
  taskStatus: string | null;
  terminalStatus: string | null;
  /** True when the values had to be recovered from the legacy overloaded column. */
  legacy: boolean;
}

/**
 * Read the three statuses from a row that may predate the separation.
 *
 * Rows written before this change put `partial`/`completed` directly in the
 * COLUMN. Those rows are read, not rewritten — migrating persisted records
 * silently is exactly what a compatibility adapter exists to avoid.
 */
export function readStatuses(row: LegacyStatusRow | null | undefined): ReadStatuses {
  const result = (row?.result ?? {}) as Record<string, unknown>;
  const rowStatus = row?.status ?? null;
  const explicitTask = typeof result.task_status === "string" ? result.task_status : null;
  const explicitTerminal = typeof result.terminal_status === "string" ? result.terminal_status : null;

  // The company-first block carried the outcome before the split existed.
  const cf = (result.company_first ?? {}) as Record<string, unknown>;
  const cfStatus = typeof cf.status === "string" ? cf.status : null;

  if (explicitTask || explicitTerminal) {
    return { rowStatus, taskStatus: explicitTask, terminalStatus: explicitTerminal ?? cfStatus, legacy: false };
  }

  // LEGACY: the column itself held workflow progress. `done` is an older dialect
  // still present in TEST data (11 rows as of the 2026-07-26 audit).
  const legacyOverloaded = rowStatus === "partial" || rowStatus === "completed" || rowStatus === "done";
  const legacyTaskStatus = rowStatus === "partial" ? "partial"
    : (rowStatus === "completed" || rowStatus === "done") ? "completed"
    : null;
  return {
    rowStatus,
    taskStatus: legacyTaskStatus ?? (cfStatus ? (cfStatus === "completed" ? "completed" : "partial") : null),
    terminalStatus: cfStatus,
    legacy: legacyOverloaded || !!cfStatus,
  };
}
