// TWO GATES THAT REFUSED EVERYONE, AND THE RULE BOTH BROKE.
//
// ── WHAT THEY HAD IN COMMON ─────────────────────────────────────────────────
//
// Each treated "I cannot evaluate this" as "this fails", and each did it
// silently, at a gate, before anything downstream could reconsider.
//
//   GEOGRAPHY   `geographyContradicts` matched by substring against a two-entry
//               alias map. A continent is not a token any country string
//               contains, so ("Berlin, Germany", ["Europe"]) read as a
//               CONTRADICTION. The mission compiler emits "Europe" literally
//               from GEO_MARKERS and nothing expands it, so the flagship
//               benchmark — "cybersecurity companies IN EUROPE …" — dropped
//               Berlin, London, Paris and Amsterdam. Every company, on a
//               mission that could then never return a lead.
//
//   NAMED COHORT `missionNeedsSemanticDiscovery` looked for `known_companies`
//               at the top level of the mission. It lives under
//               `company_profile`, and every other reader in the codebase uses
//               that path. So the escape hatch never opened: a mission that
//               NAMED its companies still read as a concept search, and the
//               `not_for: "semantic/concept search"` guard blocked the
//               company-NAME matcher that is exactly right for it.
//
// PURE. No network, provider, model or database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  geographyContradicts,
} from "../../../supabase/functions/_shared/leadEligiblePool.ts";
import {
  missionNeedsSemanticDiscovery, declaresUnfitForSemantic,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  hiringActorCard,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

const FLAGSHIP =
  "Find 15 cybersecurity companies in Europe hiring enterprise sellers and " +
  "whose leadership has recently posted about US expansion.";

// ═══════════════ 1. THE FLAGSHIP MISSION, END TO END ═══════════════════════

Deno.test("1. THE REGRESSION: a European mission keeps European companies", () => {
  const m = parseLeadMissionDeterministic(FLAGSHIP);

  // The compiler really does emit the continent, unexpanded. This is asserted
  // rather than assumed, because the fix would be pointless if some later stage
  // were already expanding it — and the bug only existed because nothing was.
  assertEquals(m.company_profile.locations, ["Europe"]);

  const kept = [
    "Berlin, Germany", "London, United Kingdom", "Paris, France",
    "Amsterdam, Netherlands", "Stockholm, Sweden", "Dublin, Ireland",
    "Zurich, Switzerland", "Madrid, Spain", "Milan, Italy",
  ];
  for (const geo of kept) {
    assertFalse(geographyContradicts(geo, m.company_profile.locations),
      `${geo} is in Europe and was dropped from a European mission`);
  }

  // AND THE GATE STILL GATES. A fix that made everything pass would be worse
  // than the bug: the constraint the user stated would simply stop existing.
  for (const geo of ["San Francisco, CA, USA", "Toronto, Canada",
                     "Sydney, Australia", "Bangalore, India"]) {
    assert(geographyContradicts(geo, m.company_profile.locations),
      `${geo} is not in Europe and must still be dropped`);
  }
});

Deno.test("2. regions resolve to members; countries still resolve to themselves", () => {
  const cases: Array<[string, string[], boolean]> = [
    // region → member
    ["Oslo, Norway", ["Nordics"], false],
    ["Copenhagen, Denmark", ["Nordics"], false],
    ["Berlin, Germany", ["Nordics"], true],
    ["Vienna, Austria", ["DACH"], false],
    ["Sydney, Australia", ["APAC"], false],
    ["Singapore", ["APAC"], false],
    ["Austin, TX, USA", ["North America"], false],
    ["Toronto, Canada", ["North America"], false],
    ["Tel Aviv, Israel", ["EMEA"], false],
    ["São Paulo, Brazil", ["LATAM"], false],
    // country → itself, unchanged behaviour
    ["Munich, Germany", ["Germany"], false],
    ["San Francisco, CA, USA", ["United States"], false],
    ["Berlin, Germany", ["United States"], true],
    // several requirements: satisfying ANY of them is enough
    ["Berlin, Germany", ["United States", "Europe"], false],
  ];
  for (const [est, req, want] of cases) {
    assertEquals(geographyContradicts(est, req), want,
      `${est} vs ${JSON.stringify(req)}`);
  }
});

Deno.test("3. an UNRECOGNISED requirement cannot contradict anything", () => {
  // THE RULE THAT STOPS A SEQUEL. The Europe failure was not a missing
  // continent, it was a matcher that read "I cannot evaluate this" as "this
  // fails". A city, a state or a region nobody enumerated must not silently
  // empty the pool the way "Europe" did.
  for (const req of ["Rhineland", "Bay Area", "Benelux-ish", "Greater Tokyo"]) {
    assertFalse(geographyContradicts("Berlin, Germany", [req]),
      `an unrecognised requirement (${req}) must not drop a company`);
  }
  // And the pre-existing unknown-side rule is untouched.
  assertFalse(geographyContradicts(null, ["United States"]));
  assertFalse(geographyContradicts("Berlin, Germany", []));
  assertFalse(geographyContradicts("   ", ["United States"]));
});

Deno.test("4. matching is whole-word — 'us' does not live inside 'Australia'", () => {
  // A substring matcher answers "Australia contains us" and quietly keeps an
  // Australian company on a United States mission. Every alias here is short
  // enough for this to matter: us, eu, uk.
  assert(geographyContradicts("Perth, Australia", ["United States"]));
  assert(geographyContradicts("Prussia", ["United States"]));
  assert(geographyContradicts("Seoul, Korea", ["United Kingdom"]));
  // …while the real abbreviations still match.
  assertFalse(geographyContradicts("Austin, TX, US", ["United States"]));
  assertFalse(geographyContradicts("Berlin, EU", ["Europe"]));
});

// ═══════════════ 5-7. THE NAMED-COHORT ESCAPE HATCH ════════════════════════

const namedMission = (names: string[]): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(
    "Find founders of SaaS startups hiring software engineers. Return 5 leads.");
  return {
    ...m,
    company_profile: { ...m.company_profile, known_companies: names },
  };
};

