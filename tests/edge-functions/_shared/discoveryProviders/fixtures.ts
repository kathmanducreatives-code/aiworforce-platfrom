// Mocked provider responses and helpers for the provider-discovery tests.
// Every response here is a FIXTURE: shaped after the documented contracts
// (LeadOcean openapi.json, Apollo People API Search / Organization Search),
// with synthetic companies and people. Nothing reaches a network.

import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import type { FetchLike } from "../../../../supabase/functions/_shared/discoveryProviders/http.ts";
import type { ProviderConnectionState } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import type { ProviderId } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";

// ── The mission, through the real compiler ──────────────────────────────────

const BASE_PROPOSAL = {
  requested_opportunity_count: 25, requested_contact_ready_count: null, company_types: [], geographies: [],
  employee_range: { min: null, max: null }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
  preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
  evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [],
};

// The exclusion names LeadOcean's own industry label, so every provider can
// express it exactly (vocabulary.ts). A free-text exclusion ("staffing
// agencies") refuses LeadOcean's people search instead — see the vocabulary tests.
export const MANUFACTURER_QUERY = "Find 5 US manufacturers under 100 employees and their founder or CEO. Do not broaden. Exclude Staffing and Recruiting firms.";

/** The model's reading of MANUFACTURER_QUERY (a fixture), compiled by the real compiler. */
export function compileManufacturerMission(overrides: Record<string, unknown> = {}, query = MANUFACTURER_QUERY) {
  const proposal = {
    ...BASE_PROPOSAL,
    requested_opportunity_count: 5,
    company_types: ["manufacturing"],
    geographies: ["United States"],
    employee_range: { min: null, max: 100 },
    decision_maker_roles: ["Founder", "CEO"],
    hard_constraints: [
      { field: "employee_max", operator: "lte", value: 100, reason: "under 100 employees" },
      { field: "geography", operator: "in", value: ["United States"], reason: "US" },
      { field: "excluded_company_types", operator: "not_in", value: ["Staffing and Recruiting"], reason: "Exclude Staffing and Recruiting firms" },
    ],
    disallowed_broadening: ["geography", "employee_range"],
    required_capabilities: ["general_company_discovery", "company_details_enrichment", "company_semantic_evaluation", "portfolio_ranking"],
    ...overrides,
  };
  return compileLeadMission({ originalUserQuery: query, proposal: proposal as never, requestedCount: (proposal.requested_opportunity_count as number) });
}

// ── Connections ─────────────────────────────────────────────────────────────

export function conn(provider: ProviderId, over: Partial<ProviderConnectionState> = {}): ProviderConnectionState {
  return { provider, connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: 1000, recentFailures: 0, ...over };
}
export const ALL_CONNECTED = [conn("leadocean"), conn("apollo"), conn("apify")];

// ── LeadOcean rows ──────────────────────────────────────────────────────────

export interface Synthetic {
  id: string; name: string; title: string; company: string; domain: string; country?: string;
  industry?: string; employees?: number; email?: string; emailStatus?: string; phone?: string; linkedin?: string;
}

const band = (n: number) => (n <= 10 ? [1, 10] : n <= 50 ? [11, 50] : n <= 200 ? [51, 200] : n <= 500 ? [201, 500] : n <= 1000 ? [501, 1000] : n <= 5000 ? [1001, 5000] : [5001, 10000]);
const employeesBlock = (n: number) => { const [lo, hi] = band(n); return { number_of_employees: n, number_of_employees_code: `${lo}-${hi}`, number_of_employees_min: lo, number_of_employees_max: hi }; };

/**
 * A people-search row in the shape OBSERVED in validation test V (2026-10-31,
 * POST /v1/search, slim off): the person, and the employer as
 * contact_current_experiences[0] — name, domain, company_id (in meta), job
 * title, current flag, job level, industry label, headcount block, LinkedIn.
 * A people row carries NO employer headquarters. contact_emails / phones
 * appear only when a test simulates them arriving anyway (documented
 * "Present only when reveal_email=true"). Values are synthetic.
 */
