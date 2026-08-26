// AN ICP MUST REACH THE SEARCH, OR THE SEARCH MUST NOT RUN.
//
// `not_for: "semantic/concept search"` was enforced at ACTOR level, so a
// concept mission had no non-YC discovery source and died as `no_valid_step`
// after the user clicked Start (tasks eeb02852, 58ada236).
//
// The block rested on a claim the card recorded but never tested: that a
// query-less company search "returns nothing at full price". Apify run
// RidX3qBPdnjToMcqM disproved it — `industryIds:["104"] +
// locations:["United States"] + companySize:["11-50"]`, no `searchQuery`,
// returned 5/5 genuine US staffing agencies out of ~10,952 matches in 4.5s:
//
//   Remotivate, Odiin., Talentoma, LaTeam Partners, HireLATAM
//   — all "Staffing and Recruiting", all US.
//
// So `searchQuery` stays a NAME index (that finding stands, and
// `invalidCompanyNameQueryReason` still guards it), while the ACTOR is usable
// for concept discovery through structured filters.
//
// Industry ids come from the list the Actor's own input schema names as
// authoritative: HarvestAPI/linkedin-industry-codes-v2 (434 codes).
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  companySizeBandsFor,
  icpDiscoveryConstraints,
  industryIdsForVertical,
} from "../../../supabase/functions/_shared/icpDiscoveryConstraints.ts";
import {
  LINKEDIN_INDUSTRY_BY_LABEL,
  linkedinIndustryLabel,
} from "../../../supabase/functions/_shared/linkedinIndustryTaxonomy.ts";
import { STAFFING_INDUSTRY_IDS } from "../../../supabase/functions/_shared/companyAggregatorEvidence.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const missionFor = (query: string, profile: Record<string, unknown>) => {
  const m = parseLeadMissionDeterministic(query, {});
  return { ...m, company_profile: { ...m.company_profile, ...profile } } as typeof m;
};

// ── the taxonomy is the source's, not ours ─────────────────────────────────

Deno.test("the taxonomy agrees with the independently-derived staffing code", () => {
  // `STAFFING_INDUSTRY_IDS` was derived from observed enrichment output, long
  // before this table existed. Two independent derivations concurring is what
  // makes 104 trustworthy — and a divergence would mean one of them drifted.
  const fromTable = LINKEDIN_INDUSTRY_BY_LABEL.get("staffing and recruiting");
  assertEquals(fromTable, STAFFING_INDUSTRY_IDS[0]);
  assertEquals(linkedinIndustryLabel("104"), "Staffing and Recruiting");
});

// ── the three pinned requests ──────────────────────────────────────────────

Deno.test("'Find recruiting agencies matching my ICP' expresses its concept", () => {
  const m = missionFor("Find recruiting agencies matching my ICP.", {
    verticals: ["Recruiting / Talent Acquisition / Staffing Agencies"],
  });
  const c = icpDiscoveryConstraints(m);
  assert(c.expresses_concept, "a recruiting ICP must reach the search");
  assert(c.industryIds.includes("104"), `expected 104, got ${c.industryIds.join(",")}`);
  assertEquals(c.unmapped_verticals, []);
  // The probe's exact shape.
  assert(c.industryIds.length <= 20, "the Actor caps industryIds at 20");
});

Deno.test("'Find B2B SaaS companies in the UK' carries industry AND geography", () => {
  const m = missionFor("Find B2B SaaS companies in the UK.", {
    verticals: ["B2B SaaS"], locations: ["United Kingdom"],
  });
  const c = icpDiscoveryConstraints(m);
  assert(c.expresses_concept);
  assert(c.industryIds.includes("4"), "Software Development");
  assertEquals(c.locations, ["United Kingdom"]);
  // Geography is read WITHOUT requiring `geography_is_hard`: that flag governs
  // whether a location may REJECT a company, which is a qualification question.
  // Narrowing a search is not rejection.
  assertEquals(m.geography_is_hard ?? null, null);
});

