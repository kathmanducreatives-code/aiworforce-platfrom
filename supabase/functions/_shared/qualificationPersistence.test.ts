import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  qualificationPersistenceDecision,
  mapAriaToDecision,
  partitionForPersistence,
  type QualificationPersistenceInput,
} from "./qualificationPersistence.ts";
import {
  Q1_PROVIDER_PEOPLE,
  Q1_SUCCESS_REPLAY,
  Q1_TARGET_ENTITY,
  Q1_EXPECTED_ARTIFACT_TYPE,
  type Q1PersonProfile,
} from "./q1PersonReplayFixture.ts";

// Map a fixture person → the canonical decision input using ONLY production
// helpers (mapAriaToDecision). No test-only acceptance logic.
function decideFor(p: Q1PersonProfile): QualificationPersistenceInput {
  const m = mapAriaToDecision(p.aria);
  return {
    targetEntity: Q1_TARGET_ENTITY,
    candidateArtifactType: p.artifact_type,
    providerVerified: p.provider_verified,
    ariaEvaluated: m.evaluated,
    ariaDecision: m.decision,
    tier: p.tier,
    evidenceViolations: p.evidence_violations,
  };
}

const base: QualificationPersistenceInput = {
  targetEntity: "person",
  candidateArtifactType: "person_candidate",
  providerVerified: true,
  ariaEvaluated: true,
  ariaDecision: "accept",
  tier: "qualified",
  evidenceViolations: [],
};

// (8) Provider verification alone is insufficient for persistence.
Deno.test("provider verified but no qualification → not persisted", () => {
  const d = qualificationPersistenceDecision({
    ...base, ariaEvaluated: false, ariaDecision: null, tier: null,
  });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "no_qualification");
  assertEquals(d.decision_source, "aria");
});

// (2) Aria missing → zero final persistence.
Deno.test("missing Aria result → not persisted", () => {
  const m = mapAriaToDecision(null);
  assertEquals(m.evaluated, false);
  const d = qualificationPersistenceDecision({ ...base, ariaEvaluated: m.evaluated, ariaDecision: m.decision });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "no_qualification");
});

// (3) Aria rejects candidate → zero final persistence.
Deno.test("explicit Aria reject → not persisted", () => {
  const d = qualificationPersistenceDecision({ ...base, ariaDecision: "reject", tier: "qualified" });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "aria_rejected");
});

// (4) fit_tier=rejected → zero final persistence (even if decision not "reject").
Deno.test("rejected tier → not persisted", () => {
  const d = qualificationPersistenceDecision({ ...base, ariaDecision: "needs_review", tier: "rejected" });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "tier_rejected");
});

// (5) Aria accepts a verified PersonCandidate → persistence allowed.
Deno.test("aria accept + qualified tier + verified person → persisted", () => {
  const d = qualificationPersistenceDecision(base);
  assertEquals(d.persist, true);
  assertEquals(d.reason, "aria_accepted");
});

// (6) JobSignal cannot persist for a person target.
Deno.test("job_signal artifact for person target → not persisted", () => {
  const d = qualificationPersistenceDecision({ ...base, candidateArtifactType: "job_signal" });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "artifact_mismatch");
});

// (7) PersonCandidate cannot persist for a job target.
Deno.test("person_candidate artifact for job target → not persisted", () => {
  const d = qualificationPersistenceDecision({ ...base, targetEntity: "job", candidateArtifactType: "person_candidate" });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "artifact_mismatch");
});

// Missing artifact type → not persisted.
Deno.test("missing artifact type → not persisted", () => {
  const d = qualificationPersistenceDecision({ ...base, candidateArtifactType: null });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "missing_artifact_type");
});

// Hard evidence violation blocks even an otherwise-accepted candidate.
Deno.test("profile_as_job violation blocks persistence", () => {
  const d = qualificationPersistenceDecision({ ...base, evidenceViolations: ["profile_as_job"] });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "evidence_violation:profile_as_job");
});

// identity_only_signal is an auditable limitation, NOT a hard blocker.
Deno.test("identity_only_signal alone does not block an accepted person", () => {
  const d = qualificationPersistenceDecision({ ...base, evidenceViolations: ["identity_only_signal"] });
  assertEquals(d.persist, true);
});

// needs_review is staged, not persisted.
Deno.test("needs_review is staged (not persisted)", () => {
  const d = qualificationPersistenceDecision({ ...base, ariaDecision: "needs_review", tier: "weak" });
  assertEquals(d.persist, false);
  assertEquals(d.reason, "not_accepted");
});

// (26) Frozen Q1 replay: five provider people, all rejected → ZERO persistence.
Deno.test("Q1 replay: all five rejected provider people → zero final persistence", () => {
  const { persist, staged } = partitionForPersistence(Q1_PROVIDER_PEOPLE, decideFor);
  assertEquals(Q1_PROVIDER_PEOPLE.length, 5);
  assertEquals(persist.length, 0);
  assertEquals(staged.length, 5);
  // Each is verified provider-backed but held back on qualification/tier grounds.
  for (const s of staged) {
    assertEquals(s.decision.persist, false);
    assertEquals(s.decision.decision_source, "aria");
  }
});

// (27) Frozen Q1 success replay: accepted subset persists, rejected subset does not.
Deno.test("Q1 success replay: only the accepted subset persists", () => {
  const { persist, staged } = partitionForPersistence(Q1_SUCCESS_REPLAY, decideFor);
  assertEquals(persist.length, 2);
  assertEquals(staged.length, 3);
  const persistedNames = persist.map((p) => p.candidate.full_name).sort();
  assertEquals(persistedNames, ["Jeff Esposito", "Jim Smith"]);
  for (const p of persist) assertEquals(p.decision.reason, "aria_accepted");
});

// (1) Reproduction: the OLD path persisted all five before Aria; the canonical
// decision would have persisted none of them.
Deno.test("Q1 reproduction: old behavior persisted 5, canonical persists 0", () => {
  const oldPersistedCount = Q1_PROVIDER_PEOPLE.length; // old path: all accepted-by-provenance
  assertEquals(oldPersistedCount, 5);
  const { persist } = partitionForPersistence(Q1_PROVIDER_PEOPLE, decideFor);
  assertEquals(persist.length, 0);
});

// mapAriaToDecision production mapping.
Deno.test("mapAriaToDecision maps labels/gates correctly", () => {
  assertEquals(mapAriaToDecision({ star_label: "Reject", gate_decision: "needs_verification" }).decision, "reject");
  assertEquals(mapAriaToDecision({ star_label: "Weak", gate_decision: "needs_verification" }).decision, "needs_review");
  assertEquals(mapAriaToDecision({ star_label: "Qualified", gate_decision: "contact" }).decision, "accept");
  assertEquals(mapAriaToDecision({ star_label: "Hot", gate_decision: "contact" }).decision, "accept");
  assertEquals(mapAriaToDecision({ gate_decision: "reject" }).decision, "reject");
  assertEquals(mapAriaToDecision(null).evaluated, false);
});

// Expected artifact type is derived from the target entity when omitted.
Deno.test("expected artifact type defaults from target entity", () => {
  assertEquals(Q1_EXPECTED_ARTIFACT_TYPE, "person_candidate");
  const d = qualificationPersistenceDecision({ ...base, expectedArtifactType: undefined });
  assertEquals(d.persist, true);
});
