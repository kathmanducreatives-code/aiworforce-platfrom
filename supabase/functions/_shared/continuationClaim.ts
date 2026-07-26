// ATOMIC CONTINUATION CLAIM — server-side, no migration.
//
// Frontend double-click protection is not a concurrency control: two browser
// tabs, a retry after a timeout, or a click racing a background poll all reach
// run-agent independently. Without a server-side claim, two invocations resume
// the SAME checkpoint and both pay for the same round.
//
// The claim is a compare-and-swap on `tasks.status`, which Postgres executes
// under a row lock:
//
//     UPDATE tasks SET status='running', result=<state+claim>
//      WHERE id=$1 AND status=$observed
//   RETURNING id
//
// Two concurrent claimers both read `partial`; the first flips it to `running`
// and the second's `status=$observed` predicate matches zero rows. The loser is
// refused, not queued. Only status values the table already uses are written, so
// no schema change and no new enum value is required.
//
// KNOWN LIMITATION (documented, not hidden): when a previous claim DIED mid-run
// the row is left at `running`, and a stale reclaim compares `running` against
// `running`, which is not a distinguishing value. Two reclaimers arriving in the
// same instant after the stale window can therefore both win. Closing that needs
// a dedicated claim column (or an RPC with `FOR UPDATE`), i.e. a migration.
// Everything before the stale window — the case that actually happens — is fully
// atomic.

export const STALE_CLAIM_MS = 5 * 60_000;
export const CLAIM_KEY = "continuation_claim";

export interface ContinuationClaim {
  token: string;
  claimed_at: string;
  /** Round the claim intends to run. Diagnostic only. */
  round: number | null;
}

export type ClaimRefusal =
  | "already_claimed"
  | "lost_race"
  | "not_resumable";

export type ClaimDecision =
  | { ok: true; reason: "fresh_claim" | "stale_reclaim"; previousToken: string | null }
  | { ok: false; reason: ClaimRefusal; heldSince?: string };

/**
 * Should this invocation ATTEMPT the compare-and-swap?
 *
 * Pure, so the policy is testable without a database. A live claim is refused
 * outright; a stale one may be retried (see the limitation above).
 */
export function decideClaimAttempt(
  existingClaim: ContinuationClaim | null | undefined,
  nowMs: number,
  staleMs: number = STALE_CLAIM_MS,
): ClaimDecision {
  if (!existingClaim) return { ok: true, reason: "fresh_claim", previousToken: null };

  const claimedAt = Date.parse(existingClaim.claimed_at);
  const age = Number.isFinite(claimedAt) ? nowMs - claimedAt : Number.POSITIVE_INFINITY;

  if (age < staleMs) {
    // A continuation is genuinely in flight. Refusing is the whole point.
    return { ok: false, reason: "already_claimed", heldSince: existingClaim.claimed_at };
  }
  return { ok: true, reason: "stale_reclaim", previousToken: existingClaim.token };
}

export function newClaim(token: string, nowIso: string, round: number | null): ContinuationClaim {
  return { token, claimed_at: nowIso, round };
}

// ------------------------------------------------------------------ executor --

/** The narrow write surface, so tests inject a fake instead of a live client. */
export interface ClaimDb {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          select: (cols: string) => Promise<{ data: unknown[] | null; error?: unknown }>;
        };
      };
    };
  };
}

export interface ClaimAttempt {
  db: ClaimDb;
  taskId: string;
  /** The status read a moment ago. The CAS predicate — must not be re-read. */
  observedStatus: string;
  /** The full `result` object to write, already containing the new claim. */
  resultWithClaim: Record<string, unknown>;
}

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: "lost_race" };

/**
 * Perform the compare-and-swap. Returns `lost_race` when another invocation
 * changed the status first — the row is left exactly as that winner set it.
 */
export async function claimContinuation(attempt: ClaimAttempt): Promise<ClaimResult> {
  const { data } = await attempt.db
    .from("tasks")
    .update({ status: "running", result: attempt.resultWithClaim })
    .eq("id", attempt.taskId)
    // THE CAS PREDICATE. Zero matched rows means someone else already moved the
    // status, so this invocation must not run the checkpoint.
    .eq("status", attempt.observedStatus)
    .select("id");

  return Array.isArray(data) && data.length > 0 ? { claimed: true } : { claimed: false, reason: "lost_race" };
}

/** Clear the claim once the round finishes, so the task can be continued again. */
export function releaseClaim(result: Record<string, unknown>): Record<string, unknown> {
  const next = { ...result };
  delete next[CLAIM_KEY];
  return next;
}

export const CLAIM_REFUSAL_MESSAGE: Record<ClaimRefusal, string> = {
  already_claimed: "This run is already being continued. Wait for the round in flight to finish.",
  lost_race: "Another continuation started first. Refresh to see the latest round.",
  not_resumable: "That run has no checkpoint to continue from.",
};
