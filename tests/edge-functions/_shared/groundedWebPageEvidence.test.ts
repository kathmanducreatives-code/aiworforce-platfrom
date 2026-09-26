// A PAGE FROM THE COMPANY'S OWN SITE MAY CARRY WHAT THE COMPANY SAYS IT DOES.
//
// Production ComfyUI canary (plan 6f6be04b, 2026-09-26): US, size, funding and
// hiring passed; the first-party-pages route bought comfy.org/platform and
// /pricing — exactly the pages it exists to buy — and every business-model
// claim citing them was refused by the grounder:
//
//   rejected_claims: [{ claim_type: "business_model",
//                       reason: "unsupported_evidence_type",
//                       detail: "web_page cannot support a business_model claim" }, …]
//
// B2B SaaS stayed unknown, the mission ended PARTIALLY_SATISFIED with no lead.
// `CLAIM_EVIDENCE_RULES` listed `company_website` but never `web_page`, the
// type `leadEvidenceRegistry` gives every fetched first-party page. The Phase C
// tests stub the verification, so the verifier itself never saw a `web_page`.
//
// These drive the REAL registry builder and the REAL verifier. The page text is
// representative first-party copy (the production quotes were not persisted).
// The second half is the other side of the bargain: the bar does not move — a
// page is still no hiring signal, a misquote is still a misquote, and a quote
// that does not state SaaS still does not prove SaaS.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  buildGroundedClassifierPayload, businessModelDecision, CLAIM_EVIDENCE_RULES, CLAIM_TYPES,
  parseGroundedResult, verifyGroundedResult, type ClaimType,
} from "../../../supabase/functions/_shared/groundedClaims.ts";

globalThis.fetch = () => { throw new Error("grounding tests must not reach the network"); };

const FETCHED = "2026-09-26T15:31:13.000Z";
const PLATFORM =
  "Comfy Cloud runs your ComfyUI workflows on cloud GPUs, with nothing to install. " +
  "Built for creative teams and studios.";
const PRICING =
  "Teams: a cloud-based workspace for businesses, billed per seat each month. " +
  "Enterprise plans for companies with SSO and dedicated support.";

const page = (intent: string, body: string) => ({
  source_url: `https://comfy.org/${intent === "product" ? "platform" : intent}`,
  page_intent: intent, source_text: body, fetched_at: FETCHED,
});

const evidence = () => ({
  version: "company-evidence-v1",
  company_key: "https://www.linkedin.com/company/comfyui",
  company_name: "ComfyUI", domain: "comfy.org",
  linkedin_company_url: "https://www.linkedin.com/company/comfyui",
  identity_state: "resolved",
  geography_evidence: "San Francisco, California, United States",
  employee_evidence: null,
  industry_evidence: ["Software Development"],
  description: null, source_query: null, source_capability: "known_company",
  commercial_job_evidence: [], strongest_signal: null,
  evidence_urls: [], missing_fields: [], conflicting_evidence: [],
}) as never;

const REGISTRY = buildEvidenceRegistry({
  evidence: evidence(), web_pages: [page("product", PLATFORM), page("pricing", PRICING)],
} as never);
const PAGE_ID = (intent: string) => REGISTRY.items.find((i) => i.metadata?.page_intent === intent)!.evidence_id;

const claim = (claim_type: ClaimType, intent: string, excerpt: string, text = "What the company's own site says.") => ({
  claim: text, claim_type, evidence_ids: [PAGE_ID(intent)],
  evidence_excerpts: [{ evidence_id: PAGE_ID(intent), excerpt }],
});

/** The grounder's answer, read through the real parser and the real verifier. */
function ground(bmClaims: unknown[], supporting: unknown[] = [], value = "b2b_saas") {
  const result = parseGroundedResult({
    business_model: { value, confidence: 0.9, claims: bmClaims },
    company_fit: "review", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
    supporting_claims: supporting, conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [],
    confidence: 0.9, reason: "",
  });
  return verifyGroundedResult({ registry: REGISTRY, result });
}

const reasons = (v: ReturnType<typeof ground>) => v.rejected_claims.map((r) => `${r.claim_type}:${r.reason}`);

// ── THE FIXTURE IS THE PRODUCTION SHAPE ─────────────────────────────────────

Deno.test("fixture: fetched first-party pages enter the registry as verified, current `web_page` items", () => {
  const pages = REGISTRY.items.filter((i) => i.evidence_type === "web_page");
  assertEquals(pages.map((p) => [p.source, p.verification_state, p.freshness]),
    [["company_website", "verified", "current"], ["company_website", "verified", "current"]]);
  assertEquals(pages.map((p) => p.source_url), ["https://comfy.org/platform", "https://comfy.org/pricing"]);
});

// ── THE FIX ─────────────────────────────────────────────────────────────────

Deno.test("ComfyUI: a business-model claim quoting its own /pricing page is validated, not refused", () => {
  const v = ground([claim("business_model", "pricing", "a cloud-based workspace for businesses, billed per seat")]);
  assertEquals(reasons(v), [], "production: web_page cannot support a business_model claim");
  assertEquals(v.validated_claims.map((c) => c.claim_type), ["business_model"]);
  assertEquals(v.grounding_score, 1);
});

