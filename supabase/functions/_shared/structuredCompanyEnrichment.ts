// Structured company enrichment (Phase 2) — input builder + output normalizer +
// evidence mapping for the VERIFIED actor `harvestapi/linkedin-company`
// (actorKey apify_linkedin_company_details). Pure / provider-free.
//
// Verified input schema (two documentation sources, 2026-07-16):
//   { companies?: string[]   // List of LinkedIn company URLs
//     searches?:  string[] }  // List of company names to search on LinkedIn
//
// Enriches an ALREADY-KNOWN company attached to person candidates. Never a
// discovery/search actor. Never fabricates a field that the actor did not return.

import type { EvidenceCategory, EvidenceConfidence } from "./evidenceContract.ts";
import type { EvidenceItem } from "./candidateEnvelope.ts";
import type { WorkflowEvidenceBudget } from "./conditionalEnrichmentPlanner.ts";
import type { LinkedInCompanyActorItem, LinkedInCompanyActorInput } from "./linkedinCompanyActorFixture.ts";

export const COMPANY_DETAILS_ACTOR_KEY = "apify_linkedin_company_details";
export const COMPANY_DETAILS_ACTOR_ID = "harvestapi/linkedin-company";

// ------------------------------------------------------------- URL helpers ----

const CONTROL = /[\u0000-\u001F\u007F]/g;

/** Public http(s) URL with userinfo, query and fragment stripped. */
export function sanitizeUrl(v: unknown): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}`;
}

/** Canonical LinkedIn COMPANY url. Rejects person (/in/) profiles outright. */
export function normalizeCompanyLinkedInUrl(v: unknown): string | null {
  const clean = sanitizeUrl(v);
  if (!clean) return null;
  if (!/linkedin\.com$/i.test(new URL(clean).host.replace(/^www\./i, "")) &&
      !/(^|\.)linkedin\.com$/i.test(new URL(clean).host)) return null;
  if (/\/in\//i.test(clean)) return null;          // person profile — never a company
  const m = clean.match(/\/company\/([^/]+)/i);
  if (!m) return null;
  return `https://www.linkedin.com/company/${m[1].toLowerCase()}`;
}

/** Official website URL (query/fragment stripped, http(s) only). */
export function normalizeWebsite(v: unknown): string | null {
  const clean = sanitizeUrl(v);
  if (!clean) return null;
  if (/linkedin\.com/i.test(clean)) return null;   // not an official website
  return clean;
}

