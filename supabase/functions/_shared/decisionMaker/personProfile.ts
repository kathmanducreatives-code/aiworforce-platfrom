// Normalized person profile + deduplication. Pure + dependency-free.
//
// Provider payloads are shaped inconsistently and are never trusted as evidence
// just because a field is populated. Missing stays missing: an absent
// current_company_name must not be back-filled from the search we ran, or every
// result would "confirm" the company we asked for.

export interface ExperienceEntry {
  company_name: string | null;
  company_linkedin_url: string | null;
  company_domain: string | null;
  title: string | null;
  /** True only when the provider explicitly marks it current (no end date). */
  is_current: boolean;
  start_date: string | null;
  end_date: string | null;
}

export interface NormalizedPersonProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  headline: string | null;
  current_title: string | null;
  current_company_name: string | null;
  current_company_linkedin_url: string | null;
  current_company_domain: string | null;
  current_employment_start: string | null;
  location: string | null;
  experience: ExperienceEntry[];
  source_provider: string | null;
  source_actor: string | null;
  source_record_id: string | null;
  confidence: "high" | "medium" | "low";
  verification_status: "unverified";
  rejection_reasons: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Canonical linkedin.com/in/<slug> URL. Anything that is not a personal profile
 * URL — a company URL, a search URL, a bare slug, a malformed string — returns
 * null so the caller can reject rather than persist an unusable link.
 */
export function normalizePersonLinkedInUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const m = value.toLowerCase().match(/linkedin\.com\/in\/([a-z0-9\-_.%]+)/i);
  if (!m) return null;
  const slug = m[1].replace(/\/+$/, "");
  if (!slug || slug.length < 2) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

export function personLinkedInSlug(value: unknown): string | null {
  const norm = normalizePersonLinkedInUrl(value);
  return norm ? norm.split("/in/")[1] ?? null : null;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/** Normalized full name for secondary dedupe. Not used for identity on its own. */
export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : null;
}

export interface RawProviderProfile {
  [key: string]: unknown;
}

/**
 * Map a raw provider profile into the normalized contract. Unknown/missing
 * fields stay null. `is_current` is honoured only when the provider actually
 * says so — an experience entry with no end date is NOT assumed current here,
 * because several providers omit end dates on stale records.
 */
export function normalizeProviderProfile(
  raw: RawProviderProfile,
  meta: { provider?: string | null; actor?: string | null } = {},
): NormalizedPersonProfile {
  const rejection_reasons: string[] = [];

  const full_name = str(raw.full_name) ?? str(raw.fullName) ?? str(raw.name);
  const linkedin_url = normalizePersonLinkedInUrl(
    raw.linkedin_url ?? raw.linkedInUrl ?? raw.profile_url ?? raw.profileUrl ?? raw.url,
  );
  if (!linkedin_url) rejection_reasons.push("invalid_profile_url");
  if (!full_name) rejection_reasons.push("missing_name");

  const rawExperience = Array.isArray(raw.experience) ? raw.experience : [];
  const experience: ExperienceEntry[] = rawExperience.map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>;
    return {
      company_name: str(entry.company_name) ?? str(entry.companyName) ?? str(entry.company),
      company_linkedin_url: str(entry.company_linkedin_url) ?? str(entry.companyLinkedInUrl) ?? str(entry.companyUrl),
      company_domain: str(entry.company_domain) ?? str(entry.companyDomain),
      title: str(entry.title) ?? str(entry.position),
      is_current: entry.is_current === true || entry.isCurrent === true || entry.current === true,
      start_date: str(entry.start_date) ?? str(entry.startDate),
      end_date: str(entry.end_date) ?? str(entry.endDate),
    };
  });

  const currentFromExperience = experience.find((e) => e.is_current) ?? null;

  const { first, last } = splitName(full_name);

  return {
    full_name,
    first_name: first,
    last_name: last,
    linkedin_url,
    headline: str(raw.headline),
    current_title: str(raw.current_title) ?? str(raw.currentTitle) ?? str(raw.title) ?? currentFromExperience?.title ?? null,
    current_company_name:
      str(raw.current_company_name) ?? str(raw.currentCompanyName) ?? str(raw.company) ?? currentFromExperience?.company_name ?? null,
    current_company_linkedin_url:
      str(raw.current_company_linkedin_url) ?? str(raw.currentCompanyLinkedInUrl) ?? str(raw.company_url) ??
      currentFromExperience?.company_linkedin_url ?? null,
    current_company_domain:
      str(raw.current_company_domain) ?? str(raw.currentCompanyDomain) ?? currentFromExperience?.company_domain ?? null,
    current_employment_start: currentFromExperience?.start_date ?? str(raw.current_employment_start) ?? null,
    location: str(raw.location) ?? str(raw.locationName),
    experience,
    source_provider: str(meta.provider),
    source_actor: str(meta.actor),
    source_record_id: str(raw.id) ?? str(raw.record_id),
    confidence: "low",
    verification_status: "unverified",
    rejection_reasons,
  };
}

export interface DedupeResult {
  unique: NormalizedPersonProfile[];
  duplicate_count: number;
}

/**
 * Deduplicate by normalized LinkedIn slug first. Falls back to
 * name + verified current company, never name alone — two different people
 * commonly share a name, and merging them would attribute one person's
 * employment to another.
 */
export function dedupeProfiles(profiles: NormalizedPersonProfile[]): DedupeResult {
  const bySlug = new Map<string, NormalizedPersonProfile>();
  const byNameCompany = new Map<string, NormalizedPersonProfile>();
  const unique: NormalizedPersonProfile[] = [];
  let duplicate_count = 0;

  for (const p of profiles) {
    const slug = personLinkedInSlug(p.linkedin_url);
    if (slug) {
      if (bySlug.has(slug)) { duplicate_count += 1; continue; }
      bySlug.set(slug, p);
      unique.push(p);
      continue;
    }

    const name = normalizePersonName(p.full_name);
    const company = p.current_company_name?.toLowerCase().trim();
    // Only dedupe on name when a company is present to disambiguate.
    if (name && company) {
      const key = `${name}::${company}`;
      if (byNameCompany.has(key)) { duplicate_count += 1; continue; }
      byNameCompany.set(key, p);
    }
    unique.push(p);
  }

  return { unique, duplicate_count };
}
