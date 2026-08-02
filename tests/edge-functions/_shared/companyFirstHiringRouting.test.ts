// COMPANY-FIRST HIRING ROUTING — offline tests. Mocks and sanitized fixtures
// only: ZERO network, ZERO paid Actor runs, ZERO model calls.
//
// Numbered against the Prompt-3 test matrix.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FALLBACK_REASONS, ROUTE_SOURCES, actorLimitationBriefing, inferRouteFromRequest,
  newRouteExecutionRecord, recordExecutedSource, routeDrift, validateHiringRoute,
} from "../../supabase/functions/_shared/hiringRouteContract.ts";
import {
  advance, countsTowardQuota, evaluateCompanyFit, foundersSearchable,
  newCompanyRecord, projectFunnel,
} from "../../supabase/functions/_shared/companyFirstStages.ts";
import { identityIsActionable, identityIsPending, resolveIdentityAgainstLookups } from "../../supabase/functions/_shared/companyIdentityResolution.ts";
import { buildHarvestApiCompanyEmployeesInput, buildHarvestApiPeopleInput } from "../../supabase/functions/_shared/harvestApiPeople.ts";
import { compileSolidcodeYcInput, fanOutSolidcodeTeamSizes } from "../../supabase/functions/_shared/hiringActorInputs.ts";
import { judgeTitle } from "../../supabase/functions/_shared/hiringRolePackFilter.ts";
import { LINKEDIN_ENRICHED } from "../../supabase/functions/_shared/hiringActorFixtures.ts";
import { normalizeLinkedInCompanyEnriched } from "../../supabase/functions/_shared/hiringActorNormalizers.ts";

const CANONICAL = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const LI = (s: string) => `https://www.linkedin.com/company/${s}`;

// ═══ ROUTE SELECTION (1-5) ═════════════════════════════════════════════════
Deno.test("1. the canonical SaaS-startup query selects startup_company_first", () => {
  assertEquals(inferRouteFromRequest(CANONICAL), "startup_company_first");
  const r = validateHiringRoute({ route: "startup_company_first" }, { userRequest: CANONICAL });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.validated_route, "startup_company_first");
    // memo23 primary, solidcode fallback — the benchmark's ordering.
    assertEquals(r.validated_source_order[0], "apify_yc_companies_memo23");
    assertEquals(r.validated_source_order[1], "apify_yc_companies_solidcode");
  }
});

Deno.test("2. a general industry/geography query selects general_company_first", () => {
  const q = "Find cybersecurity companies in Germany with 50-200 employees hiring RevOps";
  assertEquals(inferRouteFromRequest(q), "general_company_first");
  const r = validateHiringRoute({ route: "general_company_first" }, { userRequest: q });
  assert(r.ok);
  if (r.ok) assertEquals(r.validated_source_order, ["apify_linkedin_company_search"]);
  // "SaaS" alone must NOT imply a startup — plenty of SaaS firms are enterprises.
  assertEquals(inferRouteFromRequest("Find SaaS companies hiring RevOps"), "general_company_first");
});

Deno.test("3. broad job boards never execute first for a tight ICP", () => {
  const r = validateHiringRoute({
    route: "startup_company_first",
    source_order: ["apify_indeed_jobs", "apify_glassdoor_jobs", "apify_yc_companies_memo23"],
  }, { userRequest: CANONICAL });
  assert(r.ok);
  if (r.ok) {
    for (const broad of ROUTE_SOURCES.broad_job_fallback) {
      assertFalse(r.validated_source_order.includes(broad),
        `${broad} must not appear on a company-first route`);
    }
    assertEquals(r.validated_source_order[0], "apify_yc_companies_memo23");
    assert(r.repairs.some((x) => x.startsWith("source_not_in_route_dropped:apify_indeed_jobs")));
  }
});

