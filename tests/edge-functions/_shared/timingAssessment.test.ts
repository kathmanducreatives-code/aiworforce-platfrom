// Provider-free tests for timing requirement compilation, timing sufficiency, the
// conditional signal planner and signal deduplication.
//
// These prove the Phase A contract that the v85 live run identified as the missing
// capability: company fit is verified, but nothing yet answers "why now?".

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { compileEvidenceContract } from "../../../supabase/functions/_shared/evidenceContract.ts";
import type { SignalEvent, SignalType } from "../../../supabase/functions/_shared/signalEvent.ts";
import { compileTimingRequirement, evaluateTimingSufficiency } from "../../../supabase/functions/_shared/timingAssessment.ts";
import {
  planSignalEnrichment, deduplicateSignals, emptySignalLedger,
  DEFAULT_SIGNAL_BUDGET, type SignalEnrichmentBudget,
} from "../../../supabase/functions/_shared/conditionalSignalPlanner.ts";
import type { EvidenceSufficiencyResult } from "../../../supabase/functions/_shared/evidenceSufficiency.ts";
import { resolveFinalCandidateState } from "../../../supabase/functions/_shared/finalCandidateState.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();
const BRAIN = { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" };

const contractFor = (text: string) => compileEvidenceContract(compileLeadEntityIntent(text), BRAIN);

const sig = (o: Partial<SignalEvent> = {}): SignalEvent => ({
  signal_id: "s1", workspace_id: "w1",
  signal_type: "sales_hiring", signal_category: "gtm",
  company_ref: "co_acme",
  evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.test/j/1", confidence: "high" }],
  occurred_at: hoursAgo(24), observed_at: NOW,
  confidence: "high", verification: "provider_verified",
  dedupe_key: "", status: "active", sanitized: true,
  ...o,
});

// ---- (10)(11)(12)(13) user intent compiles timing requirements ----
Deno.test("11: 'hot founders right now' requires timing (any-of)", () => {
  const r = compileTimingRequirement(contractFor("Using my ICP, find me 5 hot founders I should contact right now."));
  assertEquals(r.required, true);
  assertEquals(r.anyOfSufficient, true, "'hot' accepts one genuinely strong reason");
  assert(r.requiredCategories.length > 0);
});

Deno.test("10: generic ICP discovery does not require timing", () => {
  const r = compileTimingRequirement(contractFor("Find B2B SaaS founders in the United States"));
  assertEquals(r.required, false);
  assertEquals(r.requiredCategories, []);

  // …and the assessment says so rather than staging.
  const a = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [], now: NOW });
  assertEquals(a.decision, "timing_not_required");
  assertEquals(a.next_action, "none");
});

Deno.test("12: 'recently funded' requires a relevant fresh funding signal", () => {
  const r = compileTimingRequirement(contractFor("Find B2B SaaS founders whose companies recently raised funding"));
  assertEquals(r.required, true);
  assert(r.requiredCategories.includes("funding_signal"), "the named signal must be proven");
  assertEquals(r.anyOfSufficient, false, "a named signal is all-of, not any-of");

  // A hiring signal does not satisfy a funding request.
  const wrong = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [sig()], now: NOW });
  assertEquals(wrong.decision, "missing_timing_evidence");
  assert(wrong.missing_categories.includes("funding_signal"));

  // The right, fresh signal satisfies it.
  const funding = sig({
    signal_type: "recent_funding", signal_category: "growth", occurred_at: hoursAgo(48),
    evidence_refs: [{ category: "funding_signal", sourceType: "public_web", confidence: "high" }],
  });
  const ok = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [funding], now: NOW });
  assertEquals(ok.decision, "timing_sufficient");
});

Deno.test("the explicit user window is the stricter authority over the general policy", () => {
  // "recently funded" now compiles a 90-day window (the approved policy), so a
  // 20-day-old round IS sufficient — the old 168h contract window made this a 7-day
  // question, which was far too restrictive. See fundingFreshnessPolicy.test.ts.
  const r = compileTimingRequirement(contractFor("Find B2B SaaS founders whose companies recently raised funding"));
  assertEquals(r.maxAgeHoursByCategory.funding_signal, 24 * 90);
  const twentyDays = sig({
    signal_type: "recent_funding", signal_category: "growth", occurred_at: hoursAgo(24 * 20),
    evidence_refs: [{ category: "funding_signal", sourceType: "public_web", confidence: "high" }],
  });
  const ok = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [twentyDays], now: NOW });
  assertEquals(ok.decision, "timing_sufficient");

  // …but an explicit "this week" still wins over the general 90-day policy.
  const strict = compileTimingRequirement(contractFor("Find B2B SaaS founders funded this week"));
  assertEquals(strict.maxAgeHoursByCategory.funding_signal, 24 * 7);
  const a = evaluateTimingSufficiency({ candidateId: "c1", requirement: strict, signals: [twentyDays], now: NOW });
  assertEquals(a.decision, "missing_timing_evidence");
  assertEquals(a.stale_signal_ids, ["s1"], "the explicit 7-day window makes it stale");
});

