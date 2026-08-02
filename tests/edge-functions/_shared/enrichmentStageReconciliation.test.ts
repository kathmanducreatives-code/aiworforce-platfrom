// Provider-free tests for reconciling the company-enrichment staging flag against
// the later signal stage, and the end-to-end effect through the ONE reducer.
//
// Regression anchor: the live v87 query (plan 3b5a35a2…) sourced 5 people, enriched
// 5 companies, ran 4 jobs lookups, produced 3 `timing_sufficient` candidates — yet
// qualification reported 0 qualify_now / 5 staged. Root cause: `companyEnrichmentStaged`
// (captured BEFORE signal enrichment) was passed raw into the reducer, whose
// timing-aware qualify_now (step 3b) correctly requires `stagedByEnrichment !== true`.
// The stale flag blocked the positive path. The reducer was never the defect.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stillStagedByEnrichmentAfterTiming } from "../../../supabase/functions/_shared/runAgentCompanyEnrichment.ts";
import { resolveFinalCandidateState, type FinalCandidateStateInput } from "../../../supabase/functions/_shared/finalCandidateState.ts";
import type { SufficiencyDecision } from "../../../supabase/functions/_shared/evidenceSufficiency.ts";
import type { TimingDecision } from "../../../supabase/functions/_shared/timingAssessment.ts";

// ---- the pure reconciliation ----

const recon = (
  companyStaged: boolean,
  sufficiencyDecisionAfter: SufficiencyDecision | "unknown" | null,
  timingDecision: TimingDecision | null,
) => stillStagedByEnrichmentAfterTiming({ companyStaged, sufficiencyDecisionAfter, timingDecision });

// (1) company stage caused ONLY by missing timing is cleared after timing_sufficient
Deno.test("1: fit-settled + company-staged-for-timing + timing_sufficient ⇒ flag cleared", () => {
  assertEquals(recon(true, "signal_enrichment", "timing_sufficient"), false);
  // qualify_now sufficiency (all evidence present incl. timing) likewise clears.
  assertEquals(recon(true, "qualify_now", "timing_sufficient"), false);
});

// (2) company stage caused by incomplete COMPANY evidence remains staged even after timing_sufficient
Deno.test("2: fit-incomplete stays staged even when timing_sufficient", () => {
  assertEquals(recon(true, "structured_company_enrichment", "timing_sufficient"), true);
  assertEquals(recon(true, "targeted_web_verification", "timing_sufficient"), true);
  assertEquals(recon(true, "stage_missing_evidence", "timing_sufficient"), true);
});

// (6) missing timing keeps the flag; (7) contradiction keeps it; unknown keeps it
Deno.test("6/7: missing/contradicted/unknown timing never clears the flag", () => {
  assertEquals(recon(true, "signal_enrichment", "missing_timing_evidence"), true);
  assertEquals(recon(true, "signal_enrichment", "timing_contradicted"), true);
  assertEquals(recon(true, "signal_enrichment", "timing_not_required"), true);
  assertEquals(recon(true, "signal_enrichment", null), true);
});

Deno.test("a candidate never company-staged is never staged-by-enrichment", () => {
  assertEquals(recon(false, "signal_enrichment", "timing_sufficient"), false);
  assertEquals(recon(false, "structured_company_enrichment", "missing_timing_evidence"), false);
});

// ---- end-to-end through the ONE reducer (reconciled input) ----

const base = (over: Partial<FinalCandidateStateInput> = {}): FinalCandidateStateInput => ({
  sourceGateDecision: "accept", providerVerified: true, artifactMatches: true,
  ariaEvaluated: true, persistDecision: { persist: false, reason: "tier_rejected" }, ...over,
});

/** Mirror the run-agent wiring: reconcile, then feed the reducer. */
function resolveWithReconciliation(input: Omit<FinalCandidateStateInput, "stagedByEnrichment"> & {
  companyStaged: boolean;
}) {
  const { companyStaged, ...rest } = input;
  const stagedByEnrichment = stillStagedByEnrichmentAfterTiming({
    companyStaged,
    sufficiencyDecisionAfter: rest.sufficiencyDecision ?? null,
    timingDecision: rest.timingDecision ?? null,
  });
  return resolveFinalCandidateState({ ...rest, stagedByEnrichment });
}

