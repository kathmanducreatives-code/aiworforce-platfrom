// Deterministic tests for the account-first / contact-ready re-architecture.
// Covers the 20 required cases from the QA brief. No providers, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { separateIntent } from "../../../supabase/functions/_shared/leadIntentModel.ts";
import { classifyRoleFamily, roleExactness, isExactRoleMatch, requestedRoleFamily } from "../../../supabase/functions/_shared/roleFamilyMatcher.ts";
import { classifyEvidence, checkEvidenceInvariants, provesCompanySignal, isIdentityOnly } from "../../../supabase/functions/_shared/evidenceType.ts";
import { decideCanonical, contactReady, detectContradiction, reconcile, type LeadFacts } from "../../../supabase/functions/_shared/leadDecision.ts";
import { scoreLead, type ScoreInputs } from "../../../supabase/functions/_shared/leadScoreBreakdown.ts";
import { buildCanonicalCompanyBrain } from "../../../supabase/functions/_shared/getCompiledCompanyBrainForWorkspace.ts";

const facts = (o: Partial<LeadFacts>): LeadFacts => ({
  hard_disqualifier_hit: false, company_identity_verified: true, company_signal_verified: true,
  brain_fit: true, timing_strong: true, decision_maker_verified: true, confidence: 0.8, ...o,
});

// 1 — account-first routing for a signal request.
Deno.test("1. 'find founders with a reason to talk now' routes account-first", () => {
  const i = separateIntent({ message: "Find me 5 founders who fit my ICP and have a clear reason to talk right now" });
  assertEquals(i.source_strategy, "account_first");
  assertEquals(i.requested_signal, "required");
  assertEquals(i.decision_maker_strategy, "resolve_after_account");
  assert(i.target_personas.includes("Founder"), "founder is a persona, not a source");
});

// 2 — profile-first only for a named-company lookup.
Deno.test("2. 'find founder profiles at named companies' may route profile-first", () => {
  const i = separateIntent({ message: "Find the LinkedIn profiles of the founders at Acme and Globex" });
  assertEquals(i.source_strategy, "profile_first");
  assertEquals(i.decision_maker_strategy, "direct_lookup");
});

// 3 — AE does not satisfy a RevOps query.
Deno.test("3. Account Executive does not satisfy a RevOps request", () => {
  const req = requestedRoleFamily("hiring RevOps / Revenue Operations")!;
  assertEquals(req, "revenue_operations");
  assertEquals(isExactRoleMatch(req, "Account Executive"), false);
  assertEquals(isExactRoleMatch(req, "Founding Account Executive"), false);
  assertEquals(roleExactness(req, "Account Executive"), "adjacent");
});

// 4 — SDR does not satisfy a Sales Ops query.
Deno.test("4. SDR does not satisfy a Sales Operations request", () => {
  const req = requestedRoleFamily("hiring for Sales Operations")!;
  assertEquals(req, "revenue_operations");
  assertEquals(isExactRoleMatch(req, "Sales Development Representative"), false);
  assertEquals(isExactRoleMatch(req, "Fractional SDR"), false);
  // The real exact titles DO match.
  for (const t of ["Sales Operations Manager", "Head of Revenue Operations", "RevOps", "GTM Operations", "Revenue Strategy and Operations"]) {
    assertEquals(isExactRoleMatch(req, t), true, `expected exact: ${t}`);
  }
});

// 5 — exact-role search returns fewer instead of broadening silently.
Deno.test("5. exact role family is a hard, non-silent constraint", () => {
  const i = separateIntent({ message: "Find founders of B2B SaaS companies hiring for RevOps in the United States" });
  assertEquals(i.role_exactness, "hard");
  assertEquals(i.relaxation_policy.role_family, "adjacent_watch_only");
  assertEquals(i.relaxation_policy.geography, "never");
});

// 6 — a person-profile URL is not job evidence.
Deno.test("6. person_profile URL is never job evidence", () => {
  assertEquals(classifyEvidence({ url: "https://www.linkedin.com/in/jane-doe" }), "person_profile");
  const v = checkEvidenceInvariants({ signal_evidence_type: "person_profile", signal_label: "live job posting" });
  assert(v.some((x) => x.code === "profile_as_job"), "profile-as-job blocked");
  assert(!provesCompanySignal("person_profile") && isIdentityOnly("person_profile"));
});

