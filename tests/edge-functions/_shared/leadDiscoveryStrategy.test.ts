// WHY THIS FILE EXISTS.
//
// Discovery ran a frozen pair of Y Combinator actors with a hardcoded input —
// `industries: ["B2B"], batch: ["All Batches"]` — identical for every mission
// the workflow has ever run. A request for AI startups and a request for
// manufacturers fetched the same YC page, and qualification was left to throw
// away whatever failed to match. A gate cannot qualify a company the pool never
// contained, so the pool is upstream of every other fix.
//
// `leadDiscoveryStrategy` lets the model choose the actors and shape their
// inputs. That is only safe because of what it REFUSES, and these tests are
// that refusal: an unregistered actor key is not callable, an actor registered
// for another purpose is not callable, a filter the live schema lacks is not
// sent, a value outside a verified enum is not sent, counts are clamped to
// published limits, and a proposal that survives none of it falls back to
// exactly today's behaviour.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_MAX_ACTORS,
  DISCOVERY_STRATEGY_VERSION,
  compileActorInput,
  blockedDiscoveryStrategy,
  discoveryCatalogBriefing,
  discoveryStrategyDiagnostics,
  shouldRunSelection,
  strategyActorKeys,
  validateDiscoveryStrategy,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

/** Enough of a mission for a strategy; the module reads the profile only. */
const MISSION = {
  version: "lead_mission_v1",
  original_user_query: "Find 10 qualified AI startups in the US hiring software engineers",
  requested_count: 10,
  company_profile: {
    business_models: [], verticals: ["artificial intelligence"], stages: ["startup"],
    locations: ["United States"], employee_range: { min: 5, max: 200 },
  },
  required_signals: [], decision_makers: { roles: [], current_employment_required: true },
  hard_constraints: {}, soft_preferences: {},
  required_capabilities: [], prohibited_capabilities: [],
  field_provenance: {}, confidence: 0.9,
} as unknown as LeadMissionV1;

Deno.test("1. an actor that is not in the catalog cannot be selected", () => {
  // The line that makes model-chosen sourcing safe to run: a key the catalog
  // does not know names nothing this system can call, and must never become a
  // paid run.
  const s = validateDiscoveryStrategy(
    [{ actor_key: "apify/some-actor-the-model-invented", role: "primary", input: {} }],
    MISSION,
  );
  assert(!strategyActorKeys(s).includes("apify/some-actor-the-model-invented"));
  // Nothing survived, so the run is BLOCKED rather than quietly redirected to
  // the YC scraper — which is what `deterministic_fallback` used to mean here.
  assertEquals(s.source, "blocked");
  assert(s.violations.some((v) => v.code === "unknown_actor"));
});

Deno.test("2. a registered actor for the wrong purpose cannot be selected", () => {
  // `apify_linkedin_company_details` is real, verified and callable — for
  // ENRICHMENT. Selecting it for discovery asks an actor to do a job it was
  // never verified for, which is how a staffing firm enters the funnel as a
  // software company.
  const s = validateDiscoveryStrategy(
    [{ actor_key: "apify_linkedin_company_details", role: "primary", input: {} }],
    MISSION,
  );
  assert(!strategyActorKeys(s).includes("apify_linkedin_company_details"));
  assert(s.violations.some((v) => v.code === "actor_not_for_discovery"));
});

Deno.test("3. a filter the live schema does not accept is dropped, with its reason", () => {
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const { input, dropped } = compileActorInput(
    card, { searchQuery: "Anthropic", fundingStage: "series-a" }, 100,
  );
  assertEquals(input.searchQuery, "Anthropic");
  assertEquals("fundingStage" in input, false, "an unsupported field must not be sent");
  assert(dropped.some((d) => d.field === "fundingStage"));
  // The reason must name what the actor DOES accept, or a dropped filter is
  // undebuggable from the record alone.
  assert(dropped.find((d) => d.field === "fundingStage")!.reason.includes("searchQuery"));
});

Deno.test("4. a value outside a verified enum is dropped", () => {
  // An enum is a closed set. A value outside it is not a near-miss the provider
  // interprets generously — it is a run that fails input validation after the
  // actor has started and been billed.
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const { input, dropped } = compileActorInput(
    card, { scraperMode: "exhaustive" }, 100,
  );
  assertEquals("scraperMode" in input, false);
  assert(dropped.some((d) => d.field === "scraperMode"));
});

