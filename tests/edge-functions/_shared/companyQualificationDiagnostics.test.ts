// PER-COMPANY QUALIFICATION DIAGNOSTICS.
//
// OFFLINE ONLY. Pure functions; no Actor run, no model call, no database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyDiagnostic, mergeCompanyDiagnostics, buildQualificationInsights,
  identityStatusFor, diagnosticsAreQuotaInert, DIAGNOSTIC_BOUNDS,
  type CompanyQualificationDiagnostic, type EvaluatedCompanyInput,
} from "../../supabase/functions/_shared/companyQualificationDiagnostics.ts";

function evaluated(o: Partial<EvaluatedCompanyInput> = {}): EvaluatedCompanyInput {
  return {
    companyKey: "solarwinds.com",
    name: "SolarWinds",
    domain: "solarwinds.com",
    linkedinUrl: "https://www.linkedin.com/company/solarwinds",
    signalTitle: "Director, Revenue Operations",
    signalUrl: "https://www.linkedin.com/jobs/view/4429558301",
    signalDate: "2026-07-29",
    sourceCapabilities: ["linkedin_job_discovery"],
    titleFamily: "revenue_operations",
    titleConfidence: "high",
    brainStatus: "fail",
    failedGates: ["employee_count", "business_model"],
    ...o,
  };
}

// ============================================ 1,2,3. EVERY EVALUATED COMPANY ==

Deno.test("1. an evaluated company produces a bounded diagnostic", () => {
  const d = buildCompanyDiagnostic(evaluated());
  assertEquals(d.company_key, "solarwinds.com");
  assertEquals(d.company_name, "SolarWinds");
  assertEquals(d.hiring_signal_title, "Director, Revenue Operations");
  assertEquals(d.hiring_signal_date, "2026-07-29");
  assertEquals(d.title_family, "revenue_operations");
  assertEquals(d.company_identity_status, "resolved");
  // Bounded: no field grows without limit.
  assert(JSON.stringify(d).length < 2000);
});

Deno.test("1b. long text and oversized lists are truncated, not carried whole", () => {
  const d = buildCompanyDiagnostic(evaluated({
    name: "x".repeat(500),
    failedGates: Array.from({ length: 40 }, (_, i) => `gate_${i}`),
    sourceCapabilities: Array.from({ length: 20 }, (_, i) => `cap_${i}`),
  }));
  assertEquals(d.company_name.length, DIAGNOSTIC_BOUNDS.maxTextChars);
  assertEquals(d.failed_gates.length, DIAGNOSTIC_BOUNDS.maxGates);
  assertEquals(d.source_capabilities.length, DIAGNOSTIC_BOUNDS.maxCapabilities);
});

Deno.test("2. a rejected company retains its exact failed gates", () => {
  const d = buildCompanyDiagnostic(evaluated());
  assertEquals(d.qualification_status, "rejected");
  assertEquals(d.company_brain_status, "fail");
  assertEquals(d.failed_gates, ["employee_count", "business_model"]);
});

Deno.test("3. NO diagnostic is ever quota-eligible, whatever its status", () => {
  const all: CompanyQualificationDiagnostic[] = [
    buildCompanyDiagnostic(evaluated()),
    buildCompanyDiagnostic(evaluated({ brainStatus: "pass", failedGates: [] })),
    buildCompanyDiagnostic(evaluated({ brainStatus: "evidence_pending", failedGates: [] })),
    buildCompanyDiagnostic(evaluated({ brainStatus: "not_enforced", failedGates: [] })),
  ];
  assert(diagnosticsAreQuotaInert(all));
  for (const d of all) assertFalse(d.quota_eligible);
});

Deno.test("3b. a rejected company is never decision-maker eligible", () => {
  assertFalse(buildCompanyDiagnostic(evaluated()).decision_maker_eligibility);
  // A passing, fully-identified company IS.
  assert(buildCompanyDiagnostic(evaluated({ brainStatus: "pass", failedGates: [] })).decision_maker_eligibility);
});

// =================================================== identity resolution ==

Deno.test("an unresolved identity never reaches qualified, and cannot be searched", () => {
  assertEquals(identityStatusFor({ companyKey: "k", brainStatus: "pass" }), "unresolved");
  assertEquals(identityStatusFor({ companyKey: "k", name: "Acme", brainStatus: "pass" }), "partial");
  assertEquals(
    identityStatusFor({ companyKey: "k", name: "Acme", domain: "acme.com", brainStatus: "pass" }),
    "resolved",
  );

  const nameOnly = buildCompanyDiagnostic({
    companyKey: "acme", name: "Acme", brainStatus: "pass", failedGates: [],
  });
  // Passed the Brain but cannot be scoped: not eligible for a people call.
  assertFalse(nameOnly.decision_maker_eligibility);

  const nothing = buildCompanyDiagnostic({ companyKey: "k", brainStatus: "pass", failedGates: [] });
  assertEquals(nothing.qualification_status, "company_resolved");
  assertFalse(nothing.decision_maker_eligibility);
});

