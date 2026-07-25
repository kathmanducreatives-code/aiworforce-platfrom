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
import { keywordQueriesForRound } from "./jobSearchSpec.ts";
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
}

export interface QuotaControllerOpts {
  requestedLeadCount: number;
  quotaPolicy?: QuotaPolicy;
  bounds?: Partial<QuotaControllerBounds>;
  limits?: Partial<CompoundLimits>;
  vertical?: Vertical;
  now?: string;
  workspaceId?: string;
  log?: (msg: string, meta?: unknown) => void;
}

export async function runCompanyFirstQuotaController(
  intent: LeadEntityIntent,
  deps: CompoundExecutionDeps,
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

    const { keywords, expansion } = keywordQueriesForRound(intent.job_search_spec, round);
    if (round > 1 && !expansions.includes(expansion) && expansion === "additional_coverage" && rounds.length && rounds[rounds.length - 1].new_unique_jobs === 0) {
      terminal = "search_exhausted"; terminalReason = "no further approved expansion produced new jobs"; break;
    }
    if (!expansions.includes(expansion)) expansions.push(expansion);

    // Round 3+ widens COVERAGE on the same validated keywords.
    const roundLimits: Partial<CompoundLimits> = round >= 3
      ? { ...opts.limits, verifiedCompanies: (opts.limits?.verifiedCompanies ?? 10) + 5, founderLookups: (opts.limits?.founderLookups ?? 8) + 4 }
      : (opts.limits ?? {});

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
      ...opts, limits: roundLimits, keywordQueriesOverride: keywords,
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
    };
  }
}
