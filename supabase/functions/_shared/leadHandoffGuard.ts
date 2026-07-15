// Real run-agent provenance guards. Pure / deterministic (imports only
// leadProvenance). These are the exact helpers run-agent calls at the two live
// choke points — the Scout→Aria hand-off and lead_candidates persistence — so an
// LLM-invented company/person/URL cannot reach Aria, canonical scoring, or the
// database. Tests exercise these same functions (not just the low-level unit
// helpers), so a green test proves the live path is guarded.

import {
  buildProviderIndex, type NormalizedProviderIndex,
  type CandidateIdentity,
} from "./leadProvenance.ts";

export type { NormalizedProviderIndex } from "./leadProvenance.ts";

// ------------------------------------------------------------- provider index --

export interface NormalizedProviderItem {
  company?: string | null;
  name?: string | null;
  person?: string | null;
  source_url?: string | null;
  url?: string | null;
  company_linkedin_url?: string | null;
  person_linkedin_url?: string | null;
  profile_url?: string | null;
  website?: string | null;
  domain?: string | null;
  job_url?: string | null;
  evidence_url?: string | null;
  provider_item_id?: string | null;
  normalized_candidate_id?: string | null;
}

const s = (v: unknown) => (v ?? "").toString().trim();
const nrm = (v: unknown) => s(v).toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");

/**
 * Build the immutable provider index from the NORMALIZED ACCEPTED provider items
 * only (never from LLM text). Indexes every strong identifier the item carries so
 * a candidate can match by a stable id/url even if a display name is reworded.
 */
export function buildProviderIndexFromItems(items: NormalizedProviderItem[]): NormalizedProviderIndex {
  // Base companies/people/urls from the shared helper …
  const idx = buildProviderIndex((items ?? []).map((it) => ({
    company: it.company ?? null,
    name: it.name ?? it.person ?? null,
    source_url: it.source_url ?? it.url ?? it.job_url ?? null,
    url: it.url ?? null,
  })));
  // … then add every additional strong URL/identifier to the url set.
  for (const it of items ?? []) {
    for (const u of [it.company_linkedin_url, it.person_linkedin_url, it.profile_url, it.website, it.job_url, it.evidence_url, it.url, it.source_url]) {
      if (s(u)) idx.urls.add(nrm(u));
    }
    if (s(it.domain)) idx.urls.add(nrm(it.domain));
  }
  return idx;
}

// ----------------------------------------------------------- Scout→Aria guard --

/** Parse candidate identity objects out of Scout's output (structured or JSON text). */
export function parseScoutCandidates(outputText: string | null | undefined, structured?: unknown): CandidateIdentity[] {
  let obj: unknown = structured;
  if (obj == null && typeof outputText === "string" && outputText.trim()) {
    try { obj = JSON.parse(outputText); } catch {
      const m = outputText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) { try { obj = JSON.parse(m[0]); } catch { obj = null; } }
    }
  }
  const list: any[] =
    (obj && Array.isArray((obj as any).candidates) && (obj as any).candidates) ||
    (obj && Array.isArray((obj as any).ranked) && (obj as any).ranked) ||
    (obj && Array.isArray((obj as any).results) && (obj as any).results) ||
    (Array.isArray(obj) && obj) || [];
  return list.map((r) => ({
    company: r.company ?? r.company_name ?? r.organization ?? null,
    person: r.name ?? r.person ?? r.full_name ?? null,
    source_url: r.source_url ?? r.url ?? r.profile_url ?? r.company_linkedin_url ?? null,
    evidence_url: r.evidence_url ?? r.job_url ?? null,
  }));
}

const nonEmpty = (v: unknown) => s(v).length > 0;

/**
 * Provider-backed check with stable-URL matching (stronger than display name):
 *   - every cited URL (source_url, evidence_url) MUST be in the provider index —
 *     a fabricated URL rejects the candidate;
 *   - a candidate is anchored when its company OR person is in the index, OR a
 *     cited URL is in the index (reworded name still matches via a stable URL);
 *   - a present company/person that is neither in the index nor URL-anchored is
 *     rejected (invented identity) — an invented founder cannot ride along on a
 *     real company.
 */
