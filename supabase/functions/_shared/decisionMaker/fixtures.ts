// Synthetic provider fixtures for decision-maker tests. Entirely invented
// companies and people — no real names, domains, emails or phone numbers, and no
// production identifiers.

import type { RawProviderProfile } from "./personProfile.ts";
import type { CompanyIdentityInput } from "./companyIdentity.ts";

export const TARGET_COMPANY: CompanyIdentityInput = {
  company_name: "Nimbus Forge",
  company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge/?trk=abc",
  website: "https://nimbusforge.example/careers",
};

/** Same NAME, different domain + different company page — the impostor case. */
export const LOOKALIKE_COMPANY_URL = "https://www.linkedin.com/company/nimbus-forge-labs";
export const LOOKALIKE_DOMAIN = "nimbusforge-labs.example";

function current(company: string, url: string | null, domain: string | null, title: string) {
  return {
    company_name: company, company_linkedin_url: url, company_domain: domain,
    title, is_current: true, start_date: "2023-01", end_date: null,
  };
}
function past(company: string, url: string | null, domain: string | null, title: string) {
  return {
    company_name: company, company_linkedin_url: url, company_domain: domain,
    title, is_current: false, start_date: "2018-01", end_date: "2021-06",
  };
}

/** 1. Verified founder at the target company. */
export const VERIFIED_FOUNDER: RawProviderProfile = {
  full_name: "Ada Kestrel",
  linkedin_url: "https://www.linkedin.com/in/ada-kestrel-synthetic",
  headline: "Founder & CEO at Nimbus Forge",
  current_title: "Founder & CEO",
  current_company_name: "Nimbus Forge",
  current_company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge",
  current_company_domain: "nimbusforge.example",
  location: "Synthetic City",
  experience: [current("Nimbus Forge", "https://www.linkedin.com/company/nimbus-forge", "nimbusforge.example", "Founder & CEO")],
};

/** 2. Verified CRO at the target company. */
export const VERIFIED_CRO: RawProviderProfile = {
  full_name: "Bo Wrenfield",
  linkedin_url: "https://www.linkedin.com/in/bo-wrenfield-synthetic",
  headline: "Chief Revenue Officer at Nimbus Forge",
  current_title: "Chief Revenue Officer",
  current_company_name: "Nimbus Forge",
  current_company_domain: "nimbusforge.example",
  location: "Synthetic City",
  experience: [current("Nimbus Forge", null, "nimbusforge.example", "Chief Revenue Officer")],
};

/** 3. Former founder, now elsewhere. */
export const FORMER_FOUNDER: RawProviderProfile = {
  full_name: "Cyd Marlow",
  linkedin_url: "https://www.linkedin.com/in/cyd-marlow-synthetic",
  headline: "Founder at Driftwave",
  current_title: "Founder",
  current_company_name: "Driftwave",
  current_company_linkedin_url: "https://www.linkedin.com/company/driftwave-synthetic",
  current_company_domain: "driftwave.example",
  experience: [
    current("Driftwave", "https://www.linkedin.com/company/driftwave-synthetic", "driftwave.example", "Founder"),
    past("Nimbus Forge", "https://www.linkedin.com/company/nimbus-forge", "nimbusforge.example", "Co-Founder"),
  ],
};

/** 4. Unrelated person whose title looks relevant. */
export const UNRELATED_CRO: RawProviderProfile = {
  full_name: "Dee Halloway",
  linkedin_url: "https://www.linkedin.com/in/dee-halloway-synthetic",
  headline: "Chief Revenue Officer at Quillstone",
  current_title: "Chief Revenue Officer",
  current_company_name: "Quillstone",
  current_company_linkedin_url: "https://www.linkedin.com/company/quillstone-synthetic",
  current_company_domain: "quillstone.example",
  experience: [current("Quillstone", "https://www.linkedin.com/company/quillstone-synthetic", "quillstone.example", "Chief Revenue Officer")],
};

/** 5. Same company NAME, different domain. */
export const LOOKALIKE_COMPANY_PERSON: RawProviderProfile = {
  full_name: "Eli Sandoval",
  linkedin_url: "https://www.linkedin.com/in/eli-sandoval-synthetic",
  headline: "VP Sales at Nimbus Forge",
  current_title: "VP Sales",
  current_company_name: "Nimbus Forge",
  current_company_linkedin_url: LOOKALIKE_COMPANY_URL,
  current_company_domain: LOOKALIKE_DOMAIN,
  experience: [current("Nimbus Forge", LOOKALIKE_COMPANY_URL, LOOKALIKE_DOMAIN, "VP Sales")],
};

/** 7. Probable: name matches and is corroborated, but no identifier. */
export const PROBABLE_EMPLOYEE: RawProviderProfile = {
  full_name: "Fen Okoro",
  linkedin_url: "https://www.linkedin.com/in/fen-okoro-synthetic",
  headline: "Head of Growth at Nimbus Forge",
  current_title: "Head of Growth",
  current_company_name: "Nimbus Forge",
  current_company_linkedin_url: null,
  current_company_domain: null,
  experience: [current("Nimbus Forge", null, null, "Head of Growth")],
};

/** 9. Malformed profile URL. */
export const MALFORMED_PROFILE: RawProviderProfile = {
  full_name: "Gus Pemberly",
  linkedin_url: "not-a-url::://linkedin",
  current_title: "Founder",
  current_company_name: "Nimbus Forge",
  current_company_domain: "nimbusforge.example",
  experience: [current("Nimbus Forge", null, "nimbusforge.example", "Founder")],
};

/** 15. Job poster who is actually a recruiter. */
export const JOB_POSTER_RECRUITER: RawProviderProfile = {
  full_name: "Hana Quill",
  linkedin_url: "https://www.linkedin.com/in/hana-quill-synthetic",
  headline: "Technical Recruiter at Nimbus Forge",
  current_title: "Technical Recruiter",
  current_company_name: "Nimbus Forge",
  current_company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge",
  current_company_domain: "nimbusforge.example",
  experience: [current("Nimbus Forge", "https://www.linkedin.com/company/nimbus-forge", "nimbusforge.example", "Technical Recruiter")],
};

/** 16. Job poster who IS the verified founder. */
export const JOB_POSTER_FOUNDER: RawProviderProfile = VERIFIED_FOUNDER;

/** 8. Duplicate of the verified founder, returned again by the provider. */
export const DUPLICATE_FOUNDER: RawProviderProfile = {
  ...VERIFIED_FOUNDER,
  linkedin_url: "https://linkedin.com/in/ada-kestrel-synthetic/?originalSubdomain=uk",
};

/** A different person who happens to share a name. */
export const SAME_NAME_DIFFERENT_PERSON: RawProviderProfile = {
  full_name: "Ada Kestrel",
  linkedin_url: "https://www.linkedin.com/in/ada-kestrel-2-synthetic",
  headline: "VP Sales at Quillstone",
  current_title: "VP Sales",
  current_company_name: "Quillstone",
  current_company_domain: "quillstone.example",
  experience: [current("Quillstone", null, "quillstone.example", "VP Sales")],
};
