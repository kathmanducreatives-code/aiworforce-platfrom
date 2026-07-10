// Company website research (Onboarding v3, Step 2) — Firecrawl.
//
// Scrapes the homepage, maps the site, and crawls a SMALL, prioritised set of
// high-signal pages (/about, /pricing, /customers, …). Hard-capped at
// MAX_PAGES — never a broad web crawl, never bulk scraping. Every extracted
// claim records the page it came from in `source_pages`; anything we could not
// read lands in `missing_evidence` rather than being silently invented.
//
// `selectPages` + `extractFromPages` are pure → fixture-tested, no network.

import {
  type CompanyWebsiteResearch, type FirecrawlPage, type ResearchDeps,
  asString, uniq, confidenceFrom, isHttpUrl,
} from "./types.ts";

/** Hard ceiling on pages fetched during onboarding (spec: 8–12). */
export const MAX_PAGES = 10;

/** Highest-signal paths first — the crawl budget is spent in this order. */
export const PRIORITY_PATHS: Array<{ re: RegExp; label: string }> = [
  { re: /\/about/i, label: "about" },
  { re: /\/pricing/i, label: "pricing" },
  { re: /\/customers?/i, label: "customers" },
  { re: /\/case-stud(y|ies)/i, label: "case-studies" },
  { re: /\/features?/i, label: "features" },
  { re: /\/solutions?/i, label: "solutions" },
  { re: /\/integrations?/i, label: "integrations" },
  { re: /\/blog/i, label: "blog" },
  { re: /\/careers?|\/jobs/i, label: "careers" },
];

function sameHost(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb;
  } catch { return false; }
}

/**
 * Choose which URLs to crawl: homepage first, then priority paths in order,
 * then nothing else. Off-host links are dropped (no broad web crawl).
 */
export function selectPages(homepage: string, mapped: string[], max = MAX_PAGES): string[] {
  const out: string[] = [];
  const push = (u: string) => { if (u && !out.includes(u) && out.length < max) out.push(u); };
  push(homepage);
  const onHost = mapped.filter((u) => isHttpUrl(u) && sameHost(u, homepage));
  for (const { re } of PRIORITY_PATHS) {
    for (const u of onHost) {
      if (out.length >= max) return out;
      if (re.test(u)) push(u);
    }
  }
  return out;
}

function pathLabel(url: string): string {
  for (const { re, label } of PRIORITY_PATHS) if (re.test(url)) return label;
  return "homepage";
}

