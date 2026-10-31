// CAN THIS PROVIDER SAY EXACTLY WHAT THE MISSION REQUIRES?
//
// A provider filter is only "native" when every requested value translates
// into the provider's own vocabulary EXACTLY. LeadOcean's hqCountry / country
// are ISO-3166 alpha-2 enums and its industry is a closed enum of 534 labels
// (OpenAPI 1.0.0, vocabulary/leadocean.json, generated from the spec). Sending
// "United States" or "manufacturers" there is either rejected or ignored —
// and an ignored filter on a per-record-billed search is a silently broadened,
// paid search. So a value that does not translate makes the requirement
// UNSUPPORTED for that provider (the router refuses it), never "post-verify".
//
// Apollo takes free-text locations and "min,max" employee ranges, so those
// translate as they are; its company identity filter takes domains only.
//
// The router (`routing.ts`) and the adapters read the SAME translation, so
// what was planned is what is sent.
//
// Pure. The vocabulary file is data read from the provider's spec.

import vocab from "./vocabulary/leadocean.json" with { type: "json" };
import { geoLevel } from "./adapter.ts";
import type { HardRequirement, ProviderId, Range } from "./types.ts";
import type { SearchKind } from "./providers.ts";

export type Translation =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; reason: string };

const HQ_COUNTRIES = new Set<string>(vocab.hqCountry);
const PERSON_COUNTRIES = new Set<string>(vocab.personCountry);
const norm = (s: string) => s.toLowerCase().replace(/[;,]/g, ";").replace(/\s+/g, " ").trim();
const INDUSTRY = new Map<string, string>(vocab.industry.map((l) => [norm(l), l]));

/** Reviewed aliases only: a name a person writes for one ISO code. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "usa": "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US", "america": "US",
  "uk": "GB", "u.k.": "GB", "great britain": "GB", "england": "GB",
  "uae": "AE",
});
let NAME_TO_ISO: Map<string, string> | null = null;
function nameToIso(): Map<string, string> {
  if (NAME_TO_ISO) return NAME_TO_ISO;
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  NAME_TO_ISO = new Map();
  for (const code of HQ_COUNTRIES) {
    const name = dn.of(code);
    if (name && name !== code) NAME_TO_ISO.set(name.toLowerCase(), code);
  }
  return NAME_TO_ISO;
}

/** "United States" / "USA" / "us" → "US"; anything else → null. */
export function isoCountry(v: string, allowed: ReadonlySet<string> = HQ_COUNTRIES): string | null {
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t) && allowed.has(t.toUpperCase())) return t.toUpperCase();
  const k = t.toLowerCase();
  const code = COUNTRY_ALIASES[k] ?? nameToIso().get(k) ?? null;
  return code && allowed.has(code) ? code : null;
}

/** An exact LeadOcean industry label (case, comma/semicolon and spacing aside), or null. */
export function leadOceanIndustry(v: string): string | null {
  return INDUSTRY.get(norm(v)) ?? null;
}

const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const isDomain = (v: string) => DOMAIN.test(v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]) && !/linkedin\.com/i.test(v);
const isCompanyLinkedin = (v: string) => /linkedin\.com\/company\//i.test(v);

function all<T>(values: string[], f: (v: string) => T | null, what: string): { ok: true; out: T[] } | { ok: false; reason: string } {
  const out: T[] = [];
  for (const v of values) {
    const t = f(v);
    if (t === null) return { ok: false, reason: `"${v}" is not a ${what}` };
    out.push(t);
  }
  return { ok: true, out };
}

