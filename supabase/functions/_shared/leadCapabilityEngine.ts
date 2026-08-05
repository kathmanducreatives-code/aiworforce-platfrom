// THE CAPABILITY EXECUTION ENGINE — the graph drives, nothing else does.
//
// Phase 1 made the capability graph AUTHORITATIVE about what may run. It still
// let `executeCompanyFirstRoute` decide the actual order, which left two things
// that could disagree about the same run. This module removes the second one:
// the graph's own steps are now the state machine, and every provider call
// happens because a capability asked for it.
//
// WHAT IT REUSES AND WHY.
//
// Nothing here re-implements a provider normalizer, an Actor input compiler, an
// identity resolver or the Company Brain gate. Those are correct, tested, and
// the source of the evidence discipline this engine depends on. The engine
// COMPOSES them one capability at a time, which is what buys genuine resume
// granularity: a run that stopped after enrichment resumes at hiring
// verification rather than re-paying for discovery.
//
// THREE RULES THE ENGINE ENFORCES THAT A LINEAR EXECUTOR CANNOT.
//
//   * A capability runs only when its inputs exist. Founder discovery cannot
//     run on companies that never passed the Brain, because "qualified company"
//     is an input it declares and the engine checks.
//   * A capability advances only when its evidence requirements are met.
//     Enrichment that returned nothing does not count as enrichment, so
//     qualification still sees "unenriched" rather than an empty record that
//     looks like a proven negative.
//   * Provider exhaustion is a STATE, not a licence. When memo23 and solidcode
//     are both spent, the mission reports exhausted. It does not discover that
//     a job board is technically reachable.
//
// PROVIDER ACCESS IS THROUGH `guardedInvoker` ONLY. A `CapabilityContainmentError`
// is deliberately NOT caught into a fallback: it means the engine tried to reach
// outside its own graph, which is a bug in the engine, not a provider failure.
//
// No network, provider, model or database access of its own — everything is
// injected, which is what lets the end-to-end proof exercise the REAL engine
// with zero paid runs.

