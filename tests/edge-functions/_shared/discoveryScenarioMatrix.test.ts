// WHY THIS FILE EXISTS.
//
// The matrix's job is to stop the planner proposing things that cannot work.
// Its most valuable entries are the ones with NO Actors — because verification
// against the live Apify Store contradicted the plan for four scenarios, and a
// planner that cannot see what is impossible will keep proposing it while the
// user keeps receiving confident empty results.
//
// So these tests pin the blocks and their reasons as hard as they pin the
// working paths: an Actor that consumes domains must never appear in a
// discovery scenario, a scenario with no Actor must say why, and every Store id
// the matrix names must resolve in the registry.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  SCENARIO_MATRIX, blockedScenarios, scenario, scenarioActors, scenarioBriefing,
  scenarioIsServable, unmetCapabilities, unresolvedIntelligenceIds,
} from "../../../supabase/functions/_shared/discoveryScenarioMatrix.ts";
import { actorIntelligence } from "../../../supabase/functions/_shared/apifyIntelligenceRegistry.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

Deno.test("1. every Actor the matrix names actually exists", () => {
  // The matrix spans two naming systems — the repo's capability keys and Store
  // ids. A typo in either is a scenario that fails only when someone finally
  // runs it.
  assertEquals(unresolvedIntelligenceIds(), [], "unresolved Store ids");

  for (const s of Object.values(SCENARIO_MATRIX)) {
    for (const id of scenarioActors(s)) {
      const resolved = id.includes("/") ? actorIntelligence(id) : hiringActorCard(id);
      assert(resolved, `${s.id} names "${id}", which resolves in neither registry`);
    }
  }
});

Deno.test("2. technology-stack DISCOVERY is blocked, and says why", () => {
  // The headline verification finding. BuiltWith's live schema has exactly two
  // fields — `startDomains` and `maxRequestsPerCrawl`. There is no query and no
  // reverse lookup, so "find companies using Shopify" has no Actor.
  const s = scenario("technology_stack_discovery")!;
  assertEquals(s.preferred_actors, []);
  assertEquals(s.fallback_actors, []);
  assertEquals(scenarioIsServable(s), false);
  assert(s.blocked_reason, "a blocked scenario must carry its reason");
  assert(/reverse lookup/i.test(s.blocked_reason!));

  // And the reason must point at what IS possible, or the user is only told no.
  assert(/verify/i.test(s.blocked_reason!),
    "the block must name the reachable alternative");
});

Deno.test("3. technology VERIFICATION is servable, on a known domain", () => {
  // The same Actor, asked the question it can answer. This pair is the whole
  // discovery/enrichment distinction in one place.
  const s = scenario("technology_stack_verification")!;
  assertEquals(scenarioIsServable(s), true);
  assertEquals(s.preferred_actors, ["builtwith/builtwith-official-technology-scraper"]);
  assert(/domain must already be known/i.test(s.minimum_evidence));
});

Deno.test("4. no domain- or URL-fed Actor appears in a discovery scenario", () => {
  // The boundary, enforced across the whole matrix rather than one entry.
  // An Actor that must be given the things it reads cannot start a search.
  const DISCOVERY_SCENARIOS = [
    "startup_discovery", "yc_startup_discovery", "b2b_company_discovery",
    "saas_company_discovery", "company_size_discovery", "geographic_discovery",
    "market_industry_discovery", "competitor_discovery",
  ] as const;

  for (const id of DISCOVERY_SCENARIOS) {
    const s = scenario(id)!;
    for (const actorId of [...s.preferred_actors, ...s.fallback_actors]) {
      if (!actorId.includes("/")) continue;
      const rec = actorIntelligence(actorId)!;
      assert(rec.input_entities.includes("query"),
        `${id} would run ${actorId}, which consumes ${rec.input_entities.join(", ")}`);
    }
  }
});

Deno.test("5. funding AMOUNT is blocked by the cookie gate", () => {
  // Verified from the Store schema, not assumed: the amount, announced date and
  // investors unlock only in "LOGGED-IN MODE" with a session cookie pasted from
  // a browser, and anonymous mode is vendor-described as "signal-only".
  const s = scenario("funding_amount")!;
  assertEquals(s.preferred_actors, []);
  assertEquals(scenarioIsServable(s), false);
  assert(/cookie/i.test(s.blocked_reason!));

  // A LESSER ANSWER IS STILL AN ANSWER. News can mention a figure, so the
  // fallback is not empty — and the planner must be able to tell "there is a
  // lesser answer" from "there is none".
  assert(s.fallback_actors.length > 0);
  assert(/raised recently/i.test(s.blocked_reason!),
    "the block must name what CAN be answered instead");
});

Deno.test("6. recent funding as a SIGNAL is servable", () => {
  // The distinction that makes the block above useful rather than merely
  // discouraging: "raised recently" is answerable, "raised $X" is not.
  const s = scenario("recent_funding")!;
  assertEquals(scenarioIsServable(s), true);
  assert(s.preferred_actors.includes("memo23/crunchbase-scraper"));
  assert(/signal-only/i.test(s.minimum_evidence));
});