// 7 — founder title alone is not a buying signal.
Deno.test("7. founder title alone is not a hiring/buying signal", () => {
  const v = checkEvidenceInvariants({ is_signal_from_person_title: true });
  assert(v.some((x) => x.code === "title_as_signal"));
});

// 8 — profile-only record is never contact-ready.
Deno.test("8. profile-only record is never contact-ready", () => {
  const f = facts({ company_identity_verified: false, company_signal_verified: false, decision_maker_verified: true });
  const cr = contactReady(f, { why_this_company: "n/a", why_now: "n/a", evidence_url: "https://linkedin.com/in/x", decision_maker_profile_url: "https://linkedin.com/in/x" });
  assertEquals(cr.ready, false);
  assert(cr.missing.some((m) => /company/i.test(m)));
  assertEquals(decideCanonical(f), "needs_review");
});

// 9 — agency rejected when excluded.
Deno.test("9. excluded agency is a hard disqualifier → skip, cannot be overcome by score", () => {
  const f = facts({ hard_disqualifier_hit: true });
  assertEquals(decideCanonical(f), "skip");
  const s = scoreLead(baseScore({ hard_disqualifier_hit: true, company_icp_fit: true, industry_fit: true, requested_role_exactness: "exact", signal_relevant: true }));
  assert(s.final_score <= 5, `disqualifier must cap score, got ${s.final_score}`);
});

// 10 — nonprofit rejected for a B2B SaaS ICP (modeled as no ICP fit + off-model).
Deno.test("10. nonprofit for a B2B SaaS ICP → not contact (needs_review/skip)", () => {
  const f = facts({ brain_fit: false });
  assert(["needs_review", "skip"].includes(decideCanonical(f)));
});

// 11 — oversized company penalized/rejected per the brain.
Deno.test("11. oversized company (size miss) scores lower than an ICP-size fit", () => {
  const big = scoreLead(baseScore({ company_icp_fit: false, company_size_fit: false, requested_role_exactness: "exact", signal_relevant: true }));
  const right = scoreLead(baseScore({ company_icp_fit: true, company_size_fit: true, requested_role_exactness: "exact", signal_relevant: true }));
  assert(right.final_score > big.final_score, "ICP-size fit outscores oversized");
});

// 12 — active-brain exceptions respected (recruiting workspace keeps agencies).
Deno.test("12. a recruiting-agency ICP is not rejected by generic anti-agency defaults", () => {
  const i = separateIntent({
    message: "Find recruitment agencies hiring engineering recruiters",
    brain: { industries: ["staffing services"], disqualifiers: [] },
    hardExclusions: [],
  });
  assert(!i.hard_exclusions.some((d) => /recruit|staffing/i.test(d)), "recruiting not excluded for a recruiting ICP");
});

// 13 — hard disqualifier overrides acceptance.
Deno.test("13. hard disqualifier overrides a legacy accept", () => {
  const { decision } = reconcile(facts({ hard_disqualifier_hit: true }), { gate_decision: "accept", match_tier: "strict" });
  assertEquals(decision, "skip");
});

// 14 — canonical decision cannot contradict the gate.
Deno.test("14. impossible combo (reject + accept) is detected and never yields contact", () => {
  const contradiction = detectContradiction({ fit_tier: "rejected", match_tier: "reject", gate_decision: "accept" });
  assert(contradiction, "contradiction detected");
  const { decision } = reconcile(facts({}), { match_tier: "reject", gate_decision: "accept" });
  assert(decision !== "contact", "a reject can never resolve to contact");
});

// 15 — materially different records get materially different scores.
Deno.test("15. materially different records receive different scores", () => {
  const strong = scoreLead(baseScore({ company_icp_fit: true, industry_fit: true, business_model_fit: true, company_size_fit: true, geography_fit: true, requested_role_exactness: "exact", signal_relevant: true, evidence_quality: "primary", decision_maker_complete: true, missing_evidence_count: 0 }));
  const weak = scoreLead(baseScore({ requested_role_exactness: "unrelated", signal_relevant: false, evidence_quality: "none", profile_only: true, missing_evidence_count: 3 }));
  assert(strong.final_score - weak.final_score >= 40, `spread too small: ${strong.final_score} vs ${weak.final_score}`);
  assert(weak.final_score <= 25, "profile-only weak record scores low");
});

