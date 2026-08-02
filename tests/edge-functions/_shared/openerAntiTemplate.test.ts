// Anti-template scoring, driven by a real production failure.
//
// On 2026-07-21 07:43 UTC the DEPLOYED generator (which already contained the
// candidate scorer) produced this for Harmonic Security:
//
//   "Since Harmonic Security is currently hiring a Director of Revenue
//    Operations, I thought you might be interested in how our AI agents
//    automate pipeline building and account research to support lean growth
//    teams."
//
// It scored with ZERO penalties — no filler pattern matched "I thought you
// might be interested", and no rule recognised "Since <Company> is currently
// hiring" or the generic "our AI agents automate…" blurb. It therefore won on
// evidence points alone.
//
// The company name below is retained ONLY because it is the documented failing
// input; every seller claim and Brain fact here is synthetic.
//
// Pure and deterministic. No model, no network, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scoreOpenerCandidate, selectBestCandidate } from "../../../supabase/functions/_shared/openerCandidates.ts";

const OPTS = {
  personalization_depth: "specific",
  company_name: "Harmonic Security",
  recipient_first_name: "Kenneth",
};

/** The exact shape that shipped. Both halves carry valid ids, as it did. */
const PRODUCTION_TEMPLATE = {
  text: "Since Harmonic Security is currently hiring a Director of Revenue Operations, "
    + "I thought you might be interested in how our AI agents automate pipeline building "
    + "and account research to support lean growth teams.",
  used_evidence_ids: ["research_1"],
  used_seller_claim_ids: ["seller_claim_1"],
};

/** A connected candidate: business transition → why it matters → seller value. */
const CONNECTED = {
  text: "Harmonic's search for a Director of Revenue Operations suggests the revenue motion "
    + "is becoming more structured. We help lean B2B teams turn buying signals and account "
    + "research into a reviewed shortlist while that process takes shape.",
  used_evidence_ids: ["research_1"],
  used_seller_claim_ids: ["seller_claim_1"],
};

// ------------------------------------------------------- the production case --

Deno.test("10/12. the production template is penalised, not rewarded", () => {
  const s = scoreOpenerCandidate(PRODUCTION_TEMPLATE, OPTS);
  assert(s.reasons.includes("penalty_template_since_company"), "the 'Since <Company>' opening must be caught");
  assert(s.reasons.includes("penalty_filler_i_thought_you_might"), "'I thought you might' must be caught");
  assert(
    s.reasons.includes("penalty_signal_restatement_plus_generic_pitch"),
    "the structural signal+blurb pairing must be caught",
  );
});

Deno.test("13. a connected candidate BEATS the production template", () => {
  const template = scoreOpenerCandidate(PRODUCTION_TEMPLATE, OPTS);
  const connected = scoreOpenerCandidate(CONNECTED, OPTS);
  assert(
    connected.score > template.score,
    `connected (${connected.score}) must beat template (${template.score})`,
  );
  // And selection must actually pick it, even when the model labels the
  // template as primary — which is what happened in production.
  assertEquals(selectBestCandidate([PRODUCTION_TEMPLATE, CONNECTED], OPTS)?.text, CONNECTED.text);
});

Deno.test("the template cannot win on evidence points alone", () => {
  // The exact production failure: identical valid ids on both sides, so only
  // structure separates them.
  assertEquals(PRODUCTION_TEMPLATE.used_evidence_ids.length, CONNECTED.used_evidence_ids.length);
  assertEquals(PRODUCTION_TEMPLATE.used_seller_claim_ids.length, CONNECTED.used_seller_claim_ids.length);
  assert(scoreOpenerCandidate(PRODUCTION_TEMPLATE, OPTS).score < 0, "a pure template should score negative");
});

// ------------------------------------------------------------ each pattern ----

Deno.test("11. 'I thought you might be interested' is penalised", () => {
  const s = scoreOpenerCandidate(
    { text: "Kenneth, I thought you might be interested in what we do.", used_evidence_ids: [], used_seller_claim_ids: [] },
    OPTS,
  );
  assert(s.reasons.some((r) => r.startsWith("penalty_filler_i_thought")));
});

Deno.test("12. generic seller self-description is penalised", () => {
  for (const text of [
    "We help companies build more pipeline.",
    "Our AI agents automate account research.",
    "Here is how our platform helps teams.",
  ]) {
    const s = scoreOpenerCandidate({ text, used_evidence_ids: [], used_seller_claim_ids: [] }, OPTS);
    assert(s.reasons.some((r) => r.startsWith("penalty_generic_")), `not caught: ${text}`);
  }
});

Deno.test("formulaic hiring openings are caught in their common variants", () => {
  for (const text of [
    "Since Harmonic Security is currently hiring a RevOps lead, here is a thought.",
    "As Harmonic Security is hiring a RevOps lead, here is a thought.",
    "I saw you are hiring a RevOps lead.",
  ]) {
    const s = scoreOpenerCandidate({ text, used_evidence_ids: [], used_seller_claim_ids: [] }, OPTS);
    assert(s.reasons.some((r) => r.startsWith("penalty_template_")), `not caught: ${text}`);
  }
});

// --------------------------------------------------- no over-correction ------

Deno.test("'since' used as ordinary prose is NOT penalised", () => {
  // The word itself is fine — only the mail-merge construction is the problem.
  const s = scoreOpenerCandidate(
    {
      text: "Harmonic has grown a lot since the platform launched, and account research usually "
        + "gets harder at that point. We help lean teams keep qualification consistent.",
      used_evidence_ids: ["research_1"],
      used_seller_claim_ids: ["seller_claim_1"],
    },
    OPTS,
  );
  assert(!s.reasons.some((r) => r.startsWith("penalty_template_")), `over-caught: ${s.reasons.join(",")}`);
});

Deno.test("a specific seller claim is not mistaken for a generic blurb", () => {
  const s = scoreOpenerCandidate(
    {
      text: "Harmonic's RevOps hire points to a more structured revenue motion. We turn verified "
        + "buying signals into a reviewed account shortlist for lean B2B teams.",
      used_evidence_ids: ["research_1"],
      used_seller_claim_ids: ["seller_claim_1"],
    },
    OPTS,
  );
  assert(!s.reasons.some((r) => r.startsWith("penalty_generic_")), `over-caught: ${s.reasons.join(",")}`);
  assert(s.score > 0);
});

Deno.test("scoring stays deterministic regardless of candidate order", () => {
  const a = selectBestCandidate([PRODUCTION_TEMPLATE, CONNECTED], OPTS)?.text;
  const b = selectBestCandidate([CONNECTED, PRODUCTION_TEMPLATE], OPTS)?.text;
  assertEquals(a, b);
});
