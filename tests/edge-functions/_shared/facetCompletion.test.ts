// FACET COMPLETION: WHAT THE COMPANY'S CITED PAGE STATES DECIDES, NOT WHICH LINE A MODEL PICKED.
//
// Three production runs of one Fuse AI mission on the SAME cached pages:
//
//   e8a70920  quoted a tagline + a "for teams" line          → plausible
//   d6cd2ef2  quoted "50/seat" among others                  → accepted, SATISFIED
//   62450e73  quoted "$60 per month" + four audience lines   → plausible
//             (quote_does_not_state_saas_delivery — "50/seat" was on the same page)
//
// `completeFacets` (in verifyGroundedResult) looks, only on the pages the
// validated claims already cite, for a verbatim line stating a facet the model's
// quotes left unstated, read by the same facet reader. These tests replay the
// production answers against fuseai.com's real lines, then pin every guard.
//
// ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import {
  businessModelDecision, FACET_COMPLETION_MAX, parseGroundedResult, verifyGroundedResult,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import { evaluateBatchResponse } from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";

const KEY = "https://www.linkedin.com/company/fuseaicom";
const AT = "2026-09-16T09:42:15.839Z";

/** fuseai.com/pricing as stored (2026-09-16): every line the three runs quoted, in page order. */
const PRICING = [
  "PRICING", "# Time is money. Let AI handle the busy work.",
  "Try Fuse for free to experience AI-powered sales.",
  "Solo", "$60\n\nper month", "For founders and solo SDRs testing outbound.", "Sign Up For Free", "Solo workspace with 1 seat",
  "Team", "$200\n\nper month", "Designed for small teams looking to accelerate outbound.", "Shared team workspace with 5 seats",
  "CRM, MCP, API, and Slack Integrations",
  "Enterprise", "Built for teams running outbound as a repeatable system", "Shared team workspace with 5+ seats",
  "Seats", "50/seat", "2,500/mo per account",
  "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide",
].join("\n\n");

type Page = { source_url: string; page_intent: string; source_text: string; fetched_at: string };
const PRICING_PAGE: Page = { source_url: "https://fuseai.com/pricing", page_intent: "pricing", source_text: PRICING, fetched_at: AT };

function registry(pages: Page[] = [PRICING_PAGE], description = "Fuse is the sales superintelligence platform for modern revenue teams.") {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: KEY, source_capability: "known_company_resolution", source_query: "q",
      company: {
        company_name: "Fuse AI", linkedin_company_url: KEY, canonical_domain: "fuseai.com", website: "https://fuseai.com",
        geography: "San Francisco, CA, United States", provider_industry: "Software Development", description,
        field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "fuse" },
      } as never,
      enriched: null, identity_state: "resolved", linkedin_company_url: KEY, commercial_jobs: [], strongest_signal: null,
    }),
    web_pages: pages,
  } as never);
}
type Reg = ReturnType<typeof registry>;
const idOf = (reg: Reg, url: string) => reg.items.find((i) => i.source_url === url)!.evidence_id;
const descId = (reg: Reg) => reg.items.find((i) => i.evidence_type === "company_description")!.evidence_id;

function answer(value: string, bm: Array<[id: string, excerpt: string]>, supporting: Array<[type: string, id: string, excerpt: string]> = []) {
  const claim = (claim_type: string, pairs: Array<[string, string]>) => ({
    claim: "the company's own words", claim_type,
    evidence_ids: [...new Set(pairs.map((p) => p[0]))], evidence_excerpts: pairs.map(([evidence_id, excerpt]) => ({ evidence_id, excerpt })),
  });
  return {
    business_model: { value, confidence: 0.9, claims: bm.length ? [claim("business_model", bm)] : [] },
    company_fit: "pass", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
    supporting_claims: supporting.map(([t, id, ex]) => claim(t, [[id, ex]])),
    conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "",
  };
}

const verify = (reg: Reg, a: Record<string, unknown>) => verifyGroundedResult({ registry: reg, result: parseGroundedResult(a) });

// ── THE THREE PRODUCTION ANSWERS ─────────────────────────────────────────────

