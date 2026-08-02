// Reproduces the Apify ACTOR-selection mismatch behind the failed live Q1, using
// ONLY pre-existing production helpers (so it stands independently of the fix).
//
// The pre-fix sourcing layer inferred the source type with a regex that collapsed
// "founders"/"people"/"companies" to the JOBS source type (and
// normalizeApifySourceType defaults empty/unknown → "jobs"). Meanwhile the tested
// intent classifier leadIntake.extractLeadDetails() correctly classifies the SAME
// founder query as "people". So a person request would run a JOBS scraper — the
// mismatch this branch fixes.
//
// (normalizeApifySourceType lives in toolRegistry.ts, which carries a pre-existing
// unrelated type error, so we assert the CORRECT classifier here and document the
// buggy jobs default rather than importing the erroring module.)
//
// Deterministic; no provider/LLM/Apify.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractLeadDetails } from "../../../supabase/functions/_shared/leadIntake.ts";

const Q1 = "Using my ICP, find me 5 hot founders I should contact right now.";

Deno.test("repro: the tested classifier says the founder query is 'people' (pre-fix sourcing layer used 'jobs')", () => {
  assertEquals(extractLeadDetails(Q1).mode, "people");
});

Deno.test("repro: a genuine hiring query is 'hiring' — jobs is only correct there", () => {
  assertEquals(extractLeadDetails("Find companies hiring RevOps engineers now").mode, "hiring");
});

Deno.test("repro: company-only vs person are distinct (only person must reach the people actor)", () => {
  assertEquals(extractLeadDetails("Find B2B SaaS companies in the US").mode, "companies");
  assertEquals(extractLeadDetails("Find me 5 founders of B2B SaaS companies").mode, "people");
});
