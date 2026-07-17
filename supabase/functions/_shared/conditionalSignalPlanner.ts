// Conditional signal-enrichment planner + budget + deduplication (Phase A) — pure.
//
// SEARCH WIDE → VERIFY FIT → ENRICH TIMING NARROWLY.
// Signal discovery is the most expensive stage, so it runs ONLY for candidates that
// already passed identity and company-fit gates and still need timing. Running it for
// every raw sourced person is exactly the cost blow-up the bounded company-enrichment
// work exists to prevent.
//
// This module PLANS only. No provider is bound or called here (Phase A is
// provider-free); execution belongs to a later capability-adapter branch.

import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
import type { TimingAssessment, TimingRequirement } from "./timingAssessment.ts";
import {
  type SignalEvent, type SignalEvidenceRef, buildSignalDedupeKey, DEDUPE_WINDOW_HOURS,
} from "./signalEvent.ts";

// ------------------------------------------------------------- budget ---------

/**
 * Signal budget — deliberately SEPARATE from WorkflowEvidenceBudget so signal
 * discovery can never silently consume the company-enrichment allowance.
 */
export interface SignalEnrichmentBudget {
  /** Max candidates that may be signal-enriched in one workflow. */
  maxCandidates: number;
  /** Max signal lookups overall. */
  maxSignalLookups: number;
  /** Max lookups for any single company (dedupe fans results back out). */
  maxLookupsPerCompany: number;
  /** Max lookups for any single person. */
  maxLookupsPerPerson: number;
  /** Absolute epoch-ms deadline; past it, nothing new is planned. */
  deadlineMs?: number | null;
  /** Reuse a still-fresh cached signal instead of paying for a lookup. */
  reuseFreshSignals: boolean;
}

/** Conservative, documented defaults — mirrors the bounded-enrichment posture. */
export const DEFAULT_SIGNAL_BUDGET: SignalEnrichmentBudget = {
  maxCandidates: 5,
  maxSignalLookups: 5,
  maxLookupsPerCompany: 1,
  maxLookupsPerPerson: 1,
  deadlineMs: null,
  reuseFreshSignals: true,
};

export interface SignalBudgetLedger {
  candidatesPlanned: number;
  lookupsPlanned: number;
  perCompany: Map<string, number>;
  perPerson: Map<string, number>;
}

export const emptySignalLedger = (): SignalBudgetLedger => ({
  candidatesPlanned: 0, lookupsPlanned: 0, perCompany: new Map(), perPerson: new Map(),
});

// ------------------------------------------------------------ planning --------

export type SignalPlanOutcome =
  | "skip_not_required"
  | "skip_already_sufficient"
  | "plan_structured_signal_lookup"
  | "stage_budget_exhausted"
  | "stage_no_supported_source";

export interface SignalEnrichmentPlan {
  candidateId: string;
  outcome: SignalPlanOutcome;
  /** Categories a lookup would try to prove. */
  targetCategories: string[];
  companyRef?: string | null;
  personRef?: string | null;
  reason: string;
  /** True only for plan_structured_signal_lookup. */
  willCallProvider: boolean;
}

export interface SignalPlanInput {
  candidateId: string;
  companyRef?: string | null;
  personRef?: string | null;
  /** Post-company-enrichment sufficiency — proves identity + fit are settled. */
  sufficiency: EvidenceSufficiencyResult;
  timing: TimingAssessment;
  requirement: TimingRequirement;
  /** A hard gate already failed (source gate / ICP contradiction / provenance). */
  hardBlocked?: boolean;
  /** Whether ANY capable signal source is currently bound. Phase A: false. */
  supportedSourceAvailable: boolean;
}

/**
 * Plan signal enrichment for ONE candidate.
 *
 * Plans only when: identity verified, company fit sufficiently verified, timing
 * required by the user intent, timing missing/stale, and no hard contradiction.
 */
export function planSignalEnrichment(
  input: SignalPlanInput,
  budget: SignalEnrichmentBudget,
  ledger: SignalBudgetLedger,
  nowMs?: number,
): SignalEnrichmentPlan {
  const base = {
    candidateId: input.candidateId,
    companyRef: input.companyRef ?? null,
    personRef: input.personRef ?? null,
    targetCategories: input.timing.missing_categories.map(String),
  };
  const skip = (outcome: SignalPlanOutcome, reason: string): SignalEnrichmentPlan =>
    ({ ...base, outcome, reason, willCallProvider: false });

  // 1) The request never asked for timing.
  if (!input.requirement.required || input.timing.decision === "timing_not_required") {
    return skip("skip_not_required", "the request does not require timing evidence");
  }
  // 2) A hard gate already settled this candidate — never pay for a signal.
  if (input.hardBlocked === true || input.sufficiency.nextDecision === "reject_source") {
    return skip("skip_not_required", "a hard gate already rejected this candidate");
  }
  if (input.timing.decision === "timing_contradicted") {
    return skip("skip_not_required", "a verified contradiction is present");
  }
  // 3) Already proven — reuse rather than re-buy.
  if (input.timing.decision === "timing_sufficient") {
    return skip("skip_already_sufficient", "current verified timing evidence already exists");
  }
  // 4) Only enrich candidates whose identity and company fit are settled.
  if (!input.sufficiency.identityComplete) {
    return skip("skip_not_required", "identity is not verified; signal enrichment would be wasted");
  }
  if (!input.sufficiency.fitComplete) {
    return skip("skip_not_required", "company fit is not verified yet; enrich fit before timing");
  }
  // 5) Budget.
  if (budget.deadlineMs != null && nowMs != null && nowMs >= budget.deadlineMs) {
    return skip("stage_budget_exhausted", "the signal-enrichment deadline was reached");
  }
  if (ledger.candidatesPlanned >= budget.maxCandidates) {
    return skip("stage_budget_exhausted", "the candidate budget is exhausted");
  }
  if (ledger.lookupsPlanned >= budget.maxSignalLookups) {
    return skip("stage_budget_exhausted", "the signal-lookup budget is exhausted");
  }
  const cKey = input.companyRef ?? "";
  if (cKey && (ledger.perCompany.get(cKey) ?? 0) >= budget.maxLookupsPerCompany) {
    return skip("stage_budget_exhausted", "the per-company lookup budget is exhausted");
  }
  const pKey = input.personRef ?? "";
  if (pKey && (ledger.perPerson.get(pKey) ?? 0) >= budget.maxLookupsPerPerson) {
    return skip("stage_budget_exhausted", "the per-person lookup budget is exhausted");
  }
  // 6) No capable source is bound (Phase A is provider-free) — stage truthfully
  //    rather than fabricate a signal.
  if (!input.supportedSourceAvailable) {
    return skip("stage_no_supported_source", "no verified signal source is currently bound");
  }

  ledger.candidatesPlanned += 1;
  ledger.lookupsPlanned += 1;
  if (cKey) ledger.perCompany.set(cKey, (ledger.perCompany.get(cKey) ?? 0) + 1);
  if (pKey) ledger.perPerson.set(pKey, (ledger.perPerson.get(pKey) ?? 0) + 1);

  return { ...base, outcome: "plan_structured_signal_lookup", willCallProvider: true,
    reason: `timing evidence missing for: ${base.targetCategories.join(", ") || "any signal"}` };
}

