// OFFLINE ADAPTER TESTS. Mocked Actor responses only — ZERO network, ZERO paid runs.
//
// Each test corresponds to a numbered requirement in the Prompt-2 brief and to
// a finding in the 2026-08-01 benchmark. Where a test asserts a limitation, the
// point is that the limitation is ENFORCED, not merely documented.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  COMPANY_EMPLOYEES_SCRAPER_MODES, HIRING_ACTOR_CATALOG, PROFILE_SEARCH_SCRAPER_MODES,
  actorsRequiringEnrichment, hiringActorCard,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  compileHarvestCompanyDetailsInput, compileHarvestCompanyEmployeesInput,
  compileHarvestCompanySearchInput, compileHarvestJobSearchInput,
  compileHarvestProfileSearchInput, compileMemo23YcInput, compileSolidcodeYcInput,
  fanOutSolidcodeTeamSizes,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  dedupeJobs, dedupePeople, normalizeHarvestPerson, normalizeLinkedInCompanyCandidate,
  normalizeLinkedInCompanyEnriched, normalizeLinkedInJob, normalizeMemo23Company,
  normalizeMemo23OpenJobs, normalizeSolidcodeCompany,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { extractAggregatorEvidence, postingProvesEmployer } from "../../../supabase/functions/_shared/companyAggregatorEvidence.ts";
import {
  DEFAULT_ROLE_PACKS, REVENUE_OPS_PACK, SALES_OPS_PACK, filterJobsByPacks,
  filterJobsForPack, judgeTitle, judgeTitleForPack,
} from "../../../supabase/functions/_shared/hiringRolePackFilter.ts";
import {
  COMPANY_EMPLOYEES, LINKEDIN_CANDIDATES, LINKEDIN_ENRICHED, LINKEDIN_JOBS_CONTROL,
  LINKEDIN_JOBS_PACK_B, MEMO23_COMPANIES, PROFILE_SEARCH, SOLIDCODE_COMPANIES,
} from "../../../supabase/functions/_shared/hiringActorFixtures.ts";

const LI = (slug: string) => `https://www.linkedin.com/company/${slug}`;

// ═══ 1. memo23 normalizes companies, open jobs and YC evidence ═══════════════
Deno.test("1. memo23 normalizes company, YC evidence and embedded open jobs", () => {
  const row = MEMO23_COMPANIES[0];
  const c = normalizeMemo23Company(row);
  assert(c.external_source_id.startsWith("yc_memo23:"), "source id must be namespaced");
  assert(c.company_name && c.website && c.description);
  assertEquals(c.hiring_status, true);
  const ev = c.startup_evidence as Record<string, unknown>;
  assertEquals(ev.source, "y_combinator");
  assert(ev.yc_batch, "YC batch is the startup evidence that justifies this route");
  // YC's "B2B" is a YC vertical, NOT a canonical industry.
  assertEquals(c.provider_industry, null);
  assertEquals(ev.yc_vertical, "B2B");

  const jobs = normalizeMemo23OpenJobs(row);
  assert(jobs.length > 0, "fixture must carry open jobs");
  assert(jobs[0].job_id?.startsWith("yc_memo23:"));
  assert(jobs[0].title && jobs[0].job_url);
  // postedAgo is relative; converting without the run clock would be a guess.
  assertEquals(jobs[0].posted_date, null);
  assert(jobs[0].missing_fields.some((m) => m.startsWith("posted_date:")));
});

// ═══ 2. memo23 missing LinkedIn URL stays unknown ════════════════════════════
Deno.test("2. memo23 supplies no LinkedIn URL and never invents one", () => {
  for (const row of MEMO23_COMPANIES) {
    const c = normalizeMemo23Company(row);
    assertEquals(c.linkedin_company_url, null);
    assert(c.missing_fields.includes("linkedin_company_url:absent_from_actor_schema"),
      "absence must be recorded as a schema fact, not silent");
  }
  const card = hiringActorCard("apify_yc_companies_memo23")!;
  assert(card.not_for.some((x) => x.toLowerCase().includes("linkedin")));
  assert(card.known_defects.some((d) => d.id === "memo23_no_linkedin_url"));
});

