// Provider-provenance integrity for Find Leads candidates. Pure / import-free.
//
// Root cause it fixes: when the provider (Apify) accepted 0 candidates, an LLM
// step still emitted invented companies/people (absent from the provider output) that
// flowed into qualification and outreach. This module defines the contract that a
// candidate identity may enter qualification or persistence ONLY when it traces
// to normalized provider input. An LLM may classify/score provider-backed facts,
// but may never introduce a new company, person, URL, job, funding event or
// metric. It also defines the canonical zero-result response.

export interface CandidateProvenance {
  provider?: string | null;          // e.g. "apify"
  actor_id?: string | null;          // e.g. "curious_coder/linkedin-jobs-scraper"
  provider_run_id?: string | null;   // the actor run id
  provider_item_id?: string | null;  // stable per-item id from the provider, if any
  source_fingerprint?: string | null;// deterministic fallback when no item id
  source_url?: string | null;        // provider-backed URL
  normalized_candidate_id?: string | null;
  run_id?: string | null;            // evaluation / workflow run id
}

const s = (v: unknown) => (v ?? "").toString().trim();
const nonEmpty = (v: unknown) => s(v).length > 0;

/**
 * Deterministic fingerprint for a candidate when the provider gives no stable
 * item id. Stable across runs for the same identity (provider + url + name).
 */
export function buildSourceFingerprint(f: { provider?: string | null; source_url?: string | null; name?: string | null; company?: string | null }): string {
  const basis = [s(f.provider).toLowerCase(), s(f.source_url).toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, ""), s(f.name).toLowerCase(), s(f.company).toLowerCase()].join("|");
  // Small, dependency-free 53-bit hash (FNV-1a style) rendered hex.
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return "sf_" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * A candidate has valid provenance when it names a provider + actor + run, a
 * source_url, a normalized id, a run id, AND at least one stable per-item anchor
 * (provider_item_id or source_fingerprint). Missing any → not provider-backed.
 */
export function hasValidProvenance(p: CandidateProvenance | null | undefined): boolean {
  if (!p) return false;
  if (!nonEmpty(p.provider)) return false;
  if (!nonEmpty(p.actor_id)) return false;
  if (!nonEmpty(p.provider_run_id)) return false;
  if (!nonEmpty(p.source_url)) return false;
  if (!nonEmpty(p.normalized_candidate_id)) return false;
  if (!nonEmpty(p.run_id)) return false;
  if (!nonEmpty(p.provider_item_id) && !nonEmpty(p.source_fingerprint)) return false;
  return true;
}

/** Normalized identity keys the provider actually returned (companies/people/urls). */
export interface NormalizedProviderIndex {
  companies: Set<string>;
  people: Set<string>;
  urls: Set<string>;
}

const norm = (v: unknown) => s(v).toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Build the index of identities that exist in the normalized provider output. */
export function buildProviderIndex(items: Array<{ company?: string | null; name?: string | null; person?: string | null; source_url?: string | null; url?: string | null }>): NormalizedProviderIndex {
  const companies = new Set<string>(); const people = new Set<string>(); const urls = new Set<string>();
  for (const it of items ?? []) {
    if (nonEmpty(it.company)) companies.add(norm(it.company));
    const person = it.name ?? it.person;
    if (nonEmpty(person)) people.add(norm(person));
    if (nonEmpty(it.source_url)) urls.add(norm(it.source_url));
    if (nonEmpty(it.url)) urls.add(norm(it.url));
  }
  return { companies, people, urls };
}

export interface CandidateIdentity {
  company?: string | null;
  person?: string | null;
  source_url?: string | null;
  evidence_url?: string | null;
  provenance?: CandidateProvenance | null;
}

export interface ProvenanceCheck { ok: boolean; reason: string | null }

/**
 * A candidate identity is provider-backed only when its company/person/url are
 * present in the normalized provider index. An identity the LLM invented (absent
 * from provider input) is rejected — it must never reach Aria, Penn or
 * persistence. Enrichment text may DESCRIBE a provider-backed candidate but may
 * not CREATE a new identity, so the anchor identity must be provider-present.
 */
export function assertProviderBacked(c: CandidateIdentity, idx: NormalizedProviderIndex): ProvenanceCheck {
  const hasCompany = nonEmpty(c.company);
  const hasPerson = nonEmpty(c.person);
  if (!hasCompany && !hasPerson) return { ok: false, reason: "candidate has no company or person identity" };
  if (hasCompany && !idx.companies.has(norm(c.company))) {
    return { ok: false, reason: `company "${s(c.company)}" is not present in normalized provider input (LLM-invented)` };
  }
  if (hasPerson && !idx.people.has(norm(c.person))) {
    return { ok: false, reason: `person "${s(c.person)}" is not present in normalized provider input (LLM-invented)` };
  }
  // A cited source/evidence URL must also come from the provider set.
  if (nonEmpty(c.source_url) && !idx.urls.has(norm(c.source_url))) {
    return { ok: false, reason: `source_url is not provider-backed (LLM-invented)` };
  }
  if (nonEmpty(c.evidence_url) && !idx.urls.has(norm(c.evidence_url))) {
    return { ok: false, reason: `evidence_url is not provider-backed (LLM-invented)` };
  }
  return { ok: true, reason: null };
}

export interface ProvenanceFilterResult<T> {
  kept: T[];
  rejected: Array<{ candidate: T; reason: string }>;
}

/** Keep only provider-backed candidates; report the rest with reasons. */
export function filterToProviderBacked<T extends CandidateIdentity>(candidates: T[], idx: NormalizedProviderIndex): ProvenanceFilterResult<T> {
  const kept: T[] = []; const rejected: ProvenanceFilterResult<T>["rejected"] = [];
  for (const c of candidates ?? []) {
    const chk = assertProviderBacked(c, idx);
    if (chk.ok) kept.push(c); else rejected.push({ candidate: c, reason: chk.reason ?? "unsupported identity" });
  }
  return { kept, rejected };
}

export interface ZeroResult {
  status: "no_results";
  leads: [];
  qualified_count: 0;
  contact_ready_count: 0;
  rejection_summary: string;
}

/** The canonical honest zero-result (never fabricate or pad to the requested count). */
export function zeroResult(rejection_summary = "No provider-backed candidates survived qualification."): ZeroResult {
  return { status: "no_results", leads: [], qualified_count: 0, contact_ready_count: 0, rejection_summary };
}
