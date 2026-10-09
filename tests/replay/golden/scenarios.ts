// THE GOLDEN MISSIONS — six designed outcomes, each a whole mission run offline.
//
// The mission is Canary 8's production card (c01d28d8) without its AI-SaaS
// clause: hard US, 11–50 employees, funding in 730 days, a sales role open in
// the last 30. Provider rows use the shapes production receives (LinkedIn
// company search / details rows as in canary 98ce374b, Atomus and Pvalyou as in
// the live probes tests/fixtures/lead-v2/p6-funding-probes.json, LinkedIn jobs
// as the harvest actor returns them). Companies are synthetic. Dates are
// relative to the run so the windows hold on any day.

import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import type { FixtureProviderResponse } from "../lib/fixture.ts";
import { loadFixture } from "../lib/fixture.ts";
import type { GoldenMission } from "../lib/mission.ts";

type Row = Record<string, unknown>;
const SEARCH = "apify_linkedin_company_search";
const DETAILS = "apify_linkedin_company_details";
const ATOMUS = "apify_funding_atomus";
const PVALYOU = "apify_funding_pvalyou";
const JOBS = "apify_linkedin_job_search";

const day = 86_400_000;
export const daysAgo = (n: number) => new Date(Date.now() - n * day).toISOString().slice(0, 10);
export const li = (slug: string) => `https://www.linkedin.com/company/${slug}`;

/** Canary 8's compiled card, minus the AI-SaaS clause, asking for one company. */
export function goldenMission(o: { hiring?: boolean } = {}): LeadMissionV1 {
  const m = structuredClone(loadFixture("canary8.hiring-affordability").mission) as Record<string, unknown> & {
    company_profile: { verticals: string[] }; criteria: Array<{ dimension: string }>;
  };
  m.company_profile.verticals = [];
  m.brain_refinements = [];
  m.criteria = m.criteria.filter((c) => c.dimension !== "industry");
  m.requested_count = 1;
  m.original_user_query = "Find 1 US company with 11–50 employees, funding in the last 2 years, and at least one currently open sales role.";
  if (o.hiring === false) {
    // The same card without its hiring clause: what an adoption must carry to a qualified lead on its own.
    const sig = m as unknown as { required_signals: Array<{ type: string }>; required_signal_terms: string[] };
    m.criteria = m.criteria.filter((c) => c.dimension !== "hiring");
    sig.required_signals = sig.required_signals.filter((r) => r.type !== "hiring");
    sig.required_signal_terms = [];
    m.original_user_query = "Find 1 US company with 11–50 employees and funding in the last 2 years.";
  }
  return m as unknown as LeadMissionV1;
}

const searchRow = (slug: string, band = { start: 11, end: 50 }): Row => ({
  id: slug, name: slug, linkedinUrl: `${li(slug)}/`, website: `https://${slug}.com`,
  employeeCountRange: band, employeeCount: Math.round((band.start + band.end) / 2),
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ parsed: { text: "Austin, TX, United States", countryFull: "United States" }, country: "US", headquarter: true }],
});
const detailsRow = (slug: string, band = { start: 11, end: 50 }): Row => ({
  ...searchRow(slug, band), linkedinUrl: li(slug), description: "We build software for sales teams.",
});
const atomusRow = (slug: string, rounds: Array<[string, string]>): Row => ({
  input: li(slug), status: "success",
  summary: { name: slug, linkedin_url: li(slug), domain: `${slug}.com`, last_updated: daysAgo(10) },
  company: { financial: { funding: {
    num_funding_rounds: rounds.length,
    rounds: rounds.map(([type, at]) => ({ type, announced_at: at, raised_amount: 5_000_000, investors: ["Seedfund"] })),
  } } },
});
const pvalyouRow = (slug: string, rounds: Array<[string, string]>): Row => ({
  query: `${slug}.com`, status: "active", domain: `${slug}.com`, record_as_of: new Date().toISOString(),
  record: { funding: {
    rounds_count: rounds.length, last_round_date: rounds[0]?.[1] ?? null,
    rounds: rounds.map(([type, at], i) => ({
      round_index: i + 1, round_type: type, round_title: type, round_date: at, round_date_precision: "day",
      round_amount_m_usd: 5, is_non_equity: false, source_urls: [`https://news.example/${slug}-${i}`], investors: [{ name: "Seedfund" }],
    })),
  } },
});
const jobRow = (slug: string, title: string, posted: string): Row => ({
  id: `job-${slug}`, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${slug}/`,
  descriptionText: `${slug} is hiring a ${title}.`, postedDate: posted, location: { linkedinText: "Austin, TX" },
  company: { id: slug, universalName: slug, name: slug, linkedinUrl: li(slug), website: `https://${slug}.com`,
    employeeCount: 30, industries: ["Software Development"], locations: [{ city: "Austin", country: "US" }] },
});

