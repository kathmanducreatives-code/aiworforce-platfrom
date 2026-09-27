// BOTH GROUNDING PROMPTS SAY WHICH WORDS A BUSINESS-MODEL CLAIM MUST QUOTE.
//
// Production Fuse AI canary, task d2d15d7e (2026-09-26): the grounder backed
// its business model with the tagline "Try Fuse for free to experience
// AI-powered sales." — true, first-party, and silent on how the product is
// sold — while fuseai.com/pricing said "Built for teams running outbound as a
// repeatable system" and "50/seat". The claim stayed plausible. The guidance
// asks for better quotes, never for a different verdict; what those quotes
// prove is shown in fuseAiBusinessModel.test.ts.
//
// Pure. ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BUSINESS_MODEL_QUOTE_GUIDANCE, GROUNDED_CLASSIFIER_PROMPT,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import { BATCH_EVALUATION_PROMPT } from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";
import { statedFacets } from "../../../supabase/functions/_shared/businessModelMatch.ts";

Deno.test("both grounding prompts carry the business-model quote guidance", () => {
  assert(GROUNDED_CLASSIFIER_PROMPT.includes(BUSINESS_MODEL_QUOTE_GUIDANCE));
  assert(BATCH_EVALUATION_PROMPT.includes(BUSINESS_MODEL_QUOTE_GUIDANCE));
  for (const cue of ["WHO buys", "HOW it is sold", "per seat", "for teams", "not a tagline", "quote the line that says it is AI", "do not stretch a quote"]) {
    assert(BUSINESS_MODEL_QUOTE_GUIDANCE.includes(cue), cue);
  }
});

Deno.test("the guidance names no data provider and asks for quotes, never a verdict", () => {
  assert(!/apify|firecrawl|linkedin|actor/i.test(BUSINESS_MODEL_QUOTE_GUIDANCE));
  assert(!/b2b_saas|ai_saas|b2b_software|b2b_service|consumer/i.test(BUSINESS_MODEL_QUOTE_GUIDANCE), "it never steers which code to choose");
});

// ── THE RERUN: A SEAT COUNT AND A PRICE PERIOD ARE NOT A DELIVERY MODEL ──────
//
// Task e8a70920 (2026-09-27) quoted fuseai.com/pricing and still stayed pending:
// its business model read "monthly plans with seat-based workspaces" — a seat
// COUNT and a price PERIOD. The guidance now says so, and every example it
// gives must be one the facet reader agrees with, or the model is taught to
// quote words the verifier ignores.

const saas = (...quotes: string[]) => statedFacets(quotes).has("saas_delivery");

Deno.test("the guidance says a seat count or a price period alone does not state delivery", () => {
  for (const cue of ["A seat count", "('per month') on its own does NOT say how it is sold", "'50/seat'", "CRM beside the price"]) {
    assert(BUSINESS_MODEL_QUOTE_GUIDANCE.includes(cue), cue);
  }
});

Deno.test("…and the facet reader agrees with every example the guidance gives", () => {
  // What the guidance says does NOT state delivery:
  assertEquals(saas("Shared team workspace with 5 seats"), false, "a seat count");
  assertEquals(saas("per month"), false, "a price period alone");
  assertEquals(saas("Shared team workspace with 5 seats", "per month"), false, "the rerun's two lines together");
  // What the guidance says DOES:
  assertEquals(saas("50/seat"), true, "the per-seat price itself");
  assertEquals(saas("$20 per user"), true);
  assertEquals(saas("per month", "CRM, MCP, API, and Slack Integrations"), true, "a price beside the software it names");
  assertEquals(saas("Sign Up For Free", "CRM, MCP, API, and Slack Integrations"), true);
});
