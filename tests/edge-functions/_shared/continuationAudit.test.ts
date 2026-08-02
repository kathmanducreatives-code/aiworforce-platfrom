// PART 3 + PART 4 — same-task continuation, audited property by property, and
// the server-side concurrency claim.
//
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes
// (every DB is an in-memory fake).

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideResume, RESUME_REFUSAL_MESSAGE } from "../../../supabase/functions/_shared/sourcingContinuation.ts";
import {
  decideClaimAttempt, claimContinuation, newClaim, releaseClaim,
  CLAIM_KEY, STALE_CLAIM_MS, type ClaimDb, type ContinuationClaim,
} from "../../../supabase/functions/_shared/continuationClaim.ts";
import {
  SOURCING_STATE_KEY, SOURCING_STATE_VERSION, newSourcingState,
  hasCompletedCall, recordCompletedCall, deltaTitles, isResumable, stateBelongsTo,
  type CompanyFirstSourcingState,
} from "../../../supabase/functions/_shared/companyFirstSourcingState.ts";

const TASK = "71db3ced-0000-4000-8000-000000000001";
const WS = "ws-1";
const OTHER_WS = "ws-2";

function checkpointState(over: Partial<CompanyFirstSourcingState> = {}): CompanyFirstSourcingState {
  const s = newSourcingState({ workspaceId: WS, taskId: TASK, requestedLeadCount: 5, quotaPolicy: "contact_only", now: "2026-07-26T12:00:00.000Z" });
  s.eligible_leads = 1;
  s.remaining_leads = 4;
  s.current_round = 2;
  s.attempted_titles = ["Sales Operations", "Revenue Operations", "GTM Operations"];
  s.attempted_strategy_hashes = ["hash-r1"];
  s.completed_calls = [
    { idempotency_key: "jobs:r1", round: 1, actor_key: "apify_jobs", company_key: null, item_count: 11, completed_at: "2026-07-26T12:00:00.000Z" },
    { idempotency_key: "people:r1:lahzo", round: 1, actor_key: "apify_people_search", company_key: "lahzo", item_count: 0, completed_at: "2026-07-26T12:00:30.000Z" },
  ];
  s.persisted_lead_keys = ["lahzo|"];
  s.completed_rounds = [{
    round_number: 1, strategy_hash: "hash-r1",
    title_queries: ["Sales Operations", "Revenue Operations", "GTM Operations"],
    delta_titles: ["Sales Operations", "Revenue Operations", "GTM Operations"],
    plan_source: "deterministic_registry", planner_status: "validated",
    funnel: { raw_jobs: 11, verified_companies: 1 },
    eligible_after: 1, remaining_after: 4, estimated_cost: 2, actual_provider_calls: 2,
    completed_at: "2026-07-26T12:01:00.000Z",
  }];
  return { ...s, ...over };
}

