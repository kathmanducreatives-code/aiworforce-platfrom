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
  type CompanyWebsiteResearch, type CompanyUnderstanding, type FirecrawlPage, type ResearchDeps,
  isHttpUrl,
} from "./types.ts";
import { buildCompanyUnderstanding } from "./companyUnderstanding.ts";

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

/**
 * Extract structured company facts from already-fetched pages.
 *
 * Delegates the hard part to `buildCompanyUnderstanding`, which classifies each
 * page and only lets the right page types inform the right fields. This is what
 * stops a blog post or a customer story from defining the product.
 *
 * Pure — no network.
 */
export function extractFromPages(
  pages: FirecrawlPage[],
  input: { websiteUrl: string; nameHint?: string; descriptionHint?: string },
): CompanyWebsiteResearch {
  const u = buildCompanyUnderstanding(pages, input);

  // Careers pages contribute hiring signals ONLY — never ICP or product.
  const careers_signal = u.evidence
    .filter((e) => e.page_type === "careers")
    .flatMap((e) => e.extracted_facts)
    .slice(0, 4);

  // Customer/case-study pages may name segments, but never the category.
  const customers_or_segments = u.evidence
    .filter((e) => e.page_type === "customers" || e.page_type === "case_study")
    .flatMap((e) => e.extracted_facts)
    .slice(0, 6);

  return {
    company_name: u.company_name,
    website: u.website,
    description: u.one_line_summary,
    product_category: u.product_category,
    business_model: u.business_model,
    target_users_guess: u.primary_users,
    features: u.key_features,
    use_cases: u.primary_use_cases,
    pricing_signal: u.pricing_signal,
    customers_or_segments,
    integrations: u.integrations,
    positioning_claims: u.main_promise ? [u.main_promise] : [],
    proof_points: u.proof_points,
    careers_signal,
    source_pages: u.evidence.map((e) => e.source_url),
    confidence: u.confidence,
    missing_evidence: u.missing_evidence,
    evidence: u.evidence,
    understanding: u,
    ambiguous: u.ambiguous,
    needs_confirmation: u.needs_confirmation,
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
