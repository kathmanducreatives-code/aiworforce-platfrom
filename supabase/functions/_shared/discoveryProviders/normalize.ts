// Merge what several providers returned into one record per company and per
// person — WITHOUT losing where any value came from.
//
//   * Identity: companies match on domain, LinkedIn company URL, or the same
//     provider's record id; people on LinkedIn profile URL, email, the same
//     provider's record id, or full name + company domain.
//   * A match on one key with a contradicting other key (same LinkedIn page,
//     two different domains) is NOT merged: both records are kept and marked
//     with an identity conflict (the pilot CSV preview's rule, #139).
//   * Every field keeps every provider's claim. Nothing is overwritten; values
//     that disagree are listed as a conflict, and verification decides what a
//     conflict means for the lead (`verify.ts`).
//
// Pure.

import type { Claim, ContactPoint, FundingClaim, ProviderCompany, ProviderId, ProviderPerson, Range } from "./types.ts";

export interface SourceRef {
  provider: ProviderId;
  recordId: string;
  retrievedAt: string;
  providerUpdatedAt: string | null;
  assertedFilters: string[];
  ignoredFilters: string[];
}

export interface FieldConflict { field: string; values: { value: unknown; provider: ProviderId; recordId: string }[] }

export interface CanonicalCompany {
  key: string;
  name: Claim<string>[];
  domain: Claim<string>[];
  linkedinUrl: Claim<string>[];
  industry: Claim<string[]>[];
  naicsSector: Claim<string>[];
  naicsPrimary: Claim<string>[];
  keywords: Claim<string[]>[];
  hqCountry: Claim<string>[];
  hqRegion: Claim<string>[];
  hqCity: Claim<string>[];
  employeeCount: Claim<number>[];
  employeeRange: Claim<Range>[];
  foundedYear: Claim<number>[];
  funding: Claim<FundingClaim>[];
  sources: SourceRef[];
  conflicts: FieldConflict[];
  identityConflicts: string[];
}

export interface CanonicalPerson {
  key: string;
  fullName: Claim<string>[];
  firstName: Claim<string>[];
  title: Claim<string>[];
  headline: Claim<string>[];
  seniority: Claim<string>[];
  linkedinUrl: Claim<string>[];
  country: Claim<string>[];
  companyKey: string | null;
  /** The provider's statement that `companyKey` is the CURRENT employer (never verified employment). */
  employerIsCurrent: Claim<boolean>[];
  hasEmail: Claim<boolean>[];
  hasPhone: Claim<boolean>[];
  contactPoints: ContactPoint[];
  sources: SourceRef[];
  conflicts: FieldConflict[];
  identityConflicts: string[];
}

export function normDomain(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return d && d.includes(".") ? d : null;
}

