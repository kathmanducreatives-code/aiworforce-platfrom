// WORKBENCH INSIGHTS + ACTION PREREQUISITES.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  insightsFromResult, readDiagnosticsFromResult, buildQualificationInsightsView,
  readCompanyDiagnostic, processingState, gateLabel, gateLabels,
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
  // Unknown codes still SHOW — never hidden — but never as a raw snake_case
  // identifier either, which reads to a user as a bug rather than a reason.
  assertEquals(gateLabel("some_new_gate"), "Some new gate");
});

Deno.test("every gate code companyIcpFilter emits has a real sentence", () => {
  // These are the exact codes `add(...)` emits in companyIcpFilter.ts. `industry`
  // and `founder_led` had no entry, so TEST task
  // 8af17651-5fa2-48e2-af87-4bc923146243 rendered the bare word "industry" beside
  // a full sentence in the Workbench.
  for (const code of [
    "employee_count", "industry", "business_model", "company_stage", "founder_led",
  ]) {
    const label = gateLabel(code);
    assert(label !== code, `${code} must not render as its own field name`);
    assert(!label.includes("_"), `${code} must not render a snake_case identifier`);
    assert(/\s/.test(label), `${code} must render as words, not a token`);
  }
});

Deno.test("reasons that mean the same thing are shown once", () => {
  // A real rejection from that task: three codes, two meanings.
  assertEquals(gateLabels(["company_vertical", "industry", "business_model"]), [
    "Industry does not match the ICP",
    "Business model does not match the ICP",
  ]);
  // Order is stable and first-seen.
  assertEquals(gateLabels(["business_model", "industry", "company_vertical"]), [
    "Business model does not match the ICP",
    "Industry does not match the ICP",
  ]);
  assertEquals(gateLabels([]), []);
});

Deno.test("the failed-gate summary counts meanings once per company", () => {
  // Two companies, each failing BOTH industry-flavoured gates. The chip must read
  // 2, not 4, and must appear once rather than twice.
  const view = buildQualificationInsightsView(readDiagnosticsFromResult({
    company_first_state: {
      candidate_diagnostics: [
        diag({ company_key: "a", failed_gates: ["company_vertical", "industry"] }),
        diag({ company_key: "b", failed_gates: ["industry", "company_vertical"] }),
      ],
    },
  }));
  const industry = view.failed_gate_counts.filter(
    (g) => gateLabel(g.gate) === "Industry does not match the ICP");
  assertEquals(industry.length, 1, "one chip per meaning, not one per gate code");
  assertEquals(industry[0].count, 2, "counted once per company, not once per code");
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

// ============================== 1. THE REAL WORKBENCH CONSUMES THIS ==========
//
// The repo has NO component-test infrastructure — no @testing-library, no vitest
// binary, and no .test.tsx anywhere. Rather than add three devDependencies to
// satisfy one assertion, these use the source-assertion pattern the backend suite
// already uses (see `sourceObservationWiring.test.ts`, "both authorities have a
// real non-test production caller"). They prove the wiring exists in the real
// component, not in a fixture.

const viewSrc = () => Deno.readTextFile(
  new URL("../../components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url),
);
const panelSrc = () => Deno.readTextFile(
  new URL("../../components/chat/workspace/workbench/leadTable/QualificationInsightsPanel.tsx", import.meta.url),
);

Deno.test("1. the real Workbench view imports and renders the insights panel", async () => {
  const src = await viewSrc();
  assert(src.includes("insightsFromResult"), "the view must derive insights from the persisted run");
  assert(src.includes("processingState"), "the view must derive the processing state");
  assert(src.includes("<QualificationInsightsPanel"), "the panel must actually be rendered");
  assert(/insights=\{insights\}/.test(src), "the derived insights must be passed to the panel");
});

Deno.test("2/3. the panel renders company, signal, Brain status and exact failed gates", async () => {
  const src = await panelSrc();
  assert(src.includes("company_name"), "company name must render");
  assert(src.includes("hiring_signal_title"), "the hiring signal must render");
  assert(src.includes("company_brain_status"), "Company Brain status must render");
  assert(src.includes("gateLabels(c.failed_gates)"),
    "exact failed gates must render, humanised AND deduplicated");
  assertFalse(src.includes("failed_gates.map(gateLabel)"),
    "the undeduplicated render repeated the same sentence and must not return");
  assert(src.includes("rejection_summary"), "the rejection summary must render");
  assert(src.includes("companies_evaluated") && src.includes("companies_rejected"),
    "evaluated and rejected counts must render");
});

Deno.test("4. the panel is separate from the lead table and renders no opportunity row", async () => {
  const src = await panelSrc();
  // It renders `insights.rejected` only — never the lead rows.
  assert(src.includes("insights.rejected.map"));
  assertFalse(src.includes("LeadTableRow"), "the insights panel must not render lead rows");
  assertFalse(src.includes("quota_eligible: true"));
});

Deno.test("6. the panel renders the processing state while work continues", async () => {
  const src = await panelSrc();
  assert(src.includes("insights-processing"), "a processing line must exist");
  assert(src.includes("{processing}"), "the processing state must be rendered");
  // And an empty terminal state is only reachable when nothing is in flight.
  assert(/companies_evaluated === 0 && !processing/.test(src),
    "the empty state must require BOTH no diagnostics and no in-flight work");
});

Deno.test("no raw provider payload or debug JSON is rendered", async () => {
  const src = await panelSrc();
  for (const banned of ["JSON.stringify", "provider_payload", "raw"]) {
    assertFalse(src.includes(banned), `the panel must not render ${banned}`);
  }
});
