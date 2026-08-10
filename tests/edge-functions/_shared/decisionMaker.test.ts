import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveDecisionMakerCompanyIdentity,
  normalizeCompanyNameForMatching,
  normalizeCompanyLinkedInUrl,
  normalizeDomain,
  isJobBoardDomain,
} from "../../../supabase/functions/_shared/decisionMaker/companyIdentity.ts";
import { classifyDecisionMakerRole, isTargetRoleFamily } from "../../../supabase/functions/_shared/decisionMaker/roleFamily.ts";
import {
  normalizeProviderProfile,
  normalizePersonLinkedInUrl,
  dedupeProfiles,
} from "../../../supabase/functions/_shared/decisionMaker/personProfile.ts";
import { verifyDecisionMakerEmployer } from "../../../supabase/functions/_shared/decisionMaker/employerVerification.ts";
import { companySizeBand, rankCandidates, scoreCandidate } from "../../../supabase/functions/_shared/decisionMaker/ranking.ts";
import { planPeopleSearch, fallbackStages, MAX_RESULTS_PER_LEAD } from "../../../supabase/functions/_shared/decisionMaker/searchPlanner.ts";
import { findDecisionMakers, type ProviderResponse } from "../../../supabase/functions/_shared/decisionMaker/pipeline.ts";
import { decidePersistence } from "../../../supabase/functions/_shared/decisionMaker/persistenceGuard.ts";
import * as F from "../../../supabase/functions/_shared/decisionMaker/fixtures.ts";

const WS = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";

const identity = () => resolveDecisionMakerCompanyIdentity(F.TARGET_COMPANY);
const norm = (raw: Record<string, unknown>) => normalizeProviderProfile(raw);

/** Provider stub — no network, ever. */
function stubProvider(res: ProviderResponse) {
  let calls = 0;
  const fn = async () => { calls += 1; return res; };
  return { fn, calls: () => calls };
}

// ===========================================================================
// COMPANY IDENTITY
// ===========================================================================

Deno.test("1. LinkedIn URL + domain → strong identity, search ready", () => {
  const id = identity();
  assertEquals(id.identity_strength, "strong");
  assert(id.search_ready);
  assertEquals(id.company_linkedin_url, "https://www.linkedin.com/company/nimbus-forge");
  assertEquals(id.domain, "nimbusforge.example");
});

Deno.test("2. domain + name → medium identity", () => {
  const id = resolveDecisionMakerCompanyIdentity({ company_name: "Nimbus Forge", website: "https://nimbusforge.example" });
  assertEquals(id.identity_strength, "medium");
  assert(id.search_ready);
});

Deno.test("3. company name alone is weak and NOT search-ready", () => {
  const id = resolveDecisionMakerCompanyIdentity({ company_name: "Nimbus Forge" });
  assertEquals(id.identity_strength, "weak");
  assertEquals(id.search_ready, false);
  const planned = planPeopleSearch(id, "domain_people_search");
  assert(!planned.ok);
  if (planned.ok) return;
  assertEquals(planned.reason_code, "missing_company_identity");
});

Deno.test("4. job-board / social domains are rejected as company domains", () => {
  for (const bad of ["https://www.linkedin.com/company/x", "https://jobs.lever.co/acme", "https://indeed.com/q", "https://boards.greenhouse.io/acme"]) {
    assertEquals(normalizeDomain(bad), null, `${bad} must not be a company domain`);
    assert(isJobBoardDomain(bad));
  }
  const id = resolveDecisionMakerCompanyIdentity({ company_name: "Nimbus Forge", website: "https://jobs.lever.co/nimbus" });
  assertEquals(id.domain, null);
  assertEquals(id.search_ready, false);
});

Deno.test("5. malformed / numeric LinkedIn company URLs are rejected", () => {
  for (const bad of ["https://linkedin.com/company/", "linkedin.com/company/12345", "https://example.com/company/acme", "garbage"]) {
    assertEquals(normalizeCompanyLinkedInUrl(bad), null, bad);
  }
});

Deno.test("6. identity provenance is preserved per field", () => {
  const id = identity();
  const fields = id.identity_sources.map((s) => s.field);
  assert(fields.includes("company_linkedin_url"));
  assert(fields.includes("domain"));
  assert(id.identity_sources.every((s) => typeof s.origin === "string" && s.origin.length > 0));
});

