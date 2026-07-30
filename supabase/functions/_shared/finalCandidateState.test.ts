// Provider-free tests for the canonical FINAL candidate state + post-enrichment
// evidence refresh. Everything is pure: no clock, no network, no provider.
//
// These encode the v84 controlled-Q1 defects as regressions:
//   - the same candidate reported as BOTH staged and rejected
//   - company-fit-verified founders labelled rejection_class=qualification_threshold
//     while company observability recommended signal_enrichment
//   - PRE-enrichment evidence_missing (industry/website) surviving enrichment

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveFinalCandidateState, refreshEvidenceMissing,
  type FinalCandidateStateInput,
} from "./finalCandidateState.ts";

const base: FinalCandidateStateInput = {
  sourceGateDecision: "needs_verification",
  providerVerified: true,
  artifactMatches: true,
  hardEvidenceViolation: null,
  icpContradiction: false,
  sufficiencyDecision: null,
  missingCritical: [],
  companyOutcome: "not_attempted",
  ariaEvaluated: true,
  persistDecision: { persist: false, reason: "tier_rejected" },
  stagedByEnrichment: false,
};
const withInput = (o: Partial<FinalCandidateStateInput>) => resolveFinalCandidateState({ ...base, ...o });

// ---- (9)(10)(11)(12)(13) company fit complete + timing missing ----
Deno.test("9/10/11: company fit proven but timing missing ⇒ stage_missing_evidence + signal_enrichment", () => {
  // Exactly the v84 shape: enriched company, tier said "rejected", no timing signal.
  const r = withInput({
    companyOutcome: "enriched",
    sufficiencyDecision: "signal_enrichment",
    missingCritical: ["job_signal", "funding_signal", "gtm_signal"],
    stagedByEnrichment: true,
    persistDecision: { persist: false, reason: "tier_rejected" },
  });
  assertEquals(r.state, "stage_missing_evidence");
  assertEquals(r.stage_reason, "missing_timing_signal");
  assertEquals(r.next_action, "signal_enrichment");
  assertEquals(r.reason_code, "missing_timing_signal");
  // (11) must NOT be a threshold reject
  assertEquals(r.rejection_class, null);
});

Deno.test("12/13: a company-fit/no-timing candidate never persists and never reaches Aria", () => {
  const r = withInput({
    companyOutcome: "enriched", sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    stagedByEnrichment: true,
  });
  assertEquals(r.persist, false);
  assertEquals(r.sent_to_downstream_aria, false);
});

// ---- (14) missing company evidence ----
Deno.test("14: missing company evidence ⇒ stage_missing_evidence + company_enrichment", () => {
  const r = withInput({
    sufficiencyDecision: "structured_company_enrichment",
    missingCritical: ["company_website", "company_industry"],
  });
  assertEquals(r.state, "stage_missing_evidence");
  assertEquals(r.stage_reason, "missing_company_evidence");
  assertEquals(r.next_action, "company_enrichment");
  assertEquals(r.persist, false);
});

// ---- (15)(16)(17) genuine rejects ----
Deno.test("15: a verified ICP contradiction is a genuine reject", () => {
  const r = withInput({ icpContradiction: true, missingCritical: [] });
  assertEquals(r.state, "reject");
  assertEquals(r.rejection_class, "icp_mismatch");
  assertEquals(r.reason_code, "icp_contradiction");
  assertEquals(r.persist, false);
  assertEquals(r.sent_to_downstream_aria, false);
});

Deno.test("16: source-gate geography failure remains a hard reject", () => {
  const r = withInput({ sourceGateDecision: "reject" });
  assertEquals(r.state, "reject");
  assertEquals(r.rejection_class, "hard_source");
  assertEquals(r.reason_code, "source_gate_reject");
});

