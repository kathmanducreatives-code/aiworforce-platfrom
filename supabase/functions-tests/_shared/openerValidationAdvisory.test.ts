// Preferred word count must not reject an otherwise valid opener.
//
// Production evidence, 2026-07-20 07:40:44Z (Harmonic Security, first request
// ever to reach a live model):
//
//   char_count 248 · word_count 40 · sentence_count 2 · question_count 1
//   unsupported_claims []  ← no safety violation whatsoever
//   violations ["too_long_chars", "above_preferred_word_count"]
//
// `too_long_chars` was CORRECT (248 > hard_max_chars 240) and still fails here.
// `above_preferred_word_count` was not: it derives from `preferred_max_words`,
// yet `ok` was `violations.length === 0`, so a preference was fatal.
//
// Fixtures are SYNTHETIC. The model boundary is never invoked in this file.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateOpener,
  DEFAULT_OPENER_CONSTRAINTS,
  type PersonalizationContext,
  type OpenerEligibility,
} from "../../functions/_shared/openerBackend.ts";

/** Minimal context: one fresh allowed company-site evidence item. */
function ctx(depth: "specific" | "company_level" = "specific"): PersonalizationContext {
  return {
    lead_candidate_id: "lead-1",
    company: { name: "Example Corp", summary: "A synthetic summary.", industry: "logistics" },
    decision_maker: {
      first_name: "Sample",
      full_name: "Sample Person",
      current_title: "VP Revenue",
      current_company_name: "Example Corp",
      role_family: "executive_revenue",
      verification_status: "verified",
      verification_methods: ["company_linkedin_url"],
    },
    brain: {
      positioning: "A synthetic positioning line.",
      product_summary: "A synthetic product summary.",
      outcomes: ["cut manual triage time"],
      differentiators: [],
      proof: [],
      prohibited_claims: [],
      tone: "direct",
      approved_ctas: [],
      available: true,
    },
    evidence: [{
      evidence_id: "research_1",
      source_type: "company_site",
      statement: "Company research source",
      source_domain: "example.test",
      fresh: true,
      allowed: true,
    }],
    icp_matched_criteria: [],
    why_now: null,
    person_resolution: { status: "verified", source: "legacy_decision_makers", reason_code: "verified_person_resolved" },
    ...(depth ? {} : {}),
    // Deliberately partial: this advisory suite exercises validation, not the
    // seller fields. Cast through `unknown` (the seller_* / seller_identity
    // fields are intentionally omitted).
  } as unknown as PersonalizationContext;
}

function eligibility(depth: "specific" | "company_level"): OpenerEligibility {
  return {
    status: depth === "specific" ? "ready" : "downgraded",
    reason_code: depth === "specific" ? "ready" : "downgraded_company_level",
    personalization_depth: depth,
    allowed_evidence_ids: ["research_1"],
    missing_requirements: [],
  };
}

/** ~40 words, comfortably under 240 chars — the shape the fix must accept. */
const LONG_BUT_VALID = "ok ".repeat(90).trim() + ". Worth a short chat?";

/** Reproduces production: over the hard character cap AND over preferred words. */
const OVER_CHAR_LIMIT = "word ".repeat(120).trim() + ". Worth a short chat?";

// ------------------------------------------------------- the production case --

Deno.test("1. the production-shaped response still FAILS on the hard char limit", () => {
  const v = validateOpener(OVER_CHAR_LIMIT, ctx(), eligibility("specific"));
  assert(v.char_count > DEFAULT_OPENER_CONSTRAINTS.hard_max_chars, "fixture must exceed the cap");
  assert(v.violations.includes("too_long_chars"));
  assertEquals(v.ok, false, "an over-length opener must still be rejected");
});

Deno.test("8. the <=240 character rule is still enforced", () => {
  assert(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars > 0);
  assertEquals(validateOpener("x".repeat(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars + 1), ctx(), eligibility("specific")).ok, false);
});

