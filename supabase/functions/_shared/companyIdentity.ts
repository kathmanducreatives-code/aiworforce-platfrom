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
// RECOGNIZED non-identity decorations. Deliberately a closed list: an arbitrary
// parenthetical can denote a genuinely DIFFERENT entity, so blindly stripping all
// of them would make "Vanta (Stealth)" collapse into "Vanta". Accelerator/cohort
// labels are pure metadata about the same company; "(Stealth)", "(Acquired)",
// "(EMEA)" and friends are not, and are intentionally absent here.
const COHORT_LABEL_RE = /\(\s*(?:yc|y[\s-]?combinator)\s*[wsfa]?\s*\d{0,4}\s*\)|\((?:techstars|500\s*startups|a16z\s*speedrun)[^)]*\)/gi;

/** True when the ONLY textual difference is a recognized cohort/accelerator label. */
export function differsOnlyByCohortLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = (a ?? "").trim(), sb = (b ?? "").trim();
  if (!sa || !sb) return false;
  const stripped = (s: string) => normalizeCompanyName(s.replace(COHORT_LABEL_RE, " "));
  const na = stripped(sa), nb = stripped(sb);
  if (!na || !nb || na !== nb) return false;
  // At least one side must actually carry a cohort label, otherwise this is a
  // plain equality and the caller should treat it as such. A fresh RegExp avoids
  // the shared /g lastIndex making .test() stateful across calls.
  const hasLabel = (s: string) => new RegExp(COHORT_LABEL_RE.source, "i").test(s);
  return hasLabel(sa) || hasLabel(sb);
}

export function normalizeCompanyName(name: string | null | undefined): string | null {
  let n = normalizeTerm(name ?? "");
  if (!n) return null;
  // Recognized cohort labels are dropped BEFORE suffix/punctuation normalization
  // so "LanceDB (YC W22)" and "LanceDB" normalize identically, while
  // "Vanta (Stealth)" keeps its distinguishing text.
  n = n.replace(COHORT_LABEL_RE, " ");
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

/**
 * The FULL, canonical LinkedIn company URL for an identity.
 *
 * ── WHY THIS IS NEEDED AT ALL ───────────────────────────────────────────────
 *
 * `CompanyIdentity.linkedinUrl` is stored SCHEMELESS — `linkedin.com/company/x`
 * — because it is a comparison key and a scheme is noise in a comparison. Every
 * consumer that needs a URL rather than a key has to put the scheme back, and
 * each one that forgets fails silently and differently:
 *
 *   `normalizeCompanyLinkedInUrl` parses a real URL and returns null otherwise,
 *   so a seeded pool row quietly lost its LinkedIn identity and paid for a
 *   search it did not need.
 *
 *   `canonicalSubjectKey` is lossy and deterministic, so the schemeless form
 *   produces `linkedin-com-company-x` while every writer produces
 *   `https-www-linkedin-com-company-x` — a query that matches nothing and
 *   reports it as "I hold no evidence".
 *
 *   `monitoring_subjects.identifier` is documented as a domain or a LinkedIn
 *   company URL, and half a URL is neither.
 *
 * Three consumers, three different silent failures, one missing function. This
 * is it. The slug is the stable identifier and this emits exactly the shape
 * `normalizeCompanyLinkedInUrl` itself produces, so nothing is invented.
 */
export function canonicalLinkedinCompanyUrl(
  identity: Pick<CompanyIdentity, "linkedinCompanyId" | "linkedinUrl">,
): string | null {
  if (identity.linkedinCompanyId) {
    return `https://www.linkedin.com/company/${identity.linkedinCompanyId}`;
  }
  const raw = identity.linkedinUrl;
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
