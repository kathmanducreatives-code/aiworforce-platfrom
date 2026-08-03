// Candidate selection: the strongest VALID message wins, not whichever the
// model happened to label primary.
//
// Deterministic and pure — no model, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scoreOpenerCandidate, selectBestCandidate } from "../../../supabase/functions/_shared/workbench/openerCandidates.ts";

const OPTS = {
  personalization_depth: "specific",
  company_name: "Beacon Freight",
  recipient_first_name: "Sam",
};

const EVIDENCE_LED = {
  text: "Sam, saw the operations role open at Beacon Freight. We help teams cut manual qualification time.",
  used_evidence_ids: ["research_1"],
  used_seller_claim_ids: ["seller_claim_1"],
};

const VAGUE_PRAISE = {
  text: "I was impressed by your innovative approach and wanted to reach out about our exciting platform.",
  used_evidence_ids: [],
  used_seller_claim_ids: [],
};

Deno.test("32. an evidence-led candidate outscores generic praise", () => {
  const led = scoreOpenerCandidate(EVIDENCE_LED, OPTS);
  const praise = scoreOpenerCandidate(VAGUE_PRAISE, OPTS);
  assert(led.score > praise.score, `${led.score} should beat ${praise.score}`);
  assert(led.reasons.includes("uses_verified_evidence"));
  assert(praise.reasons.some((r) => r.startsWith("penalty_")));
});

Deno.test("31. a stronger ALTERNATIVE replaces a weaker primary", () => {
  // Model labelled the vague one first; selection must not honour that.
  const best = selectBestCandidate([VAGUE_PRAISE, EVIDENCE_LED], OPTS);
  assertEquals(best?.text, EVIDENCE_LED.text);
});

Deno.test("a seller claim and a named company both count toward relevance", () => {
  const s = scoreOpenerCandidate(EVIDENCE_LED, OPTS);
  assert(s.reasons.includes("uses_seller_claim"));
  assert(s.reasons.includes("names_company"));
  assert(s.reasons.includes("names_recipient"));
});

Deno.test("34. the shorter candidate wins when relevance is equivalent", () => {
  const long = {
    text: "Sam, saw the operations role at Beacon Freight and wondered whether manual qualification is taking more of the week than the team expects right now.",
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  };
  const short = {
    text: "Sam, saw the operations role at Beacon Freight. We cut manual qualification time.",
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  };
  assertEquals(selectBestCandidate([long, short], OPTS)?.text, short.text);
});

Deno.test("selection is deterministic — order does not change the winner", () => {
  const a = selectBestCandidate([VAGUE_PRAISE, EVIDENCE_LED], OPTS)?.text;
  const b = selectBestCandidate([EVIDENCE_LED, VAGUE_PRAISE], OPTS)?.text;
  assertEquals(a, b);
});

Deno.test("a single candidate is returned unchanged", () => {
  assertEquals(selectBestCandidate([EVIDENCE_LED], OPTS)?.text, EVIDENCE_LED.text);
});

Deno.test("35. no candidates returns null — the caller reports failed_validation", () => {
  assertEquals(selectBestCandidate([], OPTS), null);
});

Deno.test("filler is penalised but not treated as invalid", () => {
  // Scoring never rejects; safety validation does that upstream.
  const s = scoreOpenerCandidate({
    text: "Sam, I wanted to reach out about Beacon Freight.",
    used_evidence_ids: [],
    used_seller_claim_ids: [],
  }, OPTS);
  assert(s.reasons.includes("penalty_filler_wanted_to"));
  assert(typeof s.score === "number");
});

Deno.test("company-level depth does not credit absent evidence", () => {
  const s = scoreOpenerCandidate(
    { text: "Sam, we help teams cut manual qualification time.", used_evidence_ids: [], used_seller_claim_ids: ["seller_claim_1"] },
    { ...OPTS, personalization_depth: "company_level" },
  );
  // No evidence bonus, but a seller claim still counts — a company-level opener
  // is legitimate, not a degraded one.
  assert(!s.reasons.includes("uses_verified_evidence"));
  assert(s.reasons.includes("uses_seller_claim"));
});