// ═══ 3. memo23 stale teamSize is not authoritative ═══════════════════════════
Deno.test("3. memo23 teamSize is advisory only — never an exact employee count", () => {
  const c = normalizeMemo23Company({ ...MEMO23_COMPANIES[0], teamSize: 1 });
  assertEquals(c.employee_count, null, "self-reported YC size must never become exact headcount");
  assertEquals(c.employee_range_advisory, "yc_self_reported:1");
  assertEquals(c.field_trust.employee_range_advisory, "unsafe");
  assert(c.missing_fields.some((m) => m.startsWith("employee_count:")));
});

// ═══ 4. solidcode rejects multi-value teamSize BEFORE execution ══════════════
Deno.test("4. solidcode multi-value teamSize is rejected before any call", () => {
  const r = compileSolidcodeYcInput({
    regions: ["United States of America"], industries: ["B2B"], isHiring: true,
    teamSize: ["1", "2-10", "11-50", "51-200"], maxResults: 50,
  });
  assertFalse(r.ok, "the silent-empty combination must never be sent");
  if (!r.ok) {
    assert(r.errors.some((e) => e.includes("ZERO rows")),
      "the error must explain WHY, since the Actor reports it as 'no matches'");
  }
});

// ═══ 5. solidcode single-value teamSize compiles ═════════════════════════════
Deno.test("5. solidcode single teamSize compiles, and fan-out produces valid calls", () => {
  const ok = compileSolidcodeYcInput({
    regions: ["United States of America"], industries: ["B2B"], isHiring: true,
    teamSize: ["11-50"], maxResults: 50,
  });
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.actorId, "solidcode/ycombinator-scraper");
    assert(ok.inputHash.length === 8);
    assert(ok.batchIdentity.includes("11-50"), "the band must be identifiable in the batch id");
  }
  const fan = fanOutSolidcodeTeamSizes(
    { regions: ["United States of America"], isHiring: true, maxResults: 25 },
    ["1", "2-10", "11-50", "51-200"],
  );
  assertEquals(fan.length, 4);
  assert(fan.every((f) => f.ok), "every fanned-out call must be valid");
  const ids = new Set(fan.map((f) => (f.ok ? f.batchIdentity : "")));
  assertEquals(ids.size, 4, "each band must be separately identified");
});

// ═══ 6. company-search output is candidate-only ══════════════════════════════
Deno.test("6. LinkedIn company-search output is marked candidate-only", () => {
  const c = normalizeLinkedInCompanyCandidate(LINKEDIN_CANDIDATES[0]);
  assertEquals(c.candidate_only, true);
  assertEquals(c.source_provenance, "harvestapi/linkedin-company-search");
  assert(actorsRequiringEnrichment().includes("apify_linkedin_company_search"));
  assertEquals(
    HIRING_ACTOR_CATALOG.apify_linkedin_company_search.requires_enrichment_before_qualification, true);
});

// ═══ 7. employeeCountRange cannot override exact employeeCount ═══════════════
Deno.test("7. employeeCountRange is advisory and never overrides the exact count", () => {
  // Cisco Networking Academy: 4642 actual, tagged 51-200 by the range.
  const wide = LINKEDIN_CANDIDATES.find((c) =>
    typeof c.employeeCount === "number" && (c.employeeCount as number) > 500);
  assert(wide, "fixture must contain the contradicting row");
  const c = normalizeLinkedInCompanyCandidate(wide!);
  assertEquals(c.employee_count, wide!.employeeCount);
  assert(c.employee_range_advisory && c.employee_range_advisory !== String(c.employee_count));
  assertEquals(c.field_trust.employee_range_advisory, "unsafe");
  assertEquals(c.field_trust.employee_count, "direct");
  // They are separate fields — a consumer cannot accidentally read one for the other.
  assert(c.employee_count! > 500 && c.employee_range_advisory!.includes("51-200"));
});

