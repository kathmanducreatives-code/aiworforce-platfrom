// LeadOcean adapter — people + company search, usage, and (separately
// authorized) contact enrichment.
//
// Contract: https://api.leadocean.io/openapi.json (read 2026-10-27; request side
// re-checked 2026-10-30 against spec sha256 743a760a…, vocabulary/leadocean.json).
//   filters  hqCountry / country are ISO alpha-2 ENUMS and industry a closed enum
//            of labels: every value goes through vocabulary.translate, so a value
//            LeadOcean cannot filter on refuses the provider instead of widening
//            a per-record-billed search. Companies take `linkedin`, people
//            `companyLinkedin`, for exact identity.
//   auth     x-api-key; key scopes `search` and `enrich` (403 without one)
//   search   POST /v1/search            people     1 record per row returned
//            POST /v1/search/companies  companies  1 record per row returned
//            count=true&limit=1 is free (meta.countOnly)
//   enrich   POST /v1/enrich, /v2/people/email/work, /v2/people/phone
//            1 record per call, found or not
//   usage    GET /v1/usage              free; used to verify a key
//   paging   meta.nextCursor (signed); 410 = snapshot retired
//   meta     credits, unsupportedFilters (a filter the index ignored)
//
// `profile_data` and `company_data` are untyped in the spec. Every field read
// from them goes through FIELDS below — ONE table, so confirming the real names
// (one approved single-row call, see docs/PROVIDER_DISCOVERY.md) is one edit.
// A field not found is simply absent; verification then treats the
// requirement as unknown, never as met.

import { translate } from "../vocabulary.ts";
import { pick, pickList, pickNum, pickStr, parseRange, type AdapterDeps, type DiscoveryAdapter, type SearchPage, type UsageInfo } from "../adapter.ts";
import { callProvider } from "../http.ts";
import type { PlanStep } from "../routing.ts";
import { ProviderError, type ContactPoint, type DiscoveryRequirements, type FilterKey, type ProviderCompany, type ProviderPerson, type Range } from "../types.ts";

export const LEADOCEAN_BASE = "https://api.leadocean.io";

/**
 * Where each field lives, and HOW WE KNOW. `profile_data` / `company_data` are
 * untyped in the OpenAPI spec, so every path carries its basis:
 *
 *   documented  shown in LeadOcean's own published example payloads
 *               (leadocean.io enrich example; blog "enrich-linkedin-urls-curl";
 *               the spec's `fields` examples), read 2026-10-31
 *   catalogue   the column exists in GET /v1/exports/columns as a thin-search
 *               column (search: true); the JSON key follows the documented
 *               naming of its neighbours
 *   inferred    named by the MCP tool description or the spec's prose, key not shown
 *
 * Paths are tried in order; a field none of them finds stays ABSENT (unknown),
 * never guessed from a neighbouring field. Industry and NAICS are separate
 * fields: a NAICS sector code is never an industry label. A person's headline
 * is not a job title. Validation test V2 confirms the inferred paths.
 */
const EXP = "contact_data.contact_current_experiences.0";
/**
 * `observed`: present in a real LeadOcean row (validation test V, 2026-10-31:
 * one company record via /v1/companies/enrich, one thin people row via
 * /v1/search, slim off). Outranks every other basis.
 */
