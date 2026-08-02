// Multi-tenant positioning: every seller noun must come from THAT workspace's
// own Company Brain.
//
// The four fixtures below are deliberately different businesses. None of them is
// a real customer, and none of them is the workspace this code was developed
// against. The point of the suite is that vocabulary from one tenant can never
// appear in another tenant's message context — and that the PROSPECT's business
// never becomes the SELLER's positioning.
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSellerContext, buildSellerClaims, buildIcpContext, selectSellerOutcome } from "../../../supabase/functions/_shared/workbench/sellerContext.ts";
import { buildPersonalizationContext, assessOpenerEligibility } from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { buildOpenerPrompt } from "../../../supabase/functions/_shared/workbench/openerModel.ts";
import { applyStageUpdate, emptyAccountState, type WorkbenchAccountState } from "../../../supabase/functions/_shared/workbench/accountState.ts";

const T = "2026-07-20T10:00:00.000Z";

// --------------------------------------------------------------- fixtures ----

/** FIXTURE A — a revenue/pipeline product. */
const TENANT_REVENUE = {
  company_name: "Northwind Signals",
  company_summary: "Northwind Signals finds buying signals for revenue teams.",
  positioning: {
    offer: "account qualification from live buying signals",
    promise: "spend less time qualifying accounts by hand",
    differentiators: ["evidence-backed qualification"],
    use_cases: ["prioritising pipeline"],
    avoid_positioning: ["never claim guaranteed revenue"],
  },
  target_outcomes: ["cut manual account qualification time"],
  target_customer_profile: "revenue teams at growing software companies",
};

/** FIXTURE B — a recruiting product. */
const TENANT_RECRUITING = {
  company_name: "Larkspur Talent",
  company_summary: "Larkspur Talent helps teams run candidate sourcing.",
  positioning: {
    offer: "candidate sourcing and talent discovery",
    promise: "fill roles without a manual sourcing grind",
    differentiators: ["structured hiring workflow"],
    use_cases: ["talent discovery"],
    avoid_positioning: ["never claim guaranteed placements"],
  },
  target_outcomes: ["shorten the hiring workflow"],
  target_customer_profile: "in-house talent teams",
};

/** FIXTURE C — a cybersecurity consultancy. */
const TENANT_SECURITY = {
  company_name: "Ridgeline Assurance",
  company_summary: "Ridgeline Assurance advises on security posture.",
  positioning: {
    offer: "security posture and risk reduction reviews",
    promise: "reduce risk without stalling delivery",
    differentiators: ["compliance-aligned assessment"],
    use_cases: ["compliance readiness"],
    avoid_positioning: ["never claim certification we do not issue"],
  },
  target_outcomes: ["reduce security risk"],
  target_customer_profile: "engineering leaders at regulated companies",
};

/** FIXTURE D — an operations/accounting service. */
const TENANT_ACCOUNTING = {
  company_name: "Halyard Books",
  company_summary: "Halyard Books runs financial operations for small teams.",
  positioning: {
    offer: "financial operations and reporting support",
    promise: "close the books without a scramble",
    differentiators: ["faster close process"],
    use_cases: ["monthly reporting"],
    avoid_positioning: ["never give tax advice"],
  },
  target_outcomes: ["shorten the close process"],
  target_customer_profile: "founders without a finance team",
};

/** Vocabulary that must never cross tenants. */
const TENANT_VOCAB: Record<string, { own: string[]; foreign: string[] }> = {
  revenue: {
    own: ["qualification", "buying signals", "pipeline"],
    foreign: ["candidate sourcing", "talent discovery", "security posture", "close process"],
  },
  recruiting: {
    own: ["candidate sourcing", "talent discovery", "hiring workflow"],
    foreign: ["buying signals", "security posture", "close process"],
  },
  security: {
    own: ["security posture", "risk", "compliance"],
    foreign: ["talent discovery", "buying signals", "close process"],
  },
  accounting: {
    own: ["financial operations", "reporting", "close process"],
    foreign: ["talent discovery", "buying signals", "security posture"],
  },
};

/**
 * A PROSPECT whose own business is deliberately in a different category from
 * every seller — so if prospect language leaks into seller positioning, the
 * assertions catch it.
 */
const PROSPECT_SUMMARY = "Beacon Freight coordinates cross-border logistics shipments.";

