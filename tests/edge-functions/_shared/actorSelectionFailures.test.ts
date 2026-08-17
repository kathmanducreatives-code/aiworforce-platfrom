// THE TEN WAYS ACTOR SELECTION MAY FAIL, AND WHAT EACH MUST DO.
//
// Every one of these used to end the same way: the proposal was discarded and
// `deterministicDiscoveryStrategy` ran, which meant Y Combinator filtered to
// `industries: ["B2B"]`. A model that invented an actor, a model that timed
// out, and a model that deliberately chose YC produced identical runs.
//
// On 2026-08-17 that is what answered "Find 10 qualified AI startups in the
// United States that are currently hiring software engineers": 100 YC B2B
// companies, 30 investigated, 0 qualified. Nothing errored.
//
// This file is the inverse of that behaviour, case by case.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateDiscoveryStrategy, strategyActorKeys, compileActorInput,
  blockedDiscoveryStrategy, DiscoveryStrategyBlockedError,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { makeGptDiscoveryPlanner } from "../../../supabase/functions/_shared/gptDiscoveryPlanner.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const MISSION = {
  version: "lead_mission_v1",
  original_user_query:
    "Find 10 qualified AI startups in the United States that are currently hiring software engineers.",
  requested_count: 10,
  company_profile: {
    business_models: [], verticals: ["artificial intelligence"], stages: ["startup"],
    locations: ["United States"], employee_range: { min: null, max: null },
  },
  required_signals: [{ type: "hiring", role_families: ["engineering"] }],
  decision_makers: { roles: [], current_employment_required: true },
  hard_constraints: {}, soft_preferences: {},
  required_capabilities: [], prohibited_capabilities: [],
  field_provenance: {}, confidence: 0.9,
} as unknown as LeadMissionV1;

const YC = "apify_yc_companies_memo23";

/** Every path must satisfy this. Stated once, asserted in each case. */
function neverFallsBackToYc(s: ReturnType<typeof validateDiscoveryStrategy>) {
  if (s.source === "blocked") {
    assertEquals(s.selections, [], "a blocked strategy selects nothing at all");
    assertFalse(strategyActorKeys(s).includes(YC), "and certainly not YC");
  }
}

Deno.test("1. an actor that is not in the registry blocks the run", () => {
  const s = validateDiscoveryStrategy(
    [{ actor_key: "harvestapi/invented-scraper", role: "primary", input: {} }], MISSION);
  assertEquals(s.source, "blocked");
  assert(s.violations.some((v) => v.code === "unknown_actor"));
  neverFallsBackToYc(s);
});

Deno.test("2. an unsupported filter is rejected, and named", () => {
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const { input, dropped } = compileActorInput(
    card, { searchQuery: "Anthropic", fundingStage: "series-a" }, 50);
  assertFalse("fundingStage" in input, "a field the schema lacks must not be sent");
  assert(dropped.some((d) => d.field === "fundingStage"));
});

Deno.test("3. an invalid enum value is rejected", () => {
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const { input, dropped } = compileActorInput(card, { scraperMode: "exhaustive" }, 50);
  assertFalse("scraperMode" in input);
  assert(dropped.some((d) => d.field === "scraperMode"));
});

Deno.test("4. a count above the actor's published limit is clamped, not sent", () => {
  // Clamped rather than blocked: the intent was legitimate and only the
  // magnitude was not. Dropping it would discard a real instruction.
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const max = card.input_limits.maxItems as number;
  const { input } = compileActorInput(card, {}, max + 10_000);
  assertEquals(input.maxItems, max);
});

Deno.test("5. an actor registered for another purpose cannot be selected", () => {
  // `apify_linkedin_company_details` is real, verified and callable — for
  // ENRICHMENT. Using it to DISCOVER asks it for a job it was never verified
  // for, which is how a staffing firm enters the funnel as a software company.
  const s = validateDiscoveryStrategy(
    [{ actor_key: "apify_linkedin_company_details", role: "primary", input: {} }], MISSION);
  assert(s.violations.some((v) => v.code === "actor_not_for_discovery"));
  assertFalse(strategyActorKeys(s).includes("apify_linkedin_company_details"));
  neverFallsBackToYc(s);
});