export const FIELD_BASIS: Readonly<Record<string, "observed" | "documented" | "catalogue" | "inferred">> = Object.freeze({
  "meta.source_ids.person_id": "observed", "meta.source_ids.company_id": "observed", "meta.source_ids.person_group_id": "observed",
  "profile_data.profile_full_name": "observed", "profile_data.profile_first_name": "observed", "profile_data.profile_headline": "observed",
  "profile_data.profile_url": "observed", "profile_data.profile_address.country_code": "observed",
  [`${EXP}.job_title`]: "observed", [`${EXP}.current`]: "observed", [`${EXP}.job_seniority.job_level`]: "observed",
  [`${EXP}.company_name`]: "observed", [`${EXP}.company_domain`]: "observed", [`${EXP}.company_industry`]: "observed",
  [`${EXP}.company_employees.number_of_employees`]: "observed", [`${EXP}.company_social_links.linkedin.url`]: "observed",
  "company_data.company_id": "observed", "company_data.company_name": "observed", "company_data.company_domain": "observed",
  "company_data.company_industries": "observed", "company_data.naics_sector": "observed", "company_data.naics_primary": "observed",
  "company_data.company_employees.number_of_employees": "observed", "company_data.company_social_links.linkedin.url": "observed",
  "company_data.company_primary_address.country_code": "observed", "company_data.company_primary_address.state": "observed",
  "company_data.company_primary_address.city": "observed", "company_data.company_profile.date_founded": "observed",
  "company_data.company_funding": "observed", "meta.fetched_at": "observed",
});

export const FIELDS = {
  personId: ["meta.source_ids.person_id"],
  personGroupId: ["meta.source_ids.person_group_id"],
  fullName: ["profile_data.profile_full_name"],
  firstName: ["profile_data.profile_first_name"],
  // The CURRENT role's title. The headline is kept apart and never read as a title.
  title: [`${EXP}.job_title`],
  headline: ["profile_data.profile_headline"],
  seniority: [`${EXP}.job_seniority.job_level`],
  linkedin: ["profile_data.profile_url"],
  personCountry: ["profile_data.profile_address.country_code"],
  // meta.fetched_at is when LeadOcean SERVED the record (V: the second of the
  // request) — not when its data was updated. LeadOcean publishes no
  // data-update stamp, so it is never read as freshness.
  servedAt: ["meta.fetched_at"],
  companyId: ["company_data.company_id", "meta.source_ids.company_id"],
  companyName: ["company_data.company_name"],
  companyDomain: ["company_data.company_domain"],
  companyLinkedin: ["company_data.company_social_links.linkedin.url"],
  // An ARRAY of { name3: label, name2: slug }: name3 is the enum label.
  industries: ["company_data.company_industries"],
  naicsSector: ["company_data.naics_sector"],
  naicsPrimary: ["company_data.naics_primary"],
  keywords: ["company_data.company_tags"],
  hqCountry: ["company_data.company_primary_address.country_code"],
  hqRegion: ["company_data.company_primary_address.state"],
  hqCity: ["company_data.company_primary_address.city"],
  employees: ["company_data.company_employees.number_of_employees"],
  employeesMin: ["company_data.company_employees.number_of_employees_min"],
  employeesMax: ["company_data.company_employees.number_of_employees_max"],
  founded: ["company_data.company_profile.date_founded"],
  funding: ["company_data.company_funding"],
  // The employer as a PEOPLE row states it (contact_current_experiences[0]); no HQ is carried there.
  expCompanyId: ["meta.source_ids.company_id"],
  expCompanyName: [`${EXP}.company_name`],
  expCompanyDomain: [`${EXP}.company_domain`],
  expCompanyLinkedin: [`${EXP}.company_social_links.linkedin.url`],
  expIndustry: [`${EXP}.company_industry`],
  expEmployees: [`${EXP}.company_employees.number_of_employees`],
  expEmployeesMin: [`${EXP}.company_employees.number_of_employees_min`],
  expEmployeesMax: [`${EXP}.company_employees.number_of_employees_max`],
  expCurrent: [`${EXP}.current`],
} as const;

/** Our filter → LeadOcean's search parameter names (for meta.unsupportedFilters). */
const PARAM_OF: Record<string, FilterKey> = {
  title: "roles", country: "geography_person", industry: "industry", excludeIndustry: "excluded_company_types",
  excludeKeywords: "excluded_company_types", hqCountry: "geography_hq", hqState: "geography_hq", hqCity: "geography_hq",
  minEmployees: "employee_range", maxEmployees: "employee_range", domain: "known_companies",
  linkedin: "known_companies", companyLinkedin: "known_companies", fundingType: "company_stage",
};

