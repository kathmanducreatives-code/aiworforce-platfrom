// PHASE 6 — WHO IS DUE, AND WHAT MAY THEY SPEND.
//
// ── WHAT MAKES RECURRING SPEND DIFFERENT ────────────────────────────────────
//
// Every provider guard before this one answers "may THIS call happen": the
// credit reserve, the per-scan ceiling, the containment check. A schedule asks
// two questions none of them can:
//
//   HAVE WE ASKED RECENTLY?  A monitor that runs every tick re-buys the same
//   answer forever. The cadence is what stops that, and it is the only thing
//   that can — see the note on evidence reuse below.
//
//   HAS THIS WORKSPACE SPENT ENOUGH THIS PERIOD?  A per-call reserve stops one
//   call; it cannot stop a hundred small calls a day for a month. Recurring
//   spend needs a ceiling over TIME, and the ceiling must refuse rather than
//   overspend.
//
// ── WHY THE CADENCE CARRIES THIS, AND NOT THE EVIDENCE PRE-FLIGHT ───────────
//
// The plan expected Phase 3's pre-flight to prevent the re-spend: it reuses
// held evidence instead of buying the answer again. It does — for DATED
// evidence. Its rule is `occurred_at_basis === "source_reported"`, because an
// undated event cannot be shown to fall inside a recency window.
//
// Monitoring writes every event with `occurred_at: null`. So the pre-flight
// answers "is the ANSWER still fresh?" and can only answer it from evidence
// that knows when it happened, while a scheduler needs "did we ASK recently?" —
// a different question, answerable from the cadence and nothing else.
//
// Both are real and neither substitutes for the other. Conflating them would
// either re-buy on every tick or suppress a monitor that has never run.
//
// PURE. No network, provider, model or database access.

export const MONITORING_SCHEDULE_VERSION = "monitoring-schedule-v1" as const;

/** How long a claim is honoured before another scheduler may take the work. */
export const CLAIM_LEASE_MINUTES = 15;

/** The default cadence for a subject that states none. */
export const DEFAULT_CADENCE_MINUTES = 1440;

export interface SchedulableSubject {
  id: string;
  workspace_id: string;
  enabled: boolean;
  cadence_minutes?: number | null;
  /** When a pass last COMPLETED for this subject. */
  last_run_at?: string | null;
  /** When a scheduler last claimed it. A lease, not a completion. */
  claimed_at?: string | null;
}

export type NotDueReason =
  | "disabled"
  | "claimed_by_another_run"
  | "inside_cadence";

export interface DueDecision {
  subject_id: string;
  workspace_id: string;
  due: boolean;
  reason: string;
  not_due_reason: NotDueReason | null;
  /** Minutes until it next becomes due. Null when it is due now. */
  due_in_minutes: number | null;
}

const MIN = 60_000;

/**
 * Is this subject due, and if not, why not.
 *
 * ── A SUBJECT THAT HAS NEVER RUN IS DUE ─────────────────────────────────────
 *
 * `last_run_at` null means no pass has completed. Treating that as "0 minutes
 * ago" would make a newly-added subject wait a full cadence before its first
 * answer, which is the opposite of what someone who just added it wants.
 *
 * ── A CLAIM IS A LEASE, NOT A COMPLETION ────────────────────────────────────
 *
 * Two schedulers firing at once must produce ONE scan. The first to claim owns
 * the work; the second sees `claimed_at` and steps back. The lease expires so a
 * crashed run cannot freeze a subject forever — which is the failure a plain
 * "in progress" flag has.
 */