// THE EXACT v87 REGRESSION: company-staged, fit verified, timing_sufficient, no other
// missing evidence, no contradiction ⇒ qualify_now / all_required_evidence_verified / persist
Deno.test("v87 regression: company-staged + fit verified + timing_sufficient ⇒ qualify_now", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true,                          // was blocking the positive path
    sufficiencyDecision: "signal_enrichment",     // identity+fit settled, timing was the only gap
    missingCritical: ["job_signal"],
    companyOutcome: "enriched",
    timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "qualify_now");
  assertEquals(s.reason_code, "all_required_evidence_verified");
  assertEquals(s.persist, true);                  // (14) ⇒ enters finalPersistSet
  assertEquals(s.sent_to_downstream_aria, true);
});

// (3) verified fit + timing_sufficient + no contradiction reaches qualify_now (even if never company-staged)
Deno.test("3: verified fit + timing_sufficient + no contradiction ⇒ qualify_now", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: false, sufficiencyDecision: "qualify_now", missingCritical: [],
    companyOutcome: "enriched", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "qualify_now");
  assertEquals(s.persist, true);
});

// (B / 6) company fit verified + timing missing ⇒ stage missing_timing_signal
Deno.test("B: fit verified + timing missing stays staged (missing_timing_signal)", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    companyOutcome: "enriched", timingDecision: "missing_timing_evidence",
  }) as any);
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_timing_signal");
  assertEquals(s.persist, false);
});

// (A / 2) company fit incomplete + timing_sufficient ⇒ still staged (fit never bypassed)
Deno.test("A: fit incomplete + timing_sufficient stays staged for company evidence", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, sufficiencyDecision: "structured_company_enrichment",
    missingCritical: ["company_industry"], companyOutcome: "enriched", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_company_evidence");
  assertEquals(s.persist, false);
});

// (D / 8) hard source failure + timing_sufficient ⇒ reject
Deno.test("D: unverified provenance + timing_sufficient ⇒ reject (hard source)", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, providerVerified: false, sufficiencyDecision: "signal_enrichment",
    companyOutcome: "enriched", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "hard_source");
  assertEquals(s.persist, false);
});

// (E / 9) verified ICP contradiction + timing_sufficient ⇒ reject
Deno.test("E: ICP contradiction + timing_sufficient ⇒ reject", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, icpContradiction: true, sufficiencyDecision: "qualify_now",
    missingCritical: [], companyOutcome: "enriched", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "icp_mismatch");
  assertEquals(s.persist, false);
});

Deno.test("timing_contradicted + fit verified ⇒ reject even after reconciliation", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched",
    timingDecision: "timing_contradicted",
  }) as any);
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "timing_contradiction");
});

// (F / 10) company provider timeout + timing_sufficient ⇒ stage (fitVerified false ⇒ never qualifies)
Deno.test("F/10: company timeout + timing_sufficient stays staged", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, sufficiencyDecision: "structured_company_enrichment",
    missingCritical: ["company_website"], companyOutcome: "timeout", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "company_timeout");
  assertEquals(s.persist, false);
});

// (11) no-result company enrichment remains staged
Deno.test("11: company no_result + timing_sufficient stays staged", () => {
  const s = resolveWithReconciliation(base({
    companyStaged: true, sufficiencyDecision: "structured_company_enrichment",
    missingCritical: ["company_industry"], companyOutcome: "no_result", timingDecision: "timing_sufficient",
  }) as any);
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "company_no_result");
  assertEquals(s.persist, false);
});

// (12)(13)(14) persist ⇔ qualify_now
Deno.test("12/13/14: persist is true iff final state is qualify_now", () => {
  const cases: Array<[Partial<FinalCandidateStateInput> & { companyStaged: boolean }, boolean]> = [
    [{ companyStaged: true, sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "timing_sufficient" }, true],
    [{ companyStaged: true, sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "missing_timing_evidence" }, false],
    [{ companyStaged: true, providerVerified: false, sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "timing_sufficient" }, false],
    [{ companyStaged: true, icpContradiction: true, sufficiencyDecision: "qualify_now", companyOutcome: "enriched", timingDecision: "timing_sufficient" }, false],
  ];
  for (const [over, expectPersist] of cases) {
    const s = resolveWithReconciliation(base(over) as any);
    assertEquals(s.persist, expectPersist);
    assertEquals(s.persist, s.state === "qualify_now", "persist ⇔ qualify_now invariant");
  }
});
