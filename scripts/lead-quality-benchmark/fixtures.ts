// Deterministic benchmark fixtures (section 16).
//
// Sanitized, synthetic candidates that exercise every failure class. No real
// personal contact details (no phone/personal email). These drive the offline
// test matrix and the replay regressions; they contain no secrets.

import { normalizeCandidate } from "./normalize.ts";
import { evaluateRun } from "./evaluate.ts";
import type { AgentoryOutput, RankedEvaluation, RawCandidate } from "./types.ts";

/** Reference "now" for freshness. Fixed so freshness/staleness are deterministic. */
export const FIXTURE_AS_OF = "2026-07-23T00:00:00.000Z";

export interface BenchmarkFixture {
  id: string;
  label: string;
  raws: RawCandidate[];
  /** Agentory outputs keyed by rawItemIndex (optional). */
  agentoryByIndex?: Record<number, AgentoryOutput>;
  note: string;
}

let SEQ = 0;
function raw(over: Partial<RawCandidate>): RawCandidate {
  const idx = over.rawItemIndex ?? SEQ++;
  return {
    provider: "apify",
    actorKey: "apify_jobs",
    actorId: "curious_coder/linkedin-jobs-scraper",
    actorRunId: "run_fixture",
    rawItemIndex: idx,
    sourceUrl: null,
    companyName: null,
    companyDomain: null,
    companyLinkedinUrl: null,
    jobTitle: null,
    jobDescriptionExcerpt: null,
    jobLocation: null,
    jobPostingUrl: null,
    jobObservedDate: null,
    personName: null,
    personTitle: null,
    personLinkedinUrl: null,
    statedCurrentCompany: null,
    rawLocation: null,
    rawMeta: {},
    ...over,
  };
}

const FRESH = "2026-07-10T00:00:00.000Z";
const STALE = "2025-10-01T00:00:00.000Z";

// A fully-valid SaaS + Sales Ops + US + current-founder candidate (reused as a base).
function strongUsSaasSalesOps(over: Partial<RawCandidate>): RawCandidate {
  return raw({
    companyName: "BigID",
    companyDomain: "bigid.com",
    companyLinkedinUrl: "https://www.linkedin.com/company/bigid",
    jobTitle: "Sales Strategy and Operations Lead",
    jobDescriptionExcerpt: "Own our US revenue operations and pipeline for our SaaS data security platform. Build GTM forecasting.",
    jobLocation: "New York, United States",
    jobPostingUrl: "https://boards.example.com/bigid/sales-strategy-ops",
    jobObservedDate: FRESH,
    personName: "Dimitri Sirota",
    personTitle: "Co-Founder & CEO",
    personLinkedinUrl: "https://www.linkedin.com/in/dimitrisirota",
    statedCurrentCompany: "BigID",
    rawMeta: { employeeCount: 180, companyDescription: "B2B SaaS data security platform" },
    ...over,
  });
}