Deno.test("6b. industry words are NOT stripped — Acme AI ≠ Acme Labs", () => {
  // The old normalizer collapsed both to "acme", manufacturing false matches.
  assert(normalizeCompanyNameForMatching("Acme AI") !== normalizeCompanyNameForMatching("Acme Labs"));
  // Legal suffixes still normalize away.
  assertEquals(normalizeCompanyNameForMatching("Nimbus Forge Inc."), normalizeCompanyNameForMatching("Nimbus Forge LLC"));
});

// ===========================================================================
// ROLE CLASSIFICATION
// ===========================================================================

Deno.test("28-32. canonical titles classify into the right families", () => {
  assertEquals(classifyDecisionMakerRole("Founder & CEO").role_family, "founder");
  assertEquals(classifyDecisionMakerRole("Co-Founder").role_family, "founder");
  assertEquals(classifyDecisionMakerRole("Chief Revenue Officer").role_family, "executive_revenue");
  assertEquals(classifyDecisionMakerRole("VP, Global Sales").role_family, "sales_leadership");
  assertEquals(classifyDecisionMakerRole("Head of Growth").role_family, "growth_leadership");
  assertEquals(classifyDecisionMakerRole("Director of Revenue Operations").role_family, "revenue_operations");
});

Deno.test("33. irrelevant titles classify as other", () => {
  for (const t of ["Account Executive", "Immigration Specialist", "Hedge Fund Analyst", "Software Engineer"]) {
    assertEquals(classifyDecisionMakerRole(t).role_family, "other", t);
  }
});

Deno.test("34. substring false positives are rejected", () => {
  // Each of these contains a senior keyword but is not a decision-maker.
  const cases: Array<[string, string]> = [
    ["Founder Relations Manager", "founder_adjacent"],
    ["Former Founder", "former_role"],
    ["ex-CEO", "former_role"],
    ["Investor in the company", "non_operating"],
    ["Advisor", "non_operating"],
    ["Sales Assistant", "junior_role"],
    ["Growth Marketing Intern", "junior_role"],
    ["Technical Recruiter", "recruiter"],
  ];
  for (const [title, why] of cases) {
    const c = classifyDecisionMakerRole(title);
    assertEquals(c.role_family, "other", `${title} must not be a target`);
    assertEquals(c.disqualified_by, why, title);
  }
});

Deno.test("34b. functional titles need a leadership qualifier", () => {
  assertEquals(classifyDecisionMakerRole("Sales Operations Manager").role_family, "other");
  assertEquals(classifyDecisionMakerRole("Head of Sales Operations").role_family, "sales_operations");
  assert(!isTargetRoleFamily("other"));
});

// ===========================================================================
// NORMALIZATION
// ===========================================================================

Deno.test("16. a provider profile normalizes safely", () => {
  const p = norm(F.VERIFIED_FOUNDER);
  assertEquals(p.full_name, "Ada Kestrel");
  assertEquals(p.linkedin_url, "https://www.linkedin.com/in/ada-kestrel-synthetic");
  assertEquals(p.current_title, "Founder & CEO");
  assertEquals(p.rejection_reasons.length, 0);
});

Deno.test("17. malformed profile URLs are rejected, not coerced", () => {
  const p = norm(F.MALFORMED_PROFILE);
  assertEquals(p.linkedin_url, null);
  assert(p.rejection_reasons.includes("invalid_profile_url"));
  // A company URL is not a person URL.
  assertEquals(normalizePersonLinkedInUrl("https://www.linkedin.com/company/nimbus-forge"), null);
});

Deno.test("18. duplicate profiles deduplicate by normalized slug", () => {
  const { unique, duplicate_count } = dedupeProfiles([norm(F.VERIFIED_FOUNDER), norm(F.DUPLICATE_FOUNDER)]);
  assertEquals(unique.length, 1);
  assertEquals(duplicate_count, 1);
});

Deno.test("19. different people with the same name stay separate", () => {
  const { unique, duplicate_count } = dedupeProfiles([norm(F.VERIFIED_FOUNDER), norm(F.SAME_NAME_DIFFERENT_PERSON)]);
  assertEquals(unique.length, 2, "same name + different profile URL are different people");
  assertEquals(duplicate_count, 0);
});