Deno.test("17: unverified identity is never accepted", () => {
  const unverified = withInput({ providerVerified: false, persistDecision: { persist: true, reason: "aria_accepted" } });
  assertEquals(unverified.state, "reject");
  assertEquals(unverified.rejection_class, "hard_source");
  assertEquals(unverified.persist, false);

  const mismatch = withInput({ artifactMatches: false });
  assertEquals(mismatch.state, "reject");
  assertEquals(mismatch.reason_code, "artifact_mismatch");

  const violation = withInput({ hardEvidenceViolation: "profile_as_job" });
  assertEquals(violation.state, "reject");
  assertEquals(violation.reason_code, "evidence_violation:profile_as_job");
});

Deno.test("evidence COMPLETE but qualification refused ⇒ genuine threshold reject", () => {
  const r = withInput({
    sufficiencyDecision: "qualify_now", missingCritical: [],
    persistDecision: { persist: false, reason: "aria_rejected" },
  });
  assertEquals(r.state, "reject");
  assertEquals(r.rejection_class, "qualification_threshold");
  assertEquals(r.reason_code, "aria_rejected");
});

// ---- (18)(19)(20) company actor degradations all stage ----
Deno.test("18/19/20: no_result, timeout and deadline-skip all stage (never reject)", () => {
  const cases: Array<[FinalCandidateStateInput["companyOutcome"], string, string]> = [
    ["no_result", "company_no_result", "company_no_result"],
    ["timeout", "company_timeout", "company_timeout"],
    ["skipped_due_deadline", "company_deadline_skipped", "company_skipped_due_deadline"],
    ["failed", "company_no_result", "company_provider_error"],
  ];
  for (const [outcome, stageReason, reasonCode] of cases) {
    const r = withInput({ companyOutcome: outcome, missingCritical: ["company_website"] });
    assertEquals(r.state, "stage_missing_evidence", `${outcome} must stage`);
    assertEquals(r.stage_reason, stageReason);
    assertEquals(r.reason_code, reasonCode);
    assertEquals(r.next_action, "company_enrichment");
    assertEquals(r.persist, false);
    assertEquals(r.sent_to_downstream_aria, false);
    assertEquals(r.rejection_class, null);
  }
});

// ---- (1) exactly one state; (26)(27) persistence + Aria safety ----
Deno.test("1/26/27: qualify_now only when the persistence authority accepted", () => {
  const accepted = withInput({
    sufficiencyDecision: "qualify_now", missingCritical: [],
    persistDecision: { persist: true, reason: "aria_accepted" },
  });
  assertEquals(accepted.state, "qualify_now");
  assertEquals(accepted.persist, true);
  assertEquals(accepted.sent_to_downstream_aria, true);
  assertEquals(accepted.rejection_class, null);
  assertEquals(accepted.stage_reason, null);

  // Enrichment can only TIGHTEN: force-staged wins over an accept.
  const tightened = withInput({
    sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    persistDecision: { persist: true, reason: "aria_accepted" }, stagedByEnrichment: true,
  });
  assertEquals(tightened.state, "stage_missing_evidence");
  assertEquals(tightened.persist, false);
  assertEquals(tightened.sent_to_downstream_aria, false);
});

Deno.test("qualification never ran ⇒ staged awaiting_qualification, never accepted", () => {
  const r = withInput({ ariaEvaluated: false, missingCritical: [], sufficiencyDecision: null, persistDecision: { persist: false, reason: "no_qualification" } });
  assertEquals(r.state, "stage_missing_evidence");
  assertEquals(r.stage_reason, "awaiting_qualification");
  assertEquals(r.next_action, "qualification");
  assertEquals(r.persist, false);
});

