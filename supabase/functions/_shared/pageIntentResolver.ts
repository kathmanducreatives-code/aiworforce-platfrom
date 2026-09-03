// PAGE INTENT → URL (P2) — pure / deterministic. No network.
//
// THE SECURITY BOUNDARY OF THE WHOLE FEATURE.
//
// A model chooses an INTENT ("pricing"). This module turns that into a URL on
// the candidate's own registrable domain. The model never sees a URL, never
// emits one, and cannot influence which host is fetched — which is what stops
// a fabricated or injected plan from directing a request at an arbitrary
// server.
//
// ── WHY A PATH TABLE IS NOT A KEYWORD MAP ──────────────────────────────────
//
// `PAGE_INTENT_PATHS` maps a PAGE KIND to the conventional paths that page
// lives at. It contains no requirement vocabulary: nothing here knows what
// "B2B SaaS" or "sells to banks" means, and adding a requirement type needs no
// entry. The generic path is preserved because the model reasons from the
// requirement to an intent, and only this table turns an intent into a URL.

import { PAGE_INTENTS, type PageIntent } from "./evidenceRequest.ts";

/**
 * Conventional paths per intent, most likely first.
 *
 * Ordered by how often the page actually lives there. A 404 is an ANSWER —
 * "this company has no pricing page" is evidence in itself — so a miss is
 * never retried against the whole list; only the first candidate path is
 * fetched at P2, and `/map`-based recovery is a later phase.
 */
export const PAGE_INTENT_PATHS: Readonly<Record<PageIntent, readonly string[]>> =
  Object.freeze({
    homepage: ["/"],
    pricing: ["/pricing", "/plans"],
    product: ["/product", "/platform", "/features"],
    customers: ["/customers", "/case-studies"],
    case_studies: ["/case-studies", "/customers"],
    about: ["/about", "/company"],
    integrations: ["/integrations"],
    docs: ["/docs"],
    careers: ["/careers", "/jobs"],
    newsroom: ["/news", "/blog", "/press"],
    locations: ["/locations", "/offices"],
  });

/** Every intent must have at least one path, or resolution silently yields none. */
export function pageIntentTableIsTotal(): boolean {
  return PAGE_INTENTS.every((i) => (PAGE_INTENT_PATHS[i]?.length ?? 0) > 0);
}

/**
 * The registrable domain, lowercased and stripped of a leading `www.`.
 *
 * Deliberately simple: this is not a public-suffix implementation, and it is
 * used for COMPARISON on both sides of a redirect rather than for deciding
 * ownership. `metaview.ai` and `www.metaview.ai` are the same site;
 * `metaview.ai` and `evil.example.com` are not, which is the only judgement
 * this function is asked to make.
 */
export function registrableDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  } else {
    // A bare domain may still carry a path; take the authority only.
    host = host.split("/")[0];
  }
  host = host.replace(/^www\./, "");
  if (!host || !host.includes(".")) return null;
  // Reject anything that is not a plausible hostname — an IP literal, a port,
  // credentials, or a stray character. Cheap and total.
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host;
}

/**
 * True when a fetched/redirected URL still belongs to the company's own site.
 *
 * A subdomain counts (`docs.metaview.ai` is metaview.ai's own documentation);
 * a different registrable domain does not, however plausible it looks. This is
 * the check that turns an off-site redirect into `blocked` rather than a
 * fetch of somebody else's server.
 */
export function sameSite(expectedDomain: string, url: string): boolean {
  const expected = registrableDomain(expectedDomain);
  const actual = registrableDomain(url);
  if (!expected || !actual) return false;
  return actual === expected || actual.endsWith(`.${expected}`);
}

/** Only http(s). Mirrors `isValidHttpUrl` in the tool layer. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ────────────────────────── "this page is not there" ───────────────────────

/**
 * Phrases a not-found page says about itself.
 *
 * Used ONLY together with a length bound — see `looksLikeMissingPage`. A long
 * page that happens to mention a 404 is a real page; a 220-character page that
 * says "404 - Page not found" is not.
 */
const MISSING_PAGE_PHRASES: readonly string[] = [
  "404",
  "page not found",
  "page isn't found",
  "page is gone",
  "no longer exists",
  "can't find what you were looking for",
  "cannot be found",
  "doesn't exist",
];

/**
 * Content this long is a real page whatever it says about 404s. Chosen above
 * the three soft-404 bodies the first live run stored — 223, 245 and 620
 * characters — and far below the shortest genuine page it kept.
 */
export const MISSING_PAGE_MAX_CHARS = 1200;

/**
 * True when a 200 response is really a "page not found".
 *
 * ── WHY THIS MATTERS MORE ONCE THE CACHE IS READ ───────────────────────────
 *
 * Run 40295080 stored three of these as `status: "ok"` — hebbia.com/locations,
 * immuta.com/pricing, neotalogic.com/product — because the sites answer 200
 * with a not-found body. While every slice re-fetched, that was mostly noise.
 * With a cache that is READ, a stored 404 would be served back as evidence for
 * as long as its TTL lasts, and the extractor would be invited to quote it.
 *
 * Deliberately CONSERVATIVE: a real page misread as missing costs one wasted
 * fetch, while a 404 misread as real becomes durable false evidence. When the
 * provider reports a status code, that decides and this heuristic is not
 * consulted at all.
 */
export function looksLikeMissingPage(
  markdown: string,
  statusCode?: number | null,
): boolean {
  if (typeof statusCode === "number" && statusCode >= 400) return true;
  const text = (markdown ?? "").trim();
  if (!text) return false;
  if (text.length > MISSING_PAGE_MAX_CHARS) return false;
  const lower = text.toLowerCase();
  return MISSING_PAGE_PHRASES.some((p) => lower.includes(p));
}

export interface ResolvedPage {
  intent: PageIntent;
  url: string;
}

/**
 * Resolve intents to fetchable URLs on the company's own domain.
 *
 * Returns at most `maxPages` entries, deduplicated by URL so two intents that
 * share a path (`customers` and `case_studies` both offer `/case-studies`) do
 * not buy the same page twice.
 */
export function resolvePages(
  domain: string,
  intents: readonly PageIntent[],
  maxPages: number,
): ResolvedPage[] {
  const host = registrableDomain(domain);
  if (!host) return [];
  const out: ResolvedPage[] = [];
  const seen = new Set<string>();
  for (const intent of intents) {
    if (out.length >= maxPages) break;
    const path = PAGE_INTENT_PATHS[intent]?.[0];
    if (!path) continue;
    const url = `https://${host}${path === "/" ? "/" : path}`;
    if (seen.has(url)) continue;
    if (!isHttpUrl(url)) continue;
    seen.add(url);
    out.push({ intent, url });
  }
  return out;
}
