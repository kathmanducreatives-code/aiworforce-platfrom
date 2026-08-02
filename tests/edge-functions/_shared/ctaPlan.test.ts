// Every cold-outreach message must ask for a next step, and that ask must come
// from the workspace's own Company Brain.
//
// Production evidence, 2026-07-21 — the message accepted as a complete success:
//   "I noticed Harmonic Security is expanding the revenue team; we provide an
//    AI workforce platform that automates passive talent discovery and
//    candidate intelligence to help lean teams grow faster."
// It ends as a product statement. Nothing required a CTA, nothing validated
// one, and the scorer had no CTA dimension.
//
// Every tenant fixture below is SYNTHETIC. Recruiting vocabulary is deliberately
// VALID for the recruiting tenant and INVALID for the pipeline tenant — the rule
// is tenant-specific, never a global word ban.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCtaPlan, validateCta, hasCta } from "../../supabase/functions/_shared/ctaPlan.ts";
import { buildSellerContext, buildSellerClaims, detectBrainContradictions } from "../../supabase/functions/_shared/sellerContext.ts";
import { scoreOpenerCandidate, selectBestCandidate } from "../../supabase/functions/_shared/openerCandidates.ts";

// ------------------------------------------------------------- tenant brains --

const PIPELINE_BRAIN = {
  company_name: "Northwind Signals",
  company_summary: "Northwind Signals helps lean teams build qualified pipeline.",
  positioning: {
    offer: "signal-based account research and qualification",
    promise: "build pipeline before adding payroll",
    use_cases: ["comparing how account qualification is structured"],
    avoid_positioning: ["never claim guaranteed revenue"],
  },
  target_outcomes: ["turn buying signals into a reviewed shortlist"],
};

const RECRUITING_BRAIN = {
  company_name: "Larkspur Talent",
  company_summary: "Larkspur Talent runs candidate sourcing for hiring teams.",
  positioning: {
    offer: "passive talent discovery and candidate intelligence",
    promise: "fill roles without a manual sourcing grind",
    use_cases: ["reviewing a candidate sourcing workflow"],
    avoid_positioning: ["never claim guaranteed placements"],
  },
  target_outcomes: ["shorten the hiring workflow"],
};

const ACCOUNTING_BRAIN = {
  company_name: "Halyard Books",
  company_summary: "Halyard Books runs financial operations for small teams.",
  positioning: {
    offer: "financial operations and reporting support",
    use_cases: ["comparing the monthly close process"],
    avoid_positioning: ["never give tax advice"],
  },
  target_outcomes: ["shorten the close process"],
};

function planFor(brain: unknown) {
  const seller = buildSellerContext(brain);
  return buildCtaPlan(seller, buildSellerClaims(seller));
}

// ------------------------------------------------------------- CTA presence --

Deno.test("1/7. a message with no next step fails", () => {
  const plan = planFor(PIPELINE_BRAIN);
  const production =
    "I noticed Harmonic Security is expanding the revenue team; we provide an AI workforce "
    + "platform that automates passive talent discovery and candidate intelligence to help lean "
    + "teams grow faster.";
  assertEquals(hasCta(production), false);
  const v = validateCta(production, plan);
  assertEquals(v.ok, false);
  assert(v.violations.includes("failed_missing_cta"));
});

Deno.test("a question counts as a next step", () => {
  assertEquals(hasCta("Worth comparing how you structure qualification?"), true);
});

Deno.test("a low-friction statement also counts", () => {
  // Not every valid ask is a question.
  assertEquals(hasCta("Happy to share a short example if useful."), true);
});

// ---------------------------------------------------------------- CTA plan ---

Deno.test("5/8. an explicit workspace CTA is used and marked explicit", () => {
  const plan = planFor({ ...PIPELINE_BRAIN, approved_ctas: ["compare qualification workflows"] });
  assertEquals(plan.cta_source, "explicit");
  assertEquals(plan.cta_offer, "compare qualification workflows");
  assertEquals(plan.available, true);
});

