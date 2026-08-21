// WHY IDENTITY RESOLUTION REFUSED, NOT JUST HOW OFTEN.
//
// THE RUN THIS FILE EXISTS FOR — TEST plan 958c86bc, 2026-08-21, build
// 24a71481. The execution ledger recorded its first rows ever that morning, and
// they settled a question three audits had guessed at:
//
//     28 identity calls, ALL succeeded, EVERY ONE returned 1-5 rows.
//     0 provider errors. 0 empty results.
//
// So the ~45% "miss rate" was never the Actor failing to find companies. Of the
// 20 companies that reached a verdict, 11 resolved and 9 were REJECTED here, by
// `acceptLinkedInMatch`, after the search had already found them.
//
// AND NOTHING SAID WHY. The function computes exactly which of its four paths
// decided and returns `{ accepted, strength, reason }`; the engine read
// `.accepted` and dropped the rest. All that survived was a generic
// `linkedin_match_rejected_weak`, and only when EVERY candidate failed.
//
// The two rejection codes need opposite fixes, which is the whole reason for
// telling them apart:
//
//   no_name_or_domain_match             the exact-equality NAME gate refused
//                                       before corroboration was ever consulted
//   name_matched_nothing_corroborated   the name matched and corroboration
//                                       itself was too strict
//
// A run full of the first means the name gate is wrong. A run full of the
// second means the evidence rules are. Until now a run reported neither.
//
// THIS FILE CHANGES NO DECISION. Every test below asserts that what is accepted
// and what is refused is exactly what was accepted and refused before.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  acceptLinkedInMatch, linkedInSlugToken, type PrequalifiedCompany,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";
import {
  recordMatchDecisions, MAX_MATCH_REJECTION_SAMPLES,
  identitySearchLocations, IDENTITY_SEARCH_MAX_ITEMS,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

const company = (over: Partial<PrequalifiedCompany> = {}): PrequalifiedCompany => ({
  company_key: "getcrux.ai", name: "GetCrux", canonical_domain: "getcrux.ai",
  yc_url: null, yc_id: null, team_size: 8, batch: "W25", one_liner: null,
  locations: null, jobs: [], has_open_roles: true,
  tier_a: 0, tier_b: 0, tier_c: 0, technical: 1, best_tier: null, score: 40,
  strongest_signal: null, size_fit: true, size_status: "in_range",
  eligible: true, exclusion: null, reasons: [], has_open_roles_unused: undefined,
  linkedin_identity_status: "unresolved", identity_confidence: "domain_exact",
  ...over,
} as unknown as PrequalifiedCompany);

// ═══ 1. EVERY PATH NAMES ITSELF ════════════════════════════════════════════

Deno.test("1. the four accepting paths each report their own code", () => {
  const c = company();

  assertEquals(acceptLinkedInMatch(c, { website: "https://getcrux.ai" }).code,
    "domain_exact");

  assertEquals(acceptLinkedInMatch(c, {
    name: "GetCrux", linkedinUrl: "https://www.linkedin.com/company/getcruxai",
  }).code, "name_and_slug");

  assertEquals(acceptLinkedInMatch(c, {
    name: "GetCrux", description: "GetCrux builds video analytics",
  }).code, "name_and_prose");

  assertEquals(acceptLinkedInMatch(
    company({ one_liner: "AI powered video intelligence for marketers" }),
    { name: "GetCrux", description: "AI powered video intelligence for marketers, globally" },
  ).code, "name_and_one_liner");
});

Deno.test("2. the two REFUSING paths are told apart", () => {
  const c = company();

  // The name matched; nothing else agreed. Corroboration is what refused.
  assertEquals(acceptLinkedInMatch(c, {
    name: "GetCrux", linkedinUrl: "https://www.linkedin.com/company/some-other-firm",
    description: "unrelated", location: "Berlin",
  }).code, "name_matched_nothing_corroborated");

  // The name did not match, so nothing else was even consulted.
  assertEquals(acceptLinkedInMatch(c, {
    name: "Crux Analytics", linkedinUrl: "https://www.linkedin.com/company/getcruxai",
  }).code, "no_name_or_domain_match");
});

// ═══ 2. THE NINE REAL REJECTIONS ═══════════════════════════════════════════

Deno.test("3. run 958c86bc's rejected nine, reconstructed", () => {
  // Verbatim from the run's own checkpoint: the companies whose identity came
  // back `unresolved` after a search that HAD returned rows for them.
  const REJECTED = [
    { name: "Autonomous Technologies Group", domain: "becomeautonomous.com" },
    { name: "HUD", domain: "hud.ai" },
    { name: "Osmosis", domain: "osmosis.ai" },
    { name: "Anara", domain: "anara.com" },
    { name: "GetCrux", domain: "getcrux.ai" },
    { name: "Retell AI", domain: "retellai.com" },
    { name: "Raindrop", domain: "raindrop.ai" },
    { name: "Andy AI", domain: "with-andy.com" },
    { name: "Clarion", domain: "clarionhealth.com" },
  ];

  // A LinkedIn page whose name carries one extra token — the ordinary case, and
  // the shape "Clarion"/clarionhealth.com and "Autonomous Technologies
  // Group"/becomeautonomous.com both point at.
  for (const r of REJECTED) {
    const verdict = acceptLinkedInMatch(
      company({ name: r.name, canonical_domain: r.domain, company_key: r.domain }),
      { name: `${r.name} AI`, linkedinUrl: null, website: null },
    );
    assertEquals(verdict.accepted, false);
    assertEquals(verdict.code, "no_name_or_domain_match",
      `${r.name}: the NAME gate refused before corroboration was consulted`);
  }
});

Deno.test("4. GetCrux is the clincher: the corroboration would have passed", () => {
  // It resolved in run b7a9e112 to linkedin.com/company/getcruxai. The slug
  // token agrees with the domain token by the file's own `tokensAgree` rule.
  assertEquals(linkedInSlugToken("https://www.linkedin.com/company/getcruxai"), "getcruxai");
  assert("getcruxai".startsWith("getcrux"), "the evidence itself is sound");

  const c = company();
  // With the name equal, that evidence is accepted.
  assertEquals(acceptLinkedInMatch(c, {
    name: "GetCrux", linkedinUrl: "https://www.linkedin.com/company/getcruxai",
  }).code, "name_and_slug");

  // With the name one token different, the SAME evidence is never reached.
  assertEquals(acceptLinkedInMatch(c, {
    name: "GetCrux AI", linkedinUrl: "https://www.linkedin.com/company/getcruxai",
  }).code, "no_name_or_domain_match");
});

// ═══ 3. THE DIAGNOSTIC ITSELF ══════════════════════════════════════════════

const engineCompany = (key: string, name: string, domain: string | null) =>
  ({ key, company: { company_name: name, canonical_domain: domain } });

Deno.test("5. a company counts once, however many candidates it had", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  // Five search hits, one right — the ordinary shape of maxItems: 5.
  recordMatchDecisions(state, engineCompany("a.com", "A", "a.com"), [
    { code: "no_name_or_domain_match", accepted: false, candidate_name: "Other", candidate_slug: "other", candidate_domain: null },
    { code: "domain_exact", accepted: true, candidate_name: "A", candidate_slug: "a", candidate_domain: "a.com" },
    { code: "no_name_or_domain_match", accepted: false, candidate_name: "Third", candidate_slug: "third", candidate_domain: null },
  ]);
  const d = state.identity_match_diagnostics!;
  assertEquals(d.companies_judged, 1, "one company, not three candidates");
  assertEquals(d.companies_accepted, 1);
  assertEquals(d.companies_rejected, 0);
  assertEquals(d.by_code, { no_name_or_domain_match: 2, domain_exact: 1 },
    "the per-candidate codes are still all counted — that is the distribution");
  assertEquals(d.rejected_samples, [], "an accepted company is not a refusal");
});

