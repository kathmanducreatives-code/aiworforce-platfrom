import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCandidateDiagnostic,
  buildQualificationFunnel,
  buildQualificationObservability,
  classifyRejection,
  sanitizeText,
  sanitizePublicUrl,
  candidateIdFor,
  MAX_DIAGNOSTICS,
  type CandidateDiagnosticInput,
} from "./qualificationObservability.ts";
import { Q1_PROVIDER_PEOPLE, Q1_ACTOR_KEY, Q1_ACTOR_IMPL } from "./q1PersonReplayFixture.ts";

function personInput(over: Partial<CandidateDiagnosticInput> = {}): CandidateDiagnosticInput {
  return {
    name: "Jeff Esposito", title: "Co-Founder/COO", company: "VeraAI Technologies Inc.",
    source_url: "https://www.linkedin.com/in/veraai",
    provider_verified: true, actor_key: Q1_ACTOR_KEY, actor_id: Q1_ACTOR_IMPL, artifact_type: "person_candidate",
    source_gate_decision: "needs_verification",
    tier: "rejected", deterministic_score: 20,
    qualification_decision: "reject", qualification_reason: "tier_rejected",
    matched_icp: [], evidence_present: ["linkedin person profile"], evidence_missing: ["a company-level buying signal (funding/hiring/expansion)"],
    evidence_violations: [], persisted: false, sent_to_downstream_aria: false,
    ...over,
  };
}

// (8) Person profile diagnostics: public /in/ URL, no email/phone.
Deno.test("person diagnostic keeps public /in/ URL and exposes no email/phone", () => {
  const d = buildCandidateDiagnostic(personInput({ company: "VeraAI, contact jeff@veraai.com or +1 415 555 1212" }));
  assertEquals(d.source_url, "https://www.linkedin.com/in/veraai");
  assert(!/@|\+?\d[\d\s().-]{7,}/.test(d.company ?? ""), d.company);
  assert((d.company ?? "").includes("[redacted-email]"));
  assert((d.company ?? "").includes("[redacted-phone]"));
  // No email/phone keys exist on the diagnostic shape.
  assert(!("email" in d) && !("phone" in d));
});

// (9) Actor fields preserved.
Deno.test("diagnostic preserves actor_key/actor_id/artifact_type", () => {
  const d = buildCandidateDiagnostic(personInput());
  assertEquals(d.actor_key, "apify_people_search");
  assertEquals(d.actor_id, "harvestapi/linkedin-profile-search");
  assertEquals(d.artifact_type, "person_candidate");
});

// (10)/(13) Raw provider payload / job-posting wording never exposed.
Deno.test("diagnostic never exposes raw payload or a job-posting URL field", () => {
  const d = buildCandidateDiagnostic(personInput());
  const json = JSON.stringify(d);
  assert(!("raw" in d) && !("profile" in d));
  assert(!/live job posting url/i.test(json));
});

// (14) Credentials / tokens / headers sanitized out of free text.
Deno.test("sanitizeText strips control chars and caps length", () => {
  const s = sanitizeText("line1\u0000\u0007line2\n\tmore   spaces");
  assertEquals(s, "line1 line2 more spaces");
  const long = sanitizeText("x".repeat(500));
  assert((long ?? "").length <= 200);
});

Deno.test("sanitizePublicUrl drops userinfo, query, fragment and non-http", () => {
  assertEquals(sanitizePublicUrl("https://user:pass@linkedin.com/in/x"), undefined);
  assertEquals(sanitizePublicUrl("https://www.linkedin.com/in/x?utm=1#frag"), "https://www.linkedin.com/in/x");
  assertEquals(sanitizePublicUrl("javascript:alert(1)"), undefined);
  assertEquals(sanitizePublicUrl("not a url"), undefined);
});

// (3) ICP mismatch classification.
Deno.test("classify: reject with no ICP match → icp_mismatch", () => {
  const c = classifyRejection({ qualification_decision: "reject", qualification_reason: "tier_rejected", matched_icp_count: 0, tier: "rejected" });
  assertEquals(c.rejection_class, "icp_mismatch");
});

// (4) Missing timing evidence classification.
Deno.test("classify: ICP matched but missing buying signal → missing_timing", () => {
  const c = classifyRejection({ qualification_decision: "reject", qualification_reason: "not_accepted", matched_icp_count: 2, evidence_missing: ["a company-level buying signal (funding/hiring/expansion) — optional/deferred"] });
  assertEquals(c.rejection_class, "missing_timing");
});