// ═══ 8. company-search industry cannot satisfy Company Brain ═════════════════
Deno.test("8. candidate provider_industry is untrusted and demands enrichment", () => {
  const c = normalizeLinkedInCompanyCandidate(LINKEDIN_CANDIDATES[0]);
  assertEquals(c.field_trust.provider_industry, "unsafe");
  assert(c.missing_fields.some((m) => m.startsWith("provider_industry:")));
  const compiled = compileHarvestCompanySearchInput({
    industryIds: ["4"], companySize: ["11-50"], scraperMode: "short", maxItems: 20,
  });
  assert(compiled.ok);
  if (compiled.ok) {
    assert(compiled.warnings.some((w) => w.includes("not proof of industry")));
    assert(compiled.warnings.some((w) => w.includes("CANDIDATES ONLY")));
  }
});

// ═══ 9. enrichment maps exact count and industry hierarchy ══════════════════
Deno.test("9. enrichment supplies exact employeeCount and industry id + hierarchy", () => {
  const rows = LINKEDIN_ENRICHED.map(normalizeLinkedInCompanyEnriched);
  const trademo = rows.find((r) => r.company_name === "Trademo")!;
  assertEquals(trademo.employee_count, 147);
  assertEquals(trademo.field_trust.employee_count, "direct");
  assertEquals(trademo.industry_ids[0].id, "4");
  assertEquals(trademo.industry_ids[0].name, "Software Development");
  assert(trademo.industry_ids[0].hierarchy?.includes("Software Development"));
  assert(trademo.linkedin_company_url && trademo.website && trademo.description);
  assertEquals(trademo.company_type, "Privately Held");
  // foundedOn is unreliable — where absent it must be declared missing.
  const noFounded = rows.filter((r) => r.startup_evidence === null);
  assert(noFounded.every((r) => r.missing_fields.some((m) => m.startsWith("founded_year:"))));
});

// ═══ 10. staffing evidence from the Swooped-style fixture ═══════════════════
Deno.test("10. enriched staffing industry yields SUPPORTED aggregator evidence", () => {
  const swooped = LINKEDIN_ENRICHED.find((c) => c.name === "Swooped")!;
  const c = normalizeLinkedInCompanyEnriched(swooped);
  const ev = extractAggregatorEvidence({
    company_name: c.company_name, industry_ids: c.industry_ids,
    description: c.description, canonical_domain: c.canonical_domain,
  });
  assertEquals(ev.status, "supported");
  assert(ev.signals.some((s) => s.code === "enriched_industry_staffing" && s.strength === "strong"));
  assert(ev.source_refs.includes("enrichment:industry_ids"));
  // A genuine software company must stay clean.
  const trademo = normalizeLinkedInCompanyEnriched(
    LINKEDIN_ENRICHED.find((x) => x.name === "Trademo")!);
  const clean = extractAggregatorEvidence({
    company_name: trademo.company_name, industry_ids: trademo.industry_ids,
    description: trademo.description, canonical_domain: trademo.canonical_domain,
  });
  assertEquals(clean.status, "absent");
});

Deno.test("10b. a single weak keyword yields POSSIBLE, never SUPPORTED", () => {
  const ev = extractAggregatorEvidence({
    company_name: "Acme Software", provider_industry: "Staffing and Recruiting",
  });
  assertEquals(ev.status, "possible", "one unreliable label must not condemn a company");
});

// ═══ 11. job search batches no more than 10 companies ═══════════════════════
Deno.test("11. job-search rejects more than 10 companies per call", () => {
  const cos = Array.from({ length: 11 }, (_, i) => LI(`c${i}`));
  const bad = compileHarvestJobSearchInput({
    company: cos, jobTitles: ["Revenue Operations Manager"], maxItems: 5, postedLimit: "month",
  });
  assertFalse(bad.ok);
  if (!bad.ok) assert(bad.errors.some((e) => e.includes("verified limit of 10")));

  const ok = compileHarvestJobSearchInput({
    company: cos.slice(0, 10), jobTitles: ["Revenue Operations Manager"],
    maxItems: 5, postedLimit: "month",
  });
  assert(ok.ok);
});

