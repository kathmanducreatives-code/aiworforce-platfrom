// Website page classification (Research Quality v2).
//
// Firecrawl hands us a pile of pages. Not all pages are equal: a homepage hero
// defines the product; a customer case-study is *about someone else*; a blog
// post is often about a topic the company merely writes about; a careers page
// describes hiring, not the ICP.
//
// Extracting facts uniformly across those is exactly how a B2B SaaS company
// gets classified as "Recruiting" because it published one hiring article.
// So we classify first, then let only the right tiers feed the right fields.
//
// Pure. No network.

import { asString, uniq, type PageType, type FirecrawlPage } from "./types.ts";

/** Path patterns, most specific first (a `/blog/pricing-guide` is a blog). */
const PATH_RULES: Array<{ re: RegExp; type: PageType }> = [
  { re: /\/(blog|news|articles?|resources|insights|guides?)(\/|$)/i, type: "blog" },
  { re: /\/(careers?|jobs?|hiring|join-us|work-with-us)(\/|$)/i, type: "careers" },
  { re: /\/(docs?|documentation|developers?|api|reference|changelog)(\/|$)/i, type: "docs" },
  { re: /\/(case-stud(y|ies)|success-stor(y|ies))(\/|$)/i, type: "case_study" },
  { re: /\/(customers?|clients?|testimonials?)(\/|$)/i, type: "customers" },
  { re: /\/(pricing|plans)(\/|$)/i, type: "pricing" },
  { re: /\/(use-cases?|solutions?|for-[a-z-]+)(\/|$)/i, type: "use_cases" },
  { re: /\/(features?|product|platform|how-it-works|integrations?)(\/|$)/i, type: "features" },
  { re: /\/(about|company|team|our-story|mission)(\/|$)/i, type: "about" },
];

/** Title/body hints, used only when the path is uninformative. */
const CONTENT_RULES: Array<{ re: RegExp; type: PageType }> = [
  { re: /\b(pricing|per month|per seat|free trial|starts at)\b/i, type: "pricing" },
  { re: /\b(we'?re hiring|open roles?|join our team)\b/i, type: "careers" },
  { re: /\b(case study|success story)\b/i, type: "case_study" },
  { re: /\b(posted on|read more|min read|by [A-Z][a-z]+ [A-Z])\b/, type: "blog" },
];

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function isRoot(url: string): boolean {
  const p = pathOf(url).replace(/\/+$/, "");
  return p === "" || p === "/";
}

/** Classify one page. The homepage is decided by URL, never by content. */
export function classifyPage(page: FirecrawlPage, homepage?: string): PageType {
  const url = asString(page.url);
  if (!url) return "unrelated";
  if (isRoot(url) || (homepage && url.replace(/\/+$/, "") === homepage.replace(/\/+$/, ""))) return "homepage";

  const path = pathOf(url);
  for (const { re, type } of PATH_RULES) if (re.test(path)) return type;

  const blob = `${asString(page.title)} ${asString(page.markdown).slice(0, 600)}`;
  for (const { re, type } of CONTENT_RULES) if (re.test(blob)) return type;

  return "unrelated";
}

// ---------------------------------------------------------------- tiers -----

/**
 * PRODUCT_DEFINING pages state what the company *is*. Only these may set the
 * one-line summary, product category, business model and key features.
 */
export const PRODUCT_DEFINING: PageType[] = ["homepage", "features", "use_cases", "pricing", "about"];

/** SUPPORTING pages may contribute proof and customer segments — never the category. */
export const SUPPORTING: PageType[] = ["customers", "case_study"];

/** NOISE pages never define the product. Careers only yields hiring signals. */
export const NOISE: PageType[] = ["blog", "careers", "docs", "unrelated"];

/** Ordering used to spend the crawl budget and to rank evidence. */
export const PAGE_PRIORITY: Record<PageType, number> = {
  homepage: 100, features: 90, pricing: 80, use_cases: 75, about: 70,
  customers: 50, case_study: 45,
  docs: 20, blog: 15, careers: 10, unrelated: 0,
};

export const isProductDefining = (t: PageType): boolean => PRODUCT_DEFINING.includes(t);
export const isSupporting = (t: PageType): boolean => SUPPORTING.includes(t);
export const isNoise = (t: PageType): boolean => NOISE.includes(t);

/** What a page type is allowed to inform. Drives `used_for` / `ignored_for`. */
export const ALLOWED_USES: Record<PageType, string[]> = {
  homepage: ["one_line_summary", "product_category", "business_model", "main_promise", "key_features", "proof_points"],
  features: ["product_category", "key_features", "primary_use_cases", "integrations", "business_model"],
  use_cases: ["primary_use_cases", "primary_users", "key_features"],
  pricing: ["pricing_signal", "business_model"],
  about: ["one_line_summary", "primary_users", "main_promise"],
  customers: ["customers_or_segments", "proof_points", "primary_users"],
  case_study: ["customers_or_segments", "proof_points"],
  blog: ["content_angles"],
  careers: ["careers_signal"],
  docs: ["integrations"],
  unrelated: [],
};

/** Everything a page type must NOT inform (for the evidence card's `ignored_for`). */
const ALL_FIELDS = [
  "one_line_summary", "product_category", "business_model", "main_promise",
  "key_features", "primary_use_cases", "primary_users", "pricing_signal",
  "proof_points", "integrations", "customers_or_segments", "careers_signal", "content_angles",
];

export function ignoredUses(t: PageType): string[] {
  const allowed = new Set(ALLOWED_USES[t] ?? []);
  return ALL_FIELDS.filter((f) => !allowed.has(f));
}

/** Sort pages by how much they define the product. Stable. */
export function rankPages<T extends { page_type: PageType }>(pages: T[]): T[] {
  return [...pages].sort((a, b) => (PAGE_PRIORITY[b.page_type] ?? 0) - (PAGE_PRIORITY[a.page_type] ?? 0));
}

/** Count of distinct product-defining pages actually read. */
export function strongPageCount(types: PageType[]): number {
  return uniq(types.filter(isProductDefining)).length;
}