Deno.test("20. missing fields stay missing rather than being invented", () => {
  const p = norm({ full_name: "Iris Vale", linkedin_url: "https://www.linkedin.com/in/iris-vale-synthetic" });
  assertEquals(p.current_company_name, null);
  assertEquals(p.current_company_domain, null);
  assertEquals(p.location, null);
  assertEquals(p.experience.length, 0);
});

// ===========================================================================
// EMPLOYER VERIFICATION
// ===========================================================================

Deno.test("21. matching company LinkedIn URL verifies", () => {
  const v = verifyDecisionMakerEmployer(norm(F.VERIFIED_FOUNDER), identity());
  assertEquals(v.status, "verified");
  assert(v.match_methods.includes("company_linkedin_url"));
});

Deno.test("22. matching domain verifies", () => {
  const v = verifyDecisionMakerEmployer(norm(F.VERIFIED_CRO), identity());
  assertEquals(v.status, "verified");
  assert(v.match_methods.includes("company_domain"));
});

Deno.test("23. corroborated name-only evidence is PROBABLE, never verified", () => {
  const v = verifyDecisionMakerEmployer(norm(F.PROBABLE_EMPLOYEE), identity());
  assertEquals(v.status, "probable");
  assertEquals(v.confidence, "medium");
});

Deno.test("24. target company only in past experience does not verify", () => {
  const v = verifyDecisionMakerEmployer(norm(F.FORMER_FOUNDER), identity());
  assertEquals(v.status, "rejected");
  assert(
    v.rejection_reasons.includes("target_company_only_in_past_experience") ||
    v.rejection_reasons.includes("current_employer_is_another_company"),
  );
});

Deno.test("25. a different current employer is rejected", () => {
  const v = verifyDecisionMakerEmployer(norm(F.UNRELATED_CRO), identity());
  assertEquals(v.status, "rejected");
  assert(v.rejection_reasons.includes("current_employer_is_another_company"));
});

Deno.test("26. same name + different domain is rejected as an impostor", () => {
  const v = verifyDecisionMakerEmployer(norm(F.LOOKALIKE_COMPANY_PERSON), identity());
  assertEquals(v.status, "rejected");
  assert(v.rejection_reasons.includes("similar_name_different_domain"));
});

Deno.test("27. no current-employment evidence stays unverified, not verified", () => {
  const v = verifyDecisionMakerEmployer(
    norm({ full_name: "Jo Ash", linkedin_url: "https://www.linkedin.com/in/jo-ash-synthetic", current_title: "CEO" }),
    identity(),
  );
  assertEquals(v.status, "unverified");
});

// ===========================================================================
// REQUEST BUILDER
// ===========================================================================

Deno.test("11. the plan prefers the company LinkedIn URL", () => {
  const p = planPeopleSearch(identity(), "company_employee_search");
  assert(p.ok);
  if (!p.ok) return;
  assertEquals(p.plan.company_filters.company_linkedin_url, "https://www.linkedin.com/company/nimbus-forge");
  assertEquals(p.plan.actor_key, "apify_linkedin_company_employees");
});

Deno.test("12-13. domain fallback is bounded and the cap is enforced", () => {
  const p = planPeopleSearch(identity(), "domain_people_search", { maxResults: 10_000 });
  assert(p.ok);
  if (!p.ok) return;
  assertEquals(p.plan.company_filters.company_domain, "nimbusforge.example");
  assertEquals(p.plan.maximum_results, MAX_RESULTS_PER_LEAD);
  assert(p.plan.maximum_results <= MAX_RESULTS_PER_LEAD);
});

Deno.test("14. weak identity blocks the search entirely", () => {
  const weak = resolveDecisionMakerCompanyIdentity({ company_name: "Nimbus Forge" });
  for (const stage of ["company_employee_search", "domain_people_search"] as const) {
    const p = planPeopleSearch(weak, stage);
    assert(!p.ok, `${stage} must be refused on a weak identity`);
  }
});

Deno.test("15. plans carry canonical role filters and no guessed geography", () => {
  const p = planPeopleSearch(identity(), "company_employee_search");
  assert(p.ok);
  if (!p.ok) return;
  assert(p.plan.title_filters.includes("founder"));
  assert(p.plan.title_filters.includes("chief revenue officer"));
  assertEquals(p.plan.geography_filters, [], "no location is invented");
});

Deno.test("13b. the fallback sequence is bounded and ordered", () => {
  const stages = fallbackStages(identity());
  assertEquals(stages, ["direct_known_person", "company_employee_search", "domain_people_search", "stop"]);
});