// ═══ 12. role packs remain separate ════════════════════════════════════════
Deno.test("12. packs are evaluated separately and never merged", () => {
  const results = filterJobsByPacks(
    [{ title: "Revenue Operations Manager" }, { title: "Sales Operations Lead" }],
    DEFAULT_ROLE_PACKS);
  assertEquals(results.length, 3);
  const rev = results.find((r) => r.pack_id === "revenue_operations")!;
  const sales = results.find((r) => r.pack_id === "sales_operations")!;
  assertEquals(rev.kept.length, 1);
  assertEquals(rev.kept[0].title, "Revenue Operations Manager");
  assertEquals(sales.kept.length, 1);
  assertEquals(sales.kept[0].title, "Sales Operations Lead");
  // A Sales-Ops title must NOT satisfy the Revenue-Ops pack.
  assertEquals(judgeTitleForPack("Sales Operations Lead", REVENUE_OPS_PACK).disposition, "irrelevant");
});

// ═══ 13. fuzzy false positives are rejected ════════════════════════════════
Deno.test("13. real benchmark false positives are rejected deterministically", () => {
  const falsePositives = [
    "Enterprise Account Manager (Aviation)", "Account Manager, Small and Medium Business Growth",
    "Operation Manager Trainee", "Sales Development Representative",
    "Head of Operations", "Senior Director, Support Operations",
    "Program Manager, Business Operations", "Director, Chief of Staff & Business Operations",
  ];
  for (const t of falsePositives) {
    assertEquals(judgeTitle(t).disposition, "irrelevant", `"${t}" must not count as an ops-pack role`);
  }
  for (const t of SALES_OPS_PACK.titles) {
    assertEquals(judgeTitle(t).disposition, "exact_match");
  }
  assertEquals(judgeTitle("Senior Revenue Operations Manager").disposition, "approved_family_match");
  assertEquals(judgeTitle("Revenue Operations Analyst").disposition, "adjacent_role");

  // Against the REAL control fixture: the Actor's fuzzy output is mostly noise.
  const judged = LINKEDIN_JOBS_CONTROL.map((j) => judgeTitle(j.title as string));
  const kept = judged.filter((j) => j.disposition === "exact_match" || j.disposition === "approved_family_match");
  assert(kept.length < LINKEDIN_JOBS_CONTROL.length,
    "the post-filter must discard fuzzy matches the Actor returned");
});

// ═══ 14. company-scoped job results preserve company identity ══════════════
Deno.test("14. normalized jobs keep the posting company's identity", () => {
  const jobs = LINKEDIN_JOBS_PACK_B.map(normalizeLinkedInJob);
  for (const j of jobs) {
    assert(j.company_name, "company name must survive normalization");
    assert(j.company_linkedin_url?.includes("linkedin.com/company/"));
    assert(j.company_source_id?.startsWith("li_company:"));
  }
  // The Actor returned 25% duplicate rows; dedupe is by job id.
  const deduped = dedupeJobs(jobs);
  assert(deduped.length < jobs.length, "duplicate rows must be collapsed");
  assertEquals(new Set(deduped.map((d) => d.job_id)).size, deduped.length);
});