Deno.test("6. the CLOSEST refusal is sampled, not the first", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(state, engineCompany("b.com", "B", "b.com"), [
    { code: "no_name_or_domain_match", accepted: false, candidate_name: "Unrelated", candidate_slug: "unrelated", candidate_domain: null },
    { code: "name_matched_nothing_corroborated", accepted: false, candidate_name: "B", candidate_slug: "b-corp", candidate_domain: null },
  ]);
  const s = state.identity_match_diagnostics!.rejected_samples;
  assertEquals(s.length, 1);
  assertEquals(s[0].code, "name_matched_nothing_corroborated",
    "a name that matched and failed on evidence says more than one that never matched");
  assertEquals(s[0].candidate_slug, "b-corp");
  assertEquals(s[0].company_domain, "b.com");
});

Deno.test("7. the sample is bounded; the counts are not", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  for (let i = 0; i < MAX_MATCH_REJECTION_SAMPLES + 40; i++) {
    recordMatchDecisions(state, engineCompany(`c${i}.com`, `C${i}`, `c${i}.com`), [
      { code: "no_name_or_domain_match", accepted: false, candidate_name: "x", candidate_slug: "x", candidate_domain: null },
    ]);
  }
  const d = state.identity_match_diagnostics!;
  assertEquals(d.rejected_samples.length, MAX_MATCH_REJECTION_SAMPLES);
  assertEquals(d.companies_rejected, MAX_MATCH_REJECTION_SAMPLES + 40,
    "a checkpoint must not grow without bound, and a count must not be capped");
});