// ===========================================================================
// RANKING
// ===========================================================================

const rankInput = (role: string, seniority: string, status: string) => ({
  candidate: `${role}`,
  input: {
    role_family: role as never, seniority, verification_status: status as never,
    profile_completeness: 1, from_direct_source: false,
  },
});

Deno.test("35. founder ranks first at a small company", () => {
  const ranked = rankCandidates(
    [rankInput("executive_revenue", "c_level", "verified"), rankInput("founder", "founder", "verified")],
    companySizeBand(12),
  );
  assertEquals(ranked[0].candidate, "founder");
});

Deno.test("36. revenue executive ranks first at a larger company", () => {
  const ranked = rankCandidates(
    [rankInput("founder", "founder", "verified"), rankInput("executive_revenue", "c_level", "verified")],
    companySizeBand(4000),
  );
  assertEquals(ranked[0].candidate, "executive_revenue");
});

Deno.test("37. verification outweighs a stronger title", () => {
  const ranked = rankCandidates(
    [rankInput("founder", "founder", "probable"), rankInput("sales_operations", "head", "verified")],
    companySizeBand(10),
  );
  assertEquals(ranked[0].candidate, "sales_operations", "a verified junior beats an unconfirmed founder");
});

Deno.test("38. rejected and unverified candidates never rank", () => {
  const ranked = rankCandidates(
    [rankInput("founder", "founder", "rejected"), rankInput("founder", "founder", "unverified")],
    "small",
  );
  assertEquals(ranked.length, 0);
});

Deno.test("39. score components reconcile with the total", () => {
  const s = scoreCandidate(
    { role_family: "founder", seniority: "founder", verification_status: "verified", profile_completeness: 1, from_direct_source: true },
    "small",
  );
  assertEquals(
    s.total,
    s.role_priority + s.seniority_bonus + s.verification_weight + s.completeness_bonus + s.direct_source_bonus,
  );
});

Deno.test("39b. company size unknown does not fabricate a band", () => {
  assertEquals(companySizeBand(undefined), "unknown");
  assertEquals(companySizeBand(0), "unknown");
  assertEquals(companySizeBand("50"), "unknown");
});

// ===========================================================================
// PIPELINE OUTCOMES
// ===========================================================================

const base = { lead_candidate_id: LEAD, identity_input: F.TARGET_COMPANY };

Deno.test("40. a verified candidate returns succeeded", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.VERIFIED_FOUNDER], run_id: "run_synthetic_1" });
  const r = await findDecisionMakers({ ...base, employee_count: 15 }, p.fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.reason_code, "decision_maker_found");
  assertEquals(r.decision_makers.length, 1);
  assertEquals(r.decision_makers[0].role_family, "founder");
  assertEquals(r.decision_makers[0].rank, 1);
  assertEquals(r.verified_profile_count, 1);
});

Deno.test("41. no provider results returns no_match", async () => {
  const p = stubProvider({ status: "ok", profiles: [] });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "no_match");
  assertEquals(r.reason_code, "provider_no_results");
  assertEquals(r.decision_makers.length, 0);
});

Deno.test("42. all profiles rejected returns no_match, not success", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.UNRELATED_CRO, F.FORMER_FOUNDER, F.LOOKALIKE_COMPANY_PERSON] });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "no_match");
  assertEquals(r.reason_code, "company_match_failed");
  assertEquals(r.decision_makers.length, 0);
  assert(r.rejected_profile_count >= 3);
});

Deno.test("43. probable-only profiles return needs_manual_review", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.PROBABLE_EMPLOYEE] });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "needs_manual_review");
  assertEquals(r.reason_code, "employment_unverified");
  assertEquals(r.manual_review_count, 1);
  assertEquals(r.decision_makers.length, 0, "probable people are never returned as found");
});

Deno.test("44. a disabled actor returns unavailable", async () => {
  const p = stubProvider({ status: "unavailable" });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "unavailable");
  assertEquals(r.reason_code, "people_search_disabled");
  assertEquals(r.retryable, false);
});

Deno.test("45. a provider timeout returns timed_out and is retryable", async () => {
  const p = stubProvider({ status: "timed_out" });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "timed_out");
  assertEquals(r.retryable, true);
});

