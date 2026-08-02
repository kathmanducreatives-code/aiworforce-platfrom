// Company understanding pass + page classification. Fixtures only, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyPage, isProductDefining, strongPageCount, ignoredUses } from "../../../supabase/functions/_shared/companyBrainResearch/pageClassifier.ts";
import { buildCompanyUnderstanding } from "../../../supabase/functions/_shared/companyBrainResearch/companyUnderstanding.ts";
import {
  HOME, FIXTURE_A_CLEAN_SAAS, FIXTURE_B_AMBIGUOUS, FIXTURE_C_RECRUITING_NOISE,
  FIXTURE_D_WEBSITE_ONLY, FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION, FIXTURE_F_SPARSE,
} from "../../../supabase/functions/_shared/companyBrainResearch/testFixtures.ts";

const u = (pages: typeof FIXTURE_A_CLEAN_SAAS, desc?: string) =>
  buildCompanyUnderstanding(pages, { websiteUrl: HOME, nameHint: "Cekura", descriptionHint: desc });

// ------------------------------------------------------------ classification -

Deno.test("classifier: every page type is recognised from its path", () => {
  const t = (path: string) => classifyPage({ url: `${HOME}${path}`, markdown: "" }, HOME);
  assertEquals(classifyPage({ url: HOME, markdown: "" }, HOME), "homepage");
  assertEquals(t("/pricing"), "pricing");
  assertEquals(t("/features"), "features");
  assertEquals(t("/solutions"), "use_cases");
  assertEquals(t("/customers"), "customers");
  assertEquals(t("/case-studies/globex"), "case_study");
  assertEquals(t("/about"), "about");
  assertEquals(t("/blog/some-post"), "blog");
  assertEquals(t("/careers"), "careers");
  assertEquals(t("/docs/api"), "docs");
  assertEquals(t("/random-thing"), "unrelated");
});

Deno.test("classifier: a blog post about pricing is still a blog, not a pricing page", () => {
  assertEquals(classifyPage({ url: `${HOME}/blog/pricing-guide`, markdown: "starts at $99 per month" }, HOME), "blog");
});

Deno.test("classifier: product-defining tiers and ignored uses are explicit", () => {
  assert(isProductDefining("homepage") && isProductDefining("features") && isProductDefining("pricing"));
  assert(!isProductDefining("blog") && !isProductDefining("careers") && !isProductDefining("case_study"));
  assertEquals(strongPageCount(["homepage", "features", "blog", "careers"]), 2);
  // A blog may never inform the product category.
  assert(ignoredUses("blog").includes("product_category"));
  assert(ignoredUses("careers").includes("product_category"));
  assert(ignoredUses("case_study").includes("product_category"));
});

// ------------------------------------------------ A. clean B2B SaaS website --

Deno.test("A. clean SaaS site → grounded category, business model, pricing, proof", () => {
  const r = u(FIXTURE_A_CLEAN_SAAS);
  assertEquals(r.product_category, "sales software");
  assertEquals(r.business_model, "B2B SaaS");
  assert(/\$99|per month/i.test(r.pricing_signal), r.pricing_signal);
  assert(r.proof_points.some((p) => /3x/.test(p)), "numeric proof read from homepage/customers");
  assert(r.integrations.some((i) => /HubSpot/i.test(i)), "explicit 'integrates with' only");
  assertEquals(r.ambiguous, false);
});

Deno.test("A. proof points never come from a blog, and are always numeric", () => {
  const r = u(FIXTURE_A_CLEAN_SAAS);
  for (const p of r.proof_points) {
    assert(/\d/.test(p), `proof must contain a number: ${p}`);
  }
  // "Trusted by teams" style claims (no number) never qualify.
  const noNumber = u([{ url: HOME, title: "X", markdown: "Trusted by teams everywhere to do great work today." }]);
  assertEquals(noNumber.proof_points, []);
});

// ------------------------------------- B/C. noise must not define the product -

Deno.test("C. one recruiting blog post does NOT make a RevOps company 'recruiting'", () => {
  const r = u(FIXTURE_C_RECRUITING_NOISE);
  assertEquals(r.product_category, "revenue operations software");
  assert(!/recruit/i.test(r.product_category), "blog topic must not become the category");
});

