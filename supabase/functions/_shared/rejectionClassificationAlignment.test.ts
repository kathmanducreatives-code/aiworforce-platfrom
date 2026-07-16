import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  qualificationPersistenceDecision,
  mapAriaToDecision,
  HARD_EVIDENCE_BLOCKERS,
  isHardEvidenceBlocker,
} from "./qualificationPersistence.ts";
import { classifyRejection, buildCandidateDiagnostic } from "./qualificationObservability.ts";

// ---------------------------------------------------------------------------
// Phase 0 — the live v82 case (plan a5501b31): five provider-verified US founders,
// deterministic score 61, tier=rejected, evidence_missing=[industry,website],
// evidence_violations=[identity_only_signal]. Persistence rejected them by TIER;
// observability wrongly reported hard_source / evidence_violation:identity_only_signal.
// ---------------------------------------------------------------------------
const V82 = {
  targetEntity: "person" as const,
  candidateArtifactType: "person_candidate" as const,
  providerVerified: true,
  tier: "rejected",
  score: 61,
  evidenceMissing: ["industry", "website"],
  evidenceViolations: ["identity_only_signal"],
};

Deno.test("v82: persistence rejects by tier, NOT by evidence violation", () => {
  const m = mapAriaToDecision({ star_label: "Weak", gate_decision: "needs_verification", overall_fit: 61 });
  const d = qualificationPersistenceDecision({
    targetEntity: V82.targetEntity,
    candidateArtifactType: V82.candidateArtifactType,
    providerVerified: V82.providerVerified,
    ariaEvaluated: m.evaluated,
    ariaDecision: m.decision,
    tier: V82.tier,
    evidenceViolations: V82.evidenceViolations,
  });
  assertEquals(d.persist, false);
  // The reason is the TIER, not an evidence violation.
  assertEquals(d.reason, "tier_rejected");
  assert(!d.reason.startsWith("evidence_violation"), d.reason);
});

Deno.test("v82: observability must NOT classify the case as hard_source", () => {
  const c = classifyRejection({
    qualification_decision: "reject",
    qualification_reason: "tier_rejected",
    source_gate_decision: "needs_verification",
    tier: V82.tier,
    deterministic_score: V82.score,
    matched_icp_count: 0, // industry/website missing ⇒ ICP unconfirmed
    evidence_missing: V82.evidenceMissing,
    evidence_violations: V82.evidenceViolations,
  });
  assert(c.rejection_class !== "hard_source", `got ${c.rejection_class}`);
  // Missing industry/website ⇒ the ICP could not be confirmed.
  assertEquals(c.rejection_class, "icp_mismatch");
  assert(!c.reason_code.includes("identity_only_signal"), c.reason_code);
});

Deno.test("v82: full diagnostic reports the reason persistence actually used", () => {
  const d = buildCandidateDiagnostic({
    name: "Jim Smith", title: "Founder & CEO", company: "Proper Sky - Managed IT Services",
    source_url: "https://www.linkedin.com/in/propersky-jim",
    provider_verified: true, actor_key: "apify_people_search",
    actor_id: "harvestapi/linkedin-profile-search", artifact_type: "person_candidate",
    source_gate_decision: "needs_verification",
    tier: V82.tier, deterministic_score: V82.score,
    qualification_decision: "reject", qualification_reason: "tier_rejected",
    matched_icp: [], evidence_present: ["linkedin person profile"],
    evidence_missing: V82.evidenceMissing, evidence_violations: V82.evidenceViolations,
    persisted: false, sent_to_downstream_aria: false,
  });
  assert(d.rejection_class !== "hard_source", d.rejection_class);
  assertEquals(d.qualification_reason, "tier_rejected");
  // identity_only_signal is still recorded honestly as a limitation…
  assert(d.evidence_violations.includes("identity_only_signal"));
  // …but it is NOT the reported rejection cause.
  assert(!d.reason_code.includes("identity_only_signal"), d.reason_code);
});

// ---------------------------------------------------------------------------
// Shared blocker policy
// ---------------------------------------------------------------------------
Deno.test("identity_only_signal is not a hard evidence blocker", () => {
  assertEquals(isHardEvidenceBlocker("identity_only_signal"), false);
  assert(!HARD_EVIDENCE_BLOCKERS.has("identity_only_signal"));
});

Deno.test("genuine hard blockers remain hard_source in BOTH helpers", () => {
  for (const v of ["profile_as_job", "title_as_signal", "jobpost_no_employer", "jobpost_no_role"]) {
    assertEquals(isHardEvidenceBlocker(v), true, v);
    // persistence blocks
    const d = qualificationPersistenceDecision({
      targetEntity: "person", candidateArtifactType: "person_candidate", providerVerified: true,
      ariaEvaluated: true, ariaDecision: "accept", tier: "qualified", evidenceViolations: [v],
    });
    assertEquals(d.persist, false, v);
    assertEquals(d.reason, `evidence_violation:${v}`, v);
    // observability agrees
    const c = classifyRejection({ qualification_decision: "reject", qualification_reason: `evidence_violation:${v}`, evidence_violations: [v] });
    assertEquals(c.rejection_class, "hard_source", v);
  }
});

// Alignment invariant: observability reports hard_source from a violation ONLY when
// persistence would also block on that violation.
Deno.test("alignment: classifier hard_source-by-violation implies persistence blocks", () => {
  const cases = [
    { violations: ["identity_only_signal"], expectHard: false },
    { violations: ["profile_as_job"], expectHard: true },
    { violations: ["identity_only_signal", "profile_as_job"], expectHard: true },
    { violations: [], expectHard: false },
  ];
  for (const t of cases) {
    const persistBlocked = qualificationPersistenceDecision({
      targetEntity: "person", candidateArtifactType: "person_candidate", providerVerified: true,
      ariaEvaluated: true, ariaDecision: "accept", tier: "qualified", evidenceViolations: t.violations,
    });
    const blockedByViolation = persistBlocked.reason.startsWith("evidence_violation");
    assertEquals(blockedByViolation, t.expectHard, JSON.stringify(t.violations));
    const c = classifyRejection({
      qualification_decision: "reject", qualification_reason: "tier_rejected",
      matched_icp_count: 2, tier: "weak", evidence_violations: t.violations,
    });
    const classHard = c.rejection_class === "hard_source";
    assertEquals(classHard, t.expectHard, `class ${c.rejection_class} for ${JSON.stringify(t.violations)}`);
  }
});
