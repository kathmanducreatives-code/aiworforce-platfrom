// What each provider can do, filter on, return, and cost — as data.
//
// The router (`routing.ts`) decides from this table alone; the adapters must
// agree with it (tests/edge-functions/_shared/discoveryProviders.test.ts checks
// that every native filter listed here is one the adapter actually sends).
//
// Sources, read 2026-10-27:
//   Apollo     docs.apollo.io — People API Search (POST /api/v1/mixed_people/api_search,
//              0 credits, no emails/phones, 100/page, 500 pages, 600/h) and
//              Organization Search (POST /api/v1/mixed_companies/search, 1 credit/page).
//   LeadOcean  api.leadocean.io/openapi.json — /v1/search, /v1/search/companies
//              (1 record per row returned; count=true&limit=1 free), /v1/enrich
//              and contact endpoints (1 record per call, found or not), /v1/usage.
//   Apify      the existing actor registry (_shared/actorRegistry.ts); priced
//              per actor run, run through the existing guarded invoker.
//
// Pure.

import type { FilterKey, ProviderCapability, ProviderId } from "./types.ts";

export type SearchKind = "company_search" | "people_search";

export interface CostModel {
  /** What one unit is. */
  unit: "record" | "page" | "call" | "run" | "free";
  /** Provider credits per unit. */
  creditsPerUnit: number;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapability[];
  /** Filters the provider applies itself, per search kind. */
  native: Partial<Record<SearchKind, FilterKey[]>>;
  /** Fields its rows carry, so Agentory can check a requirement itself. */
  returnsFields: Partial<Record<SearchKind, FilterKey[]>>;
  cost: Partial<Record<SearchKind | "contact_enrichment" | "signal_verification", CostModel>>;
  limits: { maxPageSize: number; maxPages: number; requestsPerHour: number | null };
  /** Contact values (emails/phones) come back in search rows. */
  searchReturnsContactValues: boolean;
  /** Customer-facing use needs a confirmed commercial agreement before it is enabled. */
  requiresCommercialTermsFlag: boolean;
  docs: string;
}

const ALL_COMPANY_FIELDS: FilterKey[] = ["industry", "geography_hq", "employee_range", "known_companies", "excluded_company_types", "excluded_geography"];

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  apollo: {
    id: "apollo",
    label: "Apollo",
    capabilities: ["people_search", "company_search"],
    native: {
      // person_titles, organization_locations, organization_not_locations,
      // organization_num_employees_ranges, q_organization_domains_list,
      // q_organization_keyword_tags (industry as keyword tags — see below).
      people_search: ["roles", "geography_hq", "excluded_geography", "employee_range", "known_companies", "geography_person"],
      company_search: ["geography_hq", "excluded_geography", "employee_range"],
    },
    // People API Search returns the organization's NAME and has_* flags only,
    // so size / location / industry cannot be re-checked from its rows.
    returnsFields: {
      people_search: ["roles"],
      company_search: ["known_companies"],
    },
    cost: {
      people_search: { unit: "free", creditsPerUnit: 0 },
      company_search: { unit: "page", creditsPerUnit: 1 },
    },
    limits: { maxPageSize: 100, maxPages: 500, requestsPerHour: 600 },
    searchReturnsContactValues: false,
    requiresCommercialTermsFlag: true,
    docs: "https://docs.apollo.io/reference/people-api-search",
  },
  leadocean: {
    id: "leadocean",
    label: "LeadOcean",
    capabilities: ["people_search", "company_search", "contact_enrichment"],
    native: {
      people_search: ["roles", "industry", "geography_hq", "geography_person", "employee_range", "known_companies", "excluded_company_types"],
      company_search: ["industry", "geography_hq", "employee_range", "known_companies", "excluded_company_types"],
    },
    returnsFields: {
      people_search: ["roles", "geography_person", ...ALL_COMPANY_FIELDS],
      company_search: ALL_COMPANY_FIELDS,
    },
    cost: {
      people_search: { unit: "record", creditsPerUnit: 1 },
      company_search: { unit: "record", creditsPerUnit: 1 },
      contact_enrichment: { unit: "call", creditsPerUnit: 1 },
    },
    limits: { maxPageSize: 100, maxPages: 100, requestsPerHour: null },
    searchReturnsContactValues: true,
    requiresCommercialTermsFlag: true,
    docs: "https://leadocean.io/docs",
  },
  apify: {
    id: "apify",
    label: "Apify",
    capabilities: ["web_research", "signal_verification", "company_search"],
    // Web research takes a query string; no structured filter is applied.
    native: { company_search: [] },
    // A company page read can confirm what the site says about itself.
    returnsFields: { company_search: ["industry", "excluded_company_types", "known_companies"] },
    cost: {
      company_search: { unit: "run", creditsPerUnit: 1 },
      signal_verification: { unit: "run", creditsPerUnit: 1 },
    },
    limits: { maxPageSize: 50, maxPages: 2, requestsPerHour: null },
    searchReturnsContactValues: false,
    requiresCommercialTermsFlag: false,
    docs: "supabase/functions/_shared/actorRegistry.ts",
  },
};

/**
 * Provider filters trusted to satisfy a requirement WITHOUT a returned value.
 * EMPTY: no filter is trusted until a live, approved check shows the provider
 * applies it (and reports when it does not) — LeadOcean's industry vocabulary,
 * for one, is unconfirmed, and Apollo never reports an ignored filter. Adding
 * an entry is a reviewed change, never a runtime setting.
 */
export const TRUSTED_PROVIDER_FILTERS: Readonly<Partial<Record<ProviderId, FilterKey[]>>> = Object.freeze({});

/** Requirements a signal-verification provider can settle after discovery. */
export const SIGNAL_VERIFIABLE: FilterKey[] = ["signal"];