// (5) Qualification threshold classification.
Deno.test("classify: ICP matched, evidence present, tier weak → qualification_threshold", () => {
  const c = classifyRejection({ qualification_decision: "reject", qualification_reason: "tier_rejected", matched_icp_count: 2, tier: "weak", evidence_missing: [] });
  assertEquals(c.rejection_class, "qualification_threshold");
});

// (6) Missing qualification classification.
Deno.test("classify: no aria decision → missing_qualification", () => {
  const c = classifyRejection({ qualification_decision: "missing", qualification_reason: "no_qualification" });
  assertEquals(c.rejection_class, "missing_qualification");
});

// (2) Hard source rejection classification.
Deno.test("classify: source_gate reject / artifact mismatch / violation → hard_source", () => {
  assertEquals(classifyRejection({ qualification_decision: "reject", source_gate_decision: "reject" }).rejection_class, "hard_source");
  assertEquals(classifyRejection({ qualification_decision: "reject", qualification_reason: "artifact_mismatch" }).rejection_class, "hard_source");
  assertEquals(classifyRejection({ qualification_decision: "reject", qualification_reason: "tier_rejected", evidence_violations: ["profile_as_job"] }).rejection_class, "hard_source");
});

Deno.test("classify: accept → accepted", () => {
  assertEquals(classifyRejection({ qualification_decision: "accept", qualification_reason: "aria_accepted" }).rejection_class, "accepted");
});

// (15) Funnel reconciliation. Staged and rejected are DISJOINT terminal buckets, so
// the identity is source_gate == hard + accepted + staged + rejected.
Deno.test("funnel reconciles when source_gate == hard + accepted + staged + rejected", () => {
  const f = buildQualificationFunnel({ raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 });
  assertEquals(f.staged_count, 5);
  assertEquals(f.reconciles, true);
  const bad = buildQualificationFunnel({ raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 1, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 });
  assertEquals(bad.reconciles, false);
});

