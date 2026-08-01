// Runtime entry helper: adapts run-agent's real context to the company-first
// QUOTA CONTROLLER. Dependency-injected so the whole path is unit-testable with
// mocked runTool / persistence / clock, and so run-agent's handler stays thin.
//
// Completion is decided by ELIGIBLE LEADS DELIVERED — never by successful database
// writes. v96 reported `completed` with 0 CONTACT because it counted persistence
// results; that inversion is fixed here.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import {
  runCompanyFirstQuotaController,
  type CompanyFirstTerminalStatus, type QuotaControllerBounds, type QuotaControllerDeps, type RoundRecord,
} from "./companyFirstQuotaController.ts";
import type { BroadeningPlannerFn } from "./broadeningPlan.ts";
import type { PlannerMetadata } from "./broadeningPlannerAdapter.ts";
import type { ToolCallReader } from "./durableIdempotency.ts";
import type { SourcingStateStore } from "./companyFirstSourcingState.ts";
import type { ExecutionBudget } from "./executionDeadline.ts";
import type { CompoundExecutionDeps } from "./runAgentCompoundExecution.ts";
import type { CompoundLimits } from "./compoundSourcingPipeline.ts";
import type { ControllerClassificationCounters } from "./semanticClassificationBinding.ts";
import type { Vertical } from "./verticalQualification.ts";
import { isQuotaEligibleCandidate, leadIdentityKey, type QuotaPolicy, type RequestedCountSource } from "./leadQuotaPolicy.ts";
import type { CompanyFirstWriteBoundary } from "./providerEvidenceMode.ts";

export type CompanyFirstStatus = CompanyFirstTerminalStatus;

import type { CompanyBrainHardConstraints } from "./companyIcpFilter.ts";

export interface CompanyFirstRuntimeDeps extends CompoundExecutionDeps {
  /**
   * Company Brain HARD constraints for this workspace. When present every
   * company must clear them before it may reach people search. Absent means
   * not enforced, which is the pre-existing behavior.
   */
  brainConstraints?: CompanyBrainHardConstraints | null;
  brainPolicyHash?: string | null;
  intent: LeadEntityIntent;
  workspaceId: string;
  planId?: string | null;
  taskId?: string | null;
  /** FINAL-LEAD quota — independent of the raw provider batch size. */
  requestedLeadCount: number;
  requestedCountSource?: RequestedCountSource;
  quotaPolicy?: QuotaPolicy;
  bounds?: Partial<QuotaControllerBounds>;
  limits?: Partial<CompoundLimits>;
  vertical?: Vertical;
  now?: string;
  /** REAL AI planner (aiProvider-backed) injected by run-agent. */
  proposeBroadening?: BroadeningPlannerFn;
  plannerMetadata?: () => PlannerMetadata | null;
  /** Restart-safe paid-call ledger over tool_calls. */
  durableIdempotency?: ToolCallReader;
  /** Checkpoint store over tasks.result (no migration). */
  stateStore?: SourcingStateStore;
  /**
   * Observer for each completed round. Forwarded verbatim to the controller —
   * this wrapper adapts run-agent's context, it does not interpret rounds.
   */
  onRoundComplete?: QuotaControllerDeps["onRoundComplete"];
  /**
   * PLAN-AWARE ACTION BUDGET. Forwarded verbatim to the controller — this
   * wrapper adapts run-agent's context, it does not decide budgets. Omitted ⇒
   * the controller's pre-existing fixed limits apply unchanged.
   */
  actionBudget?: QuotaControllerDeps["actionBudget"];
  /**
   * SEMANTIC CLASSIFICATION, forwarded to the sourcing pipeline.
   *
   * Absent ⇒ no classification and no model call, exactly as before. This
   * wrapper adapts context; it never decides whether classification runs.
   */
  classifyCompanyEvidence?: (payload: Record<string, unknown>) => Promise<unknown>;
  classificationCallsRemaining?: number;
  /** Read-only ordered-source oracle. Threaded straight to the controller. */
  pendingDiscoverySource?: QuotaControllerDeps["pendingDiscoverySource"];
  executionBudget?: Partial<ExecutionBudget>;
  clock?: () => number;
  log?: (msg: string, meta?: unknown) => void;
}

export interface CompanyFirstResult {
  status: CompanyFirstStatus;
  terminal_reason: string;
  executed_sourcing_mode: "company_first";
  /** Quota contract — what was asked for versus what was actually delivered. */
  quota: {
    requested_leads: number;
    eligible_leads: number;
    remaining_leads: number;
    requested_count_source: RequestedCountSource;
    quota_policy: QuotaPolicy;
  };
  counts: {
    rawJobs: number; verifiedCompanies: number; candidates: number;
    contact: number; watch: number; needsReview: number; reject: number; persisted: number;
  };
  /** Safe classification counters; null when the feature never ran. */
  semantic_classification?: ControllerClassificationCounters | null;
  rounds_attempted: number;
  expansions_attempted: string[];
  rounds: RoundRecord[];
  provider_calls: number;
  budget_consumed: number;
  items: Array<{
    company: string | null; person: string | null; personProfileUrl: string | null;
    verdict: string; quotaEligible: boolean; accountId: string | null; leadCandidateId: string | null;
    jobUrl: string | null; whyNow: string | null; employerMatch: string; failedGates: string[];
    persisted: boolean; persistenceReason: string | null; leadKey: string;
  }>;
  routing: {
    execution_mode: "company_first"; company_first: true; requested_person_role: string | null;
    job_search_spec: { keyword_queries: string[]; location: string | null; company_vertical: string | null; compilation_status: string };
    original_user_query: string;
  };
  diagnostics: { jobsInvoked: boolean; peopleCalls: number; budgetStopped: boolean };
  writeBoundary: CompanyFirstWriteBoundary;
  /** Which strategy each round actually used, and where it came from. */
  plan_sources: string[];
  planner_metadata: Array<PlannerMetadata & { round: number }>;
  idempotency: Array<{ round: number; key: string; kind: string; reason: string }>;
  bottlenecks: Array<{ round: number; kind: string; reason: string; remedy: string }>;
  /** Resume contract when the safe time boundary stopped the run. */
  continuation: { required: boolean; next_action: string; next_round: number | null; checkpoint_at: string | null; continuation_token: string | null; resumed_from_round: number };
  error?: string;
}