Deno.test("8. no candidates means nothing is recorded at all", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(state, engineCompany("d.com", "D", "d.com"), []);
  assertEquals(state.identity_match_diagnostics, undefined,
    "a company the search returned nothing for was not judged here");
});

// ═══ 4. THE SEARCH THE DIAGNOSTIC SENT US BACK TO ══════════════════════════
//
// Five samples, five correct refusals: the right LinkedIn page was not in the
// results at all. So the fix is not in matching, it is in RETRIEVAL — and the
// call had been sending the same two fields for every company since it was
// written.

Deno.test("9. a HARD geography reaches the search; a soft one does not", () => {
  const hard = {
    geography_is_hard: true,
    company_profile: { locations: ["United States"] },
  } as never as Parameters<typeof identitySearchLocations>[0];
  assertEquals(identitySearchLocations(hard), ["United States"],
    "the exact value in this actor's own verified example");

  const soft = {
    geography_is_hard: false,
    company_profile: { locations: ["United States"] },
  } as never as Parameters<typeof identitySearchLocations>[0];
  assertEquals(identitySearchLocations(soft), [],
    "a soft geography is a ranking preference; turning it into a provider filter narrows a search the user did not");
});

Deno.test("10. the abbreviations a model emits are normalised, others pass through", () => {
  const mk = (locations: string[]) => identitySearchLocations(
    { geography_is_hard: true, company_profile: { locations } } as never,
  );
  assertEquals(mk(["US"]), ["United States"]);
  assertEquals(mk(["usa"]), ["United States"]);
  assertEquals(mk(["America"]), ["United States"]);
  assertEquals(mk(["US", "U.S.", "united states"]), ["United States"], "and deduped");
  // The table covers abbreviations, not places. Dropping what it does not list
  // would discard real locations along with the typos.
  assertEquals(mk(["Germany"]), ["Germany"]);
});

Deno.test("11. a missing or empty geography sends no filter at all", () => {
  for (const m of [
    { geography_is_hard: true, company_profile: { locations: [] } },
    { geography_is_hard: true, company_profile: {} },
    { geography_is_hard: true },
    {},
  ]) {
    assertEquals(identitySearchLocations(m as never), [],
      `no geography must mean no filter: ${JSON.stringify(m)}`);
  }
});

Deno.test("12. the filter stays inside the compiler's own limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => `Country ${i}`);
  const out = identitySearchLocations(
    { geography_is_hard: true, company_profile: { locations: many } } as never,
  );
  assertEquals(out.length, 20, "compileHarvestCompanySearchInput rejects more than 20");
});

Deno.test("13. the search asks for more than five candidates now", () => {
  // Five was the miss: every refusal above was an impostor ranked above a
  // five-person YC startup in a name index sorted by prominence.
  assertEquals(IDENTITY_SEARCH_MAX_ITEMS, 15);
  assert(IDENTITY_SEARCH_MAX_ITEMS > 5);
  assert(IDENTITY_SEARCH_MAX_ITEMS <= 1000, "the compiler's ceiling");
});

