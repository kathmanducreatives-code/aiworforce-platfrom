// THE REQUEST IS THE JOB. THE INVOCATION IS A SLICE OF IT.
//
// "Find 10 qualified AI startups in the US hiring software engineers" is one
// job. An edge invocation is ~125s of it, which buys roughly ten investigations
// and yields roughly four qualified companies. Reaching ten therefore takes
// three or four slices — and until now the second slice never existed. Across
// 202 sourcing tasks, seventeen checkpoints asked for a continuation and none
// was ever taken, because nothing drove one.
//
// These prove the driver: when it fires, when it must not, what it carries
// between slices, and that a multi-slice run actually reaches the requested
// number without anybody pressing anything.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideAutoContinuation, foldSlice, newLineageProgress,
  readLineageProgress, resolveMaxContinuations, resolveMaxLineageCostUnits,
  sliceWasBarren, DEFAULT_MAX_CONTINUATIONS, MAX_BARREN_SLICES,
  MAX_CONTINUATIONS_CAP, MAX_CONTINUATIONS_ENV, MAX_LINEAGE_COST_UNITS_ENV,
  type AutoContinuationInput,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  dispatchContinuation,
} from "../../../supabase/functions/_shared/leadContinuationDispatch.ts";

/** A request that is plainly unfinished: 4 of 10, plenty of pool, no ceilings hit. */
const RUNNING = (over: Partial<AutoContinuationInput> = {}): AutoContinuationInput => ({
  qualified: 4, requestedCount: 10, frontierRemaining: 88,
  continuationsUsed: 1, maxContinuations: 10,
  costUnitsUsed: 12, maxCostUnits: 120,
  barrenSlices: 0, ...over,
});

// ═══════════════════════════════════ 1-2. it continues, and it says why ══

Deno.test("1. an unfinished request continues automatically", () => {
  const d = decideAutoContinuation(RUNNING());
  assert(d.continue, d.detail);
  assertEquals(d.reason, "quota_unmet_frontier_remains");
  // THE USER ASKED ONCE AND IS WAITING. The Workbench must say the job is still
  // running, not that a run finished four short.
  assert(d.user_message?.includes("4 of 10"), d.user_message ?? "(none)");
  assert(d.user_message?.includes("6 more"), d.user_message ?? "(none)");
});

Deno.test("2. reaching the target is the only ending that is a success", () => {
  const d = decideAutoContinuation(RUNNING({ qualified: 10 }));
  assertFalse(d.continue);
  assertEquals(d.reason, "quota_met");
  assert(d.detail.includes("10 of 10"));
  // Over-delivery stops too, and is not reported as a shortfall.
  assertEquals(decideAutoContinuation(RUNNING({ qualified: 11 })).reason, "quota_met");
});

// ══════════════════════════════════════════ 3-7. every stopping condition ══

Deno.test("3. an EXHAUSTED pool stops, and the shortfall is real", () => {
  const d = decideAutoContinuation(RUNNING({ frontierRemaining: 0 }));
  assertFalse(d.continue);
  assertEquals(d.reason, "frontier_exhausted");
  assert(d.detail.includes("4 of 10"),
    "an honest shortfall names what was found, not what was missing");
});

Deno.test("4. the continuation CEILING stops the job, and admits it is a ceiling", () => {
  const d = decideAutoContinuation(RUNNING({ continuationsUsed: 10, maxContinuations: 10 }));
  assertFalse(d.continue);
  assertEquals(d.reason, "continuation_ceiling");
  // A CEILING IS NOT A FINDING. The remaining candidates were never examined and
  // the detail must not let that read as "nothing else qualified".
  assert(d.detail.includes("88 candidates remain unexamined"), d.detail);
});

Deno.test("5. the COST ceiling stops the job — 'keep going' is not unbounded spend", () => {
  const d = decideAutoContinuation(RUNNING({ costUnitsUsed: 120, maxCostUnits: 120 }));
  assertFalse(d.continue);
  assertEquals(d.reason, "cost_ceiling");
  assert(d.detail.includes("remain unexamined"));
});

Deno.test("6. two barren slices in a row stop the job", () => {
  // One barren slice is ordinary — a batch whose identities did not resolve.
  assert(decideAutoContinuation(RUNNING({ barrenSlices: 1 })).continue,
    "a single unproductive slice is not evidence");
  const d = decideAutoContinuation(RUNNING({ barrenSlices: MAX_BARREN_SLICES }));
  assertFalse(d.continue);
  assertEquals(d.reason, "no_progress");
});

