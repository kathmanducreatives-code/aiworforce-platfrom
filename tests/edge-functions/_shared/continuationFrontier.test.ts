// A DEFERRED CANDIDATE IS NOT AN INVESTIGATED ONE.
//
// Live run e3b7d3a7, the first Lead run to complete end to end. It discovered
// 29 companies, resolved ONE identity, and stopped:
//
//   investigation_capacity  { capacity: 1, usable_ms: 26756, identity_call_ms: 22702 }
//   company_identity_resolution  "1 resolved, 9 deferred, 0 provider error;
//                                 9 of 10 target(s) never reached a terminal state"
//   auto_continuation  { decision: "frontier_exhausted", continuing: false,
//                        detail: "every discovered candidate has been investigated" }
//
// That detail is false. Nineteen candidates were deferred for time capacity,
// never investigated, and the run told the user the frontier was exhausted —
// then abandoned 28 of 29 companies. Nothing qualified, so no canonical event
// was written, so Phase 8's chain could not be proven.
//
// `decideAutoContinuation` was right: `frontierRemaining <= 0` IS exhaustion.
// The count handed to it was wrong. `isFrontier` recognises only
// `pending_investigation`, and a deferred company has already been moved to
// `in_flight`/`investigated` by the slice that budgeted it — so it disappears
// from the frontier without ever having been looked at.
//
// The engine already records the distinction: `stage_block.reason === "deferred"`,
// which its own comment calls "budgeted and abandoned". This reads it.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFrontier,
  isUnfinishedFrontier,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

const base = {
  qualified: 0, requestedCount: 3, continuationsUsed: 0, maxContinuations: 5,
  costUnitsUsed: 3, maxCostUnits: 100, barrenSlices: 0,
};

Deno.test("a deferred company is still on the frontier", () => {
  // The exact live shape: budgeted, moved out of `pending_investigation` by the
  // slice, then never reached because capacity ran out.
  assertEquals(isFrontier("investigated"), false, "precondition");
  assert(
    isUnfinishedFrontier("investigated", true),
    "a company that was budgeted and abandoned has not been investigated",
  );
  assert(isUnfinishedFrontier("in_flight", true));
});

Deno.test("a genuinely investigated company is NOT on the frontier", () => {
  assertEquals(isUnfinishedFrontier("investigated", false), false);
  assertEquals(isUnfinishedFrontier("in_flight", false), false);
});

Deno.test("a permanently excluded company never returns to the frontier", () => {
  // GPT said irrelevant, or a mission constraint closed it. Re-queueing that
  // would spend again on a decision already made.
  assertEquals(isUnfinishedFrontier("excluded_permanently", true), false);
  assertEquals(isUnfinishedFrontier("excluded_permanently", false), false);
});

Deno.test("pending_investigation is on the frontier either way", () => {
  assert(isUnfinishedFrontier("pending_investigation", false));
  assert(isUnfinishedFrontier("pending_investigation", true));
});

// ── what the corrected count does to the decision ──────────────────────────

Deno.test("deferred candidates continue the run instead of ending it", () => {
  // 19 deferred, quota unmet — the live case. This must not stop.
  const d = decideAutoContinuation({ ...base, frontierRemaining: 19 });
  assertEquals(d.continue, true);
  assertEquals(d.reason, "quota_unmet_frontier_remains");
});

Deno.test("a truly empty frontier still ends the run honestly", () => {
  const d = decideAutoContinuation({ ...base, frontierRemaining: 0 });
  assertEquals(d.continue, false);
  assertEquals(d.reason, "frontier_exhausted");
});

Deno.test("the ceilings still stop a run with candidates left", () => {
  // Continuing is not unconditional: a frontier that remains must still respect
  // the continuation and cost ceilings, or a capacity-limited run would loop.
  assertEquals(
    decideAutoContinuation({
      ...base, frontierRemaining: 19, continuationsUsed: 5, maxContinuations: 5,
    }).continue, false);
  assertEquals(
    decideAutoContinuation({
      ...base, frontierRemaining: 19, costUnitsUsed: 100, maxCostUnits: 100,
    }).continue, false);
});

// ── THE CALL SITE, NOT JUST THE HELPER ─────────────────────────────────────
//
// The tests above exercise `isUnfinishedFrontier` directly, so they pass even
// when run-agent computes the frontier the old way — which is precisely the bug
// that shipped. The same hole appeared in the compiler fold and cost a live run
// there too, so the call site is pinned by source.

Deno.test("run-agent counts deferred companies into the frontier", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const block = RUN.slice(
    RUN.indexOf("const sliceFrontier"),
    RUN.indexOf("const sliceFrontier") + 700,
  );
  assert(
    block.includes("isUnfinishedFrontier"),
    "the continuation frontier must use the deferred-aware predicate",
  );
  assert(
    /stage_block\?\.reason === "deferred"/.test(block),
    "and it must read the engine's own deferral signal",
  );
  assertEquals(
    /\(c\) => isFrontier\(c\.investigation_state\)\)\.length/.test(block), false,
    "the pending-only count is what reported an exhausted frontier for 19 deferred candidates",
  );
});