Deno.test("each category keeps its OWN window in an any-of request", () => {
  // Regression: applying the tightest window (job_signal 72h) across every category
  // would wrongly age out a 5-day-old funding signal in a "hot" request.
  const r = compileTimingRequirement(contractFor("find me hot founders right now"));
  assertEquals(r.maxAgeHoursByCategory.job_signal, 24 * 30);
  assertEquals(r.maxAgeHoursByCategory.funding_signal, 24 * 180);
  const fiveDayFunding = sig({
    signal_type: "recent_funding", signal_category: "growth", occurred_at: hoursAgo(120),
    evidence_refs: [{ category: "funding_signal", sourceType: "public_web", confidence: "high" }],
  });
  const a = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [fiveDayFunding], now: NOW });
  assertEquals(a.decision, "timing_sufficient", "funding must use its own window, not job_signal's 72h");
});

Deno.test("13: 'currently hiring sales' requires a fresh hiring signal", () => {
  const r = compileTimingRequirement(contractFor("Find B2B SaaS companies currently hiring sales people"));
  assertEquals(r.required, true);
  assert(r.requiredCategories.includes("job_signal"));

  const fresh = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [sig()], now: NOW });
  assertEquals(fresh.decision, "timing_sufficient");
});

// ---- (6)(7) fresh satisfies, stale does not ----
Deno.test("6/7: a fresh signal satisfies the requirement; a stale one does not", () => {
  const r = compileTimingRequirement(contractFor("find me hot founders right now"));

  const fresh = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [sig({ occurred_at: hoursAgo(12) })], now: NOW });
  assertEquals(fresh.decision, "timing_sufficient");
  assertEquals(fresh.satisfied_categories.includes("job_signal"), true);

  const stale = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [sig({ occurred_at: hoursAgo(24 * 400) })], now: NOW });
  assertEquals(stale.decision, "missing_timing_evidence");
  assertEquals(stale.next_action, "signal_enrichment");
  assertEquals(stale.stale_signal_ids, ["s1"]);
});

// ---- (8)(9) weak alone insufficient; supporting signals may combine ----
Deno.test("8/9: one weak signal is not enough; configured supporting signals may combine", () => {
  const r = compileTimingRequirement(contractFor("find me hot founders right now"));
  const weak = (id: string, t: SignalType): SignalEvent => sig({
    signal_id: id, signal_type: t, signal_category: "founder_intent",
    verification: "self_reported", person_ref: "p1", company_ref: null,
    occurred_at: hoursAgo(24),
    evidence_refs: [{ category: "founder_activity_signal", sourceType: "public_web", confidence: "medium" }],
  });

  const one = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [weak("s1", "founder_pipeline_post")], now: NOW });
  assertEquals(one.decision, "missing_timing_evidence", "a single weak signal never satisfies alone");

  const two = evaluateTimingSufficiency({
    candidateId: "c1", requirement: r,
    signals: [weak("s1", "founder_pipeline_post"), weak("s2", "founder_outbound_post")], now: NOW,
  });
  assertEquals(two.decision, "timing_sufficient");
  assert(two.explanation.includes("supporting"));
});

// ---- timing contradiction ----
Deno.test("a verified contradiction outranks a positive signal and never fabricates urgency", () => {
  const r = compileTimingRequirement(contractFor("find me hot founders right now"));
  const left = sig({
    signal_id: "risk1", signal_type: "person_left_company", signal_category: "risk",
    person_ref: "p1", occurred_at: hoursAgo(24),
    evidence_refs: [{ category: "person_identity", sourceType: "apify_actor", confidence: "high" }],
  });
  const a = evaluateTimingSufficiency({ candidateId: "c1", requirement: r, signals: [sig(), left], now: NOW });
  assertEquals(a.decision, "timing_contradicted");
  assertEquals(a.contradictory_signal_ids, ["risk1"]);
  assertEquals(a.strongest, "none");
});

