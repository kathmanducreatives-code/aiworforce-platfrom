// COMPANY-FIRST QUOTA CONTROLLER — the multi-round loop the audit found missing.
//
// v96 ran exactly one sourcing batch, counted successful DB writes, and reported
// `completed` with 0 CONTACT. The adaptive machinery (sourcingRetry.ts) existed but
// sat behind the company-first early return and was unreachable.
//
// This controller owns:
//   • remaining quota (eligible CONTACT leads, never raw rows or DB writes)
//   • bounded broadening between rounds (search space only, never gates)
//   • cross-round deduplication
//   • budget / call / round bounds
//   • honest terminal status
//
// A round never marks the task complete; only this controller does.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { runAgentCompoundExecution, type CompoundExecutionDeps } from "./runAgentCompoundExecution.ts";
import type { CompoundCandidate, CompoundLimits } from "./compoundSourcingPipeline.ts";
import { buildCompoundPersistencePlan, type CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { buildSourcingConstraints, type SourcingConstraints } from "./sourcingConstraints.ts";
import {
  buildInitialPlan, deterministicRoundPlan, sanitizePlannerInput,
  type BroadeningPlan, type BroadeningPlannerFn, type PlanSource, type RoundPlan,
} from "./broadeningPlan.ts";
import { validateRoundPlan, scanProposalForInjection } from "./broadeningValidator.ts";
import { classifyBottleneck, emptyFunnelSummary, remedyFor, type BottleneckKind, type FunnelSummary } from "./sourcingBottleneck.ts";
import { forecastRoundCost, roundIdempotencyKey, newIdempotencyLedger, DEFAULT_COST_POLICY, type CostForecast } from "./sourcingCostForecast.ts";
import { shortHash } from "./planHash.ts";
import { stampIdempotencyKey, lookupDurableCall, type ToolCallReader, type DurableLookupKind } from "./durableIdempotency.ts";
import type { PlannerMetadata } from "./broadeningPlannerAdapter.ts";
import {
  countEligible, isQuotaEligibleCandidate, leadIdentityKey, remainingLeadCount,
  DEFAULT_QUOTA_POLICY, type QuotaPolicy,
} from "./leadQuotaPolicy.ts";
import { newWriteBoundary, type CompanyFirstWriteBoundary } from "./providerEvidenceMode.ts";
import type { Vertical } from "./verticalQualification.ts";

export type CompanyFirstTerminalStatus =
  | "completed" | "quota_not_met" | "search_exhausted" | "budget_exhausted"
  | "round_limit_reached" | "provider_failure" | "invalid_request";

export interface RoundRecord {
  round_number: number;
  requested_total: number;
  eligible_before_round: number;
  remaining_before_round: number;
  search_strategy: string;
  search_expansions: string[];
  provider_calls: number;
  raw_rows: number;
  new_unique_jobs: number;
  new_unique_companies: number;
  new_people: number;
  new_eligible_leads: number;
  rejections: number;
  duplicates_removed: number;
  budget_consumed: number;
  remaining_after_round: number;
  terminal_reason: string | null;
}

export interface QuotaControllerBounds {
  maxRounds: number;
  maxJobsCalls: number;
  maxPeopleCalls: number;
  /** Soft/hard spend guards, in the same unit the caller accounts in. */
  softBudget: number;
  hardBudget: number;
  /** Estimated cost charged per provider call for accounting. */
  costPerJobsCall: number;
  costPerPeopleCall: number;
}

export const DEFAULT_QUOTA_BOUNDS: QuotaControllerBounds = {
  maxRounds: 3, maxJobsCalls: 3, maxPeopleCalls: 24,
  softBudget: 4.5, hardBudget: 5.0, costPerJobsCall: 0.25, costPerPeopleCall: 0.12,
};

export interface QuotaControllerResult {
  terminal_status: CompanyFirstTerminalStatus;
  terminal_reason: string;
  requested_leads: number;
  eligible_leads: number;
  remaining_leads: number;
  rounds_attempted: number;
  expansions_attempted: string[];
  raw_jobs_processed: number;
  verified_companies: number;
  people_candidates: number;
  provider_calls: number;
  provider_side_writes: number;
  budget_consumed: number;
  rounds: RoundRecord[];
  /** Deduplicated candidates across every round. */
  candidates: CompoundCandidate[];
  /** Plans actually persisted (REJECT/SKIP excluded by policy). */
  persisted: Array<{ ok: boolean; accountId: string | null; leadCandidateId: string | null; reason?: string }>;
  writeBoundary: CompanyFirstWriteBoundary;
  /** Generalized broadening observability. */
  plan: BroadeningPlan | null;
  plan_sources: PlanSource[];
  bottlenecks: Array<{ round: number; kind: BottleneckKind; reason: string; remedy: string }>;
  cost_forecasts: CostForecast[];
  plan_validations: Array<{ round: number; approved: string[]; rejected: Array<{ title: string; reason: string }>; violations: string[] }>;
  /** Per-round planner provenance (no chain-of-thought, no secrets). */
  planner_metadata: Array<PlannerMetadata & { round: number }>;
  /** Per-round durable-idempotency decision. */
  idempotency: Array<{ round: number; key: string; kind: DurableLookupKind; reason: string }>;
}

export interface QuotaControllerOpts {
  requestedLeadCount: number;
  quotaPolicy?: QuotaPolicy;
  bounds?: Partial<QuotaControllerBounds>;
  limits?: Partial<CompoundLimits>;
  vertical?: Vertical;
  now?: string;
  workspaceId?: string;
  taskId?: string | null;
  log?: (msg: string, meta?: unknown) => void;
}

export interface QuotaControllerDeps extends CompoundExecutionDeps {
  /** INJECTED planner. Never called by this module in tests or offline runs. */
  proposeBroadening?: BroadeningPlannerFn;
  /** Safe provenance for the most recent planner call. */
  plannerMetadata?: () => PlannerMetadata | null;
  /** Restart-safe paid-call ledger backed by tool_calls (no migration). */
  durableIdempotency?: ToolCallReader;
}

export async function runCompanyFirstQuotaController(
  intent: LeadEntityIntent,
  deps: QuotaControllerDeps,
  opts: QuotaControllerOpts,
): Promise<QuotaControllerResult> {
  const bounds = { ...DEFAULT_QUOTA_BOUNDS, ...opts.bounds };
  const policy = opts.quotaPolicy ?? DEFAULT_QUOTA_POLICY;
  const requested = opts.requestedLeadCount;
  const log = opts.log ?? (() => {});

  const rounds: RoundRecord[] = [];
  const expansions: string[] = [];
  const dedupedCandidates: CompoundCandidate[] = [];
  const seenLeadKeys = new Set<string>();
  const seenCompanyKeys = new Set<string>();
  const seenJobUrls = new Set<string>();
  const writeBoundary = newWriteBoundary();
  const persisted: QuotaControllerResult["persisted"] = [];

  const constraints: SourcingConstraints = await buildSourcingConstraints(intent, {
    maxRawJobs: opts.limits?.rawJobs, maxCompanies: opts.limits?.verifiedCompanies,
    maxPeopleLookups: opts.limits?.founderLookups, peoplePerCompany: opts.limits?.foundersPerCompany,
  });
  const plan = await buildInitialPlan(constraints, intent.job_search_spec.original_query.slice(0, 120));
  const attemptedStrategies: string[] = [];
  const planSources: PlanSource[] = [];
  const bottlenecks: QuotaControllerResult["bottlenecks"] = [];
  const forecasts: CostForecast[] = [];
  const planValidations: QuotaControllerResult["plan_validations"] = [];
  const plannerMetadata: QuotaControllerResult["planner_metadata"] = [];
  const idempotency: QuotaControllerResult["idempotency"] = [];
  const ledger = newIdempotencyLedger();
  let lastFunnel: FunnelSummary | null = null;
  let lastBottleneck: BottleneckKind | null = null;

  let jobsCalls = 0, peopleCalls = 0, budget = 0;
  let rawJobs = 0, verifiedCompanies = 0, peopleCandidates = 0;
  let terminal: CompanyFirstTerminalStatus | null = null;
  let terminalReason = "";

  if (!Number.isInteger(requested) || requested < 1) {
    return finish("invalid_request", `requested_lead_count must be a positive integer (got ${requested})`);
  }

  for (let round = 1; round <= bounds.maxRounds; round++) {
    const eligibleBefore = countEligible(dedupedCandidates, policy);
    const remainingBefore = remainingLeadCount(requested, eligibleBefore);
    if (remainingBefore === 0) { terminal = "completed"; terminalReason = "quota reached"; break; }
    if (jobsCalls >= bounds.maxJobsCalls) { terminal = "search_exhausted"; terminalReason = "jobs-actor call budget reached"; break; }
    if (budget + bounds.costPerJobsCall > bounds.hardBudget) { terminal = "budget_exhausted"; terminalReason = "next round would exceed the hard budget"; break; }

    // ---- PLAN → VALIDATE → FORECAST, all before any provider call ---------
    let roundPlan: RoundPlan | null = null;
    let planSource: PlanSource = "deterministic_only";

    if (round > 1 && deps.proposeBroadening) {
      // The planner sees ONLY typed summaries — never raw provider text.
      const input = sanitizePlannerInput(constraints, { requested, eligible: eligibleBefore, remaining: remainingBefore }, lastFunnel, lastBottleneck, attemptedStrategies, Math.max(0, bounds.hardBudget - budget));
      try {
        const proposal = await deps.proposeBroadening(input);
        if (!proposal) { planSource = "ai_unavailable_fallback_used"; }
        else if (scanProposalForInjection(proposal)) { planSource = "ai_rejected_fallback_used"; }
        else {
          const candidateRound: RoundPlan = {
            ...(deterministicRoundPlan(constraints, round, lastBottleneck) ?? { round_number: round, goal: "ai", title_queries: [], posting_window_days: null, raw_job_limit: constraints.soft.maxRawJobs, company_selection_limit: constraints.soft.maxCompanies, people_lookup_limit: constraints.soft.maxPeopleLookups, people_per_company: constraints.soft.peoplePerCompany, approved_actor_keys: [...constraints.soft.approvedActorKeys], proposed_changes: [], risk: "low", rationale: "", expected_bottleneck_impact: "unknown" }),
            title_queries: proposal.title_queries ?? [],
            goal: proposal.goal ?? "ai-proposed titles",
            rationale: proposal.rationale ?? "ai proposal",
          };
          const v = await validateRoundPlan(candidateRound, constraints, constraints.hard, attemptedStrategies);
          planValidations.push({ round, approved: v.approvedTitles, rejected: v.rejectedTitles, violations: v.violations });
          if (v.ok) { roundPlan = { ...candidateRound, title_queries: v.approvedTitles }; planSource = "ai_approved"; }
          else { planSource = "ai_rejected_fallback_used"; }
        }
      } catch { planSource = "ai_unavailable_fallback_used"; }
      const pm = deps.plannerMetadata?.();
      if (pm) plannerMetadata.push({ ...pm, round, status: planSource as PlannerMetadata["status"] });
    }

    // Deterministic fallback whenever the AI path did not yield an approved round.
    if (!roundPlan) roundPlan = deterministicRoundPlan(constraints, round, lastBottleneck);
    if (!roundPlan) { terminal = "search_exhausted"; terminalReason = "no approved expansion remains for this job family"; break; }

    roundPlan.strategy_hash = await shortHash({ titles: roundPlan.title_queries.slice().sort(), round });
    if (attemptedStrategies.includes(roundPlan.strategy_hash)) {
      terminal = "search_exhausted"; terminalReason = "the only remaining strategy was already attempted"; break;
    }

    // Cost is forecast and approved BEFORE the provider is touched.
    const forecast: CostForecast = forecastRoundCost(roundPlan, budget, { ...DEFAULT_COST_POLICY, softBudget: bounds.softBudget, hardBudget: bounds.hardBudget, costPerJobsCall: bounds.costPerJobsCall, costPerPeopleCall: bounds.costPerPeopleCall });
    forecasts.push(forecast);
    if (!forecast.approved) { terminal = "budget_exhausted"; terminalReason = `round refused before execution: ${forecast.refusal_reason}`; break; }

    // Idempotency: the same paid round is never charged twice on a retry.
    const idemKey = roundIdempotencyKey({ taskId: opts.taskId ?? null, workspaceId: opts.workspaceId ?? "", round, strategyHash: roundPlan.strategy_hash, actorKey: "apify_jobs" });
    if (!ledger.claim(idemKey)) { terminal = "search_exhausted"; terminalReason = "identical paid round already executed (in-process)"; break; }
    // RESTART-SAFE: an identical completed paid call in tool_calls is never repeated.
    if (deps.durableIdempotency) {
      const dur = await lookupDurableCall(deps.durableIdempotency, { workspaceId: opts.workspaceId ?? "", key: idemKey, now: opts.now });
      idempotency.push({ round, key: idemKey, kind: dur.kind, reason: dur.reason });
      if (dur.kind === "cached") {
        // The prior result already counted toward this run; do not re-charge and
        // do not count it twice.
        terminal = "search_exhausted";
        terminalReason = "an identical paid round already completed and was reused";
        break;
      }
    } else {
      idempotency.push({ round, key: idemKey, kind: "new", reason: "in-process ledger only" });
    }
    // The key travels with the envelope so tool_calls.input_json records it.
    const idempotencyStamp = idemKey;

    attemptedStrategies.push(roundPlan.strategy_hash);
    planSources.push(planSource);
    const keywords = roundPlan.title_queries;
    const expansion = roundPlan.goal;
    if (!expansions.includes(expansion)) expansions.push(expansion);
    const roundLimits: Partial<CompoundLimits> = {
      ...opts.limits,
      rawJobs: roundPlan.raw_job_limit,
      verifiedCompanies: roundPlan.company_selection_limit,
      founderLookups: roundPlan.people_lookup_limit,
      foundersPerCompany: roundPlan.people_per_company,
    };

    let roundJobsCalls = 0, roundPeopleCalls = 0;
    const exec = await runAgentCompoundExecution(intent, {
      ...deps,
      invokeJobs: async (env, max) => { roundJobsCalls++; return deps.invokeJobs(env, max); },
      invokePeople: async (env, max) => { roundPeopleCalls++; return deps.invokePeople(env, max); },
      budgetProceed: () => {
        const spent = budget + roundJobsCalls * bounds.costPerJobsCall + roundPeopleCalls * bounds.costPerPeopleCall;
        // The HARD cap binds inside a round too — otherwise per-company people
        // calls could blow past it before the next round's check ran.
        const ceiling = Math.min(bounds.softBudget, bounds.hardBudget);
        return spent + bounds.costPerPeopleCall <= ceiling && (peopleCalls + roundPeopleCalls) < bounds.maxPeopleCalls;
      },
    }, {
      ...opts, limits: roundLimits, keywordQueriesOverride: keywords, idempotencyKey: idempotencyStamp,
      persistCandidates: false,          // the controller owns persistence
    });

    jobsCalls += roundJobsCalls; peopleCalls += roundPeopleCalls;
    budget += roundJobsCalls * bounds.costPerJobsCall + roundPeopleCalls * bounds.costPerPeopleCall;
    writeBoundary.providerSideWrites += exec.writeBoundary.providerSideWrites;
    if (exec.writeBoundary.invariantViolation) writeBoundary.invariantViolation = exec.writeBoundary.invariantViolation;

    // ---- cross-round deduplication -----------------------------------------
    let dupes = 0, newJobs = 0, newCompanies = 0;
    for (const url of exec.run?.candidates.map((c) => c.jobEvidence.url) ?? []) {
      if (url && !seenJobUrls.has(url)) { seenJobUrls.add(url); newJobs++; }
    }
    const roundCandidates = exec.run?.candidates ?? [];
    for (const c of roundCandidates) {
      const key = leadIdentityKey(c);
      if (seenLeadKeys.has(key)) { dupes++; continue; }
      seenLeadKeys.add(key);
      const ck = c.account.dedupeKey ?? c.account.normalizedName ?? "";
      if (ck && !seenCompanyKeys.has(ck)) { seenCompanyKeys.add(ck); newCompanies++; }
      dedupedCandidates.push(c);
    }

    rawJobs += exec.run?.diagnostics.rawJobs ?? 0;
    verifiedCompanies += exec.run?.diagnostics.verifiedCompanies ?? 0;
    peopleCandidates += roundCandidates.length;
    writeBoundary.rawProviderItems += exec.writeBoundary.rawProviderItems;
    writeBoundary.normalizedJobs += exec.writeBoundary.normalizedJobs;
    writeBoundary.peopleResults += exec.writeBoundary.peopleResults;

    const eligibleAfter = countEligible(dedupedCandidates, policy);
    const newEligible = eligibleAfter - eligibleBefore;

    rounds.push({
      round_number: round, requested_total: requested,
      eligible_before_round: eligibleBefore, remaining_before_round: remainingBefore,
      search_strategy: keywords.join(" | "), search_expansions: [expansion],
      provider_calls: roundJobsCalls + roundPeopleCalls, raw_rows: exec.writeBoundary.rawProviderItems,
      new_unique_jobs: newJobs, new_unique_companies: newCompanies,
      new_people: roundCandidates.length, new_eligible_leads: newEligible,
      rejections: roundCandidates.filter((c) => !isQuotaEligibleCandidate(c, policy)).length,
      duplicates_removed: dupes, budget_consumed: budget,
      remaining_after_round: remainingLeadCount(requested, eligibleAfter),
      terminal_reason: null,
    });

    // ---- MEASURED funnel → deterministic bottleneck → next round's goal ----
    const funnel: FunnelSummary = {
      ...emptyFunnelSummary(),
      raw_jobs: exec.writeBoundary.rawProviderItems,
      unique_jobs: newJobs,
      job_family_pass: exec.run?.diagnostics.verifiedCompanies ? roundCandidates.length : 0,
      job_family_fail: Math.max(0, exec.writeBoundary.normalizedJobs - (exec.run?.diagnostics.verifiedCompanies ?? 0)),
      companies_qualified: exec.run?.diagnostics.verifiedCompanies ?? 0,
      companies_rejected: Math.max(0, exec.writeBoundary.normalizedJobs - (exec.run?.diagnostics.verifiedCompanies ?? 0)),
      companies_missing_identity: roundCandidates.filter((c) => !c.account.dedupeKey).length,
      people_calls: roundPeopleCalls,
      profiles_returned: exec.writeBoundary.peopleResults,
      person_role_pass: roundCandidates.filter((c) => c.gates.person_role === "pass").length,
      employer_verified: roundCandidates.filter((c) => c.employer.outcome === "verified_match").length,
      employer_ambiguous: roundCandidates.filter((c) => c.employer.outcome === "ambiguous" || c.employer.outcome === "insufficient_evidence").length,
      contact: roundCandidates.filter((c) => c.verdict === "CONTACT").length,
      watch: roundCandidates.filter((c) => c.verdict === "WATCH").length,
      reject: roundCandidates.filter((c) => c.verdict === "REJECT").length,
      duplicates_removed: dupes,
      rejection_reason_counts: roundCandidates.reduce((acc: Record<string, number>, c) => {
        for (const [g, v] of Object.entries(c.gates)) if (v === "fail") acc[g] = (acc[g] ?? 0) + 1;
        return acc;
      }, {}),
    };
    lastFunnel = funnel;
    const expansionAvailable = deterministicRoundPlan(constraints, round + 1, null) !== null;
    const bn = classifyBottleneck(funnel, {
      remainingQuota: remainingLeadCount(requested, eligibleAfter),
      budgetRemaining: Math.max(0, bounds.hardBudget - budget),
      expansionAvailable,
    });
    lastBottleneck = bn.kind;
    bottlenecks.push({ round, kind: bn.kind, reason: bn.reason, remedy: remedyFor(bn.kind) });

    log("company-first round finished", { round, eligibleAfter, remaining: remainingLeadCount(requested, eligibleAfter) });

    if (exec.status === "unable_to_compile_job_search") { terminal = "invalid_request"; terminalReason = exec.error ?? "job search could not be compiled"; break; }
    if (exec.status === "sourcing_failed") { terminal = "provider_failure"; terminalReason = exec.error ?? "jobs actor failed"; break; }
    if (remainingLeadCount(requested, eligibleAfter) === 0) { terminal = "completed"; terminalReason = "requested lead quota met"; break; }
  }

  if (!terminal) {
    terminal = rounds.length >= bounds.maxRounds ? "round_limit_reached" : "quota_not_met";
    terminalReason = terminal === "round_limit_reached"
      ? `maximum of ${bounds.maxRounds} sourcing rounds reached before the quota was met`
      : "sourcing ended without meeting the requested quota";
  }

  // ---- persistence: eligible/reviewable only, once, after all rounds --------
  for (const c of dedupedCandidates) {
    const plan: CompoundPersistencePlan = buildCompoundPersistencePlan(c, opts.workspaceId ?? "");
    if (!plan.persistable) {
      persisted.push({ ok: false, accountId: null, leadCandidateId: null, reason: plan.persistenceReason });
      continue;
    }
    writeBoundary.persistenceAttempts += 1;
    const r = await deps.persist(plan);
    if (r.ok) writeBoundary.persistedRecords += 1;
    persisted.push({ ok: r.ok, accountId: r.accountId, leadCandidateId: r.leadCandidateId, reason: r.reason });
  }

  return finish(terminal, terminalReason);

  function finish(status: CompanyFirstTerminalStatus, reason: string): QuotaControllerResult {
    const eligible = countEligible(dedupedCandidates, policy);
    return {
      terminal_status: status, terminal_reason: reason,
      requested_leads: requested, eligible_leads: eligible,
      remaining_leads: remainingLeadCount(requested, eligible),
      rounds_attempted: rounds.length, expansions_attempted: expansions,
      raw_jobs_processed: rawJobs, verified_companies: verifiedCompanies,
      people_candidates: peopleCandidates,
      provider_calls: jobsCalls + peopleCalls,
      provider_side_writes: writeBoundary.providerSideWrites,
      budget_consumed: Number(budget.toFixed(4)),
      rounds, candidates: dedupedCandidates, persisted, writeBoundary,
      plan, plan_sources: planSources, bottlenecks, cost_forecasts: forecasts, plan_validations: planValidations,
      planner_metadata: plannerMetadata, idempotency,
    };
  }
}
