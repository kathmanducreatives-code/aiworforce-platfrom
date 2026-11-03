// ATLAS DISCOVERY BENCHMARK — the 12-scenario baseline, offline.
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/discovery-benchmark.ts [--out <dir>]
//
// Each scenario is a natural-language request, a RECORDED model reading of it (no model
// call), and a provider strategy. It runs through the real Option E path: the mission
// compiler, the strategy planner (semantic plan hash), the approval check, the
// multi-provider executor, the durable-ledger contract (memory implementation) and the
// lead projection. Providers are SYNTHETIC (offline fixtures: `.example` domains, no real
// company, person or contact); the network is blocked for the whole run.
//
// A scenario the current capabilities cannot honestly serve is not forced: it is
// UNSUPPORTED, with the planner's own refusal or the capability registry as evidence.
//
// Output: baseline.json (machine-readable), baseline.csv (one row per scenario) and
// index.html (dashboard). Nothing in them is a credential, a token or a contact value.

import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { leadOceanAdapter } from "../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ActorInvoker } from "../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger, type UsageLedger } from "../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { runDiscoveryStrategy, type StrategyRun } from "../../supabase/functions/_shared/leadPipeline/multiProvider.ts";
import { projectPipelineLead } from "../../supabase/functions/_shared/leadPipeline/projection.ts";
import { planStrategy, specFromMission, type DiscoveryStrategyId, type StrategyContext, type StrategyPlan } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { missionSemantics, semanticsFingerprint } from "../../supabase/functions/_shared/missionSemantics.ts";
import { findings as coverageFindings } from "./requirement-coverage.ts";
import { conn, loPage, loPerson, noSleep, type Synthetic } from "../../tests/edge-functions/_shared/discoveryProviders/fixtures.ts";
import { companyRecord, NOW, WS } from "../../tests/edge-functions/_shared/leadPipeline/fixtures.ts";

export const BENCHMARK_VERSION = "atlas-discovery-baseline-v1" as const;

// ── Synthetic provider data (offline only) ──────────────────────────────────

type Co = { slug: string; name: string; website: string; industry: string; hq: string; band: [number, number] };
const co = (slug: string, name: string, industry: string, hq: string, band: [number, number]): Co => ({ slug, name, website: `https://${slug}.example`, industry, hq, band });
export const COMPANIES = {
  northwind: co("northwind", "Northwind Ledger", "Software Development", "Austin, Texas, United States", [51, 200]),
  quartz: co("quartzlabs", "Quartz Labs", "Software Development", "Denver, Colorado, United States", [11, 50]),
  maple: co("mapleledger", "Maple Ledger", "Software Development", "Toronto, Ontario, Canada", [51, 200]),
  apex: co("apextalent", "Apex Talent Recruiting", "Staffing and Recruiting", "Dallas, Texas, United States", [11, 50]),
  harbor: co("harbor", "Harbor Metrics", "Software Development", "Boston, Massachusetts, United States", [51, 200]),
  shopco: co("shopco", "Shopco", "Retail", "Columbus, Ohio, United States", [201, 500]),
  ironworks: co("ironworks", "Ironworks Fabrication", "Industrial Machinery Manufacturing", "Toledo, Ohio, United States", [201, 500]),
  plainsteel: co("plainsteel", "Plain Steel Components", "Machinery Manufacturing", "Gary, Indiana, United States", [51, 200]),
  glowcart: co("glowcart", "Glowcart", "Retail", "Miami, Florida, United States", [51, 200]),
};
const NO_RECORD = new Set(["harbor"]);

function job(id: string, title: string, posted: string, c: Co) {
  return {
    id, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`, jobState: "LISTED", postedDate: posted,
    company: {
      id: `c-${c.slug}`, universalName: c.slug, name: c.name, linkedinUrl: `https://www.linkedin.com/company/${c.slug}`, website: c.website,
      employeeCount: c.band[0] + 5, employeeCountRange: { start: c.band[0], end: c.band[1] }, industries: [{ name: c.industry }],
      locations: [{ headquarter: true, parsed: { text: c.hq } }],
    },
    location: { linkedinText: "United States" }, descriptionText: `${c.name} is hiring.`,
  };
}
export const JOBS = [
  job("j1", "Account Executive", "2026-10-20", COMPANIES.northwind),
  job("j2", "Senior Account Executive", "2026-10-22", COMPANIES.northwind), // same employer: one company
  job("j3", "Account Executive", "2026-10-25", COMPANIES.quartz),
  job("j4", "Account Executive", "2026-10-18", COMPANIES.maple), // HQ Toronto: disproven
  job("j5", "Account Executive", "2026-10-21", COMPANIES.apex), // staffing agency: dropped
  job("j6", "Account Executive", "2026-08-01", COMPANIES.shopco), // outside the 30-day window
  job("j7", "Account Executive", "2026-10-26", COMPANIES.harbor), // no company record: pending
  job("j8", "Sales Development Representative", "2026-10-24", COMPANIES.glowcart),
  job("j9", "Sales Representative", "2026-10-23", COMPANIES.ironworks),
  job("j10", "Outside Sales Representative", "2026-10-19", COMPANIES.plainsteel),
];
const record = (c: Co) => companyRecord(c.slug, {
  name: c.name, website: c.website, hqCountry: c.hq.endsWith("Canada") ? "CA" : "US", city: c.hq.split(",")[0], band: c.band,
});
export const RECORDS: Record<string, unknown> = Object.fromEntries(Object.values(COMPANIES).filter((c) => !NO_RECORD.has(c.slug)).map((c) => [c.slug, record(c)]));