Deno.test("7. a provider failure and a cancellation both stop it", () => {
  assertEquals(
    decideAutoContinuation(RUNNING({ providerFailed: true })).reason, "provider_failure");
  // Cancellation outranks EVERYTHING, including a met quota — a user who
  // stopped the run must not be billed for one more slice.
  assertEquals(
    decideAutoContinuation(RUNNING({ cancelled: true, qualified: 10 })).reason, "cancelled");
});

Deno.test("7b. the target is checked before every ceiling", () => {
  // A run that reached ten on its last allowed slice succeeded; it did not
  // "hit the continuation ceiling".
  const d = decideAutoContinuation(RUNNING({
    qualified: 10, continuationsUsed: 99, maxContinuations: 10,
    costUnitsUsed: 9_999, maxCostUnits: 120,
  }));
  assertEquals(d.reason, "quota_met");
});

// ═══════════════════════════ 8-10. what carries between slices ══

Deno.test("8. the qualified count is a HIGH-WATER MARK and never regresses", () => {
  // THE DEFECT THIS PREVENTS is the one the multi-round controller had: a slice
  // that evaluates nobody reports zero qualified, and assigning that erases the
  // companies an earlier slice proved and already persisted.
  let p = newLineageProgress();
  p = foldSlice(p, { qualified: 4, investigated: 10, costUnits: 12 });
  assertEquals(p.qualified_high_water, 4);

  p = foldSlice(p, { qualified: 0, investigated: 10, costUnits: 12 });
  assertEquals(p.qualified_high_water, 4,
    "a barren slice may not un-qualify four persisted companies");

  p = foldSlice(p, { qualified: 7, investigated: 10, costUnits: 12 });
  assertEquals(p.qualified_high_water, 7);
  assertEquals(p.continuations_used, 3);
  assertEquals(p.cost_units_used, 36);
  assertEquals(p.investigated_total, 30);
});

Deno.test("9. barren slices count consecutively and any progress resets them", () => {
  assert(sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 0 }));
  assertFalse(sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 5 }),
    "moving the frontier is progress even when nobody qualified");
  assertFalse(sliceWasBarren({ qualifiedDelta: 2, investigatedDelta: 0 }));

  let p = newLineageProgress();
  p = foldSlice(p, { qualified: 0, investigated: 0, costUnits: 1 });
  assertEquals(p.barren_slices, 1);
  p = foldSlice(p, { qualified: 0, investigated: 0, costUnits: 1 });
  assertEquals(p.barren_slices, 2);
  p = foldSlice(p, { qualified: 0, investigated: 6, costUnits: 1 });
  assertEquals(p.barren_slices, 0, "a slice that investigated somebody resets the count");
});

Deno.test("10. progress survives the task row, and a missing one is safe", () => {
  const p = foldSlice(newLineageProgress(), {
    qualified: 3, investigated: 10, costUnits: 9,
  });
  const round = readLineageProgress(JSON.parse(JSON.stringify(p)));
  assertEquals(round.qualified_high_water, 3);
  assertEquals(round.continuations_used, 1);

  // A first slice has no prior progress at all.
  const fresh = readLineageProgress(undefined);
  assertEquals(fresh.continuations_used, 0);
  assertEquals(fresh.qualified_high_water, 0);
  // And junk never produces a negative or fractional ceiling input.
  const junk = readLineageProgress({ continuations_used: -5, cost_units_used: "x" });
  assertEquals(junk.continuations_used, 0);
  assertEquals(junk.cost_units_used, 0);
});

// ═════════════════════════════════════════════ 11-12. the ceilings resolve ══

Deno.test("11. the ceilings are configurable and capped", () => {
  assertEquals(resolveMaxContinuations(() => undefined), DEFAULT_MAX_CONTINUATIONS);
  assertEquals(
    resolveMaxContinuations((k) => k === MAX_CONTINUATIONS_ENV ? "3" : undefined), 3);
  assertEquals(
    resolveMaxContinuations((k) => k === MAX_CONTINUATIONS_ENV ? "9999" : undefined),
    MAX_CONTINUATIONS_CAP, "an operator cannot remove the bound");
  assertEquals(
    resolveMaxContinuations((k) => k === MAX_CONTINUATIONS_ENV ? "0" : undefined),
    DEFAULT_MAX_CONTINUATIONS, "nonsense falls back rather than disabling continuation");
  assert(resolveMaxLineageCostUnits(
    (k) => k === MAX_LINEAGE_COST_UNITS_ENV ? "40" : undefined) === 40);
});

