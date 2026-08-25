// PHASE 6 — THE TICK'S BOUNDARIES, PINNED AGAINST ITS OWN SOURCE.
//
// The tick spends a workspace's money while nobody is watching. What stops it
// spending more than it should is four decisions, and each one could be undone
// by an edit that looks reasonable.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-monitoring-tick/index.ts", import.meta.url),
);

Deno.test("1. only the scheduler may tick — there is no user path", () => {
  // A tick a browser could trigger is a way to spend a workspace's period
  // ceiling from outside. A person who wants a scan now uses the scan endpoint.
  assert(SRC.includes("token !== SERVICE_KEY"), "the tick must require the service key");
  assertFalse(/auth\.getUser/.test(SRC), "the tick has a user path");
  assertFalse(/workspace_members/.test(SRC), "a membership check implies a user path");
});

Deno.test("2. the ceiling is checked BEFORE the claim", () => {
  // Claiming first would advance a subject's cadence for a pass that was then
  // refused, so a workspace at its ceiling would go quiet for a full cadence
  // for a run that never happened.
  const budget = SRC.indexOf("budgetAllows(");
  const claim = SRC.indexOf('.update({ claimed_at:');
  assert(budget > 0 && claim > 0);
  assert(budget < claim, "a refused workspace must not have its subjects claimed");
});

Deno.test("3. the claim is a compare-and-swap, and a lease", () => {
  // Two ticks racing must produce ONE scan: the loser's UPDATE matches no rows.
  assert(
    SRC.includes('.or(`claimed_at.is.null,claimed_at.lt.${leaseCutoff}`)'),
    "the claim must only take work nobody holds, or whose lease expired",
  );
  assert(SRC.includes("claimedIds.length === 0"), "the loser must stand down");
  // AND IT EXPIRES. A flag set by a run that crashes freezes the subject
  // forever; a lease returns the work.
  assert(SRC.includes("CLAIM_LEASE_MINUTES"));
});

Deno.test("4. a failed pass releases its claim and does NOT advance the cadence", () => {
  // Advancing `last_run_at` on a failure would make a run that never happened
  // look like one that did, and the subject would wait a full cadence to retry.
  assert(
    SRC.includes("...(scanned ? { last_run_at: new Date().toISOString() } : {})"),
    "the cadence must advance only on a scan that ran",
  );
  assert(SRC.includes("claimed_at: null"), "the claim is released either way");
});

Deno.test("5. it calls the same endpoint a person triggers", () => {
  // A scheduled pass and a manual one must be the same pass, or the thing that
  // runs unattended is not the thing anybody tested.
  assert(SRC.includes("/functions/v1/run-monitoring-scan"));
  // And it owns no engine, no provider and no writer of its own.
  for (const forbidden of [
    "runCapabilityPlan", "buildInvoker", "source_with_apify",
    "writeSignalEventV2", "compileMonitoringMission",
  ]) {
    assertFalse(SRC.includes(forbidden), `the tick contains ${forbidden}`);
  }
});

Deno.test("6. a scheduled pass is small by default", () => {
  // Nobody is watching it, and a pass that cannot finish inside the wall clock
  // qualifies nobody — live run 2026-08-25 discovered 25 companies and
  // evaluated none of them.
  assert(SRC.includes("max_candidates: Number(body.max_candidates ?? 3)"));
});

Deno.test("7. a dry run decides and spends nothing", () => {
  const dry = SRC.slice(SRC.indexOf("if (dryRun) {"), SRC.indexOf("// ── CLAIM"));
  assert(dry.includes("would scan"), "a dry run must report what it would do");
  assertFalse(dry.includes("fetch("), "a dry run must not call the scan");
  assertFalse(dry.includes("claimed_at:"), "a dry run must not claim");
});
