// A SLICE THAT DECIDES COMPANIES HAS ACHIEVED SOMETHING.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 744644ab, final three slices:
//
//     16:21  owed 1 · evaluated 12 (11 restored, 1 NEW) · investigated 48→48
//     16:27  owed 1 · evaluated 13 (12 restored, 1 NEW) · investigated 48→48
//     16:28  owed 2 · evaluated 15 (13 restored, 2 NEW) · frontier 16 → 0
//
// Each carried companies to durable Brain verdicts and drained the frontier to
// zero. None qualified anybody — the verdicts were rejections — and none
// investigated anybody new, because the companies were already investigated.
// `sliceWasBarren` asked only about those two deltas, so all three counted as
// having achieved nothing, and the run stopped `no_progress` at 1 of 5 with the
// pool fully worked and page 3 unbought.
//
// A job search that had already SUCCEEDED was thrown away with it — see
// `pendingRunOutranksBarren` below.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  sliceWasBarren, foldSlice, readLineageProgress, MAX_BARREN_SLICES,
} from "../../supabase/functions/_shared/leadAutoContinuation.ts";

const prior = (over: Record<string, number> = {}) => ({
  version: "lead-auto-continuation-v1",
  continuations_used: 5, cost_units_used: 20, barren_slices: 0,
  qualified_high_water: 1, unique_companies_investigated: 48,
  investigation_authorisations: 30, brain_decided: 10,
  stopped_reason: null, stopped_detail: null, ...over,
} as never);

const slice = (over: Record<string, number> = {}) => ({
  qualifiedInPool: 1, uniqueCompaniesInvestigatedInPool: 48,
  authorisationsInPool: 30, costUnitsInLineage: 20, brainDecidedInPool: 10,
  ...over,
});

// ══ THE PREDICATE ══════════════════════════════════════════════════════════

Deno.test("a new Brain decision is progress", () => {
  assertEquals(
    sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 0, brainDecidedDelta: 1 }),
    false, "one durable verdict is not nothing");
});

Deno.test("restoring decisions is not progress", () => {
  // THE CASE THIS COUNTER EXISTS TO CATCH. A slice that replays what the
  // checkpoint already knew has changed nothing.
  assertEquals(
    sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 0, brainDecidedDelta: 0 }),
    true);
});

Deno.test("the previous two signals still count on their own", () => {
  assertEquals(
    sliceWasBarren({ qualifiedDelta: 1, investigatedDelta: 0, brainDecidedDelta: 0 }),
    false, "qualifying somebody");
  assertEquals(
    sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 3, brainDecidedDelta: 0 }),
    false, "investigating somebody");
});

Deno.test("a caller that reports no decisions keeps its old behaviour", () => {
  assertEquals(sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 0 }), true);
  assertEquals(sliceWasBarren({ qualifiedDelta: 0, investigatedDelta: 1 }), false);
});

// ══ THE FOLD ═══════════════════════════════════════════════════════════════

Deno.test("the incident slice is no longer barren", () => {
  // 16:27 exactly: nothing qualified, nothing newly investigated, one new
  // verdict.
  const p = foldSlice(prior(), slice({ brainDecidedInPool: 11 }));
  assertEquals(p.barren_slices, 0, "a verdict resets the counter");
  assertEquals(p.brain_decided, 11, "and the count carries forward");
});

Deno.test("a genuinely idle slice still trips the counter", () => {
  let p = foldSlice(prior(), slice());
  assertEquals(p.barren_slices, 1);
  p = foldSlice(p, slice());
  assertEquals(p.barren_slices, 2);
  assert(p.barren_slices >= MAX_BARREN_SLICES,
    "MAX_BARREN_SLICES is untouched and still reachable");
});

Deno.test("the decided count never regresses", () => {
  // Same rule as `qualified_high_water`: a slice that reports fewer must not
  // erase what an earlier one established.
  const p = foldSlice(prior({ brain_decided: 12 }), slice({ brainDecidedInPool: 3 }));
  assertEquals(p.brain_decided, 12);
});

Deno.test("a checkpoint written before the field restores safely", () => {
  const legacy = readLineageProgress({
    version: "lead-auto-continuation-v1", continuations_used: 3,
    cost_units_used: 9, barren_slices: 1, qualified_high_water: 1,
    unique_companies_investigated: 20, investigation_authorisations: 10,
  });
  assertEquals(legacy.brain_decided, 0, "absent narrows to zero");
  // And the first slice after the upgrade reads its decided set as new, which
  // can only PREVENT a stop — never cause one.
  const p = foldSlice(legacy, slice({ brainDecidedInPool: 10 }));
  assertEquals(p.barren_slices, 0);
});

Deno.test("run-agent reports the decided count from the working set", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const i = src.indexOf("brainDecidedInPool:");
  assert(i > 0, "the caller must report it");
  const block = src.slice(i, i + 200);
  assert(block.includes("c.brain !== null"),
    "counted from per-company Brain state, deduplicated by the working set");
});