const ROLE_NOISE = /\b(founders?|co-?founders?|ceos?|ctos?|coos?|cmos?|cros?|presidents?|owners?|vps?|heads? of[a-z ]*|directors?|managers?|engineers?|developers?|recruiting|recruiters?|hiring|jobs?|careers?|find|search|list|top \d+)\b/gi;
/** Prose separators: everything after one is commentary, not the company name. */
const PROSE_TAIL = /\s[—–|;:]\s|\s-\s|\s\(|,\s/;

/**
 * Concise, normalized company-name fallback for the actor's `searches` input.
 * Deterministic. Extracts the company CORE rather than merely filtering words:
 *   1. take the segment after " at " when the text is role-prose ("Founder at X")
 *   2. cut at the first prose separator (em-dash / pipe / comma / parenthesis)
 *   3. strip role + hiring terms and legal suffixes
 * Returns null when nothing company-like survives — never a guess.
 */
export function normalizeCompanyNameFallback(v: unknown): string | null {
  let s = String(v ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // 1) "Founder & CEO at Acme SaaS Inc — we're hiring engineers" ⇒ "Acme SaaS Inc — …"
  const atMatch = s.match(/\bat\s+(.+)$/i);
  if (atMatch && ROLE_NOISE.test(s.slice(0, atMatch.index ?? 0))) s = atMatch[1];
  ROLE_NOISE.lastIndex = 0;
  // 2) drop the prose tail
  const cut = s.split(PROSE_TAIL)[0] ?? s;
  s = cut;
  // 3) strip role/hiring terms + legal suffixes
  s = s.replace(ROLE_NOISE, " ");
  ROLE_NOISE.lastIndex = 0;
  s = s.replace(/[|@#]+/g, " ").replace(/&/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(inc|llc|ltd|corp|corporation|gmbh|bv|plc)\b\.?/gi, "").replace(/[,.\-–—]+$/g, "").trim();
  if (!s || s.length < 2) return null;
  return s.slice(0, 80);
}

// ------------------------------------------------------- input construction ---

export interface CompanyEnrichmentTarget {
  companyKey: string;
  companyLinkedInUrl?: string | null;
  universalName?: string | null;
  companyName?: string | null;
}

export interface CompanyEnrichmentInputPlan {
  input: LinkedInCompanyActorInput;
  /** companyKey per emitted identifier, in order, for fan-out. */
  targets: Array<{ companyKey: string; identifier: string; via: "companies" | "searches" }>;
  skipped: Array<{ companyKey: string; reason: string }>;
}

/**
 * Build the actor input deterministically.
 * Priority per company: LinkedIn company URL → universalName → official name.
 * One input per canonical company key; deduped; capped by the budget.
 */
export function buildCompanyEnrichmentInput(
  targets: CompanyEnrichmentTarget[],
  budget: WorkflowEvidenceBudget,
): CompanyEnrichmentInputPlan {
  const companies: string[] = [];
  const searches: string[] = [];
  const out: CompanyEnrichmentInputPlan["targets"] = [];
  const skipped: CompanyEnrichmentInputPlan["skipped"] = [];
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();

  for (const t of targets) {
    if (!t.companyKey) { skipped.push({ companyKey: String(t.companyKey ?? ""), reason: "missing_company_key" }); continue; }
    if (seenKeys.has(t.companyKey)) continue;                 // one input per company key
    if (out.length >= budget.companyStructuredEnrichments) {
      skipped.push({ companyKey: t.companyKey, reason: "budget_cap" });
      continue;
    }
    const url = normalizeCompanyLinkedInUrl(t.companyLinkedInUrl);
    if (url) {
      if (seenIds.has(url)) { seenKeys.add(t.companyKey); continue; }
      seenIds.add(url); seenKeys.add(t.companyKey);
      companies.push(url);
      out.push({ companyKey: t.companyKey, identifier: url, via: "companies" });
      continue;
    }
    const uni = String(t.universalName ?? "").trim().toLowerCase();
    if (uni && /^[a-z0-9-]+$/.test(uni)) {
      const built = `https://www.linkedin.com/company/${uni}`;
      if (seenIds.has(built)) { seenKeys.add(t.companyKey); continue; }
      seenIds.add(built); seenKeys.add(t.companyKey);
      companies.push(built);
      out.push({ companyKey: t.companyKey, identifier: built, via: "companies" });
      continue;
    }
    const name = normalizeCompanyNameFallback(t.companyName);
    if (name) {
      const k = name.toLowerCase();
      if (seenIds.has(k)) { seenKeys.add(t.companyKey); continue; }
      seenIds.add(k); seenKeys.add(t.companyKey);
      searches.push(name);
      out.push({ companyKey: t.companyKey, identifier: name, via: "searches" });
      continue;
    }
    skipped.push({ companyKey: t.companyKey, reason: "no_usable_identifier" });
  }

  const input: LinkedInCompanyActorInput = {};
  if (companies.length) input.companies = companies;
  if (searches.length) input.searches = searches;
  return { input, targets: out, skipped };
}

// -------------------------------------------------------- output normalizer ---

export interface NormalizedCompanyDetails {
  linkedinUrl?: string;
  name: string;
  universalName?: string;
  officialWebsite?: string;
  description?: string;
  tagline?: string;
  industries?: string[];
  companyType?: string;
  employeeCount?: number;
  employeeRange?: { start?: number; end?: number };
  foundedYear?: number;
  headquarters?: { country?: string; countryCode?: string; region?: string; city?: string; text?: string };
}

export interface StructuredCompanyEvidenceBundle {
  companyKey: string;
  company: NormalizedCompanyDetails;
  evidence: EvidenceItem[];
  provenance: { provider: "apify"; actorKey: string; actorId: string; providerRunId?: string; verified: true };
}

const txt = (v: unknown, cap = 400): string | null => {
  const s = String(v ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, cap) : null;
};
const finiteNum = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v) && v >= 0) return Math.floor(v);
  return null;    // strings like "about fifty" are NOT coerced
};

/** industries: accept documented array / string variants → unique non-empty. */
export function normalizeIndustries(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === "string" ? item : (item && typeof item === "object" ? (item as any).name ?? (item as any).value : null);
    const c = txt(s, 80);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** headquarters: prefer headquarter=true, else the strongest parsed location. */
export function selectHeadquarters(v: unknown): NormalizedCompanyDetails["headquarters"] | undefined {
  const list: any[] = Array.isArray(v) ? v : [];
  if (!list.length) return undefined;
  const score = (l: any) => {
    const p = l?.parsed ?? {};
    let s = 0;
    if (l?.headquarter === true) s += 100;
    if (p.countryCode ?? l?.countryCode) s += 4;
    if (p.city ?? l?.city) s += 2;
    if (p.text) s += 1;
    return s;
  };
  const best = [...list].sort((a, b) => score(b) - score(a))[0];
  if (!best) return undefined;
  const p = best.parsed ?? {};
  const hq: NormalizedCompanyDetails["headquarters"] = {};
  const country = txt(p.country ?? best.country, 80); if (country) hq.country = country;
  const cc = txt(p.countryCode ?? best.countryCode, 8); if (cc) hq.countryCode = cc.toUpperCase();
  const region = txt(p.geographicArea ?? best.geographicArea ?? p.region, 80); if (region) hq.region = region;
  const city = txt(p.city ?? best.city, 80); if (city) hq.city = city;
  const t = txt(p.text, 160); if (t) hq.text = t;
  return Object.keys(hq).length ? hq : undefined;
}

/**
 * Tolerant normalizer for one documented actor record. Returns null when the
 * record carries no usable company identity. NEVER emits phone/email.
 */
export function normalizeCompanyActorItem(
  item: LinkedInCompanyActorItem | null | undefined,
  companyKey: string,
  opts?: { observedAt?: string; providerRunId?: string },
): StructuredCompanyEvidenceBundle | null {
  if (!item || typeof item !== "object") return null;
  const name = txt(item.name, 120);
  const linkedinUrl = normalizeCompanyLinkedInUrl(item.linkedinUrl) ?? undefined;
  const universalName = txt(item.universalName, 80) ?? undefined;
  if (!name && !linkedinUrl && !universalName) return null;    // no identity ⇒ unusable

  const company: NormalizedCompanyDetails = { name: name ?? universalName ?? "" };
  if (linkedinUrl) company.linkedinUrl = linkedinUrl;
  if (universalName) company.universalName = universalName;

  const website = normalizeWebsite(item.website); if (website) company.officialWebsite = website;
  const description = txt(item.description, 400); if (description) company.description = description;
  const tagline = txt(item.tagline, 200); if (tagline) company.tagline = tagline;
  const industries = normalizeIndustries(item.industries); if (industries.length) company.industries = industries;
  const companyType = txt(item.companyType, 80); if (companyType) company.companyType = companyType;

  const ec = finiteNum(item.employeeCount); if (ec != null) company.employeeCount = ec;
  const rng = item.employeeCountRange as any;
  if (rng && typeof rng === "object") {
    const start = finiteNum(rng.start); const end = finiteNum(rng.end);
    if (start != null || end != null) company.employeeRange = { ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) };
  }
  const founded = (item.foundedOn as any);
  const fy = finiteNum(typeof founded === "object" && founded ? founded.year : founded);
  if (fy && fy > 1800) company.foundedYear = fy;
  const hq = selectHeadquarters(item.locations); if (hq) company.headquarters = hq;

  const observedAt = opts?.observedAt ?? new Date().toISOString();
  const prov = { provider: "apify" as const, actorKey: COMPANY_DETAILS_ACTOR_KEY, actorId: COMPANY_DETAILS_ACTOR_ID, ...(opts?.providerRunId ? { providerRunId: opts.providerRunId } : {}), verified: true as const };

  const mk = (category: EvidenceCategory, value: unknown, confidence: EvidenceConfidence): EvidenceItem => ({
    category, value, sourceType: "apify_actor", confidence,
    actorKey: prov.actorKey, actorId: prov.actorId,
    ...(linkedinUrl ? { sourceUrl: linkedinUrl } : {}),
    observedAt, verified: true,
  });

  const evidence: EvidenceItem[] = [];
  if (linkedinUrl || universalName) evidence.push(mk("company_identity", linkedinUrl ?? universalName, "high"));
  if (company.officialWebsite) evidence.push(mk("company_website", company.officialWebsite, "high"));
  if (company.industries?.length) evidence.push(mk("company_industry", company.industries, "high"));
  // Description/tagline are a WEAK business-model hint — never definitive B2B SaaS proof.
  if (company.description || company.tagline) {
    evidence.push(mk("company_business_model", company.description ?? company.tagline, "low"));
  }
  if (company.employeeCount != null || company.employeeRange) {
    evidence.push(mk("company_size", company.employeeCount ?? company.employeeRange, "medium"));
  }
  if (company.headquarters) evidence.push(mk("company_geography", company.headquarters, "medium"));

  return { companyKey, company, evidence, provenance: prov };
}

// ------------------------------------------------------------ failure policy --

export type CompanyEnrichmentOutcome =
  | "enriched" | "no_result" | "invalid_result" | "provider_error"
  | "timeout" | "budget_skipped" | "cached" | "not_needed";

export interface CompanyEnrichmentResult {
  companyKey: string;
  outcome: CompanyEnrichmentOutcome;
  bundle?: StructuredCompanyEvidenceBundle | null;
  failureReason?: string;
}

/**
 * Interpret an actor response for ONE company. Fails safely: never fabricates
 * evidence; a failure for one company never affects another.
 */
export function interpretCompanyActorResponse(args: {
  companyKey: string;
  items?: unknown;
  error?: unknown;
  observedAt?: string;
  providerRunId?: string;
}): CompanyEnrichmentResult {
  const { companyKey } = args;
  if (args.error) {
    const msg = txt((args.error as any)?.message ?? args.error, 160) ?? "provider_error";
    return { companyKey, outcome: "provider_error", bundle: null, failureReason: msg };
  }
  const list = Array.isArray(args.items) ? args.items : (args.items ? [args.items] : []);
  if (!list.length) return { companyKey, outcome: "no_result", bundle: null, failureReason: "empty_result" };
  const bundle = normalizeCompanyActorItem(list[0] as LinkedInCompanyActorItem, companyKey, { observedAt: args.observedAt, providerRunId: args.providerRunId });
  if (!bundle) return { companyKey, outcome: "invalid_result", bundle: null, failureReason: "no_company_identity" };
  return { companyKey, outcome: "enriched", bundle };
}