const DISCOVERY_INPUT = { scraperMode: "full", maxItems: 10, locations: ["United States"], industryIds: ["4", "6"], companySize: ["11-50"], startPage: 1, takePages: 5 };
const MODEL = {
  plan_execution: { reasoning: "golden", steps: [
    { capability: "general_company_discovery", actor_key: SEARCH, purpose: "profile discovery", input: DISCOVERY_INPUT, depends_on: [] },
    { capability: "company_identity_resolution", actor_key: SEARCH, purpose: "only without a page", input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
    { capability: "company_enrichment", actor_key: DETAILS, purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [2] },
    { capability: "hiring_verification", actor_key: JOBS, purpose: "open roles", input: { company: ["{{url}}"], jobTitles: ["sales"] }, depends_on: [3] },
    { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [3] },
    { capability: "persistence", actor_key: null, purpose: "save", input: {}, depends_on: [4] },
  ] },
  plan_discovery: [{ actor_key: SEARCH, role: "primary", input: DISCOVERY_INPUT }],
  evaluate_mission: "pass" as const,
};

const pages = (p1: Row[], p2: Row[] = []): FixtureProviderResponse[] => [
  { actor: SEARCH, input_match: { startPage: 1, searchQuery: null }, rows: p1, provenance: "page 1" },
  { actor: SEARCH, input_match: { startPage: 2, searchQuery: null }, rows: p2, provenance: "page 2" },
  { actor: SEARCH, input_match: { startPage: 3, searchQuery: null }, rows: [], provenance: "page 3: nothing further" },
  { actor: SEARCH, input_match: { startPage: null }, rows: [], provenance: "identity search: never needed" },
];
const details = (rows: Row[]): FixtureProviderResponse =>
  ({ actor: DETAILS, select: { input_field: "companies", row_field: "linkedinUrl" }, rows, provenance: "company records" });

const base = (name: string, responses: FixtureProviderResponse[], extra: Partial<GoldenMission> = {}): GoldenMission => ({
  name, mission: goldenMission(), readiness: PRODUCTION_READINESS, model: MODEL, responses, maxSlices: 6, ...extra,
});

const RECENT = () => [["SERIES_A", daysAgo(200)]] as Array<[string, string]>;
const AE = () => jobRow("acme", "Account Executive", daysAgo(5));

export const GOLDEN: Record<string, () => GoldenMission> = {
  /** Every hard claim proven in one slice: US, 11–50, Series A 200 days ago, an AE role 5 days old. */
  qualified: () => base("qualified", [
    ...pages([searchRow("acme")]), details([detailsRow("acme")]),
    { actor: ATOMUS, rows: [atomusRow("acme", RECENT())], provenance: "a dated Series A inside the window" },
    { actor: JOBS, rows: [AE()], provenance: "one open Account Executive role" },
  ]),
  /** Funding proven, LinkedIn shows no sales role: hiring answered, still unproven — PENDING, never a match. */
  pending: () => base("pending", [
    ...pages([searchRow("acme")]), details([detailsRow("acme")]),
    { actor: ATOMUS, rows: [atomusRow("acme", RECENT())], provenance: "a dated Series A inside the window" },
    { actor: JOBS, rows: [], provenance: "no posting on LinkedIn" },
  ]),
  /** The company record declares 201–500: size FAILS — nothing is bought for it after the record. */
  ineligible: () => base("ineligible", [
    ...pages([searchRow("bigco")]), details([detailsRow("bigco", { start: 201, end: 500 })]),
    { actor: ATOMUS, rows: [], provenance: "must not be called for an ineligible company" },
    { actor: JOBS, rows: [], provenance: "must not be called for an ineligible company" },
  ]),
  /** Page 1: ten companies, all 201–500. Page 2: one that qualifies. The pool must widen. */
  replenishment: () => base("replenishment", [
    ...pages(Array.from({ length: 10 }, (_, i) => searchRow(`big-${i}`)), [searchRow("acme")]),
    details([...Array.from({ length: 10 }, (_, i) => detailsRow(`big-${i}`, { start: 201, end: 500 })), detailsRow("acme")]),
    { actor: ATOMUS, rows: [atomusRow("acme", RECENT())], provenance: "a dated Series A inside the window" },
    { actor: JOBS, rows: [AE()], provenance: "one open Account Executive role" },
  ]),
  /**
   * Atomus knows no rounds; the Pvalyou fallback outlives slice 1 and is ADOPTED
   * in slice 2 — never re-bought. The card without its hiring clause: with it,
   * Atomus + Pvalyou + a job search ($0.0036 + $0.0201 + $0.049) exceed the
   * $0.06 per-company ceiling and the job search is (correctly) unaffordable.
   */
  adoption: () => base("adoption", [
    ...pages([searchRow("acme")]), details([detailsRow("acme")]),
    { actor: ATOMUS, rows: [atomusRow("acme", [])], provenance: "Atomus: no rounds on record" },
    { actor: PVALYOU, pending_once: true, rows: [pvalyouRow("acme", [["Series A", daysAgo(150)]])], provenance: "Pvalyou cold read: running at slice end, a dated Series A on adoption" },
    { actor: JOBS, rows: [], provenance: "must not be called: the card has no hiring clause" },
  ], { mission: goldenMission({ hiring: false }) }),
  /**
   * An operator cap of $0.05: discovery (held at its row cost), the record and
   * Atomus fit; the $0.049 job search would take the mission to $0.0627.
   */
  budget: () => base("budget", [
    ...pages([searchRow("acme")]), details([detailsRow("acme")]),
    { actor: ATOMUS, rows: [atomusRow("acme", RECENT())], provenance: "a dated Series A inside the window" },
    { actor: JOBS, rows: [AE()], provenance: "must be refused by the ledger, never reached" },
  ], { missionCap: { provider_usd: 0.05, credits: null, invalid: [] } }),
};
