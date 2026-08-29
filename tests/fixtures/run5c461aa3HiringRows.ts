// THE REAL JOB ROWS PRODUCTION RETURNED FOR RUN 5c461aa3, 2026-08-28.
//
// ── PROVENANCE ─────────────────────────────────────────────────────────────
//
// Four paid `harvestapi/linkedin-job-search` runs, read back from Apify:
//
//   nyjSdju8xF7IEcgoc  dataset AoKBKfAtWGepM18rR   74 rows
//   wHMPvQpbzxh0xY1sI  dataset y1euiHvMoLcbQYlqv   98 rows
//   fRVfRUwVo2KywHyZ8  dataset HCcLnvlvfcYIDvndl   59 rows
//   GGI2CBcssx4hhXdeL  dataset XxqP1FPXEuHo6gbm9    3 rows
//
// ── WHY DISTINCT PAIRS ─────────────────────────────────────────────────────
//
// Stored as distinct (company, title) pairs rather than all 234 raw rows. That
// is not a simplification of the evidence: `dedupeJobs` keys on
// `job_id ?? job_url ?? \`${company_name}|${title}\``, so the assessor sees one
// entry per company+title regardless. The raw datasets are heavily duplicated —
// "Account Executive" appears ~20 times for one company — and preserving the
// duplication would change nothing except the file size.
//
// `company` is the value the Actor returned in `company.linkedinUrl`, verbatim.
// It is compared against the URL the batch REQUESTED, which is the join this
// fixture exists to exercise.

export interface FixtureJobRow { company: string; title: string }

const li = (slug: string) => `https://www.linkedin.com/company/${slug}`;

/** Companies each batch asked about, in the order the request listed them. */
export const RUN_5C461AA3_BATCHES: ReadonlyArray<{ run: string; companies: string[] }> = [
  { run: "nyjSdju8xF7IEcgoc", companies: [li("hirefeedd"), li("engtal"), li("lateam-partners")] },
  { run: "wHMPvQpbzxh0xY1sI", companies: [li("pursuit-sales-solutions"), li("letsremotivate"), li("blue-signal-search")] },
  { run: "fRVfRUwVo2KywHyZ8", companies: [li("sotalentjobs"), li("forcebrands"), li("talentoma")] },
  { run: "GGI2CBcssx4hhXdeL", companies: [li("intelletec-ltd"), li("storm4")] },
];

const rows = (slug: string, titles: string[]): FixtureJobRow[] =>
  titles.map((title) => ({ company: li(slug), title }));

export const RUN_5C461AA3_ROWS: ReadonlyArray<FixtureJobRow> = [
  // ── batch 1 ──────────────────────────────────────────────────────────────
  ...rows("hirefeedd", [
    "Strategy Manager (Remote)", "AI Process Consultant (Remote)",
    "Operations Manager (Remote)", "Sales/Account Executive (Remote) ",
    " Sales Development Representative (Remote)", " Document Formatting Specialist (Remote)",
    " PowerPoint Specialist (Remote)", "Software Engineer - FinTech (Remote)",
    "Strategic Project Lead (Remote)", "EMember of Technical Staff - Enterprise AI (Remote)",
    "Senior Software Engineer - Distributed Systems (Remote)", "Performance Engineer (Remote)",
    "Senior Python Developer (Remote)", "ML Researcher (Remote)", "AI Specialist (Remote)",
    "AI Data Trainer (Remote)", "Data Annotator (Remote)", " AI Consultant (Remote)",
    "ML Engineer (Remote)", " AI Data Contributor (Remote)", "Golang Developer (Remote)",
    " Machine Learning Specialist (Remote)", "Motion Graphics Specialist (Remote)",
    " Java Backend Developer (Remote)", "Open Source Software Developer (Remote)",
    " Junior Software Engineer (Remote)", "Forward Deployed Engineer (Remote)",
    "Marketing Specialist (Remote)", " Microsoft Excel Specialist (Remote)",
    "Business Consultant (Remote)", "Excel Specialist (Remote)", " Materials Specialist (Remote)",
  ]),
  ...rows("engtal", ["Senior Preconstruction Manager- Civil"]),
  ...rows("lateam-partners", [
    "Senior Digital Marketing Performance Strategist - 1637", "Account Executive",
    "Sales Development Representative", "Commercial Customer Support Agent",
    "Business Development Representative", "Virtual Administrative Assistant - 1690",
    "Customer Service Representative - 703", "Operations Coordinator - 1694",
    "Call Center Sales Supervisor", "Project Manager",
  ]),
  // ── batch 2 ──────────────────────────────────────────────────────────────
  ...rows("pursuit-sales-solutions", [
    "Account Executive", "Enterprise Account Executive", "Mid Market Account Executive ",
    "Territory Manager", "Media Account Executive", "New Home Sales Representative",
    "Respiratory Sales Representative ", "Sales Development Representative",
    "Sales Representative", "Healthcare Sales Representative ",
    "Medical Sales Representative", "Territory Sales Representative",
    "Business Development Representative", "Vice President of Sales", "Director of Sales",
    "Sales Representative - Trade Show Exhibit Design (REMOTE)",
  ]),
  ...rows("letsremotivate", ["Product Catalog & Vendor Operations Manager [714401]"]),
  ...rows("blue-signal-search", [
    "Chief Operating Officer", "Outside Sales - Construction",
    "Sales Account Manager – FIBC & Industrial Packaging",
    "Senior Director, Mission Critical Predevelopment", "Account Executive",
    "West Coast Sales Rep - Robotics", "Regional Channel Sales",
    "Commercial Roofing Sales Representative", "Business Development Representative",
    "Account Director", "Director of Sales – Residential Fiber, MDU",
    "Head of U.S. Sales & Operations", "Vice President of Sales | Technical B2B Manufacturing",
    "Northeast VP Specification Sales", "Director of Sales", "GTM & AI Analytics Engineer",
  ]),
  // ── batch 3 ── sotalentjobs returned NOTHING ─────────────────────────────
  ...rows("forcebrands", [
    "Head of Factory Operations ", "Director of Foodservice", "Director of Operations",
    "Sales & Inventory Analyst", "Operations Manager", "Sales Representative",
    "Sales Operations Coordinator", "State Manager", "Director of Sales",
    "Director of Sales (Natural Channel)", "Sales Director", "Senior Vice President of Sales",
    "Sales Director, Convenience ", "Director of National Accounts, Grocery & Natural ",
    "Brand Content Strategist",
  ]),
  ...rows("talentoma", [
    "Remote Sales Operations Specialist ", "Remote Account Representative",
    "Remote Inside Sales Representative", "Remote Customer Acquisition Specialist",
    "Remote Inside Sales Associate", "Remote Sales Development Associate",
    "Remote Customer Acquisition Associate", "Remote Lead Qualifier",
    "Remote Prospecting Specialist", "Remote Sales Associate", "Remote Sales Representative",
    "Remote Sales Development Representative", "Remote Business Development Associate",
    "Remote Business Development Representative", "Remote Business Development Specialist",
    "Remote Sales Consultant", "Remote Account Associate", "Remote Candidate Screener",
    "Remote Operations Specialist", "Remote Implementation Associate",
    "Remote Operations Support Specialist", "Remote Process Specialist",
    "Remote Workflow Specialist",
  ]),
  // ── batch 4 ── intelletec-ltd returned NOTHING ───────────────────────────
  ...rows("storm4", ["Senior Originator", "Sales Director"]),
];