Deno.test("10. with no explicit CTA a conservative one is DERIVED from an approved offer", () => {
  const plan = planFor(PIPELINE_BRAIN);
  assertEquals(plan.cta_source, "derived");
  assertEquals(plan.available, true);
  // Backed by a real claim id — the ask is traceable to the Brain.
  assert(plan.used_offer_ids.length > 0);
  assert(plan.cta_offer !== null);
});

Deno.test("a Brain with no usable offer supports NO cta rather than inventing one", () => {
  const plan = planFor({ company_name: "Empty Co" });
  assertEquals(plan.available, false);
  assertEquals(plan.cta_offer, null);
  // And an ask made anyway is rejected as unbacked.
  const v = validateCta("Worth a quick look?", plan);
  assert(v.violations.includes("failed_unapproved_offer"));
});

Deno.test("1/2. each tenant derives a DIFFERENT cta from its own Brain", () => {
  const pipeline = planFor(PIPELINE_BRAIN);
  const recruiting = planFor(RECRUITING_BRAIN);
  const accounting = planFor(ACCOUNTING_BRAIN);
  const offers = [pipeline.cta_offer, recruiting.cta_offer, accounting.cta_offer];
  assertEquals(new Set(offers).size, 3, "tenants must not share a CTA");
  assert(pipeline.cta_offer!.includes("qualification"));
  assert(recruiting.cta_offer!.includes("sourcing"));
  assert(accounting.cta_offer!.includes("close"));
});

// ------------------------------------------------------------ CTA quality ----

Deno.test("8/10. generic asks are rejected", () => {
  const plan = planFor(PIPELINE_BRAIN);
  for (const bad of [
    "Interested?", "Thoughts?", "Want to learn more?", "Book a demo?",
    "Do you have 15 minutes?", "Would love to connect.", "Check us out.",
  ]) {
    const v = validateCta(`Some relevant observation. ${bad}`, plan);
    assert(v.violations.includes("failed_invalid_cta"), `not caught: ${bad}`);
  }
});

Deno.test("11. a high-friction ask is rejected for first contact", () => {
  const plan = planFor(PIPELINE_BRAIN);
  for (const bad of ["Can we book a 30-minute call?", "Sign up here.", "Start a trial?"]) {
    const v = validateCta(bad, plan);
    assert(v.violations.includes("failed_cta_high_friction"), `not caught: ${bad}`);
  }
});

Deno.test("an unapproved scheduling link is rejected", () => {
  const plan = planFor(PIPELINE_BRAIN);
  const v = validateCta("Grab time on my calendly?", plan);
  assert(v.violations.includes("failed_cta_high_friction"));
});

Deno.test("unsupported promises are rejected", () => {
  const plan = planFor(PIPELINE_BRAIN);
  for (const bad of ["We guarantee more pipeline.", "We replace your entire team.", "We double your revenue."]) {
    const v = validateCta(`${bad} Worth comparing notes?`, plan);
    assert(v.violations.includes("failed_cta_unsupported_promise"), `not caught: ${bad}`);
  }
});

Deno.test("a workspace that explicitly approves a phrasing may use it", () => {
  // "Book a demo" is generic by default — but a tenant may own that motion.
  const plan = planFor({ ...PIPELINE_BRAIN, approved_ctas: ["book a demo"] });
  const v = validateCta("Structured qualification is taking shape. Book a demo?", plan);
  assert(!v.violations.includes("failed_invalid_cta"), `over-caught: ${v.reasons.join(",")}`);
});

Deno.test("a contextual low-friction ask passes", () => {
  const plan = planFor(PIPELINE_BRAIN);
  const good = "Harmonic's RevOps search suggests the revenue motion is getting more structured. "
    + "Worth comparing how you're approaching account qualification as that takes shape?";
  const v = validateCta(good, plan);
  assertEquals(v.ok, true, `violations: ${v.reasons.join(",")}`);
});