export function loPerson(s: Synthetic) {
  return {
    profile_data: {
      profile_full_name: s.name, profile_first_name: s.name.split(" ")[0], profile_last_name: s.name.split(" ").slice(1).join(" "),
      profile_headline: null,
      profile_url: s.linkedin ?? `https://www.linkedin.com/in/${s.name.toLowerCase().replace(/\s+/g, "-")}`,
      profile_address: { city: null, state: null, continent: "North America", country_code: "US" },
    },
    contact_data: {
      has_email: !!s.email, has_phone: !!s.phone, email_status: s.email ? (s.emailStatus ?? "verified") : "none", email_type: "work", email_types: ["work"],
      contact_current_experiences: [{
        company_name: s.company, company_domain: s.domain, job_title: s.title, current: true, start_date: null,
        job_seniority: { job_level: "C-Team", score: null },
        ...(s.industry ? { company_industry: s.industry } : {}),
        ...(s.employees !== undefined ? { company_employees: employeesBlock(s.employees) } : {}),
        company_social_links: { linkedin: { url: `https://www.linkedin.com/company/${s.domain.split(".")[0]}` } },
      }],
      ...(s.email ? { contact_emails: [{ email: s.email, type: "work", status: s.emailStatus ?? "verified", verified_batch_date: "2026-09-01", priority: 1, score: 0.9 }] } : {}),
      ...(s.phone ? { contact_phones: [{ phone: s.phone, type: "mobile", ddi: null, dnc: false, carrier: null, priority: 1, score: 0.7 }] } : {}),
    },
    meta: { key: `person/${s.id}`, schema: "leadocean.person.v1", sources: ["leadocean"], source_ids: { person_id: s.id, person_group_id: `g-${s.id}`, company_id: `lo-c-${s.domain}` } },
  };
}

/** A company record in the shape OBSERVED in validation test V (GET /v1/companies/enrich). Values are synthetic. */
export function loCompanyRow(c: { id: string; name: string; domain: string; industry?: string; naicsSector?: string; employees?: number; linkedin?: string; hqCountryCode?: string | null; hqState?: string | null; hqCity?: string | null; funding?: Record<string, unknown> }) {
  return {
    company_data: {
      company_id: c.id, company_name: c.name, company_domain: c.domain, company_type: "Privately Held",
      company_industries: c.industry ? [{ name3: c.industry, name2: c.industry.toLowerCase().replace(/[^a-z]+/g, "-") }] : [],
      ...(c.naicsSector ? { naics_sector: c.naicsSector } : {}),
      ...(c.employees !== undefined ? { company_employees: employeesBlock(c.employees) } : {}),
      company_social_links: { linkedin: { url: c.linkedin ?? null } },
      company_primary_address: { city: c.hqCity ?? null, state: c.hqState ?? null, country: null, country_code: c.hqCountryCode ?? null, continent: null, postal_code: null },
      company_profile: { date_founded: null, entity_type: "company", publicly_traded: false },
      ...(c.funding ? { company_funding: c.funding } : {}),
    },
    company_metrics: { completion_score: 0.8, marketability_score: null },
    meta: { key: `company/${c.id}`, schema: "leadocean.company.v1", sources: ["leadocean"], source_ids: { company_id: c.id }, fetched_at: "2026-10-31T00:00:00.000Z" },
  };
}

export function loPage(rows: unknown[], meta: Record<string, unknown> = {}) {
  return { success: true, data: rows, meta: { count: rows.length, credits: rows.length, nextCursor: null, ...meta } };
}

// ── Apollo rows ─────────────────────────────────────────────────────────────

/**
 * A People API Search row exactly as documented (re-read 2026-10-30): the
 * organization carries its NAME and has_* flags only — no id, no domain.
 * (`org.primary_domain` is accepted for call sites but never emitted.)
 */
