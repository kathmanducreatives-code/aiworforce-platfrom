// CONTINUATION CLAIM.
//
// WHAT IS ACTUALLY EXECUTED TODAY (PostgREST, no migration):
//
//     UPDATE public.tasks SET status='running', result=<merged jsonb>
//      WHERE id = :task_id AND status = :observed_status
//   RETURNING id;
//
// That statement IS atomic in Postgres: under READ COMMITTED a second writer
// blocks on the row lock and re-evaluates its WHERE against the updated tuple
// (EvalPlanQual), so it matches zero rows. What it is NOT is sufficient, and the
// earlier description of it as "under a row lock" overstated the guarantee. Two
// gaps remain, neither expressible through PostgREST:
//
//   1. LOST UPDATE ON `result`. This claim and the checkpoint saver both read the
//      jsonb, merge in JS, and write the whole document back. PostgREST cannot
//      express `result = result || $1`, so a checkpoint written between another
//      writer's read and write is discarded. The predicate protects the claim,
//      not the document.
//
//   2. STALE RECLAIM IS NOT EXCLUSIVE. When a claimant dies the predicate ends up
//      comparing a value against itself, so two stale reclaimers both match.
//
// Both are closed by `claim_sourcing_continuation`, the SECURITY-INVOKER RPC in
// migration 20260727090000, which takes `SELECT … FOR UPDATE` before deciding and
// merges server-side. THAT MIGRATION IS NOT APPLIED. Until it is, the RPC path is
// attempted first and the conditional update is the fallback, so deploying this
// code before the migration is safe and applying the migration needs no code
// change.

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
  | "not_resumable"
  | "task_not_found"
  | "workspace_mismatch"
  | "no_checkpoint"
  | "already_terminal";

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
  task_not_found: "That sourcing run could not be found.",
  workspace_mismatch: "That sourcing run belongs to a different workspace.",
  no_checkpoint: "That run has no saved checkpoint to continue from.",
  already_terminal: "That run has already finished.",
};

// --------------------------------------------------------------- RPC path ----

/** Minimal shape of the migration's RPC response. */
export interface RpcClaimRow {
  claimed: boolean;
  reason: string;
  task_id: string | null;
  checkpoint_version: number | null;
  held_by: string | null;
  held_until: string | null;
}

export interface RpcDb {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

export type RpcClaimOutcome =
  | { available: false }                                     // migration not applied
  | { available: true; claimed: true; checkpointVersion: number | null }
  | { available: true; claimed: false; reason: ClaimRefusal; heldUntil: string | null };

/** Postgres error codes meaning "this function does not exist here (yet)". */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202", "PGRST302"]);

/**
 * Try the durable claim. Returns `available: false` — never an error — when the
 * migration has not been applied, so the caller can fall back cleanly.
 */
export async function claimContinuationViaRpc(args: {
  db: RpcDb; taskId: string; workspaceId: string; claimId: string; leaseSeconds?: number;
}): Promise<RpcClaimOutcome> {
  let res: { data: unknown; error: unknown };
  try {
    res = await args.db.rpc("claim_sourcing_continuation", {
      p_task_id: args.taskId,
      p_workspace_id: args.workspaceId,
      p_claim_id: args.claimId,
      p_lease_seconds: Math.max(30, Math.floor((args.leaseSeconds ?? STALE_CLAIM_MS / 1000))),
    });
  } catch {
    return { available: false };
  }

  const err = res.error as { code?: string; message?: string } | null;
  if (err) {
    const code = String(err.code ?? "");
    if (MISSING_FUNCTION_CODES.has(code) || /does not exist|could not find the function/i.test(String(err.message ?? ""))) {
      return { available: false };
    }
    // A real error is NOT a claim. Failing closed keeps the checkpoint safe.
    return { available: true, claimed: false, reason: "lost_race", heldUntil: null };
  }

  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as RpcClaimRow | undefined;
  if (!row) return { available: false };
  if (row.claimed) return { available: true, claimed: true, checkpointVersion: row.checkpoint_version };

  const reason = (["already_claimed", "task_not_found", "workspace_mismatch", "no_checkpoint", "already_terminal"] as const)
    .find((r) => r === row.reason) ?? "lost_race";
  return { available: true, claimed: false, reason, heldUntil: row.held_until };
}
