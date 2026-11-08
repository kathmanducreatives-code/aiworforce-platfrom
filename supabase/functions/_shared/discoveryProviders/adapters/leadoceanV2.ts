// LEADOCEAN ADAPTER v2 — the DOCUMENTED endpoints, provider-neutral output (MRLE Phase 2).
//
// NOT WIRED INTO EXECUTION. The pilot is Apify-only with zero LeadOcean records; this adapter
// is exercised only by offline tests with a mocked fetch. Enabling it needs separate owner
// authorization, one approved single-row validation call, and the commercial-terms flag.
//
// Source: api.leadocean.io/openapi.json, api.leadocean.io/llms.txt, leadocean.io/docs/limits,
// /docs/filters (read 2026-11-07). The v1 adapter (adapters/leadocean.ts) calls paths LeadOcean
// now lists as deprecated (POST /v1/search, /v1/search/companies, /v1/enrich); v2 uses:
//   POST /v1/companies/count   free exact count                    0 records
//   POST /v1/companies/search  company rows; meta.nextCursor       1 record per row returned
//   POST /v1/companies/enrich  one company by domain / LinkedIn    1 record when found; 404 = not held
//   POST /v1/people/search     thin person rows (no contact data)  1 record per row returned
//   GET  /v1/usage             records used this period            free
// Auth: x-api-key (scopes "search", "enrich"). Paging: opaque signed cursor, never stored;
// limit 1–100; 410 = snapshot retired (restart); meta.depthCapped = no further pages.
// Rates: 429 + Retry-After; fair-use pacing X-Quota-State: paced (Retry-After: 60).
//
// Every row becomes CLAIMS with provenance (provider, record id, field, retrieved_at): a
// LeadOcean HQ, size, industry or funding value never qualifies a lead on its own (Agentory's
// own benchmark: HQ wrong for ~29% of companies). There is NO business-model or hiring filter.

import { callProvider, type FetchLike } from "../http.ts";
import { ProviderError } from "../types.ts";

export const LEADOCEAN_V2_BASE = "https://api.leadocean.io";

/** Provider-neutral company query (built by the planner from constraints, never by the interpreter). */
export interface CompanyQuery {
  hqCountry?: string[]; hqState?: string[]; industry?: string[]; excludeIndustry?: string[];
  employeeRange?: string[]; minEmployees?: number; maxEmployees?: number;
  fundingType?: string[]; minLastFundingYear?: number;
  domain?: string[]; linkedin?: string[]; keywords?: string[];
}
const COMPANY_FILTERS = new Set(["hqCountry", "hqState", "industry", "excludeIndustry", "employeeRange", "minEmployees", "maxEmployees", "fundingType", "minLastFundingYear", "domain", "linkedin", "keywords"]);
const EMPLOYEE_RANGES = new Set(["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"]);

export interface Claim { field: string; value: unknown; provider: "leadocean"; recordId: string; retrievedAt: string; strength: "claim" }
export interface CompanyClaimSet { recordId: string; name: string | null; domain: string | null; linkedinUrl: string | null; claims: Claim[] }
export interface PersonClaimSet { recordId: string; personGroupId: string | null; name: string | null; title: string | null; linkedinUrl: string | null; employerDomain: string | null; claims: Claim[] }
export interface Page<T> {
  rows: T[]; nextCursor: string | null;
  /** False when the provider stopped early (depth cap) — more matches exist than were returned. */
  complete: boolean; truncatedReason: "depth_cap" | null;
  /** Records billed for this page: from meta.credits, else the rows returned. */
  billedRecords: number; billedFrom: "provider_meta" | "rows_returned";
  /** Filters LeadOcean says it ignored for this query (they were NOT applied). */
  unsupportedFilters: string[];
  paced: boolean;
}

export class LeadOceanSchemaError extends Error { override name = "LeadOceanSchemaError"; }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (isObj(x) ? x[k] : Array.isArray(x) ? x[Number(k)] : undefined), o);