Deno.test("46. a provider error returns failed", async () => {
  const p = stubProvider({ status: "failed", error_code: "provider_failed" });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(r.status, "failed");
  assertEquals(r.retryable, true);
});

Deno.test("48. an empty result never becomes a generic success", async () => {
  for (const res of [
    { status: "ok", profiles: [] },
    { status: "unavailable" },
    { status: "timed_out" },
    { status: "failed" },
  ] as ProviderResponse[]) {
    const r = await findDecisionMakers(base, stubProvider(res).fn);
    assert(r.status !== "succeeded", `${res.status} must not read as success`);
    assertEquals(r.decision_makers.length, 0);
  }
});

Deno.test("weak identity returns missing_company_identity WITHOUT calling the provider", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.VERIFIED_FOUNDER] });
  const r = await findDecisionMakers({ lead_candidate_id: LEAD, identity_input: { company_name: "Nimbus Forge" } }, p.fn);
  assertEquals(r.status, "missing_company_identity");
  assertEquals(p.calls(), 0, "no provider call on a weak identity");
});

// ===========================================================================
// SHORTCUT
// ===========================================================================

Deno.test("7. a verified founder shortcut succeeds without a provider call", async () => {
  const p = stubProvider({ status: "ok", profiles: [] });
  const r = await findDecisionMakers({ ...base, known_person: F.JOB_POSTER_FOUNDER, employee_count: 10 }, p.fn);
  assertEquals(r.status, "succeeded");
  assertEquals(p.calls(), 0, "shortcut must not spend a provider call");
  assert(r.decision_makers[0].rank_reasons.some((x) => /direct source/i.test(x)));
});

Deno.test("8. a job poster who is a recruiter is NOT accepted as the decision-maker", async () => {
  const p = stubProvider({ status: "ok", profiles: [] });
  const r = await findDecisionMakers({ ...base, known_person: F.JOB_POSTER_RECRUITER }, p.fn);
  assertEquals(r.status, "no_match");
  assertEquals(r.decision_makers.length, 0);
  assertEquals(r.rejection_summary.role_not_target, 1);
  assertEquals(p.calls(), 2, "falls through to BOTH bounded stages, then stops");
});

Deno.test("9. a former-employee shortcut is rejected and falls through", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.VERIFIED_CRO] });
  const r = await findDecisionMakers({ ...base, known_person: F.FORMER_FOUNDER }, p.fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.decision_makers[0].full_name, "Bo Wrenfield", "the search result wins, not the former founder");
});

Deno.test("10. a probable shortcut does not auto-succeed", async () => {
  const p = stubProvider({ status: "ok", profiles: [] });
  const r = await findDecisionMakers({ ...base, known_person: F.PROBABLE_EMPLOYEE }, p.fn);
  assert(r.status !== "succeeded");
});

// ===========================================================================
// RESULT CONTRACT + OBSERVABILITY
// ===========================================================================

Deno.test("11b. the result envelope is complete and reconciles", async () => {
  const p = stubProvider({ status: "ok", profiles: [F.VERIFIED_FOUNDER, F.UNRELATED_CRO, F.DUPLICATE_FOUNDER], run_id: "run_synthetic_2" });
  const r = await findDecisionMakers({ ...base, employee_count: 20 }, p.fn);

  assertEquals(r.lead_candidate_id, LEAD);
  assertEquals(r.provider_attempted, "apify");
  assertEquals(r.provider_run_id, "run_synthetic_2");
  assertEquals(r.returned_profile_count, 3);
  assertEquals(r.observability.duplicate_count, 1);
  assertEquals(r.verified_profile_count, r.decision_makers.filter((d) => d.verification_status === "verified").length);
  assertEquals(r.observability.final_outcome, r.status);
  assertEquals(r.observability.identity_strength, "strong");
  assertEquals(r.observability.actor_selected, "apify_linkedin_company_employees");
});

Deno.test("at most three decision-makers are returned", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    ...F.VERIFIED_CRO,
    full_name: `Person ${i}`,
    linkedin_url: `https://www.linkedin.com/in/person-${i}-synthetic`,
  }));
  const r = await findDecisionMakers(base, stubProvider({ status: "ok", profiles: many }).fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.decision_makers.length, 3);
  assertEquals(r.decision_makers.map((d) => d.rank), [1, 2, 3]);
});