const person = (id: string, name: string, title: string, c: Pick<Synthetic, "company" | "domain" | "industry" | "employees">): Synthetic => ({ id, name, title, ...c });
export const LO_PEOPLE: Record<string, Synthetic[]> = {
  founders: [
    person("8001", "Ivy Cole", "Founder & CEO", { company: "Northwind Ledger", domain: "northwind.example", industry: "Software Development", employees: 80 }),
    person("8002", "Jon Reyes", "Co-Founder", { company: "Quartz Labs", domain: "quartzlabs.example", industry: "Software Development", employees: 30 }),
    person("8003", "Kai Ward", "Founder", { company: "Maple Ledger", domain: "mapleledger.example", industry: "Software Development", employees: 90 }), // Canadian HQ
    person("8004", "Lia Shaw", "CEO", { company: "Harbor Metrics", domain: "harbor.example", industry: "Software Development", employees: 70 }), // no record
  ],
  saas: [
    person("5001", "Ava Stone", "Founder & CEO", { company: "Cobalt Desk", domain: "cobaltdesk.example", industry: "Software Development", employees: 120 }),
    person("5002", "Ben Ortiz", "VP Sales", { company: "Pinecrest Apps", domain: "pinecrest.example", industry: "Software Development", employees: 340 }),
    person("5003", "Cara Lin", "Head of Growth", { company: "Cobalt Desk", domain: "cobaltdesk.example", industry: "Software Development", employees: 120 }), // same employer
    person("5004", "Dev Rao", "CEO", { company: "Tinyloop", domain: "tinyloop.example", industry: "Software Development", employees: 8 }), // outside 20-500
  ],
  insurance: [
    person("6001", "Eve Park", "Agency Owner", { company: "Lakeside Insurance Agency", domain: "lakeside-ins.example", industry: "Insurance", employees: 35 }),
    person("6002", "Finn Hale", "Principal", { company: "Summit Risk Partners", domain: "summitrisk.example", industry: "Insurance", employees: 80 }),
  ],
  hiringCompanies: [
    person("7001", "Gia Moss", "Founder", { company: "Northwind Ledger", domain: "northwind.example", industry: "Software Development", employees: 80 }), // also found by Apify
    person("7002", "Hal Vance", "CEO", { company: "Quartz Labs", domain: "quartzlabs.example", industry: "Software Development", employees: 30 }),
  ],
};

// ── Faults (failure injection) ──────────────────────────────────────────────

export type Fault =
  | "none" | "empty_jobs" | "incomplete_records" | "duplicate_postings" | "jobs_timeout" | "records_timeout"
  | "lo_empty" | "lo_error";

function apifyFor(fault: Fault) {
  const calls: { actor: string; items: number; key: string }[] = [];
  const titles: string[] = [];
  const invoke: ActorInvoker = (actor, input, opts) => {
    if (actor === "apify_linkedin_job_search") {
      titles.push(...((input.jobTitles as string[] | undefined) ?? []));
      if (fault === "jobs_timeout") { calls.push({ actor, items: 0, key: opts.idempotencyKey }); return Promise.reject(new Error("apify timeout (aborted)")); }
      const base = fault === "empty_jobs" ? [] : fault === "duplicate_postings" ? [...JOBS, ...JOBS.map((j) => ({ ...j, id: `${j.id}-dup` }))] : JOBS;
      const items = base.slice(0, opts.maxItems);
      calls.push({ actor, items: items.length, key: opts.idempotencyKey });
      return Promise.resolve({ items, runId: "run-jobs", chargedUsd: 0.001 + 0.001 * items.length });
    }
    if (actor === "apify_linkedin_company_details") {
      if (fault === "records_timeout") { calls.push({ actor, items: 0, key: opts.idempotencyKey }); return Promise.reject(new Error("apify timeout (aborted)")); }
      const items = (input.companies as string[]).map((u) => RECORDS[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean)
        .map((r) => fault === "incomplete_records" ? { ...(r as Record<string, unknown>), locations: [], employeeCountRange: null, employeeCount: null } : r);
      calls.push({ actor, items: items.length, key: opts.idempotencyKey });
      return Promise.resolve({ items, runId: "run-company", chargedUsd: 0.00005 + 0.004 * items.length });
    }
    calls.push({ actor, items: 0, key: opts.idempotencyKey });
    return Promise.reject(new Error(`unexpected actor ${actor}`));
  };
  return { invoke, calls, titles };
}

/**
 * A LeadOcean stand-in that honours the request: the domain filter and the row limit
 * (LeadOcean bills per row returned, so returning rows the request excluded would
 * overstate both the records bought and the evidence).
 */
function leadOceanFor(people: Synthetic[], fault: Fault) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchFn = (url: string, init: { method: string; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ url, method: init.method, body });
    if (fault === "lo_error") return Promise.resolve(new Response(JSON.stringify({ error: { message: "upstream failure" } }), { status: 500 }));
    const domains = body.domain ? ([] as string[]).concat(body.domain as string[]) : null;
    const rows = (fault === "lo_empty" ? [] : people).filter((p) => !domains || domains.includes(p.domain)).slice(0, Number(body.limit ?? 100));
    return Promise.resolve(new Response(JSON.stringify(loPage(rows.map(loPerson))), { status: 200 }));
  };
  return { adapter: leadOceanAdapter({ apiKey: "offline-benchmark-key", fetch: fetchFn as never, sleep: noSleep, now: NOW }), calls };
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const BLANK = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: null, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: "companies", strategies: [],
};
const US = { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }] };
const HIRING = (terms: string[]) => ({ preferred_signals: ["hiring"], required_signal_terms: terms, signal_recency_days: 30, strategies: ["hiring"] });

