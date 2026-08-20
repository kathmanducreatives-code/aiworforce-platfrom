// "CURRENTLY HIRING" IS A COMPLETE REQUIREMENT.
//
// THE RUN THESE TESTS EXIST TO PREVENT — TEST plan
// 486928e8-9ae8-424a-9d37-4871dc8f0f97, 2026-08-20 16:09 UTC, build f914e52c.
//
// Mission: "Find 10 qualified AI startups in the US currently hiring."
// GPT compiled it as `required_signals: [{ type: "currently hiring" }]` — no
// role family, because the user named no role.
//
// Discovery worked. memo23 returned 100 US AI startups carrying 310 open jobs
// between them, 98 of the 100 with at least one opening. Then:
//
//     eligible_companies                0
//     technical_only                   78
//     insufficient_commercial          22
//     companies_with_commercial_roles   0
//     technical_roles_satisfy_signal    false
//
// Nothing was shortlisted, nothing was enriched, nothing reached the Company
// Brain, and the run reported "0 of 10 qualified" as though the pool had been
// bad. It had not been. The pool was exactly what the user asked for.
//
// TWO DEFECTS, both here:
//
//   1. `technical_roles_satisfy_signal` fires only when the mission NAMES an
//      engineering role family. An unqualified "currently hiring" names none,
//      so every technical-only company was judged by a commercial-roles rule
//      the user never invoked.
//   2. Even a mission whose signal type was the literal string "hiring" hit
//      the same wall — the 09:57 and 10:36 runs the same morning did, with 65
//      and 81 technical_only. So this is not a wording accident; it is the
//      rule itself.
//
// THE RULE THESE TESTS FIX IN PLACE. When a mission requires hiring and
// constrains no role family, the user has constrained the COMPANY, not the
// vacancy. Any opening is the evidence. When a mission DOES name a family,
// nothing changes — an engineering opening still proves nothing about GTM
// expansion.
//
// These tests drive the REAL functions. No network, provider, model or DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  prequalifyYcCompanies, type YcCompanyInput,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";
import { applyPrequalification } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { floorFailure } from "../../../supabase/functions/_shared/opportunityPortfolio.ts";

/**
 * Six rows in the shape memo23 returned them, covering every case the run hit.
 *
 * `Anara` and `AfterQuery` are verbatim from the failing run's
 * `prequalification.companies`, down to the team size.
 */
const ROWS: YcCompanyInput[] = [
  // TECHNICAL ONLY — 78 of the 100 looked like this.
  { name: "Anara", website: "https://anara.com", teamSize: 5, industries: ["B2B"],
    openJobs: [
      { title: "Software Engineer" },
      { title: "Founding Engineer" },
      { title: "Machine Learning Engineer" },
    ] },
  { name: "AfterQuery", website: "https://afterquery.com", teamSize: 30, industries: ["B2B"],
    openJobs: [
      { title: "Backend Engineer" }, { title: "Frontend Engineer" },
      { title: "Infrastructure Engineer" }, { title: "Research Engineer" },
    ] },
  // OPEN ROLES THAT CLASSIFY AS NEITHER — the 20 companies inside the 22
  // `insufficient_commercial`. They ARE hiring; the ladder has no rung for it.
  { name: "Clicks Health", website: "https://goclicks.ai", teamSize: 8, industries: ["B2B"],
    openJobs: [{ title: "Data Scientist" }, { title: "Clinical Operations Lead" }] },
  // GENUINELY NOT HIRING — the 2 companies with no openings at all. These must
  // stay ineligible under every policy; "any open role" is not "no role".
  { name: "a0.dev", website: "https://a0.dev", teamSize: 3, industries: ["B2B"], openJobs: [] },
  // COMMERCIAL — eligible under every policy, including the missionless one.
  { name: "Growthside", website: "https://growthside.io", teamSize: 40, industries: ["B2B"],
    openJobs: [{ title: "Head of Sales" }, { title: "Software Engineer" }] },
];

const byName = (r: ReturnType<typeof prequalifyYcCompanies>, name: string) => {
  const c = r.companies.find((x) => x.name === name);
  assert(c, `expected ${name} in the prequalification result`);
  return c!;
};

