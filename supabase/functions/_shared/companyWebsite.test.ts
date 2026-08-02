// Company website (Firecrawl) adapter — fixture tests. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { selectPages, extractFromPages, enrichCompanyFromWebsite, MAX_PAGES } from "./companyWebsite.ts";
import {
  HOME, FIXTURE_A_CLEAN_SAAS, FIXTURE_C_RECRUITING_NOISE, FIXTURE_F_SPARSE,
  FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION,
} from "./testFixtures.ts";

const mapped = [
  `${HOME}/about`, `${HOME}/pricing`, `${HOME}/customers`, `${HOME}/blog`, `${HOME}/careers`,
  `${HOME}/random-deep-page`,
  "https://twitter.com/cekura",          // off-host → dropped
  "https://docs.other.com/integrations", // off-host → dropped
];

const research = (pages: typeof FIXTURE_A_CLEAN_SAAS, desc?: string) =>
  extractFromPages(pages, { websiteUrl: HOME, nameHint: "Cekura", descriptionHint: desc });

Deno.test("1. selectPages: homepage first, product-defining priority, off-host dropped", () => {
  const urls = selectPages(HOME, mapped, MAX_PAGES);
  assertEquals(urls[0], HOME);
  // v3 order: product pages define the company, so pricing outranks about,
  // about outranks customers, and blog earns no budget at all.
  assert(urls.indexOf(`${HOME}/pricing`) < urls.indexOf(`${HOME}/about`), "pricing before about");
  assert(urls.indexOf(`${HOME}/about`) < urls.indexOf(`${HOME}/customers`), "about before customers");
  assert(!urls.includes(`${HOME}/blog`), "blog never spends crawl budget");
  assert(!urls.some((u) => u.includes("twitter.com")), "no off-host crawl");
  assert(!urls.some((u) => u.includes("other.com")), "no broad web crawl");
});

Deno.test("2. selectPages respects the hard page cap", () => {
  const many = Array.from({ length: 50 }, (_, i) => `${HOME}/features/${i}`);
  const urls = selectPages(HOME, many, MAX_PAGES);
  assert(urls.length <= MAX_PAGES, `got ${urls.length}`);
  assert(MAX_PAGES >= 8 && MAX_PAGES <= 12, "cap must stay in the 8–12 band");
});

Deno.test("3. clean SaaS site → grounded facts, real source pages", () => {
  const r = research(FIXTURE_A_CLEAN_SAAS);
  assertEquals(r.website, HOME);
  assertEquals(r.source_pages.length, FIXTURE_A_CLEAN_SAAS.length);
  assertEquals(r.product_category, "sales software");
  assertEquals(r.business_model, "B2B SaaS");
  assert(/\$99|per month/i.test(r.pricing_signal));
  assert(r.proof_points.some((p) => /3x/.test(p)));
  assertEquals(r.ambiguous, false);
});

Deno.test("4. noisy proof points never define the product category", () => {
  const r = research(FIXTURE_C_RECRUITING_NOISE);
  assertEquals(r.product_category, "revenue operations software");
  assert(!/recruit/i.test(r.product_category));
});

Deno.test("5. careers content becomes a hiring signal, not an ICP input", () => {
  const r = research(FIXTURE_C_RECRUITING_NOISE);
  assert(r.careers_signal.length > 0, "hiring signal captured");
  assert(!r.target_users_guess.some((u) => /engineer|sales/i.test(u)) || r.product_category !== "");
  const careers = r.evidence.find((e) => e.page_type === "careers")!;
  assertEquals(careers.used_for, ["careers_signal"]);
});

Deno.test("6. user description corrects an ambiguous scrape", () => {
  const bad = research(FIXTURE_E_USER_BEATS_SITE);
  assertEquals(bad.product_category, "");
  assertEquals(bad.ambiguous, true);

  const good = research(FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION);
  assertEquals(good.product_category, "revenue operations software");
  assertEquals(good.description, FIXTURE_E_USER_DESCRIPTION);
});

Deno.test("7. sparse site → missing_evidence, no invented proof or pricing", () => {
  const r = research(FIXTURE_F_SPARSE);
  assert(r.missing_evidence.includes("pricing page"));
  assert(r.missing_evidence.includes("customer / case-study proof"));
  assertEquals(r.pricing_signal, "");
  assertEquals(r.proof_points, []);
  assertEquals(r.confidence, "low");
});

Deno.test("8. research carries display-ready evidence and the understanding pass", () => {
  const r = research(FIXTURE_A_CLEAN_SAAS);
  assert(r.evidence.length > 0);
  assert(r.understanding.product_category === r.product_category);
  assertEquals(r.needs_confirmation.includes("product_category"), false);
  for (const e of r.evidence) assert(e.reason.length > 10);
});

Deno.test("9. unconfigured Firecrawl → honest skip, no throw, no fetch", async () => {
  const r = await enrichCompanyFromWebsite({ websiteUrl: HOME }, {});
  assertEquals(r.ok, false);
  assertEquals(r.reason, "firecrawl_not_configured");
  assertEquals(r.pages_fetched, 0);
});

Deno.test("10. invalid website URL → skipped before any provider call", async () => {
  let called = false;
  const r = await enrichCompanyFromWebsite(
    { websiteUrl: "cekura" },
    { firecrawlScrape: async () => { called = true; return null; } },
  );
  assertEquals(r.reason, "invalid_website_url");
  assertEquals(called, false);
});

Deno.test("11. stubbed crawl never exceeds the cap", async () => {
  let fetched = 0;
  const many = Array.from({ length: 40 }, (_, i) => `${HOME}/features/${i}`);
  const r = await enrichCompanyFromWebsite({ websiteUrl: HOME, maxPages: MAX_PAGES }, {
    firecrawlMap: async () => many,
    firecrawlScrape: async (url) => { fetched++; return { url, markdown: "content about our b2b saas platform" }; },
  });
  assertEquals(r.ok, true);
  assert(fetched <= MAX_PAGES, `fetched ${fetched} pages, cap is ${MAX_PAGES}`);
  assertEquals(r.pages_fetched, fetched);
});
