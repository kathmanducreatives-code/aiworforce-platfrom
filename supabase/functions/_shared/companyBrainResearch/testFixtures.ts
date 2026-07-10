// Shared website fixtures for Research Quality v2 tests.
//
// NOT a *.test.ts file — it holds no tests, only data, so `deno test` doesn't
// run it directly. Every fixture is static markdown. No network, no providers.

import type { FirecrawlPage } from "./types.ts";

export const HOME = "https://cekura.ai";

const page = (url: string, title: string, markdown: string, description?: string): FirecrawlPage =>
  ({ url, title, markdown, description: description ?? null });

// ---- A. Clean B2B SaaS website: multiple product-defining pages agreeing ----
export const FIXTURE_A_CLEAN_SAAS: FirecrawlPage[] = [
  page(HOME, "Cekura | Sales engagement platform for revenue teams",
    "Cekura is a B2B SaaS sales engagement platform. Our outbound automation helps revenue teams build pipeline without hiring more SDRs. Teams close 3x more meetings each quarter using Cekura.",
    "Sales engagement platform for revenue teams. Pipeline before payroll."),
  page(`${HOME}/features`, "Features",
    "Our sales engagement platform automates outbound sequences and prospecting. Cekura integrates with HubSpot and Salesforce for two-way sync. Built for sales teams that run outbound at scale."),
  page(`${HOME}/pricing`, "Pricing",
    "Simple pricing for every team. The growth plan starts at $99 per month per seat, billed annually. Start free with a 14 day free trial."),
  page(`${HOME}/about`, "About",
    "We started Cekura in 2024 to fix founder-led sales for early-stage startups. Built for founders and sales teams who need pipeline."),
  page(`${HOME}/customers`, "Customers",
    "Teams like Acme and Globex cut research time by 3x every single week after switching to Cekura for outbound."),
];

// ---- B. Ambiguous: noisy blog + case study contradict a thin homepage --------
export const FIXTURE_B_AMBIGUOUS: FirecrawlPage[] = [
  page(HOME, "Cekura", "Cekura helps teams work better. Welcome to our website and our mission."),
  page(`${HOME}/blog/recruiting-guide`, "The complete guide to recruiting software",
    "Recruiting software and applicant tracking systems are changing hiring. A good recruiting platform with candidate sourcing helps talent acquisition teams. Companies grow 5x faster with better recruiting software."),
  page(`${HOME}/case-studies/globex`, "How Globex scaled",
    "Globex is a staffing agency that places candidates. They used our tool and improved placements by 40% in 3 months."),
];

// ---- C. Recruiting content on a company that is NOT a recruiting product -----
// One blog article about recruiting must never define the product category.
export const FIXTURE_C_RECRUITING_NOISE: FirecrawlPage[] = [
  page(HOME, "Cekura | Revenue operations software",
    "Cekura is revenue operations software. Our pipeline automation keeps your CRM clean for revenue teams.",
    "Revenue operations software for B2B SaaS teams."),
  page(`${HOME}/features`, "Features",
    "Revenue operations software with pipeline automation. Cekura integrates with Salesforce."),
  page(`${HOME}/blog/how-we-hire`, "How we hire: our recruiting software stack",
    "We use recruiting software and an applicant tracking system for candidate sourcing. Talent acquisition software matters. Our recruiting platform of choice handles hiring."),
  page(`${HOME}/careers`, "Careers",
    "We're hiring! Open roles across engineering and sales. Join our team and help us grow."),
];

// ---- D. Website-only, no LinkedIn: still enough to understand the product ----
export const FIXTURE_D_WEBSITE_ONLY: FirecrawlPage[] = [
  page(HOME, "Cekura | Data enrichment for GTM teams",
    "Cekura provides lead enrichment and contact data for go-to-market teams. Built as B2B SaaS.",
    "Data enrichment for GTM teams."),
  page(`${HOME}/features`, "Features",
    "Our data enrichment platform delivers firmographic data. Cekura integrates with Clay and Apollo."),
];

// ---- E. Noisy site, but the user's own description is authoritative ----------
export const FIXTURE_E_USER_BEATS_SITE: FirecrawlPage[] = [
  page(HOME, "Welcome", "Welcome. We do lots of things. Read our blog for more information about the industry."),
  page(`${HOME}/blog/recruiting-trends`, "Recruiting trends 2026",
    "Recruiting software, applicant tracking, talent acquisition software and candidate sourcing are all trending upward this year."),
];
export const FIXTURE_E_USER_DESCRIPTION =
  "Cekura is a B2B SaaS revenue operations platform with pipeline automation for sales teams.";