// -------------------------------------------------------- deduplication -------

const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
const VERIF_RANK: Record<string, number> = { unverified: 0, self_reported: 1, provider_verified: 2 };

/**
 * Collapse signals describing the SAME real-world event, however many sources found
 * it (the same funding round on LinkedIn and the company website; the same role from
 * two job boards; an engagement imported twice).
 *
 * Merge policy — preserve the strongest true statement:
 *   - ALL supporting evidence references are kept (union, de-duplicated)
 *   - strongest verification wins
 *   - highest confidence wins
 *   - EARLIEST occurred_at wins (when the event actually happened)
 *   - LATEST observed_at wins (our most recent look)
 */
export function deduplicateSignals(
  signals: readonly SignalEvent[],
  windowHours = DEDUPE_WINDOW_HOURS,
): SignalEvent[] {
  // Group by ENTITY + TYPE first, then cluster by occurred_at PROXIMITY.
  //
  // Proximity, not a fixed epoch bucket: two sources reporting the same round 10h and
  // 14h ago can straddle a bucket boundary and wrongly split into two events. Sorting
  // and comparing against the cluster's earliest occurrence is boundary-free and still
  // deterministic, while two genuinely distinct events (a round a year apart) stay separate.
  const groups = new Map<string, SignalEvent[]>();
  for (const s of signals) {
    const g = groupKeyFor(s);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(s);
  }

  const out: SignalEvent[] = [];
  const windowMs = Math.max(1, windowHours) * 3600_000;
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    let cluster: SignalEvent | null = null;
    let clusterStart = 0;
    for (const s of sorted) {
      const t = Date.parse(s.occurred_at);
      if (cluster && isFinite(t) && isFinite(clusterStart) && (t - clusterStart) <= windowMs) {
        cluster = mergeInto(cluster, s);
        continue;
      }
      if (cluster) out.push(cluster);
      cluster = {
        ...s,
        evidence_refs: [...s.evidence_refs],
        dedupe_key: s.dedupe_key || buildSignalDedupeKey({
          workspace_id: s.workspace_id, signal_type: s.signal_type,
          person_ref: s.person_ref, company_ref: s.company_ref, occurred_at: s.occurred_at,
          dedupeWindowHours: windowHours,
        }),
      };
      clusterStart = t;
    }
    if (cluster) out.push(cluster);
  }
  return out;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Entity + type + optional event discriminator. Time is handled by clustering. */
function groupKeyFor(s: SignalEvent): string {
  const entity = s.company_ref ? `c:${norm(s.company_ref)}` : `p:${norm(s.person_ref)}`;
  const ident = norm((s.normalized_value as Record<string, unknown> | null)?.role ?? "");
  return `${norm(s.workspace_id)}|${s.signal_type}|${entity}|${ident}`;
}

/** Preserve the strongest TRUE statement across duplicate observations. */
function mergeInto(prev: SignalEvent, s: SignalEvent): SignalEvent {
  const merged: SignalEvent = { ...prev };
  merged.evidence_refs = mergeEvidenceRefs(prev.evidence_refs, s.evidence_refs);
  if (VERIF_RANK[s.verification] > VERIF_RANK[prev.verification]) merged.verification = s.verification;
  if (CONF_RANK[s.confidence] > CONF_RANK[prev.confidence]) merged.confidence = s.confidence;
  if (Date.parse(s.occurred_at) < Date.parse(prev.occurred_at)) merged.occurred_at = s.occurred_at;
  if (Date.parse(s.observed_at) > Date.parse(prev.observed_at)) merged.observed_at = s.observed_at;
  if (!merged.source_url && s.source_url) merged.source_url = s.source_url;
  return merged;
}

function mergeEvidenceRefs(a: SignalEvidenceRef[], b: SignalEvidenceRef[]): SignalEvidenceRef[] {
  const out: SignalEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const r of [...a, ...b]) {
    const k = `${r.category}|${r.sourceType}|${r.sourceUrl ?? ""}|${r.actorKey ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}