Deno.test("5. a partly-valid enum keeps the valid values and reports the rest", () => {
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const valid = card.verified_enums.companySize[0];
  const { input, dropped } = compileActorInput(
    card, { companySize: [valid, "10000000+"] }, 100,
  );
  assertEquals(input.companySize, [valid]);
  assert(dropped.some((d) => d.field === "companySize"));
});

Deno.test("6. counts are clamped to the published limit, not dropped", () => {
  // The intent was legitimate and only the magnitude was not, so clamping is
  // the honest repair — dropping would silently discard a real instruction.
  const card = hiringActorCard("apify_linkedin_company_search")!;
  const limit = card.input_limits.locations as number;
  const many = Array.from({ length: limit + 5 }, (_, i) => `city-${i}`);
  const { input, dropped } = compileActorInput(card, { locations: many }, 100);
  assertEquals((input.locations as string[]).length, limit);
  assert(dropped.some((d) => d.field === "locations"));
});

Deno.test("7. the row ceiling is ours, and a numeric published maximum bounds it", () => {
  // The count field is read from `input_limits`, not `supported_filters` — NO
  // discovery actor lists its row cap as a filter, so gating on the filter list
  // sent an uncapped run to every one of them.
  const card = hiringActorCard("apify_linkedin_company_search")!;
  assertEquals(card.supported_filters.includes("maxItems"), false, "the premise of this test");

  const { input } = compileActorInput(card, {}, 100);
  assertEquals(input.maxItems, 100, "the budget's ceiling applies");

  const actorMax = card.input_limits.maxItems as number;
  const { input: huge } = compileActorInput(card, {}, actorMax + 10_000);
  assertEquals(huge.maxItems, actorMax, "never above the actor's published maximum");
});

Deno.test("7b. a non-numeric published limit is a caveat, not a bound", () => {
  // memo23 records maxItems as "PER start-URL / per filter run — NOT a global
  // cap": a note about what the cap MEANS, not a value to clamp against.
  // Treating it as a number would have produced NaN or an unbounded run.
  const card = hiringActorCard("apify_yc_companies_memo23")!;
  assertEquals(typeof card.input_limits.maxItems, "string", "the premise of this test");

  const { input } = compileActorInput(card, { mode: "companies" }, 250);
  assertEquals(input.maxItems, 250, "our own budget stands when the limit is prose");
});

Deno.test("8. a valid multi-actor proposal survives intact", () => {
  const s = validateDiscoveryStrategy([
    {
      actor_key: "apify_yc_companies_memo23", role: "primary",
      input: { mode: "companies", isHiring: true },
      rationale: "verified startup source with hiring state",
    },
    {
      actor_key: "apify_linkedin_company_search", role: "breadth",
      input: { searchQuery: "Anthropic" },
      rationale: "widens beyond YC",
    },
  ], MISSION);

  assertEquals(s.source, "model_validated");
  assertEquals(strategyActorKeys(s), [
    "apify_yc_companies_memo23", "apify_linkedin_company_search",
  ]);
  assertEquals(s.version, DISCOVERY_STRATEGY_VERSION);
});

Deno.test("9. every discovery actor needs enrichment, and the strategy says so", () => {
  // `requires_enrichment_before_qualification` marks an actor whose rows cannot
  // satisfy a Company Brain gate unaided. It is TRUE for every company_discovery
  // actor registered today — the YC sources included — so it cannot be a
  // condition on being primary without refusing every possible strategy.
  //
  // It is real information though, and it is the honest cost signal for the
  // pass: no candidate discovery produces can qualify without a further paid
  // enrichment call. That belongs in the record, not in a refusal.
  const s = validateDiscoveryStrategy([
    { actor_key: "apify_linkedin_company_search", role: "primary", input: {} },
  ], MISSION);

  assertEquals(s.selections.length, 1);
  assertEquals(s.selections[0].requires_enrichment, true);
  assertEquals(discoveryStrategyDiagnostics(s).all_require_enrichment, true);
});

