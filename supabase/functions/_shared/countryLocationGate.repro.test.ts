// Reproduction: the CURRENT source gates reject a genuine US profile whose
// location string is a US city/region ("Greater Philadelphia") against a
// "United States" requirement — the country-blind rejection behind the failed
// Q1 success-path probe. Uses the real production classifier + validator.
// Deterministic; no provider. Later commits make Cases A/B accept, C still reject.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResults } from "./sourceQuality.ts";
import { validateSourcingResults } from "./sourcingRetry.ts";
import {
  MAPPED_LOCATION_A,
  MAPPED_LOCATION_B,
  MAPPED_LOCATION_C,
  REQUIRED_US,
  FROZEN_Q1_LOCATION_FACTS,
} from "./peopleLocationFixture.ts";

const crit = (location: string) => ({ requested: 5, role: null, location, source_type: "people_profiles" });
const STRICT = { location: true, industry: false, stage: false, count_exact: false };
const person = (name: string, location: string) => ({ name, location, source_url: `https://linkedin.com/in/${name.replace(/\s+/g, "").toLowerCase()}` });

Deno.test("repro: classifyResults rejects US 'Greater Philadelphia' vs 'United States' (country-blind)", () => {
  const res = classifyResults([person("Alex Founder", MAPPED_LOCATION_A)], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 0);
  assertEquals(res.rejected[0]?.reason, "wrong location (strict)");
});

Deno.test("repro: classifyResults rejects US 'San Francisco Bay Area' vs 'United States'", () => {
  const res = classifyResults([person("Sam Bay", MAPPED_LOCATION_B)], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 0);
  assertEquals(res.rejected[0]?.reason, "wrong location (strict)");
});

Deno.test("repro: validateSourcingResults (actual accept path) also drops the US city profile", () => {
  const kept = validateSourcingResults([person("Alex Founder", MAPPED_LOCATION_A)], crit(REQUIRED_US), STRICT);
  assertEquals(kept.length, 0);
});

Deno.test("repro: a genuinely UK profile ('Greater London') is correctly rejected vs US", () => {
  const res = classifyResults([person("Liam London", MAPPED_LOCATION_C)], crit(REQUIRED_US), STRICT);
  assertEquals(res.accepted.length, 0); // correct — but for the same country-blind reason
});

Deno.test("repro: frozen Q1 facts (22 US profiles, all rejected wrong location)", () => {
  assertEquals(FROZEN_Q1_LOCATION_FACTS.raw_profiles, 22);
  assertEquals(FROZEN_Q1_LOCATION_FACTS.accepted, 0);
  assertEquals(FROZEN_Q1_LOCATION_FACTS.reject_reason, "wrong location (strict)");
});