// ═══════════════════════════════════════════════ 13-15. the dispatch ══

const deps = (over: Record<string, unknown> = {}) => ({
  fetch: () => Promise.resolve({ status: 202 }),
  functionsBaseUrl: "https://proj.supabase.co/functions/v1",
  serviceRoleKey: "service-key",
  ...over,
} as never);

const MISSION = { version: "lead-mission-v1", requested_count: 10 };
const REQ = {
  resumeTaskId: "task-1", workspaceId: "ws-1", userId: "user-1",
  planId: "plan-1", agentSlug: "scout", continuationIndex: 2,
  stepIndex: 0, instruction: "Find 10 AI startups in the US hiring engineers",
  toolInput: { lead_mission: MISSION },
};

Deno.test("13. the next slice resumes the SAME task and belongs to the SAME user",
  async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    let seenAuth = "";
    const out = await dispatchContinuation(REQ, deps({
      fetch: (url: string, init: RequestInit) => {
        seenUrl = url;
        seenAuth = String((init.headers as Record<string, string>).Authorization);
        seenBody = JSON.parse(String(init.body));
        return Promise.resolve({ status: 202 });
      },
    }));

    assert(out.dispatched);
    assertEquals(seenUrl, "https://proj.supabase.co/functions/v1/run-agent");
    // RESUME, NOT RESTART. A new task id here would re-run discovery and pay for
    // the pool a second time.
    assertEquals(seenBody.resume_task_id, "task-1");

    // ── THE ORCHESTRATED CONTRACT, WHICH IS VALIDATED FIRST ─────────────────
    //
    // This test previously asserted the OPPOSITE — that a continuation carries
    // no instruction "because the mission is in the checkpoint". Both halves
    // were wrong, and the first live dispatch proved it: HTTP 400,
    // `missing_required_fields`, before the resume path was reached.
    //
    // `run-agent` validates `plan_id`, `step_index`, `agent_slug`,
    // `workspace_id` and `instruction` BEFORE it looks at `resume_task_id`.
    assertEquals(seenBody.step_index, 0);
    assert(typeof seenBody.instruction === "string" && seenBody.instruction.length > 0);
    assertEquals(seenBody.plan_id, "plan-1");
    assertEquals(seenBody.agent_slug, "scout");

    // AND THE COMPILED MISSION TRAVELS WITH IT. `readPersistedLeadMission` reads
    // it from `tool_input.lead_mission` on the REQUEST, not from the checkpoint.
    // Without it the continuation runs as `legacy_carrier_union` and re-derives
    // intent — a different job from the one the user asked for.
    assertEquals(
      (seenBody.tool_input as Record<string, unknown>).lead_mission, MISSION);
    // ATTRIBUTED TO THE REQUESTER. `user_id` is honoured only for service-role
    // callers; without it the results land outside the asker's Workbench.
    assertEquals(seenBody.user_id, "user-1");
    assert(seenAuth.includes("service-key"));
    assertEquals(seenBody.auto_continuation, true);
  });

Deno.test("14. a missing service key is a VISIBLE stop, not a silent one", async () => {
  const out = await dispatchContinuation(REQ, deps({ serviceRoleKey: null }));
  assertFalse(out.dispatched);
  assertEquals(out.dispatched === false ? out.reason : null, "not_configured");
  const noUrl = await dispatchContinuation(REQ, deps({ functionsBaseUrl: null }));
  assertFalse(noUrl.dispatched);
});

