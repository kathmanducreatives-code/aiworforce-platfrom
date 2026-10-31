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
export const FIELD_BASIS: Readonly<Record<string, "documented" | "catalogue" | "inferred">> = Object.freeze({
  "meta.source_ids.person_id": "documented", "profile_data.profile_full_name": "documented",
  "profile_data.profile_headline": "documented", "profile_data.profile_url": "documented", "meta.fetched_at": "documented",
  [`${EXP}.job_title`]: "documented", [`${EXP}.company_name`]: "documented", [`${EXP}.company_domain`]: "documented",
  [`${EXP}.company_employees.number_of_employees`]: "documented",
  "company_data.company_name": "documented", "company_data.company_domain": "documented",
  "company_data.naics_sector": "documented", "company_data.naics_primary": "documented",
  [`${EXP}.company_industry`]: "catalogue",
  "company_data.company_industry": "inferred", "company_data.company_employees.number_of_employees": "inferred",
  "company_data.company_linkedin_url": "inferred", "meta.source_ids.company_id": "inferred",
});

export const FIELDS = {
  personId: ["meta.source_ids.person_id"],
  fullName: ["profile_data.profile_full_name"],
  firstName: ["profile_data.profile_first_name"],
  // The CURRENT role's title. The headline ("Founder & CEO at CloudSync") is kept apart.
  title: [`${EXP}.job_title`, "profile_data.profile_job_title"],
  headline: ["profile_data.profile_headline"],
  seniority: ["profile_data.profile_seniority", `${EXP}.job_level`],
  linkedin: ["profile_data.profile_url", "profile_data.profile_linkedin_url"],
  personCountry: ["profile_data.profile_location_country_code", "profile_data.country_code", "profile_data.profile_location_country"],
  // When LeadOcean fetched the record — the only freshness stamp it publishes.
  fetchedAt: ["meta.fetched_at"],
  companyId: ["meta.source_ids.company_id", "company_data.company_id"],
  companyName: ["company_data.company_name"],
  companyDomain: ["company_data.company_domain"],
  companyLinkedin: ["company_data.company_linkedin_url"],
  industry: ["company_data.company_industry"],
  naicsSector: ["company_data.naics_sector"],
  naicsPrimary: ["company_data.naics_primary"],
  keywords: ["company_data.company_keywords"],
  hqCountry: ["company_data.company_hq_country_code", "company_data.company_hq_country", "company_data.company_headquarters.country_code"],
  hqRegion: ["company_data.company_hq_state", "company_data.company_headquarters.state"],
  hqCity: ["company_data.company_hq_city", "company_data.company_headquarters.city"],
  employees: ["company_data.company_employees.number_of_employees"],
  employeeRange: ["company_data.company_employees.employee_range", "company_data.company_employee_range"],
  founded: ["company_data.company_founded"],
  // The employer as a PEOPLE row states it (contact_current_experiences[0]).
  expCompanyName: [`${EXP}.company_name`],
  expCompanyDomain: [`${EXP}.company_domain`],
  expCompanyLinkedin: [`${EXP}.company_linkedin_url`],
  expIndustry: [`${EXP}.company_industry`],
  expEmployees: [`${EXP}.company_employees.number_of_employees`],
  expEmployeeRange: [`${EXP}.company_employees.employee_range`],
  // Funding: filterable (fundingType, min/maxLastFundingYear, min/maxFunding) but the
  // row paths are not shown anywhere LeadOcean publishes. Absent paths leave funding unknown.
  fundingType: ["company_data.company_last_funding_type", "company_data.last_funding_type"],
  fundingYear: ["company_data.company_last_funding_year", "company_data.last_funding_year"],
  fundingDate: ["company_data.company_last_funding_date", "company_data.last_funding_date"],
  fundingTotal: ["company_data.company_total_funding", "company_data.total_funding"],
  fundingLast: ["company_data.company_last_funding_amount", "company_data.last_funding_amount"],
} as const;

/** Our filter → LeadOcean's search parameter names (for meta.unsupportedFilters). */
const PARAM_OF: Record<string, FilterKey> = {
  title: "roles", country: "geography_person", industry: "industry", excludeIndustry: "excluded_company_types",
  excludeKeywords: "excluded_company_types", hqCountry: "geography_hq", hqState: "geography_hq", hqCity: "geography_hq",
  minEmployees: "employee_range", maxEmployees: "employee_range", domain: "known_companies",
  linkedin: "known_companies", companyLinkedin: "known_companies", fundingType: "company_stage",
};

