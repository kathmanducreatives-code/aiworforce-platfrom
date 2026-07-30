// OFFLINE END-TO-END ACCEPTANCE FIXTURE — zero network, zero provider calls.
//
// Simulates the canonical request:
//   "Find founders of SaaS startups hiring Sales Operations in the United States.
//    Return 5 qualified leads."
//
// LinkedIn returns 38 rows, Indeed returns 25 rows (63 provider rows) containing
// duplicates, irrelevant Operations titles, non-SaaS companies and non-US rows.
// The fixture is data only; the assertions live in qualifiedLeadE2E.test.ts.

import type { CompoundJob, CompoundPerson } from "./compoundSourcingPipeline.ts";

export const E2E_NOW = "2026-07-30T00:00:00Z";

const SAAS = "B2B SaaS platform for revenue teams";
const NOT_SAAS = "boutique management consulting and advisory services for SMB leaders";

/** The five companies that must end up CONTACT-ready. */
export const QUALIFYING_COMPANIES = ["Vanta", "BigID", "Ramp", "Mercury", "Retool"] as const;
/** Companies that pass the title/geo gates but never yield a verified founder. */
export const PENDING_COMPANIES = ["Linear", "Census"] as const;

function saasJob(company: string, domain: string, title: string, city: string, provider: string, n: number): CompoundJob {
  return {
    title,
    company,
    companyDomain: domain,
    companyDescription: SAAS,
    location: `${city}, United States`,
    url: `https://${provider}.example/jobs/${domain}-${n}`,
    postedDate: "2026-07-20T00:00:00Z",
  };
}

/** 38 LinkedIn rows. */
export const LINKEDIN_ROWS: CompoundJob[] = [
  saasJob("Vanta", "vanta.com", "Sales Operations Manager", "San Francisco", "linkedin", 1),
  saasJob("BigID", "bigid.com", "Revenue Operations Manager", "New York", "linkedin", 2),
  saasJob("Ramp", "ramp.com", "GTM Operations Manager", "New York", "linkedin", 3),
  saasJob("Mercury", "mercury.com", "Sales Operations Lead", "San Francisco", "linkedin", 4),
  saasJob("Retool", "retool.com", "Revenue Operations Lead", "San Francisco", "linkedin", 5),
  saasJob("Linear", "linear.app", "Sales Operations Manager", "Seattle", "linkedin", 6),
  saasJob("Census", "getcensus.com", "Revenue Operations Manager", "Denver", "linkedin", 7),
  // --- irrelevant Operations titles: must FAIL the title-family gate ---
  saasJob("Vanta", "vanta.com", "Warehouse Operations Manager", "Reno", "linkedin", 8),
  saasJob("Ramp", "ramp.com", "People Operations Manager", "New York", "linkedin", 9),
  saasJob("Retool", "retool.com", "Clinical Operations Manager", "Boston", "linkedin", 10),
  saasJob("Mercury", "mercury.com", "Restaurant Operations Manager", "Austin", "linkedin", 11),
  saasJob("BigID", "bigid.com", "Manufacturing Operations Manager", "Detroit", "linkedin", 12),
  // --- non-SaaS company: must FAIL the vertical gate ---
  {
    title: "Sales Operations Manager", company: "Optivas Advisors", companyDomain: "optivas.com",
    companyDescription: NOT_SAAS, location: "Boston, United States",
    url: "https://linkedin.example/jobs/optivas-13", postedDate: "2026-07-18T00:00:00Z",
  },
  // --- non-US: must FAIL the geography gate ---
  {
    title: "Sales Operations Manager", company: "UKCo", companyDomain: "ukco.com",
    companyDescription: SAAS, location: "London, United Kingdom",
    url: "https://linkedin.example/jobs/ukco-14", postedDate: "2026-07-18T00:00:00Z",
  },
  // --- padding to 38 rows: extra valid postings at the SAME companies (dedupe) ---
  ...Array.from({ length: 24 }, (_, i) =>
    saasJob(
      QUALIFYING_COMPANIES[i % QUALIFYING_COMPANIES.length],
      `${QUALIFYING_COMPANIES[i % QUALIFYING_COMPANIES.length].toLowerCase()}.com`,
      "Sales Operations Manager",
      "San Francisco",
      "linkedin",
      100 + i,
    )),
];

/** 25 Indeed rows, including exact cross-source duplicates of LinkedIn URLs. */
export const INDEED_ROWS: CompoundJob[] = [
  // exact duplicate job URLs from LinkedIn — must collapse.
  LINKEDIN_ROWS[0],
  LINKEDIN_ROWS[1],
  LINKEDIN_ROWS[2],
  saasJob("Vanta", "vanta.com", "Revenue Operations Analyst", "San Francisco", "indeed", 20),
  saasJob("Linear", "linear.app", "GTM Operations Lead", "Seattle", "indeed", 21),
  saasJob("Census", "getcensus.com", "Sales Operations Analyst", "Denver", "indeed", 22),
  // irrelevant Operations titles
  saasJob("Ramp", "ramp.com", "Logistics Operations Manager", "Newark", "indeed", 23),
  saasJob("Mercury", "mercury.com", "Business Operations Manager", "Austin", "indeed", 24),
  ...Array.from({ length: 17 }, (_, i) =>
    saasJob(
      QUALIFYING_COMPANIES[i % QUALIFYING_COMPANIES.length],
      `${QUALIFYING_COMPANIES[i % QUALIFYING_COMPANIES.length].toLowerCase()}.com`,
      "Revenue Operations Manager",
      "New York",
      "indeed",
      200 + i,
    )),
];

export const ALL_PROVIDER_ROWS: CompoundJob[] = [...LINKEDIN_ROWS, ...INDEED_ROWS];

function founder(name: string, company: string, domain: string): CompoundPerson {
  return {
    name, title: "Co-Founder & CEO", linkedinUrl: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
    currentCompany: company, currentCompanyDomain: domain, isCurrent: true,
  };
}

/** Founders keyed by the pipeline's company dedupe key. */
export const PEOPLE_BY_KEY: Record<string, CompoundPerson[]> = {
  "domain:vanta.com": [founder("Christina Cacioppo", "Vanta", "vanta.com")],
  "domain:bigid.com": [founder("Dimitri Sirota", "BigID", "bigid.com")],
  "domain:ramp.com": [founder("Eric Glyman", "Ramp", "ramp.com")],
  "domain:mercury.com": [founder("Immad Akhund", "Mercury", "mercury.com")],
  "domain:retool.com": [founder("David Hsu", "Retool", "retool.com")],
  // Linear returns nobody → company row, decision-maker pending.
  "domain:linear.app": [],
  // Census returns an off-company person → REJECT, company row still created.
  "domain:getcensus.com": [{
    name: "Wrong Person", title: "Founder", linkedinUrl: "https://linkedin.com/in/wrong",
    currentCompany: "SomewhereElse", currentCompanyDomain: "elsewhere.com", isCurrent: true,
  }],
};

/** Honest-Partial variant: only three companies yield a verified founder. */
export const PEOPLE_BY_KEY_PARTIAL: Record<string, CompoundPerson[]> = {
  "domain:vanta.com": PEOPLE_BY_KEY["domain:vanta.com"],
  "domain:bigid.com": PEOPLE_BY_KEY["domain:bigid.com"],
  "domain:ramp.com": PEOPLE_BY_KEY["domain:ramp.com"],
  "domain:mercury.com": [],
  "domain:retool.com": [],
  "domain:linear.app": [],
  "domain:getcensus.com": [],
};