// ------------------------------------------------------------ the actual fix --

Deno.test("a long-but-legal opener PASSES despite exceeding preferred words", () => {
  const v = validateOpener(LONG_BUT_VALID, ctx(), eligibility("specific"));
  assert(v.char_count <= DEFAULT_OPENER_CONSTRAINTS.hard_max_chars, `char_count ${v.char_count}`);
  assert(v.word_count > DEFAULT_OPENER_CONSTRAINTS.preferred_max_words, `word_count ${v.word_count}`);
  assert(v.violations.includes("above_preferred_word_count"), "still reported for observability");
  assertEquals(v.ok, true, "a preference must not reject a valid opener");
});

Deno.test("a very short opener is advisory too, not fatal", () => {
  const v = validateOpener("Saw the logistics work — worth a chat?", ctx(), eligibility("specific"));
  assert(v.word_count < DEFAULT_OPENER_CONSTRAINTS.preferred_min_words);
  assert(v.violations.includes("below_preferred_word_count"));
  assertEquals(v.ok, true);
});

Deno.test("advisory violations remain visible in the violations list", () => {
  // Silently dropping them would hide drift in model behaviour.
  const v = validateOpener(LONG_BUT_VALID, ctx(), eligibility("specific"));
  assert(v.violations.length > 0, "advisory violations must still be reported");
});

// ------------------------------------------- every hard rule still fails hard --

Deno.test("9/10. sentence and question caps still reject", () => {
  const overSentenceCap = "One here. Two here. Three here. Four here.";
  assertEquals(validateOpener(overSentenceCap, ctx(), eligibility("specific")).ok, false);

  const twoQuestions = "Worth a chat? Or maybe next week instead?";
  const v = validateOpener(twoQuestions, ctx(), eligibility("specific"));
  assertEquals(v.ok, false);
});

Deno.test("11/12/13. email structure, subject line and signature still reject", () => {
  for (const bad of [
    "Subject: quick question about logistics triage at Example Corp today",
    "Hi Sample,\n\nWanted to reach out about triage.\n\nBest regards,\nA Sender",
  ]) {
    assertEquals(validateOpener(bad, ctx(), eligibility("specific")).ok, false, bad.slice(0, 20));
  }
});

Deno.test("4. an unsupported event claim still rejects", () => {
  // No job_posting evidence in context, so a hiring claim is ungrounded.
  const v = validateOpener(
    "Saw you're hiring a new revenue lead at Example Corp and wanted to reach out about triage time.",
    ctx(),
    eligibility("specific"),
  );
  assert(v.violations.includes("unsupported_event_claim"));
  assertEquals(v.ok, false);
});

Deno.test("6. a company-level opener passes without any timing evidence", () => {
  const v = validateOpener(
    "Teams building in logistics usually hit manual triage well before they expect to. Worth a chat?",
    ctx("company_level"),
    eligibility("company_level"),
  );
  assertEquals(v.ok, true, `violations: ${v.violations.join(",")}`);
});

Deno.test("5. a timing claim at company-level depth still rejects", () => {
  const v = validateOpener(
    "Saw you just raised a round and wanted to reach out about manual triage time at Example Corp.",
    ctx("company_level"),
    eligibility("company_level"),
  );
  assertEquals(v.ok, false);
});

Deno.test("7. a prohibited Company Brain claim still rejects", () => {
  const c = ctx();
  c.brain.prohibited_claims = ["SOC2 certified"];
  const v = validateOpener(
    "Example Corp teams like yours use our SOC2 certified platform to cut manual triage time.",
    c,
    eligibility("specific"),
  );
  assert(v.violations.some((x) => x.startsWith("prohibited:")));
  assertEquals(v.ok, false);
});

Deno.test("an empty opener is never ok", () => {
  assertEquals(validateOpener("   ", ctx(), eligibility("specific")).ok, false);
});