export function apPerson(id: string, first: string, title: string, org: { name: string; id?: string; primary_domain?: string }) {
  return {
    id, first_name: first, last_name_obfuscated: "S***h", title, last_refreshed_at: "2026-10-01T00:00:00Z",
    has_email: true, has_city: true, has_state: true, has_country: true, has_direct_phone: "Yes",
    organization: { name: org.name, has_industry: true, has_phone: true, has_city: true, has_state: true, has_country: true, has_zip_code: true, has_revenue: false, has_employee_count: true },
  };
}

// ── A routed mock fetch ─────────────────────────────────────────────────────

export type MockReply = { status?: number; body?: unknown; headers?: Record<string, string> } | "network_error";

export interface MockFetch {
  fetch: FetchLike;
  calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
}

/** Replies are consumed in order per "METHOD path"; the last one repeats. */
export function mockFetch(routes: Record<string, MockReply[]>): MockFetch {
  const calls: MockFetch["calls"] = [];
  const cursors: Record<string, number> = {};
  const fetch: FetchLike = (url, init) => {
    const path = new URL(url).pathname;
    const key = `${init.method} ${path}`;
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const list = routes[key];
    if (!list) return Promise.resolve(new Response(JSON.stringify({ error: { message: `no mock for ${key}` } }), { status: 404 }));
    const i = Math.min(cursors[key] ?? 0, list.length - 1);
    cursors[key] = (cursors[key] ?? 0) + 1;
    const r = list[i];
    if (r === "network_error") return Promise.reject(new TypeError("network error"));
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } }));
  };
  return { fetch, calls };
}

export const noSleep = (_ms: number) => Promise.resolve();
export const FIXED_NOW = () => new Date("2026-10-27T12:00:00Z");

// ── The synthetic market ────────────────────────────────────────────────────
// Five that qualify, and one wrong on each axis the mission constrains.

export const MARKET: Synthetic[] = [
  { id: "lo-p1", name: "Avery Stone", title: "Founder & CEO", company: "Stonebridge Fabrication", domain: "stonebridgefab.example", industry: "Industrial Machinery Manufacturing", employees: 42, email: "avery@stonebridgefab.example", phone: "+1 555 0101" },
  { id: "lo-p2", name: "Jordan Lake", title: "CEO", company: "Lakeside Plastics", domain: "lakesideplastics.example", industry: "Plastics Manufacturing", employees: 85, email: "jordan@lakesideplastics.example", emailStatus: "catch_all" },
  { id: "lo-p3", name: "Riley Chen", title: "Co-Founder", company: "Chen Precision Parts", domain: "chenprecision.example", industry: "Machinery Manufacturing", employees: 18 },
  { id: "lo-p4", name: "Sam Ortiz", title: "Chief Executive Officer", company: "Ortiz Metalworks", domain: "ortizmetal.example", industry: "Metal Manufacturing", employees: 60, phone: "+1 555 0104" },
  { id: "lo-p5", name: "Taylor Brooks", title: "Founder", company: "Brooks Textile Mill", domain: "brookstextile.example", industry: "Textile Manufacturing", employees: 95 },
  // Wrong geography
  { id: "lo-x1", name: "Morgan Hale", title: "CEO", company: "Hale Tooling GmbH", domain: "haletooling.example", industry: "Machinery Manufacturing", employees: 50, country: "Germany" },
  // Too large
  { id: "lo-x2", name: "Casey Ward", title: "CEO", company: "Ward Industrial", domain: "wardindustrial.example", industry: "Industrial Manufacturing", employees: 1400 },
  // Wrong industry
  { id: "lo-x3", name: "Drew Patel", title: "CEO", company: "Patel Software", domain: "patelsoftware.example", industry: "Computer Software", employees: 30 },
  // Excluded type
  { id: "lo-x4", name: "Quinn Rivers", title: "Founder", company: "Rivers Staffing", domain: "riversstaffing.example", industry: "Staffing and Recruiting", employees: 40 },
  // Wrong role
  { id: "lo-x5", name: "Blake Young", title: "Marketing Coordinator", company: "Young Fasteners", domain: "youngfasteners.example", industry: "Fastener Manufacturing", employees: 25 },
];