Deno.test("ComfyUI: the page's quote states every b2b_saas facet, so the business model is ACCEPTED", () => {
  const d = businessModelDecision(ground([claim("business_model", "pricing", "a cloud-based workspace for businesses, billed per seat")]));
  assertEquals(d.decision, "accepted", d.reasons.join(", "));
  assertEquals(d.reasons, []);
});

Deno.test("customer_type and product_type claims may quote the site's pages, and their facets count", () => {
  // The business-model quote alone names no customer; /platform and /pricing
  // supply WHO buys and WHAT it is — each its own validated claim.
  const v = ground(
    [claim("business_model", "product", "Comfy Cloud runs your ComfyUI workflows on cloud GPUs")],
    [
      claim("customer_type", "pricing", "Enterprise plans for companies"),
      claim("product_type", "pricing", "billed per seat each month"),
      claim("company_fit", "product", "Built for creative teams and studios."),
      claim("agentory_use_case", "product", "runs your ComfyUI workflows"),
    ],
  );
  assertEquals(reasons(v), []);
  assertEquals(v.validated_claims.length, 5);
  const d = businessModelDecision(v);
  assertEquals(d.decision, "accepted", d.reasons.join(", "));
  // Without them, the same business-model quote does not stand alone (below).
  assertEquals(businessModelDecision(ground([v.validated_claims[0]])).decision, "review");
});

// ── THE BAR DOES NOT MOVE ───────────────────────────────────────────────────

Deno.test("a page is still no hiring signal and no timing: commercial_signal / timing citing it are refused", () => {
  const v = ground([], [
    claim("commercial_signal", "pricing", "Enterprise plans for companies", "Actively selling to enterprises now."),
    claim("timing", "product", "Comfy Cloud runs your ComfyUI workflows"),
  ]);
  assertEquals(reasons(v), ["commercial_signal:unsupported_evidence_type", "timing:unsupported_evidence_type"]);
  assert(v.rejected_claims.every((r) => /^web_page cannot support a (commercial_signal|timing) claim$/.test(r.detail)));
});

Deno.test("a quote that is not on the page is still rejected, and the business model stays in review", () => {
  const v = ground([claim("business_model", "pricing", "the leading B2B SaaS platform for enterprises")]);
  assertEquals(reasons(v), ["business_model:excerpt_not_found"]);
  const d = businessModelDecision(v);
  assertEquals(d.decision, "review");
  assert(d.reasons.includes("business_model_claim_rejected:excerpt_not_found"), d.reasons.join(", "));
});

Deno.test("a page quote that does not STATE the facets proves nothing it does not say", () => {
  // Real, present, first-party — and silent on who pays and how it is sold.
  const d = businessModelDecision(ground([claim("business_model", "product", "Comfy Cloud runs your ComfyUI workflows on cloud GPUs")]));
  assertEquals(d.decision, "review");
  assert(d.reasons.some((r) => r.startsWith("quote_does_not_state_")), d.reasons.join(", "));
});

Deno.test("the industry label is still context only: it may ride beside a page, never stand alone", () => {
  const industry = REGISTRY.items.find((i) => i.evidence_type === "company_industry")!;
  const c = claim("business_model", "pricing", "billed per seat");
  const v = ground([{ ...c, evidence_ids: [...c.evidence_ids, industry.evidence_id] }]);
  assertEquals(v.validated_claims.length, 1, "the page carries the claim; the label is context beside it");
  const alone = ground([{ claim: "x", claim_type: "business_model", evidence_ids: [industry.evidence_id], evidence_excerpts: [] }]);
  assertEquals(reasons(alone), ["business_model:unsupported_evidence_type"], "industry alone is never sole proof");
});

// ── THE TABLE AND THE PROMPT AGREE ──────────────────────────────────────────

Deno.test("rules: `web_page` is allowed exactly where `company_website` is, and never as context only", () => {
  for (const t of CLAIM_TYPES) {
    const r = CLAIM_EVIDENCE_RULES[t];
    assertEquals(r.allowed.includes("web_page"), r.allowed.includes("company_website"), t);
    assert(!r.contextual_only.includes("web_page"), t);
  }
  assertEquals(CLAIM_TYPES.filter((t) => !CLAIM_EVIDENCE_RULES[t].allowed.includes("web_page")).sort(),
    ["commercial_signal", "timing"]);
});

Deno.test("prompt: the classifier is told it may cite the pages for the claims that accept them", () => {
  const p = buildGroundedClassifierPayload({ registry: REGISTRY, originalUserQuery: null });
  const rules = p.claim_evidence_rules as Record<string, { may_cite: string[] }>;
  for (const t of ["business_model", "customer_type", "product_type", "company_fit", "agentory_use_case"]) {
    assert(rules[t].may_cite.includes("web_page"), t);
  }
  assert(!rules.commercial_signal.may_cite.includes("web_page"));
  assert(!rules.timing.may_cite.includes("web_page"));
  assertEquals((p.evidence as Array<{ evidence_type: string }>).filter((e) => e.evidence_type === "web_page").length, 2);
});
