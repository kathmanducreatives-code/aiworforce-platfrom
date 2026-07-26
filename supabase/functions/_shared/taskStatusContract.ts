// TASK STATUS vs SOURCING OUTCOME.
//
// AUDIT (TEST project zbwsbnqqpkvdhqwavjke, read-only, 2026-07-26)
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
//   tasks.status          DATABASE EXECUTION STATE   — did the row finish running
//   result.task_status    SOURCING PROGRESS          — partial / completed / failed
//   result.terminal_status QUOTA OUTCOME             — why sourcing stopped
//
// Pure — no network, no writes.

/** Values the task ROW may hold. Intersection of every declared constraint. */
export const TASK_ROW_STATUSES = ["pending", "running", "complete", "failed", "skipped"] as const;
export type TaskRowStatus = typeof TASK_ROW_STATUSES[number];

/** Sourcing progress, stored in `result.task_status`. */
export const TASK_RESULT_STATUSES = ["partial", "completed", "failed"] as const;
export type TaskResultStatus = typeof TASK_RESULT_STATUSES[number];

/** Quota outcome, stored in `result.terminal_status`. */
export const TERMINAL_STATUSES = [
  "continuation_required", "completed", "quota_not_met", "search_exhausted",
  "budget_exhausted", "round_limit_reached", "provider_failure", "invalid_request",
] as const;
export type TerminalStatus = typeof TERMINAL_STATUSES[number];

/** Terminal outcomes after which no continuation may be offered. */
const NON_RESUMABLE: ReadonlySet<string> = new Set([
  "completed", "search_exhausted", "budget_exhausted",
  "round_limit_reached", "provider_failure", "invalid_request",
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
 * `continuation_required` is the interesting case: the ROW is `complete` (this
 * invocation finished cleanly and is no longer executing), while the RESULT says
 * `partial` and the terminal status says more sourcing is required. Leaving the
 * row at `running` would make a checkpointed task indistinguishable from one that
 * is still executing.
 */
export function projectStatus(terminal: string, invariantViolation?: string | null): StatusProjection {
  const t = (TERMINAL_STATUSES as readonly string[]).includes(terminal)
    ? (terminal as TerminalStatus)
    : "invalid_request";

  if (invariantViolation || t === "provider_failure" || t === "invalid_request") {
    return { rowStatus: "failed", taskStatus: "failed", terminalStatus: t };
  }
  if (t === "completed") {
    return { rowStatus: "complete", taskStatus: "completed", terminalStatus: t };
  }
  // Everything else delivered SOMETHING but not the whole quota.
  return { rowStatus: "complete", taskStatus: "partial", terminalStatus: t };
}

/** Is a further continuation allowed for this outcome? */
export function isContinuable(terminalStatus: string | null | undefined): boolean {
  return terminalStatus === "continuation_required";
}

export function isTerminalOutcome(terminalStatus: string | null | undefined): boolean {
  return !!terminalStatus && NON_RESUMABLE.has(terminalStatus);
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

  // LEGACY: the column itself held a sourcing outcome.
  const legacyOverloaded = rowStatus === "partial" || rowStatus === "completed";
  return {
    rowStatus,
    taskStatus: legacyOverloaded ? rowStatus : (cfStatus ? (cfStatus === "completed" ? "completed" : "partial") : null),
    terminalStatus: cfStatus,
    legacy: legacyOverloaded || !!cfStatus,
  };
}