function account(): WorkbenchAccountState {
  return applyStageUpdate(emptyAccountState("lead-1"), "company_research", {
    status: "succeeded",
    payload: {
      summary: PROSPECT_SUMMARY,
      evidence_urls: ["https://prospect.example/about"],
      missing_evidence: [],
      confidence: "high",
      usable: true,
    },
  }, T);
}

const LEGACY_PERSON = [{
  full_name: "Sample Person",
  name: "Sample Person",
  current_title: "VP Operations",
  title: "VP Operations",
  current_company_name: "Beacon Freight",
  linkedin_url: "https://example.test/in/sample",
  linkedinUrl: "https://example.test/in/sample",
  role_family: "executive_operations",
  verification_status: "verified",
  verification_methods: ["company_linkedin_url"],
  company_match: { status: "verified" },
  rank: 1,
  persisted: true,
}];

function promptFor(brain: unknown): { system: string; user: string } {
  const ctx = buildPersonalizationContext({
    lead_candidate_id: "lead-1",
    company_name: "Beacon Freight",
    industry: "logistics",
    account: account(),
    legacy_decision_makers: LEGACY_PERSON,
    brain_profile: brain,
    saved_icp: brain,
  });
  const eligibility = assessOpenerEligibility(ctx, false);
  return buildOpenerPrompt({
    personalization_context: ctx,
    eligibility,
    constraints: {
      preferred_min_words: 18, preferred_max_words: 35,
      hard_max_chars: 240, max_sentences: 2, max_questions: 1,
    },
  });
}

// ------------------------------------------------------ per-tenant mapping ----

const CASES: Array<[string, unknown, string]> = [
  ["revenue", TENANT_REVENUE, "Northwind Signals"],
  ["recruiting", TENANT_RECRUITING, "Larkspur Talent"],
  ["security", TENANT_SECURITY, "Ridgeline Assurance"],
  ["accounting", TENANT_ACCOUNTING, "Halyard Books"],
];

for (const [key, brain, sellerName] of CASES) {
  Deno.test(`36-39. the ${key} tenant positions itself with its OWN vocabulary`, () => {
    const seller = buildSellerContext(brain);
    assertEquals(seller.usable, true);
    assertEquals(seller.seller_company_name, sellerName);

    const blob = JSON.stringify(seller).toLowerCase();
    for (const word of TENANT_VOCAB[key].own) {
      assert(blob.includes(word.toLowerCase()), `${key} seller context should mention "${word}"`);
    }
  });

  Deno.test(`40. no foreign-tenant vocabulary leaks into the ${key} prompt`, () => {
    const { system, user } = promptFor(brain);
    const blob = `${system}\n${user}`.toLowerCase();
    for (const word of TENANT_VOCAB[key].foreign) {
      assert(!blob.includes(word.toLowerCase()), `${key} prompt must not mention "${word}"`);
    }
  });

  Deno.test(`the ${key} tenant's prohibited claims reach its own prompt only`, () => {
    const seller = buildSellerContext(brain);
    assert(seller.prohibited_claims.length > 0, "fixture defines a prohibition");
    const { system } = promptFor(brain);
    for (const claim of seller.prohibited_claims) {
      assert(system.includes(claim), `prohibition "${claim}" must be stated to the model`);
    }
  });
}

// ------------------------------------------------- seller/prospect boundary --

Deno.test("the prospect's business never becomes the seller's positioning", () => {
  for (const [, brain] of CASES) {
    const seller = buildSellerContext(brain);
    const blob = JSON.stringify(seller).toLowerCase();
    // The prospect is a logistics company; no seller context may describe itself
    // that way just because the prospect does.
    assert(!blob.includes("logistics"), "prospect industry leaked into seller context");
    assert(!blob.includes("beacon freight"), "prospect name leaked into seller context");
    assert(!blob.includes("cross-border"), "prospect description leaked into seller context");
  }
});

Deno.test("10. the prompt labels seller and prospect as different companies", () => {
  const { system, user } = promptFor(TENANT_REVENUE);
  assert(system.includes("THE SELLER AND THE PROSPECT ARE DIFFERENT COMPANIES"));
  assert(user.includes("=== SELLER CONTEXT"));
  assert(user.includes("=== PROSPECT CONTEXT"));
  // The prospect's own description is present, but clearly on the prospect side.
  const sellerBlock = user.slice(user.indexOf("=== SELLER CONTEXT"), user.indexOf("=== PROSPECT CONTEXT"));
  assert(!sellerBlock.includes(PROSPECT_SUMMARY), "prospect summary must not sit in the seller block");
});