const RUN_62450E73 = (reg: Reg) => answer("ai_saas", [
  [idOf(reg, PRICING_PAGE.source_url), "Try Fuse for free to experience AI-powered sales."],
  [idOf(reg, PRICING_PAGE.source_url), "$60\n\nper month"],
  [idOf(reg, PRICING_PAGE.source_url), "For founders and solo SDRs testing outbound."],
  [idOf(reg, PRICING_PAGE.source_url), "Designed for small teams looking to accelerate outbound."],
  [idOf(reg, PRICING_PAGE.source_url), "Built for teams running outbound as a repeatable system"],
], [["product_type", descId(reg), "Fuse is the sales superintelligence platform for modern revenue teams."]]);

const RUN_D6CD2EF2 = (reg: Reg) => answer("ai_saas", [
  [idOf(reg, PRICING_PAGE.source_url), "Try Fuse for free to experience AI-powered sales."],
  [idOf(reg, PRICING_PAGE.source_url), "$200\n\nper month"],
  [idOf(reg, PRICING_PAGE.source_url), "50/seat"],
  [idOf(reg, PRICING_PAGE.source_url), "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide"],
], [["product_type", descId(reg), "Fuse is the sales superintelligence platform for modern revenue teams."]]);

/** e8a70920's shape: the tagline and a "for teams" line. */
const RUN_E8A70920 = (reg: Reg) => answer("ai_saas", [
  [idOf(reg, PRICING_PAGE.source_url), "Try Fuse for free to experience AI-powered sales."],
], [["customer_type", idOf(reg, PRICING_PAGE.source_url), "Designed for small teams looking to accelerate outbound."]]);

Deno.test("62450e73: the model stopped at '$60 per month' — the code completes the seat line from the SAME page → accepted", () => {
  const reg = registry();
  const v = verify(reg, RUN_62450E73(reg));
  assertEquals(v.rejected_claims, []);
  assertEquals(v.facet_completions, [{ evidence_id: idOf(reg, PRICING_PAGE.source_url), excerpt: "50/seat", facet: "saas_delivery" }],
    "the first line on the cited page that states seat pricing — the line d6cd2ef2's model chose");
  const d = businessModelDecision(v);
  assertEquals([d.decision, d.reasons], ["accepted", []]);
  assert(d.facets_stated.includes("saas_delivery"));
  const completed = d.quotes.filter((q) => q.source === "code_completion");
  assertEquals(completed.map((q) => q.excerpt), ["50/seat"], "recorded as the code's, not the model's");
  assert(d.quotes.filter((q) => !q.source).length === 6, "the model's own quotes are all kept");
});

Deno.test("d6cd2ef2: nothing was missing, so nothing is completed", () => {
  const reg = registry();
  const v = verify(reg, RUN_D6CD2EF2(reg));
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).decision, "accepted");
});

Deno.test("e8a70920: the tagline and a 'for teams' line — the seat line is completed → accepted", () => {
  const reg = registry();
  const d = businessModelDecision(verify(reg, RUN_E8A70920(reg)));
  assertEquals(d.decision, "accepted", d.reasons.join(", "));
});

Deno.test("DETERMINISM: three different quote choices on the same pages → one verdict", () => {
  const reg = registry();
  const verdicts = [RUN_E8A70920, RUN_D6CD2EF2, RUN_62450E73].map((run) => {
    const d = businessModelDecision(verify(reg, run(reg)));
    return [d.decision, [...d.facets_stated].filter((f) => f === "business_customer" || f === "saas_delivery").sort()];
  });
  assertEquals(verdicts, Array(3).fill(["accepted", ["business_customer", "saas_delivery"]]));
});

// ── THE BAR DOES NOT MOVE ────────────────────────────────────────────────────

Deno.test("a price period alone is still no delivery: a page with only 'per month' completes nothing", () => {
  const reg = registry([{ ...PRICING_PAGE, source_text: "Try Fuse for free to experience AI-powered sales.\n\n$60\n\nper month\n\nBuilt for teams running outbound as a repeatable system" }]);
  const v = verify(reg, answer("ai_saas", [[idOf(reg, PRICING_PAGE.source_url), "Try Fuse for free to experience AI-powered sales."]],
    [["customer_type", idOf(reg, PRICING_PAGE.source_url), "Built for teams running outbound as a repeatable system"]]));
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).reasons, ["quote_does_not_state_saas_delivery"]);
});