Deno.test("59-60. no raw provider payload or secret-bearing field is returned", async () => {
  const r = await findDecisionMakers(
    base,
    stubProvider({ status: "ok", profiles: [{ ...F.VERIFIED_FOUNDER, apiKey: "sk-should-never-surface", raw_html: "<html/>" }] }).fn,
  );
  const serialized = JSON.stringify(r);
  assert(!serialized.includes("sk-should-never-surface"));
  assert(!serialized.includes("raw_html"));
  assert(!serialized.includes("<html/>"));
});

// ===========================================================================
// PERSISTENCE GUARD
// ===========================================================================

const provenance = { provider: "apify", actor: "apify_linkedin_company_employees", stage: "company_employee_search", verification_methods: ["company_linkedin_url"] };
const ctx = { workspace_id: WS, lead_workspace_id: WS, existing_contact_urls: [] as string[] };

Deno.test("49. a verified candidate may persist", () => {
  const d = decidePersistence(
    { full_name: "Ada Kestrel", linkedin_url: "https://www.linkedin.com/in/ada-kestrel-synthetic", role_family: "founder", verification_status: "verified", provenance },
    ctx,
  );
  assert(d.ok);
});

Deno.test("50. a probable candidate cannot auto-persist", () => {
  const d = decidePersistence(
    { full_name: "Fen Okoro", linkedin_url: "https://www.linkedin.com/in/fen-okoro-synthetic", role_family: "growth_leadership", verification_status: "probable", provenance },
    ctx,
  );
  assert(!d.ok);
  if (d.ok) return;
  assertEquals(d.reason_code, "probable_requires_manual_review");
});

Deno.test("51. an unverified/former employee cannot persist", () => {
  const d = decidePersistence(
    { full_name: "Cyd Marlow", linkedin_url: "https://www.linkedin.com/in/cyd-marlow-synthetic", role_family: "founder", verification_status: "rejected", provenance },
    ctx,
  );
  assert(!d.ok);
  if (d.ok) return;
  assertEquals(d.reason_code, "employer_not_verified");
});

Deno.test("52. a duplicate contact does not persist twice", () => {
  const d = decidePersistence(
    { full_name: "Ada Kestrel", linkedin_url: "https://linkedin.com/in/ada-kestrel-synthetic/", role_family: "founder", verification_status: "verified", provenance },
    { ...ctx, existing_contact_urls: ["https://www.linkedin.com/in/ada-kestrel-synthetic"] },
  );
  assert(!d.ok);
  if (d.ok) return;
  assertEquals(d.reason_code, "duplicate_contact");
});

Deno.test("53. cross-workspace persistence is rejected before anything else", () => {
  const d = decidePersistence(
    { full_name: "Ada Kestrel", linkedin_url: "https://www.linkedin.com/in/ada-kestrel-synthetic", role_family: "founder", verification_status: "verified", provenance },
    { ...ctx, lead_workspace_id: "00000000-0000-4000-8000-0000000000ff" },
  );
  assert(!d.ok);
  if (d.ok) return;
  assertEquals(d.reason_code, "lead_not_in_workspace");
});

Deno.test("54. provenance is required to persist", () => {
  const d = decidePersistence(
    { full_name: "Ada Kestrel", linkedin_url: "https://www.linkedin.com/in/ada-kestrel-synthetic", role_family: "founder", verification_status: "verified", provenance: null },
    ctx,
  );
  assert(!d.ok);
  if (d.ok) return;
  assertEquals(d.reason_code, "missing_provenance");
});

Deno.test("a title-only match with no verified employer cannot persist", () => {
  const d = decidePersistence(
    { full_name: "Dee Halloway", linkedin_url: "https://www.linkedin.com/in/dee-halloway-synthetic", role_family: "executive_revenue", verification_status: "unverified", provenance },
    ctx,
  );
  assert(!d.ok);
});

// ===========================================================================
// SAFETY
// ===========================================================================

Deno.test("55-58. the pipeline performs no network, provider, DB or outreach side effects", async () => {
  // The provider is injected; with a stub that records calls we can assert the
  // exact number of provider interactions, and there is no other I/O surface:
  // these modules import nothing but each other.
  const p = stubProvider({ status: "ok", profiles: [F.VERIFIED_FOUNDER] });
  const r = await findDecisionMakers(base, p.fn);
  assertEquals(p.calls(), 1, "exactly one bounded provider call");
  assertEquals(r.observability.persisted_count, 0, "the pipeline never persists; the caller decides");
});