const BUSINESS_MODEL_RE = /\b(b2b saas|saas|b2b|b2c|marketplace|api|open source|self-serve|enterprise|subscription|usage-based)\b/i;
const PRICING_RE = /\$\s?\d|\bper (?:month|seat|user)\b|\/mo\b|\bfree trial\b|\bpricing\b|\bstarts at\b/i;
const INTEGRATION_RE = /\bintegrat(?:es|ion)s? with\b|\bconnects? to\b/i;
const PROOF_RE = /\b\d+(?:\.\d+)?\s?(?:x|%|hours?|customers?|users?|teams?)\b/i;
const HIRING_RE = /\b(we'?re hiring|open roles?|join (?:the|our) team|careers)\b/i;

function sentences(md: string): string[] {
  return md.replace(/[#*>`\-]/g, " ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 240);
}

/** Extract structured company facts from already-fetched pages. Pure. */
export function extractFromPages(
  pages: FirecrawlPage[],
  input: { websiteUrl: string; nameHint?: string; descriptionHint?: string },
): CompanyWebsiteResearch {
  const source_pages = uniq(pages.map((p) => p.url).filter(Boolean));
  const home = pages[0];
  const allText = pages.map((p) => asString(p.markdown)).join("\n");
  const byLabel = (label: string) => pages.filter((p) => pathLabel(p.url) === label);

  const company_name = asString(input.nameHint) || asString(home?.title).split(/[|\-–—]/)[0].trim();
  const description = asString(input.descriptionHint) || asString(home?.description) || sentences(asString(home?.markdown))[0] || "";

  const bmMatch = allText.match(BUSINESS_MODEL_RE);
  const business_model = bmMatch ? bmMatch[0] : "";

  const pricingPages = byLabel("pricing");
  const pricing_signal = pricingPages.length
    ? (sentences(asString(pricingPages[0].markdown)).find((s) => PRICING_RE.test(s)) ?? "pricing page present")
    : "";

  const features = uniq(byLabel("features").concat(byLabel("solutions")).flatMap((p) => sentences(asString(p.markdown)).slice(0, 6)));
  const use_cases = uniq(byLabel("solutions").concat(byLabel("case-studies")).flatMap((p) => sentences(asString(p.markdown)).slice(0, 4)));
  const customers_or_segments = uniq(byLabel("customers").concat(byLabel("case-studies")).flatMap((p) => sentences(asString(p.markdown)).slice(0, 4)));
  const integrations = uniq(sentences(allText).filter((s) => INTEGRATION_RE.test(s)).slice(0, 6));
  const positioning_claims = uniq(sentences(asString(home?.markdown)).slice(0, 4));
  const proof_points = uniq(sentences(allText).filter((s) => PROOF_RE.test(s)).slice(0, 6));
  const careers_signal = uniq(byLabel("careers").flatMap((p) => sentences(asString(p.markdown)).filter((s) => HIRING_RE.test(s)).slice(0, 4)));

  const missing_evidence: string[] = [];
  if (!pricingPages.length) missing_evidence.push("pricing page");
  if (!byLabel("customers").length && !byLabel("case-studies").length) missing_evidence.push("customer / case-study proof");
  if (!byLabel("about").length) missing_evidence.push("about page");
  if (!business_model) missing_evidence.push("business model");
  if (!description) missing_evidence.push("company description");

  const signals = [company_name, description, business_model, pricing_signal].filter(Boolean).length
    + (features.length ? 1 : 0) + (customers_or_segments.length ? 1 : 0)
    + (proof_points.length ? 1 : 0) + (integrations.length ? 1 : 0);

  return {
    company_name,
    website: input.websiteUrl,
    description,
    // Category is an inference, not a read fact — left to the AI draft step with evidence.
    product_category: "",
    business_model,
    target_users_guess: [],
    features, use_cases, pricing_signal, customers_or_segments, integrations,
    positioning_claims, proof_points, careers_signal,
    source_pages,
    confidence: confidenceFrom(signals, missing_evidence.length),
    missing_evidence,
  };
}

export interface CompanyWebsiteResult {
  ok: boolean;
  research: CompanyWebsiteResearch | null;
  pages_fetched: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * Research a company from its website. Homepage + up to MAX_PAGES prioritised
 * on-host pages. No provider call happens without `deps.firecrawlScrape`.
 */
export async function enrichCompanyFromWebsite(
  input: { websiteUrl: string; nameHint?: string; descriptionHint?: string; maxPages?: number },
  deps: ResearchDeps,
): Promise<CompanyWebsiteResult> {
  if (!isHttpUrl(input.websiteUrl)) {
    return { ok: false, research: null, pages_fetched: 0, skipped: true, reason: "invalid_website_url" };
  }
  if (!deps.firecrawlScrape) {
    return { ok: false, research: null, pages_fetched: 0, skipped: true, reason: "firecrawl_not_configured" };
  }
  const cap = Math.max(1, Math.min(MAX_PAGES, input.maxPages ?? MAX_PAGES));

  try {
    const mapped = deps.firecrawlMap ? await deps.firecrawlMap(input.websiteUrl).catch(() => []) : [];
    const urls = selectPages(input.websiteUrl, mapped, cap);

    const pages: FirecrawlPage[] = [];
    for (const u of urls) {
      if (pages.length >= cap) break; // hard cap, defence in depth
      const p = await deps.firecrawlScrape(u).catch(() => null);
      if (p) pages.push(p);
    }
    if (!pages.length) return { ok: false, research: null, pages_fetched: 0, error: "no_pages_fetched" };

    return { ok: true, research: extractFromPages(pages, input), pages_fetched: pages.length };
  } catch (e) {
    return { ok: false, research: null, pages_fetched: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