Deno.test("14b. a REFUSED dispatch is a stop, not a handoff", async () => {
  // THE FIRST LIVE ATTEMPT recorded `{ status: 400, dispatched: true }`: any
  // response that did not throw counted as success, so the task claimed to be
  // continuing while its successor had been rejected outright. A run that says
  // it is continuing and never does is the exact failure this replaces.
  for (const status of [400, 401, 403, 409, 500]) {
    const out = await dispatchContinuation(REQ, deps({
      fetch: () => Promise.resolve({ status }),
    }));
    assertFalse(out.dispatched, `HTTP ${status} must not count as dispatched`);
    assertEquals(out.dispatched === false ? out.reason : null, "rejected");
    assertEquals(out.dispatched === false ? out.status : null, status);
  }
  // 2xx is the only handoff.
  for (const status of [200, 202]) {
    assert((await dispatchContinuation(REQ, deps({
      fetch: () => Promise.resolve({ status }),
    }))).dispatched, `HTTP ${status} is a handoff`);
  }
});

Deno.test("15. a transport failure loses the handoff, never the slice's work", async () => {
  const out = await dispatchContinuation(REQ, deps({
    fetch: () => Promise.reject(new Error("connection reset")),
  }));
  assertFalse(out.dispatched);
  assertEquals(out.dispatched === false ? out.reason : null, "transport_error");
  assert(out.dispatched === false && out.detail.includes("connection reset"));
});

// ══════════════════ 16. THE WHOLE JOB: one request reaches ten, unattended ══

Deno.test("16. a request for 10 reaches 10 across slices with no human input", () => {
  // The real shape: ~10 investigated and ~4 qualified per slice, over a pool of
  // 100. Nobody presses anything; the loop is driven entirely by the decision
  // function and the progress it carries.
  const REQUESTED = 10;
  let pool = 100;
  let progress = newLineageProgress();
  let slices = 0;
  const qualifiedPerSlice = [4, 3, 2, 4];

  for (;;) {
    const d = decideAutoContinuation({
      qualified: progress.qualified_high_water,
      requestedCount: REQUESTED,
      frontierRemaining: pool,
      continuationsUsed: progress.continuations_used,
      maxContinuations: resolveMaxContinuations(() => undefined),
      costUnitsUsed: progress.cost_units_used,
      maxCostUnits: resolveMaxLineageCostUnits(() => undefined),
      barrenSlices: progress.barren_slices,
    });
    if (!d.continue) {
      assertEquals(d.reason, "quota_met",
        `the job must end by meeting the target, not by ${d.reason}: ${d.detail}`);
      break;
    }
    // One slice: ten investigated off the frontier, some of them qualified.
    const investigated = Math.min(10, pool);
    pool -= investigated;
    const gained = qualifiedPerSlice[Math.min(slices, qualifiedPerSlice.length - 1)];
    progress = foldSlice(progress, {
      qualified: progress.qualified_high_water + gained,
      investigated,
      costUnits: 11,
    });
    slices++;
    assert(slices <= 20, "the loop must terminate");
  }

  assert(progress.qualified_high_water >= REQUESTED,
    `expected at least ${REQUESTED}, got ${progress.qualified_high_water}`);
  assertEquals(slices, 4, "four slices at ~4/3/2/4 qualified reaches ten");
  // AND IT DID NOT SPEND THE WHOLE POOL TO GET THERE.
  assertEquals(pool, 60, "it stopped as soon as the target was met");
  assert(progress.continuations_used < DEFAULT_MAX_CONTINUATIONS);
});

Deno.test("16b. a thin pool ends honestly short rather than looping", () => {
  // Only 25 candidates and a low yield: the job must end on an exhausted
  // frontier, with a real shortfall, and not spin.
  let pool = 25;
  let progress = newLineageProgress();
  let slices = 0;
  let stop = "";

  for (;;) {
    const d = decideAutoContinuation({
      qualified: progress.qualified_high_water,
      requestedCount: 10, frontierRemaining: pool,
      continuationsUsed: progress.continuations_used, maxContinuations: 10,
      costUnitsUsed: progress.cost_units_used, maxCostUnits: 120,
      barrenSlices: progress.barren_slices,
    });
    if (!d.continue) { stop = d.reason; break; }
    const investigated = Math.min(10, pool);
    pool -= investigated;
    progress = foldSlice(progress, {
      qualified: progress.qualified_high_water + 1, investigated, costUnits: 11,
    });
    slices++;
    assert(slices <= 20, "the loop must terminate");
  }

  assertEquals(stop, "frontier_exhausted");
  assertEquals(pool, 0);
  assertEquals(progress.qualified_high_water, 3, "three found, and the run says so");
});
