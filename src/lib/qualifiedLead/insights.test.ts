// WORKBENCH INSIGHTS + ACTION PREREQUISITES.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  insightsFromResult, readDiagnosticsFromResult, buildQualificationInsightsView,
  readCompanyDiagnostic, processingState, gateLabel,
  type CompanyDiagnosticView,
} from "./insights.ts";

/** One persisted diagnostic, in the exact shape the backend writes. */
function diag(o: Record<string, unknown> = {}) {
  return {
    company_key: "solarwinds.com",
    company_name: "SolarWinds",
    company_domain: "solarwinds.com",
    company_linkedin_url: "https://www.linkedin.com/company/solarwinds",
    hiring_signal_title: "Director, Revenue Operations",
    hiring_signal_url: "https://www.linkedin.com/jobs/view/4429558301",
    hiring_signal_date: "2026-07-29",
    source_capabilities: ["linkedin_job_discovery"],
    title_family: "revenue_operations",
    title_confidence: "high",
    company_identity_status: "resolved",
    company_brain_status: "fail",
    failed_gates: ["employee_count", "business_model"],
    qualification_status: "rejected",
    decision_maker_eligibility: false,
    quota_eligible: false,
    ...o,
  };
}

/** A persisted task result carrying diagnostics where the backend puts them. */
function result(diags: unknown[]) {
  return { company_first_state: { candidate_diagnostics: diags } };
}

// ================================================ 6. THE FRONTEND READS THEM ==

Deno.test("6. diagnostics are read from the persisted task result", () => {
  const view = insightsFromResult(result([diag(), diag({ company_key: "b", company_name: "B" })]));
  assertEquals(view.companies_evaluated, 2);
  assertEquals(view.companies_rejected, 2);
});

Deno.test("6b. a missing, malformed or empty result yields an honest empty view", () => {
  for (const bad of [null, undefined, {}, { company_first_state: {} }, { company_first_state: { candidate_diagnostics: "nope" } }]) {
    const v = insightsFromResult(bad);
    assertEquals(v.companies_evaluated, 0);
    assertEquals(v.empty_reason, "no_companies_evaluated");
  }
  // Unusable entries are dropped, usable ones survive.
  assertEquals(readDiagnosticsFromResult(result([{ nope: 1 }, diag()])).length, 1);
  assertEquals(readCompanyDiagnostic({ company_key: "" }), null);
});

// ============================================ 7,8. INSIGHTS, NOT OPPORTUNITIES ==

Deno.test("7. rejected companies appear under Insights with their exact gates", () => {
  const view = insightsFromResult(result([
    diag({ company_key: "a", failed_gates: ["employee_count"] }),
    diag({ company_key: "b", failed_gates: ["employee_count", "business_model"] }),
  ]));
  assertEquals(view.companies_rejected, 2);
  assertEquals(view.rejected.length, 2);
  assertEquals(view.failed_gate_counts[0], { gate: "employee_count", count: 2 });
  assert(view.failed_gate_counts.some((g) => g.gate === "business_model" && g.count === 1));
  // The exact codes survive; nothing is summarised away.
  assertEquals(view.rejected[1].failed_gates, ["employee_count", "business_model"]);
});

Deno.test("8. nothing this module returns can be rendered as a qualified opportunity", () => {
  const view = insightsFromResult(result([diag(), diag({ company_key: "b" })]));
  assertEquals(view.companies_qualified, 0);
  // Every returned row is quota-inert, even if the wire claimed otherwise.
  for (const r of view.rejected) assertEquals(r.quota_eligible, false);
  const lying = insightsFromResult(result([diag({ quota_eligible: true })]));
  assertEquals(lying.rejected[0].quota_eligible, false);
});

Deno.test("a passing company is counted as qualified and is not in the rejected list", () => {
  const view = insightsFromResult(result([
    diag({ company_key: "ok", company_brain_status: "pass", qualification_status: "qualified", failed_gates: [] }),
    diag({ company_key: "no" }),
  ]));
  assertEquals(view.companies_qualified, 1);
  assertEquals(view.companies_rejected, 1);
  assertFalse(view.rejected.some((r) => r.company_key === "ok"));
});