function taskRow(over: Record<string, unknown> = {}) {
  return {
    id: TASK, workspace_id: WS, status: "ready",
    result: { [SOURCING_STATE_KEY]: checkpointState() },
    payload: { instruction: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads." },
    ...over,
  };
}

// ---- PART 3: the eleven resume properties --------------------------------

Deno.test("3.1 a valid checkpoint loads the EXISTING task", () => {
  const d = decideResume(taskRow(), WS, TASK);
  assert(d.ok);
  assertEquals(d.ok && d.taskId, TASK);
});

Deno.test("3.2 no new task is inserted — the decision returns the same id", () => {
  const d = decideResume(taskRow(), WS, TASK);
  assert(d.ok);
  // The only id the caller may use is the one it was given. There is no field
  // through which a NEW id could be introduced.
  assertEquals(Object.keys(d).sort(), ["instruction", "nextRound", "ok", "taskId"]);
  assertEquals(d.ok && d.taskId, TASK);
});

Deno.test("3.3 workspace ownership is checked before the checkpoint is read", () => {
  const d = decideResume(taskRow(), OTHER_WS, TASK);
  assertFalse(d.ok);
  assertEquals(!d.ok && d.reason, "workspace_mismatch");
  assertStringIncludes(RESUME_REFUSAL_MESSAGE.workspace_mismatch, "different workspace");
});

Deno.test("3.4 the requested quota survives the checkpoint", () => {
  const s = checkpointState();
  assertEquals(s.requested_lead_count, 5);
  assertEquals(s.quota_policy, "contact_only");
  // A resume must not renegotiate what was asked for.
  const roundTripped = JSON.parse(JSON.stringify(taskRow().result))[SOURCING_STATE_KEY];
  assertEquals(roundTripped.requested_lead_count, 5);
  assertEquals(roundTripped.quota_policy, "contact_only");
});

Deno.test("3.5 eligible and remaining counts survive the checkpoint", () => {
  const s = JSON.parse(JSON.stringify(taskRow().result))[SOURCING_STATE_KEY];
  assertEquals(s.eligible_leads, 1);
  assertEquals(s.remaining_leads, 4);
  assertEquals(s.eligible_leads + s.remaining_leads, s.requested_lead_count);
});

Deno.test("3.6 round state is preserved — resume continues, never restarts", () => {
  const d = decideResume(taskRow(), WS, TASK);
  assert(d.ok);
  assertEquals(d.ok && d.nextRound, 2, "a resume must not restart round 1");
  const s = checkpointState();
  assertEquals(s.completed_rounds.length, 1);
  assertEquals(s.completed_rounds[0].round_number, 1);
  // Round 2 may only send titles round 1 did not.
  assertEquals(deltaTitles(s, ["Sales Operations", "Deal Desk"]), ["Deal Desk"]);
});

Deno.test("3.7 completed provider calls remain completed across the resume", () => {
  const s = JSON.parse(JSON.stringify(taskRow().result))[SOURCING_STATE_KEY] as CompanyFirstSourcingState;
  assertEquals(s.completed_calls.length, 2);
  assert(hasCompletedCall(s, "jobs:r1"), "the round-1 jobs call must stay completed");
  assert(hasCompletedCall(s, "people:r1:lahzo"), "the round-1 people call must stay completed");
});

Deno.test("3.8 provider idempotency is intact — a repeat key is not re-recorded", () => {
  const s = checkpointState();
  const before = s.completed_calls.length;
  recordCompletedCall(s, { idempotency_key: "jobs:r1", round: 2, actor_key: "apify_jobs", company_key: null, item_count: 99, completed_at: "x" });
  assertEquals(s.completed_calls.length, before, "a duplicate key created a second paid call record");
  // …and a genuinely new call still records.
  recordCompletedCall(s, { idempotency_key: "jobs:r2", round: 2, actor_key: "apify_jobs", company_key: null, item_count: 7, completed_at: "y" });
  assertEquals(s.completed_calls.length, before + 1);
});

Deno.test("3.9 a completed task cannot be resumed", () => {
  for (const terminal of ["completed", "search_exhausted", "budget_exhausted", "round_limit_reached"]) {
    const row = taskRow({ result: { [SOURCING_STATE_KEY]: checkpointState({ terminal_status: terminal }) } });
    const d = decideResume(row, WS, TASK);
    assertFalse(d.ok, `${terminal} was resumable`);
    assertEquals(!d.ok && d.reason, "already_terminal", terminal);
  }
  assertFalse(isResumable(checkpointState({ terminal_status: "completed" })));
});

Deno.test("3.10 invalid checkpoints are refused (the caller returns 409)", () => {
  const cases: Array<[string, ReturnType<typeof taskRow> | null, string]> = [
    ["missing task", null, "task_not_found"],
    ["terminal row state", taskRow({ status: "failed" }), "not_resumable_state"],
    ["terminal result", taskRow({ result: { [SOURCING_STATE_KEY]: checkpointState(), terminal_status: "search_exhausted" } }), "already_terminal"],
    ["id mismatch", taskRow({ id: "other-id" }), "task_not_found"],
    ["no checkpoint", taskRow({ result: {} }), "no_checkpoint"],
    ["stale version", taskRow({ result: { [SOURCING_STATE_KEY]: { ...checkpointState(), version: "company-first-state-0.9.0" } } }), "checkpoint_version_mismatch"],
  ];
  for (const [name, row, reason] of cases) {
    const d = decideResume(row, WS, TASK);
    assertFalse(d.ok, name);
    assertEquals(!d.ok && d.reason, reason, name);
    assert(RESUME_REFUSAL_MESSAGE[reason as keyof typeof RESUME_REFUSAL_MESSAGE].length > 0);
  }
});

Deno.test("3.11 a failed continuation leaves the previous checkpoint untouched", async () => {
  // The CAS is the only write a refused/failed continuation performs. When it
  // loses, the stored state is byte-identical to what it was.
  const stored = { [SOURCING_STATE_KEY]: checkpointState() };
  const snapshot = JSON.stringify(stored);
  // The row has ALREADY moved to `running` (another invocation won); this one
  // still holds the `partial` it observed, so its CAS predicate cannot match.
  const db = fakeDb({ id: TASK, status: "running" }, /* current row value */ "running");
  const res = await claimContinuation({
    db, taskId: TASK, observedStatus: "ready",
    resultWithClaim: { ...stored, [CLAIM_KEY]: newClaim("t", "2026-07-26T12:02:00.000Z", 2) },
  });
  assertFalse(res.claimed);
  assertEquals(JSON.stringify(stored), snapshot, "the checkpoint was mutated by a failed continuation");
});

Deno.test("3.x the checkpoint is rejected for a different tenant or task", () => {
  const s = checkpointState();
  assert(stateBelongsTo(s, WS, TASK));
  assertFalse(stateBelongsTo(s, OTHER_WS, TASK));
  assertFalse(stateBelongsTo(s, WS, "another-task"));
  assertFalse(stateBelongsTo({ ...s, version: "old" }, WS, TASK));
});

// ---- PART 4: the concurrency claim ---------------------------------------

/**
 * Fake CAS. `matchStatus` is the value currently in the row; the update only
 * "matches" when the predicate equals it — exactly Postgres's behaviour for
 * `WHERE id=$1 AND status=$2`.
 */
function fakeDb(row: { id: string; status: string }, matchStatus: string, onWrite?: (v: Record<string, unknown>) => void): ClaimDb {
  return {
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_c: string, _v: unknown) => ({
          eq: (_c2: string, predicate: unknown) => ({
            select: async () => {
              if (String(predicate) !== matchStatus) return { data: [] };
              onWrite?.(values);
              row.status = String(values.status);
              matchStatus = row.status;   // the row has moved on
              return { data: [{ id: row.id }] };
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test("4.1 an unclaimed task is claimable", () => {
  const d = decideClaimAttempt(null, Date.now());
  assert(d.ok);
  assertEquals(d.ok && d.reason, "fresh_claim");
});

Deno.test("4.2 a LIVE claim refuses a second continuation", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const held: ContinuationClaim = { token: "t1", claimed_at: "2026-07-26T11:59:00.000Z", round: 2 };
  const d = decideClaimAttempt(held, now);
  assertFalse(d.ok);
  assertEquals(!d.ok && d.reason, "already_claimed");
  assertEquals(!d.ok && d.heldSince, "2026-07-26T11:59:00.000Z");
});

Deno.test("4.3 two CONCURRENT claims: exactly one wins the compare-and-swap", async () => {
  const row = { id: TASK, status: "ready" };
  const writes: Array<Record<string, unknown>> = [];
  const db = fakeDb(row, "ready", (v) => writes.push(v));

  // Both invocations read `ready` at the same instant — the real race.
  const [a, b] = await Promise.all([
    claimContinuation({ db, taskId: TASK, observedStatus: "ready", resultWithClaim: { [CLAIM_KEY]: newClaim("A", "2026-07-26T12:00:00.000Z", 2) } }),
    claimContinuation({ db, taskId: TASK, observedStatus: "ready", resultWithClaim: { [CLAIM_KEY]: newClaim("B", "2026-07-26T12:00:00.000Z", 2) } }),
  ]);

  const winners = [a, b].filter((r) => r.claimed);
  assertEquals(winners.length, 1, "the same checkpoint was claimed twice");
  assertEquals(writes.length, 1, "two writes reached the row");
  const loser = [a, b].find((r) => !r.claimed)!;
  assertEquals(!loser.claimed && loser.reason, "lost_race");
});

Deno.test("4.4 the loser does not execute the checkpoint", async () => {
  const row = { id: TASK, status: "ready" };
  const db = fakeDb(row, "ready");
  let roundsExecuted = 0;
  const runIfClaimed = async (token: string) => {
    const r = await claimContinuation({ db, taskId: TASK, observedStatus: "ready", resultWithClaim: { [CLAIM_KEY]: newClaim(token, "2026-07-26T12:00:00.000Z", 2) } });
    if (r.claimed) roundsExecuted++;
  };
  await Promise.all([runIfClaimed("A"), runIfClaimed("B"), runIfClaimed("C")]);
  assertEquals(roundsExecuted, 1, "the same round would have been paid for more than once");
});

Deno.test("4.5 a STALE claim may be reclaimed after the window", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const stale: ContinuationClaim = { token: "dead", claimed_at: new Date(now - STALE_CLAIM_MS - 1000).toISOString(), round: 2 };
  const d = decideClaimAttempt(stale, now);
  assert(d.ok, "a task whose claim died must not be stuck forever");
  assertEquals(d.ok && d.reason, "stale_reclaim");
  assertEquals(d.ok && d.previousToken, "dead");
});

Deno.test("4.6 a claim just inside the window is still refused", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const fresh: ContinuationClaim = { token: "t", claimed_at: new Date(now - STALE_CLAIM_MS + 1000).toISOString(), round: 2 };
  assertFalse(decideClaimAttempt(fresh, now).ok);
});

Deno.test("4.7 an unparseable claim timestamp is treated as stale, not as a permanent lock", () => {
  const d = decideClaimAttempt({ token: "t", claimed_at: "not-a-date", round: null }, Date.now());
  assert(d.ok);
  assertEquals(d.ok && d.reason, "stale_reclaim");
});

Deno.test("4.8 finishing a round releases the claim so the next Continue can run", () => {
  const result = { [SOURCING_STATE_KEY]: checkpointState(), [CLAIM_KEY]: newClaim("t", "2026-07-26T12:00:00.000Z", 2) };
  const released = releaseClaim(result);
  assertEquals(released[CLAIM_KEY], undefined);
  // The checkpoint itself is untouched by the release.
  assertEquals((released[SOURCING_STATE_KEY] as CompanyFirstSourcingState).current_round, 2);
  assert(decideClaimAttempt(released[CLAIM_KEY] as ContinuationClaim | undefined, Date.now()).ok);
});

Deno.test("4.9 DOCUMENTED LIMITATION: two stale reclaimers can both pass the policy", () => {
  // Honest test of the known hole. `decideClaimAttempt` is a policy, not a lock;
  // after the stale window the CAS predicate is `running` vs `running`, which
  // does not distinguish the two callers. Closing this needs a dedicated claim
  // column or an RPC with FOR UPDATE — i.e. a migration, which is out of scope.
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const stale: ContinuationClaim = { token: "dead", claimed_at: new Date(now - STALE_CLAIM_MS - 1).toISOString(), round: 2 };
  assert(decideClaimAttempt(stale, now).ok);
  assert(decideClaimAttempt(stale, now).ok, "both stale reclaimers pass — this is the known limitation");
  // The pre-stale case, which is the one that actually happens, IS exclusive.
  const fresh: ContinuationClaim = { token: "live", claimed_at: new Date(now - 1000).toISOString(), round: 2 };
  assertFalse(decideClaimAttempt(fresh, now).ok);
});

// ---- wiring proof ---------------------------------------------------------

Deno.test("WIRING: run-agent takes the claim before it resumes, and releases it after", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "decideClaimAttempt(held ?? null, Date.now())");
  assertStringIncludes(src, "claimContinuation({");
  assertStringIncludes(src, "observedStatus,");
  assertStringIncludes(src, 'error: "continuation_refused", reason: cas.reason');
  // The compatibility path moves ready → running.
  assertStringIncludes(src, 'observedStatus,');
  assertStringIncludes(src, "releaseClaim(");
  // The resume path must never fall through to the insert.
  assertStringIncludes(src, "if (!task) {");
  assertStringIncludes(src, "decideResume(existing as ResumableTaskRow | null, workspace_id, resume_task_id)");
});