export const FIXTURES: Record<string, BenchmarkFixture> = {
  F01_valid_us_saas_sales_ops: {
    id: "F01",
    label: "Valid US B2B SaaS hiring Sales Operations",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 100 })],
    agentoryByIndex: {
      100: { leadCandidateId: "lc-100", score: 88, decision: "contact", rank: 1, whyNow: "BigID is hiring a Sales Strategy and Operations lead for its US revenue team, suggesting it is formalizing GTM operations.", outreachAngle: "Reference their Sales Operations hire and offer to build pipeline before they finish staffing the GTM team." },
    },
    note: "All hard gates pass; supported why-now → CONTACT.",
  },

  F02_valid_revops_title: {
    id: "F02",
    label: "Valid Revenue Operations equivalent title",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 110, companyName: "Vanta", companyDomain: "vanta.com", companyLinkedinUrl: "https://www.linkedin.com/company/vanta", jobTitle: "Revenue Operations Manager", personName: "Christina Cacioppo", personLinkedinUrl: "https://www.linkedin.com/in/christinacacioppo", statedCurrentCompany: "Vanta", jobPostingUrl: "https://boards.example.com/vanta/revops" })],
    note: "RevOps counts as a qualifying operations family → CONTACT-eligible.",
  },

  F03_generic_sales_role: {
    id: "F03",
    label: "Generic sales-role mismatch",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 120, jobTitle: "Account Executive", jobDescriptionExcerpt: "Close new business as an Account Executive for our SaaS platform in the US.", jobPostingUrl: "https://boards.example.com/x/ae" })],
    note: "Account Executive is not Sales/Revenue Operations → hiring gate FAIL → REJECT.",
  },

  F04_manufacturing_ops: {
    id: "F04",
    label: "Manufacturing operations mismatch",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 130, jobTitle: "Manufacturing Operations Manager", jobDescriptionExcerpt: "Run plant operations and production lines.", jobPostingUrl: "https://boards.example.com/x/mfg" })],
    note: "Manufacturing operations is the wrong operations family → REJECT.",
  },

  F05_marketing_ops_no_revenue: {
    id: "F05",
    label: "Marketing operations without sales/revenue scope",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 140, jobTitle: "Marketing Operations Manager", jobDescriptionExcerpt: "Own email campaigns, brand, and content calendar.", jobPostingUrl: "https://boards.example.com/x/mktops" })],
    note: "Marketing ops without revenue/sales scope → hiring gate FAIL → REJECT.",
  },

  F06_non_us_only: {
    id: "F06",
    label: "Non-US-only role",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 150, jobLocation: "London, United Kingdom", jobDescriptionExcerpt: "Own UK revenue operations for our SaaS platform.", jobPostingUrl: "https://boards.example.com/x/uk" })],
    note: "Role country is the UK, no US evidence → US gate FAIL → REJECT.",
  },

  F07_remote_excludes_us: {
    id: "F07",
    label: "Remote role that excludes the US",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 160, jobLocation: "Remote", jobDescriptionExcerpt: "Remote Sales Operations role, EMEA only. US not eligible.", jobPostingUrl: "https://boards.example.com/x/emea" })],
    note: "Global remote that excludes the US → US gate FAIL → REJECT.",
  },

  F08_valid_founder_current: {
    id: "F08",
    label: "Valid founder at current company",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 170, companyName: "Harmonic Security", companyDomain: "harmonic.security", companyLinkedinUrl: "https://www.linkedin.com/company/harmonic-security", personName: "Alastair Paterson", personTitle: "Co-Founder & CEO", personLinkedinUrl: "https://www.linkedin.com/in/alastairpaterson", statedCurrentCompany: "Harmonic Security", jobTitle: "Sales Operations Manager", jobPostingUrl: "https://boards.example.com/harmonic/salesops" })],
    note: "Current founder, employer matches → founder + employer gates PASS.",
  },

  F09_former_founder: {
    id: "F09",
    label: "Former founder",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 180, personTitle: "Former Co-Founder" })],
    note: "Former founder → founder gate FAIL → REJECT.",
  },

  F10_founder_other_company: {
    id: "F10",
    label: "Founder at another company",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 190, statedCurrentCompany: "Some Other Startup" })],
    note: "Current founder but employer ≠ target → employer gate FAIL → REJECT.",
  },

  F11_advisor_investor: {
    id: "F11",
    label: "Advisor/investor incorrectly returned",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 200, personName: "Pat Angel", personTitle: "Advisor & Angel Investor", statedCurrentCompany: "BigID" })],
    note: "Advisor/investor, not a current founder → founder gate FAIL → REJECT.",
  },

  F12_duplicate_company: {
    id: "F12",
    label: "Duplicate company across two job posts",
    raws: [
      strongUsSaasSalesOps({ rawItemIndex: 210, companyName: "DupCo", companyDomain: "dupco.com", companyLinkedinUrl: "https://www.linkedin.com/company/dupco", personName: "Ann One", personLinkedinUrl: "https://www.linkedin.com/in/annone", statedCurrentCompany: "DupCo", jobPostingUrl: "https://boards.example.com/dupco/1" }),
      strongUsSaasSalesOps({ rawItemIndex: 211, companyName: "Dup Co.", companyDomain: "dupco.com", companyLinkedinUrl: "https://www.linkedin.com/company/dupco", personName: "Ann One", personLinkedinUrl: "https://www.linkedin.com/in/annone", statedCurrentCompany: "Dup Co.", jobTitle: "Revenue Operations Manager", jobPostingUrl: "https://boards.example.com/dupco/2" }),
    ],
    note: "Same domain across two posts → second is duplicate_account → REJECT.",
  },

  F13_duplicate_person: {
    id: "F13",
    label: "Duplicate person across provider results",
    raws: [
      strongUsSaasSalesOps({ rawItemIndex: 220, companyName: "AlphaCo", companyDomain: "alphaco.com", companyLinkedinUrl: "https://www.linkedin.com/company/alphaco", personName: "Sam Repeat", personLinkedinUrl: "https://www.linkedin.com/in/samrepeat", statedCurrentCompany: "AlphaCo", jobPostingUrl: "https://boards.example.com/alphaco/1" }),
      strongUsSaasSalesOps({ rawItemIndex: 221, companyName: "BetaCo", companyDomain: "betaco.com", companyLinkedinUrl: "https://www.linkedin.com/company/betaco", personName: "Sam Repeat", personLinkedinUrl: "https://www.linkedin.com/in/samrepeat", statedCurrentCompany: "BetaCo", jobPostingUrl: "https://boards.example.com/betaco/1" }),
    ],
    note: "Same person LinkedIn across distinct companies → second is duplicate_person.",
  },

  F14_missing_evidence: {
    id: "F14",
    label: "Missing evidence URL",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 230, jobPostingUrl: null, sourceUrl: null })],
    note: "No hiring evidence URL → evidence gate FAIL → cannot be CONTACT.",
  },

  F15_stale_posting: {
    id: "F15",
    label: "Stale job posting",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 240, jobObservedDate: STALE })],
    agentoryByIndex: {
      240: { leadCandidateId: "lc-240", score: 84, decision: "contact", rank: 1, whyNow: "BigID posted a Sales Strategy and Operations role.", outreachAngle: "Reference the Sales Operations opening and offer to build pipeline." },
    },
    note: "All gates pass but the signal is stale (>120d) → WATCH, not CONTACT.",
  },

  F16_ambiguous_saas: {
    id: "F16",
    label: "Company with ambiguous SaaS evidence",
    raws: [raw({ rawItemIndex: 250, companyName: "Acme Group", companyDomain: "acmegroup.example", jobTitle: "Sales Operations Manager", jobDescriptionExcerpt: "Help our team run day-to-day operations for our US business.", jobLocation: "Austin, United States", jobPostingUrl: "https://boards.example.com/acme/salesops", jobObservedDate: FRESH, rawMeta: { companyDescription: "We help businesses grow." } })],
    note: "No clear SaaS evidence and no explicit disqualifier → company gate NEEDS_REVIEW → NEEDS_REVIEW.",
  },

  F17_agency_false_positive: {
    id: "F17",
    label: "Agency/consultancy false positive",
    raws: [raw({ rawItemIndex: 260, companyName: "Peak Sales Recruiting", companyDomain: "peaksales.example", jobTitle: "Sales Operations Manager", jobDescriptionExcerpt: "We are a staffing agency hiring on behalf of our client for a US Sales Operations role.", jobLocation: "Boston, United States", jobPostingUrl: "https://boards.example.com/peak/salesops", jobObservedDate: FRESH, rawMeta: { industries: ["Staffing & Recruiting"] } })],
    note: "Recruiter/staffing proxy → company gate FAIL not_saas → REJECT.",
  },

  F18_unsupported_why_now: {
    id: "F18",
    label: "Unsupported why-now claim",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 270 })],
    agentoryByIndex: {
      270: { leadCandidateId: "lc-270", score: 86, decision: "contact", rank: 1, whyNow: "They are scaling fast and probably need more pipeline.", outreachAngle: "Congrats on the amazing growth — want help?" },
    },
    note: "Gates pass but why-now invents growth/urgency → unsupported → WATCH (not CONTACT).",
  },

  F19_strong_rank_leader: {
    id: "F19",
    label: "Strong valid account that should rank first",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 280, companyName: "RankLeader", companyDomain: "rankleader.com", companyLinkedinUrl: "https://www.linkedin.com/company/rankleader", personName: "Ada First", personTitle: "Founder & CEO", personLinkedinUrl: "https://www.linkedin.com/in/adafirst", statedCurrentCompany: "RankLeader", jobObservedDate: FRESH, rawMeta: { employeeCount: 60, companyDescription: "B2B SaaS revenue platform", fundingProofUrl: "https://press.example.com/rankleader-seriesa" } })],
    agentoryByIndex: {
      280: { leadCandidateId: "lc-280", score: 90, decision: "contact", rank: 1, whyNow: "RankLeader is hiring a Sales Strategy and Operations lead for its US team, indicating it is standing up GTM operations.", outreachAngle: "Reference the Sales Operations hire and offer to build outbound pipeline before payroll." },
    },
    note: "Best-in-class: SaaS + Sales Ops + US + current founder + fresh + supported why-now → CONTACT, ranks first.",
  },

  F20_gate_fail_high_model_score: {
    id: "F20",
    label: "Hard-gate failure with an artificially high model score",
    raws: [strongUsSaasSalesOps({ rawItemIndex: 290, jobLocation: "Berlin, Germany", jobDescriptionExcerpt: "Own EU revenue operations for our SaaS platform.", personTitle: "Former Founder" })],
    agentoryByIndex: {
      290: { leadCandidateId: "lc-290", score: 95, decision: "contact", rank: 1, whyNow: "High potential.", outreachAngle: "Let's talk." },
    },
    note: "Non-US + former founder but Agentory scored 95/contact → benchmark REJECT + score_inflation warning.",
  },

  // --- Regressions captured from the live TEST baseline (2026-07-24) ---------
  // The live "SaaS startups hiring Sales Operations" run surfaced FOUNDERS of
  // non-product services firms (advisory / search / consulting) as leads, with
  // no hiring signal. These are sanitized, generalized versions (no real names).
  F21_advisory_firm_founder: {
    id: "F21",
    label: "Founder of an advisory/consulting firm (services, not SaaS)",
    raws: [raw({ rawItemIndex: 300, companyName: "Meridian Advisors", jobTitle: null,
      jobDescriptionExcerpt: "Enterprise discipline for growth-focused SMB leaders.", jobLocation: "St. Louis, MO, United States",
      jobPostingUrl: "https://www.linkedin.com/in/fictional-advisor", jobObservedDate: FRESH,
      personName: "Fictional Founder", personTitle: "Founder & Principal", personLinkedinUrl: "https://www.linkedin.com/in/fictional-advisor",
      statedCurrentCompany: "Meridian Advisors" })],
    note: "Advisory/services firm — not a SaaS product company → company gate FAIL not_saas → REJECT.",
  },

  F22_search_firm_founder: {
    id: "F22",
    label: "Founder of a search/recruiting firm surfaced by a Sales-Ops query",
    raws: [raw({ rawItemIndex: 310, companyName: "Talent Vector", jobTitle: null,
      jobDescriptionExcerpt: "Retained search for revenue leaders.", jobLocation: "Sunnyvale, CA, United States",
      jobPostingUrl: "https://www.linkedin.com/in/fictional-search", jobObservedDate: FRESH,
      personName: "Fictional Consultant", personTitle: "Co-Founder and Principal Search Consultant", personLinkedinUrl: "https://www.linkedin.com/in/fictional-search",
      statedCurrentCompany: "Talent Vector" })],
    note: "Search/recruiting firm (title reveals it) → company gate FAIL not_saas → REJECT.",
  },

  F23_person_lead_no_hiring_signal: {
    id: "F23",
    label: "Founder person-lead with no hiring signal at an ambiguous company",
    raws: [raw({ rawItemIndex: 320, companyName: "Northwind Studio", jobTitle: null,
      jobDescriptionExcerpt: "We build things.", jobLocation: "Austin, United States",
      jobPostingUrl: "https://www.linkedin.com/in/fictional-cofounder", jobObservedDate: FRESH,
      personName: "Fictional Cofounder", personTitle: "Co-Founder", personLinkedinUrl: "https://www.linkedin.com/in/fictional-cofounder",
      statedCurrentCompany: "Northwind Studio" })],
    note: "No SaaS evidence + no hiring signal → conservatively NEEDS_REVIEW, never CONTACT.",
  },
};

/** Evaluate one fixture, wiring its Agentory outputs by candidate id. */
export function evaluateFixture(f: BenchmarkFixture): RankedEvaluation[] {
  const map: Record<string, AgentoryOutput> = {};
  if (f.agentoryByIndex) {
    for (const r of f.raws) {
      const a = f.agentoryByIndex[r.rawItemIndex];
      if (!a) continue;
      const n = normalizeCandidate(r, { asOf: FIXTURE_AS_OF });
      map[n.candidateId] = a;
    }
  }
  return evaluateRun(f.raws, { asOf: FIXTURE_AS_OF, agentoryByCandidateId: map });
}

/** All fixtures merged into a single run (for cross-run ranking/dedup tests). */
export function allFixtureRaws(): RawCandidate[] {
  return Object.values(FIXTURES).flatMap((f) => f.raws);
}