// ═══ 15. aggregator postings do not prove the posting company employs ══════
Deno.test("15. aggregator postings do not prove the posting company is the employer", () => {
  const jobs = LINKEDIN_JOBS_PACK_B.map(normalizeLinkedInJob);
  const swooped = LINKEDIN_ENRICHED.find((c) => c.name === "Swooped")!;
  const c = normalizeLinkedInCompanyEnriched(swooped);
  const ev = extractAggregatorEvidence({
    company_name: c.company_name, industry_ids: c.industry_ids, description: c.description,
    postings: jobs.map((j) => ({ job_id: j.job_id, title: j.title, description: j.description })),
  });
  assertEquals(ev.status, "supported");
  assertFalse(postingProvesEmployer(ev),
    "a posting from an aggregator must never establish the company as the employer");
  // The behavioural tells are present, not just the industry code.
  const codes = ev.signals.map((s) => s.code);
  assert(codes.includes("anonymised_third_party_postings") ||
    codes.includes("multiple_unrelated_employers"),
    `expected a posting-derived signal, got ${codes.join(",")}`);
  // A clean company with normal postings passes.
  assert(postingProvesEmployer(extractAggregatorEvidence({ company_name: "Trademo" })));
});

// ═══ 16 & 17. THE TWO SHORT ENUMS ARE NOT INTERCHANGEABLE ══════════════════
Deno.test("16. company-employees compiles ONLY its own price-bearing Short enum", () => {
  const ok = compileHarvestCompanyEmployeesInput({
    companies: [LI("trademo")], jobTitles: ["Founder", "Co-Founder", "CEO"],
    profileScraperMode: "Short ($4 per 1k)", companyBatchMode: "all_at_once",
    maxItems: 15, maxItemsPerCompany: 5,
  });
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.input.profileScraperMode, "Short ($4 per 1k)");
    assertEquals(ok.cost.per_result_usd, 0.003);
  }
  // The sibling Actor's value must be rejected WITH the reason.
  const wrong = compileHarvestCompanyEmployeesInput({
    companies: [LI("trademo")], profileScraperMode: "Short" as never, maxItems: 5,
  });
  assertFalse(wrong.ok);
  if (!wrong.ok) {
    assert(wrong.errors.some((e) => e.includes("linkedin-profile-search enum")),
      "the error must name the confusion, since the platform accepts it silently");
  }
});

Deno.test("17. profile-search compiles ONLY its own plain Short enum", () => {
  const ok = compileHarvestProfileSearchInput({
    currentCompanies: [LI("trademo")], currentJobTitles: ["Founder", "CEO"],
    profileScraperMode: "Short", maxItems: 15,
  });
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.input.profileScraperMode, "Short");
  const wrong = compileHarvestProfileSearchInput({
    profileScraperMode: "Short ($4 per 1k)" as never, maxItems: 5,
  });
  assertFalse(wrong.ok);
  if (!wrong.ok) assert(wrong.errors.some((e) => e.includes("company-employees enum")));
  // And the two constants genuinely differ — the root of the whole trap.
  assertFalse((PROFILE_SEARCH_SCRAPER_MODES as readonly string[])
    .includes(COMPANY_EMPLOYEES_SCRAPER_MODES[0]));
});

// ═══ 18. founder results preserve employer evidence ════════════════════════
Deno.test("18. founder rows keep currentPositions employer evidence", () => {
  const people = COMPANY_EMPLOYEES.map((p) =>
    normalizeHarvestPerson(p, "harvestapi/linkedin-company-employees"));
  // A deliberately tight founder test. A loose /founder/ regex also matches
  // "Director - Strategic Initiatives (Founder's Office)", which is the same
  // fuzzy-title trap the job post-filter exists to close.
  const founders = people.filter((p) =>
    /^(co-?)?founder\b|^chief executive officer$|\bceo\b/i.test(p.title ?? ""));
  assert(founders.length >= 5, `fixture must carry founder rows, got ${founders.length}`);
  for (const f of founders) {
    // REQUIRED evidence — employer verification cannot run without these.
    assert(f.current_employer, "employer name is required for verification");
    assert(f.current_employer_linkedin_url?.includes("linkedin.com/company/"),
      "employer LinkedIn identity is required");
    assertEquals(f.current_employer_is_current, true);
    assert(f.source_profile_id, "the stable dedupe key is required");
    // OPTIONAL evidence — tenure was genuinely absent for 2 of 8 live founders,
    // so requiring it would be asserting against the data.
    assert(f.tenure_years === null || typeof f.tenure_years === "number");
  }
  assert(founders.some((f) => f.tenure_years === null),
    "the fixture keeps a real null-tenure row so this stays honest");
});