/** Validate a request against the documented filters BEFORE it is sent (a bad filter is never widened). */
export function companySearchBody(q: CompanyQuery, opts: { limit: number; cursor?: string | null; order?: "ranked" | "stable" }): Record<string, unknown> {
  for (const k of Object.keys(q)) if (!COMPANY_FILTERS.has(k)) throw new LeadOceanSchemaError(`unsupported company filter: ${k}`);
  for (const r of q.employeeRange ?? []) if (!EMPLOYEE_RANGES.has(r)) throw new LeadOceanSchemaError(`employeeRange "${r}" is not a documented band`);
  for (const c of [...(q.hqCountry ?? [])]) if (!/^[A-Z]{2}$/.test(c)) throw new LeadOceanSchemaError(`hqCountry "${c}" must be ISO alpha-2`);
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 100) throw new LeadOceanSchemaError("limit must be 1–100");
  return { ...q, limit: opts.limit, order: opts.order ?? "ranked", ...(opts.cursor ? { cursor: opts.cursor } : {}) };
}

function meta(json: unknown) {
  if (!isObj(json) || !Array.isArray(json.data) || !isObj(json.meta)) throw new LeadOceanSchemaError("response is not { data: [], meta: {} }");
  const m = json.meta;
  return {
    rows: json.data as unknown[],
    nextCursor: str(m.nextCursor),
    depthCapped: m.depthCapped === true,
    credits: typeof m.credits === "number" && Number.isFinite(m.credits) && m.credits >= 0 ? m.credits : null,
    unsupported: Array.isArray(m.unsupportedFilters) ? m.unsupportedFilters.map(String) : [],
  };
}

/**
 * FIELD PATHS: company_data.company_name, company_domain and naics_primary appear verbatim in
 * LeadOcean's docs; the other company_data paths are INFERRED from the documented naming (the
 * spec leaves company_data untyped). A path not found is simply absent (unknown), never
 * guessed — confirm them with one approved single-row call before enabling (see v1 FIELD_BASIS).
 */
export function companyClaims(row: unknown, retrievedAt: string): CompanyClaimSet {
  const recordId = str(at(row, "meta.source_ids.company_id")) ?? str(at(row, "company_data.company_id"));
  if (!recordId) throw new LeadOceanSchemaError("company row without a record id");
  const claim = (field: string, value: unknown): Claim[] => (value === null || value === undefined || value === "" ? [] : [{ field, value, provider: "leadocean", recordId, retrievedAt, strength: "claim" }]);
  const d = (k: string) => at(row, `company_data.${k}`);
  return {
    recordId, name: str(d("company_name")), domain: str(d("company_domain")), linkedinUrl: str(d("company_linkedin_url")),
    claims: [
      ...claim("industry", d("company_industry")), ...claim("naics_primary", d("naics_primary")),
      ...claim("hq_country", d("company_hq_country")), ...claim("hq_city", d("company_hq_city")),
      ...claim("employee_count", at(row, "company_metrics.number_of_employees") ?? d("number_of_employees")),
      ...claim("employee_range", d("company_employee_range")), ...claim("company_type", d("company_type")),
      ...claim("last_funding_type", d("last_funding_type")), ...claim("last_funding_year", d("last_funding_year")),
    ],
  };
}

export function personClaims(row: unknown, retrievedAt: string): PersonClaimSet {
  const recordId = str(at(row, "meta.source_ids.person_id"));
  if (!recordId) throw new LeadOceanSchemaError("person row without a record id");
  const exp = "contact_data.contact_current_experiences.0";
  const claim = (field: string, value: unknown): Claim[] => (value === null || value === undefined || value === "" ? [] : [{ field, value, provider: "leadocean", recordId, retrievedAt, strength: "claim" }]);
  return {
    recordId, personGroupId: str(at(row, "meta.source_ids.person_group_id")), name: str(at(row, "profile_data.profile_full_name")),
    title: str(at(row, `${exp}.title`)), linkedinUrl: str(at(row, "profile_data.profile_linkedin_url")), employerDomain: str(at(row, `${exp}.company_domain`)),
    // A headline is not a job title; the employer is the provider's claim until verified.
    claims: [...claim("title", at(row, `${exp}.title`)), ...claim("employer_domain", at(row, `${exp}.company_domain`)), ...claim("country", at(row, "profile_data.profile_country"))],
  };
}

