// R2 — THE MISSION CONTRACT CAN NOW STATE THREE THINGS IT COULD NOT.
//
// R1 measured the gaps and recorded them as pinned losses. This file asserts
// they are closed at the contract level:
//
//   1. "the user asked for no particular number"  — requested_count is nullable
//   2. "the user asked for social posts"          — RequestedOutput has a value
//   3. "discover this by hiring / funding / …"    — strategies[]
//
// Contract only. Nothing here makes GPT authoritative, changes precedence, or
// routes a strategy to an executor — those are the commits after this one. No
// network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_REQUESTED_COUNT, MISSION_STRATEGIES, effectiveRequestedCount,
  isMissionStrategy, parseLeadMissionDeterministic, validateLeadMission,
  type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { isCapabilityId } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

const ctx = (q: string) => ({ originalUserQuery: q, isCapabilityId });

// ===========================================================================
// 1. AN UNSTATED COUNT IS NULL, NOT A QUIET DEFAULT
// ===========================================================================

Deno.test("a request that states no count produces requested_count null", () => {
  // tight-01 from the eval set: names an ICP, a signal and a geography, no count.
  const m = parseLeadMissionDeterministic(
    "Find B2B SaaS companies hiring Revenue Operations, RevOps, or first sales in the United States.",
  );
  assertEquals(m.requested_count, null, "no count was asked for, so none is claimed");
  assertEquals(m.field_provenance["requested_count"], "system_default");
});

Deno.test("a request that states a count keeps it, attributed to the user", () => {
  const m = parseLeadMissionDeterministic("Find 30 early-stage SaaS companies in the US hiring SDRs");
  assertEquals(m.requested_count, 30);
  assertEquals(m.field_provenance["requested_count"], "explicit_user_request");
});

Deno.test("execution still gets a number — the default lives in one place", () => {
  const none = parseLeadMissionDeterministic("Find B2B SaaS companies hiring RevOps");
  assertEquals(none.requested_count, null);
  assertEquals(effectiveRequestedCount(none), DEFAULT_REQUESTED_COUNT);

  const stated = parseLeadMissionDeterministic("Find 30 SaaS companies hiring SDRs");
  assertEquals(effectiveRequestedCount(stated), 30, "a stated count is never overridden");
});

Deno.test("an explicit null is a statement, not a malformed number", () => {
  // The distinction that matters: null must NOT be 'repaired' into the base
  // reading, and must not raise a repair entry, or the contract silently
  // reacquires a count nobody asked for.
  const v = validateLeadMission(
    { requested_count: null, mission_type: "company_research", target_entity: "company",
      requested_output: "qualified_companies" },
    ctx("Find B2B SaaS companies hiring RevOps"),
  );
  assertEquals(v.mission.requested_count, null);
  assert(
    !v.repairs.some((r) => r.startsWith("requested_count_repaired")),
    `null must not be reported as repaired; got ${v.repairs.join(", ")}`,
  );

  // A genuinely malformed value still repairs.
  const bad = validateLeadMission(
    { requested_count: "not a number", mission_type: "company_research",
      target_entity: "company", requested_output: "qualified_companies" },
    ctx("Find 7 SaaS companies hiring RevOps"),
  );
  assert(bad.repairs.some((r) => r.startsWith("requested_count_repaired")));
});

// ===========================================================================
// 2. SOCIAL POSTS ARE SAYABLE
// ===========================================================================

Deno.test("social_posts is a requested output the contract accepts", () => {
  // R1's social-01 fixture had to record output_intent null BECAUSE THE
  // CONTRACT COULD NOT SAY THIS, and noted that choosing the nearest wrong
  // value is how an unexecutable request becomes a confident plan.
  const v = validateLeadMission(
    { requested_output: "social_posts", mission_type: "company_research",
      target_entity: "company", requested_count: 5 },
    ctx("Find 5 LinkedIn posts where founders complain about outbound problems"),
  );
  assert(
    !v.repairs.some((r) => r.startsWith("requested_output_repaired")),
    "social_posts must be accepted, not repaired away",
  );
});

// ===========================================================================
// 3. STRATEGIES — RESEARCH SHAPE, NOT PIPELINE ENTRY POINT
// ===========================================================================

Deno.test("the strategy vocabulary is the research-shape one, not the old taxonomy", () => {
  assertEquals(
    [...MISSION_STRATEGIES].sort(),
    ["funding", "hiring", "multi_signal", "news", "social", "supplied_company"],
  );
  // The retired execution-mode names must NOT reappear as strategies: they
  // describe which entity a pipeline touched first, not how an opportunity is
  // discovered and proven.
  for (const old of ["company_first", "person_first", "job_first", "person_social_first", "existing_list_first"]) {
    assert(!isMissionStrategy(old), `"${old}" must not be a strategy`);
  }
});

Deno.test("stated strategies survive validation", () => {
  const v = validateLeadMission(
    { strategies: ["funding", "hiring"], mission_type: "company_research",
      target_entity: "company", requested_output: "qualified_companies", requested_count: 3 },
    ctx("Find 3 AI SaaS companies recently funded hiring SDRs"),
  );
  assertEquals(v.mission.strategies, ["funding", "hiring"]);
});

Deno.test("an unroutable strategy is dropped and named, never passed through", () => {
  const v = validateLeadMission(
    { strategies: ["hiring", "telepathy"], mission_type: "company_research",
      target_entity: "company", requested_output: "qualified_companies", requested_count: 3 },
    ctx("Find 3 companies hiring SDRs"),
  );
  assertEquals(v.mission.strategies, ["hiring"]);
  assert(
    v.repairs.includes("unknown_strategy_dropped:telepathy"),
    "a dropped strategy must be named — silently planning work that cannot run is the failure",
  );
});

Deno.test("no strategies stated leaves the field absent, not an empty claim", () => {
  const m = parseLeadMissionDeterministic("Find 5 AI workflow companies in Europe");
  assertEquals(m.strategies, undefined, "absent means the model proposed none");
});

// ===========================================================================
// THE CONTRACT STILL HOLDS ITS EARLIER GUARANTEES
// ===========================================================================

Deno.test("the R1 constraint fields are unaffected by the R2 additions", () => {
  const v = validateLeadMission(
    {
      requested_count: null, strategies: ["social"], requested_output: "social_posts",
      mission_type: "company_research", target_entity: "company",
      no_broadening_requested: true, required_signal_terms: ["SDR"],
      prohibitions: ["send outreach"], geography_is_hard: true,
    },
    ctx("Find LinkedIn posts by founders. Do not send outreach."),
  );
  const m: LeadMissionV1 = v.mission;
  assertEquals(m.no_broadening_requested, true);
  assertEquals(m.required_signal_terms, ["SDR"]);
  assertEquals(m.prohibitions, ["send outreach"]);
  assertEquals(m.geography_is_hard, true);
  assertEquals(m.requested_count, null);
  assertEquals(m.strategies, ["social"]);
  // Still never taken from the candidate.
  assertEquals(m.original_user_query, "Find LinkedIn posts by founders. Do not send outreach.");
});