Deno.test("the live Phase 8 ICP maps both of its verticals", () => {
  // The exact profile from the real workspace, which produced no_valid_step.
  const m = missionFor(
    "Find 3 companies matching my ICP that are actively hiring sales roles.", {
      verticals: [
        "B2B SaaS (founder-led or small teams)",
        "Recruiting / Talent Acquisition / Staffing Agencies",
      ],
      locations: [], stages: [],
    });
  const c = icpDiscoveryConstraints(m);
  assert(c.expresses_concept, "this is the mission that had no capable source");
  assert(c.industryIds.includes("104"), "the recruiting half");
  assert(c.industryIds.includes("4"), "the SaaS half");
  assertEquals(c.unmapped_verticals, []);
});

// ── THE NEGATIVE CASE: no expressible constraint, no unfiltered search ─────

Deno.test("an ICP with no expressible constraint does NOT become a search", () => {
  const m = missionFor("Find companies matching my ICP.", {
    verticals: ["blockchain vibes", "synergistic paradigms"],
    locations: [], business_models: [],
  });
  const c = icpDiscoveryConstraints(m);
  assertEquals(c.industryIds, [], "nothing may be guessed");
  assertEquals(c.expresses_concept, false);
  assertEquals(c.expressible, false, "an unfiltered LinkedIn search must not run");
  assertEquals(
    c.unmapped_verticals, ["blockchain vibes", "synergistic paradigms"],
    "the gap is reported, not silently dropped",
  );
});

Deno.test("geography or headcount alone REFINES, it does not SELECT", () => {
  // "AI startups in the United States" is the case that produced `AI Central`
  // and `Startup San Diego`: filtered by country, the population is still
  // arbitrary. Only an industry filter may lift the name-matcher refusal.
  const m = missionFor("Find AI startups in the United States.", {
    verticals: ["AI", "startup"], locations: ["United States"],
    employee_range: { min: 10, max: 500 },
  });
  const c = icpDiscoveryConstraints(m);
  assertEquals(c.industryIds, []);
  assertEquals(c.expresses_concept, false, "the CONCEPT is not in the search");
  assertEquals(c.expressible, true, "but a filter does exist");
  assert(c.locations.length > 0 && c.companySize.length > 0);
});

// ── mapping discipline ─────────────────────────────────────────────────────

Deno.test("an unknown vertical is reported, never rounded to a near industry", () => {
  assertEquals(industryIdsForVertical("blockchain vibes"), []);
  assertEquals(industryIdsForVertical(""), []);
});

Deno.test("'agency' alone is not advertising", () => {
  // A recruiting agency, a staffing agency and a creative agency share the word
  // and share no industry. Matching it put 80 Advertising Services on a
  // recruiting ICP — a wrong filter that looks right.
  const ids = industryIdsForVertical("recruiting agencies");
  assertEquals(ids.includes("80"), false, `got ${ids.join(",")}`);
  assert(ids.includes("104"));
});

Deno.test("'industrial' alone is too coarse; 'industrial automation' is precise", () => {
  assertEquals(industryIdsForVertical("industrial"), []);
  const ids = industryIdsForVertical("industrial automation integrators");
  assert(ids.includes("147"), "Automation Machinery Manufacturing");
  assertEquals(ids.includes("25"), false, "not all of Manufacturing");
});

Deno.test("multiple ICP industries are unioned and deduplicated", () => {
  const m = missionFor("Find companies matching my ICP.", {
    verticals: ["recruiting agencies", "staffing firms", "B2B SaaS"],
  });
  const c = icpDiscoveryConstraints(m);
  assertEquals(new Set(c.industryIds).size, c.industryIds.length, "no duplicates");
  assert(c.industryIds.includes("104") && c.industryIds.includes("4"));
});

Deno.test("employee_range maps to the Actor's verified size bands", () => {
  assertEquals(companySizeBandsFor({ min: 10, max: 50 }), ["1-10", "11-50"]);
  assertEquals(companySizeBandsFor({ min: null, max: null }), []);
  assertEquals(companySizeBandsFor(null), []);
  // The open-ended band must be reachable.
  assert(companySizeBandsFor({ min: 20000, max: null }).includes("10001+"));
});

Deno.test("every filter carries provenance back to the ICP field", () => {
  const m = missionFor("Find recruiting agencies in the US.", {
    verticals: ["recruiting agencies"], locations: ["United States"],
    employee_range: { min: 11, max: 50 },
  });
  const c = icpDiscoveryConstraints(m);
  for (const filter of ["industryIds", "locations", "companySize"]) {
    assert(
      c.provenance.some((p) => p.filter === filter),
      `${filter} must say which ICP field produced it`,
    );
  }
});
