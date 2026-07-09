// Apify LinkedIn Jobs → Scout Radar hiring source (Commit 4A).
//
// Turns Apify jobs rows into the Commit-3 SignalCandidate shape so real,
// Company-Brain-scored hiring signals flow through the same scorer/pipeline.
// Feature-flagged (RADAR_ENABLE_APIFY_JOBS); when off/unconfigured it reports an
// honest status and run-radar-scan keeps its Firecrawl fallback.
//
// Evidence-first: rejects URL-shortener domains, drops recruiter/staffing proxy
// posts (never treats the recruiter as the target account), and never invents
// funding language. The Apify fetch is a separate async fn — the normalization,
// query, and status helpers are pure/Deno-testable and no provider runs in tests.

import { normalizeApifyJobRow } from "../apifyJobsNormalizer.ts";
import type { SignalCandidate } from "../icpSignalScorer.ts";
import type { CompanyBrainContext } from "../companyBrainCompiler.ts";
import type { ScoredCandidate } from "../radarCandidatePipeline.ts";

// ---------------------------------------------------------- shortener guard ---
export const SHORTENER_HOSTS = [
  "bit.ly", "tinyurl.com", "t.co", "lnkd.in", "goo.gl", "ow.ly", "rebrand.ly", "shorturl.at",
];

export function isShortenerDomain(urlOrHost?: string | null): boolean {
  const v = (urlOrHost ?? "").trim().toLowerCase();
  if (!v) return false;
  let host = v;
  try {
    host = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "");
  } catch {
    host = v.replace(/^www\./, "");
  }
  return SHORTENER_HOSTS.some((s) => host === s || host.endsWith("." + s));
}

// --------------------------------------------------- recruiter/proxy detection ---
const RECRUITER_CO_RE = /\b(staffing|recruit(?:ing|ment|er)?|search firm|talent (?:agency|partners|solutions|acquisition partners)|head\s?hunt(?:ing|er)?|executive search|placement agency|rpo)\b/i;
const PROXY_TEXT_RE = /\b(our client|on behalf of|on our client'?s behalf|we'?re partnering with|partnering with an innovative|confidential (?:client|employer|search)|client of ours|a client of|hiring for a client)\b/i;

/** True when the real employer is hidden behind a recruiter/staffing proxy. */
export function isRecruiterProxy(company?: string | null, jobText?: string | null): boolean {
  const c = company ?? "";
  const t = jobText ?? "";
  return RECRUITER_CO_RE.test(c) || PROXY_TEXT_RE.test(t) || PROXY_TEXT_RE.test(c);
}

// ------------------------------------------------------------- normalization ---
export interface ApifyHiringNormalizeResult {
  candidate: SignalCandidate;
  /** recruiter proxy / hidden employer → reject (don't treat recruiter as account). */
  drop: boolean;
  dropReason?: string;
  /** adapter-specific missing evidence merged into signals.raw. */
  extraMissingEvidence: string[];
}

/** Normalize one Apify job row → scorer candidate (rich fields, shortener + proxy guards). */
export function normalizeApifyJobToCandidate(row: unknown, now?: number): ApifyHiringNormalizeResult {
  const n = normalizeApifyJobRow(row);
  const extraMissingEvidence: string[] = [];

  // Never use a URL shortener as the company website/domain.
  let website = n.website;
  let domain = n.domain;
  if (isShortenerDomain(n.website) || isShortenerDomain(n.domain)) {
    website = null;
    domain = null;
    extraMissingEvidence.push("verified company website");
  }

  const proxy = isRecruiterProxy(n.company, n.jobDescription);

  const candidate: SignalCandidate = {
    signal_type: "hiring",
    title: (n.company && n.jobTitle) ? `${n.company} hiring ${n.jobTitle}` : (n.signalSummary ?? "Hiring signal"),
    company_name: n.company ?? undefined,
    company_domain: domain ?? undefined,
    website: website ?? undefined,
    company_linkedin_url: n.linkedinUrl ?? undefined,
    company_description: n.companyDescription ?? undefined,
    industries: n.industries.length ? n.industries : undefined,
    employee_count: n.employeeCount,
    job_title: n.jobTitle ?? undefined,
    job_url: n.jobUrl ?? undefined,
    source_url: n.jobUrl ?? undefined,
    job_description: n.jobDescription ?? undefined,
    evidence_text: (n.jobDescription ?? n.companyDescription) ?? undefined,
    location: n.location ?? undefined,
    source_published_at: n.postedAt ?? undefined,
    source_type: "apify_jobs",
    provider: "apify",
    extracted_facts: {
      seniority_level: n.seniorityLevel,
      employment_type: n.employmentType,
      job_function: n.jobFunction,
      applicants_count: n.applicantsCount,
      poster_hint: n.posterContactHint,
    },
    now,
  };

  return { candidate, drop: proxy, dropReason: proxy ? "recruiter_proxy" : undefined, extraMissingEvidence };
}