Deno.test("4. broad fallback REQUIRES a structured reason", () => {
  const none = validateHiringRoute({ route: "broad_job_fallback" });
  assertFalse(none.ok, "a job board with no recorded reason must be refused");
  if (!none.ok) assert(none.errors[0].includes("structured fallback_reason"));

  const bogus = validateHiringRoute({ route: "broad_job_fallback", fallback_reason: "felt_like_it" });
  assertFalse(bogus.ok);

  const good = validateHiringRoute({
    route: "broad_job_fallback", fallback_reason: "insufficient_company_fit_passes",
  });
  assert(good.ok);
  if (good.ok) {
    assertEquals(good.fallback_reason, "insufficient_company_fit_passes");
    // Even on the fallback route, enrichment is still mandatory.
    assertEquals(good.enrichment_required, true);
  }
  assertEquals(FALLBACK_REASONS.length, 7);
});

Deno.test("5. the validated source order reaches execution unchanged, and drift is detectable", () => {
  const v = validateHiringRoute({
    route: "startup_company_first", source_order: ["apify_yc_companies_memo23"],
  }, { userRequest: CANONICAL });
  assert(v.ok);
  if (!v.ok) return;
  const rec = newRouteExecutionRecord(v, ["apify_yc_companies_memo23"]);
  recordExecutedSource(rec, "apify_yc_companies_memo23");
  assertEquals(rec.executed_route, "startup_company_first");
  assertEquals(routeDrift(rec), [], "faithful execution must show no drift");

  // If the runtime silently ran something else, that must be visible.
  recordExecutedSource(rec, "apify_indeed_jobs");
  assert(routeDrift(rec).some((d) => d.includes("executed_unplanned_source:apify_indeed_jobs")));
  // requested / validated / executed stay three separate facts.
  assertEquals(rec.requested_route, "startup_company_first");
  assert(Array.isArray(rec.validated_source_order) && Array.isArray(rec.executed_source_order));
});

// ═══ YC ROUTE (6-13) ═══════════════════════════════════════════════════════
Deno.test("6/7. memo23 is primary and solidcode is fallback only", () => {
  const r = validateHiringRoute({
    route: "startup_company_first",
    source_order: ["apify_yc_companies_solidcode", "apify_yc_companies_memo23"],
  }, { userRequest: CANONICAL });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.validated_source_order[0], "apify_yc_companies_memo23");
    assert(r.repairs.some((x) => x.startsWith("solidcode_is_fallback_only_reordered")));
  }
});

Deno.test("8. a multi-size solidcode request fans out into single-size calls", () => {
  const bad = compileSolidcodeYcInput({ teamSize: ["2-10", "11-50"], maxResults: 25 });
  assertFalse(bad.ok, "the silent-empty combination must never be sent");
  const fan = fanOutSolidcodeTeamSizes({ isHiring: true, maxResults: 25 }, ["2-10", "11-50", "51-200"]);
  assertEquals(fan.length, 3);
  assert(fan.every((f) => f.ok));
  assertEquals(new Set(fan.map((f) => (f.ok ? f.batchIdentity : ""))).size, 3);
});

Deno.test("9/10. a YC candidate without a LinkedIn URL resolves, and a name-only match is PENDING", () => {
  // 9. memo23 supplies no LinkedIn URL, so identity resolution must run.
  const resolved = resolveIdentityAgainstLookups(
    { company_key: "yc:trademo", name: "Trademo", website: "https://trademo.com", canonical_domain: "trademo.com" },
    [{ name: "Trademo", linkedinUrl: LI("trademo"), website: "https://trademo.com" }],
  );
  assertEquals(resolved.status, "verified_match");
  assert(identityIsActionable(resolved));
  assert(resolved.evidence.some((e) => e.startsWith("exact_domain_match")));

  // 10. A similar NAME with no confirming domain is ambiguous — never a match.
  const ambiguous = resolveIdentityAgainstLookups(
    { company_key: "yc:triomics", name: "Triomics", website: null, canonical_domain: null },
    [{ name: "Triomics", linkedinUrl: LI("triomics-other"), website: "https://different.example" }],
  );
  assertEquals(ambiguous.status, "ambiguous");
  assertFalse(identityIsActionable(ambiguous), "an unconfirmed name must not reach founder search");
  assert(identityIsPending(ambiguous), "it stays pending evidence, not a rejection");

  const unresolved = resolveIdentityAgainstLookups(
    { company_key: "yc:ghost", name: "Ghost Co", website: null, canonical_domain: null }, []);
  assertEquals(unresolved.status, "unresolved");
  assert(identityIsPending(unresolved));
});