Deno.test("1/3: every result is exactly one state and staged/reject fields are exclusive", () => {
  const inputs: Partial<FinalCandidateStateInput>[] = [
    { sourceGateDecision: "reject" },
    { icpContradiction: true },
    { companyOutcome: "timeout" },
    { companyOutcome: "no_result" },
    { companyOutcome: "skipped_due_deadline" },
    { sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"] },
    { sufficiencyDecision: "structured_company_enrichment", missingCritical: ["company_website"] },
    { sufficiencyDecision: "qualify_now", missingCritical: [], persistDecision: { persist: true, reason: "aria_accepted" } },
    { sufficiencyDecision: "qualify_now", missingCritical: [], persistDecision: { persist: false, reason: "aria_rejected" } },
    { ariaEvaluated: false },
  ];
  for (const i of inputs) {
    const r = withInput(i);
    assert(["qualify_now", "stage_missing_evidence", "reject"].includes(r.state));
    // A staged candidate carries a stage_reason and NO rejection class; a reject the inverse.
    if (r.state === "stage_missing_evidence") {
      assert(r.stage_reason !== null, "staged needs a stage_reason");
      assertEquals(r.rejection_class, null, "staged must not carry a rejection class");
      assertEquals(r.persist, false);
      assertEquals(r.sent_to_downstream_aria, false);
    }
    if (r.state === "reject") {
      assert(r.rejection_class !== null, "reject needs a rejection class");
      assertEquals(r.stage_reason, null, "reject must not carry a stage reason");
      assertEquals(r.persist, false);
      assertEquals(r.sent_to_downstream_aria, false);
    }
    if (r.state === "qualify_now") assertEquals(r.persist, true);
  }
});

Deno.test("a missing timing signal is never a reject even without a sufficiency verdict", () => {
  const r = withInput({ sufficiencyDecision: null, missingCritical: ["funding_signal"] });
  assertEquals(r.state, "stage_missing_evidence");
  assertEquals(r.next_action, "signal_enrichment");
});

// ---------------------------------------------- evidence refresh (4-8) --------

Deno.test("4/5: a verified website + industry remove website/industry from missing evidence", () => {
  const refreshed = refreshEvidenceMissing({
    staleMissingFields: ["industry", "website"],   // the exact stale v84 array
    patch: { company_website: "https://flowstategtm.com", company_industries: ["Software Development"] },
  });
  assertEquals(refreshed.includes("company_website"), false);
  assertEquals(refreshed.includes("company_industry"), false);
  assertEquals(refreshed, []);
});

Deno.test("6/7: verified size and geography close their gaps", () => {
  const size = refreshEvidenceMissing({ staleMissingFields: ["company_size"], patch: { company_employee_range: "11-50" } });
  assertEquals(size, []);
  const sizeByCount = refreshEvidenceMissing({ staleMissingFields: ["company_size"], patch: { company_employee_count: 42 } });
  assertEquals(sizeByCount, []);
  const geo = refreshEvidenceMissing({ staleMissingFields: ["location"], patch: { company_country: "United States" } });
  assertEquals(geo, []);
  const geoByCode = refreshEvidenceMissing({ staleMissingFields: ["location"], patch: { company_country_code: "US" } });
  assertEquals(geoByCode, []);
});

Deno.test("genuinely missing evidence is preserved; an absent patch closes nothing", () => {
  const r = refreshEvidenceMissing({ staleMissingFields: ["industry", "website"], patch: { company_website: "https://x.com" } });
  assertEquals(r, ["company_industry"]);
  const none = refreshEvidenceMissing({ staleMissingFields: ["industry", "website"], patch: null });
  assertEquals(none, ["company_industry", "company_website"]);
  // Empty/blank provider values are NOT evidence.
  const blank = refreshEvidenceMissing({ staleMissingFields: ["website", "industry"], patch: { company_website: "", company_industries: [] } });
  assertEquals(blank, ["company_website", "company_industry"]);
});

Deno.test("8: sufficiencyAfter is authoritative — timing gaps survive company enrichment", () => {
  // Post-enrichment truth: firmographics closed, timing still open.
  const r = refreshEvidenceMissing({
    staleMissingFields: ["industry", "website"],
    patch: { company_website: "https://flowstategtm.com", company_industries: ["Software"] },
    sufficiencyMissingAfter: ["job_signal", "funding_signal", "gtm_signal"] as any,
  });
  assertEquals(r, ["job_signal", "funding_signal", "gtm_signal"]);
  assertEquals(r.includes("company_website"), false);
  assertEquals(r.includes("company_industry"), false);
});

Deno.test("an empty authoritative gap list wins over the stale array", () => {
  const r = refreshEvidenceMissing({
    staleMissingFields: ["industry", "website"],
    sufficiencyMissingAfter: [] as any,
  });
  assertEquals(r, []);
});