function leadOcean(kind: SearchKind, h: HardRequirement): Translation {
  const list = Array.isArray(h.values) ? h.values : [];
  switch (h.key) {
    case "industry": {
      const r = all(list, leadOceanIndustry, "LeadOcean industry label");
      return r.ok ? { ok: true, params: { industry: r.out } } : { ok: false, reason: r.reason };
    }
    case "geography_hq": {
      const params: Record<string, string[]> = {};
      for (const v of list) {
        const level = geoLevel(v);
        if (level === "country") {
          const iso = isoCountry(v);
          if (!iso) return { ok: false, reason: `"${v}" is not an ISO country LeadOcean filters on` };
          (params.hqCountry ??= []).push(iso);
        } else (params[level === "us_state" ? "hqState" : "hqCity"] ??= []).push(v);
      }
      return { ok: true, params };
    }
    case "geography_person": {
      if (kind !== "people_search") return { ok: false, reason: "person location applies to people search only" };
      const r = all(list, (v) => isoCountry(v, PERSON_COUNTRIES), "ISO country LeadOcean filters people on");
      return r.ok ? { ok: true, params: { country: r.out } } : { ok: false, reason: r.reason };
    }
    case "employee_range": {
      const r = h.values as Range;
      return { ok: true, params: { ...(r.min !== null ? { minEmployees: r.min } : {}), ...(r.max !== null ? { maxEmployees: r.max } : {}) } };
    }
    case "known_companies": {
      const domains = list.filter(isDomain), lis = list.filter(isCompanyLinkedin);
      if (domains.length + lis.length !== list.length) return { ok: false, reason: "a supplied company is neither a domain nor a LinkedIn company URL" };
      return { ok: true, params: { ...(domains.length ? { domain: domains } : {}), ...(lis.length ? { [kind === "people_search" ? "companyLinkedin" : "linkedin"]: lis } : {}) } };
    }
    case "excluded_company_types": {
      // Companies: excludeKeywords is "company keywords (or exact industry labels)".
      // People: excludeKeywords is the PERSON's profile text, so only an exact
      // industry label can exclude a company type there.
      if (kind === "company_search") return { ok: true, params: { excludeKeywords: list } };
      const r = all(list, leadOceanIndustry, "LeadOcean industry label (people search can exclude a company type only by label)");
      return r.ok ? { ok: true, params: { excludeIndustry: r.out } } : { ok: false, reason: r.reason };
    }
    case "roles":
      return kind === "people_search" ? { ok: true, params: { title: list } } : { ok: false, reason: "roles apply to people search" };
    default:
      return { ok: false, reason: `LeadOcean has no filter for ${h.key}` };
  }
}

function sizeRange(r: Range): string {
  return `${r.min ?? 1},${r.max ?? 1_000_000}`;
}

function apollo(kind: SearchKind, h: HardRequirement): Translation {
  const list = Array.isArray(h.values) ? h.values : [];
  switch (h.key) {
    case "roles":
      return kind === "people_search" ? { ok: true, params: { person_titles: list.slice(0, 99), include_similar_titles: false } } : { ok: false, reason: "roles apply to people search" };
    case "geography_hq": return { ok: true, params: { organization_locations: list } };
    case "excluded_geography": return { ok: true, params: { organization_not_locations: list } };
    case "geography_person":
      return kind === "people_search" ? { ok: true, params: { person_locations: list } } : { ok: false, reason: "person location applies to people search only" };
    case "employee_range": return { ok: true, params: { organization_num_employees_ranges: [sizeRange(h.values as Range)] } };
    case "known_companies": {
      // q_organization_domains_list takes domains only (no www., no @).
      const r = all(list, (v) => (isDomain(v) ? v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() : null), "domain Apollo can filter on");
      return r.ok ? { ok: true, params: { q_organization_domains_list: r.out.slice(0, 1000) } } : { ok: false, reason: r.reason };
    }
    default:
      return { ok: false, reason: `Apollo has no exact filter for ${h.key}` };
  }
}

/** Exactly what `provider` would send for `h`, or why it cannot. */
export function translate(provider: ProviderId, kind: SearchKind, h: HardRequirement): Translation {
  if (provider === "leadocean") return leadOcean(kind, h);
  if (provider === "apollo") return apollo(kind, h);
  return { ok: false, reason: `${provider} has no structured filters` };
}

export const LEADOCEAN_VOCABULARY = { specVersion: vocab.spec_version, specSha256: vocab.spec_sha256, readAt: vocab.read_at };
