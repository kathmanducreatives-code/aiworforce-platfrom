// WHAT THE POOL ALREADY KNOWS, AND HOW A CONTINUATION GETS IT BACK.
//
// A batch of eight companies is one model call. Losing it to a deadline and
// re-buying it on the next invocation is the same waste the provider-level
// resume ledger exists to stop, one layer up — and worse, because a re-run
// model call can return a DIFFERENT verdict for the same evidence, so a
// continuation that re-evaluates does not merely cost more, it can silently
// change what qualified.
//
// SO A COMPLETED EVALUATION IS RESTORED, NOT SKIPPED. Skipping would leave the
// company with no grounded result at all, which under enforce means REVIEW —
// turning a paid, successful evaluation into an unresolved row.
//
// THE FINGERPRINT IS THE SAFETY CATCH. Restored verdicts belong to the pool
// they were computed for. If discovery found different companies this time, the
// ranking is stale and the comparison has to be redone; the fingerprint is what
// makes that detectable rather than assumed.
//
// TRUST: this is read from `tasks.result` through verified lineage ONLY. The
// same reasoning as the provider resume ledger — a client-supplied grounded
// result would let a caller mark a company evaluated without one ever having
// been, and mark it QUALIFIED while doing so.
//
// PURE. No network, provider, model or database access.

import type { GroundedVerification } from "./groundedClaims.ts";

export const POOL_CHECKPOINT_VERSION = "pool-evaluation-checkpoint-v1" as const;
export const POOL_EVAL_RESULT_KEY = "pool_evaluation_checkpoint" as const;

export interface PoolCheckpoint {
  version: typeof POOL_CHECKPOINT_VERSION;
  /** Binds these results to the pool they were computed for. */
  pool_fingerprint: string;
  completed_company_keys: string[];
  /** The verified results themselves — restored, never merely skipped. */
  grounded_results: Array<{ company_key: string; verification: GroundedVerification }>;
  next_batch_offset: number;
  model_accounting: Record<string, unknown>;
  checkpointed_at: string;
}

/**
 * A fingerprint of the candidate pool.
 *
 * Order-independent: the same companies discovered in a different sequence are
 * the same pool, and forcing a re-evaluation over provider ordering would be a
 * pure waste. A company added or removed changes it, which is exactly when the
 * ranking must be redone.
 */
export function poolFingerprintOf(companyKeys: readonly string[]): string {
  const s = [...new Set(companyKeys)].sort().join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `pool:${[...new Set(companyKeys)].length}:${h.toString(16)}`;
}

export function buildPoolCheckpoint(i: {
  missionHash: string;
  evaluated: Array<{ company_key: string; verification: GroundedVerification }>;
  next_offset: number;
  accounting: object;
}): PoolCheckpoint {
  return {
    version: POOL_CHECKPOINT_VERSION,
    pool_fingerprint: i.missionHash,
    completed_company_keys: i.evaluated.map((e) => e.company_key),
    grounded_results: i.evaluated,
    next_batch_offset: i.next_offset,
    model_accounting: { ...i.accounting } as Record<string, unknown>,
    checkpointed_at: new Date().toISOString(),
  };
}

/**
 * Restore grounded results from a persisted task result.
 *
 * Returns EMPTY on any doubt — wrong version, wrong fingerprint, malformed
 * payload. The failure direction is deliberate: an empty restore costs model
 * calls, and a wrong restore attaches one pool's verdicts to another's
 * companies. Only one of those is recoverable.
 */
export function readPoolCheckpoint(
  taskResult: unknown, expectedFingerprint: string,
): { results: Map<string, GroundedVerification>; stale: boolean } {
  const empty = (stale: boolean) => ({ results: new Map(), stale });
  if (!taskResult || typeof taskResult !== "object") return empty(false);
  const cp = (taskResult as Record<string, unknown>)[POOL_EVAL_RESULT_KEY];
  if (!cp || typeof cp !== "object") return empty(false);
  const c = cp as Record<string, unknown>;
  if (c.version !== POOL_CHECKPOINT_VERSION) return empty(false);
  if (typeof c.pool_fingerprint !== "string") return empty(false);
  if (c.pool_fingerprint !== expectedFingerprint) {
    // THE POOL CHANGED. Every stored verdict still belongs to a real company,
    // but the comparison between them no longer describes this run.
    return empty(true);
  }
  if (!Array.isArray(c.grounded_results)) return empty(false);

  const results = new Map<string, GroundedVerification>();
  for (const row of c.grounded_results) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const key = typeof r.company_key === "string" ? r.company_key : "";
    const v = r.verification;
    // A RESTORED RESULT MUST LOOK LIKE A VERIFICATION. Anything else is
    // dropped and re-evaluated rather than trusted into a decision.
    if (!key || !v || typeof v !== "object") continue;
    const ver = v as Record<string, unknown>;
    if (!Array.isArray(ver.validated_claims)) continue;
    if (typeof ver.final_grounded_decision !== "string") continue;
    if (!["pass", "review", "fail"].includes(ver.final_grounded_decision)) continue;
    results.set(key, v as GroundedVerification);
  }
  return { results, stale: false };
}
