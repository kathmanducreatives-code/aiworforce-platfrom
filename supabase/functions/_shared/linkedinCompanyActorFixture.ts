// Contract fixture for the VERIFIED Apify actor `harvestapi/linkedin-company`
// ("LinkedIn Company Details Scraper"). Provider-free.
//
// Schema source: the actor's official Apify listing + published input schema
// (verified 2026-07-16). Input keys were corroborated from two documentation
// sources before being encoded here — they are NOT inferred.
//
//   INPUT  { companies?: string[]   // List of LinkedIn company URLs
//          , searches?:  string[] } // List of company names to search on LinkedIn
//
//   OUTPUT (per company record): id, universalName, linkedinUrl, name, tagline,
//     website, logo, foundedOn, employeeCount, employeeCountRange, followerCount,
//     description, companyType, locations, specialities, industries, logos,
//     backgroundCovers, phone, fundingData
//
// NOTE 1: the output key is `specialities` (that spelling), not "specialties".
// NOTE 2: the actor returns a `phone` field. It is NEVER mapped to evidence and
//         never surfaced in observability (Section 6/15).
//
// All values below are synthetic. No real private contact data, no live response
// capture, no secrets.

/** Documented input shape. */
export interface LinkedInCompanyActorInput {
  companies?: string[];
  searches?: string[];
}

/** Tolerant view of a documented output record (every field optional — the
 * normalizer must never assume presence). */
export interface LinkedInCompanyActorItem {
  id?: unknown;
  universalName?: unknown;
  linkedinUrl?: unknown;
  name?: unknown;
  tagline?: unknown;
  website?: unknown;
  logo?: unknown;
  foundedOn?: unknown;
  employeeCount?: unknown;
  employeeCountRange?: unknown;
  followerCount?: unknown;
  description?: unknown;
  companyType?: unknown;
  locations?: unknown;
  specialities?: unknown;
  industries?: unknown;
  logos?: unknown;
  backgroundCovers?: unknown;
  phone?: unknown;
  fundingData?: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- fixtures ----

/** 1. Complete company: website, industries, employee count, description, HQ. */
export const FIXTURE_COMPLETE: LinkedInCompanyActorItem = {
  id: "1441",
  universalName: "acme-saas",
  linkedinUrl: "https://www.linkedin.com/company/acme-saas",
  name: "Acme SaaS",
  tagline: "Revenue operations for founder-led teams",
  website: "https://www.acmesaas.com/?utm_source=linkedin&ref=li#top",
  foundedOn: { year: 2019 },
  employeeCount: 48,
  employeeCountRange: { start: 11, end: 50 },
  followerCount: 3200,
  description: "Acme SaaS is a B2B SaaS platform helping founder-led teams build a repeatable revenue motion.",
  companyType: "Privately Held",
  industries: ["Software Development", "B2B SaaS"],
  locations: [
    { city: "Brooklyn", geographicArea: "New York", country: "US", headquarter: false, parsed: { text: "Brooklyn, New York, US" } },
    { city: "Austin", geographicArea: "Texas", country: "US", countryCode: "US", headquarter: true, parsed: { text: "Austin, Texas, United States", city: "Austin", countryCode: "US" } },
  ],
  specialities: ["RevOps", "GTM"],
  phone: "+1 415 555 0199",            // MUST NOT reach evidence/observability
};

/** 2. Missing website. */
export const FIXTURE_NO_WEBSITE: LinkedInCompanyActorItem = {
  universalName: "nowebco", linkedinUrl: "https://www.linkedin.com/company/nowebco",
  name: "NoWeb Co", industries: ["Software Development"], employeeCount: 20,
  locations: [{ city: "Denver", country: "US", countryCode: "US", headquarter: true }],
};

/** 3. Missing industry. */
export const FIXTURE_NO_INDUSTRY: LinkedInCompanyActorItem = {
  universalName: "noind", linkedinUrl: "https://www.linkedin.com/company/noind",
  name: "NoIndustry Inc", website: "https://noindustry.example.com", employeeCount: 15,
  locations: [{ city: "Seattle", country: "US", countryCode: "US", headquarter: true }],
};

/** 4. Multiple locations, exactly one flagged headquarter. */
export const FIXTURE_MULTI_LOCATION: LinkedInCompanyActorItem = {
  universalName: "multiloc", linkedinUrl: "https://www.linkedin.com/company/multiloc",
  name: "MultiLoc Ltd", website: "https://multiloc.example.com", industries: ["Software Development"],
  locations: [
    { city: "London", country: "GB", countryCode: "GB", headquarter: false },
    { city: "Boston", geographicArea: "Massachusetts", country: "US", countryCode: "US", headquarter: true },
    { city: "Berlin", country: "DE", countryCode: "DE", headquarter: false },
  ],
};

/** 5. Website carrying query + fragment (must be stripped). */
export const FIXTURE_DIRTY_WEBSITE: LinkedInCompanyActorItem = {
  universalName: "dirty", linkedinUrl: "https://www.linkedin.com/company/dirty",
  name: "Dirty URL Co", website: "http://dirty.example.com/home?utm_campaign=x&id=9#section",
  industries: ["Software Development"],
};

/** 6. LinkedIn URL with tracking params (must normalize to canonical). */
export const FIXTURE_TRACKED_LINKEDIN: LinkedInCompanyActorItem = {
  universalName: "tracked",
  linkedinUrl: "https://www.linkedin.com/company/tracked/?trk=public_profile&originalSubdomain=us",
  name: "Tracked Co", website: "https://tracked.example.com", industries: ["Software Development"],
};

/** 7. Malformed: a PERSON profile URL in the company field (must be rejected). */
export const FIXTURE_PERSON_URL_AS_COMPANY: LinkedInCompanyActorItem = {
  universalName: "bad", linkedinUrl: "https://www.linkedin.com/in/some-person",
  name: "Bad Url Co", website: "https://bad.example.com",
};

/** 8. employeeCount as an invalid string. */
export const FIXTURE_BAD_EMPLOYEE_COUNT: LinkedInCompanyActorItem = {
  universalName: "badcount", linkedinUrl: "https://www.linkedin.com/company/badcount",
  name: "BadCount Co", website: "https://badcount.example.com",
  employeeCount: "about fifty", employeeCountRange: { start: "x", end: null },
};

/** 9. Empty result set. */
export const FIXTURE_EMPTY: LinkedInCompanyActorItem[] = [];

/** 10. Actor error payload shape. */
export const FIXTURE_ERROR = { error: "actor_failed", message: "Actor run failed" };

/** 11. Duplicate company records for one company. */
export const FIXTURE_DUPLICATES: LinkedInCompanyActorItem[] = [
  { universalName: "dupe", linkedinUrl: "https://www.linkedin.com/company/dupe", name: "Dupe Co", website: "https://dupe.example.com", industries: ["Software Development"] },
  { universalName: "dupe", linkedinUrl: "https://www.linkedin.com/company/dupe/", name: "Dupe Co", website: "https://dupe.example.com/", industries: ["Software Development"] },
];

/** 12. Documented schema variants: industries as a string; employeeCountRange flat. */
export const FIXTURE_VARIANT_SHAPES: LinkedInCompanyActorItem = {
  universalName: "variant", linkedinUrl: "https://www.linkedin.com/company/variant",
  name: "Variant Co", website: "https://variant.example.com",
  industries: "Software Development",
  employeeCountRange: { start: 51, end: 200 },
  locations: [{ parsed: { text: "Toronto, Ontario, Canada", city: "Toronto", countryCode: "CA" }, headquarter: true }],
};