Deno.test("7. product launches are blocked on adoption and a credential", () => {
  const s = scenario("product_launches")!;
  assertEquals(scenarioIsServable(s), false);
  assert(/API token/i.test(s.blocked_reason!));
  assert(/20 lifetime users/i.test(s.blocked_reason!),
    "the block must carry the evidence, not just the verdict");
});

Deno.test("8. exactly the verified-impossible scenarios are blocked", () => {
  // Pinning the SET, so a future scenario cannot be quietly blocked to make a
  // failing planner test pass — nor a real block quietly removed.
  const ids = blockedScenarios().map((s) => s.id).sort();
  assertEquals(ids, [
    "competitor_technology_adoption",
    "funding_amount",
    "product_launches",
    "technology_stack_discovery",
  ]);
});

Deno.test("9. every scenario states its minimum evidence and freshness", () => {
  // A scenario without an evidence bar cannot refuse anything, which is how
  // "relevant" becomes "qualified".
  for (const s of Object.values(SCENARIO_MATRIX)) {
    assert(s.minimum_evidence.length > 20, `${s.id} needs a real evidence bar`);
    assert(s.required_capabilities.length > 0, `${s.id} needs required capabilities`);
    assert(
      ["any", "within_month", "within_week", "current"].includes(s.freshness_requirement),
      `${s.id} has an unknown freshness requirement`);
  }
});

Deno.test("10. no scenario requires a capability nothing can produce", () => {
  // Different from being blocked: a blocked scenario has Actors for its
  // capabilities but none that can be combined into an answer. A scenario
  // needing a capability NO registered Actor has is a spec error.
  for (const s of Object.values(SCENARIO_MATRIX)) {
    assertEquals(unmetCapabilities(s), [],
      `${s.id} requires a capability no registered Actor produces`);
  }
});

Deno.test("11. hiring scenarios need a role, never a post, as proof", () => {
  // A post saying "we're hiring!" is intent. It may prioritise a company; it
  // may never satisfy the gate. Getting this backwards is how a pipeline
  // reports qualified companies that are not hiring.
  for (const id of ["hiring_engineers", "hiring_salespeople", "hiring_sdrs",
    "hiring_executives"] as const) {
    const s = scenario(id)!;
    assert(s.required_capabilities.includes("hiring_signal"));
    assert(/corroboration, never proof/i.test(s.minimum_evidence), `${id}`);
    // The post Actors are present, but only as corroboration.
    assert(s.corroborating_actors.includes("harvestapi/linkedin-post-search"));
    assertEquals(s.preferred_actors.includes("harvestapi/linkedin-post-search"), false);
  }

  const founderIntent = scenario("founder_hiring_signals")!;
  assert(/never satisfy a hiring gate/i.test(founderIntent.minimum_evidence));
});

Deno.test("12. scenarios needing a resolved identity say so", () => {
  // These Actors consume URLs. Sequencing them before identity resolution is a
  // paid call with nothing to pass it.
  for (const id of ["company_linkedin_activity", "founder_linkedin_activity"] as const) {
    const s = scenario(id)!;
    assert(/identity/i.test(s.minimum_evidence), `${id} must state the ordering`);
    for (const actorId of s.preferred_actors) {
      const rec = actorIntelligence(actorId)!;
      assertEquals(rec.input_entities.includes("query"), false,
        `${actorId} consumes URLs, which is why the ordering matters`);
    }
  }
});

Deno.test("13. size and industry scenarios demand enrichment, not provider tags", () => {
  // Both discovery sources report these as self-declared or unreliable. The
  // LinkedIn company search's own size filter disagreed with reality in four of
  // eight observed rows, and its industry field returned a staffing firm for a
  // software query.
  for (const id of ["company_size_discovery", "b2b_company_discovery",
    "market_industry_discovery", "saas_company_discovery"] as const) {
    const s = scenario(id)!;
    assert(s.required_capabilities.includes("company_enrichment"), `${id}`);
    assert(/enrich/i.test(s.minimum_evidence), `${id} must demand enriched evidence`);
  }
});

Deno.test("14. competitor discovery records the name-vs-concept trap", () => {
  // The LinkedIn company search matches company NAMES. A conceptual query
  // returns a successful empty run, so the cost is real and the failure silent.
  const s = scenario("competitor_discovery")!;
  assert(/NAMES, not concepts/i.test(s.minimum_evidence));
  assertEquals(scenarioIsServable(s), true);
});

Deno.test("15. the briefing shows the impossible as well as the possible", () => {
  const briefing = scenarioBriefing();
  assertEquals(briefing.length, Object.keys(SCENARIO_MATRIX).length);

  const blocked = briefing.filter((b) => b.servable === false);
  assertEquals(blocked.length, 4);
  for (const b of blocked) {
    assert(b.blocked_reason, `${b.scenario} must carry its reason into the briefing`);
  }
  // And every servable entry must actually name something to run.
  for (const b of briefing.filter((x) => x.servable === true)) {
    assert((b.preferred_actors as string[]).length > 0, `${b.scenario}`);
  }
});

Deno.test("16. job-growth is honest about needing history nothing stores", () => {
  // A single snapshot shows hiring, not growth. Nothing registered keeps
  // history, so this is only answerable across repeated runs.
  const s = scenario("job_growth_signal")!;
  assert(/two points in time/i.test(s.minimum_evidence));
  assert(/repeated runs/i.test(s.minimum_evidence));
});
