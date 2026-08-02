// Before/after regression for the HarvestAPI people-search input-quality fix.
// The frozen malformed payload is what the three live Q1 actor runs received
// (0 items each). After the fix, the production adapter must NO LONGER produce it
// and must emit a concise, structured, meta-instruction-free payload.
// Uses the real production adapter (buildHarvestApiPeopleInput). Deterministic.

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildHarvestApiPeopleInput } from "../../functions/_shared/harvestApiPeople.ts";
import {
  FROZEN_Q1_GENERIC_INPUT,
  FROZEN_MALFORMED_PAYLOAD,
  FROZEN_ATTEMPT_FACTS,
} from "../../functions/_shared/peopleSearchInputFixture.ts";

Deno.test("fix: adapter NO LONGER emits the observed malformed payload", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  assertNotEquals(out, { ...FROZEN_MALFORMED_PAYLOAD });
});

Deno.test("fix: corrected searchQuery has no meta-instruction / tool name / requested count", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  const q = String(out.searchQuery ?? "");
  assert(!/apify_people_search/i.test(q), `tool name leaked: ${q}`);
  assert(!/\buse\b/i.test(q), `meta-instruction leaked: ${q}`);
  assert(!/\b10-15\b/.test(q), `requested count leaked: ${q}`);
  assert(!/employees?/i.test(q), `employee-count prose leaked: ${q}`);
  // Concise market/category query.
  assertEquals(q, "B2B SaaS OR AI SaaS");
});

Deno.test("fix: corrected payload carries structured person + geography filters", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  assertEquals(out.currentJobTitles, ["Founder", "Co-Founder"]);
  assertEquals(out.locations, ["United States"]);
  assertEquals(out.maxItems, 5);
  assertEquals(out.startPage, 1);
});

Deno.test("repro: frozen facts still record the original three identical, empty attempts", () => {
  assertEquals(FROZEN_ATTEMPT_FACTS.attempts, 3);
  assertEquals(FROZEN_ATTEMPT_FACTS.items_each, 0);
  assertEquals(FROZEN_ATTEMPT_FACTS.identical_attempts, true);
  assertEquals(FROZEN_MALFORMED_PAYLOAD.searchQuery.includes("apify_people_search"), true);
});