Deno.test("10. a pass with no primary gets one, so something always runs", () => {
  // `breadth` stops once the pool is full and `fallback` runs only on an empty
  // one, so a strategy of those alone can legally execute nothing at all and
  // then report discovery complete over an empty pool.
  const s = validateDiscoveryStrategy([
    { actor_key: "apify_yc_companies_memo23", role: "breadth", input: { mode: "companies" } },
    { actor_key: "apify_linkedin_company_search", role: "breadth", input: {} },
  ], MISSION);

  assertEquals(s.source, "model_repaired");
  assertEquals(s.selections.filter((x) => x.role === "primary").length, 1);
  assert(s.violations.some((v) => v.code === "primary_promoted"));
});

Deno.test("11. the actor ceiling trims breadth and never the primary", () => {
  const proposals = [
    { actor_key: "apify_yc_companies_memo23", role: "primary", input: { mode: "companies" } },
    { actor_key: "apify_linkedin_company_search", role: "breadth", input: {} },
    { actor_key: "apify_yc_companies_solidcode", role: "fallback", input: {} },
  ];
  const s = validateDiscoveryStrategy(proposals, MISSION, { maxActors: 1 });

  assertEquals(s.selections.length, 1);
  assertEquals(s.selections[0].actor_key, "apify_yc_companies_memo23");
  assertEquals(s.selections[0].role, "primary");
  assert(s.violations.some((v) => v.code === "actor_ceiling"));
});

Deno.test("12. a duplicate actor is taken once", () => {
  const s = validateDiscoveryStrategy([
    { actor_key: "apify_yc_companies_memo23", role: "primary", input: { mode: "companies" } },
    { actor_key: "apify_yc_companies_memo23", role: "breadth", input: {} },
  ], MISSION);
  assertEquals(strategyActorKeys(s).filter((k) => k === "apify_yc_companies_memo23").length, 1);
  assert(s.violations.some((v) => v.code === "duplicate_actor"));
});

// ── INVERTED: GARBAGE BLOCKS, IT DOES NOT "STILL PRODUCE A RUNNABLE STRATEGY"
//
// The old claim — "the caller must never have to handle 'no strategy'" — is
// exactly why nobody ever handled it: every unreadable proposal produced a
// confident YC search instead. The validator is still TOTAL (it never throws),
// which is the part worth keeping; what changes is that its answer to garbage
// is now a refusal the caller must deal with.
Deno.test("13. garbage in any shape blocks, without throwing", () => {
  for (const bad of [null, undefined, 42, "actors", {}, [null], [42], [{}]]) {
    const s = validateDiscoveryStrategy(bad, MISSION);
    assertEquals(s.version, DISCOVERY_STRATEGY_VERSION, "still a well-formed record");
    assertEquals(s.source, "blocked", `must block for ${String(bad)}`);
    assertEquals(s.selections, [], "and select nothing");
    assert(s.violations.length > 0, "and say why");
  }
});

// ── REPLACED: `deterministicDiscoveryStrategy` IS DELETED ────────────────
//
// This asserted the fallback's shape — memo23 primary, solidcode fallback — so
// that "the worst case of model selection equals the current system" stayed
// true. That equality was the problem: the worst case answered every mission
// with the same YC page. There is no worst-case strategy any more, only a
// refusal.
Deno.test("14. a blocked strategy selects nothing and names the reason", () => {
  const s = blockedDiscoveryStrategy("no_discovery_selector", "no selector was supplied");
  assertEquals(s.source, "blocked");
  assertEquals(s.selections, []);
  assertEquals(s.violations[0].code, "no_discovery_selector");
  assertEquals(s.violations[0].severity, "block");
});