Deno.test("9/41/42. the prompt hardcodes no seller company, industry or product", () => {
  const { system } = promptFor(TENANT_ACCOUNTING);
  const lowered = system.toLowerCase();
  for (const banned of ["agentory", "pipeline", "gtm", "recruiting", "saas", "sdr", "ai workforce", "founder-to-founder"]) {
    assert(!lowered.includes(banned), `system prompt must not hardcode "${banned}"`);
  }
});

// -------------------------------------------------------- claims allowlist ----

Deno.test("5. an approved seller claim allowlist is generated per tenant", () => {
  for (const [, brain] of CASES) {
    const claims = buildSellerClaims(buildSellerContext(brain));
    assert(claims.length > 0);
    // Ids are stable and referencable.
    assertEquals(claims[0].id, "seller_claim_1");
    assert(claims.every((c) => /^seller_claim_\d+$/.test(c.id)));
  }
});

Deno.test("the allowlist and its ids are stated to the model", () => {
  const { user } = promptFor(TENANT_SECURITY);
  assert(user.includes("Approved seller claims"));
  assert(user.includes("seller_claim_1"));
  assert(user.includes("Allowed seller claim ids:"));
});

// ------------------------------------------------------------ brain shapes ----

Deno.test("3. a FLAT Company Brain maps correctly", () => {
  const seller = buildSellerContext({
    company_name: "Flat Co",
    product_summary: "a flat product summary",
    positioning: "a flat positioning line",
    target_outcomes: ["a flat outcome"],
  });
  assertEquals(seller.usable, true);
  assertEquals(seller.offer.primary_offer, "a flat product summary");
  assertEquals(seller.offer.promise, "a flat positioning line");
  assertEquals(seller.offer.supported_outcomes, ["a flat outcome"]);
});

Deno.test("4. char-indexed corruption is ignored, never reassembled", () => {
  const seller = buildSellerContext({
    company_name: "Noisy Co",
    positioning: { "0": "A", "1": "b", "2": "c", promise: "a real promise" },
    brand_voice: { "0": "x", tone: "direct" },
    target_outcomes: ["a real outcome"],
  });
  assertEquals(seller.offer.promise, "a real promise");
  assertEquals(seller.brand_voice.tone, ["direct"]);
  assert(!JSON.stringify(seller).includes("Abc"), "char-index noise was reassembled");
});

Deno.test("6. prohibited claims are the UNION of every source", () => {
  const seller = buildSellerContext({
    company_summary: "a summary",
    prohibited_claims: ["flat prohibition"],
    positioning: { avoid_positioning: ["positioning prohibition"] },
    brand_voice: { avoid: ["voice prohibition"] },
    negative_examples: ["negative example prohibition"],
  });
  for (const p of ["flat prohibition", "positioning prohibition", "voice prohibition", "negative example prohibition"]) {
    assert(seller.prohibited_claims.includes(p), `lost "${p}"`);
  }
});

Deno.test("8. a Brain with no usable offer is NOT usable", () => {
  assertEquals(buildSellerContext({}).usable, false);
  assertEquals(buildSellerContext({ company_name: "Only A Name" }).usable, false);
  assertEquals(buildSellerContext(null).usable, false);
});

// ------------------------------------------------------------------- ICP ------

Deno.test("7. the saved ICP maps and selects the most relevant outcome", () => {
  const seller = buildSellerContext({
    company_summary: "a summary",
    target_outcomes: ["reduce onboarding effort", "shorten the close process"],
  });
  const icp = buildIcpContext({ pains: ["the monthly close process drags"] });
  // Deterministic: the outcome overlapping an ICP pain wins.
  assertEquals(selectSellerOutcome(seller, icp), "shorten the close process");
});

Deno.test("ICP vocabulary appears only as a prohibition, never as content", () => {
  const { system, user } = promptFor(TENANT_REVENUE);
  // The USER block carries the facts the model may draw on. Internal framing
  // ("Why they fit our ICP: …") used to sit there and invited the model to echo
  // it back into the message.
  assert(!user.includes("Why they fit our ICP"), "internal ICP framing leaked into the facts");
  assert(!user.toLowerCase().includes("fit score"), "internal scoring vocabulary leaked into the facts");

  // The SYSTEM block may name these terms, but only to forbid them.
  assert(system.includes("Never mention internal system terms"), "the model must be told to avoid internal vocabulary");
});