export function candidateProviderBacked(c: CandidateIdentity, index: NormalizedProviderIndex): { ok: boolean; reason: string | null } {
  for (const [label, u] of [["source_url", c.source_url], ["evidence_url", c.evidence_url]] as const) {
    if (nonEmpty(u) && !index.urls.has(nrm(u))) return { ok: false, reason: `${label} is not provider-backed (LLM-invented)` };
  }
  const urlAnchored = (nonEmpty(c.source_url) && index.urls.has(nrm(c.source_url))) || (nonEmpty(c.evidence_url) && index.urls.has(nrm(c.evidence_url)));
  const hasCompany = nonEmpty(c.company), hasPerson = nonEmpty(c.person);
  const companyInIndex = hasCompany && index.companies.has(nrm(c.company));
  const personInIndex = hasPerson && index.people.has(nrm(c.person));
  if (!hasCompany && !hasPerson && !urlAnchored) return { ok: false, reason: "candidate has no provider-backed identity" };
  if (hasCompany && !companyInIndex && !urlAnchored) return { ok: false, reason: `company "${s(c.company)}" is not provider-backed (LLM-invented)` };
  if (hasPerson && !personInIndex && !urlAnchored) return { ok: false, reason: `person "${s(c.person)}" is not provider-backed (LLM-invented)` };
  return { ok: true, reason: null };
}

export interface HandoffGuardResult {
  verified: CandidateIdentity[];
  rejected: Array<{ candidate: CandidateIdentity; reason: string }>;
  shouldStop: boolean;      // true → do NOT invoke Aria; return no_results
  summary: string;
}

/**
 * Gate Scout's claimed candidates against the provider index before Aria. Every
 * candidate must match provider output (company OR a stable person/url present in
 * the index). If none survive — including when the index is empty (0 accepted) —
 * Aria must not be invoked with fallback/invented candidates.
 */
export function guardScoutToAria(scoutCandidates: CandidateIdentity[], index: NormalizedProviderIndex | null): HandoffGuardResult {
  // No provider index or empty provider output → nothing real to hand off.
  const indexEmpty = !index || (index.companies.size === 0 && index.people.size === 0 && index.urls.size === 0);
  if (indexEmpty) {
    return { verified: [], rejected: (scoutCandidates ?? []).map((c) => ({ candidate: c, reason: "no accepted provider items — candidate is LLM-only" })), shouldStop: true, summary: "0 accepted provider items; Scout candidates are unsupported" };
  }
  const verified: CandidateIdentity[] = [];
  const rejected: HandoffGuardResult["rejected"] = [];
  for (const c of scoutCandidates ?? []) {
    const chk = candidateProviderBacked(c, index!);
    if (chk.ok) verified.push(c); else rejected.push({ candidate: c, reason: chk.reason ?? "unsupported identity" });
  }
  return {
    verified,
    rejected,
    shouldStop: verified.length === 0,
    summary: `${verified.length} provider-backed / ${rejected.length} rejected (LLM-invented)`,
  };
}

// ----------------------------------------------------- persistence provenance --

export interface ProviderProvenanceRecord {
  provider: string;
  actor_id: string;
  /** The logical actor key (e.g. "apify_people_search"). Complements the specific
   * actor_id implementation (e.g. "harvestapi/linkedin-profile-search"). */
  actor_key?: string | null;
  /** The normalized artifact type this candidate represents (person_candidate /
   * company_candidate / job_signal). Preserved through final persistence. */
  artifact_type?: string | null;
  provider_run_id: string;
  provider_item_id: string | null;
  normalized_candidate_id: string;
  source_url: string;
  company_domain: string | null;
  company_linkedin_url: string | null;
  person_linkedin_url: string | null;
  evidence_url: string | null;
  workflow_run_id: string;
  plan_id: string;
  trace_id: string | null;
  query_id: string | null;
  level: "account" | "person";
  verified: boolean;
  verification_method: string;
}

