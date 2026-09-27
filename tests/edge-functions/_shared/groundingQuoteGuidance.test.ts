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

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BUSINESS_MODEL_QUOTE_GUIDANCE, GROUNDED_CLASSIFIER_PROMPT,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import { BATCH_EVALUATION_PROMPT } from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";

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