export function subjectDue(
  s: SchedulableSubject, now: number,
): DueDecision {
  const base = { subject_id: s.id, workspace_id: s.workspace_id };

  if (!s.enabled) {
    return {
      ...base, due: false, not_due_reason: "disabled",
      reason: "the subject is disabled", due_in_minutes: null,
    };
  }

  const claimed = s.claimed_at ? Date.parse(s.claimed_at) : NaN;
  if (Number.isFinite(claimed)) {
    const heldFor = (now - claimed) / MIN;
    if (heldFor < CLAIM_LEASE_MINUTES) {
      return {
        ...base, due: false, not_due_reason: "claimed_by_another_run",
        reason: `claimed ${heldFor.toFixed(1)} minute(s) ago; the lease runs for ` +
          `${CLAIM_LEASE_MINUTES}`,
        due_in_minutes: Math.ceil(CLAIM_LEASE_MINUTES - heldFor),
      };
    }
  }

  const cadence = Math.max(1, Math.trunc(s.cadence_minutes ?? DEFAULT_CADENCE_MINUTES));
  const last = s.last_run_at ? Date.parse(s.last_run_at) : NaN;
  if (!Number.isFinite(last)) {
    return {
      ...base, due: true, not_due_reason: null,
      reason: "no pass has completed for this subject yet", due_in_minutes: null,
    };
  }

  const sinceMinutes = (now - last) / MIN;
  if (sinceMinutes >= cadence) {
    return {
      ...base, due: true, not_due_reason: null,
      reason: `last ran ${sinceMinutes.toFixed(0)} minute(s) ago, cadence is ${cadence}`,
      due_in_minutes: null,
    };
  }
  return {
    ...base, due: false, not_due_reason: "inside_cadence",
    reason: `last ran ${sinceMinutes.toFixed(0)} minute(s) ago; the cadence is ` +
      `${cadence}, so nothing is bought`,
    due_in_minutes: Math.ceil(cadence - sinceMinutes),
  };
}

export interface DuePlan {
  /** Workspaces with at least one due subject, each scanned once. */
  workspaces: string[];
  decisions: DueDecision[];
  /** Every subject, by whether it is due. Reported so a tick is inspectable. */
  summary: { due: number; not_due: Record<NotDueReason, number> };
}

/**
 * Which workspaces should be scanned on this tick.
 *
 * ONE SCAN PER WORKSPACE, not per subject. A workspace's subjects compile into
 * ONE mission — that is what `compileMonitoringMission` does — so scanning per
 * subject would run the same mission repeatedly and buy the same identity
 * resolutions once per subject.
 */
export function planDueScans(
  subjects: readonly SchedulableSubject[], now: number,
): DuePlan {
  const decisions = subjects.map((s) => subjectDue(s, now));
  const workspaces = [
    ...new Set(decisions.filter((d) => d.due).map((d) => d.workspace_id)),
  ].sort();

  const not_due: Record<NotDueReason, number> = {
    disabled: 0, claimed_by_another_run: 0, inside_cadence: 0,
  };
  for (const d of decisions) {
    if (d.not_due_reason) not_due[d.not_due_reason]++;
  }
  return {
    workspaces,
    decisions,
    summary: { due: decisions.filter((d) => d.due).length, not_due },
  };
}

// ─────────────────────────────── the period ceiling ─────────────────────────

export interface PeriodBudget {
  /** Credits this workspace may spend on monitoring per period. */
  ceiling: number;
  /** What it has already spent inside the current period. */
  spent: number;
  period_days: number;
}

export interface BudgetDecision {
  allowed: boolean;
  remaining: number;
  reason: string;
}

export const DEFAULT_PERIOD_DAYS = 7;
/**
 * What a workspace may spend on UNATTENDED monitoring per period.
 *
 * Deliberately modest. A person clicking Scan has decided to spend; a schedule
 * spends while nobody is watching, and the cost of a ceiling that is too low is
 * a delayed signal, while the cost of one that is too high is a bill nobody
 * authorised. The asymmetry decides the number.
 */
export const DEFAULT_PERIOD_CEILING = 200;

/**
 * May this workspace start another monitoring pass?
 *
 * REFUSES RATHER THAN OVERSPENDS. A pass that would cross the ceiling does not
 * start — it is not truncated mid-way, because a half-bought pass has paid for
 * identity resolution and enrichment without reaching the qualification that
 * turns them into a signal.
 */
export function budgetAllows(b: PeriodBudget): BudgetDecision {
  const remaining = Math.max(0, b.ceiling - b.spent);
  if (b.ceiling <= 0) {
    return {
      allowed: false, remaining: 0,
      reason: "the workspace's monitoring ceiling is zero; scheduled scans are off",
    };
  }
  if (remaining <= 0) {
    return {
      allowed: false, remaining: 0,
      reason: `the ${b.period_days}-day monitoring ceiling of ${b.ceiling} credit(s) ` +
        `is already spent (${b.spent}); refusing rather than overspending`,
    };
  }
  return {
    allowed: true, remaining,
    reason: `${remaining} of ${b.ceiling} credit(s) left in the ${b.period_days}-day period`,
  };
}
