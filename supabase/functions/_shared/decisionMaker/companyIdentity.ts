// Canonical company identity for decision-maker search. Pure + dependency-free.
//
// The existing verifyCompanyMatch treats "the names look alike" as a match, which
// is how off-company people reach the Workbench. Identity resolution is split out
// here so a search can be REFUSED before it runs when the identity is too weak to
// verify a result against — a broad title-only search returns plausible strangers,
// and a plausible stranger is worse than an honest no-match.

export type IdentityStrength = "strong" | "medium" | "weak" | "missing";

export type IdentityField = "company_linkedin_url" | "domain" | "company_name";

export interface IdentitySource {
  field: IdentityField;
  /** Where the value came from, for provenance. Never a raw provider payload. */
  origin: string;
}

export interface CompanyIdentity {
  company_name: string | null;
  normalized_company_name: string | null;
  company_linkedin_url: string | null;
  normalized_company_linkedin_url: string | null;
  domain: string | null;
  identity_strength: IdentityStrength;
  identity_sources: IdentitySource[];
  missing_fields: IdentityField[];
  /** False → caller must return missing_company_identity instead of searching. */
  search_ready: boolean;
}

export interface CompanyIdentityInput {
  company_name?: unknown;
  company_linkedin_url?: unknown;
  domain?: unknown;
  website?: unknown;
  /** Company identity asserted by the originating job post, if any. */
  job_post_company_name?: unknown;
  job_post_company_url?: unknown;
}

/**
 * Domains that identify a job board / aggregator / social network rather than the
 * employer. Accepting one of these as "the company domain" would verify every
 * candidate who happens to have posted there.
 */
const NON_COMPANY_DOMAINS = new Set([
  "linkedin.com", "www.linkedin.com", "lnkd.in",
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com",
  "lever.co", "greenhouse.io", "workable.com", "ashbyhq.com", "bamboohr.com",
  "smartrecruiters.com", "jobvite.com", "breezy.hr", "recruitee.com", "teamtailor.com",
  "wellfound.com", "angel.co", "ycombinator.com", "workatastartup.com",
  "facebook.com", "twitter.com", "x.com", "instagram.com", "github.com",
  "medium.com", "notion.so", "google.com", "docs.google.com", "bit.ly", "t.co",
  "crunchbase.com", "pitchbook.com", "producthunt.com",
]);

/**
 * Legal-form suffixes only. Deliberately does NOT strip industry words like
 * "ai", "labs" or "tech": the previous normalizer collapsed "Acme AI" and
 * "Acme Labs" to the same key, which manufactures false company matches between
 * genuinely different companies.
 */
const LEGAL_SUFFIX_RE = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|s\.a|sa|b\.v|bv|llp|plc|pty|ab|oy|as|nv)\b/g;

export function normalizeCompanyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[&/]/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/** linkedin.com/company/<slug> → canonical https URL, tracking stripped. */
export function normalizeCompanyLinkedInUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const m = value.toLowerCase().match(/linkedin\.com\/company\/([a-z0-9\-_.%]+)/i);
  if (!m) return null;
  const slug = m[1].replace(/\/+$/, "").replace(/%2f/gi, "");
  // A bare or numeric-only slug is not a usable identity.
  if (!slug || slug.length < 2 || /^\d+$/.test(slug)) return null;
  return `https://www.linkedin.com/company/${slug}`;
}

export function companyLinkedInSlug(value: unknown): string | null {
  const norm = normalizeCompanyLinkedInUrl(value);
  return norm ? norm.split("/company/")[1] ?? null : null;
}

/**
 * Host of a real employer URL. Rejects job boards and social networks, and never
 * guesses: a name is never turned into a domain.
 */
export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let host: string;
  try {
    const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host.includes(".")) return null;
  if (NON_COMPANY_DOMAINS.has(host)) return null;
  // Also reject subdomains of known non-company hosts (jobs.lever.co, …).
  for (const bad of NON_COMPANY_DOMAINS) {
    if (host.endsWith(`.${bad}`)) return null;
  }
  return host;
}

export function isJobBoardDomain(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
    if (NON_COMPANY_DOMAINS.has(host)) return true;
    for (const bad of NON_COMPANY_DOMAINS) if (host.endsWith(`.${bad}`)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve the strongest available identity.
 *
 *   strong  → company LinkedIn URL AND domain (two independent verifiable keys)
 *   medium  → domain AND a usable name
 *   weak    → name only (NOT search-ready)
 *   missing → nothing usable
 *
 * Only strong/medium are search_ready. A weak identity cannot verify a returned
 * profile, so searching on it can only produce unverifiable guesses.
 */
export function resolveCompanyIdentity(input: CompanyIdentityInput): CompanyIdentity {
  const sources: IdentitySource[] = [];

  let linkedin = normalizeCompanyLinkedInUrl(input.company_linkedin_url);
  if (linkedin) sources.push({ field: "company_linkedin_url", origin: "lead.company_linkedin_url" });
  if (!linkedin) {
    const fromPost = normalizeCompanyLinkedInUrl(input.job_post_company_url);
    if (fromPost) {
      linkedin = fromPost;
      sources.push({ field: "company_linkedin_url", origin: "job_post.company_url" });
    }
  }

  let domain = normalizeDomain(input.domain);
  if (domain) sources.push({ field: "domain", origin: "lead.domain" });
  if (!domain) {
    const fromSite = normalizeDomain(input.website);
    if (fromSite) {
      domain = fromSite;
      sources.push({ field: "domain", origin: "lead.website" });
    }
  }

  const rawName = typeof input.company_name === "string" && input.company_name.trim()
    ? input.company_name.trim()
    : (typeof input.job_post_company_name === "string" && input.job_post_company_name.trim()
      ? input.job_post_company_name.trim()
      : null);
  const normalizedName = normalizeCompanyName(rawName);
  if (normalizedName) {
    sources.push({
      field: "company_name",
      origin: typeof input.company_name === "string" && input.company_name.trim()
        ? "lead.company_name"
        : "job_post.company_name",
    });
  }

  const missing_fields: IdentityField[] = [];
  if (!linkedin) missing_fields.push("company_linkedin_url");
  if (!domain) missing_fields.push("domain");
  if (!normalizedName) missing_fields.push("company_name");

  let identity_strength: IdentityStrength;
  if (linkedin && domain) identity_strength = "strong";
  else if (domain && normalizedName) identity_strength = "medium";
  else if (linkedin && normalizedName) identity_strength = "medium";
  else if (normalizedName || linkedin || domain) identity_strength = "weak";
  else identity_strength = "missing";

  return {
    company_name: rawName,
    normalized_company_name: normalizedName,
    company_linkedin_url: linkedin,
    normalized_company_linkedin_url: linkedin,
    domain,
    identity_strength,
    identity_sources: sources,
    missing_fields,
    search_ready: identity_strength === "strong" || identity_strength === "medium",
  };
}
