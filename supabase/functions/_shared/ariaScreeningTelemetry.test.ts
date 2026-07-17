// Provider-free tests that ARIA SCREENING and FINAL QUALIFICATION stay separate.
//
// Regression anchor: an earlier revision of this branch derived
// `sent_to_downstream_aria` / `downstream_aria_count` from
// `qualification_decision === qualify_now`. That under-reported the real handoff —
// the runtime hands Aria the WHOLE source-gate-accepted provider-backed pool to
// screen/rank (Section 10 pool alignment), not the qualified subset. With 2 of 5
// persisting, the runtime gives Aria 5 while the payload claimed 2.
//
// Screening is a WIDE input; persistence is a NARROW output. These tests pin that.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationObservability, buildCandidateDiagnostic,
  type CandidateDiagnosticInput,
} from "./qualificationObservability.ts";

/** The five source-gate-accepted, provider-backed people the runtime screens. */
const SCREENED_POOL = ["a", "b", "c", "d", "e"];

const cand = (id: string, o: Partial<CandidateDiagnosticInput> = {}): CandidateDiagnosticInput => ({
  normalized_candidate_id: id,
  name: `Founder ${id}`, company: `Co ${id}`,
  source_url: `https://www.linkedin.com/in/${id}`,
  provider_verified: true,
  artifact_type: "person_candidate",
  source_gate_decision: "needs_verification",
  qualification_decision: "stage_missing_evidence",
  persisted: false,
  // The runtime handed the WHOLE pool to Aria, so screening is true by default here.
  sent_to_downstream_aria: true,
  ...o,
});

/** Section 5 fixture: 5 screened → 2 qualify_now, 2 stage_missing_evidence, 1 reject. */
function fiveScreenedTwoQualified() {
  const candidates: CandidateDiagnosticInput[] = [
    cand("a", { qualification_decision: "qualify_now", qualification_reason: "aria_accepted", tier: "qualified", persisted: true }),
    cand("b", { qualification_decision: "qualify_now", qualification_reason: "aria_accepted", tier: "qualified", persisted: true }),
    cand("c", { qualification_decision: "stage_missing_evidence", stage_reason: "missing_timing_signal", next_action: "signal_enrichment", evidence_missing: ["job_signal"] }),
    cand("d", { qualification_decision: "stage_missing_evidence", stage_reason: "company_timeout", next_action: "company_enrichment" }),
    cand("e", { qualification_decision: "reject", qualification_reason: "icp_contradiction", source_gate_decision: "needs_verification", matched_icp: [] }),
  ];
  return buildQualificationObservability({
    funnel: {
      raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0,
      hard_gate_rejected: 0, qualification_accepted: 2, qualification_staged: 2, qualification_rejected: 1,
      persisted_count: 2,
      // The ACTUAL handoff size — all five were screened.
      downstream_aria_count: SCREENED_POOL.length,
    },
    candidates, requested_limit: 5, target_entity: "person", expected_artifact_type: "person_candidate",
  });
}

// ---- (3)(9)(10)(11) the required example ----
Deno.test("5 screened / 2 qualified: Aria count is 5 while accepted and persisted are 2", () => {
  const obs = fiveScreenedTwoQualified();
  assertEquals(obs.funnel.downstream_aria_count, 5);
  assertEquals(obs.funnel.aria_screening_count, 5);
  assertEquals(obs.funnel.qualification_accepted, 2);
  assertEquals(obs.funnel.persisted_count, 2);
  assertEquals(obs.funnel.staged_count, 2);
  assertEquals(obs.funnel.qualification_rejected, 1);
  // (10) accepted + staged + rejected == total candidates
  assertEquals(
    obs.funnel.qualification_accepted + obs.funnel.staged_count + obs.funnel.qualification_rejected,
    5,
  );
  assertEquals(obs.funnel.reconciles, true);
  // (11) no candidate counted twice
  assertEquals(obs.duplicate_state_candidate_ids, []);
  // (9) the telemetry equals the real handoff set size, not a qualification filter
  assertEquals(obs.candidates.filter((c) => c.sent_to_downstream_aria).length, SCREENED_POOL.length);
});

