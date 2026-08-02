// End-to-end grounding rules: seller claim ids, evidence ids, depth honesty and
// single-model-call candidate selection.
//
// The model boundary is a stub that counts invocations, so "one model call" and
// "zero model calls" are assertions rather than claims. Synthetic fixtures only.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  type ModelBoundary,
  type ModelOpenerResponse,
  type PersonalizationContext,
  DEFAULT_OPENER_CONSTRAINTS,
} from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { applyStageUpdate, emptyAccountState, type WorkbenchAccountState } from "../../../supabase/functions/_shared/workbench/accountState.ts";

const T = "2026-07-20T10:00:00.000Z";

const BRAIN = {
  company_name: "Northwind Signals",
  company_summary: "Northwind Signals finds buying signals for revenue teams.",
  positioning: {
    offer: "account qualification from live buying signals",
    promise: "spend less time qualifying accounts by hand",
  },
  target_outcomes: ["cut manual account qualification time"],
};

const PERSON = [{
  full_name: "Sample Person",
  current_title: "VP Revenue",
  current_company_name: "Beacon Freight",
  linkedin_url: "https://example.test/in/sample",
  role_family: "executive_revenue",
  verification_status: "verified",
  verification_methods: ["company_linkedin_url"],
  company_match: { status: "verified" },
  rank: 1,
  persisted: true,
}];

function accountState(): WorkbenchAccountState {
  return applyStageUpdate(emptyAccountState("lead-1"), "company_research", {
    status: "succeeded",
    payload: {
      summary: "Beacon Freight coordinates cross-border logistics shipments.",
      evidence_urls: ["https://prospect.example/about"],
      missing_evidence: [],
      confidence: "high",
      usable: true,
    },
  }, T);
}

function ctx(): PersonalizationContext {
  return buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Beacon Freight",
    industry: "logistics",
    account: accountState(),
    legacy_decision_makers: PERSON,
    brain_profile: BRAIN,
    saved_icp: BRAIN,
  });
}

/** Counts invocations so model spend is provable. */
function countingModel(resp: Partial<ModelOpenerResponse>) {
  const calls = { n: 0 };
  const fn: ModelBoundary = () => {
    calls.n += 1;
    return Promise.resolve({ opener: "", ...resp } as ModelOpenerResponse);
  };
  return { calls, fn };
}

const GOOD = "Sam, saw the operations work at Beacon Freight. We help teams cut manual qualification time.";
const GOOD_ALT = "Sam, we help revenue teams cut manual qualification time without more headcount.";

// ------------------------------------------------------------ id contracts ----

Deno.test("20. an unknown SELLER CLAIM id fails the message", () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const { fn } = countingModel({
    opener: GOOD,
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_99"],
  });
  return generateOpener(c, e, fn).then((r) => {
    assertEquals(r.status, "failed_validation");
    assert(r.validation?.violations.includes("unknown_seller_claim_id"));
  });
});

Deno.test("17. an unknown EVIDENCE id fails the message", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const { fn } = countingModel({ opener: GOOD, used_evidence_ids: ["invented_1"] });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.status, "failed_validation");
  assert(r.validation?.violations.includes("unknown_evidence_id"));
});

Deno.test("18. specific depth with NO evidence id fails — depth is a promise", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  // Force the specific path — a message that CLAIMS specific grounding must cite
  // something, regardless of how the depth was arrived at.
  const specific = { ...e, personalization_depth: "specific" as const };
  const { fn } = countingModel({ opener: GOOD, used_evidence_ids: [] });
  const r = await generateOpener(c, specific, fn);
  assertEquals(r.status, "failed_validation");
  assert(r.validation?.violations.includes("specific_depth_without_evidence"));
});

Deno.test("19. company-level depth with no evidence id is ACCEPTED", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  // Force the company-level path: no fresh timing evidence is required.
  const companyLevel = { ...e, personalization_depth: "company_level" as const };
  const { fn } = countingModel({ opener: GOOD_ALT, used_evidence_ids: [] });
  const r = await generateOpener(c, companyLevel, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.used_evidence_ids, []);
});

// ------------------------------------------------- candidate selection ---------

Deno.test("16. exactly ONE model call produces both candidates", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const { calls, fn } = countingModel({
    opener: GOOD,
    alternative_opener: GOOD_ALT,
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(calls.n, 1, "no second model call");
  assertEquals(r.model_calls, 1);
  assert(r.alternative_opener, "the runner-up is kept");
});

Deno.test("31. a weak primary loses to a stronger valid alternative", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const weakPrimary = "Sam, I wanted to reach out about your work.";
  const { fn } = countingModel({
    opener: weakPrimary,
    alternative_opener: GOOD,
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.opener, GOOD, "the stronger candidate must win");
  assertEquals(r.alternative_opener, weakPrimary);
});

Deno.test("33. an INVALID candidate never wins, however well it scores", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  // The "attractive" candidate is a full email — validation rejects it outright.
  const { fn } = countingModel({
    opener: GOOD,
    alternative_opener: "Subject: quick note\n\nHi Sam,\n\nSaw the work.\n\nBest regards,\nA Sender",
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.opener, GOOD);
  assertEquals(r.alternative_opener, undefined, "an invalid candidate is not offered");
});

Deno.test("35. when NO candidate is valid the result stays failed_validation", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const { fn } = countingModel({
    // Derived from the constant so raising the cap cannot silently make these
    // fixtures valid again.
    opener: "x".repeat(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars + 50),
    alternative_opener: "y".repeat(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars + 50),
    used_evidence_ids: ["research_1"],
  });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.status, "failed_validation");
  assertEquals(r.opener, undefined, "no invalid opener is returned");
});

// --------------------------------------------------------------- safety -------

Deno.test("22/45. a blocked lead still makes ZERO model calls", async () => {
  const noPerson = buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Beacon Freight",
    industry: "logistics",
    account: accountState(),
    legacy_decision_makers: [],
    brain_profile: BRAIN,
    saved_icp: BRAIN,
  });
  const e = assessOpenerEligibility(noPerson, false);
  assertEquals(e.status, "blocked");
  const { calls, fn } = countingModel({ opener: GOOD });
  const r = await generateOpener(noPerson, e, fn);
  assertEquals(r.status, "blocked");
  assertEquals(calls.n, 0);
  assertEquals(r.model_calls, 0);
});

Deno.test("49. nothing on this path can send", async () => {
  const c = ctx();
  const e = assessOpenerEligibility(c, false);
  const { fn } = countingModel({
    opener: GOOD,
    used_evidence_ids: ["research_1"],
    used_seller_claim_ids: ["seller_claim_1"],
  });
  const r = await generateOpener(c, e, fn);
  assertEquals(r.sent, false);
  assertEquals(r.approval_required, true);
  assertEquals(r.approval_status, "draft");
});

Deno.test("the seller claim allowlist reaches the context", () => {
  const c = ctx();
  assert(c.seller_claims.length > 0);
  assertEquals(c.seller.seller_company_name, "Northwind Signals");
  // Prospect facts stay on the prospect side.
  assertEquals(c.company.name, "Beacon Freight");
  assert(!JSON.stringify(c.seller).includes("Beacon Freight"));
});
