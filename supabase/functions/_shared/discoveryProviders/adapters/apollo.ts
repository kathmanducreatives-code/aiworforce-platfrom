// Apollo adapter — prospect discovery.
//
// Contract (docs.apollo.io, re-read 2026-10-30):
//   auth     x-api-key (a master key for usage_stats)
//   params   QUERY parameters, arrays as `name[]` — both search endpoints declare
//            every filter `in: query`; a JSON body is not the documented contract
//   people   POST /api/v1/mixed_people/api_search   0 credits; returns NO emails
//            or phones (has_email / has_direct_phone flags only) and the
//            organization's NAME only (no id, no domain); top-level total_entries;
//            100/page, 500 pages; person_titles + person_not_titles < 100 or 422.
//            NOT available on every plan: a Professional (Trial) team gets 403
//            API_INACCESSIBLE (observed 2026-10-30).
//   orgs     POST /api/v1/mixed_companies/search    1 credit per page (≤ 100 rows);
//            rows in BOTH `organizations` and `accounts` (companies already in the
//            team's Apollo account); pagination.total_entries. The rows carry NO
//            headquarters, size or industry fields: Apollo can FILTER on those but
//            never returns them here, so they are never evidence from this search.
//   usage    POST /api/v1/usage_stats/api_usage_stats  no credits; master key
//   paging   page × per_page: per_page must stay constant across a walk, or rows
//            repeat or are skipped — a short last page is truncated client-side.
//
// include_similar_titles is always false: Apollo's title expansion is a
// broadening the user did not ask for. Contact values need Apollo's paid
// enrichment, which this adapter cannot reach (ALLOWED_PATHS).

import { pickNum, pickStr, type AdapterDeps, type DiscoveryAdapter, type SearchPage, type UsageInfo } from "../adapter.ts";
import { callProvider } from "../http.ts";
import type { PlanStep } from "../routing.ts";
import { ProviderError, type DiscoveryRequirements, type ProviderCompany, type ProviderPerson } from "../types.ts";
import { translate } from "../vocabulary.ts";

export const APOLLO_BASE = "https://api.apollo.io";
const MAX_PAGES = 500;
const PEOPLE = "/api/v1/mixed_people/api_search";
const ORGS = "/api/v1/mixed_companies/search";
const USAGE = "/api/v1/usage_stats/api_usage_stats";

/**
 * Every path this adapter may call. Enrichment, "add to my prospects",
 * contacts, sequences, job postings (1 credit/page) and anything else with a
 * side effect or a price this layer has not approved are unreachable.
 */
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([PEOPLE, ORGS, USAGE]);

/** Query string with Apollo's `name[]` array convention. */
export function apolloQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) q.append(`${k}[]`, String(x));
    else q.append(k, String(v));
  }
  return q.toString();
}

export function buildApolloSearch(step: PlanStep, req: DiscoveryRequirements, page: number) {
  const params: Record<string, unknown> = { page, per_page: Math.max(1, Math.min(100, step.pageSize)) };
  const native = new Set(step.requirements.filter((r) => r.handling === "native").map((r) => r.key));
  for (const h of req.hard) {
    if (!native.has(h.key)) continue;
    const t = translate("apollo", step.kind, h);
    // The router only marks a requirement native when it translates; a miss here is a bug, not a broadening.
    if (!t.ok) throw new ProviderError("apollo", "invalid_request", `planned filter no longer translates: ${t.reason}`);
    Object.assign(params, t.params);
  }
  if (step.kind === "people_search" && !params.person_titles && req.roles.length) {
    params.person_titles = req.roles.slice(0, 99);
    params.include_similar_titles = false;
  }
  return { path: step.kind === "people_search" ? PEOPLE : ORGS, params };
}

function org(o: unknown, at: string, asserted: ProviderCompany["assertedFilters"]): ProviderCompany | null {
  const name = pickStr(o, ["name"]);
  const domain = pickStr(o, ["primary_domain", "domain"]) ?? (pickStr(o, ["website_url"])?.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0] ?? null);
  if (!name && !domain) return null;
  // An `accounts` row is the team's copy of an organization: its organization_id is the shared id.
  const id = pickStr(o, ["organization_id", "id"]);
  return {
    provider: "apollo", recordId: id ?? `domain:${domain ?? name}`, retrievedAt: at,
    name, domain, linkedinUrl: pickStr(o, ["linkedin_url"]),
    // Not in the documented search schema; read only if Apollo ever sends them.
    industry: pickStr(o, ["industry"]) ? [pickStr(o, ["industry"])!] : null,
    employeeCount: pickNum(o, ["estimated_num_employees"]),
    hqCountry: pickStr(o, ["country"]), hqRegion: pickStr(o, ["state"]), hqCity: pickStr(o, ["city"]),
    foundedYear: pickNum(o, ["founded_year"]),
    assertedFilters: asserted, ignoredFilters: [],
  };
}

/**
 * Normalize one page. `limit` may be smaller than the page Apollo returned (the
 * step's last page): rows beyond it are dropped here, never re-requested with a
 * smaller per_page (which would shift Apollo's offset).
 */