/** Normalize a batch of Apify rows → scored-pipeline items (proxies dropped, capped). */
export function apifyRowsToScoredItems(
  rows: unknown[],
  opts: { cap: number; scanPlanReason: string; now?: number },
): { items: ScoredCandidate[]; dropped: number; considered: number } {
  const items: ScoredCandidate[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (items.length >= opts.cap) break; // hard cap on useful candidates
    const { candidate, drop, extraMissingEvidence } = normalizeApifyJobToCandidate(row, opts.now);
    if (drop) { dropped++; continue; } // recruiter proxy → reject
    if (!candidate.job_url && !candidate.source_url) { dropped++; continue; } // no proof
    items.push({ candidate, source: "hiring", scanPlanReason: opts.scanPlanReason, provider: "apify_jobs", extraMissingEvidence });
  }
  return { items, dropped, considered: rows.length };
}

// --------------------------------------------------------------- query input ---
function uniq(xs: string[]): string[] { return [...new Set(xs.filter((x) => x && x.trim()))]; }

function buildLinkedInJobsSearchUrl(keywords: string, location?: string): string {
  const p = new URLSearchParams();
  if (keywords) p.set("keywords", keywords);
  if (location) p.set("location", location);
  p.set("f_TPR", "r604800"); // posted in the last week
  return `https://www.linkedin.com/jobs/search/?${p.toString()}`;
}

export interface ApifyJobsInput { urls: string[]; count: number; keywords: string[]; setup_required: boolean }

const DEFAULT_HIRING_ROLES = ["Founding Account Executive", "RevOps", "SDR"];

/** Strongest SaaS/software-flavored category seed for query context, else null. */
export function primaryCategorySeed(brain: CompanyBrainContext): string | null {
  const cats = uniq([...brain.icp.categories, ...brain.icp.industries]);
  const preferred = cats.find((c) => /\b(saas|software|b2b|ai|revenue|sales|crm|pipeline|platform|gtm)\b/i.test(c));
  return preferred ?? cats[0] ?? null;
}

/**
 * Company-Brain-driven Apify jobs input. Every keyword carries the ICP's
 * category context ("B2B SaaS Founding Account Executive") instead of a broad
 * standalone role ("Sales Operations") so a lab/analytics account hiring an
 * "analytics" role never surfaces. When the Brain is not set up, returns NO
 * queries (setup_required) — we never fan out broad provider searches blind.
 */
export function buildApifyJobsInput(brain: CompanyBrainContext, cap = 10): ApifyJobsInput {
  if (brain.meta.setup_required) return { urls: [], count: 0, keywords: [], setup_required: true };
  const category = primaryCategorySeed(brain);
  const roles = brain.query_strategy.hiring_role_terms.length ? brain.query_strategy.hiring_role_terms : DEFAULT_HIRING_ROLES;
  const location = brain.icp.locations[0];
  const keywords = uniq(
    roles.slice(0, 6).map((r) => (category ? `${category} ${r}` : r).replace(/\s+/g, " ").trim()),
  ).slice(0, 5);
  const urls = keywords.map((k) => buildLinkedInJobsSearchUrl(k, location));
  const count = Math.max(10, Math.min(50, cap)); // actor floors to 10
  return { urls, count, keywords, setup_required: false };
}

/** Human-readable hiring queries for scan_plan_reason / logging (category + role). */
export function describeApifyJobsQueries(brain: CompanyBrainContext, max = 6): string[] {
  if (brain.meta.setup_required) return [];
  const cat = primaryCategorySeed(brain) ?? "B2B SaaS";
  const roles = brain.query_strategy.hiring_role_terms.length ? brain.query_strategy.hiring_role_terms : DEFAULT_HIRING_ROLES;
  return uniq(roles.slice(0, max).map((r) => `${cat} hiring ${r}`));
}

// ------------------------------------------------------------------- status ----
export interface ApifyJobsStatus {
  source: "hiring";
  provider: "apify" | "firecrawl";
  enabled: boolean;
  ready: boolean;
  reason: string;
}

/** Honest source status; never throws. When not enabled/ready, Firecrawl fallback stays. */
export function apifyJobsSourceStatus(input: { flagEnabled: boolean; apifyReady: boolean }): ApifyJobsStatus {
  if (!input.flagEnabled) {
    return { source: "hiring", provider: "firecrawl", enabled: false, ready: false, reason: "Apify jobs disabled (RADAR_ENABLE_APIFY_JOBS off) — using Firecrawl fallback." };
  }
  if (!input.apifyReady) {
    return { source: "hiring", provider: "firecrawl", enabled: false, ready: false, reason: "Apify not configured (no token) — using Firecrawl fallback." };
  }
  return { source: "hiring", provider: "apify", enabled: true, ready: true, reason: "Apify LinkedIn Jobs ready." };
}

// -------------------------------------------------------------- network fetch ---
const APIFY_ACTOR = "curious_coder~linkedin-jobs-scraper";

/** Fetch Apify LinkedIn jobs (network). Only called when flag + token are set; not run in tests. */
export async function fetchApifyJobs(input: ApifyJobsInput, token: string): Promise<unknown[]> {
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: input.urls, count: input.count, scrapeCompany: true }),
    });
    if (!res.ok) { console.warn("apify jobs non-200", res.status); return []; }
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.warn("apify jobs fetch failed", e);
    return [];
  }
}