Deno.test("5. a mission that NAMES its companies is not a semantic search", () => {
  // `known_companies` lives under `company_profile`. Read from the top level it
  // is always undefined, so this returned true no matter what the user named.
  const named = namedMission(["Vaultline", "Harbor Metrics", "Nimbus Ledger"]);
  assertEquals(named.company_profile.known_companies?.length, 3);
  assertFalse(missionNeedsSemanticDiscovery(named),
    "a mission naming three companies is a named-cohort search, not a concept one");
});

Deno.test("6. a CONCEPT mission still blocks the name matcher", () => {
  // The guard exists for a real failure: on 2026-08-17 (task e01dbd5b) the
  // mission was "AI startups", GPT chose the LinkedIn company search, and it
  // returned `AI Central`, `Startup San Diego`, `AWS AI` and `NVIDIA AI`. Two of
  // twenty were plausibly companies. Fixing the escape hatch must not open that.
  const concept = parseLeadMissionDeterministic(
    "Find founders of SaaS startups hiring software engineers. Return 5 leads.");
  assertEquals(concept.company_profile.known_companies ?? [], []);
  assert(missionNeedsSemanticDiscovery(concept),
    "a mission with concept terms and no named companies IS a semantic search");

  // And the actor it guards really does declare itself unfit — so the pairing
  // that produced the block is still live.
  const card = hiringActorCard("apify_linkedin_company_search");
  assert(card, "the company-search card must exist");
  assert(declaresUnfitForSemantic(card!),
    "apify_linkedin_company_search must still declare not_for semantic search");
});

Deno.test("7. an empty or malformed known_companies is not a named cohort", () => {
  // An empty array is not a statement that companies were named, and reading it
  // as one would disable the guard for every mission that merely carries the key.
  assert(missionNeedsSemanticDiscovery(namedMission([])));

  const malformed = {
    ...parseLeadMissionDeterministic(
      "Find founders of SaaS startups hiring software engineers. Return 5 leads."),
    company_profile: {
      ...parseLeadMissionDeterministic("Find SaaS startups. Return 5 leads.").company_profile,
      known_companies: "Vaultline" as unknown as string[],
    },
  } as LeadMissionV1;
  assert(missionNeedsSemanticDiscovery(malformed),
    "a non-array must not be read as a named cohort");
});