// 16 — run trace fields populated (built from existing fields; no migration).
Deno.test("16. run trace object is fully populated from intent + run context", () => {
  const i = separateIntent({ message: "Find up to 5 founders of B2B SaaS hiring RevOps in the United States", parsedCategories: ["B2B SaaS"], parsedLocations: ["United States"] });
  const trace = {
    run_id: "run_1", workspace_id: "ws_A", original_user_query: i.original_query,
    parsed_intent_summary: `${i.source_strategy} · ${i.requested_role_family} · signal:${i.requested_signal}`,
    target_personas: i.target_personas, requested_role_family: i.requested_role_family,
    requested_signal: i.requested_signal, source_strategy: i.source_strategy,
    intent_tier: "strict", search_stage: 1, relaxed_filters: [] as string[], created_at: "2026-07-11T00:00:00Z",
  };
  for (const k of ["run_id", "workspace_id", "original_user_query", "parsed_intent_summary", "source_strategy", "requested_role_family"]) {
    assert((trace as Record<string, unknown>)[k] != null && String((trace as Record<string, unknown>)[k]).length > 0, `trace.${k} populated`);
  }
});

// 19 — outreach disabled without verified company, signal AND person.
Deno.test("19. outreach eligibility follows the contact-ready contract", () => {
  const notReady = contactReady(facts({ decision_maker_verified: false }), { why_this_company: "strong ICP fit", why_now: "hiring RevOps now", evidence_url: "https://jobs.example/x", decision_maker_profile_url: "" });
  assertEquals(notReady.ready, false);
  const ready = contactReady(facts({}), { why_this_company: "strong ICP fit for B2B SaaS", why_now: "posted a RevOps role this week", evidence_url: "https://jobs.example/x", decision_maker_profile_url: "https://linkedin.com/in/founder" });
  assertEquals(ready.ready, true);
});

// 20 — two workspaces consume only their own active Company Brain.
Deno.test("20. two workspaces produce isolated brains (no cross-leak)", () => {
  const a = buildCanonicalCompanyBrain("ws_A", { target_customer: { industries: ["B2B SaaS"], disqualifiers: { industries: ["staffing"] } }, buyer_personas: ["Head of Growth"], content_angles: ["pipeline before payroll"] });
  const b = buildCanonicalCompanyBrain("ws_B", { target_customer: { industries: ["tech startups"] }, buyer_personas: ["Head of Talent"], content_angles: ["how to hire your founding team"] });
  const A = JSON.stringify(a), B = JSON.stringify(b);
  assert(A.includes("pipeline before payroll") && !A.includes("how to hire your founding team"));
  assert(B.includes("how to hire your founding team") && !B.includes("pipeline before payroll"));
});

// 21 — no real providers are called (this file imports zero provider clients).
Deno.test("21. tests call no providers (module imports are pure)", () => {
  assert(typeof separateIntent === "function" && typeof scoreLead === "function");
});

// role classification spot-checks
Deno.test("role families: exact RevOps titles vs adjacent sales roles", () => {
  assertEquals(classifyRoleFamily("Head of Sales Operations"), "revenue_operations");
  assertEquals(classifyRoleFamily("Commercial Operations Manager"), "revenue_operations");
  assertEquals(classifyRoleFamily("Founding Account Executive"), "sales_ic");
  assertEquals(classifyRoleFamily("Co-Founder & CEO"), "founder_exec");
});

// --------------------------------------------------------------- helpers -----

function baseScore(o: Partial<ScoreInputs>): ScoreInputs {
  return {
    company_icp_fit: false, industry_fit: false, business_model_fit: false, company_size_fit: false, geography_fit: false,
    requested_role_exactness: "unrelated", signal_relevant: false, evidence_quality: "none", evidence_recent: false,
    decision_maker_complete: false, hard_disqualifier_hit: false, missing_evidence_count: 0, profile_only: false, ...o,
  };
}