export interface LeadOceanV2Deps { apiKey: string; fetch: FetchLike; baseUrl?: string; now?: () => Date; sleep?: (ms: number) => Promise<void> }

export function leadOceanV2(d: LeadOceanV2Deps) {
  const base = d.baseUrl ?? LEADOCEAN_V2_BASE;
  const headers = { "x-api-key": d.apiKey, "content-type": "application/json" };
  const now = () => (d.now ?? (() => new Date()))().toISOString();
  const post = (path: string, body: unknown, paid: boolean) =>
    callProvider(d.fetch, { provider: "leadocean", url: `${base}${path}`, method: "POST", headers, body, paid, maxRetries: 1 }, d.sleep);
  const page = <T>(r: Awaited<ReturnType<typeof post>>, map: (row: unknown, at: string) => T): Page<T> => {
    const m = meta(r.json);
    const retrievedAt = now();
    const rows = m.rows.map((x) => map(x, retrievedAt));
    return {
      rows, nextCursor: m.depthCapped ? null : m.nextCursor, complete: !m.depthCapped, truncatedReason: m.depthCapped ? "depth_cap" : null,
      billedRecords: m.credits ?? rows.length, billedFrom: m.credits !== null ? "provider_meta" : "rows_returned",
      unsupportedFilters: m.unsupported, paced: r.headers.get("x-quota-state") === "paced",
    };
  };
  return {
    /** Free exact count (0 records). */
    async countCompanies(q: CompanyQuery): Promise<{ total: number }> {
      const r = await post("/v1/companies/count", companySearchBody(q, { limit: 1 }), false);
      const total = at(r.json, "meta.total") ?? at(r.json, "data.total");
      if (typeof total !== "number") throw new LeadOceanSchemaError("count response carries no total");
      return { total };
    },
    async searchCompanies(q: CompanyQuery, p: { limit: number; cursor?: string | null }): Promise<Page<CompanyClaimSet>> {
      return page(await post("/v1/companies/search", companySearchBody(q, { ...p, order: p.cursor ? "stable" : "ranked" }), true), companyClaims);
    },
    /** One company; null when LeadOcean does not hold it (a 404 costs nothing). */
    async getCompany(ref: { domain?: string; linkedinUrl?: string }): Promise<CompanyClaimSet | null> {
      try {
        const r = await post("/v1/companies/enrich", { ...(ref.domain ? { domain: ref.domain } : {}), ...(ref.linkedinUrl ? { linkedin_url: ref.linkedinUrl } : {}) }, true);
        const row = isObj(r.json) ? (r.json as Record<string, unknown>).data : null;
        return row ? companyClaims(row, now()) : null;
      } catch (e) {
        if (e instanceof ProviderError && e.status === 404) return null;
        throw e;
      }
    },
    async searchPeople(q: Record<string, unknown>, p: { limit: number; cursor?: string | null }): Promise<Page<PersonClaimSet>> {
      if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100) throw new LeadOceanSchemaError("limit must be 1–100");
      return page(await post("/v1/people/search", { ...q, limit: p.limit, ...(p.cursor ? { cursor: p.cursor, order: "stable" } : { order: "ranked" }) }, true), personClaims);
    },
    /** Free: records used this period, for reconciling the ledger against what LeadOcean counted. */
    async usage(): Promise<{ used: number | null; period: string | null; plan: string | null }> {
      const r = await callProvider(d.fetch, { provider: "leadocean", url: `${base}/v1/usage`, method: "GET", headers, paid: false }, d.sleep);
      const j = isObj(r.json) && isObj((r.json as Record<string, unknown>).data) ? (r.json as { data: Record<string, unknown> }).data : (r.json as Record<string, unknown>) ?? {};
      return { used: typeof j.used === "number" ? j.used : null, period: str(j.period), plan: str(j.plan) };
    },
  };
}