// ═══ 5. THE SEARCH BUYS ONLY WHAT IT READS ═════════════════════════════════
//
// `scraperMode` was `full`, justified in-line by "`short` returns employeeCount
// === null, and an unverifiable size cannot settle a 10-150 gate". True of the
// size gate, and not true of THIS call: the stage reads five fields out of each
// result — name, linkedinUrl, website, description, location — and
// `employeeCount` is not one of them. Three fields leave the branch.
//
// Since maxItems went to 15, `full` was doubling the price of 15 results on
// every identity call for a number nothing here looks at.

import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const SEARCH = "apify_linkedin_company_search";
const MEMO23 = "apify_yc_companies_memo23";

/** One YC company, and the LinkedIn row SHORT mode returns for it. */
const YC_ROW = {
  name: "Godela", website: "https://godela.ai", teamSize: 6, batch: "X25",
  industries: ["B2B"], id: "godela", regions: ["United States of America"],
  isHiring: true, openJobs: [{ title: "Founding Engineer" }],
} as unknown as Record<string, unknown>;

/**
 * SHORT MODE, faithfully: `employeeCount` and `industries` absent, everything
 * this stage actually reads present. Per the actor's own verified card, those
 * two fields are the only ones `full` adds.
 */
const SHORT_MODE_HIT = {
  id: "1", name: "Godela", linkedinUrl: "https://www.linkedin.com/company/godela-ai",
  website: "https://godela.ai", description: "AI physics engine", location: "San Francisco",
  employeeCount: null, industry: "Software Development",
};

async function runIdentity() {
  const calls: Array<Record<string, unknown>> = [];
  const m = parseLeadMissionDeterministic(
    "Find 10 qualified AI startups in the US currently hiring",
  );
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === MEMO23) return Promise.resolve([YC_ROW]);
      if (call.actorKey === SEARCH) {
        calls.push(call.input as Record<string, unknown>);
        return Promise.resolve([SHORT_MODE_HIT]);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as unknown as CapabilityEngineDeps as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
    readEnv: (k: string) => k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
  } as never);
  return { run, calls };
}

Deno.test("14. the identity search asks for SHORT mode", async () => {
  const { calls } = await runIdentity();
  assert(calls.length > 0, "the identity search must have run");
  for (const input of calls) {
    assertEquals(input.scraperMode, "short",
      "full doubles the per-result price for `employeeCount`, which this stage never reads");
    assertEquals(input.maxItems, IDENTITY_SEARCH_MAX_ITEMS);
  }
});

Deno.test("15. and resolves an identity from a short-mode row", async () => {
  // The proof that dropping `full` costs nothing: a row with employeeCount null
  // and no `industries` still carries everything the match needs.
  const { run } = await runIdentity();
  const c = run.companies.find((x) => x.key === "godela.ai");
  assert(c, "the company survived to identity resolution");
  assertEquals(c!.identity?.linkedin_company_url,
    "https://www.linkedin.com/company/godela-ai",
    "domain_exact does not need a headcount");
});

Deno.test("16. the stage still reads only mode-independent fields", () => {
  // If someone later lifts `employeeCount` out of the search result, `short`
  // silently becomes the wrong mode. This is the tripwire for that.
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  const branch = src.slice(
    src.indexOf("lookups = found.map("),
    src.indexOf("c.identity = resolveIdentityAgainstLookups("));
  for (const full_mode_only of ["employeeCount", "industries"]) {
    assert(!branch.includes(full_mode_only),
      `the identity branch reads "${full_mode_only}", which SHORT mode does not return`);
  }
  for (const needed of ["name", "linkedinUrl", "website", "description", "location"]) {
    assert(branch.includes(needed), `"${needed}" is what this stage actually consumes`);
  }
});

// ═══ 6. THE STAGED FLOW, AND THE MEASUREMENTS THAT CAN REVISIT IT ══════════
//
// `full` costs $0.004 a row against `short`'s $0.002, and the only two fields
// it adds are `employeeCount` and `industries` — precisely the two this actor's
// own card says must not be trusted from a search, and precisely the two
// `apify_linkedin_company_details` exists to supply authoritatively for the
// winner. So `full` on the search bought, for fifteen candidates, the fields it
// is documented as getting wrong, which are then bought properly for the one
// company that matters.

