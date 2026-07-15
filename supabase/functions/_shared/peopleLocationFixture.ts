// Frozen fixture for the country-blind location-gate failure (live Q1
// q1-success-path-20260714T155551Z, plan f9531e85): HarvestAPI returned 22
// genuine US profiles whose location text is a city/region ("Greater
// Philadelphia"), all rejected as "wrong location (strict)" because the gate
// substring-matched the raw location string against "United States".
//
// Shapes are the REAL HarvestAPI profile location object (from the direct probe):
//   location = { linkedinText, countryCode, parsed: { country, countryCode, city, regionCode } }

/** Raw HarvestAPI profile location objects (as returned by the actor). */
export const RAW_LOCATION_A = {
  linkedinText: "Greater Philadelphia",
  countryCode: "US",
  parsed: { country: "United States", countryCode: "US", city: "Philadelphia", regionCode: null },
} as const;
export const RAW_LOCATION_B = {
  linkedinText: "San Francisco Bay Area",
  countryCode: "US",
  parsed: { country: "United States", countryCode: "US", city: "San Francisco", regionCode: "CA" },
} as const;
export const RAW_LOCATION_C = {
  linkedinText: "Greater London",
  countryCode: "GB",
  parsed: { country: "United Kingdom", countryCode: "GB", city: "London", regionCode: null },
} as const;

/** A full raw profile item (structured location nested under `location`). */
export function rawProfile(name: string, loc: Record<string, unknown>, url: string) {
  return {
    firstName: name.split(" ")[0],
    lastName: name.split(" ").slice(1).join(" "),
    currentPosition: [{ title: "Founder", companyName: "Acme SaaS" }],
    location: loc,
    linkedinUrl: url,
  };
}

/** The location string the current mapItem derives (linkedinText → city). */
export const MAPPED_LOCATION_A = "Greater Philadelphia";
export const MAPPED_LOCATION_B = "San Francisco Bay Area";
export const MAPPED_LOCATION_C = "Greater London";

export const REQUIRED_US = "United States";

/** The live failure facts the fix must flip (Case A/B accept; C reject). */
export const FROZEN_Q1_LOCATION_FACTS = {
  raw_profiles: 22,
  accepted: 0,
  reject_reason: "wrong location (strict)",
  all_us_profiles: true,
} as const;