Deno.test("C. careers page yields hiring signals only — never ICP or product", () => {
  const r = u(FIXTURE_C_RECRUITING_NOISE);
  const careers = r.evidence.find((e) => e.page_type === "careers")!;
  assertEquals(careers.used_for, ["careers_signal"]);
  assert(careers.ignored_for.includes("product_category"));
  assert(careers.ignored_for.includes("primary_users"));
});

Deno.test("B. ambiguous site (thin homepage, contradicting blog/case-study) → ambiguous, no category", () => {
  const r = u(FIXTURE_B_AMBIGUOUS);
  assertEquals(r.ambiguous, true);
  assertEquals(r.product_category, "", "never commit to a category from a blog alone");
  assertEquals(r.confidence, "low");
  assert(r.needs_confirmation.includes("product_category"));
});

Deno.test("B. a case study about a staffing agency does not make US a staffing agency", () => {
  const r = u(FIXTURE_B_AMBIGUOUS);
  assert(!/staffing/i.test(r.product_category));
  const cs = r.evidence.find((e) => e.page_type === "case_study")!;
  assert(cs.ignored_for.includes("product_category"));
});

// ------------------------------------ E. user description corrects a bad site -

Deno.test("E. user description outweighs a noisy site and fixes the category", () => {
  const noDesc = u(FIXTURE_E_USER_BEATS_SITE);
  assertEquals(noDesc.product_category, "", "noisy site alone commits to nothing");

  const withDesc = u(FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION);
  assertEquals(withDesc.product_category, "revenue operations software");
  assertEquals(withDesc.one_line_summary, FIXTURE_E_USER_DESCRIPTION);
  assert(!/recruit/i.test(withDesc.product_category), "blog must not win over the founder");
});

// ---------------------------------------------- D/F. thin evidence discipline -

Deno.test("D. website-only (no LinkedIn) still yields a grounded understanding", () => {
  const r = u(FIXTURE_D_WEBSITE_ONLY);
  assertEquals(r.product_category, "data enrichment");
  assertEquals(r.business_model, "B2B SaaS");
  assert(r.integrations.some((i) => /Clay/i.test(i)));
});

Deno.test("F. sparse homepage-only site → low confidence, ambiguous, nothing invented", () => {
  const r = u(FIXTURE_F_SPARSE);
  assertEquals(r.confidence, "low");
  assertEquals(r.ambiguous, true);
  assertEquals(r.product_category, "");
  assertEquals(r.proof_points, []);
  assertEquals(r.integrations, []);
  assert(r.missing_evidence.includes("pricing page"));
  assert(r.missing_evidence.includes("product category"));
});

Deno.test("high confidence is impossible with weak evidence", () => {
  for (const fx of [FIXTURE_F_SPARSE, FIXTURE_B_AMBIGUOUS, FIXTURE_E_USER_BEATS_SITE]) {
    assert(u(fx).confidence !== "high", "thin/ambiguous evidence can never read as high");
  }
  // Even the clean site is capped below "high" while pieces are missing.
  const clean = u(FIXTURE_A_CLEAN_SAAS);
  if (clean.missing_evidence.length > 0) assert(clean.confidence !== "high");
});

Deno.test("homepage alone can never reach high confidence", () => {
  const r = u([FIXTURE_A_CLEAN_SAAS[0]]);
  assert(r.confidence !== "high");
});

// -------------------------------------------------- display-ready evidence ---

Deno.test("evidence cards are display-ready: url, type, facts, used_for, ignored_for, reason", () => {
  const r = u(FIXTURE_A_CLEAN_SAAS);
  assert(r.evidence.length === FIXTURE_A_CLEAN_SAAS.length);
  for (const e of r.evidence) {
    assert(e.source_url.startsWith("http"));
    assert(e.page_type.length > 0);
    assert(Array.isArray(e.extracted_facts));
    assert(Array.isArray(e.used_for));
    assert(Array.isArray(e.ignored_for));
    assert(e.reason.length > 10, "every card explains why it was trusted or ignored");
    assert(!e.used_for.some((f) => e.ignored_for.includes(f)), "used_for and ignored_for are disjoint");
  }
  // Ranked: the homepage leads.
  assertEquals(r.evidence[0].page_type, "homepage");
});
