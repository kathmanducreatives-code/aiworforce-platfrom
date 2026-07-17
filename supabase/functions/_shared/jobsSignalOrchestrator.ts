// Bounded jobs-signal enrichment orchestrator (Phase B) — pure control flow with
// DEPENDENCY-INJECTED execution. Never binds a provider itself: run-agent injects
// the canonical source_with_apify jobs path; tests inject fixtures.
//
// One lookup per DEDUPLICATED company; verified GTM-hiring SignalEvents fan out to
// every relevant founder at that company. Latency-bounded exactly like company
// enrichment (bounded concurrency + per-company timeout + run-level deadline +
// finalization reserve) so the combined people+company+signal runtime never starves
// qualification/finalization. Timing is judged by the canonical foundation
// (compileTimingRequirement / evaluateTimingSufficiency); this module adds no
// second timing-decision system, and timing_sufficient NEVER means qualify_now.

import {
  compileTimingRequirement, evaluateTimingSufficiency,
  type TimingRequirement, type TimingAssessment,
} from "./timingAssessment.ts";
import {
  planSignalEnrichment, deduplicateSignals,
  DEFAULT_SIGNAL_BUDGET, emptySignalLedger,
  type SignalEnrichmentBudget, type SignalBudgetLedger, type SignalEnrichmentPlan,
} from "./conditionalSignalPlanner.ts";
import {
  jobRecordToSignalEvent, JOBS_ACTOR_KEY, JOBS_ACTOR_ID, type NormalizedJobLike,
} from "./jobsSignalAdapter.ts";
import type { SignalEvent } from "./signalEvent.ts";
import { assessSignalStrength, strengthAtLeast } from "./signalFreshness.ts";
import { listingStatusIsDead } from "./timingFreshnessPolicy.ts";
import { mapWithConcurrency, REAL_CLOCK, type EnrichmentClock } from "./companyEnrichmentOrchestrator.ts";
import {
  buildSignalEnrichmentObservability,
  type SignalEnrichmentObservability, type SignalCompanyDiagnosticInput, type SignalCompanyOutcome,
} from "./signalEnrichmentObservability.ts";
import type { EvidenceContract } from "./evidenceContract.ts";
import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";

// ----------------------------------------------------- latency policy ---------
// Signals run AFTER people + company enrichment in one invocation, so the window
// is tighter. The run-agent deadline (shared) still guarantees the finalization
// reserve; these are the local defaults.
export const SIGNAL_ENRICHMENT_CONCURRENCY = 3;
export const SIGNAL_ACTOR_TIMEOUT_MS = 30_000;

// ------------------------------------------------- injected execution ---------

export interface SignalActorExecuteArgs {
  actorKey: string;
  actorId: string;
  companyKey: string;
  companyLinkedInUrl?: string | null;
  companyName?: string | null;
  maxItems: number;
  timeoutMs?: number;
  workflowRunId?: string;
  taskId?: string;
  workspaceId?: string;
}
export interface SignalActorExecuteResult {
  items?: NormalizedJobLike[];
  error?: unknown;
  timedOut?: boolean;
  providerRunId?: string;
}
export type SignalActorExecutor = (a: SignalActorExecuteArgs) => Promise<SignalActorExecuteResult>;

// --------------------------------------------------------- candidate ----------

/** A source-gate-accepted, company-fit-evaluated candidate ready for timing. */
export interface SignalCandidate {
  candidateId: string;
  /** Canonical company identity (LinkedIn URL / domain / name key). Null ⇒ ungroundable. */
  companyKey: string | null;
  companyLinkedInUrl?: string | null;
  companyName?: string | null;
  personRef?: string | null;
  /** Post-company-enrichment sufficiency (identity + fit settled?). */
  sufficiency: EvidenceSufficiencyResult;
  hardBlocked?: boolean;
  /** Signals already known (cache / prior) — reused, never re-bought. */
  existingSignals?: SignalEvent[];
}

export interface JobsSignalRunResult {
  requirement: TimingRequirement;
  /** Fanned-out signals per candidate (existing + newly enriched). */
  signalsByCandidate: Map<string, SignalEvent[]>;
  timingByCandidate: Map<string, TimingAssessment>;
  plansByCandidate: Map<string, SignalEnrichmentPlan>;
  requalifyCandidateIds: Set<string>;
  observability: SignalEnrichmentObservability;
  ledger: SignalBudgetLedger;
}

async function callWithTimeout(
  exec: () => Promise<SignalActorExecuteResult>, timeoutMs: number, clock: EnrichmentClock,
): Promise<SignalActorExecuteResult> {
  if (timeoutMs <= 0) return { timedOut: true };
  const ac = new AbortController();
  const timeout = clock.sleep(timeoutMs, ac.signal).then((): SignalActorExecuteResult =>
    ac.signal.aborted ? { timedOut: false } : { timedOut: true });
  const call = exec().then((v) => { ac.abort(); return v; }, (e): SignalActorExecuteResult => { ac.abort(); return { error: e }; });
  return await Promise.race([call, timeout]);
}