// ---- (2) the count is NOT the qualify_now count ----
Deno.test("2: Aria screening count is not derived from the qualify_now count", () => {
  const obs = fiveScreenedTwoQualified();
  assert(obs.funnel.downstream_aria_count > obs.funnel.qualification_accepted,
    "screening is a wide input; it must exceed the qualified subset here");
  assertEquals(obs.funnel.downstream_aria_count, 5);
  assertEquals(obs.funnel.qualification_accepted, 2);
});

// ---- (4) a staged candidate may be screened ----
Deno.test("4: a staged candidate can be screened by Aria yet never persist", () => {
  const obs = fiveScreenedTwoQualified();
  const staged = obs.candidates.filter((c) => c.qualification_decision === "stage_missing_evidence");
  assertEquals(staged.length, 2);
  for (const c of staged) {
    assertEquals(c.sent_to_downstream_aria, true, "staged candidates ARE screened");
    assertEquals(c.aria_screening_handoff, true);
    assertEquals(c.persisted, false, "…but never persist");
    assertEquals(c.persistence_eligible, false);
  }
});

// ---- (5) a rejected candidate may have been screened but cannot persist ----
Deno.test("5: a rejected candidate may have been screened but cannot persist", () => {
  const obs = fiveScreenedTwoQualified();
  const rejected = obs.candidates.filter((c) => c.qualification_decision === "reject");
  assertEquals(rejected.length, 1);
  assertEquals(rejected[0].sent_to_downstream_aria, true);
  assertEquals(rejected[0].persisted, false);
  assertEquals(rejected[0].persistence_eligible, false);
});

// ---- (7)(8) only qualify_now persists; staged/rejected produce no artifacts ----
Deno.test("7/8: only qualify_now candidates persist", () => {
  const obs = fiveScreenedTwoQualified();
  const persisted = obs.candidates.filter((c) => c.persisted);
  assertEquals(persisted.length, 2);
  for (const c of persisted) assertEquals(c.qualification_decision, "qualify_now");
  for (const c of obs.candidates) {
    if (c.qualification_decision !== "qualify_now") {
      assertEquals(c.persisted, false);
      assertEquals(c.persistence_eligible, false);
    }
  }
  assertEquals(obs.funnel.persisted_count, obs.funnel.qualification_accepted);
});

// ---- (6) Aria not scheduled ----
Deno.test("6: when Aria is not scheduled nothing is reported as screened", () => {
  // The v84 shape: 0 persisted ⇒ Aria never ran ⇒ nobody was handed over.
  const obs = buildQualificationObservability({
    funnel: {
      raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0,
      hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0,
      persisted_count: 0, downstream_aria_count: 0,
    },
    candidates: SCREENED_POOL.map((id) => cand(id, { sent_to_downstream_aria: false })),
    requested_limit: 5,
  });
  assertEquals(obs.funnel.downstream_aria_count, 0);
  assertEquals(obs.funnel.aria_screening_count, 0);
  assertEquals(obs.candidates.filter((c) => c.sent_to_downstream_aria).length, 0);
  assertEquals(obs.funnel.reconciles, true);
});

// ---- screening and persistence are independent fields ----
Deno.test("screening and persistence eligibility are independent facts", () => {
  // Screened + staged ⇒ screened true, eligible false.
  const screenedStaged = buildCandidateDiagnostic(cand("x", {
    qualification_decision: "stage_missing_evidence", stage_reason: "missing_timing_signal",
    next_action: "signal_enrichment", sent_to_downstream_aria: true, persisted: false,
  }));
  assertEquals(screenedStaged.aria_screening_handoff, true);
  assertEquals(screenedStaged.persistence_eligible, false);

  // Screened + qualified + persisted ⇒ both true.
  const screenedAccepted = buildCandidateDiagnostic(cand("y", {
    qualification_decision: "qualify_now", qualification_reason: "aria_accepted",
    sent_to_downstream_aria: true, persisted: true,
  }));
  assertEquals(screenedAccepted.aria_screening_handoff, true);
  assertEquals(screenedAccepted.persistence_eligible, true);

  // An explicit persistence_eligible from the reducer is honoured verbatim.
  const forced = buildCandidateDiagnostic(cand("z", {
    qualification_decision: "qualify_now", sent_to_downstream_aria: true,
    persisted: false, persistence_eligible: false,
  }));
  assertEquals(forced.persistence_eligible, false);
});