Deno.test("only pages the validated claims cite: a seat line on an UNCITED page is never used", () => {
  const other: Page = { source_url: "https://fuseai.com/plans", page_intent: "pricing", source_text: "50/seat", fetched_at: AT };
  const bare: Page = { ...PRICING_PAGE, source_text: "Try Fuse for free to experience AI-powered sales.\n\nBuilt for teams running outbound as a repeatable system" };
  const reg = registry([bare, other]);
  const v = verify(reg, answer("ai_saas", [[idOf(reg, bare.source_url), "Try Fuse for free to experience AI-powered sales."]],
    [["customer_type", idOf(reg, bare.source_url), "Built for teams running outbound as a repeatable system"]]));
  assertEquals(v.facet_completions, undefined, "/plans holds 50/seat but no validated claim cites it");
  assertEquals(businessModelDecision(v).decision, "review");
});

Deno.test("a mixed-audience cited page never gets a buyer line completed", () => {
  const page: Page = { ...PRICING_PAGE, source_text: "Try Fuse for free to experience AI-powered sales.\n\n50/seat\n\nBuilt for teams running outbound\n\nMade for individuals and families too" };
  const reg = registry([page], "");
  // b2b_saas asserts a business buyer; the model quoted none, and the page says both.
  const v = verify(reg, answer("b2b_saas", [[idOf(reg, page.source_url), "Try Fuse for free to experience AI-powered sales."], [idOf(reg, page.source_url), "50/seat"]]));
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).reasons, ["quote_does_not_state_business_customer"]);
});

Deno.test("a line stating a consumer buyer is never the completion, and a negated line states nothing", () => {
  const page: Page = { ...PRICING_PAGE, source_text: "Try Fuse for free to experience AI-powered sales.\n\nBuilt for teams running outbound\n\nNo per-seat pricing\n\n$5 per user for consumers" };
  const reg = registry([page], "");
  const v = verify(reg, answer("ai_saas", [[idOf(reg, page.source_url), "Try Fuse for free to experience AI-powered sales."]],
    [["customer_type", idOf(reg, page.source_url), "Built for teams running outbound"]]));
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).decision, "review");
});

Deno.test("no business-model claim, or 'unknown': nothing is completed (ComfyUI f2af841d)", () => {
  const reg = registry();
  const noClaim = verify(reg, answer("unknown", [], [["product_type", idOf(reg, PRICING_PAGE.source_url), "Designed for small teams looking to accelerate outbound."]]));
  assertEquals(noClaim.facet_completions, undefined);
  const onlySupporting = verify(reg, answer("b2b_saas", [], [["product_type", idOf(reg, PRICING_PAGE.source_url), "Designed for small teams looking to accelerate outbound."]]));
  assertEquals(onlySupporting.facet_completions, undefined, "a value with no validated business-model claim is not completed");
});

Deno.test("a misquoted claim is rejected, not completed", () => {
  const reg = registry();
  const v = verify(reg, answer("ai_saas", [[idOf(reg, PRICING_PAGE.source_url), "The #1 SaaS for every sales team on earth"]]));
  assertEquals(v.rejected_claims.map((r) => r.reason), ["excerpt_not_found"]);
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).decision, "review");
});

Deno.test("a completion that would make the claim contradict its own code is skipped", () => {
  // `b2b_saas` is short of delivery; the only seat line calls the product a service.
  const page: Page = { ...PRICING_PAGE, source_text: "Built for teams running outbound\n\nManaged services from $50/seat" };
  const reg = registry([page], "");
  const v = verify(reg, answer("b2b_saas", [[idOf(reg, page.source_url), "Built for teams running outbound"]]));
  assertEquals(v.facet_completions, undefined);
  assertEquals(businessModelDecision(v).decision, "review");
});

Deno.test("completions are bounded", () => {
  assert(FACET_COMPLETION_MAX <= 3);
});

// ── THE BATCH PATH GETS THE SAME COMPLETION ──────────────────────────────────

Deno.test("batch evaluation: the same 62450e73 answer is completed and accepted", () => {
  const reg = registry();
  const r = evaluateBatchResponse({
    batch: [{ company_key: KEY, registry: reg } as never],
    raw: { results: [{ company_key: KEY, ...RUN_62450E73(reg) }] },
  });
  const v = r.outcomes[0].verification!;
  assertEquals(v.facet_completions?.map((c) => c.excerpt), ["50/seat"]);
  assertEquals(businessModelDecision(v).decision, "accepted");
});