import {
  compileHarvestCompanyDetailsInput, compileHarvestCompanyEmployeesInput,
  compileHarvestCompanySearchInput,
  compileHarvestJobSearchInput, compileHarvestProfileSearchInput,
  compileMemo23YcInput, fanOutSolidcodeTeamSizes,
  type CompiledActorCall, type CompileResult,
} from "./hiringActorInputs.ts";
import {
  acceptLinkedInMatch, linkedInSearchQueryFor, LINKEDIN_RESOLUTION_CONCURRENCY,
  prequalificationKey, prequalifyYcCompanies, shortlistForLinkedInResolution,
  type PrequalificationResult, type PrequalifiedCompany, type YcCompanyInput,
} from "./leadCommercialPrequalification.ts";
import type { ExecutionDeadline } from "./leadExecutionFinalizer.ts";
import {
  TIER_A_TITLES, TIER_B_TITLES, assessHiring, needsPaidJobVerification,
  reachesCompanyBrain, type HiringAssessment, type SupportingSignal,
} from "./commercialSignalPolicy.ts";
import {
  applyMissionPrecedence, decideCompanyBrain,
  type BrainDecision, type ParsedSemanticFit, type SemanticFitInput,
} from "./companyBrainSemanticFit.ts";
import type { PortfolioCandidate } from "./opportunityPortfolio.ts";
import {
  CHECKPOINT_RESERVE_MS, shouldCheckpoint, type CompanyResumeRecord,
} from "./leadResumeState.ts";
import {
  dedupeJobs, dedupePeople, normalizeHarvestPerson, normalizeLinkedInCompanyEnriched,
  normalizeLinkedInJob, normalizeMemo23Company, normalizeMemo23OpenJobs,
  normalizeSolidcodeCompany,
  type NormalizedHiringCompany, type NormalizedHiringJob, type NormalizedHiringPerson,
} from "./hiringActorNormalizers.ts";
import {
  advance, evaluateCompanyFit, newCompanyRecord, projectFunnel,
  type CompanyFitResult, type CompanyRecordState, type FunnelCounts,
} from "./companyFirstStages.ts";
import {
  identityIsActionable, resolveIdentityAgainstLookups, type IdentityResolution,
} from "./companyIdentityResolution.ts";
import { DEFAULT_ROLE_PACKS, filterJobsForPack, type RolePack } from "./hiringRolePackFilter.ts";
import {
  COMPANY_EMPLOYEES_SCRAPER_MODES, PROFILE_SEARCH_SCRAPER_MODES,
} from "./hiringActorCatalog.ts";
import {
  CAPABILITY_REGISTRY, CapabilityContainmentError, onCapabilityExhausted,
  type CapabilityId, type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import { guardedInvoker } from "./leadMissionRuntime.ts";
import {
  assertPeopleProviderAllowed, PaidExecutionBlockedError,
} from "./leadPaidExecutionPreflight.ts";
import { missionHash, type LeadMissionV1 } from "./leadMission.ts";

export const CAPABILITY_EXECUTION_STATE_VERSION = "capability-execution-state-v1" as const;

/**
 * Discovery-time size bounds for memo23.
 *
 * BROAD ON PURPOSE. The Actor's size filters are fixed enums, and the mission's
 * real bound (10-150) is not expressible in them. Discovery casts wide and the
 * exact range is enforced from ENRICHED headcount, because the Actor's own
 * `teamSize` is advisory and was up to 23x wrong in the live benchmark.
 * Both values appear in the published schema and in the in-repo pinned enums.
 */
export const MEMO23_DEFAULT_MIN_SIZE = "10+";
export const MEMO23_DEFAULT_MAX_SIZE = "500";

// ------------------------------------------------------------------ state ----

export interface ProviderAttempt {
  capability: CapabilityId;
  provider: string;
  attempt: number;
  outcome:
    | "ok" | "empty" | "error" | "pending" | "skipped_idempotent" | "compile_failed"
    | "skipped_not_configured"
    /** The execution deadline closed before this call could safely start. */
    | "skipped_deadline";
  rows: number;
  cost_units: number;
  reason: string | null;
}

/**
 * What the Workbench may show WHILE the run is still going.
 *
 * Every field is a count of something already proven. There is deliberately no
 * "qualified" number before the Brain has run: a mid-run row that looks
 * qualified is the fail-open the whole persistence-authority change was for.
 */
export interface EngineProgress {
  stage:
    | "accounts_found" | "prequalified" | "identity_resolved"
    | "companies_enriched" | "hiring_verified" | "qualified" | "decision_makers_verified";
  accounts_found: number;
  evaluated: number;
  eligible_opportunities: number;
  exclusion_reasons: Record<string, number>;
  identity_resolved: number;
  identity_unresolved: number;
  companies_enriched: number;
  hiring_verified: number;
  /** Only ever set by `company_brain_qualification`. Zero until then. */
  qualified_companies: number;
  decision_makers_verified: number;
  /** Every job in every discovered company's `openJobs`, not just commercial ones. */
  open_jobs_evaluated: number;
  shortlisted: number;
  /**
   * Is work ACTIVELY happening right now?
   *
   * Published as `true` from inside the run. It is NOT a synonym for "some
   * capability is still pending": a partial run legitimately ends holding
   * pending capabilities, and reading those as activity is what would leave a
   * finished workflow saying "Sourcing in progress" forever. The caller
   * corrects this once when the invocation ends — see {@link finalizedProgress}.
   */
  in_progress: boolean;
  /** A billed Actor run is still in flight; the workflow is resumable, not dead. */
  awaiting_external_run: boolean;
}

/** One company's free prequalification verdict, as persisted. */
export interface PrequalificationRecord {
  company_key: string;
  name: string;
  canonical_domain: string | null;
  team_size: number | null;
  size_status: PrequalifiedCompany["size_status"];
  best_tier: PrequalifiedCompany["best_tier"];
  score: number;
  strongest_signal: string | null;
  /** Every commercial job, not just the strongest. */
  commercial_jobs: string[];
  eligible: boolean;
  exclusion: PrequalifiedCompany["exclusion"];
  shortlisted: boolean;
  reasons: string[];
}

export interface CapabilityExecutionState {
  version: typeof CAPABILITY_EXECUTION_STATE_VERSION;
  /** Binds this state to the mission it was produced for. */
  mission_hash: string;
  entry_capability: CapabilityId;
  completed_capabilities: CapabilityId[];
  current_capability: CapabilityId | null;
  pending_capabilities: CapabilityId[];
  provider_attempts: ProviderAttempt[];
  accumulated_cost_units: number;
  /** Deduplicated company identities seen, in discovery order. */
  company_keys: string[];
  qualified_company_keys: string[];
  /** Passed every gate except one that lacked evidence. NOT rejections. */
  unknown_company_keys: string[];
  contact_identities: string[];
  terminal_reason: string | null;
  fallback_reason: string | null;
  /**
   * Paid Actor runs that were still RUNNING when the poll window closed.
   *
   * These are BILLED runs that exist. Discarding them is what abandoned TEST run
   * rWikfnKgnp5DazDYr (dataset KmurtcXfCOhGcBmH4) — started, charged, never read.
   * A resume adopts the run id instead of starting a second Actor.
   */
  pending_runs: Array<{
    capability: CapabilityId; provider: string; run_id: string;
    dataset_id: string | null; actor_build_id: string | null; started_at: string;
  }>;
  /**
   * The FREE decision about who was worth paying to identify.
   *
   * Persisted in full — including the exclusions — because "why was this
   * company not pursued?" is the question the previous run could not answer
   * without reading 16 zero-row Actor datasets by hand.
   */
  prequalification: {
    version: string;
    total_rows: number;
    unique_companies: number;
    artifacts_excluded: number;
    eligible_companies: number;
    employee_size_excluded: number;
    technical_only_companies: number;
    /** EVERY job seen across every company, commercial or not. */
    open_jobs_evaluated: number;
    shortlist_keys: string[];
    companies: PrequalificationRecord[];
  } | null;
  /** The last published progress snapshot. Never contains a premature pass. */
  progress: EngineProgress | null;
}

export function newExecutionState(
  plan: CapabilityPlan, missionHashValue: string,
): CapabilityExecutionState {
  return {
    version: CAPABILITY_EXECUTION_STATE_VERSION,
    mission_hash: missionHashValue,
    entry_capability: plan.entry_capability,
    completed_capabilities: [],
    current_capability: null,
    pending_capabilities: plan.steps.map((s) => s.capability),
    provider_attempts: [],
    accumulated_cost_units: 0,
    company_keys: [],
    qualified_company_keys: [],
    unknown_company_keys: [],
    contact_identities: [],
    terminal_reason: null,
    fallback_reason: null,
    pending_runs: [],
    prequalification: null,
    progress: null,
  };
}

/**
 * Is this state safe to resume against this mission?
 *
 * A state whose `mission_hash` disagrees belongs to a DIFFERENT question, and
 * continuing from it would silently answer the old one. Resuming from scratch
 * costs money; resuming from the wrong mission costs correctness.
 */
export function stateMatchesMission(
  state: CapabilityExecutionState | null | undefined, missionHashValue: string,
): boolean {
  return !!state && state.version === CAPABILITY_EXECUTION_STATE_VERSION &&
    state.mission_hash === missionHashValue;
}

// -------------------------------------------------------------- working set ----

export interface EngineCompany {
  key: string;
  /**
   * The key the FREE prequalification used for this row.
   *
   * Kept alongside `key` rather than derived from it: `key` prefers a LinkedIn
   * URL and falls back to the YC source id, so for a domainless row the two
   * genuinely differ. Carrying both is what lets a shortlist and its companies
   * stay the same set.
   */
  prequal_key: string | null;
  prequalified: PrequalifiedCompany | null;
  shortlisted: boolean;
  company: NormalizedHiringCompany;
  identity: IdentityResolution | null;
  enriched: NormalizedHiringCompany | null;
  yc_open_jobs: NormalizedHiringJob[];
  hiring_jobs: NormalizedHiringJob[];
  fit: CompanyFitResult | null;
  /** The canonical hiring decision, with its evidence and reason. */
  hiring_assessment: HiringAssessment | null;
  /**
   * The explicit Company Brain outcome. Exactly one of QUALIFIED / REVIEW /
   * REJECT for every company that reached the gate — never a silent absence.
   */
  brain: BrainDecision | null;
  /** The classifier's raw-safe parse: status, repaired fields, assessment. */
  semantic_parse: ParsedSemanticFit | null;
  /** Stable keys of provider operations already completed for this company. */
  completed_operations: string[];
  /** Set when the Brain returned UNKNOWN and evidence resolution was attempted. */
  classification: { verdict: "pass" | "fail" | "unknown"; reason: string; source: string } | null;
  /**
   * THE QUALIFICATION DECISION, held explicitly.
   *
   * Deliberately NOT read back off `record.stage`. `advance` only moves forward
   * through COMPANY_STAGE_ORDER, in which `company_fit_*` precedes
   * `hiring_verified` — and this graph verifies hiring BEFORE it qualifies, so
   * the fit stages are backward moves that `advance` correctly refuses. Reading
   * the verdict off the stage therefore lost every UNKNOWN silently, which is
   * the precise failure mode this whole module exists to prevent.
   */
  verdict: "pass" | "reject" | "unknown" | null;
  founders: NormalizedHiringPerson[];
  verified_founders: NormalizedHiringPerson[];
  contact_identities: string[];
  record: CompanyRecordState;
}

function companyKey(c: NormalizedHiringCompany): string {
  return (c.linkedin_company_url ?? c.canonical_domain ?? c.external_source_id)
    .toLowerCase().replace(/\/$/, "");
}

// --------------------------------------------------------------------- deps ----

export type ActorInvoker = (call: CompiledActorCall<unknown>) => Promise<Record<string, unknown>[]>;

/** A provider call that started a real, billable run that has not finished. */
export interface PendingRun {
  run_id: string;
  dataset_id: string | null;
  actor_build_id?: string | null;
  cost_units?: number;
}

export interface CapabilityEngineDeps {
  /** The ONLY provider entry point. Wrapped in `guardedInvoker` by the engine. */
  invoke: ActorInvoker;
  /**
   * Report a started-but-unfinished run. Returning a value makes the attempt
   * PENDING rather than an error, so the capability is neither completed nor
   * failed and no fallback is allowed to spend against it.
   */
  readPendingRun?: (e: unknown) => PendingRun | null;
  verifyEmployer: (
    person: NormalizedHiringPerson, companyLinkedInUrl: string,
  ) => { verified: boolean; outcome: string };
  /**
   * Resolve an UNKNOWN Company Brain verdict with a semantic classifier.
   *
   * Absent or null-returning means UNKNOWN STAYS UNKNOWN. That is the whole
   * point: a company we could not classify is held for review, never converted
   * into a rejection because the budget for interpreting it was zero.
   */
  /**
   * THE STRUCTURED CLASSIFIER. One contract, end to end.
   *
   * This used to return `{verdict, reason}` while the semantic module expected
   * the full schema, so the live path could never produce a real business-model
   * judgement — only an offline stub could. There is now ONE shape, and it is
   * the schema the Brain actually reasons over.
   *
   * Absent, or returning null, means UNKNOWN STAYS UNKNOWN: the company is held
   * for review, never converted into a rejection for want of budget.
   */
  classifyCompany?: (input: SemanticFitInput) => Promise<ParsedSemanticFit | null>;
  callCompleted?: (key: string) => boolean;
  onCallComplete?: (key: string) => void;
  /**
   * The wall-clock budget, checked BEFORE every provider call.
   *
   * Absent means unbounded, which is only correct in tests. In production the
   * engine that does not hold one is the engine that gets killed holding a paid
   * run it never read — TEST task c8a6e53d, 16 Actor starts, plan Running
   * forever.
   */
  deadline?: ExecutionDeadline;
  /** Wall clock kept back for writing a checkpoint. Defaults to 18s. */
  checkpointReserveMs?: number;
  /**
   * Publish a stage snapshot as soon as it is true.
   *
   * The Workbench updates from these. They are counts of proven work, never
   * rows, and never carry a qualified verdict before the Brain has produced one.
   */
  onProgress?: (p: EngineProgress) => void | Promise<void>;
  /** The state after each capability, so a caller can persist it as it grows. */
  onStateChange?: (s: CapabilityExecutionState) => void;
  log?: (msg: string, meta?: unknown) => void;
}

export interface CapabilityEngineOpts {
  mission: LeadMissionV1;
  plan: CapabilityPlan;
  /** Resume state. Ignored unless its mission_hash matches. */
  state?: CapabilityExecutionState | null;
  brain?: {
    employee_min?: number | null;
    employee_max?: number | null;
    positive_industries?: string[];
    excluded_industries?: string[];
    required_geography?: string | null;
  };
  maxCandidates?: number;
  rolePacks?: readonly RolePack[];
  postedLimit?: "1h" | "24h" | "week" | "month";
  ycRegions?: string[];
  ycIndustries?: string[];
  ycMinSize?: string;
  ycMaxSize?: string;
  solidcodeTeamSizes?: string[];
  foundersPerCompany?: number;
}

export interface CapabilityRunResult {
  state: CapabilityExecutionState;
  companies: EngineCompany[];
  funnel: FunnelCounts;
  /** Per-company stage state, so a resume continues where each one stopped. */
  resume_records: CompanyResumeRecord[];
  /** Per-capability outcome, in execution order. Persisted for audit. */
  capability_outcomes: Array<{
    capability: CapabilityId;
    status: "complete" | "skipped_resumed" | "skipped_no_input" | "exhausted" | "incomplete";
    rows: number;
    providers_used: string[];
    evidence_satisfied: boolean;
    reason: string | null;
  }>;
}

// ------------------------------------------------------------------ engine ----

/**
 * Execute a mission's capability plan.
 *
 * The loop is the contract: steps in plan order, each one checked for inputs
 * before it runs and for evidence after it does. There is no path through this
 * function that reaches a provider the plan did not authorise, and no path that
 * substitutes one capability for another when the first comes up empty.
 */
export async function runCapabilityPlan(
  deps: CapabilityEngineDeps, opts: CapabilityEngineOpts,
): Promise<CapabilityRunResult> {
  const log = deps.log ?? (() => {});
  const hash = await missionHash(opts.mission);
  const state: CapabilityExecutionState = stateMatchesMission(opts.state, hash)
    ? { ...opts.state!, provider_attempts: [...opts.state!.provider_attempts] }
    : newExecutionState(opts.plan, hash);

  const outcomes: CapabilityRunResult["capability_outcomes"] = [];
  const companies: EngineCompany[] = [];
  const maxCandidates = opts.maxCandidates ?? 50;

  // THE GUARDED BOUNDARY. Every provider call in this file goes through it.
  const invoke = guardedInvoker(opts.plan, deps.invoke, (actorKey) => {
    log("capability_containment_violation", { actorKey });
  });

  /** One provider call: idempotency, cost, attempt record, never off-graph. */
  const callProvider = async (
    capability: CapabilityId, provider: string, compiled: CompileResult<unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const spec = CAPABILITY_REGISTRY[capability];
    // COUNTED AT RECORD TIME, not before the await. The resolution stage runs two
    // calls concurrently; computing the number up front gave both of them
    // "attempt 1" and made the ledger unreadable.
    const record = (outcome: ProviderAttempt["outcome"], rows: number, reason: string | null) => {
      const attempt = state.provider_attempts
        .filter((a) => a.capability === capability && a.provider === provider).length + 1;
      state.provider_attempts.push({
        capability, provider, attempt, outcome, rows,
        cost_units: outcome === "ok" || outcome === "empty" ? spec.cost_units : 0,
        reason,
      });
      if (outcome === "ok" || outcome === "empty") {
        state.accumulated_cost_units += spec.cost_units;
      }
    };

    if (!compiled.ok) {
      record("compile_failed", 0, compiled.errors.join("; "));
      return [];
    }
    const call = compiled;
    if (deps.callCompleted?.(call.batchIdentity)) {
      record("skipped_idempotent", 0, call.batchIdentity);
      return [];
    }
    // THE DEADLINE IS CHECKED BEFORE THE CALL, NEVER AFTER.
    //
    // `expired()` means "there is no longer room for another call plus writing
    // state" — not "time is up". Starting a call that cannot finish is exactly
    // how the previous run died holding a billed Actor run it never read.
    // THE RESERVE, checked BEFORE the deadline itself.
    //
    // `expired()` means "no room for another call". The reserve is stricter: it
    // stops starting paid work while there is still time to WRITE A CHECKPOINT,
    // so a resume knows exactly which company owes which stage. The previous run
    // learned it was out of time by being killed.
    if (deps.deadline &&
        shouldCheckpoint({
          elapsedMs: () => deps.deadline!.elapsedMs(),
          remainingMs: () => deps.deadline!.remainingMs(),
        }, deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS)) {
      record("skipped_deadline", 0,
        `checkpoint reserve reached after ${deps.deadline.elapsedMs()}ms ` +
        `(${deps.deadline.remainingMs()}ms left); call not started`);
      state.terminal_reason = "execution_deadline_checkpoint";
      log("provider_skipped_checkpoint_reserve", {
        capability, provider, remaining_ms: deps.deadline.remainingMs(),
      });
      return [];
    }
    // RESUME BEFORE START. If a run for this capability+provider is already in
    // flight from an earlier invocation, adopt its id: the caller reads that run
    // and its dataset instead of issuing a second, separately-billed start.
    const inFlight = (opts.state?.pending_runs ?? []).find(
      (r) => r.capability === capability && r.provider === provider);
    // `capabilityId` is what lets `guardedInvoker` enforce per-capability
    // containment rather than the plan-wide union.
    const outbound = {
      ...call,
      capabilityId: capability,
      ...(inFlight ? { resumeRunId: inFlight.run_id } : {}),
    } as typeof call;
    const startedAt = Date.now();
    try {
      const rows = await invoke(outbound);
      // THE ESTIMATE LEARNS FROM REALITY. memo23 took 24s on task c8a6e53d; a
      // deadline still assuming 12s would have authorised one more call it could
      // not finish.
      deps.deadline?.observeCall(Date.now() - startedAt);
      deps.onCallComplete?.(call.batchIdentity);
      record(rows.length > 0 ? "ok" : "empty", rows.length, null);
      return rows;
    } catch (e) {
      deps.deadline?.observeCall(Date.now() - startedAt);
      // A CONTAINMENT error is an engine bug, not a provider failure. Letting it
      // become "try the next provider" is exactly how a guard turns into a
      // suggestion, so it propagates.
      if (e instanceof CapabilityContainmentError) throw e;
      if (e instanceof PaidExecutionBlockedError) throw e;

      // A RUN THAT STARTED IS NOT A FAILURE. It is billed and it exists, so it
      // is recorded as PENDING with its real cost and its identifiers, and the
      // capability neither completes nor falls back.
      const pending = deps.readPendingRun?.(e) ?? null;
      if (pending?.run_id) {
        state.provider_attempts.push({
          capability, provider,
          attempt: state.provider_attempts
            .filter((a) => a.capability === capability && a.provider === provider).length + 1,
          outcome: "pending", rows: 0,
          cost_units: pending.cost_units ?? spec.cost_units,
          reason: `run ${pending.run_id} still running; dataset ${pending.dataset_id ?? "pending"}`,
        });
        state.accumulated_cost_units += pending.cost_units ?? spec.cost_units;
        if (!state.pending_runs.some((r) => r.run_id === pending.run_id)) {
          state.pending_runs.push({
            capability, provider, run_id: pending.run_id,
            dataset_id: pending.dataset_id ?? null,
            actor_build_id: pending.actor_build_id ?? null,
            started_at: new Date().toISOString(),
          });
        }
        log("provider_pending", { capability, provider, run_id: pending.run_id });
        return [];
      }
      record("error", 0, String(e));
      log("provider_error", { capability, provider, error: String(e) });
      return [];
    }
  };

  /**
   * Publish what is TRUE right now.
   *
   * `qualified_companies` reads the explicit verdict and nothing else, so a
   * mid-run snapshot cannot report a company as qualified before the Company
   * Brain has said so. `in_progress` stays true until the plan is out of pending
   * capabilities, which is what tells the Workbench these rows are not yet
   * actionable.
   */
  const publish = async (stage: EngineProgress["stage"]) => {
    const exclusion_reasons: Record<string, number> = {};
    for (const c of state.prequalification?.companies ?? []) {
      if (!c.exclusion) continue;
      exclusion_reasons[c.exclusion] = (exclusion_reasons[c.exclusion] ?? 0) + 1;
    }
    const progress: EngineProgress = {
      stage,
      accounts_found: companies.length,
      evaluated: state.prequalification?.unique_companies ?? 0,
      eligible_opportunities: state.prequalification?.eligible_companies ?? 0,
      exclusion_reasons,
      identity_resolved: companies.filter((c) => c.identity && identityIsActionable(c.identity)).length,
      identity_unresolved: companies.filter((c) => c.identity && !identityIsActionable(c.identity)).length,
      companies_enriched: companies.filter((c) => c.enriched !== null).length,
      hiring_verified: companies.filter((c) => c.hiring_jobs.length > 0).length,
      // THE ONLY SOURCE OF A QUALIFIED COUNT IS THE BRAIN'S VERDICT.
      qualified_companies: companies.filter((c) => c.verdict === "pass").length,
      decision_makers_verified: companies.reduce((n, c) => n + c.verified_founders.length, 0),
      open_jobs_evaluated: state.prequalification?.open_jobs_evaluated ?? 0,
      shortlisted: companies.filter((c) => c.shortlisted).length,
      // TRUE BECAUSE THIS IS BEING PUBLISHED FROM INSIDE THE RUN. The caller
      // corrects it when the invocation ends.
      in_progress: true,
      awaiting_external_run: state.pending_runs.length > 0,
    };
    state.progress = progress;
    // AWAITED. A fire-and-forget write in an edge function is a write that may
    // never land — the process can be torn down before the promise settles,
    // which is the same class of loss the terminal guard exists to stop.
    await deps.onProgress?.(progress);
    deps.onStateChange?.(state);
  };

  const finish = (
    capability: CapabilityId,
    status: CapabilityRunResult["capability_outcomes"][number]["status"],
    rows: number, providers: string[], evidence: boolean, reason: string | null,
  ) => {
    outcomes.push({
      capability, status, rows, providers_used: providers,
      evidence_satisfied: evidence, reason,
    });
    // COMPLETED MEANS THE CAPABILITY DID ITS JOB — nothing weaker.
    //
    // A capability whose provider returned zero usable records, whose required
    // evidence is missing, or whose input failed validation is NOT complete. It
    // stays pending, so a resume retries it and the downstream people gate keeps
    // refusing. Marking it complete on a zero result is what let task
    // e8abeb8f-…-cfcbc6a416d4 treat a schema-rejected memo23 call as "no
    // candidates" and walk on to a job board.
    const genuinelyComplete =
      (status === "complete" && evidence === true) || status === "skipped_resumed";
    if (genuinelyComplete && !state.completed_capabilities.includes(capability)) {
      state.completed_capabilities.push(capability);
    }
    if (genuinelyComplete) {
      state.pending_capabilities = state.pending_capabilities.filter((c) => c !== capability);
    }
    state.current_capability = null;
  };

  for (const step of opts.plan.steps) {
    const cap = step.capability;

    // RESUME. A capability already completed is not re-paid for.
    if (state.completed_capabilities.includes(cap)) {
      outcomes.push({
        capability: cap, status: "skipped_resumed", rows: 0, providers_used: [],
        evidence_satisfied: true, reason: "completed in an earlier run",
      });
      state.pending_capabilities = state.pending_capabilities.filter((c) => c !== cap);
      continue;
    }
    state.current_capability = cap;

    // ── DISCOVERY ────────────────────────────────────────────────────────────
    if (cap === "startup_company_discovery") {
      const used: string[] = [];
      const tried: string[] = [];
      /** Raw provider rows, kept for the FREE prequalification pass below. */
      const rawYcRows: YcCompanyInput[] = [];
      /** Set the moment any provider's input fails validation. */
      let schemaFailure = false;
      /** Set when a provider started a real run that has not finished. */
      let runPending = false;
      const pendingFor = (provider: string) =>
        state.provider_attempts.some(
          (a) => a.capability === cap && a.provider === provider && a.outcome === "pending");
      const compileFailedFor = (provider: string) =>
        state.provider_attempts.some(
          (a) => a.capability === cap && a.provider === provider && a.outcome === "compile_failed");
      for (const provider of step.providers) {
        if (schemaFailure) break;
        // A FALLBACK MUST NOT SPEND WHILE THE PRIMARY IS STILL RUNNING. The
        // primary may yet return everything the mission needs, and paying a
        // second source to answer a question already in flight is the waste this
        // whole gate exists to stop.
        if (runPending) break;
        if (companies.length >= maxCandidates) break;
        // solidcode is FALLBACK ONLY: it runs when the primary produced nothing,
        // not merely when the quota is unmet.
        if (provider === "apify_yc_companies_solidcode" && companies.length > 0) {
          tried.push(provider);
          continue;
        }
        tried.push(provider);
        used.push(provider);

        if (provider === "apify_yc_companies_memo23") {
    const compiled = compileMemo23YcInput({
            mode: "companies",
            queries: [],
            topCompany: false,
            nonprofit: false,
            batch: ["All Batches"],
            regions: opts.ycRegions ?? ["United States of America"],
            industries: opts.ycIndustries ?? ["B2B"],
            isHiring: true,
            minEmployeeSize: opts.ycMinSize ?? MEMO23_DEFAULT_MIN_SIZE,
            maxEmployeeSize: opts.ycMaxSize ?? MEMO23_DEFAULT_MAX_SIZE,
            scrapeOpenJobs: true,
            scrapeFounderDetails: false,
            enrichEmails: false,
            maxItems: maxCandidates,
          });
          for (const r of await callProvider(cap, provider, compiled)) {
            const c = normalizeMemo23Company(r);
            rawYcRows.push(r as YcCompanyInput);
            // The prequalification key is derived by the PREQUALIFICATION module
            // from the same raw row, so the shortlist and the working set cannot
            // drift apart.
            addCompany(companies, c, normalizeMemo23OpenJobs(r),
              prequalificationKey(r as YcCompanyInput));
          }
        } else if (provider === "apify_yc_companies_solidcode") {
          // NOT CONFIGURED IS NOT INVALID INPUT.
          //
          // Reporting a missing fallback configuration as `compile_failed` made
          // the whole capability read `provider_input_validation_failed` on TEST
          // task 80501967-…-1b7db0ad46e7 — even though memo23's input was
          // perfectly valid and its run had started. A fallback nobody
          // configured is skipped, and says so.
          if ((opts.solidcodeTeamSizes ?? []).length === 0) {
            state.provider_attempts.push({
              capability: cap, provider, attempt: 1, outcome: "skipped_not_configured",
              rows: 0, cost_units: 0,
              reason: "no team-size bands configured; a bandless call duplicates memo23 at 2x price",
            });
            continue;
          }
          for (const compiled of fanOutSolidcodeTeamSizes(
            { regions: ["United States of America"], industries: ["B2B"], isHiring: true,
              includeJobs: true, includeFounders: false, maxResults: maxCandidates },
            opts.solidcodeTeamSizes ?? [],
          )) {
            for (const r of await callProvider(cap, provider, compiled)) {
              addCompany(companies, normalizeSolidcodeCompany(r), []);
            }
          }
        }
        // A REJECTED INPUT ENDS THE CAPABILITY IMMEDIATELY.
        //
        // Continuing to the next approved provider would still be spending on
        // the back of a call we never validly made, and the whole point of
        // catching this locally is that nothing downstream gets to reinterpret
        // it as "the source came back empty".
        if (compileFailedFor(provider)) { schemaFailure = true; break; }
        if (pendingFor(provider)) { runPending = true; break; }
      }
      state.company_keys = companies.map((c) => c.key);

      if (companies.length === 0 && runPending) {
        // PENDING, NOT EXHAUSTED. The capability stays incomplete and unspent-on;
        // a later resume adopts the same run id rather than starting another.
        state.terminal_reason = "provider_run_pending";
        state.fallback_reason = null;
        finish(cap, "incomplete", 0, used, false,
          `provider_run_pending: ${state.pending_runs.map((r) => `${r.provider}:${r.run_id}`).join(", ")}`);
        break;
      }
      if (companies.length === 0) {
        // AN INVALID INPUT IS NOT AN EMPTY RESULT.
        //
        // On TEST task e8abeb8f-…-cfcbc6a416d4 the memo23 call was rejected by
        // Apify and the run carried on as though the source had simply returned
        // nothing — which is how a schema failure became a LinkedIn Jobs sweep
        // and five people searches. A source that was never validly asked has
        // not answered, and the mission stops here.
        const invalid = state.provider_attempts.filter(
          (a) => a.capability === cap && a.outcome === "compile_failed");
        if (invalid.length > 0) {
          state.terminal_reason = "provider_input_validation_failed";
          state.fallback_reason = null;
          finish(cap, "incomplete", 0, used, false,
            `provider_input_validation_failed: ${invalid.map((a) => `${a.provider}: ${a.reason}`).join(" | ")}`);
          break;
        }
        const ex = onCapabilityExhausted(opts.plan, cap, tried);
        state.terminal_reason = ex.reason;
        state.fallback_reason = ex.status === "exhausted" ? "approved_providers_exhausted" : null;
        finish(cap, "exhausted", 0, used, false, ex.reason);
        // EXHAUSTED ENDS THE RUN. It does not fall through to a capability that
        // happens to be later in the plan.
        break;
      }
      // ── FREE COMMERCIAL PREQUALIFICATION ────────────────────────────────────
      //
      // Between discovery and the first paid identity call, and costing nothing.
      // memo23 already returned every company's FULL openJobs array, team size
      // and website; this decides who is worth paying to identify BEFORE anyone
      // is paid for. Task c8a6e53d skipped this step and bought 16 identity
      // lookups for companies that were only hiring engineers, or had 350 staff
      // against a 10-150 mission.
      applyPrequalification(state, companies, rawYcRows, {
        min: opts.brain?.employee_min ?? null,
        max: opts.brain?.employee_max ?? null,
      }, opts.mission.requested_count);
      // The working set may have shrunk — artifacts are gone.
      state.company_keys = companies.map((c) => c.key);
      log("prequalification_complete", {
        unique: state.prequalification?.unique_companies,
        eligible: state.prequalification?.eligible_companies,
        size_excluded: state.prequalification?.employee_size_excluded,
        technical_only: state.prequalification?.technical_only_companies,
        shortlist: state.prequalification?.shortlist_keys,
      });

      finish(cap, "complete", companies.length, used, true, null);
      await publish("prequalified");
      continue;
    }

    if (cap === "general_company_discovery" || cap === "known_company_resolution" ||
        cap === "job_discovery" || cap === "funding_signal_discovery" ||
        cap === "expansion_signal_discovery" || cap === "job_deduplication" ||
        cap === "expansion_signal_verification") {
      // Declared in the graph and reachable, but not yet driven by this engine.
      // Recorded honestly rather than silently treated as done.
      finish(cap, "skipped_no_input", 0, [], false,
        "capability is not yet engine-driven; the mission reports a partial result");
      continue;
    }

    // ── IDENTITY ─────────────────────────────────────────────────────────────
    //
    // WHAT THIS REPLACED, AND WHY IT WAS WRONG.
    //
    // The previous route ran, for EVERY discovered company:
    //
    //     harvestapi/linkedin-company  with  { searches: [companyName] }
    //
    // `harvestapi/linkedin-company` is an ENRICHMENT actor. It resolves LinkedIn
    // company URLs into company records; it is not a name-search index. On TEST
    // task c8a6e53d that produced 16 sequential Actor starts, every one of them
    // returning zero rows, until the edge function hit its wall clock.
    //
    // The correct route is: search with the SEARCH actor, for the SHORTLIST
    // only, at most two at a time.
    if (cap === "company_identity_resolution") {
      const provider = "apify_linkedin_company_search";
      // ONLY THE SHORTLIST. A company nobody decided was worth identifying is
      // never paid for. When prequalification did not run (a non-YC entry
      // capability), everything is a target — the old behaviour, unchanged.
      const targets = state.prequalification
        ? companies.filter((c) => c.shortlisted)
        : companies.slice();
      let resolved = 0;
      let unresolved = 0;

      /** Resolve one company. Never more than `CONCURRENCY` of these in flight. */
      const resolveOne = async (c: EngineCompany): Promise<void> => {
        let lookups: Array<{ name: string | null; linkedinUrl: string | null; website: string | null }> = [];
        // ALREADY IDENTIFIED IS NOT WORTH PAYING FOR. memo23 has no LinkedIn
        // field, but a resumed run or another provider may have supplied one.
        if (!c.company.linkedin_company_url && c.company.company_name) {
          const compiled = compileHarvestCompanySearchInput({
            // Name plus domain. `linkedInSearchQueryFor` owns this so the dry run
            // and the live call cannot describe different searches.
            searchQuery: c.prequalified
              ? linkedInSearchQueryFor(c.prequalified)
              : c.company.company_name,
            // `full` is required: `short` returns employeeCount === null, and an
            // unverifiable size cannot settle a 10-150 gate.
            scraperMode: "full",
            maxItems: 5,
          });
          const found = await callProvider(cap, provider, compiled);
          lookups = found.map((f) => ({
            name: (f.name as string) ?? null,
            linkedinUrl: (f.linkedinUrl as string) ?? null,
            website: (f.website as string) ?? null,
          }));
          // A BARE NAME MATCH IS NOT AN IDENTITY. "Apollo", "Magic", "Hub" and
          // "Streak" are real YC companies and also ordinary words; accepting one
          // on name alone attaches a founder from the wrong company, which is
          // worse than returning nothing.
          if (c.prequalified) {
            const before = lookups.length;
            lookups = lookups.filter((l, i) => acceptLinkedInMatch(c.prequalified!, {
              name: l.name, website: l.website, linkedinUrl: l.linkedinUrl,
              description: (found[i]?.description as string) ?? null,
              location: (found[i]?.location as string) ?? null,
            }).accepted);
            if (before > 0 && lookups.length === 0) {
              c.record.missing_evidence.push("linkedin_match_rejected_weak");
            }
          }
        }
        c.identity = resolveIdentityAgainstLookups({
          company_key: c.key,
          name: c.company.company_name ?? null,
          website: c.company.canonical_domain ? `https://${c.company.canonical_domain}` : null,
          canonical_domain: c.company.canonical_domain ?? null,
          linkedin_company_url: c.company.linkedin_company_url ?? null,
        }, lookups);
        if (identityIsActionable(c.identity)) resolved++;
        else {
          unresolved++;
          // UNRESOLVED IS A HOLDING STATE, NOT A REJECTION — and NOT a retry
          // loop. It stays `identity_pending`, never reaches founder discovery,
          // and is reported as such rather than being asked again at a price.
          c.record = advance(c.record, "identity_pending", c.identity.status);
          c.record.missing_evidence.push(...c.identity.evidence);
        }
      };

      await runBounded(targets, LINKEDIN_RESOLUTION_CONCURRENCY, resolveOne,
        () => deps.deadline?.expired() === true);

      // Companies that were never shortlisted are explicitly not evaluated. They
      // must not look like failed lookups, and they must never be actionable.
      for (const c of companies) {
        if (targets.includes(c) || c.identity) continue;
        c.record = advance(c.record, "identity_pending", "not_shortlisted_for_paid_resolution");
        c.record.missing_evidence.push(
          c.prequalified?.exclusion
            ? `excluded_before_paid_resolution:${c.prequalified.exclusion}`
            : "excluded_before_paid_resolution",
        );
      }

      finish(cap, "complete", resolved, [provider], resolved > 0,
        resolved === 0 ? "no company reached an actionable identity" : null);
      log("identity_resolution_complete", {
        targets: targets.length, resolved, unresolved,
        concurrency: LINKEDIN_RESOLUTION_CONCURRENCY,
      });
      await publish("identity_resolved");
      continue;
    }

    // ── ENRICHMENT (MANDATORY, BEFORE QUALIFICATION) ─────────────────────────
    // ONE CALL FOR ALL RESOLVED COMPANIES, NOT ONE CALL EACH.
    //
    // `harvestapi/linkedin-company` takes `companies[]` — a LIST of LinkedIn
    // company URLs. The per-company loop this replaced paid a full Actor start
    // for every single company and spent the wall clock the run needed to finish.
    if (cap === "company_enrichment") {
      let enriched = 0;
      const actionable = companies.filter((c) => c.identity && identityIsActionable(c.identity));
      // DEDUPED. Two YC rows can resolve to one LinkedIn company; enriching it
      // twice pays twice for the same record.
      const byUrl = new Map<string, EngineCompany[]>();
      for (const c of actionable) {
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
        if (!url) continue;
        const list = byUrl.get(url) ?? [];
        list.push(c);
        byUrl.set(url, list);
      }
      const urls = [...byUrl.keys()];

      if (urls.length > 0) {
        // BOUNDED BATCHES, not an unbounded single request. One batch is the
        // normal case for a shortlist of five; the bound exists so a larger
        // mission degrades into a few calls rather than one request the Actor
        // rejects.
        for (const batch of chunk(urls, COMPANY_DETAILS_BATCH_SIZE)) {
          const compiled = compileHarvestCompanyDetailsInput({ companies: batch });
          const rows = await callProvider(cap, "apify_linkedin_company_details", compiled);
          // MAPPED BACK BY URL. A batched response arrives in the Actor's order,
          // not ours, so pairing by index would attach one company's evidence to
          // another — a silent, unfalsifiable corruption.
          for (const row of rows) {
            const normalized = normalizeLinkedInCompanyEnriched(row);
            const url = normalized.linkedin_company_url;
            const matches = url ? byUrl.get(url) ?? [] : [];
            for (const c of matches) {
              c.enriched = normalized;
              c.record = advance(c.record, "enrichment_complete", "provider_evidence_collected");
              enriched++;
            }
          }
        }
      }
      for (const c of actionable) {
        if (c.enriched) continue;
        c.record = advance(c.record, "enrichment_pending", "enrichment_returned_no_rows");
      }
      // EVIDENCE GATE. Enrichment that produced nothing is not enrichment, and
      // qualification must see that rather than an empty record it could read as
      // a proven negative.
      finish(cap, "complete", enriched, ["apify_linkedin_company_details"], enriched > 0,
        enriched === 0 ? "no company was enriched; qualification will hold them as unknown" : null);
      log("company_enrichment_complete", {
        resolved_urls: urls.length,
        actor_starts: Math.ceil(urls.length / COMPANY_DETAILS_BATCH_SIZE),
        enriched,
      });
      await publish("companies_enriched");
      continue;
    }

    // ── HIRING VERIFICATION ──────────────────────────────────────────────────
    // ── HIRING VERIFICATION — FREE EVIDENCE FIRST ────────────────────────────
    //
    // THIS IS THE GATE THAT SENT ZERO COMPANIES TO THE COMPANY BRAIN.
    //
    // It used to filter the YC `openJobs` it already held through
    // `DEFAULT_ROLE_PACKS`, whose Sales-Ops pack lists only four literal titles
    // ("Sales Operations Manager", …). "Head of Sales", "GTM Engineer" and
    // "Founding Account Executive" — the very roles prequalification had just
    // scored Tier A — matched none of them. So the free evidence was discarded,
    // a paid LinkedIn job search was bought per company, those results were
    // filtered through the same narrow packs (3 searches, 12 rows, 0 kept), and
    // the deadline closed at 109s with four companies never reached.
    //
    // The canonical policy is now the only vocabulary, and paid verification is
    // a fallback for the lone-Tier-B case alone.
    if (cap === "hiring_verification") {
      const targets = companies.filter((c) => c.identity && identityIsActionable(c.identity));
      let verified = 0, review = 0, watch = 0, notVerified = 0, paidCalls = 0;
      for (const c of targets) {
        // Supporting signals the free evidence already proves.
        const supporting: SupportingSignal[] = [];
        if ((c.prequalified?.tier_a ?? 0) + (c.prequalified?.tier_b ?? 0) >= 2) {
          supporting.push("multiple_commercial_openings");
        }
        let assessment = assessHiring(
          c.yc_open_jobs.map((j) => ({ title: j.title, url: j.job_url, location: j.location })),
          supporting, { source: "yc_open_jobs" });

        // PAID FALLBACK, ONLY FOR A LONE TIER B. Everything else is settled by
        // evidence already held; re-checking it is pure waste.
        if (needsPaidJobVerification(assessment) && !deps.deadline?.expired()) {
          const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
          if (url) {
            const compiled = compileHarvestJobSearchInput({
              company: [url],
              jobTitles: [...TIER_A_TITLES, ...TIER_B_TITLES].slice(0, 20),
              maxItems: 10,
              ...(opts.postedLimit ? { postedLimit: opts.postedLimit } : {}),
            });
            const rows = await callProvider(cap, "apify_linkedin_job_search", compiled);
            paidCalls++;
            if (rows.length > 0) {
              const external = assessHiring(
                rows.map(normalizeLinkedInJob).map((j) => ({
                  title: j.title ?? "", url: j.job_url, location: j.location })),
                [...supporting, "another_active_gtm_opening"],
                { source: "external_job_search" });
              // The external pass only ever UPGRADES; it cannot demote evidence
              // the free pass already accepted.
              if (external.verdict === "hiring_verified") assessment = external;
            }
          }
        }

        c.hiring_assessment = assessment;
        c.hiring_jobs = dedupeJobs(
          c.yc_open_jobs.filter((j) =>
            assessment.commercial_jobs.some((cj) => cj.title === j.title)));

        if (assessment.verdict === "hiring_verified") {
          c.record = advance(c.record, "hiring_verified",
            assessment.evidence_source === "yc_open_jobs"
              ? "yc_open_jobs_sufficient" : "job_evidence_present");
          verified++;
        } else if (assessment.verdict === "hiring_verification_needed") {
          review++;
          c.record.stage_reason = `hiring_verification_needed:${assessment.reason}`;
        } else if (assessment.verdict === "watch") {
          watch++;
          c.record.stage_reason = `hiring_watch:${assessment.reason}`;
        } else {
          notVerified++;
          c.record = advance(c.record, "hiring_not_verified", "no_matching_open_role");
          c.record.stage_reason = assessment.reason;
        }
      }
      // EVIDENCE IS SATISFIED WHEN A DECISION WAS REACHED, not only when a
      // company passed. A run that correctly finds three watch-list companies
      // has done its job.
      const decided = verified + review + watch;
      finish(cap, "complete", verified, paidCalls > 0 ? ["apify_linkedin_job_search"] : [],
        decided > 0,
        decided === 0 ? "no company had a relevant commercial role" : null);
      log("hiring_verification_complete", {
        targets: targets.length, verified, review, watch, notVerified,
        paid_job_searches: paidCalls,
      });
      await publish("hiring_verified");
      continue;
    }

    // ── COMPANY BRAIN QUALIFICATION ──────────────────────────────────────────
    if (cap === "company_brain_qualification") {
      let passed = 0, unknown = 0;
      // EVERY COMPANY WITH A DECISION REACHES THE BRAIN.
      //
      // This used to require `stage === "hiring_verified"`, so a lone Tier B or a
      // Tier C watch item was silently NOT_EVALUATED — no pass, no reject, no
      // unknown. That is how seven enriched companies produced a Brain summary of
      // "0 passed, 0 held as unknown": the eligible set was empty.
      const eligible = companies.filter((c) =>
        c.record.stage === "hiring_verified" || c.hiring_jobs.length > 0 ||
        (c.hiring_assessment ? reachesCompanyBrain(c.hiring_assessment) : false));
      for (const c of eligible) {
        const src = c.enriched ?? c.company;
        c.fit = evaluateCompanyFit({
          company_key: c.key,
          company_name: src.company_name ?? null,
          identity_status: c.identity?.status ?? "unresolved",
          enrichment_complete: c.enriched !== null,
          employee_count: src.employee_count ?? null,
          employee_range_advisory: src.employee_range_advisory ?? null,
          employee_min: opts.brain?.employee_min ?? null,
          employee_max: opts.brain?.employee_max ?? null,
          industry_ids: src.industry_ids ?? [],
          positive_industries: opts.brain?.positive_industries ?? [],
          excluded_industries: opts.brain?.excluded_industries ?? [],
          geography: src.geography ?? null,
          required_geography: opts.brain?.required_geography ?? null,
          description: src.description ?? null,
          provider_industry: src.provider_industry ?? null,
          canonical_domain: src.canonical_domain ?? null,
          postings: c.hiring_jobs.map((j) => ({ job_id: j.job_id, title: j.title, description: j.description })),
        });

        // MISSION PRECEDENCE, computed once per company: the user's words, then
        // the mission, then only the workspace categories that actually relate to
        // it. "Recruiting Agencies" must not broaden a SaaS mission.
        const appliedPolicy = applyMissionPrecedence({
          original_user_query: opts.mission.original_user_query,
          mission_verticals: opts.mission.company_profile?.verticals ?? [],
          mission_geography: opts.brain?.required_geography ?? null,
          workspace_industries: opts.brain?.positive_industries ?? [],
        });
        const gateInput = {
          // MAPPED AT THE BOUNDARY. `IdentityResolution.status` is
          // verified_match | ambiguous | mismatch | unresolved; the Brain only
          // needs to know "proven", "proven wrong" or "not proven". `ambiguous`
          // is NOT a mismatch — it is an unproven identity, which is REVIEW.
          identity_status: (c.identity && identityIsActionable(c.identity)
            ? "verified_match"
            : c.identity?.status === "mismatch"
            ? "rejected_mismatch"
            : "unresolved") as "verified_match" | "unresolved" | "rejected_mismatch",
          active: true,
          geography: src.geography ?? null,
          required_geography: opts.brain?.required_geography ?? null,
          employee_count: src.employee_count ?? null,
          employee_ceiling: opts.brain?.employee_max ?? 200,
          commercial_tier: c.hiring_assessment?.tier ?? null,
          semantic: null,
        };
        const hiringVerified = c.hiring_assessment?.verdict === "hiring_verified";

        if (c.fit.stage === "company_fit_pass") {
          c.brain = decideCompanyBrain({
            gates: gateInput,
            semantic: {
              business_model: "b2b_saas", company_fit: "pass", confidence: 0.8,
              agentory_use_case: "strong", supporting_evidence: ["deterministic gates passed"],
              conflicting_evidence: [], unknown_fields: [],
              reason: "all deterministic Company Brain gates passed",
            },
            policy: appliedPolicy, hiring_verified: hiringVerified,
          });
          if (c.brain.outcome === "QUALIFIED") {
            c.verdict = "pass";
            c.record = advance(c.record, "qualified_company", "hiring_signal_verified");
            passed++;
          } else if (c.brain.outcome === "REJECT") {
            c.verdict = "reject";
            c.record = advance(c.record, "company_fit_reject", c.brain.reason);
          } else {
            c.verdict = "unknown";
            unknown++;
            c.record.stage_reason = `company_brain_review:${c.brain.reason}`;
          }
          continue;
        }
        if (c.fit.stage === "company_fit_reject") {
          c.brain = decideCompanyBrain({
            gates: gateInput,
            semantic: {
              business_model: "unknown", company_fit: "fail", confidence: 0.9,
              agentory_use_case: "none", supporting_evidence: [],
              conflicting_evidence: c.fit.failed_gates, unknown_fields: [],
              reason: `deterministic hard gate failed: ${c.fit.reason}`,
            },
            policy: appliedPolicy, hiring_verified: hiringVerified,
          });
          c.verdict = "reject";
          c.record = advance(c.record, "company_fit_reject", c.fit.reason);
          c.record.failed_gates = c.fit.failed_gates;
          continue;
        }

        // ── UNKNOWN: RESOLVE, NEVER REJECT ──────────────────────────────────
        // A pending verdict means evidence was missing, not that the company was
        // unsuitable. Rejecting here is what destroyed Docusign, Outreach, Clay,
        // Sortly and Harmonic Security on the 2026-08-03 run while looking like
        // precision.
        const parsed = deps.classifyCompany
          ? await deps.classifyCompany({
            original_user_query: opts.mission.original_user_query,
            mission_verticals: opts.mission.company_profile?.verticals ?? [],
            mission_geography: opts.brain?.required_geography ?? null,
            workspace_industries: opts.brain?.positive_industries ?? [],
            company_name: src.company_name ?? null,
            yc_description: c.company.description ?? null,
            website_description: src.website ?? null,
            linkedin_description: c.enriched?.description ?? null,
            linkedin_industry: src.provider_industry ?? null,
            linkedin_industry_ids: (src.industry_ids ?? []).map((x) => x.name),
            employee_count: src.employee_count ?? null,
            employee_advisory: src.employee_range_advisory ?? null,
            geography: src.geography ?? null,
            commercial_signal: c.hiring_assessment?.strongest?.title ?? null,
            commercial_tier: c.hiring_assessment?.tier ?? null,
          })
          : null;
        c.semantic_parse = parsed;
        // The legacy `{verdict, reason}` view, DERIVED rather than requested, so
        // existing telemetry keeps working without a second live contract.
        const resolved = parsed
          ? {
            verdict: (parsed.assessment.company_fit === "pass" ? "pass"
              : parsed.assessment.company_fit === "fail" ? "fail" : "unknown") as
              "pass" | "fail" | "unknown",
            reason: parsed.assessment.reason,
          }
          : null;
        // THE CLASSIFIER'S OWN STRUCTURED ANSWER, not a re-synthesis of it.
        // A definitive answer resolves the fields it was asked about; only an
        // inconclusive one leaves them unknown.
        const semantic = parsed
          ? {
            ...parsed.assessment,
            unknown_fields: parsed.assessment.company_fit === "review"
              ? [...new Set([...parsed.assessment.unknown_fields, ...c.fit.missing_evidence])]
              : parsed.assessment.unknown_fields,
          }
          : null;
        c.brain = decideCompanyBrain({
          gates: gateInput, semantic, policy: appliedPolicy, hiring_verified: hiringVerified,
        });

        if (resolved && resolved.verdict === "pass" && c.brain.outcome === "QUALIFIED") {
          c.classification = { ...resolved, source: "semantic_classification" };
          c.verdict = "pass";
          c.record = advance(c.record, "qualified_company", "semantic_classification_pass");
          passed++;
        } else if (resolved && resolved.verdict === "fail") {
          c.classification = { ...resolved, source: "semantic_classification" };
          c.verdict = "reject";
          c.record = advance(c.record, "company_fit_reject", "semantic_classification_fail");
          c.record.failed_gates = c.fit.failed_gates;
        } else {
          c.classification = resolved
            ? { ...resolved, source: "semantic_classification" }
            : { verdict: "unknown", reason: "no classifier available", source: "unresolved" };
          // HELD, NOT REJECTED. The stage stays where the pipeline actually got
          // to; the verdict is what says the Brain could not decide.
          c.verdict = "unknown";
          c.record.stage_reason = `company_fit_pending:${c.fit.reason}`;
          c.record.missing_evidence.push(...c.fit.missing_evidence);
          unknown++;
        }
      }
      state.qualified_company_keys = companies.filter((c) => c.verdict === "pass").map((c) => c.key);
      state.unknown_company_keys = companies.filter((c) => c.verdict === "unknown").map((c) => c.key);

      finish(cap, "complete", passed, [], passed > 0,
        passed === 0
          ? `no company passed the Company Brain; ${unknown} held as unknown pending evidence`
          : null);
      await publish("qualified");
      continue;
    }

    // ── FOUNDER DISCOVERY ────────────────────────────────────────────────────
    if (cap === "founder_discovery") {
      const qualified = companies.filter((c) => c.verdict === "pass");
      if (qualified.length === 0) {
        finish(cap, "skipped_no_input", 0, [], false,
          "no qualified company — founder discovery has no input");
        continue;
      }
      // THE PEOPLE GATE. Company discovery, identity, enrichment, hiring
      // verification and a Brain PASS must ALL be behind us. Task
      // e8abeb8f-…-cfcbc6a416d4 bought five people against zero qualified
      // companies, off job-board rows, and nothing refused.
      assertPeopleProviderAllowed("apify_linkedin_company_employees", {
        completed_capabilities: state.completed_capabilities,
        qualified_company_keys: state.qualified_company_keys,
      });
      const used: string[] = [];
      const roles = opts.mission.decision_makers.roles;
      const perCompany = opts.foundersPerCompany ?? 3;
      let found = 0;
      for (const c of qualified) {
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url;
        if (!url) continue;
        used.push("apify_linkedin_company_employees");
        const compiled = compileHarvestCompanyEmployeesInput({
          companies: [url], jobTitles: roles, maxItems: perCompany,
          // Cheapest verified mode. Email-enrichment modes are forbidden by the
          // compiler, so this can never silently become a paid email lookup.
          profileScraperMode: COMPANY_EMPLOYEES_SCRAPER_MODES[0],
        });
        let rows = await callProvider(cap, "apify_linkedin_company_employees", compiled);
        if (rows.length === 0) {
          // FALLBACK WITHIN THE CAPABILITY. Approved provider, same question.
          const ex = onCapabilityExhausted(opts.plan, cap, ["apify_linkedin_company_employees"]);
          if (ex.status === "provider_fallback_available" && ex.next_provider === "apify_people_search") {
            used.push("apify_people_search");
            const fb = compileHarvestProfileSearchInput({
              currentCompanies: [url], currentJobTitles: roles, maxItems: perCompany,
              profileScraperMode: PROFILE_SEARCH_SCRAPER_MODES[0],
            });
            rows = await callProvider(cap, "apify_people_search", fb);
          }
        }
        c.founders = dedupePeople(rows.map((r) => normalizeHarvestPerson(r, "capability_engine")));
        if (c.founders.length > 0) {
          c.record = advance(c.record, "founder_pending", "candidates_returned");
          found += c.founders.length;
        }
      }
      finish(cap, "complete", found, [...new Set(used)], found > 0,
        found === 0 ? "no decision-maker candidates were returned" : null);
      continue;
    }

    // ── EMPLOYER VERIFICATION ────────────────────────────────────────────────
    if (cap === "employer_verification") {
      let verified = 0;
      for (const c of companies) {
        if (c.founders.length === 0) continue;
        const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url ?? "";
        c.verified_founders = c.founders.filter((p) => deps.verifyEmployer(p, url).verified);
        if (c.verified_founders.length > 0) {
          c.record = advance(c.record, "founder_verified", "current_employer_verified");
          verified += c.verified_founders.length;
        } else {
          c.record = advance(c.record, "founder_mismatch", "no_current_employer_match");
        }
      }
      finish(cap, "complete", verified, [], verified > 0,
        verified === 0 ? "no decision-maker was verified at their company" : null);
      await publish("decision_makers_verified");
      continue;
    }

    // ── CONTACT ENRICHMENT ───────────────────────────────────────────────────
    if (cap === "contact_enrichment") {
      let contactReady = 0;
      for (const c of companies) {
        for (const p of c.verified_founders) {
          const identity = p.linkedin_url ?? p.source_profile_id ?? null;
          if (!identity) continue;
          c.contact_identities.push(identity);
          contactReady++;
        }
        if (c.contact_identities.length > 0) {
          c.record = advance(c.record, "contact_pending", "contact_method_present");
        }
      }
      state.contact_identities = [...new Set(companies.flatMap((c) => c.contact_identities))];
      finish(cap, "complete", contactReady, [], contactReady > 0,
        contactReady === 0 ? "no verified decision-maker had a contact method" : null);
      continue;
    }

    // ── PERSISTENCE ──────────────────────────────────────────────────────────
    if (cap === "persistence") {
      finish(cap, "complete", state.contact_identities.length, [], true, null);
      continue;
    }

    finish(cap, "skipped_no_input", 0, [], false, `unhandled capability: ${cap}`);
  }

  if (state.pending_capabilities.length === 0 && state.terminal_reason === null) {
    state.terminal_reason = "capability_plan_complete";
  }

  return {
    state,
    companies,
    resume_records: companies.map(toResumeRecord),
    funnel: projectFunnel(companies.map((c) => c.record)),
    capability_outcomes: outcomes,
  };
}

/**
 * Where did this company individually get to?
 *
 * The audited run recorded progress per CAPABILITY only, so a resume could not
 * tell that SnapMagic's identity and enrichment were already paid for. This is
 * the per-company record a continuation reads.
 */
export function toResumeRecord(c: EngineCompany): CompanyResumeRecord {
  const url = c.identity?.linkedin_company_url ?? c.company.linkedin_company_url ?? null;
  return {
    company_key: c.key,
    company_name: c.prequalified?.name ?? c.company.company_name ?? c.key,
    identity: c.identity === null ? "not_started"
      : identityIsActionable(c.identity) ? "resolved"
      : c.identity.status === "mismatch" ? "mismatch" : "unresolved",
    enrichment: c.enriched !== null ? "completed"
      : c.identity && identityIsActionable(c.identity) ? "not_started" : "not_required",
    hiring: !c.hiring_assessment ? "not_started"
      : c.hiring_assessment.verdict === "hiring_verified"
        ? (c.hiring_assessment.evidence_source === "external_job_search"
          ? "verified_externally" : "verified_from_existing_evidence")
      : c.hiring_assessment.verdict === "hiring_verification_needed" ? "verification_needed"
      : c.hiring_assessment.verdict === "watch" ? "verification_needed"
      : "not_verified",
    brain: !c.brain ? "not_started"
      : c.brain.outcome === "QUALIFIED" ? "qualified"
      : c.brain.outcome === "REVIEW" ? "review" : "rejected",
    founder: c.verdict !== "pass" ? "not_eligible"
      : c.verified_founders.length > 0 ? "completed"
      : c.founders.length > 0 ? "unresolved" : "not_started",
    linkedin_company_url: url,
    completed_operations: c.completed_operations,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Project the engine's working set into portfolio candidates.
 *
 * The portfolio module has existed and been tested since the previous change and
 * nothing consumed it, so a request for 100 still ran the old quota path. This
 * is the adapter that makes it real: one candidate per company, carrying the
 * explicit Brain outcome, the canonical identity state and the commercial tier.
 */
export function toPortfolioCandidates(
  companies: readonly EngineCompany[],
): PortfolioCandidate[] {
  return companies
    .filter((c) => c.prequalified !== null)
    .map((c) => {
      const pq = c.prequalified!;
      const identity: PortfolioCandidate["identity_status"] =
        c.identity && identityIsActionable(c.identity) ? "verified_match"
        : c.identity?.status === "mismatch" ? "rejected_mismatch"
        : "unresolved";
      const brain: PortfolioCandidate["brain"] =
        c.brain?.outcome === "QUALIFIED" ? "qualified"
        : c.brain?.outcome === "REVIEW" ? "review"
        : c.brain?.outcome === "REJECT" ? "reject"
        : null;
      return {
        company_key: c.key,
        company_name: pq.name,
        domain: pq.canonical_domain,
        tier: c.hiring_assessment?.tier ?? pq.best_tier,
        brain,
        identity_status: identity,
        active: true,
        // Geography and B2B relevance are decided by the Brain's own gates; the
        // floor only re-checks what it can see here.
        geography_ok: true,
        b2b_use_case: c.brain ? c.brain.outcome !== "REJECT" : true,
        has_factual_signal: (c.hiring_assessment?.commercial_jobs.length ?? 0) > 0 ||
          pq.best_tier !== null,
        source_evidence: !!pq.yc_url || !!pq.canonical_domain,
        source_url: pq.yc_url ?? (pq.canonical_domain ? `https://${pq.canonical_domain}` : null),
        contact_ready: c.contact_identities.length > 0,
        round: c.hiring_assessment?.strongest?.round ?? null,
        score: pq.score,
      };
    });
}

/**
 * The progress snapshot to persist once the invocation has ENDED.
 *
 * TEST task 41342269 finished with seven capabilities still pending — a
 * legitimate partial result — and its last published snapshot said
 * `in_progress: true`. Anything reading that field would have shown "Sourcing in
 * progress" forever on a workflow that had already stopped.
 *
 * PENDING CAPABILITIES ARE NOT ACTIVITY. The only thing that still counts as
 * "waiting" after the invocation returns is a BILLED Actor run that has not been
 * read, because that one really does have work happening elsewhere.
 */
export function finalizedProgress(
  state: CapabilityExecutionState,
): EngineProgress | null {
  if (!state.progress) return null;
  return {
    ...state.progress,
    in_progress: false,
    awaiting_external_run: state.pending_runs.length > 0,
  };
}

/**
 * How many LinkedIn company URLs go into one company-details request.
 *
 * The Actor accepts a list; this is the batch bound, not a per-company loop.
 */
export const COMPANY_DETAILS_BATCH_SIZE = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * `stop` is checked before each item is CLAIMED, so a closed deadline ends the
 * stage without abandoning work already in flight. Deliberately not
 * `Promise.all` over everything: a shortlist of five resolved all at once is
 * five simultaneous paid Actor starts, which is precisely the burst this
 * mission's budget cannot absorb.
 */
export async function runBounded<T>(
  items: readonly T[], limit: number,
  worker: (item: T) => Promise<void>,
  stop: () => boolean = () => false,
): Promise<{ processed: number; skipped: number }> {
  let next = 0;
  let processed = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const lanes = Array.from({ length: width }, async () => {
    for (;;) {
      if (stop()) return;
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
      processed++;
    }
  });
  await Promise.all(lanes);
  return { processed, skipped: items.length - processed };
}

/**
 * Score the discovered rows and decide the shortlist — no provider, no cost.
 *
 * Attaches the verdict to each working-set company AND records it on the state,
 * because "why was this company not pursued?" must be answerable from the task
 * row alone.
 */
export function applyPrequalification(
  state: CapabilityExecutionState,
  companies: EngineCompany[],
  rawRows: readonly YcCompanyInput[],
  size: { min: number | null; max: number | null },
  requestedLeadCount: number,
): PrequalificationResult {
  const result = prequalifyYcCompanies(rawRows, { min: size.min, max: size.max });
  const shortlist = shortlistForLinkedInResolution(result, requestedLeadCount);
  const shortlistKeys = new Set(shortlist.map((c) => c.company_key));
  const byKey = new Map(result.companies.map((c) => [c.company_key, c]));

  for (const c of companies) {
    const pq = c.prequal_key ? byKey.get(c.prequal_key) ?? null : null;
    c.prequalified = pq;
    c.shortlisted = pq !== null && shortlistKeys.has(pq.company_key);
  }

  // SCRAPER ARTIFACTS LEAVE THE WORKING SET ENTIRELY.
  //
  // The five empty rows memo23 returns all normalize to the same fallback key
  // (`yc_memo23:unknown`), so the engine's own dedupe collapsed them into ONE
  // company that prequalification had already refused to score. It could never
  // be paid for — but it counted as an account found and would have reached
  // persistence, which is how Y Combinator's own page once became a qualified
  // lead. A row with no name and no website is not a prospect.
  for (let i = companies.length - 1; i >= 0; i--) {
    if (companies[i].prequalified === null) companies.splice(i, 1);
  }

  state.prequalification = {
    version: result.version,
    total_rows: result.total_rows,
    unique_companies: result.unique_companies,
    artifacts_excluded: result.excluded.length,
    eligible_companies: result.eligible_companies,
    employee_size_excluded: result.employee_size_excluded,
    technical_only_companies: result.technical_only_companies,
    open_jobs_evaluated: result.companies.reduce((n, c) => n + c.jobs.length, 0),
    shortlist_keys: shortlist.map((c) => c.company_key),
    companies: result.companies.map((c) => ({
      company_key: c.company_key,
      name: c.name,
      canonical_domain: c.canonical_domain,
      team_size: c.team_size,
      size_status: c.size_status,
      best_tier: c.best_tier,
      score: c.score,
      strongest_signal: c.strongest_signal,
      // EVERY commercial job, not `openJobs[0]` — which for a YC startup is
      // almost always an engineer, and is what the old display showed.
      commercial_jobs: c.jobs.filter((j) => j.tier === "A" || j.tier === "B" || j.tier === "C")
        .map((j) => j.title),
      eligible: c.eligible,
      exclusion: c.exclusion,
      shortlisted: shortlistKeys.has(c.company_key),
      reasons: c.reasons,
    })),
  };
  return result;
}

/** Union of jobs kept by ANY approved pack. `filterJobsForPack` takes one pack. */
function keptForPacks(
  jobs: readonly NormalizedHiringJob[], packs: readonly RolePack[],
): NormalizedHiringJob[] {
  const out: NormalizedHiringJob[] = [];
  for (const pack of packs) {
    for (const j of filterJobsForPack(jobs, pack).kept) out.push(j);
  }
  return out;
}

function packTitles(packs: readonly RolePack[]): string[] {
  return [...new Set(packs.flatMap((p) => p.titles))].slice(0, 20);
}

function addCompany(
  set: EngineCompany[], c: NormalizedHiringCompany, ycJobs: NormalizedHiringJob[],
  prequalKey: string | null = null,
): void {
  const key = companyKey(c);
  if (set.some((x) => x.key === key)) return;
  set.push({
    key, prequal_key: prequalKey, prequalified: null, shortlisted: false,
    company: c, identity: null, enriched: null,
    yc_open_jobs: ycJobs, hiring_jobs: [], fit: null, hiring_assessment: null,
    brain: null, semantic_parse: null, completed_operations: [],
    classification: null, verdict: null,
    founders: [], verified_founders: [], contact_identities: [],
    record: newCompanyRecord(key),
  });
}

// ------------------------------------------------------- persistence bridge ----

/**
 * Adapt an engine run onto the shape the EXISTING persistence projection reads.
 *
 * Deliberately an adapter and not a second projection: `persistPlan` owns
 * accounts, contacts, lead_candidates and the contact-enrichment handoff, and
 * duplicating any of that to suit a new executor is how two write paths start
 * disagreeing about what a lead is. The engine supplies plans; persistence
 * stays exactly where it was.
 */
export function toRouteResultShape(run: CapabilityRunResult): {
  executed_source_order: string[];
  companies: Array<{
    record: CompanyRecordState;
    company: NormalizedHiringCompany;
    identity: IdentityResolution;
    enriched: NormalizedHiringCompany | null;
    hiring_jobs: NormalizedHiringJob[];
    founders: NormalizedHiringPerson[];
  }>;
  funnel: FunnelCounts;
} {
  const executed = [...new Set(
    run.state.provider_attempts
      .filter((a) => a.outcome === "ok" || a.outcome === "empty")
      .map((a) => a.provider),
  )];
  return {
    executed_source_order: executed,
    companies: run.companies.map((c) => ({
      record: c.record,
      company: c.company,
      // The projection reads identity unconditionally, so an unresolved company
      // carries an explicit unresolved identity rather than a null it would
      // dereference.
      identity: c.identity ?? {
        company_key: c.key, status: "unresolved",
        linkedin_company_url: c.company.linkedin_company_url ?? null,
        evidence: ["identity_resolution_did_not_run"], ambiguous_candidates: [],
      },
      enriched: c.enriched,
      hiring_jobs: c.hiring_jobs,
      // Only VERIFIED people are offered for persistence. An unverified founder
      // is a candidate, not a lead.
      founders: c.verified_founders,
    })),
    funnel: run.funnel,
  };
}

// --------------------------------------------------------------- preflight ----

/**
 * Compile the FIRST paid call without invoking it.
 *
 * The preflight has to validate the exact input that will be sent, and the only
 * honest way to do that is to compile it with the same compiler the engine uses.
 * On TEST task e8abeb8f-…-cfcbc6a416d4 the memo23 call was rejected by Apify with
 * `apify_input_schema_error` and the run treated that as "no candidates" — an
 * invalid input and an empty result are not the same thing, and only one of them
 * means the source was actually asked.
 */
export function compileFirstProviderCall(
  plan: CapabilityPlan, opts: Partial<CapabilityEngineOpts> = {},
): { provider: string | null; compiled: CompileResult<unknown> | null } {
  const step = plan.steps[0];
  if (!step) return { provider: null, compiled: null };
  const provider = step.providers[0] ?? null;
  if (!provider) return { provider: null, compiled: null };
  const maxCandidates = opts.maxCandidates ?? 50;

  if (provider === "apify_yc_companies_memo23") {
    return {
      provider,
      compiled: compileMemo23YcInput({
        mode: "companies",
        queries: [],
        topCompany: false,
        nonprofit: false,
        batch: ["All Batches"],
        regions: opts.ycRegions ?? ["United States of America"],
        industries: opts.ycIndustries ?? ["B2B"],
        isHiring: true,
        // THE CLOSEST BROAD FILTER, NOT THE TARGET RANGE. The mission wants
        // 10-150; the Actor's size options are fixed enums and 150 is not one of
        // them, so discovery casts to 10+ .. 500 and the exact 10-150 bound is
        // enforced later from ENRICHED headcount. Narrowing here to "100" would
        // silently drop every 100-150 company.
        minEmployeeSize: opts.ycMinSize ?? MEMO23_DEFAULT_MIN_SIZE,
        maxEmployeeSize: opts.ycMaxSize ?? MEMO23_DEFAULT_MAX_SIZE,
        scrapeOpenJobs: true,
        scrapeFounderDetails: false,
        enrichEmails: false,
        maxItems: maxCandidates,
      }) as CompileResult<unknown>,
    };
  }
  // Other entry providers are not engine-driven yet; the preflight records the
  // provider and leaves validation to the capability that owns it.
  return { provider, compiled: null };
}
