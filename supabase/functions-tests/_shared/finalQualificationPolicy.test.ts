// Timing-aware final qualification policy (provider-free). Proves a fully verified,
// timing_sufficient candidate reaches qualify_now WITHOUT weakening any safety gate.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveFinalCandidateState, type FinalCandidateStateInput } from "../../functions/_shared/finalCandidateState.ts";

const base = (over: Partial<FinalCandidateStateInput> = {}): FinalCandidateStateInput => ({
  sourceGateDecision: "accept", providerVerified: true, artifactMatches: true,
  ariaEvaluated: true, persistDecision: { persist: false, reason: "tier_rejected" }, ...over,
});

// (1)(17)(18) verified identity + fit + timing + complete evidence ⇒ qualify_now
Deno.test("1/17/18: fit-verified + timing_sufficient reaches qualify_now (reachable in the reducer)", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"], companyOutcome: "enriched", timingDecision: "timing_sufficient" }));
  assertEquals(s.state, "qualify_now");
  assertEquals(s.reason_code, "all_required_evidence_verified");
  assertEquals(s.persist, true);              // ⇒ enters finalPersistSet
});

// (2) timing sufficient alone cannot force qualify_now (fit not verified)
Deno.test("2/3: company fit incomplete + timing_sufficient stays staged (fit never bypassed)", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "structured_company_enrichment", missingCritical: ["company_industry"], companyOutcome: "enriched", timingDecision: "timing_sufficient" }));
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_company_evidence");
  assertEquals(s.persist, false);
});

// (4) person role/identity unverified + timing sufficient ⇒ not qualify (reject hard source)
Deno.test("4: unverified provenance + timing_sufficient never qualifies (hard source reject)", () => {
  const s = resolveFinalCandidateState(base({ providerVerified: false, sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "timing_sufficient" }));
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "hard_source");
  assertEquals(s.persist, false);
});

// (5)(6)(7) verified contradictions reject even with timing_sufficient
Deno.test("5/6/7: a verified ICP contradiction rejects even when timing_sufficient + fit complete", () => {
  const s = resolveFinalCandidateState(base({ icpContradiction: true, sufficiencyDecision: "qualify_now", missingCritical: [], companyOutcome: "enriched", timingDecision: "timing_sufficient" }));
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "icp_mismatch");
  assertEquals(s.persist, false);
});

// (8) missing company size stages (never a hard reject)
Deno.test("8: missing company evidence stages rather than rejects", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "structured_company_enrichment", missingCritical: ["company_size"], companyOutcome: "no_result", timingDecision: null }));
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.rejection_class, null);
  assertEquals(s.persist, false);
});

// (9) missing timing stages for signal_enrichment
Deno.test("9/29: missing timing stages for signal_enrichment; no persist from timing alone", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"], companyOutcome: "enriched", timingDecision: "missing_timing_evidence" }));
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_timing_signal");
  assertEquals(s.next_action, "signal_enrichment");
  assertEquals(s.persist, false);
});

// timing_contradicted rejects (verified contradiction, not missing)
Deno.test("timing_contradicted rejects even with fit verified", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "timing_contradicted" }));
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "timing_contradiction");
});

// (16) a complete + timing-sufficient candidate is not retained in a generic staged fallback
Deno.test("16: complete evidence + timing_sufficient is never held in a generic 'not_accepted' stage", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "qualify_now", missingCritical: [], companyOutcome: "enriched", timingDecision: "timing_sufficient" }));
  assertEquals(s.state, "qualify_now");
  assert(s.reason_code !== "not_accepted");
});

// enrichment force-stage still tightens (fit proven, timing missing at company stage)
Deno.test("stagedByEnrichment tightens: never qualifies via the deterministic path", () => {
  const s = resolveFinalCandidateState(base({ sufficiencyDecision: "signal_enrichment", companyOutcome: "enriched", timingDecision: "timing_sufficient", stagedByEnrichment: true }));
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.persist, false);
});

// (25) mutually exclusive final states + (2) timing_not_required unaffected
Deno.test("25: exactly one final state; timing_not_required keeps the aria path", () => {
  const q = resolveFinalCandidateState(base({ sufficiencyDecision: "qualify_now", missingCritical: [], persistDecision: { persist: true, reason: "aria_accepted" }, timingDecision: "timing_not_required" }));
  assertEquals(q.state, "qualify_now");
  assert(["qualify_now", "stage_missing_evidence", "reject"].includes(q.state));
  // non-timing intent, aria under-scored, complete evidence ⇒ existing threshold reject (unchanged)
  const r = resolveFinalCandidateState(base({ sufficiencyDecision: "qualify_now", missingCritical: [], persistDecision: { persist: false, reason: "not_accepted" }, timingDecision: "timing_not_required" }));
  assertEquals(r.state, "reject");
  assertEquals(r.rejection_class, "qualification_threshold");
});