Deno.test("6. malformed model output blocks — after the provider's own repair", async () => {
  // `gptProvider` sends `strict: true`, so the API enforces the schema before
  // anything reaches here; unparseable content is already a failure by the time
  // the planner sees it. What must not happen is that failure becoming a pool.
  let calls = 0;
  const planner = makeGptDiscoveryPlanner({
    readEnv: () => "sk-test",
    fetch: () => {
      calls++;
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: "{ this is not json" } }],
        })),
      });
    },
  });

  const proposal = await planner({ payload: {}, mission_hash: "h" } as never);
  assertEquals(proposal, null, "an unreadable answer is not a proposal");
  assert(calls >= 1);

  // And a null proposal reaching the validator blocks rather than defaulting.
  const s = validateDiscoveryStrategy(proposal, MISSION);
  assertEquals(s.source, "blocked");
  neverFallsBackToYc(s);
});

Deno.test("7. GPT unavailable blocks the run", async () => {
  const planner = makeGptDiscoveryPlanner({ readEnv: () => undefined });
  const proposal = await planner({ payload: {}, mission_hash: "h" } as never);
  assertEquals(proposal, null, "no credential is not a reason to search something else");

  const s = validateDiscoveryStrategy(proposal, MISSION);
  assertEquals(s.source, "blocked");
  neverFallsBackToYc(s);
});

Deno.test("8. a proposal where nothing survives validation blocks", () => {
  const s = validateDiscoveryStrategy([
    { actor_key: "apify/one-invented", role: "primary", input: {} },
    { actor_key: "apify/two-invented", role: "breadth", input: {} },
  ], MISSION);
  assertEquals(s.source, "blocked");
  assert(s.violations.some((v) => v.code === "no_valid_selection"));
  neverFallsBackToYc(s);
});

Deno.test("9. NO failure path anywhere produces a YC selection", () => {
  // The single property this whole commit exists to establish, swept across
  // every shape of bad input at once.
  for (
    const bad of [
      null, undefined, 42, "actors", {}, [], [null], [42], [{}],
      [{ actor_key: "" }], [{ actor_key: "apify/nope", role: "primary" }],
      { actors: "everything" }, { actors: [] },
    ]
  ) {
    const s = validateDiscoveryStrategy(bad, MISSION);
    assertEquals(s.source, "blocked", `must block for ${JSON.stringify(bad)}`);
    assertFalse(
      strategyActorKeys(s).includes(YC),
      `YC must never appear from a failure path: ${JSON.stringify(bad)}`,
    );
  }
});

Deno.test("10. the blocked error states that nothing was substituted", () => {
  // The message is what a user or an on-call engineer reads. It has to rule out
  // the thing that used to happen silently.
  const s = blockedDiscoveryStrategy("no_discovery_selector", "no selector was supplied");
  const e = new DiscoveryStrategyBlockedError(s.violations);
  assert(e instanceof Error);
  assertEquals(e.name, "DiscoveryStrategyBlockedError");
  assert(/No deterministic strategy was substituted/i.test(e.message));
  assert(/no provider work was scheduled/i.test(e.message));
  assert(e.message.includes("no_discovery_selector"), "and names the specific cause");
});

Deno.test("11. a valid multi-actor proposal is allowed through intact", () => {
  // The negative control: if every proposal blocked, tests 1–10 would pass on a
  // validator that refuses everything, which would be a different bug.
  const s = validateDiscoveryStrategy([
    {
      actor_key: YC, role: "primary",
      input: { mode: "companies", queries: ["AI"] },
      rationale: "YC covers early-stage US startups and carries hiring state",
    },
    {
      // NOT the LinkedIn name matcher: this MISSION is a concept cohort
      // ("AI startups"), and that actor declares itself `not_for`
      // semantic/concept search — so it is now correctly refused here. Using it
      // as the multi-actor control would have asserted the very defect this
      // file exists to prevent.
      actor_key: "apify_yc_companies_solidcode", role: "fallback",
      input: {},
      rationale: "a second registered startup source",
    },
  ], MISSION);

  assertEquals(s.source === "blocked", false, "a good proposal must not block");
  assertEquals(strategyActorKeys(s).length, 2, "multi-actor strategies are supported");
  assertEquals(s.selections[0].rationale.length > 0, true, "the reason is carried");
});