Deno.test("11. YC self-reported teamSize cannot satisfy the exact employee-count gate", () => {
  // ShipBob returned teamSize 1 while employing thousands.
  const fit = evaluateCompanyFit({
    company_key: "yc:shipbob", identity_status: "verified_match", enrichment_complete: true,
    employee_count: null, employee_range_advisory: "yc_self_reported:1",
    employee_min: 1, employee_max: 150, industry_ids: [],
  });
  assertEquals(fit.stage, "company_fit_pending");
  assert(fit.missing_evidence.some((m) => m.startsWith("employee_count_unknown")),
    "an advisory range must leave the size gate UNSATISFIED, not pass it");
});

Deno.test("12/13. open jobs are judged only after company-fit, and drive whether job-search runs", () => {
  const ycJobs = [{ title: "Applied AI Engineer" }, { title: "Head of Operations" }];
  // 12. company-fit reject => the jobs are never evaluated for qualification.
  const reject = evaluateCompanyFit({
    company_key: "c1", identity_status: "verified_match", enrichment_complete: true,
    employee_count: 4000, employee_range_advisory: null, employee_min: 1, employee_max: 150,
    industry_ids: [{ id: "4", name: "Software Development" }],
  });
  assertEquals(reject.stage, "company_fit_reject");
  assert(reject.failed_gates.includes("employee_count_above_max"));

  // 13. company-fit pass, but no YC job matches the pack => LinkedIn job-search
  //     is the escalation. With a matching YC job it would not be needed.
  const pass = evaluateCompanyFit({
    company_key: "c2", identity_status: "verified_match", enrichment_complete: true,
    employee_count: 82, employee_range_advisory: null, employee_min: 1, employee_max: 150,
    industry_ids: [{ id: "4", name: "Software Development" }],
    positive_industries: ["software development"],
  });
  assertEquals(pass.stage, "company_fit_pass");
  const ycHits = ycJobs.filter((j) =>
    ["exact_match", "approved_family_match"].includes(judgeTitle(j.title).disposition));
  assertEquals(ycHits.length, 0, "generic YC ops titles must not satisfy the Sales Ops pack");
  const needsLinkedInJobSearch = ycHits.length === 0;
  assert(needsLinkedInJobSearch);
});

// ═══ GENERAL ROUTE (16-20) ════════════════════════════════════════════════
Deno.test("16/17. employeeCountRange cannot satisfy size; enriched exact count controls it", () => {
  // Cisco Networking Academy: 4642 actual, range says 51-200.
  const wide = evaluateCompanyFit({
    company_key: "cisco-academy", identity_status: "verified_match", enrichment_complete: true,
    employee_count: 4642, employee_range_advisory: "51-200",
    employee_min: 11, employee_max: 200, industry_ids: [{ id: "4", name: "Software Development" }],
  });
  assertEquals(wide.stage, "company_fit_reject");
  assert(wide.failed_gates.includes("employee_count_above_max"),
    "the exact count must decide even when the advisory range says otherwise");

  const inRange = evaluateCompanyFit({
    company_key: "trademo", identity_status: "verified_match", enrichment_complete: true,
    employee_count: 147, employee_range_advisory: "51-200",
    employee_min: 11, employee_max: 200, industry_ids: [{ id: "4", name: "Software Development" }],
  });
  assertEquals(inRange.stage, "company_fit_pass");
});

Deno.test("18. the enriched industry hierarchy controls industry evidence", () => {
  const t = normalizeLinkedInCompanyEnriched(LINKEDIN_ENRICHED.find((c) => c.name === "Trademo")!);
  const ok = evaluateCompanyFit({
    company_key: "trademo", identity_status: "verified_match", enrichment_complete: true,
    employee_count: t.employee_count, employee_range_advisory: t.employee_range_advisory,
    industry_ids: t.industry_ids, positive_industries: ["software development"],
  });
  assertEquals(ok.stage, "company_fit_pass");
  const excluded = evaluateCompanyFit({
    company_key: "trademo", identity_status: "verified_match", enrichment_complete: true,
    employee_count: t.employee_count, employee_range_advisory: null,
    industry_ids: t.industry_ids, excluded_industries: ["software development"],
  });
  assertEquals(excluded.stage, "company_fit_reject");
  assert(excluded.failed_gates.includes("excluded_industry"));
});

