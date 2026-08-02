// GEOGRAPHY ACTIVATION GATE — the lowercase `us` false positive.
//
// This is the defect that blocked enabling claude_first_lead_planning: the parser
// asserted "United States" for requests that explicitly named another country.
//
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inferGeography, mentionsUnitedStates } from "../../../supabase/functions/_shared/jobIntentTaxonomy.ts";

// ---- the pronoun ------------------------------------------------------------

Deno.test("G1.A lowercase `us` is a PRONOUN, never the United States", () => {
  for (const q of [
    "Show us founders in Germany",
    "Find us five leads in France",
    "Get us decision makers in Canada",
    "Send us SaaS companies hiring RevOps",
    "Can you find us some agencies in Australia",
    "us",
  ]) {
    assertFalse(mentionsUnitedStates(q), `"${q}" was read as the United States`);
    assertFalse(inferGeography(q).includes("United States"), `"${q}" resolved to United States`);
  }
});

Deno.test("G1.B a request naming ANOTHER country never resolves to the United States", () => {
  const cases: Array<[string, string]> = [
    ["Germany", "Find us manufacturers hiring their first salesperson in Germany"],
    ["France", "Show us healthcare companies hiring clinical operations leaders in France"],
    ["Canada", "Find us logistics companies in Canada"],
    ["India", "Get us renewable energy companies hiring grid engineers in India"],
    ["UK", "Show us MSSPs hiring sales leadership in the United Kingdom"],
    ["Brazil", "Find us logistics companies hiring regional sales directors in Brazil"],
    ["Australia", "Send us agencies hiring partnership leaders in Australia"],
  ];
  for (const [country, q] of cases) {
    const geo = inferGeography(q);
    assertFalse(geo.includes("United States"),
      `"${country}" request resolved to United States: ${JSON.stringify(geo)}`);
    // The parser is still US-only, so the honest answer is "nothing I understand".
    // What matters is that it does not INVENT a country the user did not name.
    assertEquals(geo, [], `${country} produced unexpected geography ${JSON.stringify(geo)}`);
  }
});

// ---- the unambiguous forms --------------------------------------------------

Deno.test("G2.A unambiguous United-States forms are still recognised", () => {
  for (const q of [
    "Find founders in the United States",
    "Find founders in the United States of America",
    "Find founders in the USA",
    "Find founders in the usa",
    "Find founders in the U.S.",
    "Find founders in the U.S.A.",
  ]) {
    assert(mentionsUnitedStates(q), `"${q}" was NOT recognised`);
    assertEquals(inferGeography(q), ["United States"], `"${q}"`);
  }
});

Deno.test("G2.B standalone UPPERCASE `US` is recognised from the original-case query", () => {
  for (const q of [
    "Find founders of SaaS startups in the US",
    "US-based SaaS companies hiring Sales Operations",
    "Show me US founders",
  ]) {
    assert(mentionsUnitedStates(q), `"${q}" was NOT recognised`);
    assertEquals(inferGeography(q), ["United States"], `"${q}"`);
  }
});

Deno.test("G2.C uppercase `US` inside another word is NOT a country", () => {
  for (const q of ["USB hardware vendors", "We use PLUS accounting", "BUSINESS operations leaders"]) {
    assertFalse(mentionsUnitedStates(q), `"${q}" was read as the United States`);
  }
});

Deno.test("G2.D in SHOUTED text uppercase `US` is not trusted — it may be the pronoun", () => {
  // Every word is uppercase, so case no longer distinguishes country from pronoun.
  assertFalse(mentionsUnitedStates("FIND US FOUNDERS IN GERMANY"),
    "all-caps text must not reintroduce the pronoun false positive");
  assertEquals(inferGeography("FIND US FOUNDERS IN GERMANY"), []);
  // An unambiguous form still works in shouted text.
  assert(mentionsUnitedStates("FIND FOUNDERS IN THE UNITED STATES"));
  assert(mentionsUnitedStates("FIND FOUNDERS IN THE USA"));
});

// ---- states still work ------------------------------------------------------

Deno.test("G3.A US states are still resolved and take precedence", () => {
  assertEquals(inferGeography("Automation integrators hiring controls engineers in Texas"), ["Texas"]);
  assertEquals(inferGeography("Find companies in California and Texas").sort(), ["California", "Texas"]);
  // A state named alongside "United States" yields the state, not the country.
  assertEquals(inferGeography("Find US companies in Texas"), ["Texas"]);
});

Deno.test("G3.B nothing is invented when no location is named", () => {
  assertEquals(inferGeography("Find founders of SaaS startups hiring Sales Operations"), []);
  assertEquals(inferGeography(""), []);
});

// ---- the primary query ------------------------------------------------------

Deno.test("G4.A the primary Phase 0 query still resolves to the United States", () => {
  assertEquals(
    inferGeography("Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads."),
    ["United States"],
  );
});
