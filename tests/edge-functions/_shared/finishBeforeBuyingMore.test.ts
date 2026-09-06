// WORK ALREADY PAID FOR IS FINISHED BEFORE MORE IS BOUGHT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage ab06540f, 2026-09-06. 149 companies discovered, 54 paid to enrich, 54
// hiring-verified — and eighteen ever reached the evaluator. Twice a slice cut
// qualification short:
//
//     07:16:59  qualification_deadline_stop { evaluated: 7,  not_reached: 4 }
//     07:34:45  qualification_deadline_stop { evaluated: 11, not_reached: 5 }
//
// and `shouldTakeAnotherSlice` then authorised another ten companies to be
// prepared on top of the ones already prepared and undecided. Each slice
// inherited more unfinished work than it began with, and the run ended having
// spent on 54 enrichments to produce 18 evaluations and zero leads.
//
// The pre-existing clauses ask whether MORE work is affordable — quota,
// frontier, pass ceiling, wall clock. None asked whether the work already
// bought had been finished.
//
// ZERO network, ZERO models, ZERO database. `shouldTakeAnotherSlice` is a pure
// function, which is why this invariant can be pinned deterministically.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  shouldTakeAnotherSlice,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";

/** A slice with room to do more: quota unmet, frontier open, time available. */
const base = {
  qualified: 0,
  requestedCount: 5,
  frontierRemaining: 80,
  passesTaken: 0,
  timeCapacity: 10,
};

Deno.test("THE RUN: prepared-but-undecided companies block another batch", () => {
  const g = shouldTakeAnotherSlice({ ...base, qualificationReady: 5 });
  assertEquals(g.take, false);
  assertEquals(
    g.reason,
    "qualification_ready_pending",
    "five companies were bought, enriched and verified and never judged; " +
      "authorising ten more is how ab06540f spent on 54 to evaluate 18",
  );
});

Deno.test("evidence debt on near-qualified companies also blocks it", () => {
  // A company one page from a verdict is worth more than ten unlooked-at ones,
  // and the page is usually already cached.
  const g = shouldTakeAnotherSlice({ ...base, evidenceDebt: 3 });
  assertEquals(g.take, false);
  assertEquals(g.reason, "evidence_debt_pending");
});

Deno.test("with nothing pending, upstream preparation is allowed", () => {
  // The gate must not become a brake. Nothing bought-and-unfinished means the
  // next batch is exactly the right thing to do.
  const g = shouldTakeAnotherSlice({
    ...base, qualificationReady: 0, evidenceDebt: 0,
  });
  assertEquals(g.take, true);
  assertEquals(g.reason, "quota_unmet_frontier_remains");
});

Deno.test("quota met outranks everything pending", () => {
  // A satisfied request stops, whatever is still on the books.
  const g = shouldTakeAnotherSlice({
    ...base, qualified: 5, qualificationReady: 9, evidenceDebt: 4,
  });
  assertEquals(g.take, false);
  assertEquals(g.reason, "quota_met");
});

Deno.test("STARVATION CANNOT REPEAT: pending work cannot be outrun", () => {
  // The invariant, stated as the loop that produced the defect. Each slice cuts
  // qualification short and leaves companies undecided; the gate must refuse
  // every time, so the pool cannot keep widening ahead of the verdicts.
  let prepared = 10;
  let undecided = 4;
  let batchesAuthorised = 0;

  for (let slice = 0; slice < 8; slice++) {
    const g = shouldTakeAnotherSlice({
      ...base,
      frontierRemaining: 140 - prepared,
      qualificationReady: undecided,
    });
    if (g.take) {
      batchesAuthorised++;
      prepared += 10;
      undecided += 4;   // the deadline cuts qualification again
    }
  }

  assertEquals(
    batchesAuthorised,
    0,
    `the gate authorised ${batchesAuthorised} more batches while ${undecided} ` +
      `companies sat bought and unjudged — this is the ab06540f loop`,
  );
  assertEquals(prepared, 10, "the pool must not widen while work is unfinished");
});

Deno.test("progress releases the gate", () => {
  // And the other half: once the pending work IS finished, preparation resumes.
  // A gate that never reopens would stall the run instead of starving it.
  const blocked = shouldTakeAnotherSlice({ ...base, qualificationReady: 4 });
  assertEquals(blocked.take, false);

  const released = shouldTakeAnotherSlice({ ...base, qualificationReady: 0 });
  assertEquals(released.take, true, "finishing the batch must allow the next one");
});

Deno.test("the pre-existing gates are untouched", () => {
  for (
    const [over, reason] of [
      [{ frontierRemaining: 0 }, "frontier_exhausted"],
      [{ passesTaken: 99 }, "pass_ceiling"],
      [{ timeCapacity: 0 }, "no_time_for_another_slice"],
    ] as const
  ) {
    const g = shouldTakeAnotherSlice({ ...base, ...over });
    assertEquals(g.take, false);
    assertEquals(g.reason, reason);
  }
});

Deno.test("omitting the new counts behaves exactly as before", () => {
  // Backwards compatible: an older caller that passes neither count gets the
  // original decision, so nothing else in the engine changes shape.
  const g = shouldTakeAnotherSlice(base);
  assertEquals(g.take, true);
  assertEquals(g.reason, "quota_unmet_frontier_remains");
});
