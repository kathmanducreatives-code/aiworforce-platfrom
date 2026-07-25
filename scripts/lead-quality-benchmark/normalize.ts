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
// SINGLE SOURCE OF TRUTH: the benchmark re-exports the shared runtime classifier
// (_shared/jobFamily.ts) so runtime sourcing, hard gates, and benchmark
// normalization can never disagree on "is this Sales/Revenue Operations?".
export { classifyJobFamily } from "../../supabase/functions/_shared/jobFamily.ts";
export type { JobFamily, JobFamilyResult } from "../../supabase/functions/_shared/jobFamily.ts";
import { classifyJobFamily } from "../../supabase/functions/_shared/jobFamily.ts";

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