// ═══ 19. dedupe by stable profile ID, not URL ══════════════════════════════
Deno.test("19. people deduplicate on the stable profile id", () => {
  const a = COMPANY_EMPLOYEES.map((p) => normalizeHarvestPerson(p, "employees"));
  const b = PROFILE_SEARCH.map((p) => normalizeHarvestPerson(p, "profile-search"));
  // Both Actors returned the same people in the benchmark (10/10 overlap).
  const merged = dedupePeople([...a, ...b]);
  assertEquals(merged.length, a.length, "the same person from two Actors must collapse to one");
  // Same id under two different URL forms must still collapse.
  const dupUrl = dedupePeople([
    { ...a[0] },
    { ...a[0], linkedin_url: "https://www.linkedin.com/in/vanity-slug" },
  ]);
  assertEquals(dupUrl.length, 1, "dedupe must key on id, not the URL form");
  assert(a[0].source_profile_id, "the stable id must be present");
});

// ═══ 20. no adapter enables email/phone enrichment ═════════════════════════
Deno.test("20. every compiler refuses email enrichment", () => {
  const e1 = compileHarvestCompanyEmployeesInput({
    companies: [LI("trademo")], profileScraperMode: "Full + email search ($12 per 1k)", maxItems: 5,
  });
  assertFalse(e1.ok);
  if (!e1.ok) assert(e1.errors.some((x) => x.includes("email search mode is forbidden")));

  const e2 = compileHarvestProfileSearchInput({
    profileScraperMode: "Full + email search", maxItems: 5,
  });
  assertFalse(e2.ok);
  if (!e2.ok) assert(e2.errors.some((x) => x.includes("email search mode is forbidden")));

  const e3 = compileMemo23YcInput({ mode: "companies", maxItems: 10, enrichEmails: true as never });
  assertFalse(e3.ok);
  if (!e3.ok) assert(e3.errors.some((x) => x.includes("enrichEmails is forbidden")));

  // The happy path must actively pin enrichEmails to false, not merely omit it.
  const ok = compileMemo23YcInput({ mode: "companies", maxItems: 10 });
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.input.enrichEmails, false);
});

// ═══ 21. invalid inputs fail before any Actor call ═════════════════════════
Deno.test("21. invalid inputs are rejected at compile time, before any call", () => {
  const cases = [
    compileHarvestJobSearchInput({
      company: [LI("a")], jobTitles: ["x"], maxItems: 5, postedLimit: "30d" as never }),
    compileHarvestJobSearchInput({
      company: [LI("a")], jobTitles: ["x"], maxItems: 5, workplaceType: ["onsite"] }),
    compileHarvestCompanySearchInput({ scraperMode: "medium" as never, maxItems: 10 }),
    compileHarvestCompanySearchInput({ scraperMode: "short", maxItems: 5000 }),
    compileHarvestCompanyDetailsInput({ companies: ["https://example.com/acme"] }),
    compileHarvestCompanyDetailsInput({}),
    compileMemo23YcInput({ mode: "companies", maxItems: 10, minEmployeeSize: "12+" }),
    compileSolidcodeYcInput({ status: ["Zombie"], maxResults: 10 }),
    compileHarvestCompanyEmployeesInput({
      companies: ["not-a-url"], profileScraperMode: "Short ($4 per 1k)", maxItems: 5 }),
  ];
  for (const [i, c] of cases.entries()) {
    assertFalse(c.ok, `case ${i} should have been rejected`);
    if (!c.ok) assert(c.errors.length > 0 && c.actorKey, `case ${i} must explain itself`);
  }
  // postedLimit specifically must name the verified enum — numeric days was a
  // real production regression on a different Actor.
  const bad = compileHarvestJobSearchInput({
    company: [LI("a")], jobTitles: ["x"], maxItems: 5, postedLimit: "14" as never });
  if (!bad.ok) assert(bad.errors.some((e) => e.includes("never numeric days")));
});

