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
