// THE PANEL→INSIGHTS SEAM.
//
// Production task 15c31f55 persisted TEN diagnostics and the Workbench rendered
// "0 evaluated". The cause was not the projection logic — it was that the panel
// meta is built from `qualifiedLeadRunContext`, which never carried the
// diagnostics across. These tests pin the seam in the shape the backend now emits.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { insightsFromResult, processingState } from "./insights.ts";

/** The exact shape `buildQualifiedLeadRunContext` now attaches to the panel. */
function runContext(diags: unknown[]) {
  return { version: "qlrc-1", company_first_state: { candidate_diagnostics: diags } };
}

const gumloop = {
  company_key: "domain:gumloop.com", company_name: "Gumloop", company_domain: "gumloop.com",
  hiring_signal_title: "GTM Operations Lead",
  hiring_signal_url: "https://www.linkedin.com/jobs/view/4411292622",
  hiring_signal_date: "2026-07-28", title_family: "sales_ops",
  company_identity_status: "resolved", company_brain_status: "fail",
  failed_gates: ["industry"], missing_evidence: ["business_model", "company_stage"],
  qualification_status: "rejected", quota_eligible: false,
};

Deno.test("a run context carrying diagnostics is read by the SAME projection", () => {
  const v = insightsFromResult(runContext([gumloop]));
  assertEquals(v.companies_evaluated, 1);
  assertEquals(v.companies_rejected, 1);
  assertEquals(v.rejected[0].company_name, "Gumloop");
});

Deno.test("ten backend diagnostics can never render as zero evaluated", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...gumloop, company_key: `c${i}` }));
  const v = insightsFromResult(runContext(ten));
  assertEquals(v.companies_evaluated, 10);
  assert(v.companies_evaluated > 0, "the exact production defect: 10 backend records, 0 shown");
});

Deno.test("MISSING evidence is never reported as a failed gate", () => {
  const v = insightsFromResult(runContext([gumloop]));
  const row = v.rejected[0];
  // Only the constraint the Brain actually evaluated and rejected.
  assertEquals(row.failed_gates, ["industry"]);
  // The unknowns are carried separately, not as failures.
  assertEquals(row.missing_evidence, ["business_model", "company_stage"]);
  assertFalse(row.failed_gates.includes("business_model"));
  assertFalse(row.failed_gates.includes("employee_count"));
  // And the gate summary counts only the real failure.
  assertEquals(v.failed_gate_counts, [{ gate: "industry", count: 1 }]);
});

Deno.test("evidence-pending companies are their own list, not rejections", () => {
  const pending = {
    ...gumloop, company_key: "pend", company_name: "Pending Co",
    company_brain_status: "evidence_pending", qualification_status: "qualification_pending",
    failed_gates: [], missing_evidence: ["employee_count"],
  };
  const v = insightsFromResult(runContext([gumloop, pending]));
  assertEquals(v.companies_pending, 1);
  assertEquals(v.companies_rejected, 1);
  assertEquals(v.evidence_pending.length, 1);
  assertEquals(v.evidence_pending[0].company_name, "Pending Co");
  assertFalse(v.rejected.some((r) => r.company_name === "Pending Co"),
    "evidence pending must NEVER render as rejected");
});

Deno.test("a terminal task never shows the collecting message", () => {
  const v = insightsFromResult(runContext([gumloop]));
  // Terminal ⇒ null ⇒ the caller must render its terminal state, not "Collecting…".
  assertEquals(processingState({ insights: v, contactReady: 0, requested: 5, workRemains: false }), null);
  // And while work genuinely remains it is never the generic collecting line,
  // because companies have already been evaluated.
  const live = processingState({ insights: v, contactReady: 0, requested: 5, workRemains: true });
  assert(live !== null);
  assertFalse(String(live).startsWith("Collecting"),
    "with companies already evaluated the state must move past collection");
});

Deno.test("an absent diagnostics slice degrades honestly, it does not throw", () => {
  for (const bad of [{}, { company_first_state: {} }, null, { version: "x" }]) {
    const v = insightsFromResult(bad);
    assertEquals(v.companies_evaluated, 0);
    assertEquals(v.empty_reason, "no_companies_evaluated");
  }
});
