// Deterministic normalization for the benchmark.
//
// Reuses Agentory's ACTUAL normalization primitives (parseDomain, normalizeTerm,
// normalizeCountry) so the benchmark measures the real system rather than a
// parallel implementation. Raw values are preserved untouched on `raw`.

import { parseDomain } from "../../supabase/functions/_shared/apifyJobsNormalizer.ts";
import { normalizeTerm } from "../../supabase/functions/_shared/inputNormalize.ts";
import { normalizeCountry, detectCountryInText } from "../../supabase/functions/_shared/locationMatch.ts";
import type { DuplicateKeys, NormalizedCandidate, RawCandidate } from "./types.ts";

// -------------------------------------------------------- job-family model ----

export type JobFamily =
  | "sales_ops"
  | "rev_ops"
  | "gtm_ops"
  | "marketing_ops"
  | "manufacturing_ops"
  | "finance_ops"
  | "people_ops"
  | "sales_generic"
  | "support"
  | "other";

const SALES_OPS_RE = /\b(sales operations|sales ops|sales strategy (?:and|&) operations|sales (?:strategy|planning) (?:and|&) operations|deal desk)\b/i;
const REV_OPS_RE = /\b(revenue operations|rev ops|revops|revenue strategy (?:and|&) operations)\b/i;
const GTM_OPS_RE = /\b(gtm operations|go[- ]to[- ]market operations|gtm ops|growth operations)\b/i;
const MARKETING_OPS_RE = /\b(marketing operations|marketing ops|mops)\b/i;
const MANUFACTURING_OPS_RE = /\b(manufacturing operations|plant operations|production operations|warehouse operations|supply chain operations)\b/i;
const FINANCE_OPS_RE = /\b(finance operations|financial operations|accounting operations|fin ?ops)\b/i;
const PEOPLE_OPS_RE = /\b(people operations|hr operations|people ops)\b/i;
const SUPPORT_RE = /\b(customer support|customer success|support (?:agent|representative|specialist))\b/i;
const SALES_GENERIC_RE = /\b(account executive|sales representative|sales rep|sales development representative|business development representative|\bsdr\b|\bbdr\b|sales manager|account manager|inside sales)\b/i;
// A marketing-ops role only counts when it clearly carries revenue/sales scope.
const REVENUE_SCOPE_RE = /\b(revenue|sales operations|pipeline|gtm|go[- ]to[- ]market|quota|forecast(?:ing)?|deal desk|revops)\b/i;

export interface JobFamilyResult {
  family: JobFamily;
  /** The exact phrase that matched, for the gate's audit trail. */
  matchedPhrase: string | null;
  /** True when this is a Sales/Revenue-Operations family the hiring gate accepts. */
  qualifiesAsSalesOps: boolean;
}

/** Classify a job title/description into a coarse family (deterministic). */
export function classifyJobFamily(title: string | null, description: string | null): JobFamilyResult {
  const hay = [title ?? "", description ?? ""].join("  ").trim();
  const first = (re: RegExp): string | null => {
    const m = re.exec(hay);
    return m ? m[0] : null;
  };

  let m: string | null;
  if ((m = first(SALES_OPS_RE))) return { family: "sales_ops", matchedPhrase: m, qualifiesAsSalesOps: true };
  if ((m = first(REV_OPS_RE))) return { family: "rev_ops", matchedPhrase: m, qualifiesAsSalesOps: true };
  if ((m = first(GTM_OPS_RE))) return { family: "gtm_ops", matchedPhrase: m, qualifiesAsSalesOps: true };
  if ((m = first(MARKETING_OPS_RE))) {
    // Marketing ops qualifies ONLY with explicit revenue/sales scope.
    const qualifies = REVENUE_SCOPE_RE.test(hay);
    return { family: "marketing_ops", matchedPhrase: m, qualifiesAsSalesOps: qualifies };
  }
  if ((m = first(MANUFACTURING_OPS_RE))) return { family: "manufacturing_ops", matchedPhrase: m, qualifiesAsSalesOps: false };
  if ((m = first(FINANCE_OPS_RE))) return { family: "finance_ops", matchedPhrase: m, qualifiesAsSalesOps: false };
  if ((m = first(PEOPLE_OPS_RE))) return { family: "people_ops", matchedPhrase: m, qualifiesAsSalesOps: false };
  if ((m = first(SUPPORT_RE))) return { family: "support", matchedPhrase: m, qualifiesAsSalesOps: false };
  if ((m = first(SALES_GENERIC_RE))) return { family: "sales_generic", matchedPhrase: m, qualifiesAsSalesOps: false };
  return { family: "other", matchedPhrase: null, qualifiesAsSalesOps: false };
}

// ------------------------------------------------------------ URL canonical ----

/** Canonicalize a LinkedIn URL: lowercase host+path, strip query/hash/trailing slash. */
export function canonicalLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url).trim();
  if (!/linkedin\.com/i.test(s)) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    let path = u.pathname.replace(/\/+$/, "").toLowerCase();
    path = path.replace(/^\/(company|in|school)\//, "/$1/");
    return `linkedin.com${path}`;
  } catch {
    return s.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() || null;
  }
}

