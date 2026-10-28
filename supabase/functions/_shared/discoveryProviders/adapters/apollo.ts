// Apollo adapter — prospect discovery.
//
// Contract (docs.apollo.io, read 2026-10-27):
//   auth     x-api-key
//   people   POST /api/v1/mixed_people/api_search   0 credits; returns NO emails
//            or phones (has_email / has_direct_phone flags only) and the
//            organization's name only; 100/page, 500 pages; 600 calls/hour;
//            person_titles + person_not_titles < 100 or 422
//   orgs     POST /api/v1/mixed_companies/search    1 credit per page
//
// include_similar_titles is always false: Apollo's title expansion is a
// broadening the user did not ask for. Contact values need Apollo's paid
// enrichment, which this layer does not call — enrichment is LeadOcean's,
// behind its own authorization (`enrich.ts`).

import { pickNum, pickStr, type AdapterDeps, type DiscoveryAdapter, type SearchPage, type UsageInfo } from "../adapter.ts";
import { callProvider } from "../http.ts";
import type { PlanStep } from "../routing.ts";
import type { DiscoveryRequirements, ProviderCompany, ProviderPerson, Range } from "../types.ts";

export const APOLLO_BASE = "https://api.apollo.io";
const MAX_PAGES = 500;

function sizeRange(r: Range): string {
  return `${r.min ?? 1},${r.max ?? 1_000_000}`;
}

export function buildApolloSearch(step: PlanStep, req: DiscoveryRequirements, page: number, perPage: number) {
  const body: Record<string, unknown> = { page, per_page: Math.max(1, Math.min(100, perPage)) };
  const native = new Set(step.requirements.filter((r) => r.handling === "native").map((r) => r.key));
  for (const h of req.hard) {
    if (!native.has(h.key)) continue;
    const list = Array.isArray(h.values) ? h.values : [];
    switch (h.key) {
      case "roles": body.person_titles = list.slice(0, 99); body.include_similar_titles = false; break;
      case "geography_hq": body.organization_locations = list; break;
      case "excluded_geography": body.organization_not_locations = list; break;
      case "geography_person": body.person_locations = list; break;
      case "employee_range": body.organization_num_employees_ranges = [sizeRange(h.values as Range)]; break;
      case "known_companies": body.q_organization_domains_list = list.slice(0, 1000); break;
    }
  }
  if (step.kind === "people_search" && !body.person_titles && req.roles.length) {
    body.person_titles = req.roles.slice(0, 99);
    body.include_similar_titles = false;
  }
  return { path: step.kind === "people_search" ? "/api/v1/mixed_people/api_search" : "/api/v1/mixed_companies/search", body };
}

export function normalizeApolloPage(json: unknown, step: PlanStep, page: number, perPage: number, at: string): SearchPage {
  const j = (json ?? {}) as Record<string, unknown>;
  const asserted = step.requirements.filter((r) => r.handling === "native").map((r) => r.key);
  const companies: ProviderCompany[] = [];
  const people: ProviderPerson[] = [];
  const org = (o: unknown): ProviderCompany | null => {
    const name = pickStr(o, ["name"]);
    const domain = pickStr(o, ["primary_domain"]) ?? (pickStr(o, ["website_url"])?.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0] ?? null);
    if (!name && !domain) return null;
    return {
      provider: "apollo", recordId: pickStr(o, ["id"]) ?? `name:${name}`, retrievedAt: at,
      name, domain, linkedinUrl: pickStr(o, ["linkedin_url"]),
      // Not in the documented schema; read only when present.
      industry: pickStr(o, ["industry"]) ? [pickStr(o, ["industry"])!] : null,
      employeeCount: pickNum(o, ["estimated_num_employees"]),
      hqCountry: pickStr(o, ["country"]), hqRegion: pickStr(o, ["state"]), hqCity: pickStr(o, ["city"]),
      foundedYear: pickNum(o, ["founded_year"]),
      assertedFilters: asserted, ignoredFilters: [],
    };
  };
  if (step.kind === "people_search") {
    for (const p of Array.isArray(j.people) ? j.people : []) {
      const id = pickStr(p, ["id"]);
      if (!id) continue;
      const first = pickStr(p, ["first_name"]);
      people.push({
        provider: "apollo", recordId: id, retrievedAt: at,
        providerUpdatedAt: pickStr(p, ["last_refreshed_at"]),
        // Apollo obfuscates the last name in search; the full name is not known.
        fullName: null, firstName: first, title: pickStr(p, ["title"]),
        company: org((p as { organization?: unknown }).organization),
        hasEmail: (p as { has_email?: boolean }).has_email ?? null,
        hasPhone: (p as { has_direct_phone?: unknown }).has_direct_phone === true || (p as { has_direct_phone?: unknown }).has_direct_phone === "Yes",
        contactPoints: [],
        assertedFilters: asserted, ignoredFilters: [],
      });
    }
  } else {
    for (const o of Array.isArray(j.organizations) ? j.organizations : []) { const c = org(o); if (c) companies.push(c); }
  }
  const total = pickNum(j, ["total_entries", "pagination.total_entries"]);
  const rows = step.kind === "people_search" ? people.length : companies.length;
  const more = rows === perPage && page < MAX_PAGES && (total === null || page * perPage < total);
  return {
    companies, people,
    nextCursor: more ? String(page + 1) : null,
    creditsCharged: step.kind === "people_search" ? 0 : 1,
    ignoredFilters: [],
    total,
  };
}

export function apolloAdapter(deps: AdapterDeps): DiscoveryAdapter {
  const base = deps.baseUrl ?? APOLLO_BASE;
  const now = deps.now ?? (() => new Date());
  const headers = { "x-api-key": deps.apiKey, "cache-control": "no-cache" };
  return {
    provider: "apollo",
    async search(step, req, cursor, limit) {
      const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
      const { path, body } = buildApolloSearch(step, req, page, limit);
      const r = await callProvider(deps.fetch, {
        provider: "apollo", url: `${base}${path}`, method: "POST", headers, body,
        paid: step.kind !== "people_search",
      }, deps.sleep);
      return normalizeApolloPage(r.json, step, page, limit, now().toISOString());
    },
    async verifyKey(): Promise<UsageInfo> {
      // People API Search is documented as consuming no credits: one row proves the key.
      await callProvider(deps.fetch, {
        provider: "apollo", url: `${base}/api/v1/mixed_people/api_search`, method: "POST", headers,
        body: { page: 1, per_page: 1 }, paid: false, maxRetries: 0,
      }, deps.sleep);
      return { plan: null, used: null, limit: null, remaining: null, resetsAt: null, checkedAt: now().toISOString() };
    },
  };
}
