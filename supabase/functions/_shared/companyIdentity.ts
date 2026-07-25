// Canonical company identity + deterministic dedupe.
//
// One company must resolve to ONE canonical account regardless of which job
// search / people search / enrichment produced it, and two similarly-named
// companies must stay distinct. Pure + deterministic (no network). Reuses the
// existing domain parser so runtime + benchmark agree on canonicalization.

import { parseDomain } from "./apifyJobsNormalizer.ts";
import { normalizeTerm } from "./inputNormalize.ts";

export interface CompanyIdentityInput {
  name?: string | null;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
}

export interface CompanyIdentity {
  name: string | null;
  normalizedName: string | null;
  canonicalDomain: string | null;
  linkedinUrl: string | null;
  /** The stable company slug from a /company/<slug> LinkedIn URL. */
  linkedinCompanyId: string | null;
  location: string | null;
  /** The strongest available dedupe key (domain > li-id > li-url > name+loc). */
  dedupeKey: string | null;
  /** Which identifier the dedupe key came from — for observability. */
  dedupeKeyKind: "domain" | "linkedin_id" | "linkedin_url" | "name_location" | "none";
}

const SUFFIX_RE = /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|corp|corporation|co|company|gmbh|plc|limited|holdings|technologies|technology|software|labs|the|group|solutions)\b/gi;

/** Strip common suffixes so "Acme, Inc." and "Acme" collapse (but "Acme East"
 *  and "Acme West" stay distinct — only noise suffixes are removed). */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  let n = normalizeTerm(name ?? "");
  if (!n) return null;
  n = n.toLowerCase().replace(SUFFIX_RE, " ").replace(/[.,&]/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

/** Canonicalize a LinkedIn company URL and extract the stable /company/<slug>. */
export function canonicalLinkedinCompany(url: string | null | undefined): { url: string | null; id: string | null } {
  if (!url) return { url: null, id: null };
  const s = String(url).trim();
  if (!/linkedin\.com/i.test(s)) return { url: null, id: null };
  const m = /linkedin\.com\/company\/([a-z0-9\-_.%]+)/i.exec(s);
  const id = m ? decodeURIComponent(m[1]).replace(/\/+$/, "").toLowerCase() : null;
  const canonical = id ? `linkedin.com/company/${id}` : s.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  return { url: canonical || null, id };
}

export function resolveCompanyIdentity(input: CompanyIdentityInput): CompanyIdentity {
  const canonicalDomain =
    parseDomain(input.domain) ??
    parseDomain(input.website_url) ??
    parseDomain(input.linkedin_url) ?? null;
  const { url: linkedinUrl, id: linkedinCompanyId } = canonicalLinkedinCompany(input.linkedin_url);
  const normalizedName = normalizeCompanyName(input.name);
  const location = input.location ? normalizeTerm(input.location) || null : null;

  // Domain is the strongest identity; a linkedin /company/<id> next; then the
  // canonical li URL; name+location is the WEAKEST (fallback only).
  let dedupeKey: string | null = null;
  let dedupeKeyKind: CompanyIdentity["dedupeKeyKind"] = "none";
  if (canonicalDomain && !/linkedin\.com/i.test(canonicalDomain)) { dedupeKey = `domain:${canonicalDomain}`; dedupeKeyKind = "domain"; }
  else if (linkedinCompanyId) { dedupeKey = `li_id:${linkedinCompanyId}`; dedupeKeyKind = "linkedin_id"; }
  else if (linkedinUrl) { dedupeKey = `li_url:${linkedinUrl}`; dedupeKeyKind = "linkedin_url"; }
  else if (normalizedName) { dedupeKey = `name_loc:${normalizedName}|${location ?? ""}`; dedupeKeyKind = "name_location"; }

  return {
    name: input.name ?? null,
    normalizedName,
    canonicalDomain: canonicalDomain && !/linkedin\.com/i.test(canonicalDomain) ? canonicalDomain : null,
    linkedinUrl,
    linkedinCompanyId,
    location,
    dedupeKey,
    dedupeKeyKind,
  };
}

/** Deterministic company equality using the strongest SHARED identifier.
 *  Never collapses two companies on name alone when a strong id disagrees. */
export function sameCompany(a: CompanyIdentity, b: CompanyIdentity): boolean {
  if (a.canonicalDomain && b.canonicalDomain) return a.canonicalDomain === b.canonicalDomain;
  if (a.linkedinCompanyId && b.linkedinCompanyId) return a.linkedinCompanyId === b.linkedinCompanyId;
  if (a.linkedinUrl && b.linkedinUrl) return a.linkedinUrl === b.linkedinUrl;
  // Only fall back to name+location when NEITHER side has any strong identifier.
  const aStrong = a.canonicalDomain || a.linkedinCompanyId || a.linkedinUrl;
  const bStrong = b.canonicalDomain || b.linkedinCompanyId || b.linkedinUrl;
  if (aStrong || bStrong) return false;
  return !!a.normalizedName && a.normalizedName === b.normalizedName && (a.location ?? "") === (b.location ?? "");
}

/** True only when a STRONG shared identifier (domain / li-id / li-url) matches —
 *  never on name alone. Used by employer verification to distinguish a proven
 *  match from a merely similar name. */
export function strongSameCompany(a: CompanyIdentity, b: CompanyIdentity): boolean {
  if (a.canonicalDomain && b.canonicalDomain) return a.canonicalDomain === b.canonicalDomain;
  if (a.linkedinCompanyId && b.linkedinCompanyId) return a.linkedinCompanyId === b.linkedinCompanyId;
  if (a.linkedinUrl && b.linkedinUrl) return a.linkedinUrl === b.linkedinUrl;
  return false;
}

/** True when either side carries any strong identifier. */
export function hasStrongId(a: CompanyIdentity): boolean {
  return !!(a.canonicalDomain || a.linkedinCompanyId || a.linkedinUrl);
}

/** Collapse a list of company identities into one canonical entry per company,
 *  preserving deterministic first-seen order by dedupeKey. */
export function dedupeCompanies<T extends { identity: CompanyIdentity }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.identity.dedupeKey ?? `idx:${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