// --------------------------------------------------------------- name norm ----

export function normalizePersonName(name: string | null | undefined): string | null {
  const n = normalizeTerm(name ?? "");
  return n ? n : null;
}

/** Strip common company suffixes so "Acme, Inc." and "Acme" collapse. */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  let n = normalizeTerm(name ?? "");
  if (!n) return null;
  n = n.replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corporation|co|company|gmbh|plc|limited|holdings|technologies|technology|software|labs|the)\b/gi, " ");
  n = n.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

// ------------------------------------------------------------ freshness -------

/** Whole days between an observed source date and `asOf` (null when no date). */
export function freshnessDays(sourceDate: string | null, asOf: string): number | null {
  if (!sourceDate) return null;
  const t = Date.parse(sourceDate);
  const now = Date.parse(asOf);
  if (Number.isNaN(t) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

// ------------------------------------------------------------- dup keys -------

export function buildDuplicateKeys(n: {
  canonicalDomain: string | null;
  companyLinkedinUrl: string | null;
  normalizedCompanyName: string | null;
  personLinkedinUrl: string | null;
  normalizedPersonName: string | null;
}): DuplicateKeys {
  return {
    accountByDomain: n.canonicalDomain ? `domain:${n.canonicalDomain}` : null,
    accountByLinkedin: n.companyLinkedinUrl ? `company_li:${n.companyLinkedinUrl}` : null,
    accountByNameFallback: n.normalizedCompanyName ? `company_name:${n.normalizedCompanyName}` : null,
    personByLinkedin: n.personLinkedinUrl ? `person_li:${n.personLinkedinUrl}` : null,
    personByCompanyNameFallback:
      n.normalizedCompanyName && n.normalizedPersonName
        ? `person_name:${n.normalizedCompanyName}|${n.normalizedPersonName}`
        : null,
  };
}

// ------------------------------------------------------ current-employer ------

/** True when the person's stated current employer matches the target company. */
export function employerMatches(targetCompany: string | null, statedCompany: string | null): boolean {
  const a = normalizeCompanyName(targetCompany);
  const b = normalizeCompanyName(statedCompany);
  if (!a || !b) return false;
  if (a === b) return true;
  // One being a token-subset of the other (e.g. "harmonic" vs "harmonic security").
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return false;
  const [small, big] = at.size <= bt.size ? [at, bt] : [bt, at];
  let overlap = 0;
  for (const t of small) if (big.has(t)) overlap += 1;
  return overlap === small.size;
}

// ------------------------------------------------------------- normalize ------

export function normalizeCandidate(raw: RawCandidate, opts: { asOf: string }): NormalizedCandidate {
  const canonicalDomain =
    parseDomain(raw.companyDomain) ??
    parseDomain(raw.companyLinkedinUrl) ??
    parseDomain(raw.jobPostingUrl) ??
    parseDomain(raw.sourceUrl);

  const family = classifyJobFamily(raw.jobTitle, raw.jobDescriptionExcerpt);
  const country =
    normalizeCountry(raw.jobLocation) ??
    normalizeCountry(raw.rawLocation) ??
    detectCountryInText(raw.jobLocation) ??
    detectCountryInText(raw.jobDescriptionExcerpt);

  const normalizedCompanyName = normalizeCompanyName(raw.companyName);
  const companyLinkedinUrl = canonicalLinkedinUrl(raw.companyLinkedinUrl);
  const personLinkedinUrl = canonicalLinkedinUrl(raw.personLinkedinUrl);
  const normalizedPersonName = normalizePersonName(raw.personName);

  return {
    candidateId: candidateIdFor(raw),
    normalizedCompanyName,
    canonicalDomain,
    normalizedPersonName,
    normalizedJobTitle: (normalizeTerm(raw.jobTitle ?? "").toLowerCase()) || null,
    normalizedJobFamily: family.family,
    normalizedLocation: normalizeTerm(raw.jobLocation ?? raw.rawLocation ?? "") || null,
    normalizedCountry: country,
    companyLinkedinUrl,
    personLinkedinUrl,
    sourceDate: raw.jobObservedDate,
    evidenceUrl: raw.jobPostingUrl ?? raw.sourceUrl ?? null,
    evidenceFreshnessDays: freshnessDays(raw.jobObservedDate, opts.asOf),
    currentEmployerMatch: employerMatches(raw.companyName, raw.statedCurrentCompany),
    duplicateKeys: buildDuplicateKeys({
      canonicalDomain,
      companyLinkedinUrl,
      normalizedCompanyName,
      personLinkedinUrl,
      normalizedPersonName,
    }),
    raw,
  };
}

function candidateIdFor(raw: RawCandidate): string {
  const base = raw.companyDomain ?? raw.companyName ?? raw.sourceUrl ?? `item-${raw.rawItemIndex}`;
  return `${normalizeTerm(String(base)).replace(/\s+/g, "-") || "cand"}-${raw.rawItemIndex}`;
}