Deno.test("19. a Swooped-style staffing candidate is rejected on structured evidence", () => {
  const s = normalizeLinkedInCompanyEnriched(LINKEDIN_ENRICHED.find((c) => c.name === "Swooped")!);
  const fit = evaluateCompanyFit({
    company_key: "swooped", identity_status: "verified_match", enrichment_complete: true,
    employee_count: s.employee_count, employee_range_advisory: s.employee_range_advisory,
    employee_min: 11, employee_max: 200, industry_ids: s.industry_ids,
    description: s.description, canonical_domain: s.canonical_domain,
  });
  assertEquals(fit.stage, "company_fit_reject");
  assertEquals(fit.reason, "staffing_or_aggregator");
  assertEquals(fit.aggregator.status, "supported");
  assert(fit.aggregator.source_refs.length > 0, "the exclusion must carry its evidence");
});

Deno.test("20. company-fit rejects never reach job verification", () => {
  const records = [
    (() => { let r = newCompanyRecord("reject"); r = advance(r, "company_fit_reject", "staffing_or_aggregator"); return r; })(),
    (() => { let r = newCompanyRecord("pass"); r = advance(r, "company_fit_pass", "ok"); return r; })(),
  ];
  const eligible = records.filter((r) => r.stage === "company_fit_pass");
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].company_key, "pass");
  // Rejects keep their reason rather than becoming an anonymous failure.
  assertEquals(records[0].stage_reason, "staffing_or_aggregator");
  assertEquals(foundersSearchable(records).length, 0, "no reject may reach founder search");
});

// ═══ HIRING VERIFICATION (23-25) ═════════════════════════════════════════
Deno.test("23/24/25. fuzzy titles are post-filtered; real ops titles qualify", () => {
  for (const bad of ["Enterprise Account Manager (Aviation)", "Operations Manager Trainee",
    "Head of Operations", "Account Manager", "Program Manager, Business Operations"]) {
    assertEquals(judgeTitle(bad).disposition, "irrelevant", `${bad} must not qualify`);
  }
  for (const good of ["Sales Operations Manager", "Revenue Operations Lead",
    "Head of GTM Operations", "Director of Revenue Operations"]) {
    assertEquals(judgeTitle(good).disposition, "exact_match", `${good} must qualify`);
  }
});

// ═══ FOUNDER ENUM — THROUGH THE REAL PRODUCTION BUILDER (29-32) ══════════
Deno.test("29. the REAL company-employees builder sends `Short ($4 per 1k)`", () => {
  // This is the function toolRegistry's input_adapter calls in production.
  const out = buildHarvestApiCompanyEmployeesInput({
    query: LI("trademo"), max_results: 10,
    user_input: { companies: [LI("trademo")], profileScraperMode: "Short",
      jobTitles: ["Founder", "Co-Founder", "CEO"], maxItemsPerCompany: 5 },
  });
  // The live schema field is `profileScraperMode` — `mode` alone was ignored by
  // the Actor, which then applied its own expensive default.
  assertEquals(out.profileScraperMode, "Short ($4 per 1k)");
  assertEquals(out.maxItemsPerCompany, 5);
  assertEquals(out.companies, [LI("trademo")]);
  // The legacy `mode` alias is translated, not passed through verbatim.
  assertEquals(out.mode, "Short ($4 per 1k)");
});

Deno.test("30. the REAL profile-search builder still sends plain `Short`", () => {
  const out = buildHarvestApiPeopleInput({
    query: "founders", max_results: 10,
    user_input: { profileScraperMode: "Short", currentCompanies: [LI("trademo")] },
  } as never);
  assertEquals(out.profileScraperMode, "Short",
    "profile-search must NOT receive the price-bearing enum");
});

Deno.test("31. email mode cannot be produced by the company-employees builder", () => {
  const out = buildHarvestApiCompanyEmployeesInput({
    query: LI("trademo"), max_results: 5,
    user_input: { companies: [LI("trademo")], profileScraperMode: "Full + email search" },
  });
  // The profile-search email spelling is not a company-employees value, so it is
  // not translated into one — the builder falls back rather than enabling email.
  assertFalse(String(out.profileScraperMode).includes("email"),
    "an email mode must never be produced by this route");
});