// ---- F. Sparse: homepage only, almost no evidence ----------------------------
export const FIXTURE_F_SPARSE: FirecrawlPage[] = [
  page(HOME, "Cekura", "Cekura."),
];

// ---- G. Agentory-like: AI workforce product whose site shows RECRUITING ------
// examples and DEMO signals. The examples must not define the category and the
// demo numbers must not become customer proof (Research System v3 live-QA case).
export const AGENTORY_HOME = "https://agentory.example";
export const FIXTURE_G_AGENTORY_LIKE: FirecrawlPage[] = [
  page(AGENTORY_HOME, "Agentory — Your AI workforce",
    "Agentory gives founders an AI workforce that finds leads, watches buying signals, and drafts outreach so your pipeline grows while you build. For example, imagine a Series A fintech hiring SDRs — Agentory surfaces it as a signal. 52 signals found this week in the demo workspace. One customer story: a recruiting agency used Agentory to fill roles faster.",
    "AI workforce for founders: leads, signals, outreach and pipeline."),
  page(`${AGENTORY_HOME}/how-it-works`, "How it works",
    "Step 1: Agentory automatically finds companies matching your ICP. Then it automatically scores buying signals like new funding or GTM hires, and drafts outreach you review before anything sends. Works for any B2B founder building pipeline. Agentory integrates with HubSpot for CRM sync."),
  page(`${AGENTORY_HOME}/blog/recruiting-example`, "Example: recruiting agencies",
    "Recruiting software and applicant tracking systems can use signals too. A recruiting platform with candidate sourcing benefits from talent acquisition signals. This is one example workflow of many."),
];
export const FIXTURE_G_USER_DESCRIPTION =
  "Agentory is an AI workforce OS for B2B founders: it finds leads, scores signals and prepares outreach for founder-led GTM.";

// ---- Apify actor output shapes (fixtures only; never sent anywhere) ----------
/** parseforge-style: flat row with snake_case keys. */
export const ACTOR_SHAPE_PARSEFORGE = {
  full_name: "Jane Doe",
  headline: "Co-Founder & CEO at Cekura",
  about: "Building Cekura. Previously led growth at Globex.",
  location: "San Francisco",
  current_company: "Cekura",
  current_role: "Co-Founder & CEO",
  experience: [{ title: "Co-Founder & CEO", company: "Cekura" }, { title: "Head of Growth", company: "Globex" }],
  education: [{ school: "Stanford", degree: "BS" }],
  skills: ["GTM", "Sales", "Growth"],
  email: "jane@example.com",          // must be stripped
  contact_info: { phone: "+1 555" },  // must be stripped
};

/** automation-lab-style: camelCase under a nested container. */
export const ACTOR_SHAPE_NESTED = {
  basic_info: {
    fullName: "Jane Doe",
    subTitle: "Co-Founder & CEO at Cekura",
    geoLocationName: "San Francisco Bay Area",
  },
  positions: [{ title: "Co-Founder & CEO", companyName: "Cekura" }],
  schools: [{ schoolName: "Stanford" }],
  skills: ["GTM", "Outbound"],
};

/** Sparse junk a broken actor returns. */
export const ACTOR_SHAPE_SPARSE = { someOtherField: "x", id: "123" };

/** automation-lab company shape. */
export const ACTOR_COMPANY_SHAPE_A = {
  companyName: "Cekura",
  website: "https://cekura.ai",
  industry: "Software Development",
  employeeCount: "51-200",
  followerCount: "1,204",
  headquarters: "San Francisco, CA",
  foundedYear: "2024",
  specialties: ["Sales automation", "AI"],
  description: "Cekura is a sales engagement platform.",
};

/** curious_coder-style nested company shape. */
export const ACTOR_COMPANY_SHAPE_B = {
  data: {
    name: "Cekura",
    website_url: "https://cekura.ai",
    industry_name: "Software",
    staff_count: 87,
    hq: "San Francisco",
    founded: 2024,
    overview: "Sales engagement platform for revenue teams.",
  },
};