export async function executeRunAgentCompanyFirstSourcing(deps: CompanyFirstRuntimeDeps): Promise<CompanyFirstResult> {
  const log = deps.log ?? (() => {});
  const res = await runCompanyFirstQuotaController(deps.intent, {
    invokeJobs: deps.invokeJobs, invokePeople: deps.invokePeople, persist: deps.persist, budgetProceed: deps.budgetProceed,
    proposeBroadening: deps.proposeBroadening, plannerMetadata: deps.plannerMetadata,
    durableIdempotency: deps.durableIdempotency, stateStore: deps.stateStore,
    onRoundComplete: deps.onRoundComplete,
    actionBudget: deps.actionBudget,
    pendingDiscoverySource: deps.pendingDiscoverySource,
  }, {
    requestedLeadCount: deps.requestedLeadCount,
    quotaPolicy: deps.quotaPolicy, bounds: deps.bounds, limits: deps.limits,
    vertical: deps.vertical, now: deps.now, workspaceId: deps.workspaceId, taskId: deps.taskId ?? null,
    brainConstraints: deps.brainConstraints ?? null, brainPolicyHash: deps.brainPolicyHash ?? null,
    executionBudget: deps.executionBudget, clock: deps.clock, log,
    classifyCompanyEvidence: deps.classifyCompanyEvidence,
    classificationCallsRemaining: deps.classificationCallsRemaining,
  });

  const countVerdict = (v: string) => res.candidates.filter((c) => c.verdict === v).length;
  const items = res.candidates.map((c, i) => {
    const p = res.persisted[i];
    return {
      company: c.account.name, person: c.person.name, personProfileUrl: c.person.linkedinUrl ?? null,
      verdict: c.verdict, quotaEligible: isQuotaEligibleCandidate(c, deps.quotaPolicy),
      accountId: p?.accountId ?? null, leadCandidateId: p?.leadCandidateId ?? null,
      jobUrl: c.jobEvidence.url, whyNow: c.verdict === "CONTACT" ? c.whyNow : null,
      employerMatch: c.employer.outcome,
      failedGates: Object.entries(c.gates).filter(([, v]) => v === "fail").map(([k]) => k),
      persisted: !!p?.ok, persistenceReason: p?.reason ?? null, leadKey: leadIdentityKey(c),
    };
  });

  return {
    status: res.terminal_status,
    terminal_reason: res.terminal_reason,
    executed_sourcing_mode: "company_first",
    quota: {
      requested_leads: res.requested_leads, eligible_leads: res.eligible_leads,
      remaining_leads: res.remaining_leads,
      requested_count_source: deps.requestedCountSource ?? "workflow_default",
      quota_policy: deps.quotaPolicy ?? "contact_only",
    },
    counts: {
      rawJobs: res.raw_jobs_processed, verifiedCompanies: res.verified_companies,
      candidates: res.candidates.length,
      contact: countVerdict("CONTACT"), watch: countVerdict("WATCH"),
      needsReview: countVerdict("NEEDS_REVIEW"), reject: countVerdict("REJECT"),
      persisted: res.persisted.filter((p) => p.ok).length,
    },
    // Safe counts and reasons only; surfaced so a task can be audited without
    // rerunning it.
    semantic_classification: res.semantic_classification ?? null,
    rounds_attempted: res.rounds_attempted,
    expansions_attempted: res.expansions_attempted,
    rounds: res.rounds,
    provider_calls: res.provider_calls,
    budget_consumed: res.budget_consumed,
    items,
    routing: {
      execution_mode: "company_first", company_first: true,
      requested_person_role: deps.intent.requested_person_role,
      job_search_spec: {
        keyword_queries: deps.intent.job_search_spec.keyword_queries,
        location: deps.intent.job_search_spec.location,
        company_vertical: deps.intent.job_search_spec.company_vertical,
        compilation_status: deps.intent.job_search_spec.compilation_status,
      },
      original_user_query: deps.intent.job_search_spec.original_query,
    },
    diagnostics: {
      jobsInvoked: res.rounds_attempted > 0,
      peopleCalls: res.provider_calls - res.rounds_attempted,
      budgetStopped: res.terminal_status === "budget_exhausted",
    },
    writeBoundary: res.writeBoundary,
    plan_sources: res.plan_sources,
    planner_metadata: res.planner_metadata,
    idempotency: res.idempotency,
    bottlenecks: res.bottlenecks,
    continuation: res.continuation,
    error: res.writeBoundary.invariantViolation ?? undefined,
  };
}