/** Filters an ICP may add to NARROW a search. None of them can widen it. */
const PEOPLE_HINTS: ReadonlySet<string> = new Set(["industry", "companyKeywords", "seniority", "jobLevel", "jobFunction", "excludeIds", "hasPhone", "employeeRange"]);
const COMPANY_HINTS: ReadonlySet<string> = new Set(["industry", "keywords", "employeeRange", "companyType"]);

export function buildLeadOceanSearch(step: PlanStep, req: DiscoveryRequirements, cursor: string | null, limit: number) {
  // Each page asks only for what the step may still take: billing is per row returned.
  // ORDER. `ranked` (LeadOcean's default) returns the best matches first: what a
  // discovery page should contain. `stable` is id order on a pinned snapshot —
  // the right choice only for walking a whole result set across pages, where it
  // keeps the cursor consistent. A single-page step asks for relevance.
  const body: Record<string, unknown> = { limit: Math.max(1, Math.min(100, limit)), order: step.maxPages > 1 ? "stable" : "ranked" };
  if (cursor) body.cursor = cursor;
  // slim stays OFF: validation test V read the full thin row (slim false) and
  // it carries the employer's headcount; slim's dropped parts are not
  // documented field by field. Pictures are removed by redactLeadOceanRow.
  body.slim = false;
  const native = new Set(step.requirements.filter((r) => r.handling === "native").map((r) => r.key));
  for (const h of req.hard) {
    if (!native.has(h.key)) continue;
    const t = translate("leadocean", step.kind, h);
    // The router marks a requirement native only when it translates; a miss is a bug, never a broadening.
    if (!t.ok) throw new ProviderError("leadocean", "invalid_request", `planned filter no longer translates: ${t.reason}`);
    for (const [k, v] of Object.entries(t.params)) {
      body[k] = Array.isArray(v) && Array.isArray(body[k]) ? [...(body[k] as unknown[]), ...v] : v;
    }
  }
  // Narrowing hints: only allow-listed keys, never one a requirement already set.
  for (const [k, v] of Object.entries(req.providerHints?.leadocean ?? {})) {
    const allowed = step.kind === "people_search" ? PEOPLE_HINTS : COMPANY_HINTS;
    if (!allowed.has(k)) throw new ProviderError("leadocean", "invalid_request", `hint ${k} is not an allowed narrowing filter`);
    if (k in body && k !== "excludeIds") continue;
    body[k] = v;
  }
  // Roles of a company-target mission still narrow the people search.
  if (step.kind === "people_search" && !body.title && req.roles.length) body.title = req.roles;
  return { path: step.kind === "people_search" ? "/v1/search" : "/v1/search/companies", body };
}

/** A full date only when the provider gives one; a year alone stays a year. */
function fundingFrom(row: unknown): ProviderCompany["funding"] {
  // company_data.company_funding: { last_round_type, last_round_date, last_round_year, total_raised_usd, lead_investors }.
  const f = pick(row, FIELDS.funding) as Record<string, unknown> | null;
  if (!f || typeof f !== "object") return null;
  const d = typeof f.last_round_date === "string" ? f.last_round_date : null;
  const out = {
    lastRoundType: typeof f.last_round_type === "string" && f.last_round_type.trim() ? f.last_round_type.trim() : null,
    lastRoundYear: typeof f.last_round_year === "number" ? f.last_round_year : null,
    // A full date only when the provider gives one; a year alone stays a year.
    roundDate: d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null,
    totalUsd: typeof f.total_raised_usd === "number" ? f.total_raised_usd : null,
    lastRoundUsd: null,
  };
  return out.lastRoundType || out.lastRoundYear || out.roundDate || out.totalUsd ? out : null;
}

/** company_industries[].name3 — the enum labels. name2 is a slug and is not an industry label. */
function industriesFrom(row: unknown): string[] | null {
  const list = pick(row, FIELDS.industries);
  if (!Array.isArray(list)) return null;
  const labels = list.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>).name3 : null))
    .filter((x): x is string => typeof x === "string" && !!x.trim());
  return labels.length ? labels : null;
}

