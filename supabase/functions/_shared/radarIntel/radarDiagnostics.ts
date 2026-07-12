// Per-source radar diagnostics + honest readiness states. PURE / Deno-testable.
// "Ready" must never mean only "an API key exists" — readiness reflects what the
// last run actually did. Zero results always carry an explanation.

export type SourceReadiness =
  | "not_configured"       // no actor/key for this source
  | "configured_untested"  // configured but never run
  | "healthy"              // last run returned usable, accepted signals
  | "degraded"             // partial/limited results
  | "returned_zero"        // ran fine, zero raw results
  | "auth_failed"          // provider auth error
  | "provider_error"       // provider threw
  | "query_no_match"       // queries ran, no matches
  | "matches_rejected";    // matches found but all rejected by quality gates

export type ExecutionStatus = "ran" | "skipped_setup_required" | "skipped_not_configured" | "error";

export interface SourceDiagnostics {
  source: string;
  execution_status: ExecutionStatus;
  readiness: SourceReadiness;
  queries_attempted: string[];
  query_stage: number;            // 1=exact, 2=synonym, 3=adjacent, 0=none
  hard_filters: string[];
  relaxed_filters: string[];
  raw_count: number;
  normalized_count: number;
  duplicate_count: number;
  rejected_count: number;
  accepted_count: number;
  verified_count: number;
  needs_review_count: number;
  provider_error: string | null;
  rejection_reasons: Record<string, number>;
  elapsed_ms: number;
  provider_items_consumed: number;
  estimated_cost_usd: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface DiagnosticsInput {
  source: string;
  configured: boolean;
  everRun?: boolean;
  execution_status?: ExecutionStatus;
  queries_attempted?: string[];
  query_stage?: number;
  hard_filters?: string[];
  relaxed_filters?: string[];
  raw_count?: number;
  normalized_count?: number;
  duplicate_count?: number;
  rejected_count?: number;
  accepted_count?: number;
  verified_count?: number;
  needs_review_count?: number;
  provider_error?: string | null;
  auth_failed?: boolean;
  rejection_reasons?: Record<string, number>;
  elapsed_ms?: number;
  provider_items_consumed?: number;
  estimated_cost_usd?: number;
  started_at?: string | null;
  completed_at?: string | null;
}

/** Resolve the honest readiness state from what actually happened. */
export function resolveReadiness(i: DiagnosticsInput): SourceReadiness {
  if (!i.configured) return "not_configured";
  if (i.auth_failed) return "auth_failed";
  if (i.provider_error) return "provider_error";
  if (i.execution_status === "skipped_not_configured") return "not_configured";
  if (!i.everRun && (i.execution_status === undefined)) return "configured_untested";
  const raw = i.raw_count ?? 0;
  const accepted = i.accepted_count ?? 0;
  const rejected = i.rejected_count ?? 0;
  if (raw === 0) {
    // Ran but nothing came back vs. queries simply didn't match.
    return (i.queries_attempted?.length ?? 0) > 0 ? "query_no_match" : "returned_zero";
  }
  if (accepted === 0 && rejected > 0) return "matches_rejected";
  if (accepted > 0 && (i.verified_count ?? 0) === 0) return "degraded";
  if (accepted > 0) return "healthy";
  return "returned_zero";
}

export function buildSourceDiagnostics(i: DiagnosticsInput): SourceDiagnostics {
  return {
    source: i.source,
    execution_status: i.execution_status ?? (i.configured ? "ran" : "skipped_not_configured"),
    readiness: resolveReadiness(i),
    queries_attempted: i.queries_attempted ?? [],
    query_stage: i.query_stage ?? 0,
    hard_filters: i.hard_filters ?? [],
    relaxed_filters: i.relaxed_filters ?? [],
    raw_count: i.raw_count ?? 0,
    normalized_count: i.normalized_count ?? 0,
    duplicate_count: i.duplicate_count ?? 0,
    rejected_count: i.rejected_count ?? 0,
    accepted_count: i.accepted_count ?? 0,
    verified_count: i.verified_count ?? 0,
    needs_review_count: i.needs_review_count ?? 0,
    provider_error: i.provider_error ?? null,
    rejection_reasons: i.rejection_reasons ?? {},
    elapsed_ms: i.elapsed_ms ?? 0,
    provider_items_consumed: i.provider_items_consumed ?? 0,
    estimated_cost_usd: i.estimated_cost_usd ?? 0,
    started_at: i.started_at ?? null,
    completed_at: i.completed_at ?? null,
  };
}

/** A human sentence explaining a source's outcome — never an unexplained blank. */
export function explainDiagnostics(d: SourceDiagnostics): string {
  switch (d.readiness) {
    case "not_configured": return `${d.source}: not configured — no provider/actor is set up for this source.`;
    case "configured_untested": return `${d.source}: configured but not yet run.`;
    case "auth_failed": return `${d.source}: authentication failed with the provider.`;
    case "provider_error": return `${d.source}: provider error — ${d.provider_error ?? "unknown"}.`;
    case "returned_zero": return `${d.source}: the scan returned zero results.`;
    case "query_no_match": return `${d.source}: ${d.queries_attempted.length} quer${d.queries_attempted.length === 1 ? "y" : "ies"} ran but matched nothing.`;
    case "matches_rejected": {
      const top = Object.entries(d.rejection_reasons).sort((a, b) => b[1] - a[1])[0];
      return `${d.source}: ${d.raw_count} retrieved; all ${d.rejected_count} rejected${top ? ` (mostly ${top[0]})` : ""}.`;
    }
    case "degraded": return `${d.source}: ${d.accepted_count} accepted, but none reached verified — needs review.`;
    case "healthy": return `${d.source}: ${d.verified_count} verified of ${d.accepted_count} accepted.`;
  }
}