export interface Spec {
  /** What the scenario REQUIRES, prefers, must verify, and what PASS means — stated before the run. */
  hard: string[]; preferences: string[]; verification: string[]; providers: string; expected: string; pass: string;
}
export interface Scenario {
  id: string; group: "A" | "B" | "C" | "X" | "F"; title: string; request: string;
  proposal: Record<string, unknown>; count: number;
  strategy: DiscoveryStrategyId;
  /** Buy candidates for manual review when nothing can be proven (LeadOcean alone): stated, never implied. */
  allowReviewOnly?: boolean;
  people?: keyof typeof LO_PEOPLE;
  spec: Spec;
  /** UNSUPPORTED before any run: what the capability registry lacks (evidence). */
  unsupported?: string;
  /** The planner is expected to refuse it: the refusal itself is the evidence (UNSUPPORTED, not PASS). */
  plannerRefusalExpected?: boolean;
  /** Ground truth over the synthetic data: the companies that SHOULD qualify (precision / recall). */
  truthQualified?: string[];
  check: (r: RunRecord) => { pass: boolean; detail: string };
}

const qualifiedDomains = (r: RunRecord) => r.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain);
const verdictOf = (r: RunRecord, d: string) => r.companies.find((c) => c.domain === d)?.verdict ?? "absent";