Deno.test("an informational message may opt out of the CTA requirement", () => {
  const plan = planFor(PIPELINE_BRAIN);
  const v = validateCta("A purely informational note with no ask.", plan, { requireCta: false });
  assertEquals(v.ok, true);
});

// --------------------------------------------------------------- scoring -----

Deno.test("15. a candidate WITHOUT a cta cannot win on evidence count", () => {
  const noCta = {
    text: "Harmonic is expanding the revenue team; we provide account research to help lean teams.",
    used_evidence_ids: ["research_1", "research_2"],   // MORE evidence
    used_seller_claim_ids: ["seller_claim_1"],
  };
  const withCta = {
    text: "Harmonic's RevOps search suggests a more structured revenue motion. Worth comparing "
      + "how you're handling account qualification?",
    used_evidence_ids: ["research_1"],                  // less evidence
    used_seller_claim_ids: ["seller_claim_1"],
  };
  const opts = { personalization_depth: "specific", company_name: "Harmonic", recipient_first_name: "Sam" };
  assert(scoreOpenerCandidate(withCta, opts).score > scoreOpenerCandidate(noCta, opts).score);
  assertEquals(selectBestCandidate([noCta, withCta], opts)?.text, withCta.text);
});

Deno.test("a missing cta is reported, not silently ignored", () => {
  const s = scoreOpenerCandidate(
    { text: "We provide account research.", used_evidence_ids: [], used_seller_claim_ids: [] },
    { personalization_depth: "specific" },
  );
  assert(s.reasons.includes("penalty_missing_cta"));
});

// ------------------------------------------------- Brain self-contradiction --

Deno.test("11/12. a Brain that approves AND forbids the same language is flagged", () => {
  // The exact production shape: talent vocabulary in BOTH use_cases (approved)
  // and avoid_positioning (forbidden).
  const brain = {
    company_name: "Contradictory Co",
    company_summary: "A synthetic summary.",
    positioning: {
      offer: "passive talent discovery and candidate intelligence",
      use_cases: ["passive talent discovery for hiring teams"],
      avoid_positioning: ["never position us around passive talent discovery"],
    },
  };
  const seller = buildSellerContext(brain);
  const conflicts = detectBrainContradictions(seller, buildSellerClaims(seller));
  assert(conflicts.length > 0, "the collision must be detected");
  assert(conflicts[0].overlap.length >= 2, "overlap terms are reported for diagnostics");
});

Deno.test("14. a coherent Brain reports NO contradiction", () => {
  for (const brain of [PIPELINE_BRAIN, RECRUITING_BRAIN, ACCOUNTING_BRAIN]) {
    const seller = buildSellerContext(brain);
    const conflicts = detectBrainContradictions(seller, buildSellerClaims(seller));
    assertEquals(conflicts.length, 0, `false positive for ${seller.seller_company_name}`);
  }
});

Deno.test("14. recruiting language is valid for a recruiting tenant", () => {
  // The SAME vocabulary that collides for the pipeline tenant is legitimate
  // here, because this Brain approves it. Never a global ban.
  const seller = buildSellerContext(RECRUITING_BRAIN);
  const claims = buildSellerClaims(seller);
  assert(JSON.stringify(claims).toLowerCase().includes("talent"));
  assertEquals(detectBrainContradictions(seller, claims).length, 0);
});

Deno.test("a single shared common word is not a contradiction", () => {
  const seller = buildSellerContext({
    company_summary: "A synthetic summary.",
    positioning: { offer: "account research for revenue teams" },
    prohibited_claims: ["never claim guaranteed revenue"],
  });
  // "revenue" alone must not trip the detector.
  assertEquals(detectBrainContradictions(seller, buildSellerClaims(seller)).length, 0);
});
