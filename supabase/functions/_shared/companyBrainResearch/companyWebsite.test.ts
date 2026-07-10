// Company website (Firecrawl) adapter — fixture tests. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectPages, extractFromPages, enrichCompanyFromWebsite, MAX_PAGES,
} from "./companyWebsite.ts";
import type { FirecrawlPage } from "./types.ts";

const HOME = "https://cekura.ai";

const mapped = [
  "https://cekura.ai/about",
  "https://cekura.ai/pricing",
  "https://cekura.ai/customers",
  "https://cekura.ai/blog",
  "https://cekura.ai/careers",
  "https://cekura.ai/random-deep-page",
  "https://twitter.com/cekura",       // off-host → must be dropped
  "https://docs.other.com/integrations",
];

Deno.test("1. selectPages: homepage first, priority order, off-host dropped", () => {
  const urls = selectPages(HOME, mapped, MAX_PAGES);
  assertEquals(urls[0], HOME);
  assertEquals(urls[1], "https://cekura.ai/about");
  assertEquals(urls[2], "https://cekura.ai/pricing");
  assert(!urls.some((u) => u.includes("twitter.com")), "no off-host crawl");
  assert(!urls.some((u) => u.includes("other.com")), "no broad web crawl");
});

Deno.test("2. selectPages respects the hard page cap", () => {
  const many = Array.from({ length: 50 }, (_, i) => `https://cekura.ai/features/${i}`);
  const urls = selectPages(HOME, many, MAX_PAGES);
  assert(urls.length <= MAX_PAGES, `got ${urls.length}`);
  assert(MAX_PAGES >= 8 && MAX_PAGES <= 12, "cap must stay in the 8–12 band");
});

const pages: FirecrawlPage[] = [
  { url: HOME, title: "Cekura | AI SaaS for revenue teams", description: "Pipeline before payroll.", markdown: "Cekura is a B2B SaaS platform that helps founders build pipeline without hiring an SDR team." },
  { url: "https://cekura.ai/about", title: "About", markdown: "We started Cekura in 2024 to fix founder-led sales." },
  { url: "https://cekura.ai/pricing", title: "Pricing", markdown: "Simple pricing. Starts at $99 per month for the growth plan, billed annually." },
  { url: "https://cekura.ai/customers", title: "Customers", markdown: "Teams like Acme and Globex cut research time by 3x using Cekura every week." },
];

Deno.test("3. extractFromPages pulls real facts and records source pages", () => {
  const r = extractFromPages(pages, { websiteUrl: HOME });
  assertEquals(r.website, HOME);
  assertEquals(r.source_pages.length, 4);
  assert(/b2b saas|saas/i.test(r.business_model), `business_model: ${r.business_model}`);
  assert(/\$99|per month/i.test(r.pricing_signal), `pricing: ${r.pricing_signal}`);
  assert(r.proof_points.some((p) => /3x/.test(p)), "proof point read from a real page");
  assertEquals(r.confidence === "low", false);
});

Deno.test("4. missing pages become missing_evidence — never invented proof", () => {
  const onlyHome = extractFromPages([pages[0]], { websiteUrl: HOME });
  assert(onlyHome.missing_evidence.includes("pricing page"));
  assert(onlyHome.missing_evidence.includes("customer / case-study proof"));
  assertEquals(onlyHome.pricing_signal, "", "no pricing page → no pricing claim");
  assertEquals(onlyHome.proof_points.length, 0, "no proof invented");
  assertEquals(onlyHome.confidence, "low");
});

Deno.test("5. product_category is never fabricated by the scraper", () => {
  const r = extractFromPages(pages, { websiteUrl: HOME });
  assertEquals(r.product_category, "", "category is an inference for the AI step, with evidence");
  assertEquals(r.target_users_guess, []);
});

Deno.test("6. unconfigured Firecrawl → honest skip, no throw, no fetch", async () => {
  const r = await enrichCompanyFromWebsite({ websiteUrl: HOME }, {});
  assertEquals(r.ok, false);
  assertEquals(r.reason, "firecrawl_not_configured");
  assertEquals(r.pages_fetched, 0);
});

Deno.test("7. invalid website URL → skipped before any provider call", async () => {
  let called = false;
  const r = await enrichCompanyFromWebsite(
    { websiteUrl: "cekura" },
    { firecrawlScrape: async () => { called = true; return null; } },
  );
  assertEquals(r.reason, "invalid_website_url");
  assertEquals(called, false);
});

Deno.test("8. stubbed crawl never exceeds the cap", async () => {
  let fetched = 0;
  const many = Array.from({ length: 40 }, (_, i) => `https://cekura.ai/features/${i}`);
  const r = await enrichCompanyFromWebsite({ websiteUrl: HOME, maxPages: MAX_PAGES }, {
    firecrawlMap: async () => many,
    firecrawlScrape: async (url) => { fetched++; return { url, markdown: "content about our b2b saas platform" }; },
  });
  assertEquals(r.ok, true);
  assert(fetched <= MAX_PAGES, `fetched ${fetched} pages, cap is ${MAX_PAGES}`);
  assertEquals(r.pages_fetched, fetched);
});