function bandFrom(row: unknown, min: readonly string[], max: readonly string[]): ProviderCompany["employeeRange"] {
  const lo = pickNum(row, min), hi = pickNum(row, max);
  return lo === null && hi === null ? null : { min: lo, max: hi };
}

const yearOf = (v: string | null) => (v && /^\d{4}/.test(v) ? Number(v.slice(0, 4)) : null);

/** A company RECORD row (company search / lookup): company_data. */
function companyFrom(row: unknown, at: string, ignored: FilterKey[], asserted: FilterKey[]): ProviderCompany | null {
  const name = pickStr(row, FIELDS.companyName);
  const domain = pickStr(row, FIELDS.companyDomain);
  if (!name && !domain) return null;
  return {
    provider: "leadocean",
    recordId: pickStr(row, FIELDS.companyId) ?? `domain:${domain ?? name}`,
    // No data-update stamp exists; meta.fetched_at is the serve time, not freshness.
    retrievedAt: at, providerUpdatedAt: null,
    name, domain,
    linkedinUrl: pickStr(row, FIELDS.companyLinkedin),
    industry: industriesFrom(row),
    naicsSector: pickStr(row, FIELDS.naicsSector), naicsPrimary: pickStr(row, FIELDS.naicsPrimary),
    keywords: pickList(row, FIELDS.keywords),
    hqCountry: pickStr(row, FIELDS.hqCountry),
    hqRegion: pickStr(row, FIELDS.hqRegion),
    hqCity: pickStr(row, FIELDS.hqCity),
    employeeCount: pickNum(row, FIELDS.employees),
    employeeRange: bandFrom(row, FIELDS.employeesMin, FIELDS.employeesMax),
    foundedYear: yearOf(pickStr(row, FIELDS.founded)),
    funding: fundingFrom(row),
    ignoredFilters: ignored,
    assertedFilters: asserted,
  };
}

/** The EMPLOYER as a people row states it (contact_current_experiences[0]); no HQ is carried there. */
function employerFrom(row: unknown, at: string, ignored: FilterKey[], asserted: FilterKey[]): ProviderCompany | null {
  const name = pickStr(row, FIELDS.expCompanyName);
  const domain = pickStr(row, FIELDS.expCompanyDomain);
  if (!name && !domain) return null;
  const id = pickStr(row, FIELDS.expCompanyId);
  return {
    // The people row names the employer's LeadOcean company_id: the same record id a company lookup returns.
    provider: "leadocean", recordId: id ?? `domain:${domain ?? name}`, retrievedAt: at, providerUpdatedAt: null,
    name, domain, linkedinUrl: pickStr(row, FIELDS.expCompanyLinkedin),
    industry: pickList(row, FIELDS.expIndustry),
    employeeCount: pickNum(row, FIELDS.expEmployees),
    employeeRange: bandFrom(row, FIELDS.expEmployeesMin, FIELDS.expEmployeesMax),
    ignoredFilters: ignored, assertedFilters: asserted,
  };
}

/**
 * The row as received, minus what is not needed to replay it: contact VALUES
 * (an address or number is replaced by its type and status only) and picture
 * blocks. Names, titles, employers and LeadOcean's ids stay — they are what a
 * re-parse needs. Used to keep paid pages replayable offline.
 */
export function redactLeadOceanRow(row: unknown): unknown {
  const walk = (v: unknown, key = ""): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/picture|photo|avatar/i.test(k) || k === "key_hash") continue;
      if (k === "contact_emails" || k === "contact_phones") {
        out[k] = Array.isArray(x) ? x.map((e) => ({ type: (e as Record<string, unknown>)?.type ?? null, status: (e as Record<string, unknown>)?.status ?? null, redacted: true })) : x;
        continue;
      }
      if (k === "email" || k === "phone" || k === "personal_emails" || k === "work_email") { out[k] = x == null ? x : "[redacted]"; continue; }
      out[k] = walk(x, k);
    }
    return out;
  };
  return walk(row);
}