import {
  SEARCH_SCRAPER_MODE,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  hiringActorCard,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

Deno.test("17. the two fields `full` adds are the two the card says not to trust", () => {
  const search = hiringActorCard("apify_linkedin_company_search")!;
  const enrich = hiringActorCard("apify_linkedin_company_details")!;

  // The search's own defects name them.
  const defects = search.known_defects.map((d) => d.id);
  assert(defects.includes("company_search_size_filters_wrong_field"));
  assert(defects.includes("company_search_industry_unreliable"));
  assert(search.known_defects.some((d) => /Only enriched employeeCount/.test(d.mitigation)));
  assert(search.known_defects.some((d) => /Enrichment supplies the authoritative/.test(d.mitigation)));

  // And the enrichment stage claims exactly them.
  assert(enrich.best_for.some((b) => /employeeCount/.test(b)));
  assert(enrich.best_for.some((b) => /industry id/.test(b)));
  assert(enrich.best_for.some((b) => /correcting company-search/.test(b)),
    "the enrichment card says outright that it exists to correct the search");
});

Deno.test("18. the search is bought SHORT, and the price gap is real", () => {
  assertEquals(SEARCH_SCRAPER_MODE, "short");
  const c = hiringActorCard("apify_linkedin_company_search")!.cost_model;
  assertEquals(c.events_usd!["short-company"], 0.002);
  assertEquals(c.events_usd!["full-company"], 0.004);
  assertEquals(
    c.events_usd!["full-company"] / c.events_usd!["short-company"], 2,
    "at maxItems 15 across ~23 calls a run, that gap is the largest line in the pipeline",
  );
});

Deno.test("19. the winner's RANK is recorded — the only thing that can settle maxItems", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  const dec = (rank: number, accepted: boolean) => ({
    code: (accepted ? "domain_exact" : "no_name_or_domain_match") as
      Parameters<typeof recordMatchDecisions>[2][number]["code"],
    accepted, candidate_name: `c${rank}`, candidate_slug: `c${rank}`,
    candidate_domain: null, rank, retrieval_mode: "short",
  });

  // A company found at rank 11 — beyond where `maxItems: 5` could ever reach.
  recordMatchDecisions(state, engineCompany("a.com", "A", "a.com"), [
    dec(0, false), dec(1, false), dec(11, true), dec(12, false),
  ]);
  // And one found immediately.
  recordMatchDecisions(state, engineCompany("b.com", "B", "b.com"), [dec(0, true)]);

  const d = state.identity_match_diagnostics!;
  assertEquals(d.accepted_rank_histogram, { "11": 1, "0": 1 });
  assertEquals(d.retrieval_modes, { short: 5 },
    "every candidate carries the depth it was bought at, so modes compare ACROSS runs");
});

Deno.test("20. only the FIRST acceptance sets the rank", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(state, engineCompany("c.com", "C", "c.com"), [
    { code: "domain_exact", accepted: true, candidate_name: "C", candidate_slug: "c",
      candidate_domain: "c.com", rank: 3, retrieval_mode: "short" },
    { code: "name_and_slug", accepted: true, candidate_name: "C", candidate_slug: "c",
      candidate_domain: null, rank: 9, retrieval_mode: "short" },
  ]);
  assertEquals(state.identity_match_diagnostics!.accepted_rank_histogram, { "3": 1 },
    "how deep the search had to go — a second hit further down does not change it");
});

Deno.test("21. a refusal carries its rank too, and a missing one is not zero", () => {
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(state, engineCompany("d.com", "D", "d.com"), [
    { code: "no_name_or_domain_match", accepted: false, candidate_name: "Other",
      candidate_slug: "other", candidate_domain: null, rank: 2, retrieval_mode: "short" },
  ]);
  assertEquals(state.identity_match_diagnostics!.rejected_samples[0].rank, 2);

  // An older caller that does not supply one must not be read as "rank 0".
  const legacy = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(legacy, engineCompany("e.com", "E", "e.com"), [
    { code: "no_name_or_domain_match", accepted: false, candidate_name: "x",
      candidate_slug: "x", candidate_domain: null },
  ]);
  assertEquals(legacy.identity_match_diagnostics!.rejected_samples[0].rank, -1,
    "unknown, not first");
  assertEquals(legacy.identity_match_diagnostics!.accepted_rank_histogram, {});
});