Deno.test("15. a fallback runs only on an empty pool; breadth stops once full", () => {
  const s = validateDiscoveryStrategy([
    { actor_key: "apify_yc_companies_memo23", role: "primary", input: { mode: "companies" } },
    { actor_key: "apify_linkedin_company_search", role: "breadth", input: {} },
    { actor_key: "apify_yc_companies_solidcode", role: "fallback", input: {} },
  ], MISSION, { maxActors: 3 });

  const primary = s.selections.find((x) => x.role === "primary")!;
  const breadth = s.selections.find((x) => x.role === "breadth")!;
  const fallback = s.selections.find((x) => x.role === "fallback")!;

  assertEquals(shouldRunSelection(primary, 0, 100), true);
  assertEquals(shouldRunSelection(primary, 500, 100), true, "the primary always runs");

  assertEquals(shouldRunSelection(fallback, 0, 100), true, "empty pool: the fallback earns its call");
  assertEquals(shouldRunSelection(fallback, 1, 100), false, "one row is enough to skip it");

  assertEquals(shouldRunSelection(breadth, 10, 100), true);
  assertEquals(shouldRunSelection(breadth, 100, 100), false, "no widening an already-full pool");
});

Deno.test("16. the briefing shows capability and failure modes, never an actor id", () => {
  // The model has no field in which to name `memo23/y-combinator-scraper`, so
  // it cannot ask for an unregistered actor even by accident. And it must see
  // `not_for` and `known_defects`, or it will keep choosing an actor for the
  // thing it is worst at.
  const briefing = discoveryCatalogBriefing();
  assert(briefing.length > 0);
  const text = JSON.stringify(briefing);
  assert(!text.includes("memo23/"), "no raw actor id may reach the selector");
  assert(!text.includes("harvestapi/"), "no raw actor id may reach the selector");

  for (const entry of briefing) {
    for (const field of ["actor_key", "supported_filters", "verified_enums",
      "input_limits", "not_for", "known_defects",
      "requires_enrichment_before_qualification"]) {
      assert(field in entry, `the briefing must carry ${field}`);
    }
    assertEquals("actor_id" in entry, false);
  }
});

Deno.test("17. every briefed actor is genuinely registered for discovery", () => {
  for (const entry of discoveryCatalogBriefing()) {
    const card = hiringActorCard(String(entry.actor_key))!;
    assert(card, `${entry.actor_key} must resolve in the catalog`);
    assert(card.purposes.includes("company_discovery"));
  }
});

// ── REVERSED DELIBERATELY, 2026-08-17 ──────────────────────────────────────
//
// This test used to assert `"input" in first === false`: field NAMES only, to
// keep the payload out of every persisted task result. That was a defensible
// size trade-off and it turned out to be the wrong one.
//
// Auditing the run of 2026-08-17 required answering "where did
// `industries: ['B2B']` come from?", and with only field names on the record
// the answer had to be reconstructed by diffing the live Apify input against
// the hardcoded literals in `leadCapabilityEngine` and arguing that an exact
// match implied the deterministic branch. The record could not distinguish
// "the model chose this" from "the model was never asked".
//
// The size worry does not survive contact with the numbers: a compiled actor
// input is a few dozen scalar fields, and `DEFAULT_MAX_ACTORS` is 3. That is
// kilobytes on a row that already carries provider payloads measured in
// megabytes. Being unable to explain a run is the more expensive failure.
Deno.test("18. diagnostics record the decision AND the payload that was sent", () => {
  const s = validateDiscoveryStrategy([
    { actor_key: "apify_yc_companies_memo23", role: "primary", input: { mode: "companies" } },
    { actor_key: "apify_linkedin_company_search", role: "breadth", input: { bogus: 1 } },
  ], MISSION);
  const d = discoveryStrategyDiagnostics(s);

  assertEquals(d.source, "model_repaired");
  assertEquals((d.actors as unknown[]).length, 2);
  assert(Number(d.repaired) > 0, "a dropped filter must be counted");
  // Field names stay — they are the quick scan — but the VALUES are now the
  // point: a run must be able to say what it actually sent to the provider.
  const first = (d.actors as Array<Record<string, unknown>>)[0];
  assert(Array.isArray(first.input_fields));
  assertEquals("input" in first, true, "the compiled input must be on the record");
  assertEquals((first.input as Record<string, unknown>).mode, "companies");
  // And WHO decided, in one boolean, without parsing the source enum.
  assertEquals(d.model_chosen, true);
});

Deno.test("19. the default ceiling leaves room for breadth beyond the primary pair", () => {
  // The whole point of the change is that a mission can reach past YC. A
  // ceiling of two would make that impossible while still passing every other
  // test here.
  assert(DEFAULT_MAX_ACTORS >= 3, "a primary, a breadth source and a fallback must all fit");
});
