// Before/after regression for the country-blind location gate (live Q1
// q1-success-path-20260714T155551Z). BEFORE: a genuine US profile whose location
// text is a US city ("Greater Philadelphia") was rejected vs "United States".
// AFTER: with the provider's structured country evidence threaded through, the
// gate accepts it; a genuinely UK profile is rejected as wrong country; a US city
// string WITHOUT structured country is honestly "missing location evidence"
// (never falsely "wrong location"). Uses the production classifier + validator.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResults } from "./sourceQuality.ts";
import { validateSourcingResults } from "./sourcingRetry.ts";
import {
  MAPPED_LOCATION_A,
  MAPPED_LOCATION_C,
  REQUIRED_US,
  FROZEN_Q1_LOCATION_FACTS,
} from "./peopleLocationFixture.ts";

const crit = (location: string) => ({ requested: 5, role: null, location, source_type: "people_profiles" });
const STRICT = { location: true, industry: false, stage: false, count_exact: false };
// A SourcedItem as mapItem now produces it: human-readable string + structured country.
const personStructured = (name: string, location: string, country: string, code: string) => ({
  name, location, location_country: country, location_country_code: code,
  source_url: `https://linkedin.com/in/${name.replace(/\s+/g, "").toLowerCase()}`,
});

Deno.test("fix: US 'Greater Philadelphia' + parsed country United States is ACCEPTED vs 'United States'", () => {
  const res = classifyResults([personStructured("Alex Founder", MAPPED_LOCATION_A, "United States", "US")], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 1);
  assertEquals(res.rejected.length, 0);
});

Deno.test("fix: the actual accept path (validateSourcingResults) keeps the US city profile", () => {
  const kept = validateSourcingResults([personStructured("Sam Bay", "San Francisco Bay Area", "United States", "US")], crit(REQUIRED_US), STRICT);
  assertEquals(kept.length, 1);
});

Deno.test("fix: a genuinely UK profile ('Greater London' + United Kingdom) is rejected as wrong country", () => {
  const res = classifyResults([personStructured("Liam London", MAPPED_LOCATION_C, "United Kingdom", "GB")], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 0);
  assertEquals(res.rejected[0]?.reason, "wrong country (strict)");
});

Deno.test("fix: an UNRESOLVABLE location string is honest 'missing location evidence', not 'wrong location'", () => {
  // CONTRACT NARROWED (production task bb1ce7fe). This case used to assert that
  // ANY city string without a structured country was "missing evidence" — which
  // also rejected "Dallas, TX" and every other US city/state job, killing the
  // company-first funnel before enrichment.
  //
  // Reviewed subnational and metro evidence (a US state code, a state name, a
  // named metro) now resolves a country on its own. What stays "missing" is a
  // string carrying no reviewed geography at all, which is what this now pins.
  const res = classifyResults([{ name: "No Country", location: "Remote", source_url: "https://linkedin.com/in/nc" }], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 0);
  assertEquals(res.rejected[0]?.reason, "missing location evidence (strict)");
});

Deno.test("fix: a reviewed US metro string now resolves without structured country", () => {
  const res = classifyResults([{ name: "Metro Only", location: MAPPED_LOCATION_A, source_url: "https://linkedin.com/in/mo" }], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 1, `${MAPPED_LOCATION_A} is unambiguously US`);
});

Deno.test("repro: frozen Q1 facts (22 US profiles were all rejected pre-fix)", () => {
  assertEquals(FROZEN_Q1_LOCATION_FACTS.raw_profiles, 22);
  assertEquals(FROZEN_Q1_LOCATION_FACTS.accepted, 0);
  assertEquals(FROZEN_Q1_LOCATION_FACTS.reject_reason, "wrong location (strict)");
});
