// A PAID RUN THE LEDGER REMEMBERS AND THE CHECKPOINT FORGOT.
//
// ── THE FAILURE ────────────────────────────────────────────────────────────
//
// Run fafd9912, 2026-08-26. Slice 2 enriched eleven companies, POSTed
// `harvestapi/linkedin-job-search` as run `ub2qunSMAKTNf5AKv` at 16:12:14, and
// was hard-killed mid-poll. The task row still held slice 1's state:
//
//     tasks.updated_at                       16:11:17   (slice 1)
//     lead_execution_calls  ub2qunSMAKTNf5AKv 16:12:14   status "started"
//     capability_execution_state.pending_runs []
//
// Apify ran the job to completion. Nothing would ever read it, and a resumed
// slice would have POSTed the same three companies again — a second charge for
// an answer already bought.
//
// ── WHY THE TWO RECORDS DISAGREED ──────────────────────────────────────────
//
// Persist-on-start writes the run id to `lead_execution_calls` the instant the
// run exists. `pending_runs` is written somewhere else and much later: only
// when the poll gives up GRACEFULLY and `readPendingRun` turns the timeout into
// a checkpoint entry. A hard kill runs no catch block, so the ledger knows and
// the checkpoint does not.
//
// Run 783fa163 survived precisely because its poll timed out cleanly. That is
// not a property a resume should depend on.
//
// ── THE RECOVERY ───────────────────────────────────────────────────────────
//
// The ledger already holds every field adoption needs. A row that is still
// `started` and names a `provider_run_id` is, by definition, a run we paid to
// start and never observed finish. Rebuilding `pending_runs` from those rows
// makes the checkpoint's omission irrelevant.
//
// THE FINGERPRINT IS RECOMPUTED, NOT STORED. `inputFingerprint` sorts keys and
// drops nulls, so a JSONB round trip cannot change it, and `redactProviderInput`
// is identity for the inputs this pipeline sends (URLs, titles, integers — no
// tokens, no string over 2000 chars, no array over 200 items). Verified against
// production: recomputing from `request_input.input` for run Zs5bYFGlnua1hJWYg
// yields `80666f95`, the exact fingerprint that run's checkpoint had persisted.
// `redactionIsIdentityFor` pins that property so a future redaction rule cannot
// silently break adoption and start double-charging.
//
// ADOPTION IS A `GET` on a run that already exists, so recovery can only ever
// REPLACE a POST — it can never add a charge. The worst case is re-reading a
// run that had in fact finished, which costs nothing.
//
// Pure. No network, no database, no clock.

import { inputFingerprint } from "./leadResumeState.ts";
import { redactProviderInput } from "./executionLedger.ts";

export const PENDING_RUN_RECOVERY_VERSION = "pending-run-recovery-v1" as const;

/** The `lead_execution_calls` columns recovery reads. */
export interface LedgerStartedRow {
  capability?: string | null;
  provider_id?: string | null;
  provider_run_id?: string | null;
  dataset_id?: string | null;
  status?: string | null;
  request_input?: Record<string, unknown> | null;
  started_at?: string | null;
  created_at?: string | null;
}

/**
 * A rebuilt `pending_runs` entry.
 *
 * `capability` is deliberately NULL. The ledger's own `capability` column holds
 * the ACTOR key — `apify_linkedin_job_search` — not the `CapabilityId` the
 * checkpoint records, and the mapping is genuinely ambiguous:
 * `apify_linkedin_company_search` serves both `general_company_discovery` and
 * `company_identity_resolution` in the same run. Guessing would be worse than
 * abstaining, so a recovered entry says it does not know, and adoption treats a
 * null capability as "any" — see `leadCapabilityEngine`. The
 * `input_fingerprint` is what actually identifies the question, and it is
 * strictly stronger than the capability: the same input to the same provider is
 * the same purchase whichever stage asked for it.
 */
export interface RecoveredPendingRun {
  capability: null;
  provider: string;
  run_id: string;
  dataset_id: string | null;
  actor_build_id: null;
  started_at: string;
  input_fingerprint: string;
  /** Marks the entry as rebuilt from the ledger rather than checkpointed. */
  recovered_from_ledger: true;
}

/**
 * Is `redactProviderInput` a no-op for this input?
 *
 * The whole recovery rests on it. Exported so the property is tested against
 * the real payloads rather than assumed.
 */
export function redactionIsIdentityFor(input: unknown): boolean {
  return JSON.stringify(redactProviderInput(input)) === JSON.stringify(input);
}

/**
 * Rebuild the pending runs a hard-killed slice never checkpointed.
 *
 * A row qualifies only when it is still `started` AND names a run — anything
 * else either finished (and has its answer recorded) or never reached the
 * provider (and cost nothing).
 */
export function recoverPendingRuns(
  rows: readonly LedgerStartedRow[],
): RecoveredPendingRun[] {
  const out: RecoveredPendingRun[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.status !== "started") continue;
    const runId = typeof r.provider_run_id === "string" ? r.provider_run_id.trim() : "";
    if (!runId || seen.has(runId)) continue;
    // The ACTOR key is what `pending_runs.provider` holds. `provider_id` is the
    // vendor ("apify"), which is not specific enough to match a call.
    const provider = typeof r.capability === "string" ? r.capability.trim() : "";
    if (!provider) continue;
    const actorInput = (r.request_input ?? {})["input"];
    // NO INPUT, NO ADOPTION. Without a fingerprint the entry could be matched
    // to the wrong call — a batch of one inheriting a batch of ten's run id,
    // which is the defect the fingerprint was added to prevent.
    if (actorInput === undefined || actorInput === null) continue;
    seen.add(runId);
    out.push({
      capability: null,
      provider,
      run_id: runId,
      dataset_id: typeof r.dataset_id === "string" && r.dataset_id ? r.dataset_id : null,
      actor_build_id: null,
      started_at: r.started_at ?? r.created_at ?? new Date(0).toISOString(),
      input_fingerprint: inputFingerprint(actorInput),
      // WHO THE RUN WAS ASKED ABOUT, straight out of the input it was started
      // with. Adoption matches the whole compiled input, so a later slice can
      // only adopt this run by asking about the same companies in the same
      // order — and it can only do that if it knows which they were. See
      // `pending_runs[].company_keys`.
      ...(Array.isArray((actorInput as { company?: unknown }).company)
        ? {
          company_keys: ((actorInput as { company: unknown[] }).company)
            .filter((c): c is string => typeof c === "string" && !!c),
        }
        : {}),
      recovered_from_ledger: true,
    });
  }
  return out;
}

/**
 * Merge recovered runs into whatever the checkpoint did manage to save.
 *
 * The CHECKPOINT WINS on a run id both records name: it carries the real
 * `capability`, so keeping it makes adoption strictly more precise. Recovery
 * only ever ADDS the entries that were lost.
 */
export function mergePendingRuns<T extends { run_id: string }>(
  checkpointed: readonly T[],
  recovered: readonly RecoveredPendingRun[],
): Array<T | RecoveredPendingRun> {
  const have = new Set(checkpointed.map((r) => r.run_id));
  return [...checkpointed, ...recovered.filter((r) => !have.has(r.run_id))];
}