// ═══ 7. FOUR FACTS THAT WERE ONE WORD ══════════════════════════════════════
//
// A company left identity resolution `unresolved` whether the provider had
// returned nothing, returned the wrong companies, faulted, or was never asked
// because the clock ran out. Five audits could not say which, because
// `recordMatchDecisions` only runs when candidates come back — so the two cases
// with no candidates were absent from every diagnostic this system produced.
//
// The distinction is the one that decides what to change: retrieval outcomes
// point at the QUERY, match codes point at the RULES.

import {
  recordRetrievalOutcome,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

Deno.test("22. a search that returned NOTHING is not a match failure", () => {
  const state = {} as never as Parameters<typeof recordRetrievalOutcome>[0];
  recordRetrievalOutcome(state, { key: "ghost.ai" }, "no_candidates");

  const d = state.identity_match_diagnostics!;
  assertEquals(d.retrieval_outcomes, { no_candidates: 1 });
  assertEquals(d.by_code, {},
    "no rule was consulted, so no rule may be blamed");
  assertEquals(d.companies_rejected, 0,
    "the matcher rejected nobody — it was never given anything");
});

Deno.test("23. the four outcomes are counted apart", () => {
  const state = {} as never as Parameters<typeof recordRetrievalOutcome>[0];
  for (const o of ["candidates_returned", "candidates_returned", "no_candidates",
    "provider_error", "not_attempted", "not_attempted"] as const) {
    recordRetrievalOutcome(state, { key: `c-${Math.random()}` }, o);
  }
  assertEquals(state.identity_match_diagnostics!.retrieval_outcomes, {
    candidates_returned: 2, no_candidates: 1, provider_error: 1, not_attempted: 2,
  });
});

Deno.test("24. retrieval and matching share one record without colliding", () => {
  // A run where the provider answered for one company and not for another. Both
  // facts have to survive in the same diagnostic, because the ratio between
  // them is the finding.
  const state = {} as never as Parameters<typeof recordRetrievalOutcome>[0];
  recordRetrievalOutcome(state, { key: "found.ai" }, "candidates_returned");
  recordMatchDecisions(state, engineCompany("found.ai", "Found", "found.ai"), [
    { code: "domain_exact", accepted: true, candidate_name: "Found",
      candidate_slug: "found", candidate_domain: "found.ai", rank: 0,
      retrieval_mode: "short" },
  ]);
  recordRetrievalOutcome(state, { key: "ghost.ai" }, "no_candidates");

  const d = state.identity_match_diagnostics!;
  assertEquals(d.retrieval_outcomes, { candidates_returned: 1, no_candidates: 1 });
  assertEquals(d.companies_judged, 1, "only the one with candidates was judged");
  assertEquals(d.companies_accepted, 1);
  assertEquals(d.accepted_rank_histogram, { "0": 1 });
});

Deno.test("25. a deferred company is not evidence about the company", () => {
  // The clock and the credit gate both land here. Neither is a finding, and
  // counting them as retrieval failures would make a budget decision look like
  // a fact about LinkedIn.
  const state = {} as never as Parameters<typeof recordRetrievalOutcome>[0];
  recordRetrievalOutcome(state, { key: "later.ai" }, "not_attempted");
  const d = state.identity_match_diagnostics!;
  assertEquals(d.retrieval_outcomes.not_attempted, 1);
  assertEquals(d.retrieval_outcomes.no_candidates, undefined);
  assertEquals(d.companies_judged, 0);
});

Deno.test("26. the engine records all three paths, not just the one with rows", () => {
  // The defect was structural: only the branch with candidates recorded
  // anything. This pins that every exit from the search is now accounted for.
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  const branch = src.slice(
    src.indexOf("const found = await callProvider(cap, provider, compiled, c);"),
    src.indexOf("c.identity = resolveIdentityAgainstLookups("));
  assert(branch.includes('"provider_error"'), "a faulted call is recorded");
  assert(branch.includes('"not_attempted"'), "a company the clock or credits stopped is recorded");
  assert(branch.includes('"no_candidates"'), "a search that returned nothing is recorded");
  assert(branch.includes('"candidates_returned"'), "and so is the ordinary case");
});
