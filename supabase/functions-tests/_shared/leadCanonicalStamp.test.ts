// Deterministic tests for the canonical lead stamp composition. Zero providers.
// Run: deno test supabase/functions/_shared/leadCanonicalStamp.test.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCanonicalStamp } from "../../functions/_shared/leadCanonicalStamp.ts";

Deno.test("fully verified RevOps hiring lead with a decision maker → contact + contact_ready", () => {
  const s = buildCanonicalStamp({
    company: "Acme Revenue Inc",
    website: "https://acme.example.com",
    source_url: "https://boards.greenhouse.io/acme/jobs/123",
    job_title: "Revenue Operations Manager",
    requested_role_family: "revenue_operations",
    requested_signal: "required",
    source_strategy: "account_first",
    exact_hiring_signal: "Hiring Revenue Operations Manager",
    signal_type: "hiring",
    evidence_url: "https://boards.greenhouse.io/acme/jobs/123",
    evidence_recent: true,
    aria_overall_fit: 82,
    aria_confidence_score: 80,
    matched_icp: ["industry", "size"],
    gate_decision: "accept",
    decision_maker_profile_url: "https://linkedin.com/in/jane-revops",
    why_this_company: "Scaling GTM, opened a RevOps role this month",
    why_now: "Actively hiring Revenue Operations right now",
  });
  assertEquals(s.canonical_final_decision, "contact");
  assertEquals(s.contact_ready, true);
  assertEquals(s.contact_ready_missing.length, 0);
  assertEquals(s.role_exactness, "exact");
  assertEquals(s.run_trace.evidence_type, "job_post");
  assert(s.final_score >= 70, `expected strong score, got ${s.final_score}`);
});

Deno.test("adjacent sales role (AE) for a RevOps request is NOT an exact signal → not contact_ready", () => {
  const s = buildCanonicalStamp({
    company: "Beta GTM Co",
    website: "https://beta.example.com",
    source_url: "https://boards.greenhouse.io/beta/jobs/9",
    job_title: "Account Executive",
    requested_role_family: "revenue_operations",
    requested_signal: "required",
    exact_hiring_signal: "Hiring Account Executive",
    signal_type: "hiring",
    evidence_url: "https://boards.greenhouse.io/beta/jobs/9",
    aria_overall_fit: 70,
    aria_confidence_score: 65,
    gate_decision: "accept",
    decision_maker_profile_url: "https://linkedin.com/in/someone",
    why_this_company: "Growing sales team",
    why_now: "Hiring an AE",
  });
  assertEquals(s.role_exactness, "adjacent");
  assertEquals(s.contact_ready, false);
  // No exact-role signal → company_signal_verified false → needs_review.
  assertEquals(s.canonical_final_decision, "needs_review");
});

Deno.test("profile-only person record can never be contact_ready and scores <= 25", () => {
  const s = buildCanonicalStamp({
    company: "",
    source_url: "https://linkedin.com/in/john-founder",
    job_title: "Founder & CEO",
    requested_role_family: "revenue_operations",
    signal_type: "hiring",
    evidence_url: "https://linkedin.com/in/john-founder",
    aria_overall_fit: 40,
    aria_confidence_score: 45,
  });
  assertEquals(s.contact_ready, false);
  assert(s.final_score <= 25, `profile-only must be <=25, got ${s.final_score}`);
  assertEquals(s.run_trace.evidence_type, "person_profile");
  // A founder title used as a hiring signal is an integrity violation.
  assert(s.evidence_violations.includes("identity_only_signal"));
});

Deno.test("hard disqualifier forces skip and caps the score near zero", () => {
  const s = buildCanonicalStamp({
    company: "Gamma Corp",
    website: "https://gamma.example.com",
    source_url: "https://gamma.example.com",
    job_title: "Revenue Operations Lead",
    requested_role_family: "revenue_operations",
    requested_signal: "required",
    exact_hiring_signal: "Hiring RevOps",
    signal_type: "hiring",
    evidence_url: "https://gamma.example.com/careers/1",
    aria_overall_fit: 90,
    aria_confidence_score: 95,
    disqualifiers_hit: ["enterprise > 5000 employees"],
    gate_decision: "reject",
    decision_maker_profile_url: "https://linkedin.com/in/x",
    why_this_company: "big co",
    why_now: "hiring",
  });
  assertEquals(s.canonical_final_decision, "skip");
  assertEquals(s.contact_ready, false);
  assert(s.final_score <= 5, `disqualifier must cap near zero, got ${s.final_score}`);
});

Deno.test("valid account + signal but no verified decision maker → watch (never contact)", () => {
  const s = buildCanonicalStamp({
    company: "Delta Systems",
    website: "https://delta.example.com",
    source_url: "https://boards.greenhouse.io/delta/jobs/5",
    job_title: "Sales Operations Manager",
    requested_role_family: "revenue_operations",
    requested_signal: "required",
    exact_hiring_signal: "Hiring Sales Operations Manager",
    signal_type: "hiring",
    evidence_url: "https://boards.greenhouse.io/delta/jobs/5",
    evidence_recent: true,
    aria_overall_fit: 75,
    aria_confidence_score: 72,
    matched_icp: ["industry"],
    gate_decision: "accept",
    // no decision_maker_profile_url
    why_this_company: "GTM scaling",
    why_now: "actively hiring",
  });
  assertEquals(s.role_exactness, "exact");
  assertEquals(s.canonical_final_decision, "watch");
  assertEquals(s.contact_ready, false);
  assert(s.contact_ready_missing.includes("verified target decision maker") || s.contact_ready_missing.some((m) => m.includes("decision")));
});

Deno.test("legacy contradiction (reject + accept) is surfaced as blocked and prevents contact", () => {
  const s = buildCanonicalStamp({
    company: "Epsilon Ltd",
    website: "https://epsilon.example.com",
    source_url: "https://epsilon.example.com/careers/2",
    job_title: "Revenue Operations Manager",
    requested_role_family: "revenue_operations",
    requested_signal: "required",
    exact_hiring_signal: "Hiring RevOps",
    signal_type: "hiring",
    evidence_url: "https://epsilon.example.com/careers/2",
    evidence_recent: true,
    aria_overall_fit: 88,
    aria_confidence_score: 90,
    matched_icp: ["industry", "size"],
    gate_decision: "accept",
    match_tier: "reject", // contradiction: reject + accept
    decision_maker_profile_url: "https://linkedin.com/in/y",
    why_this_company: "scaling",
    why_now: "hiring now",
  });
  assert(s.blocked !== null, "expected a contradiction to be surfaced");
  assert(s.canonical_final_decision !== "contact", "a reject can never resolve to contact");
});

Deno.test("no requested role family (company-profile search) still classifies evidence + routes", () => {
  const s = buildCanonicalStamp({
    company: "Zeta Cloud",
    website: "https://zeta.example.com",
    source_url: "https://linkedin.com/company/zeta",
    requested_signal: "none",
    source_strategy: "profile_first",
    aria_overall_fit: 60,
    aria_confidence_score: 55,
    matched_icp: ["industry"],
    gate_decision: "accept",
  });
  assertEquals(s.role_exactness, "none");
  assertEquals(s.run_trace.source_strategy, "profile_first");
  assertEquals(s.run_trace.evidence_type, "company_page");
  // Company page is not a company signal, and no decision maker → not contact.
  assert(s.canonical_final_decision !== "contact");
});