// ═══ QUOTA AND STAGE SEMANTICS (37-41, 43) ══════════════════════════════
Deno.test("37/38/39/40. only CONTACT + quota_eligible counts toward quota", () => {
  assertFalse(countsTowardQuota(null, true), "company_fit_pass is not a lead");
  assertFalse(countsTowardQuota("WATCH", true), "a qualified company is not a lead");
  assertFalse(countsTowardQuota("NEEDS_REVIEW", true), "a verified founder is not a lead");
  assertFalse(countsTowardQuota("CONTACT", false), "CONTACT without eligibility does not count");
  assertFalse(countsTowardQuota("REJECT", true));
  assertFalse(countsTowardQuota("SKIP", true));
  assert(countsTowardQuota("CONTACT", true), "only this counts");
});

Deno.test("41/43. the funnel exposes every stage and keeps qualified companies visible", () => {
  const mk = (key: string, stages: Array<[string, string]>, verdict: unknown, eligible: boolean) => {
    let r = newCompanyRecord(key);
    for (const [s, why] of stages) r = advance(r, s as never, why);
    r.verdict = verdict as never; r.quota_eligible = eligible;
    return r;
  };
  const records = [
    // Qualified but founder enrichment still pending — MUST stay visible.
    mk("q1", [["enrichment_complete", "e"], ["company_fit_pass", "ok"],
      ["hiring_verified", "job"], ["qualified_company", "q"], ["founder_pending", "searching"]], null, false),
    mk("c1", [["enrichment_complete", "e"], ["company_fit_pass", "ok"], ["hiring_verified", "job"],
      ["qualified_company", "q"], ["founder_verified", "v"], ["contact_pending", "p"]], "CONTACT", true),
    mk("r1", [["company_fit_reject", "staffing_or_aggregator"]], "REJECT", false),
    mk("p1", [["company_fit_pending", "identity_ambiguous"]], null, false),
  ];
  const f = projectFunnel(records);
  assertEquals(f.candidates_discovered, 4);
  assertEquals(f.qualified_companies, 2, "a qualified company pending a founder is still qualified");
  assertEquals(f.company_fit_pass, 2);
  assertEquals(f.company_fit_reject, 1);
  assertEquals(f.company_fit_pending, 1, "pending evidence stays visible, not hidden as a reject");
  assertEquals(f.founder_searched, 1);
  assertEquals(f.founder_verified, 1);
  assertEquals(f.contact_ready, 1);
  assertEquals(f.quota_counted, 1, "only the CONTACT counts");
});

Deno.test("42. stage transitions are idempotent and never move backwards", () => {
  let r = newCompanyRecord("c");
  r = advance(r, "company_fit_pass", "ok");
  r = advance(r, "qualified_company", "q");
  const before = r.stage;
  // A replayed earlier stage (a retry or resume) must not regress the record.
  r = advance(r, "enrichment_pending", "replayed");
  assertEquals(r.stage, before, "a resumed task must not walk the funnel backwards");
  assert(r.stage_reason.startsWith("refused_backwards_transition"));
});

// ═══ GPT CONTEXT (section 3) ═════════════════════════════════════════════
Deno.test("GPT receives the Actor limitations as content, not only as a hash", () => {
  const brief = actorLimitationBriefing();
  assertEquals(brief.length, 7, "all seven catalogued Actors must be briefed");
  const all = JSON.stringify(brief).toLowerCase();
  for (const required of [
    "linkedin company identity",        // memo23 has no LinkedIn URL
    "self-reported",                     // memo23 teamSize advisory
    "zero rows",                         // solidcode multi teamSize
    "enrichment is mandatory",           // company-search
    "company names, not concepts",       // searchQuery semantics
    "limit: company = 10",               // job-search batch limit
    "fuzzy",                             // job-search title matching
    "short ($4 per 1k)",                 // the enum difference
  ]) {
    assert(all.includes(required.toLowerCase()), `GPT must be told: ${required}`);
  }
});