// ============================================================ deduplication ==

Deno.test("diagnostics dedupe by company across providers and rounds", () => {
  const a = buildCompanyDiagnostic(evaluated());
  const b = buildCompanyDiagnostic(evaluated());       // same company, second round
  const merged = mergeCompanyDiagnostics([a], [b]);
  assertEquals(merged.length, 1);
});

Deno.test("a merge never demotes a company that already qualified", () => {
  const qualified = buildCompanyDiagnostic(evaluated({ brainStatus: "pass", failedGates: [] }));
  const rejected = buildCompanyDiagnostic(evaluated());
  // A later rejection observation must not overwrite the pass.
  const merged = mergeCompanyDiagnostics([qualified], [rejected]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].qualification_status, "qualified");
  // And the reverse direction DOES promote.
  const promoted = mergeCompanyDiagnostics([rejected], [qualified]);
  assertEquals(promoted[0].qualification_status, "qualified");
});

Deno.test("a same-stage merge unions evidence rather than replacing it", () => {
  const thin = buildCompanyDiagnostic(evaluated({ domain: "", failedGates: ["employee_count"] }));
  const rich = buildCompanyDiagnostic(evaluated({ failedGates: ["business_model"], sourceCapabilities: ["indeed_job_discovery"] }));
  const merged = mergeCompanyDiagnostics([thin], [rich]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].company_domain, "solarwinds.com");        // richer identity kept
  assertEquals(merged[0].failed_gates.sort(), ["business_model", "employee_count"]);
  assert(merged[0].source_capabilities.includes("indeed_job_discovery"));
});

Deno.test("the merged set is capped so a checkpoint cannot grow unbounded", () => {
  const many = Array.from({ length: 500 }, (_, i) =>
    buildCompanyDiagnostic(evaluated({ companyKey: `c${i}`, name: `C${i}` })));
  assertEquals(mergeCompanyDiagnostics([], many).length, DIAGNOSTIC_BOUNDS.maxDiagnostics);
});

// ================================================== Insights projection ==

Deno.test("25. rejected companies project into Insights, never Opportunities", () => {
  const diagnostics = [
    buildCompanyDiagnostic(evaluated({ companyKey: "a", brainStatus: "fail", failedGates: ["employee_count"] })),
    buildCompanyDiagnostic(evaluated({ companyKey: "b", brainStatus: "fail", failedGates: ["business_model"] })),
    buildCompanyDiagnostic(evaluated({ companyKey: "c", brainStatus: "pass", failedGates: [] })),
  ];
  const ins = buildQualificationInsights(diagnostics);
  assertEquals(ins.companies_evaluated, 3);
  assertEquals(ins.companies_rejected, 2);
  assertEquals(ins.companies_qualified, 1);
  assertEquals(ins.failed_gate_counts.employee_count, 1);
  assertEquals(ins.failed_gate_counts.business_model, 1);
  // The rejected list is its own surface; this projection creates no account row.
  assertEquals(ins.rejected.length, 2);
  assert(ins.rejected.every((d) => !d.quota_eligible));
  assertEquals(ins.decision_maker_ready.length, 1);
});

Deno.test("26. the funnel stages stay separate — evaluated is not qualified", () => {
  // The production shape: many evaluated, none qualified.
  const diagnostics = Array.from({ length: 25 }, (_, i) =>
    buildCompanyDiagnostic(evaluated({ companyKey: `c${i}`, brainStatus: "fail" })));
  const ins = buildQualificationInsights(diagnostics);
  assertEquals(ins.companies_evaluated, 25);
  assertEquals(ins.companies_qualified, 0);
  assertEquals(ins.companies_rejected, 25);
  assertEquals(ins.decision_maker_ready.length, 0);
  // Twenty-five evaluated companies are now VISIBLE, and none of them counts.
  assert(diagnosticsAreQuotaInert(ins.rejected));
});

Deno.test("evidence-pending companies are counted apart from qualified and rejected", () => {
  const ins = buildQualificationInsights([
    buildCompanyDiagnostic(evaluated({ companyKey: "p", brainStatus: "evidence_pending", failedGates: [] })),
    buildCompanyDiagnostic(evaluated({ companyKey: "q", brainStatus: "pass", failedGates: [] })),
    buildCompanyDiagnostic(evaluated({ companyKey: "r", brainStatus: "fail" })),
  ]);
  assertEquals(ins.companies_pending, 1);
  assertEquals(ins.companies_qualified, 1);
  assertEquals(ins.companies_rejected, 1);
  assertEquals(ins.companies_evaluated, 3);
});