export function normalizeApolloPage(json: unknown, step: PlanStep, page: number, limit: number, at: string): SearchPage {
  const j = (json ?? {}) as Record<string, unknown>;
  const perPage = Math.max(1, Math.min(100, step.pageSize));
  const asserted = step.requirements.filter((r) => r.handling === "native").map((r) => r.key);
  const companies: ProviderCompany[] = [];
  const people: ProviderPerson[] = [];
  let returned = 0;
  if (step.kind === "people_search") {
    const rows = Array.isArray(j.people) ? j.people : [];
    returned = rows.length;
    for (const p of rows) {
      const id = pickStr(p, ["id"]);
      if (!id) continue;
      const orgName = pickStr(p, ["organization.name"]);
      people.push({
        provider: "apollo", recordId: id, retrievedAt: at,
        providerUpdatedAt: pickStr(p, ["last_refreshed_at"]),
        // Apollo obfuscates the last name in search; the full name is not known.
        fullName: null, firstName: pickStr(p, ["first_name"]), title: pickStr(p, ["title"]),
        // The employer by NAME only: no id or domain, so it can never merge with
        // another provider's company or establish identity on its own.
        company: orgName ? {
          provider: "apollo", recordId: `org-name:${orgName.toLowerCase()}`, retrievedAt: at, name: orgName, domain: null,
          assertedFilters: asserted, ignoredFilters: [],
        } : null,
        hasEmail: (p as { has_email?: boolean }).has_email ?? null,
        hasPhone: (p as { has_direct_phone?: unknown }).has_direct_phone === true || (p as { has_direct_phone?: unknown }).has_direct_phone === "Yes",
        contactPoints: [],
        assertedFilters: asserted, ignoredFilters: [],
      });
    }
  } else {
    const seen = new Set<string>();
    const rows = [...(Array.isArray(j.organizations) ? j.organizations : []), ...(Array.isArray(j.accounts) ? j.accounts : [])];
    returned = rows.length;
    for (const o of rows) {
      const c = org(o, at, asserted);
      if (!c || seen.has(c.recordId)) continue;
      seen.add(c.recordId);
      companies.push(c);
    }
  }
  const total = pickNum(j, ["pagination.total_entries", "total_entries"]);
  const more = returned >= perPage && page < MAX_PAGES && (total === null || page * perPage < total);
  return {
    companies: companies.slice(0, limit), people: people.slice(0, limit),
    nextCursor: more ? String(page + 1) : null,
    creditsCharged: step.kind === "people_search" ? 0 : 1,
    ignoredFilters: [],
    total,
  };
}

async function post(deps: AdapterDeps, path: string, params: Record<string, unknown>, paid: boolean, maxRetries?: number) {
  if (!ALLOWED_PATHS.has(path)) throw new ProviderError("apollo", "invalid_request", `${path} is not an endpoint this adapter may call`);
  const base = deps.baseUrl ?? APOLLO_BASE;
  const qs = apolloQuery(params);
  return await callProvider(deps.fetch, {
    provider: "apollo", url: `${base}${path}${qs ? `?${qs}` : ""}`, method: "POST",
    headers: { "x-api-key": deps.apiKey, "cache-control": "no-cache" }, paid, ...(maxRetries === undefined ? {} : { maxRetries }),
  }, deps.sleep);
}

export function apolloAdapter(deps: AdapterDeps): DiscoveryAdapter {
  const now = deps.now ?? (() => new Date());
  return {
    provider: "apollo",
    async search(step, req, cursor, limit) {
      const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
      const { path, params } = buildApolloSearch(step, req, page);
      const r = await post(deps, path, params, step.kind !== "people_search");
      return normalizeApolloPage(r.json, step, page, limit, now().toISOString());
    },
    /**
     * Free checks only. `auth/health` is not used: it carries no account
     * detail, and behind a credential-injecting proxy it reports a login for
     * any header. usage_stats proves a master key; a one-row People API Search
     * (0 credits) says whether the plan includes it. A plan restriction is
     * reported, not treated as a bad key.
     */
    async verifyKey(): Promise<UsageInfo> {
      const restrictions: string[] = [];
      let master = true;
      try {
        await post(deps, USAGE, {}, false, 0);
      } catch (e) {
        if (!(e instanceof ProviderError) || e.kind === "auth_failed") throw e;
        if (e.kind !== "forbidden_scope" && e.kind !== "plan_restricted") throw e;
        master = false;
        restrictions.push("usage_stats: not a master key");
      }
      try {
        await post(deps, PEOPLE, { page: 1, per_page: 1 }, false, 0);
      } catch (e) {
        if (!(e instanceof ProviderError) || e.kind === "auth_failed") throw e;
        if (e.kind !== "forbidden_scope" && e.kind !== "plan_restricted") throw e;
        // Neither call worked: nothing proves this key.
        if (!master) throw e;
        restrictions.push(`people_search: ${e.kind === "plan_restricted" ? "not in this plan" : "not in this key's scope"}`);
      }
      return { plan: null, used: null, limit: null, remaining: null, resetsAt: null, checkedAt: now().toISOString(), restrictions };
    },
  };
}