export function buildLeadOceanSearch(step: PlanStep, req: DiscoveryRequirements, cursor: string | null, limit: number) {
  // Each page asks only for what the step may still take: billing is per row returned.
  // ORDER. `ranked` (LeadOcean's default) returns the best matches first: what a
  // discovery page should contain. `stable` is id order on a pinned snapshot —
  // the right choice only for walking a whole result set across pages, where it
  // keeps the cursor consistent. A single-page step asks for relevance.
  const body: Record<string, unknown> = { limit: Math.max(1, Math.min(100, limit)), order: step.maxPages > 1 ? "stable" : "ranked" };
  if (cursor) body.cursor = cursor;
  // People rows: drop picture blocks and duplicate lists. Company rows keep
  // financials (slim would drop them), which may carry funding evidence.
  if (step.kind === "people_search") body.slim = true;
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
  // Roles of a company-target mission still narrow the people search.
  if (step.kind === "people_search" && !body.title && req.roles.length) body.title = req.roles;
  return { path: step.kind === "people_search" ? "/v1/search" : "/v1/search/companies", body };
}

/** A full date only when the provider gives one; a year alone stays a year. */
function fundingFrom(row: unknown): ProviderCompany["funding"] {
  const d = pickStr(row, FIELDS.fundingDate);
  const f = {
    lastRoundType: pickStr(row, FIELDS.fundingType),
    lastRoundYear: pickNum(row, FIELDS.fundingYear),
    roundDate: d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null,
    totalUsd: pickNum(row, FIELDS.fundingTotal),
    lastRoundUsd: pickNum(row, FIELDS.fundingLast),
  };
  return f.lastRoundType || f.lastRoundYear || f.roundDate || f.totalUsd || f.lastRoundUsd ? f : null;
}

/** A company RECORD row (company search / lookup): company_data. */
function companyFrom(row: unknown, at: string, ignored: FilterKey[], asserted: FilterKey[]): ProviderCompany | null {
  const name = pickStr(row, FIELDS.companyName);
  const domain = pickStr(row, FIELDS.companyDomain);
  if (!name && !domain) return null;
  return {
    provider: "leadocean",
    recordId: pickStr(row, FIELDS.companyId) ?? `domain:${domain ?? name}`,
    retrievedAt: at, providerUpdatedAt: pickStr(row, FIELDS.fetchedAt),
    name, domain,
    linkedinUrl: pickStr(row, FIELDS.companyLinkedin),
    industry: pickList(row, FIELDS.industry),
    naicsSector: pickStr(row, FIELDS.naicsSector), naicsPrimary: pickStr(row, FIELDS.naicsPrimary),
    keywords: pickList(row, FIELDS.keywords),
    hqCountry: pickStr(row, FIELDS.hqCountry),
    hqRegion: pickStr(row, FIELDS.hqRegion),
    hqCity: pickStr(row, FIELDS.hqCity),
    employeeCount: pickNum(row, FIELDS.employees),
    employeeRange: parseRange(pick(row, FIELDS.employeeRange)),
    foundedYear: pickNum(row, FIELDS.founded),
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
  return {
    provider: "leadocean", recordId: `domain:${domain ?? name}`, retrievedAt: at, providerUpdatedAt: pickStr(row, FIELDS.fetchedAt),
    name, domain, linkedinUrl: pickStr(row, FIELDS.expCompanyLinkedin),
    industry: pickList(row, FIELDS.expIndustry),
    employeeCount: pickNum(row, FIELDS.expEmployees),
    employeeRange: parseRange(pick(row, FIELDS.expEmployeeRange)),
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
      if (/picture|photo|avatar/i.test(k)) continue;
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
      providerUpdatedAt: pickStr(row, FIELDS.fetchedAt),
      fullName: pickStr(row, FIELDS.fullName), firstName: pickStr(row, FIELDS.firstName),
      title: pickStr(row, FIELDS.title), headline: pickStr(row, FIELDS.headline), seniority: pickStr(row, FIELDS.seniority),
      linkedinUrl: pickStr(row, FIELDS.linkedin), country: pickStr(row, FIELDS.personCountry),
      // A people row names its employer in contact_current_experiences — "current" by LeadOcean's word.
      company: employerFrom(row, at, ignored, asserted),
      employerIsCurrent: pickStr(row, [...FIELDS.expCompanyName, ...FIELDS.expCompanyDomain]) ? true : null,
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