/**
 * Run bounded structured hiring-signal enrichment for the whole workflow ONCE.
 * PROVIDER-FREE by construction: every provider touch goes through `execute`.
 */
export async function runJobsSignalEnrichment(args: {
  candidates: SignalCandidate[];
  contract: EvidenceContract;
  workspace_id: string;
  now: string;
  execute?: SignalActorExecutor | null;
  budget?: SignalEnrichmentBudget;
  clock?: EnrichmentClock;
  concurrency?: number;
  companyTimeoutMs?: number;
  deadlineMs?: number | null;
  workflowRunId?: string;
  taskId?: string;
}): Promise<JobsSignalRunResult> {
  const clock = args.clock ?? REAL_CLOCK;
  const budget = args.budget ?? DEFAULT_SIGNAL_BUDGET;
  const ledger = emptySignalLedger();
  const concurrency = Math.max(1, args.concurrency ?? SIGNAL_ENRICHMENT_CONCURRENCY);
  const companyTimeoutMs = Math.max(0, args.companyTimeoutMs ?? SIGNAL_ACTOR_TIMEOUT_MS);
  const deadlineMs = args.deadlineMs ?? null;
  const callable = !!args.execute;

  const requirement = compileTimingRequirement(args.contract);
  const now = args.now;

  const signalsByCandidate = new Map<string, SignalEvent[]>();
  const timingByCandidate = new Map<string, TimingAssessment>();
  const plansByCandidate = new Map<string, SignalEnrichmentPlan>();
  const requalifyCandidateIds = new Set<string>();

  // Initial (pre-lookup) timing from any already-known signals.
  const initialTiming = new Map<string, TimingAssessment>();
  for (const c of args.candidates) {
    const t = evaluateTimingSufficiency({ candidateId: c.candidateId, requirement, signals: c.existingSignals ?? [], now });
    initialTiming.set(c.candidateId, t);
    signalsByCandidate.set(c.candidateId, [...(c.existingSignals ?? [])]);
    timingByCandidate.set(c.candidateId, t);
  }

  // Group candidates by canonical company. Ungroundable (no companyKey) candidates
  // are planned individually and can never trigger a lookup.
  const byCompany = new Map<string, SignalCandidate[]>();
  for (const c of args.candidates) {
    if (!c.companyKey) continue;
    (byCompany.get(c.companyKey) ?? byCompany.set(c.companyKey, []).get(c.companyKey)!).push(c);
  }

  // Plan ONE lookup per deduplicated company (representative = first eligible
  // candidate drives the shared budget decision). Candidates with no companyKey get
  // an individual skip/stage plan.
  const companiesToCall: { companyKey: string; rep: SignalCandidate; group: SignalCandidate[] }[] = [];
  for (const c of args.candidates) {
    if (c.companyKey) continue;
    plansByCandidate.set(c.candidateId, planSignalEnrichment(
      { candidateId: c.candidateId, companyRef: null, personRef: c.personRef ?? null, sufficiency: c.sufficiency,
        timing: initialTiming.get(c.candidateId)!, requirement, hardBlocked: c.hardBlocked, supportedSourceAvailable: false },
      budget, ledger, clock.now(),
    ));
  }
  for (const [companyKey, group] of byCompany) {
    const rep = group.find((c) => !c.hardBlocked && c.sufficiency.identityComplete && c.sufficiency.fitComplete
      && initialTiming.get(c.candidateId)!.decision === "missing_timing_evidence") ?? group[0];
    const plan = planSignalEnrichment(
      { candidateId: rep.candidateId, companyRef: companyKey, personRef: rep.personRef ?? null, sufficiency: rep.sufficiency,
        timing: initialTiming.get(rep.candidateId)!, requirement, hardBlocked: rep.hardBlocked,
        supportedSourceAvailable: callable },
      budget, ledger, clock.now(),
    );
    for (const c of group) plansByCandidate.set(c.candidateId, { ...plan, candidateId: c.candidateId, personRef: c.personRef ?? null });
    if (plan.outcome === "plan_structured_signal_lookup") companiesToCall.push({ companyKey, rep, group });
  }

  // Bounded execution — one call per company, per-company timeout, deadline skip.
  const diagnostics: SignalCompanyDiagnosticInput[] = [];
  const signalsByCompany = new Map<string, SignalEvent[]>();
  let rawJobRecords = 0, normalizedJobEvents = 0;

  const execResults = await mapWithConcurrency(companiesToCall, concurrency, async (target): Promise<void> => {
    const { companyKey, rep, group } = target;
    const ids = group.map((c) => c.candidateId);
    const diag = (outcome: SignalCompanyOutcome, extra: Partial<SignalCompanyDiagnosticInput> = {}): void => {
      diagnostics.push({ companyKey, associatedCandidateIds: ids, actorKey: JOBS_ACTOR_KEY, actorId: JOBS_ACTOR_ID, outcome, ...extra });
    };
    if (deadlineMs != null && clock.now() >= deadlineMs) { diag("skipped_due_deadline", { failureReason: "run_deadline_reached" }); return; }
    const remaining = deadlineMs != null ? deadlineMs - clock.now() : companyTimeoutMs;
    const timeoutMs = Math.max(0, Math.min(companyTimeoutMs, remaining));
    const res = await callWithTimeout(() => args.execute!({
      actorKey: JOBS_ACTOR_KEY, actorId: JOBS_ACTOR_ID, companyKey,
      companyLinkedInUrl: rep.companyLinkedInUrl ?? null, companyName: rep.companyName ?? null,
      maxItems: 10, timeoutMs, workflowRunId: args.workflowRunId, taskId: args.taskId, workspaceId: args.workspace_id,
    }), timeoutMs, clock);

    if (res.timedOut) { diag("timeout", { failureReason: "actor_timeout" }); return; }
    if (res.error) { diag("failed", { failureReason: "provider_error" }); return; }
    const records = Array.isArray(res.items) ? res.items : [];
    rawJobRecords += records.length;
    const signals: SignalEvent[] = [];
    for (const rec of records) {
      const r = jobRecordToSignalEvent({ job: rec, workspace_id: args.workspace_id, company_ref: companyKey, observedAt: now,
        provider: "apify", actorKey: JOBS_ACTOR_KEY, actorId: JOBS_ACTOR_ID });
      if (r.signal) signals.push(r.signal);
    }
    normalizedJobEvents += signals.length;
    if (!signals.length) { diag("no_result", { rawRecords: records.length, verifiedSignals: 0 }); return; }
    const deduped = deduplicateSignals(signals);
    signalsByCompany.set(companyKey, deduped);
    diag("enriched", { rawRecords: records.length, verifiedSignals: deduped.length });
  });
  void execResults;

  // Fan verified signals out to every founder at the company; re-evaluate timing.
  let verifiedSignalEvents = 0, dedupedSignalEvents = 0;
  const allDeduped: SignalEvent[] = [];
  for (const [, sigs] of signalsByCompany) { dedupedSignalEvents += sigs.length; allDeduped.push(...sigs); }
  verifiedSignalEvents = dedupedSignalEvents;

  for (const c of args.candidates) {
    if (!c.companyKey) continue;
    const fanned = signalsByCompany.get(c.companyKey) ?? [];
    if (!fanned.length) continue;
    const merged = [...(signalsByCandidate.get(c.candidateId) ?? []), ...fanned];
    signalsByCandidate.set(c.candidateId, merged);
    const t = evaluateTimingSufficiency({ candidateId: c.candidateId, requirement, signals: merged, now });
    timingByCandidate.set(c.candidateId, t);
    requalifyCandidateIds.add(c.candidateId);
  }

  // Signal band + listing accounting over the unique deduped signal set.
  let fresh = 0, weak = 0, stale = 0, deadListings = 0;
  for (const s of allDeduped) {
    if (listingStatusIsDead(s.listing_status)) deadListings++;
    const r = assessSignalStrength(s, now);
    if (!r.fresh) stale++;
    else if (strengthAtLeast(r.strength, "moderate")) fresh++;
    else if (r.strength === "weak") weak++;
    else stale++;
  }

  let timingSufficient = 0, missingTiming = 0, timingContradicted = 0;
  for (const t of timingByCandidate.values()) {
    if (t.decision === "timing_sufficient") timingSufficient++;
    else if (t.decision === "timing_contradicted") timingContradicted++;
    else if (t.decision === "missing_timing_evidence") missingTiming++;
  }

  const stopReason = !requirement.required ? "timing_not_required"
    : diagnostics.some((d) => d.outcome === "skipped_due_deadline") ? "deadline_reached"
    : ledger.lookupsPlanned >= budget.maxSignalLookups ? "budget_exhausted"
    : "completed";

  const observability = buildSignalEnrichmentObservability({
    candidatesConsidered: args.candidates.length,
    companiesDeduplicated: byCompany.size,
    companies: diagnostics,
    rawJobRecords, normalizedJobEvents,
    verifiedSignalEvents, deduplicatedSignalEvents: dedupedSignalEvents,
    signalsFresh: fresh, signalsWeakSupporting: weak, signalsStale: stale,
    closedOrExpiredListings: deadListings,
    candidatesTimingSufficient: timingSufficient,
    candidatesMissingTimingEvidence: missingTiming,
    candidatesTimingContradicted: timingContradicted,
    candidatesRequalified: requalifyCandidateIds.size,
    budgetLookupsLimit: budget.maxSignalLookups,
    budgetLookupsUsed: ledger.lookupsPlanned,
    stopReason,
  });

  return { requirement, signalsByCandidate, timingByCandidate, plansByCandidate, requalifyCandidateIds, observability, ledger };
}