const EMAIL_FLAGGED = new Set(["invalid", "risky", "disposable"]);

export function contactPointsFrom(row: unknown, recordId: string, at: string): ContactPoint[] {
  const out: ContactPoint[] = [];
  const cd = (row as { contact_data?: { contact_emails?: unknown[]; contact_phones?: unknown[] } })?.contact_data;
  for (const e of cd?.contact_emails ?? []) {
    const email = pickStr(e, ["email"]);
    if (!email) continue;
    const status = pickStr(e, ["status"]);
    out.push({
      kind: "email", value: email.toLowerCase(), type: pickStr(e, ["type"]), provider: "leadocean", recordId,
      providerStatus: status, providerVerifiedAt: pickStr(e, ["verified_batch_date"]),
      // LeadOcean's "verified" is its own check; Agentory has no evidence of its own.
      verification: status === "verified" ? "provider_reported_verified" : status && EMAIL_FLAGGED.has(status) ? "provider_flagged" : "provider_supplied_unverified",
      retrievedAt: at,
    });
  }
  for (const p of cd?.contact_phones ?? []) {
    const phone = pickStr(p, ["phone"]);
    if (!phone) continue;
    out.push({
      kind: "phone", value: phone, type: pickStr(p, ["type"]), provider: "leadocean", recordId,
      providerStatus: (p as { dnc?: unknown })?.dnc === true ? "dnc" : null,
      // A provider phone is NEVER verified here, whatever the provider says.
      verification: (p as { dnc?: unknown })?.dnc === true ? "provider_flagged" : "provider_supplied_unverified",
      retrievedAt: at,
    });
  }
  return out;
}

function rowsOf(json: unknown): unknown[] {
  const j = json as { data?: unknown; results?: unknown };
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.results)) return j.results;
  return [];
}

export function normalizeLeadOceanPage(json: unknown, step: PlanStep, at: string): SearchPage {
  const meta = ((json as { meta?: Record<string, unknown> })?.meta ?? {}) as Record<string, unknown>;
  const unsupported = Array.isArray(meta.unsupportedFilters) ? meta.unsupportedFilters.map(String) : [];
  const ignored = [...new Set(unsupported.map((p) => PARAM_OF[p]).filter((k): k is FilterKey => !!k))];
  const asserted = step.requirements.filter((r) => r.handling === "native" && !ignored.includes(r.key)).map((r) => r.key);
  const rows = rowsOf(json);
  const companies: ProviderCompany[] = [];
  const people: ProviderPerson[] = [];
  for (const row of rows) {
    if (step.kind === "company_search") {
      const c = companyFrom(row, at, ignored, asserted);
      if (c) companies.push(c);
      continue;
    }
    const recordId = pickStr(row, FIELDS.personId);
    if (!recordId) continue;
    people.push({
      provider: "leadocean", recordId, retrievedAt: at,
      providerUpdatedAt: null,
      fullName: pickStr(row, FIELDS.fullName), firstName: pickStr(row, FIELDS.firstName),
      title: pickStr(row, FIELDS.title), headline: pickStr(row, FIELDS.headline), seniority: pickStr(row, FIELDS.seniority),
      linkedinUrl: pickStr(row, FIELDS.linkedin), country: pickStr(row, FIELDS.personCountry),
      // A people row names its employer in contact_current_experiences — "current" by LeadOcean's word.
      company: employerFrom(row, at, ignored, asserted),
      // LeadOcean states it explicitly: contact_current_experiences[0].current.
      employerIsCurrent: typeof pick(row, FIELDS.expCurrent) === "boolean" ? pick(row, FIELDS.expCurrent) as boolean : null,
      personGroupId: pickStr(row, FIELDS.personGroupId),
      hasEmail: (row as { contact_data?: { has_email?: boolean } })?.contact_data?.has_email ?? null,
      hasPhone: (row as { contact_data?: { has_phone?: boolean } })?.contact_data?.has_phone ?? null,
      contactPoints: contactPointsFrom(row, recordId, at),
      ignoredFilters: ignored, assertedFilters: asserted,
    });
  }
  const credits = typeof meta.credits === "number" ? meta.credits : rows.length;
  const safeMeta = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "key_hash"));
  return {
    raw: { data: rows.map(redactLeadOceanRow), meta: safeMeta },
    companies, people,
    nextCursor: typeof meta.nextCursor === "string" && meta.nextCursor && meta.depthCapped !== true ? meta.nextCursor : null,
    creditsCharged: credits,
    ignoredFilters: ignored,
    total: typeof meta.total === "number" && meta.totalWithheld !== true ? meta.total : null,
  };
}