// ═══ 1. THE UNQUALIFIED HIRING MISSION ═════════════════════════════════════

Deno.test("486928e8: 'currently hiring' with no role named accepts ANY opening", () => {
  const r = prequalifyYcCompanies(ROWS, {}, { any_open_role_satisfies_signal: true });

  assertEquals(byName(r, "Anara").eligible, true, "3 engineering openings IS hiring");
  assertEquals(byName(r, "AfterQuery").eligible, true);
  assertEquals(byName(r, "Clicks Health").eligible, true,
    "a Data Scientist opening is an opening; the ladder not having a rung for it is not the user's problem");
  assertEquals(byName(r, "Growthside").eligible, true);

  assertEquals(r.eligible_companies, 4,
    "four of the five are hiring — the run found 98 of 100 and qualified none of them");
  assertEquals(r.technical_only_companies, 0);
  assertEquals(r.any_open_role_satisfies_signal, true);
});

Deno.test("486928e8: a company with NO openings is still ineligible", () => {
  const r = prequalifyYcCompanies(ROWS, {}, { any_open_role_satisfies_signal: true });
  const idle = byName(r, "a0.dev");
  assertEquals(idle.eligible, false, "'any open role' is not 'no role'");
  assertEquals(idle.exclusion, "insufficient_commercial");
  assertEquals(idle.has_open_roles, false);
});

Deno.test("486928e8: the stated reason agrees with the verdict", () => {
  const accepted = byName(
    prequalifyYcCompanies(ROWS, {}, { any_open_role_satisfies_signal: true }), "Anara");
  assert(
    accepted.reasons.some((x) => x.includes("the mission accepts these as hiring evidence")),
    `an eligible company must not be told its roles are "not commercial evidence": ${
      JSON.stringify(accepted.reasons)}`,
  );

  const refused = byName(prequalifyYcCompanies(ROWS, {}, {}), "Anara");
  assert(
    refused.reasons.some((x) => x.includes("not commercial evidence")),
    "under the commercial-only rule the original sentence is the true one",
  );
});

// ═══ 2. THE NARROWER MISSIONS ARE UNCHANGED ════════════════════════════════

Deno.test("a mission naming ENGINEERING families keeps the technical rule", () => {
  const r = prequalifyYcCompanies(ROWS, {}, { technical_roles_satisfy_signal: true });
  assertEquals(byName(r, "Anara").eligible, true, "engineering openings were asked for");
  assertEquals(byName(r, "Clicks Health").eligible, false,
    "a Data Scientist opening is not evidence of the engineering hiring this mission named");
  assertEquals(r.any_open_role_satisfies_signal, false);
});

Deno.test("a mission naming COMMERCIAL families still excludes technical-only", () => {
  // Neither flag: what a sales-hiring mission derives.
  const r = prequalifyYcCompanies(ROWS, {}, {});
  assertEquals(byName(r, "Anara").eligible, false);
  assertEquals(byName(r, "Anara").exclusion, "technical_only");
  assertEquals(byName(r, "Growthside").eligible, true, "Head of Sales is Tier A");
  assertEquals(r.eligible_companies, 1);
});

Deno.test("a MISSIONLESS run is byte-identical to the old behaviour", () => {
  const withoutPolicy = prequalifyYcCompanies(ROWS, {});
  const explicitlyOff = prequalifyYcCompanies(ROWS, {}, {
    any_open_role_satisfies_signal: false, technical_roles_satisfy_signal: false,
  });
  assertEquals(
    withoutPolicy.companies.map((c) => [c.name, c.eligible, c.exclusion]),
    explicitlyOff.companies.map((c) => [c.name, c.eligible, c.exclusion]),
  );
  assertEquals(withoutPolicy.eligible_companies, 1);
  assertEquals(withoutPolicy.any_open_role_satisfies_signal, false);
});

// ═══ 3. THE DERIVATION — WHAT THE ENGINE READS OFF THE MISSION ═════════════
//
// The tests above pin the POLICY. These pin the step that chooses it, which is
// where the run actually went wrong: the policy was already capable of
// accepting technical roles, and the derivation never turned it on.

