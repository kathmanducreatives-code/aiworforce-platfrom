// Company enrichment observability (Phase 2, Section 15) — pure / sanitized.
//
// Explains, per workflow and per company: what was planned, what was called, what
// came back, what evidence it added, and what the candidates decided afterwards —
// so a reviewer can reconcile spend against outcome without seeing raw payloads.
//
// Never exposes: emails, phone numbers, secrets, tokens, headers, raw provider
// payloads, URL query strings/fragments, or hidden prompts.

import type { EvidenceCategory } from "./evidenceContract.ts";
import type { CompanyEnrichmentOutcome } from "./structuredCompanyEnrichment.ts";

const CONTROL = /[\u0000-\u001F\u007F]/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const SECRET_RES: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\b(?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){1,2}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/gi,
];

export const MAX_COMPANY_DIAGNOSTICS = 25;

function clean(v: unknown, cap = 120): string | undefined {
  if (v == null) return undefined;
  let s = String(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  s = s.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[redacted-phone]" : m));
  for (const re of SECRET_RES) s = s.replace(re, "[redacted-token]");
  return s.slice(0, cap);
}

/** Public http(s) URL with userinfo/query/fragment removed, else undefined. */
function publicUrl(v: unknown): string | undefined {
  if (v == null) return undefined;
  try {
    const u = new URL(String(v).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return undefined; }
}

/** Non-reversible short fingerprint of the company key (never the raw key). */
export function companyKeyFingerprint(companyKey: string): string {
  let h = 5381;
  for (let i = 0; i < companyKey.length; i++) h = ((h * 33) ^ companyKey.charCodeAt(i)) >>> 0;
  return "ck_" + h.toString(36);
}

export interface CompanyEnrichmentDiagnostic {
  company_key_fingerprint: string;
  company_name?: string;
  company_linkedin_url?: string;
  official_website?: string;
  associated_candidate_count: number;

  missing_evidence_before: EvidenceCategory[];
  action: string;
  actor_key?: string;
  actor_id?: string;
  verified_binding: boolean;
  provider_run_id?: string;

  fields_returned: string[];
  evidence_added: EvidenceCategory[];
  missing_evidence_after: EvidenceCategory[];

  sufficiency_before: boolean;
  sufficiency_after: boolean;
  qualification_rerun: boolean;
  final_candidate_decisions: string[];

  outcome: CompanyEnrichmentOutcome;
  failure_reason?: string;
}

export interface CompanyEnrichmentSummary {
  candidates_considered: number;
  companies_deduplicated: number;
  companies_planned: number;
  companies_called: number;
  companies_enriched: number;
  companies_no_result: number;
  companies_failed: number;
  /** Documented SUBSET of companies_failed (a call was launched but timed out). */
  companies_timed_out: number;
  companies_cached: number;
  companies_skipped: number;
  /** Documented SUBSET of companies_skipped (no call launched — deadline reached). */
  companies_skipped_deadline: number;
  budget_limit: number;
  budget_consumed: number;
  stop_reason: string;
  /** planned == called + cached + skipped, and called == enriched + no_result + failed. */
  reconciles: boolean;
}

export interface CompanyEnrichmentObservability {
  summary: CompanyEnrichmentSummary;
  companies: CompanyEnrichmentDiagnostic[];
  truncated: number;
}

export interface CompanyDiagnosticInput {
  companyKey: string;
  companyName?: unknown;
  companyLinkedInUrl?: unknown;
  officialWebsite?: unknown;
  associatedCandidateIds: string[];
  missingBefore: EvidenceCategory[];
  action: string;
  actorKey?: string | null;
  actorId?: string | null;
  verifiedBinding: boolean;
  providerRunId?: string | null;
  fieldsReturned?: string[];
  evidenceAdded?: EvidenceCategory[];
  missingAfter?: EvidenceCategory[];
  sufficiencyBefore: boolean;
  sufficiencyAfter: boolean;
  qualificationRerun: boolean;
  finalCandidateDecisions?: string[];
  outcome: CompanyEnrichmentOutcome;
  failureReason?: string | null;
}

export function buildCompanyDiagnostic(i: CompanyDiagnosticInput): CompanyEnrichmentDiagnostic {
  return {
    company_key_fingerprint: companyKeyFingerprint(i.companyKey),
    company_name: clean(i.companyName, 120),
    company_linkedin_url: publicUrl(i.companyLinkedInUrl),
    official_website: publicUrl(i.officialWebsite),
    associated_candidate_count: i.associatedCandidateIds.length,
    missing_evidence_before: i.missingBefore ?? [],
    action: clean(i.action, 40) ?? "unknown",
    actor_key: i.actorKey ? clean(i.actorKey, 60) : undefined,
    actor_id: i.actorId ? clean(i.actorId, 80) : undefined,
    verified_binding: i.verifiedBinding === true,
    provider_run_id: i.providerRunId ? clean(i.providerRunId, 60) : undefined,
    fields_returned: (i.fieldsReturned ?? []).map((f) => clean(f, 40)!).filter(Boolean),
    evidence_added: i.evidenceAdded ?? [],
    missing_evidence_after: i.missingAfter ?? [],
    sufficiency_before: i.sufficiencyBefore === true,
    sufficiency_after: i.sufficiencyAfter === true,
    qualification_rerun: i.qualificationRerun === true,
    final_candidate_decisions: (i.finalCandidateDecisions ?? []).map((d) => clean(d, 40)!).filter(Boolean),
    outcome: i.outcome,
    failure_reason: i.failureReason ? clean(i.failureReason, 160) : undefined,
  };
}

export function buildCompanyEnrichmentObservability(input: {
  candidatesConsidered: number;
  companiesDeduplicated: number;
  budgetLimit: number;
  budgetConsumed: number;
  stopReason: string;
  companies: CompanyDiagnosticInput[];
  limit?: number;
}): CompanyEnrichmentObservability {
  const all = input.companies.map(buildCompanyDiagnostic);
  const cap = Math.max(1, Math.min(MAX_COMPANY_DIAGNOSTICS, input.limit ?? MAX_COMPANY_DIAGNOSTICS));
  const kept = all.slice(0, cap);

  const planned = input.companies.length;
  const enriched = input.companies.filter((c) => c.outcome === "enriched").length;
  const noResult = input.companies.filter((c) => c.outcome === "no_result").length;
  const timedOut = input.companies.filter((c) => c.outcome === "timeout").length;              // ⊆ failed
  const failed = input.companies.filter((c) => c.outcome === "provider_error" || c.outcome === "invalid_result" || c.outcome === "timeout").length;
  const cached = input.companies.filter((c) => c.outcome === "cached").length;
  const skippedDeadline = input.companies.filter((c) => c.outcome === "skipped_due_deadline").length; // ⊆ skipped
  const skipped = input.companies.filter((c) => c.outcome === "budget_skipped" || c.outcome === "not_needed" || c.outcome === "skipped_due_deadline").length;
  const called = enriched + noResult + failed;

  const summary: CompanyEnrichmentSummary = {
    candidates_considered: input.candidatesConsidered,
    companies_deduplicated: input.companiesDeduplicated,
    companies_planned: planned,
    companies_called: called,
    companies_enriched: enriched,
    companies_no_result: noResult,
    companies_failed: failed,
    companies_timed_out: timedOut,
    companies_cached: cached,
    companies_skipped: skipped,
    companies_skipped_deadline: skippedDeadline,
    budget_limit: input.budgetLimit,
    budget_consumed: input.budgetConsumed,
    stop_reason: clean(input.stopReason, 60) ?? "completed",
    reconciles: planned === called + cached + skipped && called === enriched + noResult + failed,
  };
  return { summary, companies: kept, truncated: Math.max(0, all.length - kept.length) };
}