export function linkedinSlug(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.toLowerCase().match(/linkedin\.com\/(company|in|school)\/([^/?#]+)/);
  return m ? `${m[1]}/${decodeURIComponent(m[2])}` : null;
}

const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function claim<T>(value: T | null | undefined, src: { provider: ProviderId; recordId: string; retrievedAt: string; providerUpdatedAt?: string | null }, field: string): Claim<T>[] {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return [];
  return [{ value, provider: src.provider, recordId: src.recordId, sourceField: field, retrievedAt: src.retrievedAt, providerUpdatedAt: src.providerUpdatedAt ?? null }];
}

function sourceOf(r: ProviderCompany | ProviderPerson): SourceRef {
  return {
    provider: r.provider, recordId: r.recordId, retrievedAt: r.retrievedAt, providerUpdatedAt: r.providerUpdatedAt ?? null,
    assertedFilters: [...(r.assertedFilters ?? [])], ignoredFilters: [...(r.ignoredFilters ?? [])],
  };
}

function companyKeys(c: ProviderCompany): string[] {
  const k: string[] = [];
  const d = normDomain(c.domain);
  if (d) k.push(`domain:${d}`);
  const li = linkedinSlug(c.linkedinUrl);
  if (li) k.push(`li:${li}`);
  k.push(`${c.provider}:${c.recordId}`);
  return k;
}

/** Do two claim lists disagree? Numbers within 15% agree (providers round differently). */
function disagree(field: string, a: Claim[], b: Claim[]): boolean {
  if (!a.length || !b.length) return false;
  const x = a[0].value, y = b[0].value;
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) > 0.15 * Math.max(x, y, 1);
  if (field === "employeeRange") {
    const r = x as Range, s = y as Range;
    return (r.max !== null && s.min !== null && r.max < s.min) || (s.max !== null && r.min !== null && s.max < r.min);
  }
  if (field === "funding") {
    const r = x as FundingClaim, s = y as FundingClaim;
    // The same round is the same type in the same year; a missing part is not a disagreement.
    return (!!r.lastRoundType && !!s.lastRoundType && normText(r.lastRoundType) !== normText(s.lastRoundType)) ||
      (r.lastRoundYear !== null && s.lastRoundYear !== null && r.lastRoundYear !== s.lastRoundYear);
  }
  if (Array.isArray(x) && Array.isArray(y)) {
    const xs = new Set(x.map((v) => normText(String(v))));
    return !y.some((v) => xs.has(normText(String(v))));
  }
  return normText(String(x)) !== normText(String(y));
}

const COMPANY_FIELDS = ["name", "domain", "linkedinUrl", "industry", "naicsSector", "naicsPrimary", "keywords", "hqCountry", "hqRegion", "hqCity", "employeeCount", "employeeRange", "foundedYear", "funding"] as const;
type CompanyField = typeof COMPANY_FIELDS[number];
const CONFLICT_FIELDS: CompanyField[] = ["industry", "hqCountry", "hqRegion", "employeeCount", "employeeRange", "foundedYear", "funding"];

/**
 * INDUSTRY LABELS ONLY, WHATEVER THE ADAPTER HANDED OVER. A value that is only
 * digits ("54", "541511") is a classification CODE (NAICS, SIC), never a label
 * an industry requirement can be checked against — Test L read LeadOcean's
 * `naics_sector` as the industry. Adapters keep codes in naicsSector /
 * naicsPrimary; this holds the line for every provider, present and future.
 */
export function industryLabels(v: readonly string[] | null | undefined): string[] | null {
  const out = (v ?? []).map((x) => String(x ?? "").trim()).filter((x) => x && !/^\d+(?:[.-]\d+)*$/.test(x));
  return out.length ? out : null;
}

function freshCompany(c: ProviderCompany): CanonicalCompany {
  const d = normDomain(c.domain);
  return {
    key: d ? `domain:${d}` : linkedinSlug(c.linkedinUrl) ? `li:${linkedinSlug(c.linkedinUrl)}` : `${c.provider}:${c.recordId}`,
    name: claim(c.name, c, "name"), domain: claim(d, c, "domain"), linkedinUrl: claim(c.linkedinUrl, c, "linkedin_url"),
    industry: claim(industryLabels(c.industry), c, "industry"), keywords: claim(c.keywords, c, "keywords"),
    naicsSector: claim(c.naicsSector ?? null, c, "naics_sector"), naicsPrimary: claim(c.naicsPrimary ?? null, c, "naics_primary"),
    hqCountry: claim(c.hqCountry, c, "hq_country"), hqRegion: claim(c.hqRegion, c, "hq_region"), hqCity: claim(c.hqCity, c, "hq_city"),
    employeeCount: claim(c.employeeCount, c, "employee_count"), employeeRange: claim(c.employeeRange, c, "employee_range"),
    foundedYear: claim(c.foundedYear, c, "founded_year"),
    funding: claim(c.funding && (c.funding.lastRoundType || c.funding.lastRoundYear || c.funding.roundDate || c.funding.totalUsd) ? c.funding : null, c, "funding"),
    sources: [sourceOf(c)], conflicts: [], identityConflicts: [],
  };
}

function mergeInto(target: CanonicalCompany, add: CanonicalCompany) {
  for (const f of COMPANY_FIELDS) {
    const before = target[f] as Claim[];
    const incoming = add[f] as Claim[];
    if (CONFLICT_FIELDS.includes(f) && disagree(f, before, incoming)) {
      const existing = target.conflicts.find((c) => c.field === f);
      const vals = [...before, ...incoming].map((c) => ({ value: c.value, provider: c.provider, recordId: c.recordId }));
      if (existing) existing.values = vals; else target.conflicts.push({ field: f, values: vals });
    }
    (target[f] as Claim[]).push(...incoming.filter((c) => !before.some((b) => b.provider === c.provider && b.recordId === c.recordId)));
  }
  for (const s of add.sources) if (!target.sources.some((t) => t.provider === s.provider && t.recordId === s.recordId)) target.sources.push(s);
}

export interface MergeResult {
  companies: CanonicalCompany[];
  people: CanonicalPerson[];
  /** Raw rows in, canonical records out — for the run summary. */
  stats: { companyRows: number; personRows: number; companiesMerged: number; peopleMerged: number; identityConflicts: number };
}

export function mergeRecords(companyRows: ProviderCompany[], personRows: ProviderPerson[]): MergeResult {
  const companies: CanonicalCompany[] = [];
  const index = new Map<string, CanonicalCompany>();
  let companiesMerged = 0, identityConflicts = 0;

  const addCompany = (row: ProviderCompany): CanonicalCompany => {
    const keys = companyKeys(row);
    const hit = keys.map((k) => index.get(k)).find((x): x is CanonicalCompany => !!x);
    const fresh = freshCompany(row);
    if (hit) {
      const hd = hit.domain[0]?.value, rd = normDomain(row.domain);
      const hl = linkedinSlug(hit.linkedinUrl[0]?.value), rl = linkedinSlug(row.linkedinUrl);
      if ((hd && rd && hd !== rd) || (hl && rl && hl !== rl)) {
        identityConflicts++;
        const note = `${row.provider}:${row.recordId} matched ${hit.key} on one identifier but not another`;
        hit.identityConflicts.push(note);
        fresh.identityConflicts.push(note);
        fresh.key = `${row.provider}:${row.recordId}`;
        companies.push(fresh);
        index.set(fresh.key, fresh);
        return fresh;
      }
      mergeInto(hit, fresh);
      companiesMerged++;
      for (const k of keys) if (!index.has(k)) index.set(k, hit);
      return hit;
    }
    companies.push(fresh);
    for (const k of keys) index.set(k, fresh);
    return fresh;
  };

  for (const c of companyRows) addCompany(c);

  const people: CanonicalPerson[] = [];
  const pindex = new Map<string, CanonicalPerson>();
  let peopleMerged = 0;
  for (const p of personRows) {
    const company = p.company ? addCompany(p.company) : null;
    const domain = company?.domain[0]?.value ?? null;
    const keys: string[] = [];
    const li = linkedinSlug(p.linkedinUrl);
    if (li) keys.push(`li:${li}`);
    for (const cp of p.contactPoints ?? []) if (cp.kind === "email") keys.push(`email:${cp.value.toLowerCase()}`);
    keys.push(`${p.provider}:${p.recordId}`);
    if (p.fullName && domain) keys.push(`nm:${normText(p.fullName)}|${domain}`);
    const fresh: CanonicalPerson = {
      key: keys[0],
      fullName: claim(p.fullName, p, "full_name"), firstName: claim(p.firstName, p, "first_name"),
      title: claim(p.title, p, "title"), headline: claim(p.headline ?? null, p, "headline"), seniority: claim(p.seniority, p, "seniority"),
      linkedinUrl: claim(p.linkedinUrl, p, "linkedin_url"), country: claim(p.country, p, "country"),
      companyKey: company?.key ?? null,
      employerIsCurrent: claim(company ? (p.employerIsCurrent ?? null) : null, p, "employer_is_current"),
      hasEmail: claim(p.hasEmail ?? null, p, "has_email"), hasPhone: claim(p.hasPhone ?? null, p, "has_phone"),
      contactPoints: [...(p.contactPoints ?? [])],
      sources: [sourceOf(p)], conflicts: [], identityConflicts: [],
    };
    const hit = keys.map((k) => pindex.get(k)).find((x): x is CanonicalPerson => !!x);
    if (hit) {
      const hl = linkedinSlug(hit.linkedinUrl[0]?.value);
      if ((hl && li && hl !== li) || (hit.companyKey && fresh.companyKey && hit.companyKey !== fresh.companyKey && !li)) {
        identityConflicts++;
        const note = `${p.provider}:${p.recordId} matched ${hit.key} on one identifier but not another`;
        hit.identityConflicts.push(note); fresh.identityConflicts.push(note);
        fresh.key = `${p.provider}:${p.recordId}`;
        people.push(fresh); pindex.set(fresh.key, fresh);
        continue;
      }
      for (const f of ["fullName", "firstName", "title", "headline", "seniority", "linkedinUrl", "country", "hasEmail", "hasPhone", "employerIsCurrent"] as const) {
        const before = hit[f] as Claim[];
        const incoming = fresh[f] as Claim[];
        if ((f === "title" || f === "country") && disagree(f, before, incoming)) {
          hit.conflicts.push({ field: f, values: [...before, ...incoming].map((c) => ({ value: c.value, provider: c.provider, recordId: c.recordId })) });
        }
        before.push(...incoming);
      }
      for (const cp of fresh.contactPoints) {
        if (!hit.contactPoints.some((x) => x.kind === cp.kind && x.value === cp.value && x.provider === cp.provider)) hit.contactPoints.push(cp);
      }
      hit.sources.push(...fresh.sources);
      hit.companyKey ??= fresh.companyKey;
      peopleMerged++;
      for (const k of keys) if (!pindex.has(k)) pindex.set(k, hit);
      continue;
    }
    people.push(fresh);
    for (const k of keys) pindex.set(k, fresh);
  }
  return {
    companies, people,
    stats: { companyRows: companyRows.length + personRows.filter((p) => p.company).length, personRows: personRows.length, companiesMerged, peopleMerged, identityConflicts },
  };
}