export const SCENARIOS: Scenario[] = [
  {
    id: "A1", group: "A", title: "Apify — US companies hiring Account Executives", strategy: "apify_only", count: 5,
    request: "Find 5 US companies currently hiring Account Executives.",
    proposal: { ...US, requested_opportunity_count: 5, ...HIRING(["Account Executive"]) },
    spec: { hard: ["US headquarters", "hiring Account Executives (≤30 days)"], preferences: [], verification: ["HQ from the company record's HQ-flagged location", "a dated AE posting"],
      providers: "Apify job search (discovers by the hiring signal) + Apify company record (proves identity, HQ, size)",
      expected: "Northwind and Quartz qualify; Maple (Toronto HQ) rejected; the staffing agency and the 3-month-old posting never become candidates; Harbor (no record) needs review",
      pass: "Northwind and Quartz qualified; NO company qualified without an Account Executive posting (precision 1.0 vs ground truth); Maple and Apex not qualified; hard requirements preserved" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => {
      const q = qualifiedDomains(r);
      const ok = q.includes("northwind.example") && q.includes("quartzlabs.example") && r.falseQualified.length === 0
        && verdictOf(r, "mapleledger.example") !== "qualified" && verdictOf(r, "apextalent.example") !== "qualified" && r.hardPreserved;
      return { pass: ok, detail: `qualified ${q.join(", ") || "none"}; false-qualified ${r.falseQualified.join(", ") || "none"} (postings for SDR / Sales Representative counted as Account Executive hiring)` };
    },
  },
  {
    id: "A2", group: "A", title: "LeadOcean — US B2B SaaS, 20–500 employees", strategy: "leadocean_only", count: 5, allowReviewOnly: true, people: "saas",
    request: "Find 5 US B2B SaaS companies with 20–500 employees.",
    proposal: { ...US, requested_opportunity_count: 5, company_types: ["B2B SaaS"], employee_range: { min: 20, max: 500 } },
    spec: { hard: ["US headquarters", "20–500 employees", "B2B SaaS"], preferences: [], verification: ["HQ and size need a source that proves them; LeadOcean's are claims (HQ wrong for ~29% in LEADOCEAN_FINAL_VERDICT)"],
      providers: "LeadOcean people search (people + employer rows, narrowing filters, claims only)",
      expected: "companies discovered from employer rows and deduplicated; NONE qualified (nothing proves HQ or size); all honestly flagged for review",
      pass: "≥2 unique companies discovered, 0 qualified, every discovered company needs review, the limitation is stated in the plan" },
    truthQualified: [],
    check: (r) => {
      const ok = r.uniqueCompanies >= 2 && r.qualified === 0 && r.planLimitations.some((l) => /claims|needs_verification/.test(l));
      return { pass: ok, detail: `${r.uniqueCompanies} unique companies, ${r.qualified} qualified, ${r.review} for review` };
    },
  },
  {
    id: "A3", group: "A", title: "Apify — US manufacturers hiring sales representatives", strategy: "apify_only", count: 5,
    request: "Find 5 US manufacturers hiring sales representatives.",
    proposal: { ...US, requested_opportunity_count: 5, company_types: ["manufacturing"], ...HIRING(["sales representative"]) },
    spec: { hard: ["US headquarters", "manufacturer", "hiring sales representatives (≤30 days)"], preferences: [], verification: ["HQ (company record)", "posting (job search)", "manufacturing: a taxonomy label proves no industry — it stays to be verified"],
      providers: "Apify job search + company record (no industry filter on the job search)",
      expected: "Ironworks and Plain Steel found by their sales-rep postings; the industry requirement is never dropped and never satisfied by a label",
      pass: "the manufacturing requirement is preserved as hard, both manufacturers are discovered, and no company is qualified on industry without evidence" },
    truthQualified: [],
    check: (r) => {
      const found = ["ironworks.example", "plainsteel.example"].every((d) => verdictOf(r, d) !== "absent");
      const ok = found && r.hardPreserved && r.hardRequirements.some((h) => /industry|manufactur/i.test(h));
      return { pass: ok, detail: `manufacturers found: ${found}; industry hard: ${r.hardRequirements.some((h) => /industry|manufactur/i.test(h))}; qualified ${r.qualified}` };
    },
  },
  {
    id: "A4", group: "A", title: "LeadOcean — US insurance agencies, 10–100 employees", strategy: "leadocean_only", count: 5, allowReviewOnly: true, people: "insurance",
    request: "Find 5 US insurance agencies with 10–100 employees.",
    proposal: { ...US, requested_opportunity_count: 5, company_types: ["insurance agency"], employee_range: { min: 10, max: 100 } },
    spec: { hard: ["US headquarters", "10–100 employees", "insurance agency"], preferences: [], verification: ["as A2: LeadOcean HQ and size are claims"],
      providers: "LeadOcean people search with the industry label filter",
      expected: "both agencies discovered, none qualified, all for review",
      pass: "≥2 unique companies discovered, 0 qualified, limitation stated, and the stated industry stays a HARD requirement" },
    truthQualified: [],
    check: (r) => {
      const industryHard = r.hardRequirements.some((h) => /^industry:.*insurance/i.test(h));
      const ok = r.uniqueCompanies >= 2 && r.qualified === 0 && industryHard;
      return { pass: ok, detail: `${r.uniqueCompanies} unique companies, ${r.qualified} qualified; industry hard: ${industryHard} (preferences: ${r.preferences.join(" | ") || "none"})` };
    },
  },
  {
    id: "B1", group: "B", title: "Apify discovery → LeadOcean company enrichment", strategy: "apify_plus_leadocean", count: 5,
    request: "Find 5 US companies hiring Account Executives and enrich each company with LeadOcean firmographics.",
    proposal: { ...US, requested_opportunity_count: 5, ...HIRING(["Account Executive"]) },
    unsupported: "No LeadOcean company-enrichment capability exists in the planner registry (DISCOVERY_CAPABILITIES has leadocean.people_search and leadocean.people_by_domain only). apify_plus_leadocean uses LeadOcean for DECISION-MAKERS by domain, not company enrichment; the adapter's /v1/companies/enrich is not wired into any strategy.",
    spec: { hard: ["US headquarters", "hiring AEs"], preferences: [], verification: ["Apify company record already proves identity/HQ/size"], providers: "would need leadocean.company_enrich (not registered)", expected: "UNSUPPORTED", pass: "n/a" },
    check: () => ({ pass: false, detail: "unsupported" }),
  },
  {
    id: "B2", group: "B", title: "LeadOcean discovery → Apify hiring verification", strategy: "leadocean_plus_apify", count: 5, people: "hiringCompanies", plannerRefusalExpected: true,
    request: "Find 5 US software companies with 20–500 employees that are hiring Account Executives.",
    proposal: { ...US, requested_opportunity_count: 5, company_types: ["software"], employee_range: { min: 20, max: 500 }, ...HIRING(["Account Executive"]) },
    spec: { hard: ["US headquarters", "20–500 employees", "software", "hiring AEs"], preferences: [], verification: ["hiring must be proven per company"],
      providers: "LeadOcean people search → Apify company record (proves HQ and size, NOT hiring)", expected: "the planner refuses or states that hiring cannot be proven on this chain", pass: "the plan does not claim hiring verification it cannot do" },
    check: (r) => {
      const honest = r.planStatus !== "ready" || r.planLimitations.some((l) => /hiring/i.test(l));
      return { pass: honest, detail: `plan ${r.planStatus}${r.planBlockedReason ? `: ${r.planBlockedReason.slice(0, 160)}` : ""}` };
    },
  },
  {
    id: "B3", group: "B", title: "Both providers discover US manufacturers, then deduplicate", strategy: "apify_plus_leadocean", count: 5,
    request: "Find 5 US manufacturers with 50–500 employees.",
    proposal: { ...US, requested_opportunity_count: 5, company_types: ["manufacturing"], employee_range: { min: 50, max: 500 } },
    unsupported: "No strategy discovers from both providers in parallel (chainFor: every chain has ONE discovery step). Apify's discovery steps are signal-led (job search / post search) with no industry or firmographic filter, so 'manufacturers' with no signal cannot be discovered by Apify at all.",
    spec: { hard: ["US headquarters", "50–500 employees", "manufacturer"], preferences: [], verification: [], providers: "would need parallel discovery + firmographic Apify search (neither exists)", expected: "UNSUPPORTED", pass: "n/a" },
    check: () => ({ pass: false, detail: "unsupported" }),
  },
  {
    id: "B4", group: "B", title: "Hiring OR expansion opportunities", strategy: "apify_only", count: 5,
    request: "Find 5 US companies that are either hiring Account Executives or expanding into new offices.",
    proposal: { ...US, requested_opportunity_count: 5, preferred_signals: ["hiring", "expansion"], required_signal_terms: ["Account Executive"], signal_recency_days: 30, strategies: ["hiring"] },
    spec: { hard: ["US headquarters", "hiring AEs OR expansion (one either/or requirement)"], preferences: [], verification: ["hiring: dated posting", "expansion: no capability proves it"],
      providers: "Apify job search covers the hiring branch; no capability discovers or proves expansion", expected: "hiring branch discovered and proven; expansion branch stated as a limitation, not silently dropped",
      pass: "the either/or requirement is preserved (not narrowed to hiring-only), the expansion limitation is stated" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => {
      const either = r.hardRequirements.some((h) => /any_of/.test(h)) || r.anyOf;
      const ok = either && r.planLimitations.some((l) => /expansion/i.test(l));
      return { pass: ok, detail: `either/or kept: ${either}; expansion is ${r.hardRequirements.some((h) => h.startsWith("expansion")) ? "hard" : r.preferences.some((p) => p.startsWith("expansion")) ? "a preference only" : "absent"}; expansion limitation stated: ${r.planLimitations.some((l) => /expansion/i.test(l))}` };
    },
  },
  {
    id: "X1", group: "X", title: "Combined: Apify → LeadOcean (decision-makers at hiring companies)", strategy: "apify_plus_leadocean", count: 3, people: "founders",
    request: "Find the founder or CEO at 3 US companies currently hiring Account Executives.",
    proposal: { ...US, requested_opportunity_count: 3, decision_maker_roles: ["Founder", "CEO"], output_intent: "contacts", ...HIRING(["Account Executive"]) },
    spec: { hard: ["US HQ", "hiring AEs", "a founder/CEO contact"], preferences: [], verification: ["company: HQ + posting (Apify)", "person: provider title claim only (requires role verification)"],
      providers: "Apify job search → Apify company record → LeadOcean people by domain (only for verified companies)", expected: "people bought only for companies that passed verification; one company, one lead", pass: "Maple (disproven) never qualifies and hard requirements are preserved" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => ({ pass: verdictOf(r, "mapleledger.example") !== "qualified" && r.hardPreserved, detail: `qualified ${qualifiedDomains(r).join(", ") || "none"}; LeadOcean records ${r.leadoceanRecords}; apify $${r.costUsd.apify}` }),
  },
  {
    id: "X2", group: "X", title: "Combined: LeadOcean → Apify (founders, verified companies)", strategy: "leadocean_plus_apify", count: 3, people: "founders",
    request: "Find the founder or CEO at 3 US-headquartered companies with 20–200 employees.",
    proposal: { ...US, requested_opportunity_count: 3, decision_maker_roles: ["Founder", "CEO"], employee_range: { min: 20, max: 200 }, output_intent: "contacts" },
    spec: { hard: ["US HQ", "20–200 employees", "a founder/CEO contact"], preferences: [], verification: ["HQ and size from the Apify company record; LeadOcean's are claims"],
      providers: "LeadOcean people search → Apify company record", expected: "Maple (Canadian HQ) rejected on the record; Harbor (no record) stays for review", pass: "Maple not qualified; at least one US company qualified on Apify evidence" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => ({ pass: verdictOf(r, "mapleledger.example") !== "qualified" && r.qualified >= 1, detail: `qualified ${qualifiedDomains(r).join(", ") || "none"}; maple ${verdictOf(r, "mapleledger.example")}; harbor ${verdictOf(r, "harbor.example")}` }),
  },
  {
    id: "F1", group: "F", title: "Fault: unrecognised geography (Atlantis)", strategy: "apify_only", count: 5,
    request: "Find 5 companies headquartered in Atlantis currently hiring Account Executives.",
    proposal: { geographies: ["Atlantis"], hard_constraints: [{ field: "geography", operator: "in", value: ["Atlantis"], reason: "stated" }], requested_opportunity_count: 5, ...HIRING(["Account Executive"]) },
    spec: { hard: ["HQ in Atlantis", "hiring AEs"], preferences: [], verification: ["an HQ that ATLAS cannot place inside the requirement is unknown, never a match"],
      providers: "Apify", expected: "nothing qualifies: no HQ is in Atlantis", pass: "0 qualified" },
    truthQualified: [],
    check: (r) => ({ pass: r.qualified === 0, detail: `qualified ${qualifiedDomains(r).join(", ") || "none"} — an unrecognised place is treated as matched by ANY proven HQ (candidateEligibility geography check via geographyContradicts)` }),
  },
  {
    id: "F2", group: "F", title: "Fault: sub-national geography (Texas)", strategy: "apify_only", count: 5,
    request: "Find 5 companies headquartered in Texas currently hiring Account Executives.",
    proposal: { geographies: ["Texas"], hard_constraints: [{ field: "geography", operator: "in", value: ["Texas"], reason: "stated" }], requested_opportunity_count: 5, ...HIRING(["Account Executive"]) },
    spec: { hard: ["HQ in Texas", "hiring AEs"], preferences: [], verification: ["HQ-flagged location inside Texas"],
      providers: "Apify", expected: "only Northwind (Austin, TX) qualifies; Ohio, Colorado, Florida and Toronto HQs do not", pass: "precision 1.0: no company outside Texas qualifies" },
    truthQualified: ["northwind.example"],
    check: (r) => ({ pass: r.falseQualified.length === 0 && r.qualified >= 1, detail: `qualified ${qualifiedDomains(r).join(", ") || "none"}; outside Texas: ${r.falseQualified.join(", ") || "none"}` }),
  },
  {
    id: "C1", group: "C", title: "US-headquartered companies hiring AEs", strategy: "apify_only", count: 3,
    request: "Find 3 US-headquartered companies hiring Account Executives.",
    proposal: { ...US, requested_opportunity_count: 3, ...HIRING(["Account Executive"]) },
    spec: { hard: ["HQ in the US (scope: headquarters)", "hiring AEs"], preferences: [], verification: ["HQ-flagged location"], providers: "Apify", expected: "geography compiled with scope headquarters; Maple (CA HQ) rejected", pass: "geography scope = headquarters and Maple not qualified" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => ({ pass: r.geographyScope === "headquarters" && verdictOf(r, "mapleledger.example") !== "qualified", detail: `scope ${r.geographyScope}; maple ${verdictOf(r, "mapleledger.example")}` }),
  },
  {
    id: "C2", group: "C", title: "Companies operating in the US", strategy: "apify_only", count: 3,
    request: "Find 3 companies operating in the US that are hiring Account Executives.",
    proposal: { ...US, requested_opportunity_count: 3, ...HIRING(["Account Executive"]) },
    spec: { hard: ["operates in the US (scope: presence — NOT headquarters)", "hiring AEs"], preferences: [], verification: ["presence: a US location, not necessarily the HQ"], providers: "Apify", expected: "geography compiled with scope presence; a US posting location is presence evidence", pass: "geography scope = presence (never silently headquarters)" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => ({ pass: r.geographyScope === "presence", detail: `scope ${r.geographyScope}; qualified ${r.qualified}` }),
  },
  {
    id: "C3", group: "C", title: "Prefer B2B but allow B2C", strategy: "apify_only", count: 3,
    request: "Find 3 US companies hiring Account Executives. Prefer B2B companies, but include strong B2C opportunities.",
    proposal: { ...US, requested_opportunity_count: 3, company_types: ["B2B"], ...HIRING(["Account Executive"]) },
    spec: { hard: ["US HQ", "hiring AEs"], preferences: ["B2B (ranks, never rejects)"], verification: [], providers: "Apify", expected: "B2B is a preference; B2C companies are not rejected for being B2C", pass: "no hard business-model requirement; B2B kept as a preference" },
    truthQualified: ["northwind.example", "quartzlabs.example"],
    check: (r) => ({ pass: !r.hardRequirements.some((h) => /business_model|b2b/i.test(h)) && r.preferences.some((p) => /b2b/i.test(p)), detail: `hard: ${r.hardRequirements.join(" | ")}; preferences: ${r.preferences.join(" | ")}` }),
  },
  {
    id: "C4", group: "C", title: "Hiring SDRs or AEs", strategy: "apify_only", count: 3,
    request: "Find 3 US companies hiring SDRs or Account Executives.",
    proposal: { ...US, requested_opportunity_count: 3, ...HIRING(["SDR", "Account Executive"]) },
    spec: { hard: ["US HQ", "hiring SDRs or AEs (one hiring requirement, either role)"], preferences: [], verification: ["a dated posting for either role"], providers: "Apify job search with both titles", expected: "both roles searched; an SDR-only company (Glowcart) counts", pass: "both role terms reach the hiring requirement and the search, and Glowcart (SDR posting) is a candidate" },
    truthQualified: ["northwind.example", "quartzlabs.example", "glowcart.example"],
    check: (r) => {
      const both = /sdr|sales development/i.test(r.searchedTitles.join(" ") + r.hardRequirements.join(" ")) && /account executive/i.test(r.searchedTitles.join(" "));
      return { pass: both && verdictOf(r, "glowcart.example") !== "absent", detail: `titles ${r.searchedTitles.join(" | ")}; glowcart ${verdictOf(r, "glowcart.example")}` };
    },
  },
];

// ── One run, instrumented ───────────────────────────────────────────────────

export interface RunRecord {
  scenario: string; request: string; strategy: string | null; strategyRationale: string;
  planStatus: string; planBlockedReason: string | null; planLimitations: string[];
  planHash: string | null; semanticFingerprint: string;
  hardRequirements: string[]; preferences: string[]; geographyScope: string | null; searchedTitles: string[];
  hardPreserved: boolean; coverageUnexplained: string[];
  providerCalls: { provider: string; capability: string; items: number; filters?: string[]; domains?: string[] }[];
  itemsPurchased: { apify: number; leadoceanRecords: number };
  candidates: number; uniqueCompanies: number; qualified: number; rejected: number; review: number;
  /** Against the scenario's ground truth (synthetic data): qualified but should not be / should be but is not. */
  falseQualified: string[]; missedQualified: string[]; precision: number | null; recall: number | null;
  /** A hard either/or (any_of) group is present in the compiled requirements. */
  anyOf: boolean;
  companies: { name: string | null; domain: string | null; verdict: "qualified" | "rejected" | "review"; sources: string[]; evidence: string[]; gaps: string[] }[];
  costUsd: { apify: number; apifyBasis: "estimated_upper_bound" }; leadoceanRecords: number; costPerQualifiedUsd: number | null;
  runtimeMs: number; errors: string[]; retries: 0; dbWrites: number; ledger: { reserved: number; settled: number; uncertain: number };
  run: StrategyRun | null;
}

export async function runScenario(s: Scenario, o: { fault?: Fault; ledger?: UsageLedger & { entries: Map<string, { state: string }> }; walkId?: string; twice?: boolean } = {}): Promise<RunRecord> {
  const fault = o.fault ?? "none";
  const mission = compileLeadMission({ originalUserQuery: s.request, proposal: { ...BLANK, ...s.proposal } as never, requestedCount: s.count }).final_mission as unknown as Record<string, unknown>;
  const criteria = (mission.criteria ?? []) as Record<string, unknown>[];
  const semantics = missionSemantics(mission as never, criteria as never);
  const spec = specFromMission(mission as never, { defaultCount: s.count });
  const ctx: StrategyContext = {
    providers: { leadocean: { enabled: true, connected: true, authorized: true, remaining: 955 }, apify: { enabled: true, connected: true, authorized: true }, apollo: { enabled: false, connected: false, authorized: false } },
    budget: { maxLeadoceanRecords: 20, maxApifyUsd: 0.05 },
    user: { strategy: s.strategy, ...(s.allowReviewOnly ? { allowReviewOnly: true } : {}) },
    binding: { workspaceId: WS, contractVersion: "benchmark" },
  };
  const plan: StrategyPlan = planStrategy(spec, ctx);
  const hard = criteria.filter((c) => c.kind === "hard").map((c) => `${c.dimension}:${typeof c.value === "string" ? c.value : JSON.stringify(c.value)}`);
  const prefs = criteria.filter((c) => c.kind !== "hard").map((c) => `${c.dimension}:${typeof c.value === "string" ? c.value : JSON.stringify(c.value)}`);
  const geo = criteria.find((c) => c.dimension === "geography");
  const unexplained = coverageFindings(mission, criteria).filter((f) => !f.guard).map((f) => `${f.kind} ${f.item}`);
  const base: RunRecord = {
    scenario: s.id, request: s.request, strategy: plan.strategy, strategyRationale: plan.rationale?.join?.(" ") ?? String(plan.rationale ?? ""),
    planStatus: plan.status, planBlockedReason: plan.blockedReason ?? null, planLimitations: plan.limitations.map((l) => `${l.code}: ${l.detail}`),
    planHash: plan.status === "ready" ? plan.planHash : null, semanticFingerprint: semanticsFingerprint(semantics),
    hardRequirements: hard, preferences: prefs, geographyScope: (geo?.geography_scope as string) ?? null,
    searchedTitles: [], hardPreserved: unexplained.length === 0, coverageUnexplained: unexplained,
    providerCalls: [], itemsPurchased: { apify: 0, leadoceanRecords: 0 }, candidates: 0, uniqueCompanies: 0, qualified: 0, rejected: 0, review: 0, companies: [],
    falseQualified: [], missedQualified: [], precision: null, recall: null, anyOf: criteria.some((c) => c.kind === "hard" && Array.isArray(c.any_of) && (c.any_of as unknown[]).length > 1),
    costUsd: { apify: 0, apifyBasis: "estimated_upper_bound" }, leadoceanRecords: 0, costPerQualifiedUsd: null, runtimeMs: 0, errors: [], retries: 0, dbWrites: 0,
    ledger: { reserved: 0, settled: 0, uncertain: 0 }, run: null,
  };
  if (plan.status !== "ready") return base;

  const ap = apifyFor(fault);
  const lo = leadOceanFor(LO_PEOPLE[s.people ?? "saas"], fault);
  const ledger = o.ledger ?? memoryLedger();
  const approval = { planHash: plan.planHash, leadoceanRecords: plan.estimate.leadoceanRecords, apifyUsd: plan.estimate.apifyUsd, approvedBy: "benchmark-owner", approvedAt: NOW().toISOString() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network is blocked in the offline benchmark"); };
  const t0 = performance.now();
  let run: StrategyRun;
  try {
    const input = {
      workspaceId: WS, walkId: o.walkId ?? `bench-${s.id}`, spec, plan, approval, leadocean: lo.adapter, apify: ap.invoke,
      connections: [conn("leadocean"), conn("apify")], ledger, checkpoints: memoryCheckpointStore(), existing: new ExclusionIndex([], NOW), now: NOW,
    };
    run = await runDiscoveryStrategy(input);
    if (o.twice) run = await runDiscoveryStrategy(input);
  } catch (e) {
    base.errors.push(`executor threw: ${(e as Error).message}`);
    base.runtimeMs = Math.round(performance.now() - t0);
    return base;
  } finally { globalThis.fetch = realFetch; }
  base.runtimeMs = Math.round(performance.now() - t0);
  base.run = run;

  const leads = [...run.queue, ...run.review, ...run.excluded];
  const byKey = new Map<string, RunRecord["companies"][number]>();
  for (const l of leads) {
    const k = l.company.domain ?? l.company.key;
    if (byKey.has(k)) continue;
    const q = l.statuses.qualification;
    byKey.set(k, {
      name: l.company.name, domain: l.company.domain, verdict: q === "eligible" ? "qualified" : q === "ineligible" ? "rejected" : "review",
      sources: l.provenance.providers, evidence: Object.entries(l.qualification?.evidence_sources ?? {}).map(([src, n]) => `${src}x${n}`),
      gaps: (l.qualification?.gaps ?? []).map(String).slice(0, 4),
    });
  }
  base.companies = [...byKey.values()];
  base.candidates = leads.length;
  base.uniqueCompanies = byKey.size;
  base.qualified = base.companies.filter((c) => c.verdict === "qualified").length;
  base.rejected = base.companies.filter((c) => c.verdict === "rejected").length;
  base.review = base.companies.filter((c) => c.verdict === "review").length;
  if (s.truthQualified) {
    const q = base.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain ?? "");
    base.falseQualified = q.filter((d) => !s.truthQualified!.includes(d));
    base.missedQualified = s.truthQualified.filter((d) => !q.includes(d));
    base.precision = q.length ? Math.round(((q.length - base.falseQualified.length) / q.length) * 100) / 100 : null;
    base.recall = s.truthQualified.length ? Math.round(((s.truthQualified.length - base.missedQualified.length) / s.truthQualified.length) * 100) / 100 : null;
  }
  base.providerCalls = [
    ...ap.calls.map((c) => ({ provider: "apify", capability: c.actor, items: c.items })),
    ...lo.calls.map((c) => {
      const body = (c.body ?? {}) as Record<string, unknown>;
      const dom = body.domain ?? body.companyDomain ?? null;
      return { provider: "leadocean", capability: `${c.method} ${new URL(c.url).pathname}`, items: Number(body.limit ?? 0),
        filters: Object.keys(body).filter((k) => !["limit", "order", "slim", "cursor"].includes(k)).sort(), ...(dom ? { domains: ([] as string[]).concat(dom as string[]) } : {}) };
    }),
  ];
  base.itemsPurchased = { apify: ap.calls.reduce((n, c) => n + c.items, 0), leadoceanRecords: run.spend.leadoceanRecords };
  base.searchedTitles = [...new Set(ap.titles)];
  base.costUsd = { apify: Math.round(run.spend.apifyUsd * 1e6) / 1e6, apifyBasis: "estimated_upper_bound" };
  base.leadoceanRecords = run.spend.leadoceanRecords;
  base.costPerQualifiedUsd = base.qualified ? Math.round((run.spend.apifyUsd / base.qualified) * 1e6) / 1e6 : null;
  base.errors.push(...run.steps.filter((x) => x.status === "failed" || x.status === "partial").map((x) => `${x.capability}: ${x.status}${x.reason ? ` — ${x.reason}` : ""}`));
  if (run.status === "blocked") base.errors.push(`run blocked: ${run.reason}`);
  base.dbWrites = [...run.queue, ...run.review].map((l) => projectPipelineLead(l, { workspaceId: WS, values: [] })).filter(Boolean).length;
  const entries = [...((ledger as unknown as { entries: Map<string, { state: string }> }).entries?.values() ?? [])];
  base.ledger = { reserved: entries.filter((e) => e.state === "reserved").length, settled: entries.filter((e) => e.state === "settled").length, uncertain: entries.filter((e) => e.state === "uncertain").length };
  return base;
}

// ── Baseline ────────────────────────────────────────────────────────────────

export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "UNSUPPORTED";
export interface Result { id: string; title: string; group: string; verdict: Verdict; detail: string; spec: Spec; record: Omit<RunRecord, "run"> | null }

export async function baseline(): Promise<Result[]> {
  const out: Result[] = [];
  for (const s of SCENARIOS) {
    if (s.unsupported) { out.push({ id: s.id, title: s.title, group: s.group, verdict: "UNSUPPORTED", detail: s.unsupported, spec: s.spec, record: null }); continue; }
    const r = await runScenario(s);
    const { run: _run, ...record } = r;
    if (s.plannerRefusalExpected && r.planStatus !== "ready") {
      out.push({ id: s.id, title: s.title, group: s.group, verdict: "UNSUPPORTED", detail: `the planner refuses it: ${r.planBlockedReason}`, spec: s.spec, record });
      continue;
    }
    const c = s.check(r);
    const blocked = r.planStatus !== "ready";
    out.push({ id: s.id, title: s.title, group: s.group, verdict: blocked ? "BLOCKED" : c.pass ? "PASS" : "FAIL", detail: blocked ? `plan ${r.planStatus}: ${r.planBlockedReason}` : c.detail, spec: s.spec, record });
  }
  return out;
}