// ---- (14)(15) integration with the ONE final-state reducer ----
const suff = (o: Partial<EvidenceSufficiencyResult> = {}): EvidenceSufficiencyResult => ({
  sufficient: false, identityComplete: true, fitComplete: true, timingComplete: false,
  satisfiedRequirements: [], missingCriticalRequirements: ["job_signal"],
  missingOptionalRequirements: [], staleRequirements: [],
  nextDecision: "signal_enrichment", reasonCode: "missing_timing_signal", ...o,
});

Deno.test("14: company fit complete + timing missing stages for signal enrichment", () => {
  const s = resolveFinalCandidateState({
    sourceGateDecision: "needs_verification", providerVerified: true, artifactMatches: true,
    sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    companyOutcome: "enriched", ariaEvaluated: true,
    persistDecision: { persist: false, reason: "tier_rejected" },
    timingDecision: "missing_timing_evidence",
  });
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_timing_signal");
  assertEquals(s.next_action, "signal_enrichment");
  assertEquals(s.rejection_class, null);
  assertEquals(s.persist, false);         // (29) missing timing ⇒ persist=false
});

Deno.test("15: timing_sufficient does NOT bypass a verified contradiction (still rejects)", () => {
  // Timing proven, but a VERIFIED contradiction (ICP mismatch) outranks it ⇒ reject.
  // A verified contradiction is the deterministic reason a complete candidate is
  // refused — never a stale heuristic score.
  const refused = resolveFinalCandidateState({
    sourceGateDecision: "needs_verification", providerVerified: true, artifactMatches: true,
    icpContradiction: true,
    sufficiencyDecision: "qualify_now", missingCritical: [], companyOutcome: "enriched",
    ariaEvaluated: true, persistDecision: { persist: false, reason: "aria_rejected" },
    timingDecision: "timing_sufficient",
  });
  assertEquals(refused.state, "reject");
  assertEquals(refused.rejection_class, "icp_mismatch");
  assertEquals(refused.persist, false, "timing_sufficient must never override a verified contradiction");

  // Timing proven AND the persistence authority accepted ⇒ qualify_now.
  const accepted = resolveFinalCandidateState({
    sourceGateDecision: "accept", providerVerified: true, artifactMatches: true,
    sufficiencyDecision: "qualify_now", missingCritical: [], companyOutcome: "enriched",
    ariaEvaluated: true, persistDecision: { persist: true, reason: "aria_accepted" },
    timingDecision: "timing_sufficient",
  });
  assertEquals(accepted.state, "qualify_now");
  assertEquals(accepted.persist, true);
});

Deno.test("15b: DETERMINISTIC path — fit-verified + timing_sufficient reaches qualify_now despite a stale Aria under-score", () => {
  // The v86 milestone bug: Aria scored these founders BEFORE company + signal
  // enrichment (tier under-scored), so acceptance keyed on Aria never fired even
  // though fit + timing became complete. Deterministic evidence gates now win.
  const s = resolveFinalCandidateState({
    sourceGateDecision: "accept", providerVerified: true, artifactMatches: true,
    sufficiencyDecision: "signal_enrichment", // identity + company fit complete; timing was the only gap
    missingCritical: ["job_signal"], companyOutcome: "enriched",
    ariaEvaluated: true, persistDecision: { persist: false, reason: "tier_rejected" }, // stale under-score
    timingDecision: "timing_sufficient",
  });
  assertEquals(s.state, "qualify_now");
  assertEquals(s.reason_code, "all_required_evidence_verified");
  assertEquals(s.persist, true);
});

Deno.test("a verified timing contradiction is a truthful reject, not a stage", () => {
  const s = resolveFinalCandidateState({
    sourceGateDecision: "needs_verification", providerVerified: true, artifactMatches: true,
    sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    ariaEvaluated: true, persistDecision: { persist: false, reason: "tier_rejected" },
    timingDecision: "timing_contradicted",
  });
  assertEquals(s.state, "reject");
  assertEquals(s.rejection_class, "timing_contradiction");
  assertEquals(s.persist, false);
  assertEquals(s.sent_to_downstream_aria, false);
});