const derive = (
  requiredSignals: ReadonlyArray<{ type?: string; role_families?: string[] }> | null,
) => applyPrequalification(
  {} as never, [], ROWS, { min: null, max: null }, null, requiredSignals,
);

Deno.test("derivation: the run's own signal — {type:'currently hiring'} — enables it", () => {
  const r = derive([{ type: "currently hiring" }]);
  assertEquals(r.any_open_role_satisfies_signal, true,
    "this is the exact signal object plan 486928e8 recorded");
  assertEquals(r.eligible_companies, 4, "the run reported 0 of 100");
});

Deno.test("derivation: the literal 'hiring' with no family enables it too", () => {
  // The 09:57 and 10:36 runs on 2026-08-20 compiled this and still qualified
  // nobody, which is why the fix cannot be a wording fix alone.
  assertEquals(derive([{ type: "hiring" }]).any_open_role_satisfies_signal, true);
});

Deno.test("derivation: a named ENGINEERING family takes the narrower rule", () => {
  const r = derive([{ type: "hiring", role_families: ["software engineering"] }]);
  assertEquals(r.technical_roles_satisfy_signal, true);
  assertEquals(r.any_open_role_satisfies_signal, false,
    "the user constrained the vacancy, so the vacancy is checked");
});

Deno.test("derivation: a named COMMERCIAL family enables neither", () => {
  const r = derive([{ type: "hiring", role_families: ["sales"] }]);
  assertEquals(r.technical_roles_satisfy_signal, false);
  assertEquals(r.any_open_role_satisfies_signal, false);
  assertEquals(r.eligible_companies, 1, "only the company hiring a Head of Sales");
});

// ═══ 4. THE FLOOR ONE LAYER OUT ════════════════════════════════════════════
//
// Making a company eligible is worth nothing if the portfolio floor deletes it
// afterwards. `has_factual_signal` asked whether a COMMERCIAL role was found,
// so an eligible technical-only company would have been dropped as
// `no_factual_signal` — turning "0 qualified" into "0 delivered" one stage
// later, with the same answer for the user.

Deno.test("floor: an eligible technical-only company carries a factual signal", () => {
  const pq = byName(
    prequalifyYcCompanies(ROWS, {}, { any_open_role_satisfies_signal: true }), "Anara");
  const candidate = {
    company_key: pq.company_key, company_name: pq.name, domain: pq.canonical_domain,
    tier: pq.best_tier, brain: "qualified" as const,
    identity_status: "verified_match" as const, active: true,
    geography_ok: true, b2b_use_case: true,
    // The projection `toPortfolioCandidates` now builds for this company.
    has_factual_signal: pq.best_tier !== null || pq.eligible,
    source_evidence: true, source_url: `https://${pq.canonical_domain}`,
    contact_ready: false, round: null, score: pq.score,
  };
  assertEquals(pq.best_tier, null, "the commercial vocabulary recognised none of its openings");
  assertEquals(candidate.has_factual_signal, true, "three open engineering roles ARE a fact");
  assertEquals(floorFailure(candidate), null,
    "a Brain-qualified company with open roles must reach the portfolio");
});

Deno.test("floor: a company with no openings and no tier is still floored", () => {
  const pq = byName(
    prequalifyYcCompanies(ROWS, {}, { any_open_role_satisfies_signal: true }), "a0.dev");
  assertEquals(floorFailure({
    company_key: pq.company_key, company_name: pq.name, domain: pq.canonical_domain,
    tier: pq.best_tier, brain: null, identity_status: "unresolved", active: true,
    geography_ok: true, b2b_use_case: true,
    has_factual_signal: pq.best_tier !== null || pq.eligible,
    source_evidence: true, source_url: null, contact_ready: false, round: null, score: pq.score,
  }), "no_factual_signal");
});

Deno.test("derivation: a mission with NO hiring signal enables neither", () => {
  for (const signals of [null, [], [{ type: "funding" }]]) {
    const r = derive(signals);
    assertEquals(r.any_open_role_satisfies_signal, false,
      `a funding mission must not accept an engineering opening: ${JSON.stringify(signals)}`);
    assertEquals(r.technical_roles_satisfy_signal, false);
  }
});
