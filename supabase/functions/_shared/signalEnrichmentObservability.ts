// Signal-enrichment observability (Phase B) — pure, sanitized, reconciling.
//
// Explains the structured hiring-signal enrichment stage without exposing any raw
// provider content. Reconciliation mirrors the company-enrichment observability:
//   planned = called + cached + skipped
//   called  = enriched + no_result + failed
// where timed_out ⊆ failed and skipped_due_deadline ⊆ skipped.

export interface SignalEnrichmentSummary {
  candidates_considered: number;
  companies_deduplicated: number;
  companies_planned: number;
  companies_called: number;
  companies_cached: number;
  companies_skipped: number;
  companies_skipped_deadline: number;
  companies_enriched: number;
  companies_no_result: number;
  companies_failed: number;
  companies_timed_out: number;

  raw_job_records: number;
  normalized_job_events: number;
  verified_signal_events: number;
  deduplicated_signal_events: number;
  signals_fresh: number;
  signals_weak_supporting: number;
  signals_stale: number;
  closed_or_expired_listings: number;

  candidates_timing_sufficient: number;
  candidates_missing_timing_evidence: number;
  candidates_timing_contradicted: number;
  candidates_requalified: number;

  budget_lookups_limit: number;
  budget_lookups_used: number;
  stop_reason: string;
  reconciles: boolean;
}

/** Per-company diagnostic — company key is fingerprinted, never raw. */
export interface SignalCompanyDiagnostic {
  company_key_fingerprint: string;
  associated_candidate_count: number;
  actor_key?: string;
  actor_id?: string;
  outcome: string;
  raw_records: number;
  verified_signals: number;
  failure_reason?: string;
}

export interface SignalEnrichmentObservability {
  summary: SignalEnrichmentSummary;
  companies: SignalCompanyDiagnostic[];
  truncated: number;
}

export const MAX_SIGNAL_DIAGNOSTICS = 25;

export function signalCompanyFingerprint(companyKey: string): string {
  let h = 5381;
  for (let i = 0; i < companyKey.length; i++) h = ((h * 33) ^ companyKey.charCodeAt(i)) >>> 0;
  return "sk_" + h.toString(36);
}

export type SignalCompanyOutcome =
  | "enriched" | "no_result" | "failed" | "timeout"
  | "cached" | "skipped" | "skipped_due_deadline";

export interface SignalCompanyDiagnosticInput {
  companyKey: string;
  associatedCandidateIds: string[];
  actorKey?: string;
  actorId?: string;
  outcome: SignalCompanyOutcome;
  rawRecords?: number;
  verifiedSignals?: number;
  failureReason?: string | null;
}

export interface BuildSignalObservabilityInput {
  candidatesConsidered: number;
  companiesDeduplicated: number;
  companies: SignalCompanyDiagnosticInput[];
  rawJobRecords: number;
  normalizedJobEvents: number;
  verifiedSignalEvents: number;
  deduplicatedSignalEvents: number;
  signalsFresh: number;
  signalsWeakSupporting: number;
  signalsStale: number;
  closedOrExpiredListings: number;
  candidatesTimingSufficient: number;
  candidatesMissingTimingEvidence: number;
  candidatesTimingContradicted: number;
  candidatesRequalified: number;
  budgetLookupsLimit: number;
  budgetLookupsUsed: number;
  stopReason: string;
  limit?: number;
}

/** Empty, reconciling observability for terminals reached before signal
 * enrichment ran (guarantees the object is present in every terminal). */
export function emptySignalEnrichmentObservability(candidatesConsidered = 0, budgetLookupsLimit = 5): SignalEnrichmentObservability {
  return buildSignalEnrichmentObservability({
    candidatesConsidered, companiesDeduplicated: 0, companies: [],
    rawJobRecords: 0, normalizedJobEvents: 0, verifiedSignalEvents: 0, deduplicatedSignalEvents: 0,
    signalsFresh: 0, signalsWeakSupporting: 0, signalsStale: 0, closedOrExpiredListings: 0,
    candidatesTimingSufficient: 0, candidatesMissingTimingEvidence: 0, candidatesTimingContradicted: 0,
    candidatesRequalified: 0, budgetLookupsLimit, budgetLookupsUsed: 0, stopReason: "no_enrichment",
  });
}

export function buildSignalEnrichmentObservability(input: BuildSignalObservabilityInput): SignalEnrichmentObservability {
  const c = input.companies;
  const enriched = c.filter((x) => x.outcome === "enriched").length;
  const noResult = c.filter((x) => x.outcome === "no_result").length;
  const timedOut = c.filter((x) => x.outcome === "timeout").length;                    // ⊆ failed
  const failed = c.filter((x) => x.outcome === "failed" || x.outcome === "timeout").length;
  const cached = c.filter((x) => x.outcome === "cached").length;
  const skippedDeadline = c.filter((x) => x.outcome === "skipped_due_deadline").length; // ⊆ skipped
  const skipped = c.filter((x) => x.outcome === "skipped" || x.outcome === "skipped_due_deadline").length;
  const planned = c.length;
  const called = enriched + noResult + failed;

  const summary: SignalEnrichmentSummary = {
    candidates_considered: input.candidatesConsidered,
    companies_deduplicated: input.companiesDeduplicated,
    companies_planned: planned,
    companies_called: called,
    companies_cached: cached,
    companies_skipped: skipped,
    companies_skipped_deadline: skippedDeadline,
    companies_enriched: enriched,
    companies_no_result: noResult,
    companies_failed: failed,
    companies_timed_out: timedOut,
    raw_job_records: input.rawJobRecords,
    normalized_job_events: input.normalizedJobEvents,
    verified_signal_events: input.verifiedSignalEvents,
    deduplicated_signal_events: input.deduplicatedSignalEvents,
    signals_fresh: input.signalsFresh,
    signals_weak_supporting: input.signalsWeakSupporting,
    signals_stale: input.signalsStale,
    closed_or_expired_listings: input.closedOrExpiredListings,
    candidates_timing_sufficient: input.candidatesTimingSufficient,
    candidates_missing_timing_evidence: input.candidatesMissingTimingEvidence,
    candidates_timing_contradicted: input.candidatesTimingContradicted,
    candidates_requalified: input.candidatesRequalified,
    budget_lookups_limit: input.budgetLookupsLimit,
    budget_lookups_used: input.budgetLookupsUsed,
    stop_reason: input.stopReason,
    reconciles: planned === called + cached + skipped && called === enriched + noResult + failed,
  };

  const cap = Math.max(1, Math.min(MAX_SIGNAL_DIAGNOSTICS, input.limit ?? MAX_SIGNAL_DIAGNOSTICS));
  const kept = c.slice(0, cap).map((x): SignalCompanyDiagnostic => ({
    company_key_fingerprint: signalCompanyFingerprint(x.companyKey),
    associated_candidate_count: x.associatedCandidateIds.length,
    ...(x.actorKey ? { actor_key: x.actorKey } : {}),
    ...(x.actorId ? { actor_id: x.actorId } : {}),
    outcome: x.outcome,
    raw_records: x.rawRecords ?? 0,
    verified_signals: x.verifiedSignals ?? 0,
    ...(x.failureReason ? { failure_reason: String(x.failureReason).slice(0, 160) } : {}),
  }));

  return { summary, companies: kept, truncated: Math.max(0, c.length - kept.length) };
}