Deno.test("omitting timingDecision preserves the exact v85 behaviour", () => {
  const s = resolveFinalCandidateState({
    sourceGateDecision: "needs_verification", providerVerified: true, artifactMatches: true,
    sufficiencyDecision: "signal_enrichment", missingCritical: ["job_signal"],
    companyOutcome: "enriched", ariaEvaluated: true, stagedByEnrichment: true,
    persistDecision: { persist: false, reason: "tier_rejected" },
  });
  assertEquals(s.state, "stage_missing_evidence");
  assertEquals(s.stage_reason, "missing_timing_signal");
  assertEquals(s.next_action, "signal_enrichment");
});

// ---- (16)(17)(18)(19)(20) conditional signal planner ----
const planInput = (o: Record<string, unknown> = {}) => ({
  candidateId: "c1", companyRef: "co_acme", personRef: "p1",
  sufficiency: suff(),
  timing: evaluateTimingSufficiency({
    candidateId: "c1",
    requirement: compileTimingRequirement(contractFor("find me hot founders right now")),
    signals: [], now: NOW,
  }),
  requirement: compileTimingRequirement(contractFor("find me hot founders right now")),
  supportedSourceAvailable: true,
  ...o,
});

Deno.test("17: the planner skips when timing is not required", () => {
  const req = compileTimingRequirement(contractFor("Find B2B SaaS founders in the United States"));
  const p = planSignalEnrichment(
    planInput({ requirement: req, timing: evaluateTimingSufficiency({ candidateId: "c1", requirement: req, signals: [], now: NOW }) }) as any,
    DEFAULT_SIGNAL_BUDGET, emptySignalLedger(),
  );
  assertEquals(p.outcome, "skip_not_required");
  assertEquals(p.willCallProvider, false);
});

Deno.test("18: the planner skips when fresh evidence already exists", () => {
  const req = compileTimingRequirement(contractFor("find me hot founders right now"));
  const timing = evaluateTimingSufficiency({ candidateId: "c1", requirement: req, signals: [sig()], now: NOW });
  assertEquals(timing.decision, "timing_sufficient");
  const p = planSignalEnrichment(planInput({ timing }) as any, DEFAULT_SIGNAL_BUDGET, emptySignalLedger());
  assertEquals(p.outcome, "skip_already_sufficient");
  assertEquals(p.willCallProvider, false);
});

Deno.test("16/19: hard contradictions and unqualified fit never trigger signal enrichment", () => {
  // A hard gate already settled it.
  const blocked = planSignalEnrichment(planInput({ hardBlocked: true }) as any, DEFAULT_SIGNAL_BUDGET, emptySignalLedger());
  assertEquals(blocked.outcome, "skip_not_required");
  assertEquals(blocked.willCallProvider, false);

  const rejectSource = planSignalEnrichment(
    planInput({ sufficiency: suff({ nextDecision: "reject_source", reasonCode: "unverified_provenance" }) }) as any,
    DEFAULT_SIGNAL_BUDGET, emptySignalLedger(),
  );
  assertEquals(rejectSource.willCallProvider, false);

  // Fit not yet verified ⇒ enrich fit before paying for timing.
  const noFit = planSignalEnrichment(
    planInput({ sufficiency: suff({ fitComplete: false, nextDecision: "structured_company_enrichment" }) }) as any,
    DEFAULT_SIGNAL_BUDGET, emptySignalLedger(),
  );
  assertEquals(noFit.outcome, "skip_not_required");
  assertEquals(noFit.willCallProvider, false);

  // Identity not verified ⇒ never.
  const noIdentity = planSignalEnrichment(
    planInput({ sufficiency: suff({ identityComplete: false }) }) as any,
    DEFAULT_SIGNAL_BUDGET, emptySignalLedger(),
  );
  assertEquals(noIdentity.willCallProvider, false);
});

Deno.test("19: the planner plans only for verified-fit candidates that still need timing", () => {
  const p = planSignalEnrichment(planInput() as any, DEFAULT_SIGNAL_BUDGET, emptySignalLedger());
  assertEquals(p.outcome, "plan_structured_signal_lookup");
  assertEquals(p.willCallProvider, true);
  assert(p.targetCategories.length > 0);
});