// (1) v80 scenario: 5 staged, 0 persisted, all five surfaced.
Deno.test("v80 scenario: five staged provider people surface in observability", () => {
  const candidates: CandidateDiagnosticInput[] = Q1_PROVIDER_PEOPLE.map((p) => ({
    name: p.full_name, title: p.title, company: p.company, source_url: p.profile_url,
    provider_verified: true, actor_key: Q1_ACTOR_KEY, actor_id: Q1_ACTOR_IMPL, artifact_type: "person_candidate",
    source_gate_decision: "needs_verification", tier: p.tier, deterministic_score: p.aria.overall_fit,
    // Identity proven, no company-level buying signal ⇒ STAGED for signal enrichment.
    // These five were previously reported as hard rejects, which is what made the
    // funnel count them as staged AND rejected simultaneously.
    qualification_decision: "stage_missing_evidence", stage_reason: "missing_timing_signal",
    next_action: "signal_enrichment", qualification_reason: "missing_timing_signal",
    matched_icp: [], evidence_present: ["linkedin person profile"], evidence_missing: ["a company-level buying signal (funding/hiring/expansion)"],
    evidence_violations: p.evidence_violations.filter((v) => v !== "profile_as_job"),
    persisted: false, sent_to_downstream_aria: false,
  }));
  const obs = buildQualificationObservability({
    funnel: { raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates, requested_limit: 5, target_entity: "person", expected_artifact_type: "person_candidate",
  });
  assertEquals(obs.funnel.staged_count, 5);
  assertEquals(obs.funnel.qualification_rejected, 0);
  assertEquals(obs.funnel.reconciles, true);
  assertEquals(obs.duplicate_state_candidate_ids, []);
  assertEquals(obs.funnel.persisted_count, 0);
  assertEquals(obs.candidates.length, 5);
  assertEquals(obs.truncated, 0);
  for (const c of obs.candidates) {
    assertEquals(c.persisted, false);
    assertEquals(c.sent_to_downstream_aria, false);
    assert(!!c.staged_reason);
    assert(!!c.source_url && c.source_url.includes("/in/"));
  }
});

// (7) Mixed scenario: accepted subset persists, staged subset does not.
Deno.test("mixed scenario: accepted diagnostics persisted, staged not", () => {
  const candidates: CandidateDiagnosticInput[] = [
    { name: "A", company: "SaaSCo", source_url: "https://www.linkedin.com/in/a", provider_verified: true, artifact_type: "person_candidate", source_gate_decision: "accept", tier: "qualified", qualification_decision: "accept", qualification_reason: "aria_accepted", matched_icp: ["B2B SaaS"], persisted: true, sent_to_downstream_aria: true },
    { name: "B", company: "SaaSCo2", source_url: "https://www.linkedin.com/in/b", provider_verified: true, artifact_type: "person_candidate", source_gate_decision: "accept", tier: "qualified", qualification_decision: "accept", qualification_reason: "aria_accepted", matched_icp: ["B2B SaaS"], persisted: true, sent_to_downstream_aria: true },
    // C: verified ICP contradiction ⇒ a genuine reject. D/E: merely unproven ⇒ staged.
    // Only accepted people reach Aria, so the staged/rejected three do not.
    { name: "C", company: "ITServices", source_url: "https://www.linkedin.com/in/c", provider_verified: true, artifact_type: "person_candidate", source_gate_decision: "needs_verification", tier: "rejected", qualification_decision: "reject", qualification_reason: "icp_contradiction", matched_icp: [], persisted: false, sent_to_downstream_aria: false },
    { name: "D", company: "Consulting", source_url: "https://www.linkedin.com/in/d", provider_verified: true, artifact_type: "person_candidate", source_gate_decision: "needs_verification", tier: "weak", qualification_decision: "stage_missing_evidence", stage_reason: "missing_timing_signal", next_action: "signal_enrichment", qualification_reason: "missing_timing_signal", matched_icp: ["SaaS"], evidence_missing: ["funding_signal"], persisted: false, sent_to_downstream_aria: false },
    { name: "E", company: "Agency", source_url: "https://www.linkedin.com/in/e", provider_verified: true, artifact_type: "person_candidate", source_gate_decision: "needs_verification", tier: "weak", qualification_decision: "stage_missing_evidence", stage_reason: "company_timeout", next_action: "company_enrichment", qualification_reason: "company_timeout", matched_icp: ["SaaS"], persisted: false, sent_to_downstream_aria: false },
  ];
  const obs = buildQualificationObservability({
    funnel: { raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 2, qualification_staged: 2, qualification_rejected: 1, persisted_count: 2, downstream_aria_count: 2 },
    candidates, requested_limit: 5, target_entity: "person", expected_artifact_type: "person_candidate",
  });
  assertEquals(obs.funnel.qualification_accepted, 2);
  assertEquals(obs.funnel.staged_count, 2);
  assertEquals(obs.funnel.qualification_rejected, 1);
  assertEquals(obs.duplicate_state_candidate_ids, []);
  assertEquals(obs.funnel.persisted_count, 2);
  assertEquals(obs.candidates.filter((c) => c.persisted).length, 2);
  assertEquals(obs.candidates.filter((c) => c.qualification_decision === "stage_missing_evidence").length, 2);
  // Only the two accepted people reach Aria; staged and rejected never do.
  assertEquals(obs.candidates.filter((c) => c.sent_to_downstream_aria).length, 2);
  assertEquals(obs.funnel.reconciles, true);
});

// (11) Result-size caps.
Deno.test("observability caps diagnostics to requested limit and MAX_DIAGNOSTICS", () => {
  const many: CandidateDiagnosticInput[] = Array.from({ length: 60 }, (_, i) => ({
    name: `P${i}`, source_url: `https://www.linkedin.com/in/p${i}`, provider_verified: true, artifact_type: "person_candidate",
    source_gate_decision: "needs_verification", tier: "rejected", qualification_decision: "reject", qualification_reason: "tier_rejected", persisted: false, sent_to_downstream_aria: false,
  }));
  const capped = buildQualificationObservability({ funnel: { raw_count: 60, normalized_count: 60, source_gate_accepted: 60, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 60, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 }, candidates: many, requested_limit: 5 });
  assertEquals(capped.candidates.length, 5);
  assertEquals(capped.truncated, 55);
  const noLimit = buildQualificationObservability({ funnel: { raw_count: 60, normalized_count: 60, source_gate_accepted: 60, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 60, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 }, candidates: many });
  assertEquals(noLimit.candidates.length, MAX_DIAGNOSTICS);
});

// (12) Sanitization of long/malformed strings + stable candidate id.
Deno.test("candidateIdFor is stable and non-PII", () => {
  const a = candidateIdFor({ source_url: "https://www.linkedin.com/in/veraai?x=1" });
  const b = candidateIdFor({ source_url: "https://www.linkedin.com/in/veraai" });
  assertEquals(a, b);
  assert(a.startsWith("nc_"));
  assert(!a.includes("@"));
});

// (19) persisted / downstream-aria flags are truthful passthrough.
Deno.test("persisted and sent_to_downstream_aria flags are truthful", () => {
  const d = buildCandidateDiagnostic(personInput({ persisted: true, qualification_decision: "accept", qualification_reason: "aria_accepted", sent_to_downstream_aria: true }));
  assertEquals(d.persisted, true);
  assertEquals(d.sent_to_downstream_aria, true);
  assertEquals(d.staged_reason, undefined);
});
