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
import { stripContactFields, unwrapActorRow } from "./founderLinkedIn.ts";

export const COMPANY_ACTOR_ENV = "APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER";
export const COMPANY_ACTOR_FALLBACK = "automation-lab/linkedin-company-scraper";
/** Secondary actor tried when the primary returns nothing or sparse data. */
export const COMPANY_ACTOR_FALLBACK_ENV = "APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER_FALLBACK";
export const COMPANY_ACTOR_FALLBACK_DEFAULT = "curious_coder/linkedin-company-scraper";

/** Input the common company scrapers all understand — URL/slug driven only. */
export function buildCompanyActorInput(companyUrl: string): Record<string, unknown> {
  return {
    companyUrls: [companyUrl],
    urls: [companyUrl],
    startUrls: [{ url: companyUrl }],
    companyUrl,
    url: companyUrl,
    maxItems: 1,
  };
}

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

/** Normalize one Apify LinkedIn-company row → CompanyLinkedInResearch. Pure.
 * Handles the output shapes of the common company actors (automation-lab,
 * curious_coder, apimaestro, …) via alias lookup + container unwrapping. */
export function normalizeCompanyLinkedIn(raw: unknown, sourceUrl: string): CompanyLinkedInResearch {
  const row = stripContactFields(unwrapActorRow(raw));

  const company_name = asString(row.companyName ?? row.company_name ?? row.name ?? row.title);
  const industry = asString(row.industry ?? row.industryName ?? row.industries ?? row.industry_name);
  const company_description = asString(row.description ?? row.about ?? row.companyDescription ?? row.tagline ?? row.overview);
  const website = asString(row.website ?? row.websiteUrl ?? row.companyWebsite ?? row.website_url);
  const specialties = uniq(asStringArray(row.specialties ?? row.specialities ?? row.specialities_list));
  const followers = asString(row.followers ?? row.followerCount ?? row.followersCount ?? row.follower_count);
  const employee_count = employeeCount(
    row.employeeCount ?? row.employeesCount ?? row.employee_count ?? row.employees ?? row.staffCount ?? row.staff_count,
  );
  const company_size = employeeCount(row.companySize ?? row.company_size ?? row.employeeRange ?? row.size);
  const headquarters = asString(row.headquarters ?? row.headquarter ?? row.hq ?? row.head_office);
  const founded = asString(row.founded ?? row.foundedYear ?? row.founded_year ?? row.foundedOn);

  const locations = uniq([
    ...asStringArray(row.locations),
    asString(row.location),
    headquarters,
  ].filter(Boolean));

  const missing_evidence: string[] = [];
  if (!industry) missing_evidence.push("industry");
  if (!company_description) missing_evidence.push("company description");
  if (!employee_count && !company_size) missing_evidence.push("employee count");
  if (!website) missing_evidence.push("website");

  const signals = [company_name, industry, company_description, website, followers, employee_count || company_size, headquarters]
    .filter(Boolean).length
    + (specialties.length ? 1 : 0) + (locations.length ? 1 : 0);

  return {
    linkedin_url: sourceUrl,
    industry, employee_count, locations, company_description, website, specialties, followers,
    company_name, headquarters, company_size, founded,
    confidence: confidenceFrom(signals, missing_evidence.length),
    missing_evidence,
  };
}

/** Sparse company data (fewer than two usable fields) is a failed enrichment. */
export function isSparseCompanyLinkedIn(r: CompanyLinkedInResearch): boolean {
  const core = [
    r.company_name || r.company_description,
    r.industry,
    r.employee_count || r.company_size,
    r.website,
  ].filter(Boolean).length;
  return core < 2;
}

export interface CompanyLinkedInResult {
  ok: boolean;
  research: CompanyLinkedInResearch | null;
  error?: string;
  skipped?: boolean;
  reason?: string;
  /** Which actor produced the result (primary or fallback). */
  actor_used?: string;
}

/** Enrich a company from its LinkedIn page. Optional — website research is
 * sufficient. Primary actor first; one fallback actor when the primary returns
 * nothing or sparse data. Sparse-after-fallback is ok:false, never a success. */
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

  const primary = deps.actorId?.(COMPANY_ACTOR_ENV, COMPANY_ACTOR_FALLBACK) ?? COMPANY_ACTOR_FALLBACK;
  const fallback = deps.actorId?.(COMPANY_ACTOR_FALLBACK_ENV, COMPANY_ACTOR_FALLBACK_DEFAULT) ?? COMPANY_ACTOR_FALLBACK_DEFAULT;
  const actorInput = buildCompanyActorInput(input.companyUrl);

  const runOne = async (actor: string): Promise<CompanyLinkedInResearch | null> => {
    // Cap: exactly one company page. No employee enumeration.
    const items = await deps.runApifyActor!(actor, actorInput);
    const first = Array.isArray(items) ? items[0] : null;
    return first ? normalizeCompanyLinkedIn(first, input.companyUrl) : null;
  };

  try {
    let actor_used = primary;
    let research = await runOne(primary).catch(() => null);

    if ((!research || isSparseCompanyLinkedIn(research)) && fallback && fallback !== primary) {
      const second = await runOne(fallback).catch(() => null);
      if (second && (!research || !isSparseCompanyLinkedIn(second))) {
        research = second;
        actor_used = fallback;
      }
    }

    if (!research) return { ok: false, research: null, error: "no_company_returned" };
    if (isSparseCompanyLinkedIn(research)) {
      return { ok: false, research, error: "sparse_company_data", actor_used };
    }
    return { ok: true, research, actor_used };
  } catch (e) {
    return { ok: false, research: null, error: e instanceof Error ? e.message : String(e) };
  }
}
