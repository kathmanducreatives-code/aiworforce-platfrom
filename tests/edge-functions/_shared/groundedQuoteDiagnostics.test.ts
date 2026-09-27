// EVERY QUOTE A GROUNDED CLAIM RESTS ON IS KEPT — BOUNDED.
//
// Production Fuse AI rerun, task e8a70920 (2026-09-27): the business model
// stayed PENDING on `quote_does_not_state_saas_delivery`, and neither
// `grounded_brain_diagnostics` (claim type + the model's paraphrase) nor the
// stored claim (its FIRST excerpt) said which lines had been quoted. The cause
// had to be inferred from a paraphrase. Now:
//
//   grounded_brain_diagnostics.companies[].validated_claims[]  → claimDiagnostic
//   the business-model item's assessment.business_model_quotes → the facet quotes
//
// Excerpts are verbatim first-party text the verifier already matched against
// its source — never model prose, never a page. Both are bounded.
//
// Pure. ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  businessModelDecision, claimDiagnostic, DIAGNOSTIC_QUOTE_CHARS, DIAGNOSTIC_QUOTES_MAX,
  type GroundedClaim, type GroundedVerification,
} from "../../../supabase/functions/_shared/groundedClaims.ts";

const PRICING = "web_page:company_website:7acedbc2";
const HOME = "web_page:company_website:53d934b6";

const claim = (claim_type: GroundedClaim["claim_type"], quotes: Array<[string, string]>): GroundedClaim => ({
  claim: `a ${claim_type} claim`, claim_type,
  evidence_ids: quotes.map((q) => q[0]),
  evidence_excerpts: quotes.map(([evidence_id, excerpt]) => ({ evidence_id, excerpt })),
});

const verification = (validated: GroundedClaim[]): GroundedVerification => ({
  version: "grounded-claims-v1",
  classifier_result: { business_model: { value: "ai_saas", confidence: 0.9, claims: [] } },
  validated_claims: validated, rejected_claims: [], grounding_score: 1, final_grounded_decision: "pass",
  downgrade_reasons: [], unacknowledged_conflicts: [],
} as never);

Deno.test("claimDiagnostic keeps the claim and every quote it rests on", () => {
  const d = claimDiagnostic(claim("business_model", [
    [PRICING, "Shared team workspace with 5 seats"], [PRICING, "Solo per month"], [HOME, "Try Fuse for free to experience AI-powered sales."],
  ]));
  assertEquals(d.claim_type, "business_model");
  assertEquals(d.evidence_ids, [PRICING, HOME], "cited items, once each");
  assertEquals(d.quotes.map((q) => [q.evidence_id, q.excerpt]), [
    [PRICING, "Shared team workspace with 5 seats"], [PRICING, "Solo per month"], [HOME, "Try Fuse for free to experience AI-powered sales."],
  ]);
});

Deno.test("claimDiagnostic is bounded: a quote is cut, a claim keeps at most DIAGNOSTIC_QUOTES_MAX", () => {
  const long = "x".repeat(DIAGNOSTIC_QUOTE_CHARS + 500);
  const d = claimDiagnostic(claim("business_model", Array.from({ length: DIAGNOSTIC_QUOTES_MAX + 5 }, (_, n) => [`${PRICING}${n}`, long] as [string, string])));
  assertEquals(d.quotes.length, DIAGNOSTIC_QUOTES_MAX);
  assertEquals(d.evidence_ids.length, DIAGNOSTIC_QUOTES_MAX);
  assert(d.quotes.every((q) => q.excerpt.length === DIAGNOSTIC_QUOTE_CHARS));
});

Deno.test("the business-model decision records exactly the quotes its facets were read from", () => {
  const d = businessModelDecision(verification([
    claim("business_model", [[HOME, "Try Fuse for free to experience AI-powered sales."]]),
    claim("customer_type", [[PRICING, "Designed for small teams looking to accelerate outbound."]]),
    claim("product_type", [[PRICING, "CRM, MCP, API, and Slack Integrations"]]),
    // Not facet sources: never listed as what the business model rests on.
    claim("company_fit", [[PRICING, "San Francisco"]]),
    claim("commercial_signal", [[PRICING, "Hiring now"]]),
  ]));
  assertEquals(d.quotes.map((q) => [q.claim_type, q.excerpt]), [
    ["business_model", "Try Fuse for free to experience AI-powered sales."],
    ["customer_type", "Designed for small teams looking to accelerate outbound."],
    ["product_type", "CRM, MCP, API, and Slack Integrations"],
  ]);
});

Deno.test("run-agent records every validated claim's quotes in grounded_brain_diagnostics", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(/validated_claims: \(c\.grounded\?\.validated_claims \?\? \[\]\)\.map\(claimDiagnostic\)/.test(src),
    "the diagnostics map validated claims through claimDiagnostic");
  assert(!/\.map\(\(x\) => \(\{ claim_type: x\.claim_type, claim: x\.claim \}\)\)/.test(src),
    "the quote-less projection is gone");
});