Deno.test("20: budget exhaustion stages truthfully and never fabricates a signal", () => {
  const tight: SignalEnrichmentBudget = { ...DEFAULT_SIGNAL_BUDGET, maxSignalLookups: 1, maxCandidates: 5 };
  const ledger = emptySignalLedger();
  const first = planSignalEnrichment(planInput() as any, tight, ledger);
  assertEquals(first.outcome, "plan_structured_signal_lookup");
  const second = planSignalEnrichment(planInput({ candidateId: "c2", companyRef: "co_2", personRef: "p2" }) as any, tight, ledger);
  assertEquals(second.outcome, "stage_budget_exhausted");
  assertEquals(second.willCallProvider, false);

  // Per-company cap: one lookup per deduplicated company.
  const l2 = emptySignalLedger();
  planSignalEnrichment(planInput() as any, DEFAULT_SIGNAL_BUDGET, l2);
  const sameCo = planSignalEnrichment(planInput({ candidateId: "c9", personRef: "p9" }) as any, DEFAULT_SIGNAL_BUDGET, l2);
  assertEquals(sameCo.outcome, "stage_budget_exhausted");

  // Deadline.
  const l3 = emptySignalLedger();
  const past = planSignalEnrichment(planInput() as any, { ...DEFAULT_SIGNAL_BUDGET, deadlineMs: 1000 }, l3, 2000);
  assertEquals(past.outcome, "stage_budget_exhausted");
});

Deno.test("no bound signal source ⇒ stage truthfully (Phase A is provider-free)", () => {
  const p = planSignalEnrichment(planInput({ supportedSourceAvailable: false }) as any, DEFAULT_SIGNAL_BUDGET, emptySignalLedger());
  assertEquals(p.outcome, "stage_no_supported_source");
  assertEquals(p.willCallProvider, false);
});

// ---- (21)(22)(23) deduplication ----
Deno.test("21: the same funding round from two sources collapses into one signal", () => {
  const linkedin = sig({
    signal_id: "a", signal_type: "recent_funding", signal_category: "growth",
    occurred_at: hoursAgo(10), observed_at: hoursAgo(5), confidence: "medium",
    verification: "self_reported",
    evidence_refs: [{ category: "funding_signal", sourceType: "apify_actor", sourceUrl: "https://li.test/p/1", confidence: "medium" }],
    dedupe_key: "",
  });
  const website = sig({
    signal_id: "b", signal_type: "recent_funding", signal_category: "growth",
    occurred_at: hoursAgo(14), observed_at: NOW, confidence: "high",
    verification: "provider_verified",
    evidence_refs: [{ category: "funding_signal", sourceType: "official_website", sourceUrl: "https://acme.test/news", confidence: "high" }],
    dedupe_key: "",
  });
  const out = deduplicateSignals([linkedin, website]);
  assertEquals(out.length, 1, "one real-world event ⇒ one signal");
  const m = out[0];
  // (23) all supporting evidence preserved
  assertEquals(m.evidence_refs.length, 2);
  // strongest verification + highest confidence survive
  assertEquals(m.verification, "provider_verified");
  assertEquals(m.confidence, "high");
  // earliest occurrence, latest observation
  assertEquals(m.occurred_at, hoursAgo(14));
  assertEquals(m.observed_at, NOW);
});

Deno.test("22: the same sales role from two job sources collapses; distinct roles do not", () => {
  const base = {
    signal_type: "sales_hiring" as SignalType, signal_category: "gtm" as const,
    company_ref: "co_acme", occurred_at: hoursAgo(6), dedupe_key: "",
  };
  const a = sig({ ...base, signal_id: "a", evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://b1.test/1", confidence: "high" }] });
  const b = sig({ ...base, signal_id: "b", evidence_refs: [{ category: "job_signal", sourceType: "public_web", sourceUrl: "https://b2.test/2", confidence: "medium" }] });
  const collapsed = deduplicateSignals([a, b]);
  assertEquals(collapsed.length, 1);
  assertEquals(collapsed[0].evidence_refs.length, 2);

  // Two DIFFERENT companies stay distinct.
  const other = sig({ ...base, signal_id: "c", company_ref: "co_other" });
  assertEquals(deduplicateSignals([a, other]).length, 2);
});

Deno.test("a duplicate engagement imported twice collapses to one", () => {
  const e = (id: string) => sig({
    signal_id: id, signal_type: "linkedin_post_comment", signal_category: "engagement",
    person_ref: "p1", company_ref: null, occurred_at: hoursAgo(3), dedupe_key: "",
    evidence_refs: [{ category: "founder_activity_signal", sourceType: "apify_actor", confidence: "medium" }],
  });
  assertEquals(deduplicateSignals([e("a"), e("b")]).length, 1);
});
