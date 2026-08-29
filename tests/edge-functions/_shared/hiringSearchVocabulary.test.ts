// WHAT THE JOB SEARCH ASKS FOR, AND WHERE THAT COMES FROM.
//
// ── TWO DEFECTS PINNED HERE ────────────────────────────────────────────────
//
// 1. `HIRING_JOB_TITLES` was `[...TIER_A_TITLES, ...TIER_B_TITLES].slice(0, 20)`
//    under a comment promising "same titles, same order, same evidence
//    standard". TIER_A holds 21 entries, so that slice kept twenty of TIER_A
//    and ZERO of TIER_B — deleting `account executive`, `sdr`, `bdr`,
//    `sales development representative` and `sales director`, which is most of
//    what the returned data actually contained.
//
// 2. The list was a constant. The mission carries the user's own role terms and
//    `buildQualificationContext` expands them into a vocabulary the ASSESSMENT
//    scores against; the search never saw it. Task 5c461aa3 asked LinkedIn for
//    "deal desk" and "gtm engineer" while looking for companies hiring sales,
//    and never once asked for "account executive".

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hiringSearchTitles, HIRING_SEARCH_TITLE_LIMIT,
} from "../../../supabase/functions/_shared/hiringSearchVocabulary.ts";
import {
  TIER_A_TITLES, TIER_B_TITLES,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import {
  buildQualificationContext,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";

const missionWith = (terms: string[]) => ({
  version: "lead-mission-v1", mission_type: "company_research", target_entity: "company",
  requested_count: 3, requested_output: "qualified_companies",
  original_user_query: "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  company_profile: { verticals: ["recruiting", "staffing"], locations: [], stages: [], business_models: [] },
  decision_makers: { roles: [], current_employment_required: false },
  required_signals: [{
    type: "hiring", event: "hiring", subject: "company", phrase: "hiring sales roles",
    qualifier: { role_terms: terms },
  }],
  required_signal_terms: terms,
  directives: {}, hard_constraints: {}, soft_preferences: {},
  field_provenance: {}, required_capabilities: [], prohibited_capabilities: [],
  // deno-lint-ignore no-explicit-any
} as any);

const vocabFor = (terms: string[]) =>
  buildQualificationContext(missionWith(terms)).role_vocabulary;

// ══ 1. THE TRUNCATION ══════════════════════════════════════════════════════

Deno.test("1. the naive slice really did delete a whole tier", () => {
  // The arithmetic that caused it, stated so a future edit to TIER_A cannot
  // quietly reintroduce the same shape.
  assertEquals(TIER_A_TITLES.length, 21);
  const naive = [...TIER_A_TITLES, ...TIER_B_TITLES].slice(0, HIRING_SEARCH_TITLE_LIMIT);
  assertEquals(naive.filter((t) => TIER_B_TITLES.includes(t)).length, 0,
    "the shipped constant contained no Tier B title at all");
  assertEquals(naive.includes("account executive"), false);
});

Deno.test("2. a capped list may shorten a tier but never erase one", () => {
  const titles = hiringSearchTitles(null);
  assertEquals(titles.length, HIRING_SEARCH_TITLE_LIMIT, "the cost ceiling is unchanged");
  assert(titles.some((t) => TIER_A_TITLES.includes(t)), "Tier A is represented");
  assert(titles.some((t) => TIER_B_TITLES.includes(t)), "Tier B is represented");
  for (const missing of ["account executive", "sdr", "bdr"]) {
    assert(titles.includes(missing), `"${missing}" must reach the provider`);
  }
});

Deno.test("3. the cap holds even if a tier grows", () => {
  // The off-by-one was a length nobody re-checked. Growth must not overflow.
  assertEquals(hiringSearchTitles(null, 5).length, 5);
  assertEquals(hiringSearchTitles(null, 1000).length,
    new Set([...TIER_A_TITLES, ...TIER_B_TITLES].map((t) => t.toLowerCase())).size,
    "an unbounded budget yields every distinct title, and no duplicates");
});

// ══ 2. THE MISSION IS THE SOURCE ═══════════════════════════════════════════

Deno.test("4. a mission that named roles decides what is searched for", () => {
  const titles = hiringSearchTitles(vocabFor(["sales roles"]));
  assert(titles.includes("sales roles"), "the user's own words are sent");
  for (const expected of ["account executive", "sdr", "bdr", "sales development representative"]) {
    assert(titles.includes(expected),
      `"${expected}" is a sales role and the run exists to find companies hiring one`);
  }
  assertEquals(titles.length <= HIRING_SEARCH_TITLE_LIMIT, true);
});

Deno.test("5. a NARROW ask is not widened by the search either", () => {
  // The first version of this appended the commercial ladder after the
  // mission's terms, which turned "companies hiring Sales Operations" into a
  // search for Account Executives and SDRs. The assessment already refuses to
  // cross that line; the search must not cross it and pay for the crossing.
  const titles = hiringSearchTitles(vocabFor(["sales operations"]));
  assertEquals(titles.includes("account executive"), false);
  assertEquals(titles.includes("sdr"), false);
  assert(titles.some((t) => /sales operation/.test(t)), "it asks for what was asked");
});

Deno.test("6. a mission that named nothing falls back to the ladder", () => {
  const silent = buildQualificationContext(missionWith([])).role_vocabulary;
  assertEquals(silent.source, "default_commercial");
  assertEquals(hiringSearchTitles(silent), hiringSearchTitles(null));
});

// ══ 3. THE ENGINE USES IT, AND USES IT ONCE ════════════════════════════════

const ENGINE = await Deno.readTextFile(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));

Deno.test("7. the call and the operation key read the SAME list", () => {
  // A key fingerprinted over a different vocabulary than the call uses would
  // skip work that was never done — the reason the constant was named rather
  // than inlined in the first place.
  assertEquals(ENGINE.split("jobTitles: searchTitles").length - 1, 2,
    "exactly two sites: the provider call and the operation key");
  assertEquals(ENGINE.includes("jobTitles: HIRING_JOB_TITLES"), false,
    "neither may fall back to the constant");

  const derive = ENGINE.indexOf("const searchTitles = hiringSearchTitles(");
  assert(derive > 0, "the list must be derived once");
  assert(ENGINE.indexOf("jobTitles: searchTitles") > derive,
    "and derived before either site reads it");
});

Deno.test("8. it is derived from the mission's own vocabulary", () => {
  const derive = ENGINE.indexOf("const searchTitles = hiringSearchTitles(");
  const call = ENGINE.slice(derive, derive + 120);
  assert(call.includes("qualificationCtx.role_vocabulary"),
    "the same vocabulary the assessment scores against, not a second reading");
});
