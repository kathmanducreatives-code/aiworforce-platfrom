// Company LinkedIn enrichment (Onboarding v3, Step 2 — OPTIONAL).
//
// The website is always enough; this only runs when the user supplies a company
// LinkedIn URL and clicks Analyze. One company page max. Never enumerates
// employees, never touches contacts. Actor id configurable via
// APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER.
//
// `normalizeCompanyLinkedIn` is pure → fixture-tested, no provider in tests.

import {
  type CompanyLinkedInResearch, type ResearchDeps,
  asString, asStringArray, uniq, confidenceFrom, isHttpUrl,
} from "./types.ts";

export const COMPANY_ACTOR_ENV = "APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER";
export const COMPANY_ACTOR_FALLBACK = "apimaestro/linkedin-company-detail";

/** Only linkedin.com/company/<slug> URLs are accepted. */
export function isLinkedInCompanyUrl(url: unknown): boolean {
  const s = asString(url);
  if (!isHttpUrl(s)) return false;
  try {
    const u = new URL(s);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/company\/[^/]+/i.test(u.pathname);
  } catch { return false; }
}

function employeeCount(v: unknown): string {
  const n = asString(v);
  if (!n) return "";
  // Accept "51-200", "1,024", 1024 — keep the label as read; never guess a range.
  return n.replace(/\s+/g, " ").trim();
}

/** Normalize one Apify LinkedIn-company row → CompanyLinkedInResearch. Pure. */
export function normalizeCompanyLinkedIn(raw: unknown, sourceUrl: string): CompanyLinkedInResearch {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const industry = asString(row.industry ?? row.industryName ?? row.industries);
  const company_description = asString(row.description ?? row.about ?? row.companyDescription);
  const website = asString(row.website ?? row.websiteUrl ?? row.companyWebsite);
  const specialties = uniq(asStringArray(row.specialties ?? row.specialities));
  const followers = asString(row.followers ?? row.followerCount ?? row.followersCount);
  const employee_count = employeeCount(row.employeeCount ?? row.employeesCount ?? row.companySize ?? row.staffCount);

  const locations = uniq([
    ...asStringArray(row.locations),
    asString(row.location ?? row.headquarters ?? row.hq),
  ].filter(Boolean));

  const missing_evidence: string[] = [];
  if (!industry) missing_evidence.push("industry");
  if (!company_description) missing_evidence.push("company description");
  if (!employee_count) missing_evidence.push("employee count");
  if (!website) missing_evidence.push("website");

  const signals = [industry, company_description, website, followers, employee_count].filter(Boolean).length
    + (specialties.length ? 1 : 0) + (locations.length ? 1 : 0);

  return {
    linkedin_url: sourceUrl,
    industry, employee_count, locations, company_description, website, specialties, followers,
    confidence: confidenceFrom(signals, missing_evidence.length),
    missing_evidence,
  };
}

export interface CompanyLinkedInResult {
  ok: boolean;
  research: CompanyLinkedInResearch | null;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

/** Enrich a company from its LinkedIn page. Optional — website research is sufficient. */
export async function enrichCompanyFromLinkedIn(
  input: { companyUrl: string },
  deps: ResearchDeps,
): Promise<CompanyLinkedInResult> {
  if (!input.companyUrl) {
    return { ok: false, research: null, skipped: true, reason: "no_company_linkedin_url" };
  }
  if (!isLinkedInCompanyUrl(input.companyUrl)) {
    return { ok: false, research: null, skipped: true, reason: "invalid_linkedin_company_url" };
  }
  if (!deps.runApifyActor) {
    return { ok: false, research: null, skipped: true, reason: "apify_not_configured" };
  }

  const actor = deps.actorId?.(COMPANY_ACTOR_ENV, COMPANY_ACTOR_FALLBACK) ?? COMPANY_ACTOR_FALLBACK;
  try {
    // Cap: exactly one company page. No employee enumeration.
    const items = await deps.runApifyActor(actor, { companyUrls: [input.companyUrl], maxItems: 1 });
    const first = Array.isArray(items) ? items[0] : null;
    if (!first) return { ok: false, research: null, error: "no_company_returned" };
    return { ok: true, research: normalizeCompanyLinkedIn(first, input.companyUrl) };
  } catch (e) {
    return { ok: false, research: null, error: e instanceof Error ? e.message : String(e) };
  }
}