export interface ProvenanceCtx {
  provider?: string | null;
  actor_id?: string | null;
  actor_key?: string | null;
  artifact_type?: string | null;
  provider_run_id?: string | null;
  workflow_run_id?: string | null;
  plan_id?: string | null;
  trace_id?: string | null;
  query_id?: string | null;
}

/**
 * Build the canonical provider_provenance record for a persisted candidate from
 * the matched provider item + run context. Never fabricates: any missing REQUIRED
 * field yields verified=false (which the persistence guard rejects).
 */
export function buildProvenanceRecord(item: NormalizedProviderItem, ctx: ProvenanceCtx): ProviderProvenanceRecord {
  const source_url = s(item.source_url || item.url || item.job_url);
  const person_url = s(item.person_linkedin_url || item.profile_url);
  const rec: ProviderProvenanceRecord = {
    provider: s(ctx.provider) || "apify",
    actor_id: s(ctx.actor_id),
    actor_key: s(ctx.actor_key) || null,
    artifact_type: s(ctx.artifact_type) || null,
    provider_run_id: s(ctx.provider_run_id || ctx.workflow_run_id),
    provider_item_id: s(item.provider_item_id) || null,
    normalized_candidate_id: s(item.normalized_candidate_id) || (source_url ? "nc_" + nrm(source_url) : ""),
    source_url,
    company_domain: s(item.domain) || null,
    company_linkedin_url: s(item.company_linkedin_url) || null,
    person_linkedin_url: person_url || null,
    evidence_url: s(item.evidence_url || item.job_url) || null,
    workflow_run_id: s(ctx.workflow_run_id || ctx.provider_run_id),
    plan_id: s(ctx.plan_id),
    trace_id: s(ctx.trace_id) || null,
    query_id: s(ctx.query_id) || null,
    level: person_url ? "person" : "account",
    verified: false,
    verification_method: "",
  };
  const v = assertPersistenceProvenance(rec);
  rec.verified = v.ok;
  rec.verification_method = v.ok ? (rec.level === "person" ? "provider_item_url+person_url" : "provider_item_url") : "";
  return rec;
}

/**
 * Second guard: run BEFORE every lead_candidates insert/update. Requires the
 * required provenance fields to be present. A high fit score / LLM confidence /
 * canonical decision / matching display name can NEVER override a failure here.
 */
export function assertPersistenceProvenance(p: ProviderProvenanceRecord | null | undefined): { ok: boolean; reason: string | null } {
  if (!p) return { ok: false, reason: "missing provider_provenance" };
  if (!s(p.provider)) return { ok: false, reason: "missing provider" };
  if (!s(p.actor_id)) return { ok: false, reason: "missing actor_id" };
  if (!s(p.provider_run_id)) return { ok: false, reason: "missing provider_run_id" };
  if (!s(p.source_url)) return { ok: false, reason: "missing source_url" };
  if (!s(p.normalized_candidate_id)) return { ok: false, reason: "missing normalized_candidate_id" };
  if (!s(p.workflow_run_id)) return { ok: false, reason: "missing workflow_run_id" };
  if (!s(p.plan_id)) return { ok: false, reason: "missing plan_id" };
  if (p.level === "person" && !s(p.person_linkedin_url)) return { ok: false, reason: "person-level provenance requires person_linkedin_url" };
  return { ok: true, reason: null };
}

/** Verify a candidate's provenance still belongs to the current run's provider index/ids. */
export function provenanceMatchesRun(p: ProviderProvenanceRecord, ctx: ProvenanceCtx): boolean {
  if (s(ctx.provider_run_id) && s(p.provider_run_id) && nrm(p.provider_run_id) !== nrm(ctx.provider_run_id)) return false;
  if (s(ctx.workflow_run_id) && s(p.workflow_run_id) && nrm(p.workflow_run_id) !== nrm(ctx.workflow_run_id)) return false;
  if (s(ctx.plan_id) && s(p.plan_id) && nrm(p.plan_id) !== nrm(ctx.plan_id)) return false;
  return true;
}