// ═══ 22. cards expose limitations and verified schema versions ═════════════
Deno.test("22. every capability card carries limits, defects and a verified build", () => {
  const keys = Object.keys(HIRING_ACTOR_CATALOG);
  assertEquals(keys.length, 7, "all seven benchmarked Actors must be catalogued");
  for (const k of keys) {
    const c = HIRING_ACTOR_CATALOG[k];
    assert(c.actor_id.includes("/"), `${k}: actor_id must be the full slug`);
    assert(c.purposes.length > 0, `${k}: needs a purpose`);
    assert(c.not_for.length > 0, `${k}: a card without limits is the problem this catalog exists to fix`);
    assert(c.known_defects.length > 0, `${k}: every benchmarked Actor had at least one defect`);
    assert(/^\d+\.\d+\.\d+$/.test(c.schema_build), `${k}: build must be a verified version`);
    assertEquals(c.last_verified_at, "2026-08-01");
    assert(c.normalizer_key.length > 0, `${k}: needs a normalizer key`);
    assertEquals(c.cost_model.tier, "BRONZE");
    for (const d of c.known_defects) {
      assert(d.mitigation.length > 0 && d.evidence_ref.length > 0,
        `${k}/${d.id}: a defect without a mitigation and evidence is a rumour`);
    }
  }
  // The three Actors that cannot qualify alone must say so.
  const needEnrich = actorsRequiringEnrichment().sort();
  assertEquals(needEnrich, [
    "apify_linkedin_company_search", "apify_yc_companies_memo23", "apify_yc_companies_solidcode",
  ].sort());
});

// ═══ COST METADATA ═════════════════════════════════════════════════════════
Deno.test("23. compilers expose the cost multiplier rather than hiding it", () => {
  // maxItems is PER TITLE PER LOCATION — 6 x 4 x 2 = 48 paid rows, not 6.
  const r = compileHarvestJobSearchInput({
    company: [LI("a")], jobTitles: ["t1", "t2", "t3", "t4"],
    locations: ["United States", "Canada"], maxItems: 6, postedLimit: "week",
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.cost.max_expected_rows, 48);
    assert(r.cost.multiplier_explanation?.includes("48"));
    assertEquals(r.cost.estimated_max_usd, Number((0.001 + 48 * 0.001).toFixed(6)));
  }
  // profile-search carries a run minimum that dwarfs its per-row price.
  const p = compileHarvestProfileSearchInput({ profileScraperMode: "Short", maxItems: 1 });
  assert(p.ok);
  if (p.ok) assertEquals(p.cost.estimated_max_usd, 0.1);
});

Deno.test("24. compilation is deterministic and identifies its batch", () => {
  const mk = () => compileHarvestCompanyEmployeesInput({
    companies: [LI("trademo"), LI("triomics")], jobTitles: ["Founder"],
    profileScraperMode: "Short ($4 per 1k)", maxItems: 10, maxItemsPerCompany: 5,
  });
  const a = mk(); const b = mk();
  assert(a.ok && b.ok);
  if (a.ok && b.ok) {
    assertEquals(a.inputHash, b.inputHash, "same input must hash identically");
    assertEquals(a.batchIdentity, b.batchIdentity);
    assertEquals(a.expectedOutputType, "person");
    assertEquals(a.schemaBuild, "0.0.144");
  }
});

// ═══ SOLIDCODE NORMALIZATION ═══════════════════════════════════════════════
Deno.test("25. solidcode normalizes identity fields memo23 cannot supply", () => {
  const c = normalizeSolidcodeCompany(SOLIDCODE_COMPANIES[0]);
  assert(c.external_source_id.startsWith("yc_solidcode:"));
  assertEquals(c.employee_count, null, "YC self-reported size is never exact");
  const ev = c.startup_evidence as Record<string, unknown>;
  assertEquals(ev.source, "y_combinator");
  assert("year_founded" in ev, "solidcode's extra identity evidence is why it is the fallback");
});
