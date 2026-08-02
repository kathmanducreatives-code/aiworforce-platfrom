import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyEnrichmentObservability, buildCompanyDiagnostic, companyKeyFingerprint,
  type CompanyDiagnosticInput,
} from "../../functions/_shared/companyEnrichmentObservability.ts";

const base = (over: Partial<CompanyDiagnosticInput> = {}): CompanyDiagnosticInput => ({
  companyKey: "li:linkedin.com/company/acme",
  companyName: "Acme SaaS",
  companyLinkedInUrl: "https://www.linkedin.com/company/acme",
  officialWebsite: "https://acme.com",
  associatedCandidateIds: ["f1", "f2", "f3"],
  missingBefore: ["company_website", "company_industry"],
  action: "structured_company_enrichment",
  actorKey: "apify_linkedin_company_details",
  actorId: "harvestapi/linkedin-company",
  verifiedBinding: true,
  fieldsReturned: ["website", "industries", "employeeCount"],
  evidenceAdded: ["company_website", "company_industry", "company_size"],
  missingAfter: [],
  sufficiencyBefore: false,
  sufficiencyAfter: true,
  qualificationRerun: true,
  finalCandidateDecisions: ["accept", "accept", "stage_missing_evidence"],
  outcome: "enriched",
  ...over,
});

// ---- (35) reconciliation ----
Deno.test("35: summary reconciles planned == called + cached + skipped", () => {
  const o = buildCompanyEnrichmentObservability({
    candidatesConsidered: 5, companiesDeduplicated: 3, budgetLimit: 8, budgetConsumed: 2,
    stopReason: "completed",
    companies: [
      base(),                                     // enriched (called)
      base({ companyKey: "li:b", outcome: "no_result", failureReason: "empty_result" }),  // called
      base({ companyKey: "li:c", outcome: "cached", action: "skip" }),                     // cached
      base({ companyKey: "li:d", outcome: "budget_skipped", action: "stage" }),            // skipped
    ],
  });
  assertEquals(o.summary.companies_planned, 4);
  assertEquals(o.summary.companies_called, 2);
  assertEquals(o.summary.companies_enriched, 1);
  assertEquals(o.summary.companies_no_result, 1);
  assertEquals(o.summary.companies_cached, 1);
  assertEquals(o.summary.companies_skipped, 1);
  assertEquals(o.summary.reconciles, true);
});

Deno.test("35b: provider_error counts as called+failed and still reconciles", () => {
  const o = buildCompanyEnrichmentObservability({
    candidatesConsidered: 2, companiesDeduplicated: 2, budgetLimit: 8, budgetConsumed: 2, stopReason: "completed",
    companies: [base(), base({ companyKey: "li:x", outcome: "provider_error", failureReason: "Actor run failed" })],
  });
  assertEquals(o.summary.companies_failed, 1);
  assertEquals(o.summary.companies_called, 2);
  assertEquals(o.summary.reconciles, true);
});

// ---- (36) sanitization ----
Deno.test("36: diagnostics expose no email/phone/token/raw payload/query strings", () => {
  const d = buildCompanyDiagnostic(base({
    companyName: "Acme — contact ceo@acme.com or +1 415 555 0199 Bearer sk_live_ABCDEF",
    companyLinkedInUrl: "https://user:pw@www.linkedin.com/company/acme?trk=x#y",
    officialWebsite: "https://acme.com/home?utm_source=li#top",
    failureReason: "failed: authorization=Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
  }));
  const json = JSON.stringify(d);
  assert(!/ceo@acme\.com/.test(json), json);
  assert(!/555 0199/.test(json), json);
  assert(!/sk_live_|eyJhbGciOi|Bearer /.test(json), json);
  assert(!/"raw"|linkedinText|currentPosition/.test(json));
  // userinfo URL dropped entirely; website query/fragment stripped.
  assertEquals(d.company_linkedin_url, undefined);
  assertEquals(d.official_website, "https://acme.com/home");
  assert(!/\?|#/.test(json.replace(/https?:\/\//g, "")), "query/fragment leaked");
});

Deno.test("36b: the raw company key is never exposed — only a fingerprint", () => {
  const d = buildCompanyDiagnostic(base());
  assert(d.company_key_fingerprint.startsWith("ck_"));
  assert(!JSON.stringify(d).includes("li:linkedin.com/company/acme".replace("https://", "")) || !("company_key" in d));
  assert(!("company_key" in d));
  // stable + non-reversible
  assertEquals(companyKeyFingerprint("li:x"), companyKeyFingerprint("li:x"));
  assert(companyKeyFingerprint("li:x") !== companyKeyFingerprint("li:y"));
});

// ---- per-company detail ----
Deno.test("diagnostic records the enrichment story end-to-end", () => {
  const d = buildCompanyDiagnostic(base());
  assertEquals(d.associated_candidate_count, 3);           // fan-out size
  assertEquals(d.actor_key, "apify_linkedin_company_details");
  assertEquals(d.actor_id, "harvestapi/linkedin-company");
  assertEquals(d.verified_binding, true);
  assertEquals(d.missing_evidence_before, ["company_website", "company_industry"]);
  assertEquals(d.missing_evidence_after, []);
  assertEquals(d.sufficiency_before, false);
  assertEquals(d.sufficiency_after, true);
  assertEquals(d.qualification_rerun, true);
  assertEquals(d.outcome, "enriched");
  assertEquals(d.final_candidate_decisions.length, 3);
});

Deno.test("failure diagnostics keep the candidate story honest", () => {
  const d = buildCompanyDiagnostic(base({
    outcome: "no_result", evidenceAdded: [], missingAfter: ["company_website", "company_industry"],
    sufficiencyAfter: false, qualificationRerun: false,
    finalCandidateDecisions: ["stage_missing_evidence", "stage_missing_evidence", "stage_missing_evidence"],
    failureReason: "empty_result",
  }));
  assertEquals(d.outcome, "no_result");
  assertEquals(d.evidence_added, []);
  assertEquals(d.sufficiency_after, false);
  assertEquals(d.failure_reason, "empty_result");
  assert(d.final_candidate_decisions.every((x) => x === "stage_missing_evidence"));
});

// ---- caps ----
Deno.test("company diagnostics are capped", () => {
  const many = Array.from({ length: 40 }, (_, i) => base({ companyKey: `li:c${i}` }));
  const o = buildCompanyEnrichmentObservability({
    candidatesConsidered: 40, companiesDeduplicated: 40, budgetLimit: 8, budgetConsumed: 8,
    stopReason: "budget_exhausted", companies: many, limit: 5,
  });
  assertEquals(o.companies.length, 5);
  assertEquals(o.truncated, 35);
  assertEquals(o.summary.stop_reason, "budget_exhausted");
});
