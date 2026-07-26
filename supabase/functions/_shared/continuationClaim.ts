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
  | "already_terminal"
  | "not_resumable_state"
  | "not_permitted"
  | "claim_unavailable";

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
  not_resumable_state: "That run is not in a resumable state.",
  not_permitted: "You do not have permission to continue this run.",
  // Deliberately generic: the raw database error is logged, never rendered.
  claim_unavailable: "Continuation is temporarily unavailable. Try again shortly.",
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
  /** The migration is genuinely absent — and ONLY then may the caller fall back. */
  | { available: false; category: "missing_function" }
  | { available: true; claimed: true; checkpointVersion: number | null }
  | { available: true; claimed: false; reason: ClaimRefusal; heldUntil: string | null; category: ClaimErrorCategory | null; code: string | null };

/**
 * The ONLY conditions that mean "this RPC does not exist here yet".
 *
 *   42883   Postgres: undefined_function
 *   PGRST202 PostgREST: the function is not in the schema cache
 *
 * Everything else — a conflict, a permission denial, an RLS refusal, a timeout,
 * a malformed response, an unknown code — FAILS CLOSED. Falling back on those
 * would silently downgrade to the weaker claim exactly when the database was
 * telling us something was wrong, which is how a "safety" fallback becomes the
 * hole it was meant to cover.
 */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
const MISSING_FUNCTION_MESSAGE =
  /(function .*does not exist|could not find the function|schema cache)/i;

export type ClaimErrorCategory =
  | "missing_function" | "conflict" | "permission" | "validation"
  | "database" | "transport" | "unexpected_response" | "unknown";

/** Internal diagnostics only. Never rendered to a user. */
export interface ClaimDiagnostics {
  claim_path: "rpc" | "compatibility_fallback" | "none";
  claim_error_code: string | null;
  claim_error_category: ClaimErrorCategory | null;
}

/** Classify an RPC error WITHOUT leaking its text to the caller's response. */
export function classifyClaimError(err: { code?: string; message?: string } | null | undefined): ClaimErrorCategory {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  if (MISSING_FUNCTION_CODES.has(code) || MISSING_FUNCTION_MESSAGE.test(msg)) return "missing_function";
  // 42501 insufficient_privilege; PGRST301 JWT/RLS; 'permission denied' text.
  if (code === "42501" || code === "PGRST301" || /permission denied|row-level security|not authorized/i.test(msg)) return "permission";
  if (code === "23505" || /conflict|already claimed/i.test(msg)) return "conflict";
  if (code === "22P02" || code === "23514" || /invalid input|violates check/i.test(msg)) return "validation";
  if (code.startsWith("08") || code === "57014" || code === "53300" || /timeout|connection/i.test(msg)) return "database";
  if (code) return "database";
  return "unknown";
}

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
  } catch (e) {
    // A TRANSPORT failure is not evidence the function is missing. Fail closed.
    return {
      available: true, claimed: false, reason: "claim_unavailable", heldUntil: null,
      category: "transport", code: String((e as { code?: string })?.code ?? "") || null,
    };
  }

  const err = res.error as { code?: string; message?: string } | null;
  if (err) {
    const category = classifyClaimError(err);
    // The ONLY path to the weaker fallback.
    if (category === "missing_function") return { available: false, category };
    return {
      available: true, claimed: false,
      reason: category === "permission" ? "not_permitted" : "claim_unavailable",
      heldUntil: null, category, code: String(err.code ?? "") || null,
    };
  }

  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as RpcClaimRow | undefined;
  if (!row || typeof row.claimed !== "boolean") {
    // An UNEXPECTED response shape is not "unavailable" — the function may well
    // have run. Treating it as absent could double-claim the checkpoint.
    return {
      available: true, claimed: false, reason: "claim_unavailable", heldUntil: null,
      category: "unexpected_response", code: null,
    };
  }
  if (row.claimed) return { available: true, claimed: true, checkpointVersion: row.checkpoint_version };

  const reason = (["already_claimed", "task_not_found", "workspace_mismatch", "no_checkpoint", "already_terminal", "not_resumable_state"] as const)
    .find((r) => r === row.reason) ?? "lost_race";
  return { available: true, claimed: false, reason, heldUntil: row.held_until, category: "conflict", code: null };
}

// ------------------------------------------------------------------ release ----
//
// WHY THIS EXISTS.
//
// The RPC claim writes its lease into COLUMNS (`continuation_claim_id`,
// `continuation_claim_expires_at`), not into `result`. `releaseClaim()` above only
// strips the `result.continuation_claim` KEY, which is all the compatibility path
// ever wrote — so on the RPC path it clears nothing the RPC actually set.
//
// Without this call the lease stays live for its full duration after a round ends,
// and the NEXT legitimate `Continue sourcing` is refused `already_claimed` until it
// expires. The failure appears only once the migration is applied, which is why no
// offline test caught it.
//
// Releasing is best-effort BY DESIGN: the round's outcome is already committed by
// the caller before this runs. A failure here costs one lease interval of delay,
// never a lost result, so it is logged and never thrown.

export type RpcReleaseOutcome =
  | { available: false; released: false; category: "missing_function"; code: string | null }
  | { available: true; released: boolean; category: ClaimErrorCategory | null; code: string | null };

export async function releaseContinuationViaRpc(args: {
  db: RpcDb; taskId: string; workspaceId: string; claimId: string; rowStatus: string;
}): Promise<RpcReleaseOutcome> {
  let res: { data: unknown; error: unknown };
  try {
    res = await args.db.rpc("release_sourcing_continuation", {
      p_task_id: args.taskId,
      p_workspace_id: args.workspaceId,
      p_claim_id: args.claimId,
      p_row_status: args.rowStatus,
    });
  } catch (e) {
    return { available: true, released: false, category: "transport", code: String((e as { code?: string })?.code ?? "") || null };
  }

  const err = res.error as { code?: string; message?: string } | null;
  if (err) {
    const category = classifyClaimError(err);
    if (category === "missing_function") {
      return { available: false, released: false, category, code: String(err.code ?? "") || null };
    }
    return { available: true, released: false, category, code: String(err.code ?? "") || null };
  }

  // The function returns a bare boolean: false means the claim id did not match,
  // i.e. this invocation was superseded and must NOT clear the winner's lease.
  return { available: true, released: res.data === true, category: null, code: null };
}
