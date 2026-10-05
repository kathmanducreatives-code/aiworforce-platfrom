// HISTORICAL A — CANARY 98ce374b (production 2026-10-03): A POOL THAT CAN NEVER QUALIFY WAS "ENOUGH".
//
// Every company's funding claim was answered with nothing decisive, so no
// purchase could make any of them eligible — yet discovery counted the ten as
// available against a target of eight, proposed page 2 and never bought it;
// two barren slices ended the lineage `search_exhausted` with discovery open.
// PR #14: discovery counts only canonically workable companies. Replayed
// through the production engine with the fixture provider (zero network).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { type EngineFixture, replayEngineSlice } from "../lib/engine.ts";
import { canonicalView } from "../lib/verification.ts";
import { canonicallyWorkableKeys } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

const fx = loadFixture("canary98ce374b.replenishment") as EngineFixture & { verify_marks_after_slice_2: string[] };
const SEARCH = "apify_linkedin_company_search";
const searches = (calls: Array<{ actor: string; input: Record<string, unknown> }>) =>
  calls.filter((c) => c.actor === SEARCH && !c.input.searchQuery);

/** The verifier slice's outcome, as production recorded it: both funding routes answered, nothing decisive. */
const fundingAnswered = (records: unknown[]) =>
  (structuredClone(records) as Array<{ completed_operations?: string[] }>).map((r) => ({
    ...r, completed_operations: [...new Set([...(r.completed_operations ?? []), ...fx.verify_marks_after_slice_2])],
  }));

const opts = (s: Awaited<ReturnType<typeof replayEngineSlice>>) =>
  ({ mission: s.mission, plan: { entry_capability: "general_company_discovery" }, identity: { task_id: fx.provenance.task_id }, readiness: s.readiness });

Deno.test("[historical] A slice 1: page 1 investigated; the hard hiring claim is deferred and nothing is bought for it", async () => {
  const s1 = await replayEngineSlice(fx);
  assertEquals(searches(s1.provider.calls).length, 1);
  assertEquals(s1.companies.length, 10);
  assertEquals(s1.provider.calls.filter((c) => c.actor === "apify_linkedin_job_search").length, 0);
});

Deno.test("[historical] A with funding unclosable for all ten, nothing is workable — view, discovery count and continuation agree", async () => {
  const s1 = await replayEngineSlice(fx);
  const restored = await replayEngineSlice(fx, { resume: { state: s1.state, records: fundingAnswered(s1.resume_records) } });
  const view = canonicalView({ companies: restored.companies }, restored.mission, fx.provenance.task_id);
  assertEquals(view.evidence_gaps.with_executable_route, 0);
  assertEquals(canonicallyWorkableKeys(restored.companies, opts(restored)).size, 0);
  const d = decideAutoContinuation({
    qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 2, maxContinuations: 10,
    costUnitsUsed: 2, maxCostUnits: 40, barrenSlices: 0, discoveryRoutesRemain: true,
    verificationRoutesRemain: view.evidence_gaps.with_executable_route,
  });
  assertEquals(d.reason, "replenishment_required");
});

Deno.test("[historical] A the replenishment slice BUYS PAGE 2 (was: proposed, not taken)", async () => {
  const s1 = await replayEngineSlice(fx);
  const s3 = await replayEngineSlice(fx, {
    resume: { state: s1.state, records: fundingAnswered(s1.resume_records) }, replenish: { [SEARCH]: 1 },
  });
  const bought = searches(s3.provider.calls);
  assertEquals(bought.length, 1, "exactly one new discovery call");
  assertEquals(Number(bought[0].input.startPage), 2, "the NEXT page, never page 1 again");
  assertEquals(s3.companies.length, 20, "replenishment adds; the investigated pool is kept");
  assertFalse((s3.state.discovery_source_state as { exhausted: boolean }).exhausted);
  const workable = canonicallyWorkableKeys(s3.companies, opts(s3));
  assert([...workable].every((k) => k.includes("second-")), "only page 2 is workable");
});
