// Reproduction: the CURRENT HarvestAPI people-search adapter generates the exact
// malformed payload observed on the three live Q1 actor runs (0 items each).
// Uses the real production adapter (buildHarvestApiPeopleInput). Deterministic; no
// provider. Later commits correct the adapter and this file's expectations.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildHarvestApiPeopleInput } from "./harvestApiPeople.ts";
import {
  FROZEN_Q1_GENERIC_INPUT,
  FROZEN_MALFORMED_PAYLOAD,
  FROZEN_ATTEMPT_FACTS,
} from "./peopleSearchInputFixture.ts";

Deno.test("repro: current adapter emits the exact observed malformed payload", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  assertEquals(out, { ...FROZEN_MALFORMED_PAYLOAD });
});

Deno.test("repro: the malformed payload leaks a meta-instruction into searchQuery", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  const q = String(out.searchQuery);
  assert(q.includes("apify_people_search"), "tool name leaked into searchQuery");
  assert(/\b10-15\b/.test(q), "requested count leaked into searchQuery");
});

Deno.test("repro: the malformed payload has no structured people filters", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  assertEquals("currentJobTitles" in out, false);
  assertEquals("locations" in out, false);
  assertEquals("takePages" in out, false);
});

Deno.test("repro: frozen facts record three identical, empty attempts", () => {
  assertEquals(FROZEN_ATTEMPT_FACTS.attempts, 3);
  assertEquals(FROZEN_ATTEMPT_FACTS.items_each, 0);
  assertEquals(FROZEN_ATTEMPT_FACTS.identical_attempts, true);
  assertEquals(FROZEN_ATTEMPT_FACTS.searchQuery_contained_meta_instruction, true);
});