Deno.test("evidence-pending companies are counted apart from qualified and rejected", () => {
  const view = insightsFromResult(result([
    diag({ company_key: "p", company_brain_status: "evidence_pending", qualification_status: "qualification_pending", failed_gates: [] }),
    diag({ company_key: "q", company_brain_status: "pass", qualification_status: "qualified", failed_gates: [] }),
    diag({ company_key: "r" }),
  ]));
  assertEquals(view.companies_pending, 1);
  assertEquals(view.companies_qualified, 1);
  assertEquals(view.companies_rejected, 1);
  assertEquals(view.companies_evaluated, 3);
});

// =========================================================== the summary ==

Deno.test("a rejection summary explains WHY nothing qualified", () => {
  const view = insightsFromResult(result([
    diag({ company_key: "a", failed_gates: ["employee_count"] }),
    diag({ company_key: "b", failed_gates: ["employee_count"] }),
    diag({ company_key: "c", failed_gates: ["business_model"] }),
  ]));
  assert(view.rejection_summary);
  assert(view.rejection_summary!.includes("3 companies were evaluated"));
  assert(view.rejection_summary!.toLowerCase().includes("employee count"));

  // With something qualified there is no "nothing qualified" summary.
  const some = insightsFromResult(result([
    diag({ company_key: "ok", company_brain_status: "pass", qualification_status: "qualified", failed_gates: [] }),
    diag({ company_key: "no" }),
  ]));
  assertEquals(some.rejection_summary, null);
});

Deno.test("gate codes render as readable text, and unknown codes still show", () => {
  assertEquals(gateLabel("employee_count"), "Employee count outside the target range");
  assertEquals(gateLabel("company_vertical"), "Industry does not match the ICP");
  assertEquals(gateLabel("some_new_gate"), "some new gate");
});

// ================================================= 24. PROCESSING STATES ==

Deno.test("24. processing states stay nonterminal while work remains", () => {
  const evaluatedNone = buildQualificationInsightsView([]);
  assertEquals(
    processingState({ insights: evaluatedNone, contactReady: 0, requested: 5, workRemains: true }),
    "Collecting and validating hiring signals…",
  );

  const noneQualified = insightsFromResult(result([diag(), diag({ company_key: "b" })]));
  assertEquals(
    processingState({ insights: noneQualified, contactReady: 0, requested: 5, workRemains: true }),
    "Qualifying companies against your Company Brain…",
  );

  const qualified = insightsFromResult(result([
    diag({ company_key: "a", company_brain_status: "pass", qualification_status: "qualified", failed_gates: [] }),
    diag({ company_key: "b", company_brain_status: "pass", qualification_status: "qualified", failed_gates: [] }),
  ]));
  assertEquals(
    processingState({ insights: qualified, contactReady: 0, requested: 5, workRemains: true }),
    "2 companies qualified. Finding current founders and CEOs…",
  );
});

Deno.test("24b. a terminal empty state is only permitted once work has stopped", () => {
  const view = insightsFromResult(result([diag()]));
  // Work remains ⇒ never null, so a caller cannot show a terminal empty message.
  assert(processingState({ insights: view, contactReady: 0, requested: 5, workRemains: true }) !== null);
  // Work stopped ⇒ null, and the caller may show its terminal state.
  assertEquals(processingState({ insights: view, contactReady: 0, requested: 5, workRemains: false }), null);
  // Quota met ⇒ also terminal.
  assertEquals(processingState({ insights: view, contactReady: 5, requested: 5, workRemains: true }), null);
});

// =========================================== bounded / defensive reading ==

Deno.test("the view carries no raw payload or debug JSON", () => {
  const view = insightsFromResult(result([diag({ provider_payload: { huge: "x".repeat(5000) } })]));
  const blob = JSON.stringify(view);
  assertFalse(blob.includes("provider_payload"));
  assertFalse(blob.includes("xxxxxxxxxx"));
});

Deno.test("an unknown status from the wire degrades safely instead of throwing", () => {
  const d = readCompanyDiagnostic(diag({ qualification_status: "invented", company_brain_status: "weird" })) as CompanyDiagnosticView;
  assertEquals(d.qualification_status, "company_resolved");
  assertEquals(d.company_brain_status, "not_enforced");
});