export function leadOceanAdapter(deps: AdapterDeps): DiscoveryAdapter {
  const base = deps.baseUrl ?? LEADOCEAN_BASE;
  const now = deps.now ?? (() => new Date());
  const headers = { "x-api-key": deps.apiKey };
  return {
    provider: "leadocean",
    async search(step, req, cursor, limit) {
      const { path, body } = buildLeadOceanSearch(step, req, cursor, limit);
      const r = await callProvider(deps.fetch, { provider: "leadocean", url: `${base}${path}`, method: "POST", headers, body, paid: true }, deps.sleep);
      if ((r.json as { success?: unknown })?.success === false) throw new ProviderError("leadocean", "invalid_request", "search refused");
      return normalizeLeadOceanPage(r.json, step, now().toISOString());
    },
    async verifyKey(): Promise<UsageInfo> {
      // GET /v1/account: "Free" (spec). One read gives plan, key scopes and records left.
      const r = await callProvider(deps.fetch, { provider: "leadocean", url: `${base}/v1/account`, method: "GET", headers, paid: false }, deps.sleep);
      const d = (r.json as { data?: Record<string, unknown> })?.data ?? {};
      const sc = pick(d, ["key.scopes"]);
      const scopes = Array.isArray(sc) ? sc.map(String) : null;
      const restrictions: string[] = [];
      if (scopes && !scopes.includes("search")) restrictions.push("search: key lacks the search scope");
      if (scopes && !scopes.includes("enrich")) restrictions.push("enrich: key lacks the enrich scope");
      if (pick(d, ["account.suspended"]) === true) restrictions.push("account suspended");
      return {
        plan: pickStr(d, ["subscription.planSlug", "account.plan"]),
        used: pickNum(d, ["records.used"]), limit: pickNum(d, ["records.ceiling"]),
        remaining: pickNum(d, ["records.remaining"]),
        resetsAt: pickStr(d, ["records.resetsAt"]), checkedAt: now().toISOString(),
        restrictions, scopes,
      };
    },
  };
}

/** One enrichment call (1 record, found or not). Only `enrich.ts` calls this. */
export async function leadOceanEnrichPerson(deps: AdapterDeps, input: { linkedinUrl?: string | null; personId?: string | null; revealEmail: boolean }): Promise<{ found: boolean; contactPoints: ContactPoint[]; credits: number }> {
  const base = deps.baseUrl ?? LEADOCEAN_BASE;
  const body: Record<string, unknown> = { reveal_email: input.revealEmail };
  if (input.personId) body.person_id = input.personId;
  else if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;
  else throw new ProviderError("leadocean", "invalid_request", "enrichment needs a person id or LinkedIn URL");
  const r = await callProvider(deps.fetch, { provider: "leadocean", url: `${base}/v1/enrich`, method: "POST", headers: { "x-api-key": deps.apiKey }, body, paid: true, maxRetries: 1 }, deps.sleep);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const j = r.json as { data?: unknown; found?: boolean; meta?: { credits?: number } };
  const row = j?.data ?? null;
  const id = input.personId ?? pickStr(row, FIELDS.personId) ?? "enrich";
  return { found: j?.found !== false && !!row, contactPoints: row ? contactPointsFrom(row, id, at) : [], credits: typeof j?.meta?.credits === "number" ? j.meta.credits : 1 };
}
