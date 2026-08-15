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
  prequalificationKey, prequalifyYcCompanies,
  type PrequalificationResult, type PrequalifiedCompany, type YcCompanyInput,
} from "./leadCommercialPrequalification.ts";
import {
  buildQualificationContext, resolveEmployeeBounds, qualificationContextSummary,
  resolveBrainAuthority,
  type QualificationContext,
} from "./missionQualificationContext.ts";
import {
  buildMissionEvaluationInput, notEvaluated,
  type MissionEvaluation, type MissionEvaluationInput,
  type ParsedMissionEvaluation, type DecisionSource,
} from "./missionEvaluation.ts";
import {
  asEnrichmentOutcome, enrichmentIsEvidence, enrichmentIsTerminal,
  summariseEnrichmentOutcomes, type EnrichmentOutcome,
} from "./leadEnrichmentState.ts";
import {
  buildMissionFunnel, type FunnelCompany, type MissionFunnel,
} from "./leadMissionFunnel.ts";
import type { ExecutionDeadline } from "./leadExecutionFinalizer.ts";
import {
  TIER_A_TITLES, TIER_B_TITLES, assessHiring, needsPaidJobVerification,
  reachesCompanyBrain, type HiringAssessment, type SupportingSignal,
} from "./commercialSignalPolicy.ts";
import {
  applyMissionPrecedence, decideCompanyBrain,
  type BrainDecision,
} from "./companyBrainSemanticFit.ts";
import type { PortfolioCandidate } from "./opportunityPortfolio.ts";
import {
  buildEvidenceRegistry, type EvidenceRegistry,
} from "./leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "./leadCompanyEvidence.ts";
import type { GroundedVerification } from "./groundedClaims.ts";
import {
  buildEligiblePool, type EligiblePool,
} from "./leadEligiblePool.ts";
import {
  planBatches, resolveBatchLimits,
  type BatchLimits, type BatchMember, type BatchResult,
} from "./groundedBatchEvaluation.ts";
import {
  applyPortfolioPolicy, buildCandidateSummary, validatePoolRanking,
  deterministicRanking, buildRankingShadowComparison,
  type GroundedCandidateSummary, type PortfolioDelivery, type ValidatedRanking,
  type RankingShadowComparison,
} from "./poolRanking.ts";
import { poolFingerprintOf } from "./poolCheckpoint.ts";
import {
  CHECKPOINT_RESERVE_MS, inputFingerprint, MAX_SNAPSHOT_JOBS, providerOperationKey,
  shouldCheckpoint, shouldSkipProviderCall, type CompanyResumeRecord,
} from "./leadResumeState.ts";
import {
  buildMissionTriageInput, parseMissionTriageStrict, summariseTriage, TRIAGE_BATCH_SIZE,
  triageBatches, uncertainVerdict,
  type MissionTriageInput, type TriageCompanyInput, type TriageVerdict,
} from "./missionTriage.ts";
import {
  asInvestigationState, buildSmartShortlist, identityStopThreshold,
  resolveMaxPasses,
  isFrontier, resolveGptBudget, resolveInvestigationBudget, resolveTimeCapacity,
  resolveTriageConcurrency, resolveUntriagedPolicy, selectInvestigationSlice,
  shouldTakeAnotherSlice,
  wasInvestigated,
  type GptBudget, type InvestigationBudget, type InvestigationState,
  type TimeCapacity,
} from "./leadInvestigationBudget.ts";
import {
  dedupeJobs, dedupePeople, normalizeHarvestPerson,
  normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched,
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
import { effectiveRequestedCount, missionHash, type LeadMissionV1 } from "./leadMission.ts";

/**
 * The PAID stages a new investigation slice must re-run.
 *
 * Discovery is deliberately absent: the pool is discovered once and the
 * frontier is a cursor over it, so another pass costs no discovery. Persistence
 * is absent because it runs once at the end over everything that qualified.
 */
const INVESTIGATION_CAPABILITIES: readonly CapabilityId[] = [
  "company_identity_resolution", "company_enrichment",
  "hiring_verification", "company_brain_qualification",
];

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
    | "skipped_deadline"
    /**
     * A previous invocation already bought this exact answer, or already gave up
     * on this company. Costs nothing and is not a failure.
     */
    | "skipped_resume_reuse";
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
  /** The vocabulary's OPINION. Ranking only — it excludes nobody. */
  eligible: boolean;
  exclusion: PrequalifiedCompany["exclusion"];
  // `shortlisted` DELETED. Prequalification does not decide the shortlist, so
  // recording its guess here produced a second, contradictory answer to "was
  // this company investigated?" — one that `applyMissionIntelligence` had
  // already overwritten on the working set. `state.shortlist_decision` is the
  // single record.
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
    // `shortlist_keys` DELETED. Prequalification no longer decides the
    // shortlist; `state.shortlist_decision` is the single record of who was
    // investigated and why. Reporting both let the run name one set of
    // companies and pay for another.
    companies: PrequalificationRecord[];
  } | null;
  /**
   * STAGE 2 counts — how many companies GPT read, and what it said.
   *
   * Null when Mission Intelligence did not run, which is a different fact from
   * "it ran and found nothing relevant". Both must be answerable from the task
   * row alone.
   */
  triage: Record<string, number> | null;
  /**
   * STAGE 3 — the budget that was authorised and how the shortlist was chosen.
   *
   * `budget.source` is the field that says WHY the number was what it was:
   * `default`, an operator's `environment` override, the Stage 2 ceiling, or
   * simply the size of the pool.
   */
  shortlist_decision: {
    /**
     * THE PER-PASS SPEND ALLOWANCE — what one investigation slice may buy.
     *
     * Not the number handed to `buildSmartShortlist`. That call is deliberately
     * given the whole pool so it ranks without excluding anyone, and recording
     * ITS budget here reported the pool size as though it were the spend.
     */
    budget: InvestigationBudget;
    /**
     * POOL COMPOSITION from the ranking pass: how many were hard-excluded, how
     * many each triage verdict, how many ranked. `counts.selected` is a
     * property of THAT call and equals `ranked` — it is not the spend. Read
     * `investigation_selected` for what was actually authorised.
     */
    counts: Record<string, number>;
    ranking: string[];
    /** How untriaged candidates were treated. See `UntriagedPolicy`. */
    untriaged_policy: string;
    /** What the wall clock allowed. Null when the run had no deadline. */
    time_capacity: TimeCapacity | null;
    /** The CHEAP budget, sized independently of the paid one. */
    gpt_budget: GptBudget;
  } | null;
  /**
   * THE FULL RANKED POOL, persisted so a continuation can resume the frontier.
   *
   * The ranking is decided once by GPT triage. Every later pass and every later
   * invocation is a cursor over THIS list, which is why the shortlist can be
   * re-entrant without ever re-triaging or re-deciding.
   */
  investigation_ranking: string[];
  /**
   * COMPANIES AUTHORISED FOR PAID INVESTIGATION by this invocation, summed
   * over every pass. This — not the ranking's `counts.selected` — is what
   * "how many did the run shortlist?" means, and it lives on the state rather
   * than inside `shortlist_decision` because a continuation skips discovery
   * and so has no shortlist decision of its own, yet still buys slices.
   */
  investigation_selected: number;
  /** One entry per slice taken. "Why only ten?" is answerable from this. */
  investigation_slices: Array<{
    pass: number;
    selected: number;
    /**
     * Companies this pass inherited already `in_flight` from a previous
     * invocation. They spend the same allowance, so `selected` is reduced by
     * this much — recorded so a small slice is explainable.
     */
    carried: number;
    remaining: number;
    investigated: number;
    excluded: number;
    reason: string;
  }>;
  /**
   * The wall-clock capacity that bounded paid investigation.
   *
   * Surfaced at the top level too, because "the clock, not the config" is the
   * commonest reason a run investigates fewer companies than it authorised and
   * it should not require digging into the shortlist decision to find out.
   */
  investigation_capacity: TimeCapacity | null;
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
    triage: null,
    shortlist_decision: null,
    investigation_ranking: [],
    investigation_selected: 0,
    investigation_slices: [],
    investigation_capacity: null,
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

/**
 * HOW THIS COMPANY'S VERDICT WAS ACTUALLY REACHED.
 *
 * PHASE 0 INSTRUMENTATION, AND IT MEASURES THE THING THE AUDIT COULD NOT.
 *
 * `capability_outcomes` reported `company_brain_qualification: {status:"complete",
 * rows:0, reason:"no company passed the Company Brain"}` for a run in which the
 * Brain's eligible set was EMPTY. "Nobody passed" and "nobody was offered" are
 * different facts and the artifact could not tell them apart, so a scheduling
 * gap read as twenty rejections.
 *
 * These five values are mutually exclusive and total: every company carries
 * exactly one, and `not_reached` is the honest answer for a company the gate
 * never saw. Nothing here CHANGES a decision — it records which code made it.
 *
 *   not_reached        never entered the Brain's eligible set
 *   fabricated_pass    `company_fit_pass` — verdict from a hardcoded assessment
 *   fabricated_reject  `company_fit_reject` — verdict from a hardcoded assessment
 *   model_evaluated    a classifier response was parsed and used
 *   model_unavailable  the pending branch was reached with no usable classifier
 */
export type EvaluationPath =
  | "not_reached"
  | "fabricated_pass"
  | "fabricated_reject"
  | "model_evaluated"
  | "model_unavailable";

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
  /**
   * The GPT triage verdict — Stage 2, free, discovery-data only.
   *
   * Null when Mission Intelligence did not run. NOT a qualification: it answers
   * "worth paying to investigate?" and its vocabulary
   * (relevant/uncertain/irrelevant) is deliberately disjoint from the
   * evaluator's, so the two can never be read as the same answer.
   */
  triage: TriageVerdict | null;
  /**
   * Why this company did not make the shortlist.
   *
   * `triage_irrelevant`, `prequalification_ineligible` and `budget_exhausted`
   * are different facts. The last one especially: that company was never judged
   * at all, and rendering it as "not qualified" is the lie this field exists to
   * prevent.
   */
  shortlist_exclusion: string | null;
  /**
   * WHERE THIS COMPANY SITS IN THE INVESTIGATION FRONTIER.
   *
   * `shortlisted` is now DERIVED from this — see `wasInvestigated`. The boolean
   * could only say in-or-out, and "out" was indistinguishable between "GPT said
   * irrelevant" and "the budget stopped at ten". The first is a decision and
   * closes the company; the second is a queue position and must survive to the
   * next pass. Conflating them is what stranded 90 of 100 companies while the
   * checkpoint reported them pending forever.
   */
  investigation_state: InvestigationState;
  /** Position in the persisted triage ranking. Lower is investigated first. */
  investigation_rank: number;
  company: NormalizedHiringCompany;
  identity: IdentityResolution | null;
  /**
   * WHY THIS COMPANY HAS NO ANSWER FOR A STAGE — when the reason is the run,
   * not the company.
   *
   * Set by `callProvider` when a call for this company was skipped by the
   * checkpoint reserve (`deferred`) or failed outright (`provider_error`).
   * Both return an empty result, and an empty result is indistinguishable from
   * a genuine "nothing matched" unless something records the difference. This
   * is that record.
   *
   * `capability` scopes it, so an enrichment failure can never be misread as an
   * identity outcome. Null means every call this company made was answered.
   */
  stage_block: { capability: CapabilityId; reason: "deferred" | "provider_error" } | null;
  enriched: NormalizedHiringCompany | null;
  /**
   * WHAT HAPPENED WHEN ENRICHMENT WAS ATTEMPTED — explicitly, not inferred.
   *
   * `enriched === null` conflates four outcomes: the provider answered and had
   * nothing, the call failed, the call was never started, and the company never
   * reached the stage. Only the first is about the company; the rest are about
   * the run. Qualification already holds an unenriched company rather than
   * rejecting it, and this is the field that lets every OTHER consumer — the
   * checkpoint, the Workbench — tell those four apart instead of rendering all
   * of them as the same absence.
   */
  enrichment_outcome: EnrichmentOutcome;
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
  // `semantic_parse` DELETED with the second evaluator that populated it.
  /** Stable keys of provider operations already completed for this company. */
  completed_operations: string[];
  /** The canonical evidence registry, built at qualification time. */
  evidence_registry: EvidenceRegistry | null;
  /** What survived verification against that registry. Null when not grounded. */
  grounded: GroundedVerification | null;
  /** Set when the Brain returned UNKNOWN and evidence resolution was attempted. */
  classification: { verdict: "pass" | "fail" | "unknown"; reason: string; source: string } | null;
  /** WHICH CODE DECIDED. Observability only — never read by a decision. */
  evaluation_path: EvaluationPath;
  /**
   * WHY this company ended where it did, in the vocabulary the Workbench needs.
   *
   * `not_evaluated` and `not_qualified` are different answers and the UI must
   * never render the first as the second.
   */
  decision_source: DecisionSource;
  /** The evaluator's structured answer. Null until qualification runs. */
  mission_evaluation: MissionEvaluation | null;
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

/**
 * What triage is allowed to see: discovery-time data, and nothing else.
 *
 * NO IDENTITY, NO ENRICHMENT — not because they are unavailable (triage runs
 * before both) but because the contract must stay true if that ever changes. A
 * stage that decides where to spend must judge on what is free; letting it read
 * paid evidence would make the decision circular.
 *
 * ROLE TITLES GO OUT VERBATIM. Passing the prequalifier's classified subset
 * would hand the model the same keyword filter this stage exists to replace.
 */
function toTriageInput(c: EngineCompany): TriageCompanyInput {
  const p = c.prequalified;
  return {
    company_key: c.key,
    name: p?.name ?? c.company.company_name ?? null,
    domain: c.company.canonical_domain ?? null,
    description: p?.one_liner ?? c.company.description ?? null,
    industries: c.company.provider_industry ? [c.company.provider_industry] : [],
    employee_count: p?.team_size ?? c.company.employee_count ?? null,
    location: p?.locations ?? c.company.geography ?? null,
    open_roles: (c.yc_open_jobs ?? []).map((j) => j.title).filter(Boolean) as string[],
  };
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
   * DOES THIS COMPANY SATISFY THE MISSION? — THE deciding call, and the only one.
   *
   * The pre-Phase-4 semantic classifier used to sit
   * beside this as a second semantic authority. It has been DELETED: the
   * inversion had already stripped its verdict, leaving a paid model call per
   * company that populated telemetry and decided nothing.
   *
   * This is consulted for EVERY company that reaches qualification, and its
   * answer outranks the deterministic fit. Deterministic code keeps the facts
   * it can actually falsify — identity, aggregator, excluded industry — and
   * hands everything else to the evaluator as evidence.
   *
   * Absent, or returning null, the company is held as INSUFFICIENT EVIDENCE and
   * reported as never evaluated. It is never converted into a rejection for
   * want of a model.
   */
  /**
   * STAGE 2 — GPT MISSION INTELLIGENCE, batched and free-tier.
   *
   * Absent, no triage runs and the deterministic prequalification verdict
   * stands, exactly as before. Present, its verdicts decide who is worth paying
   * for — but never whether anyone QUALIFIES, which is the evaluator's alone.
   *
   * A null return, a throw or an unparseable response all degrade the affected
   * batch to `uncertain`. Nothing a failure here does may exclude a company.
   */
  triageCompanies?: (i: {
    input: MissionTriageInput;
    company_keys: string[];
  }) => Promise<unknown>;
  /** Batches this task may pay for. Defaults to "as many as the pool needs". */
  triageBatchesAllowed?: number;
  triageBatchSize?: number;
  evaluateMission?: (i: {
    input: MissionEvaluationInput;
    registry: EvidenceRegistry;
    company_key: string;
  }) => Promise<ParsedMissionEvaluation | null>;
  /**
   * THE GROUNDED SECOND OPINION, built from this company's own evidence.
   *
   * The engine assembles the canonical registry — it is the only layer holding
   * the discovery row, the enriched row and the job evidence together — and
   * hands it over already built, so nothing above has to reconstruct it and no
   * model-written text can enter it.
   *
   * Null when the flag is off. A null RETURN means "not grounded", which holds
   * the company for review; it never becomes a rejection.
   */
  groundCompany?: (i: {
    registry: EvidenceRegistry;
    requiresCommercialSignal: boolean;
    company_key: string;
  }) => Promise<GroundedVerification | null>;
  /**
   * `shadow` observes and records; `enforce` lets the verified verdict decide.
   *
   * Defaulting to `shadow` is deliberate: a missing or misspelled mode must not
   * be able to change what qualifies.
   */
  groundingMode?: "shadow" | "enforce";
  /**
   * STAGE 2 — evaluate a whole batch of companies in one call.
   *
   * Present only when full-pool evaluation is enabled for this workspace. Its
   * presence is what switches the engine from "judge each company as it
   * arrives" to "collect the set, gate it for free, then evaluate in bounded
   * batches". Absent, every line of the previous path runs unchanged.
   */
  evaluateBatch?: (batch: readonly BatchMember[]) => Promise<BatchResult | null>;
  /** Server-resolved and clamped. Never supplied by a client. */
  batchLimits?: BatchLimits;
  /** Grounded results a previous invocation already paid for, by company key. */
  restoredGroundedResults?: Map<string, GroundedVerification>;
  /**
   * The eligible-set fingerprint those restored results were computed over.
   *
   * Compared against this run's own set at ranking time. Absent or null means
   * UNKNOWN composition, which is reported as such — never as "unchanged".
   */
  restoredPoolFingerprint?: string | null;
  /** Called after each completed batch so the caller can checkpoint. */
  onBatchComplete?: (i: {
    evaluated: Array<{ company_key: string; verification: GroundedVerification }>;
    next_offset: number;
    /** This run's eligible set, so the checkpoint records what it evaluated. */
    pool_fingerprint: string;
  }) => void | Promise<void>;
  /** STAGE 2 — compare the evaluated pool. Null/absent ⇒ deterministic order. */
  rankPool?: (i: {
    summaries: readonly GroundedCandidateSummary[];
    requestedCount: number;
    unevaluatedCount: number;
  }) => Promise<ValidatedRanking | null>;
  /**
   * `shadow` computes the ranking and records what it WOULD have changed;
   * `enforce` lets it decide the order the user sees.
   *
   * Defaults to `shadow` for the same reason `groundingMode` does: a missing or
   * misspelled mode must never be able to reorder what somebody calls today.
   * Note that this gates the RANKING'S AUTHORITY, not whether it runs — a
   * shadow mode that computes nothing observes nothing.
   */
  rankingMode?: "shadow" | "enforce";
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
    /**
     * RICHER ICP, for the evaluator only.
     *
     * Optional so every existing caller and test is unaffected. These never
     * reach a deterministic gate — `resolveBrainAuthority` files them as
     * preferences, and preferences may only move the score.
     */
    business_models?: string[];
    buyer_roles?: string[];
    target_signals?: string[];
    disqualifier_keywords?: string[];
  };
  /**
   * The workspace's own plain-English qualification rules.
   *
   * `company_brain.profile.icp.qualification_rules` — `reject_if`,
   * `manual_review_if`, `required_evidence`. Written by the user, read by
   * nothing in the qualification path until now. Handed to the evaluator as
   * context, never compiled into a gate.
   */
  brainQualificationRules?: {
    reject_if?: string[];
    manual_review_if?: string[];
    required_evidence?: string[];
  } | null;
  /**
   * Env reader for the investigation budget. Injected so budget behaviour is
   * testable without a process environment, and so a run can be given an
   * explicit budget rather than inheriting the deployment's.
   */
  readEnv?: (key: string) => string | undefined;
  maxCandidates?: number;
  rolePacks?: readonly RolePack[];
  postedLimit?: "1h" | "24h" | "week" | "month";
  ycRegions?: string[];
  ycIndustries?: string[];
  ycMinSize?: string;
  ycMaxSize?: string;
  solidcodeTeamSizes?: string[];
  foundersPerCompany?: number;
  /**
   * The scope that makes a provider call identifiable across invocations, plus
   * whatever a PREVIOUS invocation of this same mission already paid for.
   *
   * SUPPLIED ON EVERY RUN, not only on a continuation. The scope is what gives a
   * call a stable operation key; the key is what a later run reads. A first run
   * therefore carries the scope with an EMPTY `records` — it skips nothing, and
   * it writes the ledger the next run consults. Omitting the scope until records
   * exist would mean no run ever wrote one.
   *
   * `lineage_root_task_id` must be the SAME value for every invocation in a
   * chain; see `lineageRootTaskId`. A per-task value here would silently turn
   * every operation key into a new question and re-buy the lot.
   *
   * Omitted entirely, the engine behaves exactly as it did before this option
   * existed.
   */
  resume?: {
    workspace_id: string;
    lineage_root_task_id: string;
    records: readonly CompanyResumeRecord[];
  };
}

export interface CapabilityRunResult {
  state: CapabilityExecutionState;
  companies: EngineCompany[];
  funnel: FunnelCounts;
  /** Per-company stage state, so a resume continues where each one stopped. */
  resume_records: CompanyResumeRecord[];
  /** STAGE 2 output. Null when full-pool evaluation was not enabled. */
  pool: {
    eligible: EligiblePool["metrics"];
    excluded: EligiblePool["excluded"];
    summaries: GroundedCandidateSummary[];
    /** What ordered the delivery. Deterministic whenever the mode is shadow. */
    ranking: ValidatedRanking;
    ranking_mode: "shadow" | "enforce";
    /** What enforcing would have changed. Null under enforce — it did it. */
    ranking_shadow: RankingShadowComparison | null;
    /** Of the eligible set, computed after discovery. */
    fingerprint: string;
    /** True/false against a restored pool; null when there was none to compare. */
    composition_changed: boolean | null;
    delivery: PortfolioDelivery;
    restored: number;
    unevaluated: number;
  } | null;
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

  // ── WHOSE QUESTION THIS RUN ANSWERS, DECIDED ONCE ────────────────────────
  //
  // Built here and threaded down, so every stage qualifies against the SAME
  // Mission-derived rules. Before this existed, prequalification answered to a
  // hard-coded commercial role list and the workspace Brain's employee bounds,
  // and a Mission asking for companies hiring software engineers qualified none
  // of a hundred (TEST run cf6cce3d): its own required signal was classified
  // `technical`, and `technical` could not produce a qualifying tier.
  const qualificationCtx = buildQualificationContext(opts.mission);
  log("qualification_context", qualificationContextSummary(qualificationCtx));

  /**
   * The hiring verdict that costs NOTHING, for one company.
   *
   * EXTRACTED SO IT CAN RUN WITHOUT THE PAID CAPABILITY.
   *
   * This logic used to live inside the `hiring_verification` block, which is the
   * step `buildCapabilityGraph` schedules only when the Mission asks for
   * EXTERNAL verification. For a Mission that does not — and the graph says so
   * itself, appending "hiring evidence taken from embedded sources, not
   * purchased" — the embedded evidence was then read by nobody. `hiring_jobs`
   * stayed `[]`, `hiring_assessment` stayed `null`, and the Company Brain's
   * eligibility filter admitted no one, so a hundred companies produced zero
   * evaluations and the run reported it as zero qualifications.
   *
   * The comment described this function. It just did not exist outside the
   * branch. Free assessment is now unconditional; the PAID escalation stays
   * exactly where it was, behind the scheduled capability.
   */
  const freeHiringAssessment = (c: EngineCompany): HiringAssessment => {
    // Supporting signals the free evidence already proves.
    const supporting: SupportingSignal[] = [];
    if ((c.prequalified?.tier_a ?? 0) + (c.prequalified?.tier_b ?? 0) >= 2) {
      supporting.push("multiple_commercial_openings");
    }
    return assessHiring(
      c.yc_open_jobs.map((j) => ({ title: j.title, url: j.job_url, location: j.location })),
      supporting,
      // THE MISSION'S OWN VOCABULARY, the same list prequalification scored on.
      { source: "yc_open_jobs", vocab: qualificationCtx.role_vocabulary },
    );
  };

  /** The openings that earned the verdict, as normalized rows. */
  const hiringJobsFor = (c: EngineCompany, a: HiringAssessment): NormalizedHiringJob[] =>
    dedupeJobs(c.yc_open_jobs.filter((j) =>
      a.commercial_jobs.some((cj) => cj.title === j.title)));

  const outcomes: CapabilityRunResult["capability_outcomes"] = [];
  const companies: EngineCompany[] = [];
  // STAGE 2 state, captured inside the qualification capability and read after
  // the plan finishes — ranking compares the whole pool, so it cannot run until
  // every company that is going to be evaluated has been.
  let poolState: {
    pool: EligiblePool; restored: number; evaluatedKeys: string[];
    /** Of the eligible set — computable only here, after discovery. */
    fingerprint: string;
  } | null = null;
  const maxCandidates = opts.maxCandidates ?? 50;

  // THE GUARDED BOUNDARY. Every provider call in this file goes through it.
  const invoke = guardedInvoker(opts.plan, deps.invoke, (actorKey) => {
    log("capability_containment_violation", { actorKey });
  });

  // ── WHAT A PREVIOUS INVOCATION ALREADY PAID FOR ────────────────────────────
  const resumeScope = opts.resume ?? null;
  const priorRecords = new Map<string, CompanyResumeRecord>(
    (resumeScope?.records ?? []).map((r) => [r.company_key, r]));

  /**
   * Re-attach what an earlier invocation already proved about this company.
   *
   * Deliberately narrow. The record carries STAGES and ONE payload — the
   * resolved LinkedIn URL — so that is all this restores. Restoring the URL is
   * what actually stops the re-buy: the identity stage already declines to pay
   * for a company it can name, so a restored company never reaches the search
   * actor at all. Enrichment, hiring and founder payloads are NOT in the record,
   * so those stages are deliberately left to run again rather than be skipped
   * into an empty result the Brain would read as a proven negative.
   *
   * Idempotent — it is applied before every capability and must stay safe to
   * repeat.
   */
  /** Companies whose frontier position has already been restored. */
  const frontierRestored = new Set<string>();
  const restoreFromResume = (c: EngineCompany): void => {
    const prior = priorRecords.get(c.key);
    if (!prior) return;
    for (const op of prior.completed_operations) {
      if (!c.completed_operations.includes(op)) c.completed_operations.push(op);
    }
    // ── THE FRONTIER SURVIVES REDISCOVERY TOO ──────────────────────────────
    //
    // A continuation does not always skip discovery: a fresh invocation that
    // carries only the resume RECORDS re-runs it, rebuilding the working set
    // from the provider. Without this, those rebuilt companies arrive with a
    // default `pending_investigation` and the ranking below hands the SAME
    // first slice out again — a continuation that replays instead of advancing.
    // ONCE PER COMPANY, and only the first time it is seen. `restoreFromResume`
    // runs before EVERY capability, so re-applying the snapshot would overwrite
    // live progress: a company selected into this pass's slice would be reset
    // to the state run 1 left it in, and the frontier would never advance.
    if (prior.snapshot && !frontierRestored.has(c.key)) {
      frontierRestored.add(c.key);
      const snap = prior.snapshot as unknown as {
        investigation_state?: unknown; investigation_rank?: unknown;
      };
      c.investigation_state = asInvestigationState(snap.investigation_state);
      if (typeof snap.investigation_rank === "number") {
        c.investigation_rank = snap.investigation_rank;
      }
      c.shortlisted = wasInvestigated(c.investigation_state);
    }
    if (prior.identity === "resolved" && prior.linkedin_company_url &&
        !c.company.linkedin_company_url) {
      c.company = { ...c.company, linkedin_company_url: prior.linkedin_company_url };
      log("identity_restored_from_resume", {
        company_key: c.key, linkedin_company_url: prior.linkedin_company_url,
      });
    }
  };

  /**
   * STAGE 2 + STAGE 3 — GPT triage, then a budget-driven shortlist.
   *
   * Both run free of any provider. Triage is a cheap batched model call and the
   * shortlist is pure arithmetic; between them they decide where every paid
   * stage downstream spends its money.
   *
   * SAFE WHEN OFF. With no `triageCompanies` dependency no model call is made,
   * every company keeps its deterministic verdict, and the shortlist is rebuilt
   * from `eligible` + the same budget — which defaults to the ten the old
   * ceiling allowed. Nothing about a run changes until triage is switched on.
   */
  const applyMissionIntelligence = async (companies: EngineCompany[]): Promise<void> => {
    const verdicts = new Map<string, TriageVerdict>();

    if (deps.triageCompanies && companies.length > 0) {
      const batches = triageBatches(companies, deps.triageBatchSize ?? TRIAGE_BATCH_SIZE);
      const allowed = deps.triageBatchesAllowed ?? batches.length;
      let made = 0;

      // ── THE BATCHES RUN SIDE BY SIDE ───────────────────────────────────────
      //
      // WHY THIS IS THE IDENTITY STAGE'S PROBLEM. Triage is free, read-only and
      // parallel by nature — every batch is an independent model call over a
      // DISJOINT set of companies, and the verdicts land in a map keyed by
      // company, so nothing about the result depends on the order.
      //
      // Run one after another they cost wall clock that the PAID stages then do
      // not have. On task 83843770 four batches of 25 took 33.6s of a 125s
      // budget — more than identity resolution got — and identity managed 5 of
      // its 10 companies before the reserve stopped it. Five companies were
      // deferred to pay for a stage that was waiting on network round-trips it
      // could have overlapped.
      //
      // Lane count is shared with the paid stages deliberately: it is the same
      // question (how many concurrent provider calls is this runtime willing to
      // have outstanding) and one knob is easier to reason about than two.
      const budgeted = batches.slice(0, Math.max(0, allowed));
      const overflow = batches.slice(Math.max(0, allowed));

      // OUT OF BATCHES IS NOT A JUDGEMENT. The rest stay uncertain and remain
      // fully eligible for the shortlist.
      for (const batch of overflow) {
        for (const c of batch) {
          verdicts.set(c.key, uncertainVerdict(c.key, "triage_budget_exhausted"));
        }
      }

      await runBounded(budgeted, resolveTriageConcurrency(opts.readEnv), async (batch) => {
        // THE DEADLINE APPLIES TO FREE WORK TOO. A model call still costs wall
        // clock, and spending it here is what leaves none for the paid stages.
        // Checked per batch as each lane picks one up, so a run that goes long
        // stops starting new calls rather than being decided up front.
        if (deps.deadline?.expired("mission_triage") === true) {
          for (const c of batch) {
            verdicts.set(c.key, uncertainVerdict(c.key, "triage_deadline_deferred"));
          }
          return;
        }
        made++;
        const startedAt = Date.now();
        let parsed;
        try {
          const raw = await deps.triageCompanies!({
            input: buildMissionTriageInput({
              ctx: qualificationCtx,
              companies: batch.map(toTriageInput),
            }),
            company_keys: batch.map((c) => c.key),
          });
          parsed = parseMissionTriageStrict(raw, batch.map((c) => c.key));
        } catch (e) {
          // A THROWN TRIAGE CALL EXCLUDES NOBODY.
          log("triage_batch_error", { error: String(e), size: batch.length });
          parsed = parseMissionTriageStrict(null, batch.map((c) => c.key));
        }
        // OBSERVED PER CALL, NOT PER WAVE. `observeCall` feeds the latency
        // estimate the capacity maths uses; handing it a wall-clock span that
        // covered several overlapping calls would inflate it.
        deps.deadline?.observeCall(Date.now() - startedAt, "mission_triage");
        // Disjoint batches, so these writes never contend for the same key.
        for (const [k, v] of parsed.verdicts) verdicts.set(k, v);
        log("triage_batch_complete", {
          size: batch.length, parse_status: parsed.parse_status,
          unknown_keys: parsed.raw_shape.unknown_keys.length,
          missing_keys: parsed.raw_shape.missing_keys.length,
        });
      });

      state.triage = {
        ...summariseTriage(verdicts.values()),
        batches_made: made,
        batches_available: batches.length,
      };
    }

    for (const c of companies) c.triage = verdicts.get(c.key) ?? null;

    // ── STAGE 3: THE BUDGET DECIDES THE SHORTLIST ──────────────────────────
    //
    // TWO CONSTRAINTS, RECONCILED HERE. The count budget says how many
    // companies this run may pay for; the wall clock says how many it can
    // actually carry from identity through persistence before the invocation
    // ends. The smaller binds, and the decision records which one did.
    //
    // `stage2Ceiling` is gone — see `leadInvestigationBudget`. A GPT batch-read
    // limit authorised 100 paid Actor starts on run ea2d02f2 and the run
    // finished none of them.
    const countBudget = resolveInvestigationBudget({
      requestedCount: effectiveRequestedCount(opts.mission),
      poolSize: companies.length,
      read: opts.readEnv,
    });
    // OBSERVATIONAL ONLY at this point. Recorded so the shortlist decision can
    // be read against the clock it was made under; the ENFORCEMENT happens in
    // the identity stage, which recomputes it from that invocation's own
    // remaining time. See `downstreamReserveMs`.
    const capacity = deps.deadline
      ? resolveTimeCapacity({
        remainingMs: deps.deadline.remainingMs(),
        reserveMs: deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS,
        concurrency: LINKEDIN_RESOLUTION_CONCURRENCY,
        enrichmentBatchSize: COMPANY_DETAILS_BATCH_SIZE,
        read: opts.readEnv,
        observedIdentityMs: deps.deadline.estimateFor("apify_linkedin_company_search"),
      })
      : null;
    // THE CLOCK DOES NOT SHRINK THE SHORTLIST — see `downstreamReserveMs`.
    // Doing so would strand companies permanently, because the shortlist is
    // computed once per lineage and a resume skips completed capabilities.
    // `capacity` is carried for observability and ENFORCED inside the identity
    // stage, where a stop is deferral rather than deletion.
    const budget = countBudget;
    // THE CHEAP STAGES ARE SIZED SEPARATELY, and never from this number.
    const gptBudget = resolveGptBudget({
      poolSize: companies.length,
      investigationBudget: budget.budget,
      read: opts.readEnv,
    });
    const decision = buildSmartShortlist(
      companies.map((c) => ({
        company_key: c.key,
        eligible: c.prequalified?.eligible ?? true,
        // THE MISSION'S OWN CONSTRAINT, AND ONLY THAT.
        //
        // `prequalified.exclusion` carries three values. `employee_size` fires
        // only when the MISSION set a range and the size is known to be
        // outside it — a verified fact about a constraint the user expressed.
        // `technical_only` and `insufficient_commercial` come from the role
        // vocabulary and are judgements, so they rank (via `eligible`) and no
        // longer remove anyone from the pool.
        hard_exclusion: c.prequalified?.exclusion === "employee_size"
          ? "employee_size"
          : null,
        relevance: c.triage?.relevance ?? null,
        confidence: c.triage?.confidence ?? null,
        signal_strength: c.triage?.signal_strength ?? null,
        score: c.prequalified?.score ?? null,
        name: c.prequalified?.name ?? c.company.company_name ?? c.key,
      })),
      // RANK THE WHOLE POOL. This call now decides ORDER and PERMANENT
      // EXCLUSION only — the per-pass slice is taken separately. Passing the
      // spend budget here would mark everything past position ten
      // `budget_exhausted`, and this function reads that as a decision, which
      // is exactly how 90 companies were closed for the life of a lineage.
      { ...budget, budget: companies.length },
      // THE UNTRIAGED SPEND POLICY, read from the same env the budget uses.
      { untriaged: resolveUntriagedPolicy(opts.readEnv) },
    );

    // ── THE RANKING IS THE DURABLE ARTEFACT, NOT THE SELECTION ─────────────
    //
    // `buildSmartShortlist` decides ORDER and permanent EXCLUSION. It no longer
    // decides who is investigated — that is a per-pass slice, taken below and
    // again on every later pass and every continuation.
    const chosen = new Set(decision.selected);
    const rankOf = new Map(decision.ranking.map((k, i) => [k, i]));
    for (const c of companies) {
      c.investigation_rank = rankOf.get(c.key) ?? Number.MAX_SAFE_INTEGER;
      const why = decision.excluded.find((e) => e.company_key === c.key);
      // ONLY A DECISION CLOSES A COMPANY. `budget_exhausted` is a queue
      // position and must never reach this branch — the ranking call above is
      // given the whole pool precisely so it cannot — but the guard is stated
      // here too, because the cost of getting it wrong is silent and permanent.
      const permanent = why != null && why.reason !== "budget_exhausted" &&
        why.reason !== "not_selected";
      if (permanent) {
        // CLOSED BY A DECISION. GPT said irrelevant, or a mission-stated
        // constraint is verifiably violated. These never re-enter the frontier.
        c.investigation_state = "excluded_permanently";
        c.shortlist_exclusion = why!.reason;
      } else if (wasInvestigated(c.investigation_state)) {
        // ALREADY PAID FOR, by an earlier pass or an earlier invocation. The
        // ranking may reorder the frontier; it may never return a company that
        // has been investigated to it, or the continuation re-buys the slice it
        // just finished.
        c.shortlist_exclusion = null;
      } else {
        // RANKED AND WAITING. `chosen` is only the first slice; everything else
        // stays on the frontier rather than being marked "not selected", which
        // is what froze 90 companies for the life of a lineage.
        c.investigation_state = "pending_investigation";
        c.shortlist_exclusion = null;
      }
      c.shortlisted = wasInvestigated(c.investigation_state);
    }
    state.investigation_ranking = decision.ranking.slice();
    state.shortlist_decision = {
      // THE SPEND BUDGET, NOT THE RANKING BUDGET. `decision.budget` carries the
      // pool-sized number this call was given so it would rank rather than
      // exclude; recording it here made the state claim the run had authorised
      // one paid investigation per discovered company.
      budget, counts: decision.counts,
      untriaged_policy: decision.untriaged_policy,
      ranking: decision.ranking.slice(0, 50),
      // BOTH BUDGETS, RECORDED SEPARATELY. "Why did this run only investigate
      // six companies?" must be answerable from the task row, and the answer is
      // one of: the count budget, the pool, or the clock.
      time_capacity: capacity,
      gpt_budget: gptBudget,
    };
    state.investigation_capacity = capacity;
    log("triage_and_ranking_complete", {
      budget: budget.budget, budget_source: budget.source,
      count_budget: countBudget.budget,
      requested: budget.requested_count, pool: budget.pool_size,
      ...decision.counts,
      triage_enabled: deps.triageCompanies != null,
      untriaged_policy: decision.untriaged_policy,
      // ── WHY THE CLOCK ALLOWED WHAT IT ALLOWED ────────────────────────────
      time_capacity: capacity?.capacity ?? null,
      per_company_ms: capacity?.per_company_ms ?? null,
      usable_ms: capacity?.usable_ms ?? null,
      gpt_read_budget: gptBudget.read_budget,
      gpt_evaluation_budget: gptBudget.evaluation_budget,
      frontier: companies.filter((c) => isFrontier(c.investigation_state)).length,
      excluded_permanently: companies.filter(
        (c) => c.investigation_state === "excluded_permanently").length,
      first_slice_preview: [...chosen].length,
    });
  };

  /**
   * TAKE THE NEXT SLICE OF THE FRONTIER — every pass, every invocation.
   *
   * This is the step whose absence stranded 90 companies. Selection used to
   * live inside `applyMissionIntelligence`, which runs inside the discovery
   * capability, which a continuation SKIPS — so the shortlist was computed once
   * per lineage and no later pass could widen it.
   *
   * It runs here instead: cheap, deterministic, a cursor over a ranking that
   * was decided once. It re-derives nothing and cannot disagree with itself
   * between passes.
   *
   * Returns how many companies were newly selected.
   */
  const takeInvestigationSlice = (
    companies: EngineCompany[], pass: number,
  ): number => {
    // The per-pass allowance. Sized on the pool that is still open, so a slice
    // never authorises more than the frontier holds.
    const budget = resolveInvestigationBudget({
      requestedCount: effectiveRequestedCount(opts.mission),
      poolSize: companies.filter((c) => isFrontier(c.investigation_state)).length,
      read: opts.readEnv,
    });
    // ── WORK ALREADY OWED SPENDS THE SAME ALLOWANCE ────────────────────────
    //
    // A continuation restores companies a previous invocation selected but
    // never got to buy — the deadline stopped the identity stage mid-slice.
    // They are already authorised, they still owe a paid search, and THIS pass
    // will make it. So they are part of THIS pass's spend.
    //
    // Selecting a full fresh slice on top of them let one pass authorise budget
    // PLUS carried work: a run resuming eight deferred candidates on a budget
    // of ten made eighteen paid searches.
    //
    // Measured by what is still OWED, not by `in_flight`. A slice that was
    // closed at the end of an invocation leaves its unbought companies
    // `investigated` — the state says the pass is over, not that the money was
    // spent — so keying on `in_flight` alone missed exactly the companies a
    // continuation is about to pay for.
    //
    // Only the remainder is available. Zero is a valid answer: a continuation
    // that inherits a full slice takes none, finishes what it owes, and lets
    // the yield loop decide whether to open the frontier further.
    const carried = companies.filter((c) =>
      wasInvestigated(c.investigation_state) && c.identity === null &&
      !c.company.linkedin_company_url
    ).length;
    const allowance = Math.max(0, budget.budget - carried);
    const slice = selectInvestigationSlice(
      companies.map((c) => ({
        company_key: c.key,
        state: c.investigation_state,
        rank: c.investigation_rank,
      })),
      allowance,
    );
    const picked = new Set(slice.selected);
    for (const c of companies) {
      if (!picked.has(c.key)) continue;
      c.investigation_state = "in_flight";
      // `shortlisted` is the derived view every downstream stage already reads.
      c.shortlisted = true;
      c.shortlist_exclusion = null;
    }
    // THE RUNNING TOTAL OF AUTHORISED SPEND. Every downstream report of "how
    // many did we shortlist" reads this rather than the ranking's own count.
    // Carried work counts: this invocation buys those searches too.
    state.investigation_selected += slice.selected.length + carried;
    state.investigation_slices.push({
      pass,
      selected: slice.selected.length,
      carried,
      remaining: slice.remaining,
      investigated: slice.investigated,
      excluded: slice.excluded,
      reason: slice.reason,
    });
    log("investigation_slice_taken", {
      pass, selected: slice.selected.length, frontier_remaining: slice.remaining,
      already_investigated: slice.investigated,
      excluded_permanently: slice.excluded, reason: slice.reason,
      budget: budget.budget, budget_source: budget.source,
      // "Why did this pass only take two?" — because it inherited eight.
      carried_in_flight: carried, allowance,
    });
    return slice.selected.length;
  };

  /** Everything selected on an earlier pass has had its money spent. */
  const closeInvestigatedSlice = (companies: EngineCompany[]): void => {
    for (const c of companies) {
      if (c.investigation_state === "in_flight") c.investigation_state = "investigated";
    }
  };

  /**
   * WHY THE LAST PROVIDER CALL RETURNED NOTHING — for BATCHED stages.
   *
   * `callProvider` records the reason on the company when it is given one, but
   * enrichment calls the provider once for a BATCH of LinkedIn URLs and has no
   * single company to attribute it to. Without this, a deferred or failed batch
   * was indistinguishable from a batch the provider genuinely answered with zero
   * rows — so "we ran out of time" was recorded as "this company has no
   * LinkedIn record", which is evidence, and wrong.
   *
   * Reset at the start of every call, read immediately after.
   */
  let lastCallBlock: "deferred" | "provider_error" | null = null;

  /** One provider call: idempotency, cost, attempt record, never off-graph. */
  const callProvider = async (
    capability: CapabilityId, provider: string, compiled: CompileResult<unknown>,
    company?: EngineCompany,
  ): Promise<Record<string, unknown>[]> => {
    // CLEARED PER CALL. A stale block from an earlier batch would mark a
    // perfectly answered one as deferred.
    lastCallBlock = null;
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

    // ── THE RESUME GUARD ─────────────────────────────────────────────────────
    //
    // Checked FIRST, ahead of every other gate, because the cheapest call is the
    // one that is never made. `shouldSkipProviderCall` has been persisted and
    // tested since the checkpoint landed and no call site consulted it, so a
    // continuation re-bought identity resolution for companies it had already
    // resolved — the precise waste the checkpoint was written to end.
    //
    // ONLY where the skip is LOSSLESS. `company` is passed by call sites whose
    // result the resume state can restore or whose outcome is already terminal;
    // for everything else this is inert and the call proceeds as before. A skip
    // that returned an empty result the caller then read as evidence would trade
    // money for correctness, which is a worse bargain than the one it replaces.
    const operationKey = resumeScope && company
      ? providerOperationKey({
        workspace_id: resumeScope.workspace_id,
        lineage_root_task_id: resumeScope.lineage_root_task_id,
        company_key: company.key,
        capability, provider,
        input_fingerprint: inputFingerprint(call.input),
      })
      : null;
    if (operationKey && company) {
      const verdict = shouldSkipProviderCall(priorRecords.get(company.key), operationKey);
      if (verdict.skip) {
        record("skipped_resume_reuse", 0, verdict.reason);
        log("provider_skipped_resume_reuse", {
          capability, provider, company_key: company.key, reason: verdict.reason,
        });
        return [];
      }
    }

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
      // THIS COMPANY WAS DEFERRED, NOT ANSWERED. Without this the caller reads
      // an empty result and resolves it into "nothing matched" — turning a
      // clock decision into a permanent fact about the company.
      if (company) company.stage_block = { capability, reason: "deferred" };
      lastCallBlock = "deferred";
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
      //
      // SCOPED TO THE PROVIDER, so what discovery costs is not charged against
      // what an identity search costs. One monotonic maximum across every
      // provider is what stranded nine candidates behind a 51s memo23 start.
      deps.deadline?.observeCall(Date.now() - startedAt, provider);
      deps.onCallComplete?.(call.batchIdentity);
      record(rows.length > 0 ? "ok" : "empty", rows.length, null);
      // THE LEDGER OF WHAT WAS BOUGHT, written only after the answer arrived.
      //
      // An errored or still-pending call records nothing, so a retry is never
      // mistaken for completed work. An EMPTY result does record: the question
      // was asked and paid for, and asking it again buys the same silence.
      if (operationKey && company && !company.completed_operations.includes(operationKey)) {
        company.completed_operations.push(operationKey);
      }
      return rows;
    } catch (e) {
      deps.deadline?.observeCall(Date.now() - startedAt, provider);
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
      // A FAILED CALL IS NOT A NEGATIVE ANSWER. Same reasoning as the deadline
      // skip above: the caller must not read the empty array as evidence.
      if (company) company.stage_block = { capability, reason: "provider_error" };
      lastCallBlock = "provider_error";
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

  /** Investigation passes taken. One per slice; bounded by the yield gate. */
  let investigationPass = 1;

  for (let stepIndex = 0; stepIndex < opts.plan.steps.length; stepIndex++) {
    const step = opts.plan.steps[stepIndex];
    const cap = step.capability;

    // RESUME. A capability already completed is not re-paid for.
    if (state.completed_capabilities.includes(cap)) {
      outcomes.push({
        capability: cap, status: "skipped_resumed", rows: 0, providers_used: [],
        evidence_satisfied: true, reason: "completed in an earlier run",
      });
      state.pending_capabilities = state.pending_capabilities.filter((c) => c !== cap);

      // ── SKIPPING DISCOVERY MUST NOT MEAN LOSING THE CANDIDATES ───────────
      //
      // Discovery is the only step that fills `companies`. Skipping it as
      // already-complete — the correct call, since re-running it re-pays for
      // the Actor — used to leave the working set EMPTY, so every downstream
      // stage looped over nothing and a continuation resumed exactly zero
      // candidates. The deferred identity candidates that the truncation fix
      // deliberately keeps alive could never actually be picked up.
      //
      // The checkpoint carries a snapshot per company for precisely this.
      if (WORKING_SET_CAPABILITIES.has(cap) && companies.length === 0 && resumeScope) {
        const restored = restoreWorkingSet(resumeScope.records);
        for (const c of restored) companies.push(c);
        // ── A CONTINUATION TAKES A FRESH SLICE ──────────────────────────
        //
        // THE FIX FOR THE FROZEN POOL. Selection used to live inside discovery,
        // which is what we just skipped — so a continuation restored the same
        // ten companies and did nothing for the other ninety, forever, while
        // the checkpoint kept reporting them pending.
        //
        // The ranking is restored with the working set, so this is the same
        // cheap cursor the first pass used. Nothing is re-triaged and nothing
        // is re-decided; the frontier simply advances.
        if (restored.some((c) => isFrontier(c.investigation_state))) {
          takeInvestigationSlice(companies, 1);
        }
        log("working_set_restored_from_checkpoint", {
          capability: cap,
          restored: restored.length,
          records: resumeScope.records.length,
          shortlisted: restored.filter((c) => c.shortlisted).length,
          frontier: restored.filter(
            (c) => isFrontier(c.investigation_state)).length,
          // Zero restored from a non-empty ledger means the checkpoint predates
          // the snapshot field — worth seeing, and not an error.
          snapshots_missing: resumeScope.records.filter((r) => !r.snapshot).length,
        });
      }
      continue;
    }
    state.current_capability = cap;
    // Applied before every capability, not once after discovery: companies are
    // added by more than one provider, and a restore that ran too early would
    // miss the ones added last.
    if (resumeScope) for (const c of companies) restoreFromResume(c);

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
      }, qualificationCtx);
      // The working set may have shrunk — artifacts are gone.
      state.company_keys = companies.map((c) => c.key);
      log("prequalification_complete", {
        unique: state.prequalification?.unique_companies,
        eligible: state.prequalification?.eligible_companies,
        size_excluded: state.prequalification?.employee_size_excluded,
        technical_only: state.prequalification?.technical_only_companies,
      });

      // ── STAGE 2: GPT MISSION INTELLIGENCE, THEN THE SMART SHORTLIST ────────
      //
      // Runs AFTER the deterministic pass and OVERRIDES its shortlist. The free
      // pass keeps doing what it is good at — deduping, artifact removal,
      // scoring — and stops being the thing that decides which companies are
      // semantically worth money. That decision was a substring match, and it
      // excluded ML Engineer, Founding Engineer and Member of Technical Staff
      // from a Mission asking for software engineers.
      // THE PRIOR FRONTIER, ONTO THE COMPANIES DISCOVERY JUST REBUILT.
      //
      // The loop-level restore runs before each capability, and on the discovery
      // pass `companies` is still empty — so a continuation that RE-RUNS
      // discovery (rather than skipping it) rebuilt every company at the
      // default `pending_investigation` and handed out the same first slice
      // again. Applied here, after the working set exists and before it is
      // ranked.
      if (resumeScope) for (const c of companies) restoreFromResume(c);
      await applyMissionIntelligence(companies);
      // THE FIRST SLICE. Ranking and selection are now separate acts: the
      // ranking is decided once, here; the slice is taken here and again on
      // every later pass and every continuation.
      takeInvestigationSlice(companies, 1);

      finish(cap, "complete", companies.length, used, true, null);
      await publish("prequalified");
      continue;
    }

    // ── GENERAL COMPANY DISCOVERY ────────────────────────────────────────────
    //
    // The route for everything that is not a startup cohort and not a supplied
    // list: manufacturers, integrators, agencies, engineering firms. It was
    // DECLARED in the graph and never driven, so those missions planned a
    // sensible route and then reported `skipped_no_input` — a correct answer to
    // nothing.
    //
    // The concepts searched for are compiled from the VALIDATED MISSION, never
    // from free model text. `compileCompanySearchConcepts` strips URLs and
    // vendor names, enforces the mission's hard geography, and caps both the
    // number of queries and the rows each may return, so an over-eager
    // interpretation costs a bounded amount rather than an open one.
    if (cap === "general_company_discovery") {
      const provider = "apify_linkedin_company_search";
      const concepts = compileCompanySearchConcepts(opts.mission, maxCandidates);
      if (concepts.queries.length === 0) {
        finish(cap, "skipped_no_input", 0, [], false,
          "the mission carries no company type, vertical or geography to search on");
        continue;
      }
      let found = 0;
      for (const q of concepts.queries) {
        if (companies.length >= maxCandidates) break;
        const compiled = compileHarvestCompanySearchInput({
          searchQuery: q,
          // `full` is required: `short` returns employeeCount === null, and an
          // unverifiable size cannot settle an employee-ceiling gate.
          scraperMode: "full",
          maxItems: concepts.maxItemsPerQuery,
          ...(concepts.locations.length ? { locations: concepts.locations } : {}),
        });
        for (const r of await callProvider(cap, provider, compiled)) {
          const c = normalizeLinkedInCompanyCandidate(r);
          // DEDUPED BY `addCompany`, which keys on LinkedIn URL / domain / id —
          // so the same company surfacing under two concepts is one row, and is
          // therefore identified and enriched once.
          addCompany(companies, c, []);
          found++;
        }
      }
      state.company_keys = companies.map((c) => c.key);
      if (companies.length === 0) {
        const invalid = state.provider_attempts.filter(
          (a) => a.capability === cap && a.outcome === "compile_failed");
        if (invalid.length > 0) {
          state.terminal_reason = "provider_input_validation_failed";
          finish(cap, "incomplete", 0, [provider], false,
            `provider_input_validation_failed: ${invalid.map((a) => a.reason).join(" | ")}`);
          break;
        }
        const ex = onCapabilityExhausted(opts.plan, cap, [provider]);
        state.terminal_reason = ex.reason;
        state.fallback_reason = ex.status === "exhausted" ? "approved_providers_exhausted" : null;
        finish(cap, "exhausted", 0, [provider], false, ex.reason);
        break;
      }
      finish(cap, "complete", companies.length, [provider], true, null);
      log("general_company_discovery_complete", {
        queries: concepts.queries, locations: concepts.locations,
        rows: found, unique_companies: companies.length,
      });
      await publish("accounts_found");
      continue;
    }

    if (cap === "known_company_resolution" ||
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

      // COMPUTED HERE, FROM THE CLOCK AS IT IS NOW. Not read off the shortlist
      // decision: a continuation skips discovery entirely, so the capacity
      // recorded there belongs to a previous invocation with a different
      // window. What bounds this stage is the time THIS invocation has left.
      const timeCapacity = deps.deadline
        ? resolveTimeCapacity({
          remainingMs: deps.deadline.remainingMs(),
          reserveMs: deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS,
          concurrency: LINKEDIN_RESOLUTION_CONCURRENCY,
          enrichmentBatchSize: COMPANY_DETAILS_BATCH_SIZE,
          read: opts.readEnv,
          observedIdentityMs: deps.deadline.estimateFor(provider),
        })
        : null;
      if (timeCapacity) state.investigation_capacity = timeCapacity;

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
          // SCOPED TO THE COMPANY, so the resume guard can refuse it. Lossless:
          // a company this run already resolved carries its URL back in through
          // `restoreFromResume` and never reaches this branch, and a company a
          // previous run gave up on re-derives the same unresolved identity from
          // zero lookups — the outcome it already had, for nothing.
          const found = await callProvider(cap, provider, compiled, c);
          // ── NO CALL, NO VERDICT ──────────────────────────────────────────
          //
          // The reserve fired before this call, or the call failed. Either way
          // `found` is empty for a reason that has nothing to do with the
          // company. Falling through would hand zero lookups to
          // `resolveIdentityAgainstLookups`, which would return `unresolved` —
          // a TERMINAL state that stops the company being retried, ever. The
          // company keeps `identity === null` and is counted as unfinished
          // work below.
          if (c.stage_block?.capability === cap) return;
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

      // ── IDENTITY MAY NOT SPEND THE WINDOW THE LATER STAGES NEED ───────────
      //
      // SCOPED TO THIS PROVIDER. An unscoped `expired()` compares the time left
      // against the slowest call ANY stage has made — so a 51s discovery start
      // made a 9s identity search look unaffordable and ended the stage with a
      // third of the budget unspent.
      //
      // AND SCOPED TO THE WHOLE PIPELINE. `expired(provider)` alone asks only
      // "is there room for one more search?", which on run ea2d02f2 was true
      // 12 times in a row until 114 of 125 seconds were gone — leaving 10.8s
      // against an 18s checkpoint reserve, so enrichment never ran, the five
      // resolved companies reached the evaluator with no enrichment evidence,
      // and the run qualified nobody. Every search was individually
      // affordable; the sequence was not.
      //
      // `identityStopThreshold` asks the second question: is there still room
      // to FINISH what we already hold? The reserve grows with each resolved
      // identity, so the stage stops on its own and the companies it never
      // reached are deferred — resumably, by the accounting directly below.
      const stopThreshold = () => {
        if (!timeCapacity) return 0;
        return identityStopThreshold({
          resolvedSoFar: targets.filter(
            (c) => c.identity && identityIsActionable(c.identity)).length,
          capacity: timeCapacity,
          checkpointReserveMs: deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS,
          perCallEstimateMs: deps.deadline?.estimateFor(provider) ?? 0,
        });
      };
      const bounded = await runBounded(targets, LINKEDIN_RESOLUTION_CONCURRENCY, resolveOne,
        () => {
          if (!deps.deadline) return false;
          if (deps.deadline.expired(provider)) return true;
          return deps.deadline.remainingMs() <= stopThreshold();
        });

      // ── WHAT DID NOT HAPPEN, RECORDED AS EXPLICITLY AS WHAT DID ────────────
      //
      // `runBounded` has always returned `{processed, skipped}` and the caller
      // has always thrown the second half away. Nine of twenty candidates on a
      // real run were selected, budgeted, and then never attempted — and the
      // capability still reported `complete`, so a resume skipped the whole
      // stage and those nine were lost permanently.
      //
      // Membership is derived from the COMPANIES, not from the count: a company
      // with no identity and no terminal answer is unfinished, whichever lane
      // did or did not claim it.
      const providerFailed = targets.filter(
        (c) => c.identity === null && c.stage_block?.reason === "provider_error");
      const deferredTargets = targets.filter(
        (c) => c.identity === null && c.stage_block?.reason !== "provider_error");
      for (const c of deferredTargets) {
        // MARKED EVEN WHEN NO LANE EVER CLAIMED IT. A company `runBounded` never
        // reached has no `stage_block` from `callProvider`, because no call was
        // made for it at all — it would otherwise persist as `not_started`,
        // which is indistinguishable from a company nobody has scheduled yet.
        // Setting it here is what makes "budgeted and abandoned" a state the
        // checkpoint can carry.
        c.stage_block ??= { capability: cap, reason: "deferred" };
        // A HOLDING STATE THAT NAMES ITS CAUSE. Not "unresolved" — nothing was
        // asked — and not silence, which is what made these companies vanish.
        c.record = advance(c.record, "identity_pending", "identity_resolution_deferred");
        c.record.missing_evidence.push("identity_resolution_deferred");
      }
      for (const c of providerFailed) {
        c.record = advance(c.record, "identity_pending", "identity_provider_error");
        c.record.missing_evidence.push("identity_provider_error");
      }

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

      // ── PARTIAL EXECUTION IS NOT COMPLETE EXECUTION ───────────────────────
      //
      // THE INVARIANT THIS STAGE BROKE. `complete` used to be unconditional,
      // with `evidence_satisfied = resolved > 0` — so ONE successful lookup out
      // of twenty marked the capability done. `finish` then moved it to
      // `completed_capabilities`, and the resume guard skips anything listed
      // there. Eleven attempted, nine never touched, and the run reported the
      // stage finished.
      //
      // A capability is complete only when every target reached a TERMINAL
      // state: resolved, or answered-and-unmatched. Deferred and provider-error
      // candidates are neither, so the capability stays `incomplete` — which
      // keeps it in `pending_capabilities`, makes the run `partial` and
      // resumable, and lets a continuation finish exactly the candidates that
      // were left. Companies already resolved are protected from being re-paid
      // for by `shouldSkipProviderCall`, not by pretending the stage was done.
      const unfinished = deferredTargets.length + providerFailed.length;
      const truncated = unfinished > 0;
      finish(cap, truncated ? "incomplete" : "complete", resolved, [provider],
        truncated ? false : resolved > 0,
        truncated
          ? `${resolved} resolved, ${deferredTargets.length} deferred, ` +
            `${providerFailed.length} provider error; ${unfinished} of ` +
            `${targets.length} target(s) never reached a terminal state`
          : resolved === 0 ? "no company reached an actionable identity" : null);
      log("identity_resolution_complete", {
        targets: targets.length, resolved, unresolved,
        // THE COUNTS THAT WERE PREVIOUSLY DISCARDED.
        deferred: deferredTargets.length,
        provider_errors: providerFailed.length,
        attempted: bounded.processed,
        unattempted: bounded.skipped,
        truncated,
        deferred_company_keys: deferredTargets.map((c) => c.key),
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
          // ── WHY THIS BATCH PRODUCED NOTHING ─────────────────────────────────
          //
          // Read IMMEDIATELY after the call and scoped to THIS batch's
          // companies. `callProvider` clears `lastCallBlock` on entry, so it
          // describes this call and no other; the enrichment call is batched and
          // passes no `company`, so without this the block it recorded would be
          // attributed to nobody and every company in a deferred batch would
          // fall through to `empty` — a run fact rendered as a company fact.
          const blocked = lastCallBlock;
          if (blocked) {
            for (const url of batch) {
              for (const c of byUrl.get(url) ?? []) {
                if (c.enriched) continue;
                c.enrichment_outcome = blocked;
                // SCOPED TO THIS CAPABILITY, so an enrichment failure can never
                // be read back as an identity outcome. Identity is already
                // resolved for every company here, so there is no earlier block
                // worth preserving.
                c.stage_block = { capability: cap, reason: blocked };
              }
            }
            // A DEFERRED BATCH ENDS THE STAGE. The reserve exists so there is
            // time to write a checkpoint; spending it on the next batch is
            // precisely what it forbids.
            if (blocked === "deferred") break;
            continue;
          }
          // MAPPED BACK BY URL. A batched response arrives in the Actor's order,
          // not ours, so pairing by index would attach one company's evidence to
          // another — a silent, unfalsifiable corruption.
          for (const row of rows) {
            const normalized = normalizeLinkedInCompanyEnriched(row);
            const url = normalized.linkedin_company_url;
            const matches = url ? byUrl.get(url) ?? [] : [];
            for (const c of matches) {
              c.enriched = normalized;
              c.enrichment_outcome = "success";
              // THE BLOCK IS CLEARED BY AN ANSWER. A company whose earlier batch
              // errored and whose retry succeeded is not blocked.
              if (c.stage_block?.capability === cap) c.stage_block = null;
              c.record = advance(c.record, "enrichment_complete", "provider_evidence_collected");
              enriched++;
            }
          }
          // ANSWERED, AND NOT IN THE ANSWER. The one outcome here that is
          // genuinely about the company: the provider was asked and has no
          // record of it. Still not a rejection — it is an absence of evidence,
          // and qualification holds on it rather than deciding.
          for (const url of batch) {
            for (const c of byUrl.get(url) ?? []) {
              if (c.enriched || c.enrichment_outcome !== "not_attempted") continue;
              c.enrichment_outcome = "empty";
            }
          }
        }
      }
      for (const c of actionable) {
        if (c.enriched) continue;
        c.record = advance(c.record, "enrichment_pending",
          `enrichment_${c.enrichment_outcome}`);
      }
      const enrichmentOutcomes = summariseEnrichmentOutcomes(
        actionable.map((c) => c.enrichment_outcome));
      // ── PARTIAL EXECUTION IS NOT COMPLETE EXECUTION ───────────────────────
      //
      // The same invariant identity resolution already holds. A company whose
      // enrichment was DEFERRED or ERRORED never reached a terminal state, so
      // the capability is incomplete: it stays pending, the run stays resumable,
      // and a continuation buys exactly the evidence that is still missing.
      // Marking it complete would move it to `completed_capabilities`, where the
      // resume guard skips it — stranding those companies permanently on an
      // outcome that was never about them.
      const unenriched = actionable.filter(
        (c) => !enrichmentIsTerminal(c.enrichment_outcome)).length;
      const truncated = unenriched > 0;
      // EVIDENCE GATE. Enrichment that produced nothing is not enrichment, and
      // qualification must see that rather than an empty record it could read as
      // a proven negative.
      finish(cap, truncated ? "incomplete" : "complete", enriched,
        ["apify_linkedin_company_details"], truncated ? false : enriched > 0,
        truncated
          ? `${enriched} enriched, ${enrichmentOutcomes.deferred} deferred, ` +
            `${enrichmentOutcomes.provider_error} provider error; ${unenriched} of ` +
            `${actionable.length} company(ies) never reached a terminal state`
          : enriched === 0
            ? "no company was enriched; qualification will hold them as unknown"
            : null);
      log("company_enrichment_complete", {
        resolved_urls: urls.length,
        actor_starts: Math.ceil(urls.length / COMPANY_DETAILS_BATCH_SIZE),
        enriched,
        // THE COUNTS THAT WERE PREVIOUSLY COLLAPSED INTO ONE `null`.
        outcomes: enrichmentOutcomes,
        truncated,
        deferred_company_keys: actionable
          .filter((c) => c.enrichment_outcome === "deferred").map((c) => c.key),
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
        let assessment = freeHiringAssessment(c);

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
                [...assessment.supporting_signals, "another_active_gtm_opening"],
                // SAME VOCABULARY AS THE FREE PASS. An external check that
                // judged on a different role list could contradict evidence the
                // free pass already accepted, which is the divergence
                // `commercialSignalPolicy` exists to prevent.
                { source: "external_job_search", vocab: qualificationCtx.role_vocabulary });
              // The external pass only ever UPGRADES; it cannot demote evidence
              // the free pass already accepted.
              if (external.verdict === "hiring_verified") assessment = external;
            }
          }
        }

        c.hiring_assessment = assessment;
        c.hiring_jobs = hiringJobsFor(c, assessment);

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
      // Did this plan actually buy enrichment? A plan that never included the
      // step cannot be held to its absence.
      const enrichmentPlanned = opts.plan.steps.some(
        (s) => s.capability === "company_enrichment");
      // EVERY COMPANY WITH A DECISION REACHES THE BRAIN.
      //
      // This used to require `stage === "hiring_verified"`, so a lone Tier B or a
      // Tier C watch item was silently NOT_EVALUATED — no pass, no reject, no
      // unknown. That is how seven enriched companies produced a Brain summary of
      // "0 passed, 0 held as unknown": the eligible set was empty.
      //
      // ── AND WHY THAT FIX WAS NOT ENOUGH ──────────────────────────────────
      //
      // All three conditions read fields that ONLY `hiring_verification` wrote.
      // When the Mission did not ask for paid verification the capability was
      // never scheduled, so all three were false for every company and the
      // eligible set was empty again — this time for a hundred companies
      // (TEST run d787cfc7). The filter was not wrong; it was reading state
      // nobody had been asked to produce.
      //
      // The free assessment now runs HERE for any company that reached
      // enrichment without one, so the filter reads state that always exists.
      // An assessment is not a pass: `reachesCompanyBrain` still decides, and
      // `hiring_not_verified` still stays out.
      // AN UNRESOLVED IDENTITY IS STILL NOT EVALUATED.
      //
      // The guard is `identityIsActionable`, the SAME one the paid capability
      // uses for its targets. Widening it here to "has any open job" would
      // assess companies whose identity was never proven — and a company we
      // cannot identify is one whose founder could be attached to the wrong
      // employer. Unresolved stays `identity_pending` with a null verdict:
      // not a pass, not a rejection, and honestly reported as neither.
      for (const c of companies) {
        if (c.hiring_assessment === null && c.identity && identityIsActionable(c.identity)) {
          const free = freeHiringAssessment(c);
          c.hiring_assessment = free;
          c.hiring_jobs = hiringJobsFor(c, free);
        }
      }
      const eligible = companies.filter((c) =>
        c.record.stage === "hiring_verified" || c.hiring_jobs.length > 0 ||
        (c.hiring_assessment ? reachesCompanyBrain(c.hiring_assessment) : false));
      /** One company's canonical registry. Shared by both evaluation paths. */
      const registryFor = (c: EngineCompany) => buildEvidenceRegistry({
        evidence: buildCompanyEvidence({
          company_key: c.key,
          source_capability: opts.plan.entry_capability,
          source_query: opts.mission.original_user_query,
          company: c.company,
          enriched: c.enriched,
          identity_state: c.identity
            ? (identityIsActionable(c.identity) ? "resolved"
              : c.identity.status === "mismatch" ? "mismatch"
              : c.identity.status === "ambiguous" ? "ambiguous" : "unresolved")
            : "not_attempted",
          linkedin_company_url: c.identity?.linkedin_company_url ??
            c.company.linkedin_company_url ?? null,
          commercial_jobs: c.hiring_jobs.map((j) => ({
            title: j.title ?? "", url: j.job_url, location: j.location,
            posted_date: j.posted_date, tier: c.hiring_assessment?.tier ?? null,
          })),
          strongest_signal: c.hiring_assessment?.strongest?.title ?? null,
        }),
        // EMBEDDED **AND** EXTERNALLY VERIFIED openings, both as job evidence.
        jobs: dedupeJobs([...c.yc_open_jobs, ...c.hiring_jobs]),
        yc_description: c.company.description ?? null,
        // A FAILED PROVIDER IS RECORDED AS A FAILURE. Reading it as "nothing
        // found" would let an outage look like a company that is not hiring —
        // the one inference this whole stage exists to forbid.
        provider_failures: state.provider_attempts
          .filter((a) => a.outcome === "error" &&
            (a.capability === "hiring_verification" ||
              a.capability === "company_enrichment"))
          .map((a) => ({
            provider: a.provider, capability: a.capability,
            reason: a.reason ?? "provider call failed",
          })),
        employee_count_alternatives:
          c.enriched?.employee_count != null && c.company.employee_count != null &&
            c.enriched.employee_count !== c.company.employee_count
            ? [{ source: "discovery", value: c.company.employee_count }]
            : [],
      });

      // ══ STAGE 2 — COLLECT, THEN EVALUATE ═══════════════════════════════════
      //
      // The per-company path below evaluates while capabilities are still
      // running: each company is judged the moment it arrives, so nothing ever
      // holds the whole set and no model can compare two of them. It also
      // stopped after roughly ten calls, which meant a run that discovered forty
      // companies judged a quarter of them and reported the rest in an order
      // that had never read a description.
      //
      // When Stage 2 is enabled the set is COLLECTED first: free gates remove
      // only companies a verified fact contradicts, and the survivors are
      // evaluated in bounded batches. `groundedByKey` is what the loop below
      // then reads instead of calling the per-company grounder — the decision
      // logic itself is untouched, which is why the old path stays exactly as
      // it was when the flag is off.
      const groundedByKey = new Map<string, GroundedVerification>();
      let stage2Pool: EligiblePool | null = null;
      let stage2Restored = 0;
      if (deps.evaluateBatch && eligible.length > 0) {
        const registries = new Map(eligible.map((c) => [c.key, registryFor(c)]));
        for (const c of eligible) c.evidence_registry = registries.get(c.key)!;

        stage2Pool = buildEligiblePool(
          eligible.map((c) => ({
            company_key: c.key,
            company_name: (c.enriched ?? c.company).company_name ?? null,
            registry: registries.get(c.key)!,
          })),
          {
            mission: opts.mission,
            employee_min: opts.brain?.employee_min ?? null,
            employee_max: opts.brain?.employee_max ?? null,
          },
        );
        log("stage2_eligible_pool", stage2Pool.metrics);

        // THE COMPOSITION FINGERPRINT, AT THE ONLY POINT IT CAN BE TAKEN.
        // The restore-time check upstream compares mission hashes, because
        // discovery had not run when it read the checkpoint. This is the set
        // that was actually discovered, and it is what the ranking is compared
        // against below.
        const poolFingerprint = poolFingerprintOf(
          stage2Pool.eligible.map((p) => p.company_key));

        // RESTORED WORK IS NOT RE-BOUGHT. A continuation supplies the grounded
        // results its earlier invocation already paid for; those companies are
        // removed from the batch plan rather than skipped with an empty result.
        const restored = deps.restoredGroundedResults ?? new Map();
        const toEvaluate = stage2Pool.eligible.filter((p) => {
          const prior = restored.get(p.company_key);
          if (prior) {
            groundedByKey.set(p.company_key, prior);
            stage2Restored++;
            return false;
          }
          return true;
        });

        const requiresSignal =
          opts.mission.required_signals.some((s) => s.type === "hiring");
        const limits = deps.batchLimits ?? resolveBatchLimits({});
        const { batches, beyond_cap } = planBatches(toEvaluate, limits);
        for (const batch of batches) {
          // THE DEADLINE IS CHECKED BETWEEN BATCHES, never mid-batch. A batch
          // that started is allowed to finish; the companies in the batches
          // after it are recorded UNEVALUATED, which is a different and honest
          // thing from being reviewed.
          if (deps.deadline && shouldCheckpoint({
            elapsedMs: () => deps.deadline!.elapsedMs(),
            remainingMs: () => deps.deadline!.remainingMs(),
          }, deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS)) {
            state.terminal_reason = "execution_deadline_checkpoint";
            log("stage2_batch_deadline_stop", { evaluated: groundedByKey.size });
            break;
          }
          const members = batch.map((p) => ({
            company_key: p.company_key, company_name: p.company_name,
            registry: p.registry, requiresCommercialSignal: requiresSignal,
          }));
          const result = await deps.evaluateBatch(members);
          if (!result) continue;
          for (const o of result.outcomes) {
            if (o.verification) groundedByKey.set(o.company_key, o.verification);
          }
          await deps.onBatchComplete?.({
            evaluated: [...groundedByKey.entries()].map(([k, v]) => ({
              company_key: k, verification: v,
            })),
            next_offset: groundedByKey.size,
            pool_fingerprint: poolFingerprint,
          });
        }
        poolState = {
          pool: stage2Pool, restored: stage2Restored,
          evaluatedKeys: [...groundedByKey.keys()],
          fingerprint: poolFingerprint,
        };
        log("stage2_batch_evaluation_complete", {
          eligible: stage2Pool.eligible.length,
          evaluated: groundedByKey.size,
          restored: stage2Restored,
          beyond_cap,
        });
      }

      // Resolved once for the whole eligible set — the Mission's bounds when it
      // stated any, the Brain's as advisory-only when it did not.
      const fitBounds = resolveEmployeeBounds(qualificationCtx, {
        employee_min: opts.brain?.employee_min ?? null,
        employee_max: opts.brain?.employee_max ?? null,
      });

      // ── THE QUALIFICATION LOOP IS DEADLINE-BOUND TOO ───────────────────────
      //
      // It was not, and that is what hung task 6e218eeb for an hour. This loop
      // makes up to TWO model calls per company — the per-company grounder and
      // the Mission evaluator, roughly 7s and 5s — and it ran the whole eligible
      // set unconditionally. The batch stage above checks `shouldCheckpoint`
      // between batches; this one checked nothing.
      //
      // It only became reachable in anger once the per-company grounder started
      // working. Before that it returned a well-formed empty result almost
      // instantly, so twelve seconds a company was six companies' worth of
      // nothing. With the batch evaluator returning no rows and six companies
      // enriched, the loop spent ~72s past an already ~75s run and the platform
      // killed the isolate at ~150s — mid-company, before any checkpoint was
      // written. `tasks.result` stayed null, the row stayed `running`, and no
      // continuation was ever scheduled.
      //
      // A company this loop does not reach is NOT REACHED: no verdict, no
      // rejection, still on the frontier and still resumable. That is the same
      // rule the batch stage follows, and the reason stopping here is safe.
      let qualificationStopped = false;
      for (let qIndex = 0; qIndex < eligible.length; qIndex++) {
        const c = eligible[qIndex];
        if (deps.deadline && shouldCheckpoint({
          elapsedMs: () => deps.deadline!.elapsedMs(),
          remainingMs: () => deps.deadline!.remainingMs(),
        }, deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS)) {
          qualificationStopped = true;
          state.terminal_reason = "execution_deadline_checkpoint";
          log("qualification_deadline_stop", {
            evaluated: qIndex,
            not_reached: eligible.length - qIndex,
            remaining_ms: deps.deadline.remainingMs(),
          });
          break;
        }
        const src = c.enriched ?? c.company;
        c.fit = evaluateCompanyFit({
          company_key: c.key,
          company_name: src.company_name ?? null,
          identity_status: c.identity?.status ?? "unresolved",
          enrichment_complete: c.enriched !== null,
          employee_count: src.employee_count ?? null,
          employee_range_advisory: src.employee_range_advisory ?? null,
          // MISSION-RESOLVED BOUNDS. The Mission's range when it stated one;
          // otherwise null, because the workspace Brain's bounds are advisory
          // on an axis the user never mentioned and must not reject there.
          employee_min: fitBounds.enforceable ? fitBounds.min : null,
          employee_max: fitBounds.enforceable ? fitBounds.max : null,
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
          // THE MISSION'S CEILING, OR NONE AT ALL.
          //
          // This used to fall back to `?? 200` when the Mission set no bound,
          // reasoning that a generous default beat the workspace's narrower
          // preference. Both are preferences. With `CEILING_TOLERANCE` at 1.0
          // that default rejected every verified count above 400 — including
          // companies the Mission evaluator had explicitly passed, on a
          // constraint the user never expressed. A null ceiling is no gate.
          employee_ceiling: fitBounds.enforceable ? fitBounds.max : null,
          commercial_tier: c.hiring_assessment?.tier ?? null,
          // THE MISSION NAMED ITS ROLES, so "no commercial signal" is not a fact
          // this gate may reject on — see `failedHardGates`.
          mission_owns_hiring_role: qualificationCtx.mission_owns.hiring_role,
          semantic: null,
        };
        const hiringVerified = c.hiring_assessment?.verdict === "hiring_verified";

        // ── THE CANONICAL EVIDENCE REGISTRY, FOR EVERY COMPANY ──────────────
        //
        // BUILT FOR EVERY COMPANY that reaches qualification, before any branch
        // decides anything — because it is what the evaluator reasons over.
        //
        // It was built here for a different reason originally: there were three
        // qualification branches, and the deterministic-pass one wrote out a
        // semantic assessment in code — a hardcoded business model, and
        // supporting evidence that merely said the deterministic gates had
        // passed — which was the route most companies qualified through.
        // Grounding only the classifier branch would have left the commonest
        // route to QUALIFIED ungoverned. The inversion deleted that branch —
        // there is one evaluator call now — so the registry is no longer a way
        // to police a fabrication; it is the evaluator's input.
        //
        // The literals themselves are deliberately not repeated here: test 6b
        // in evaluationPathTelemetry greps this file for them, and cannot tell
        // a comment from live code.
        //
        // This is the only layer holding the discovery row, the enriched row
        // and the job evidence for one company at once, so it is the only place
        // the registry can be assembled without something upstream rebuilding
        // it from a projection. Nothing model-written enters it.
        const registry = registryFor(c);
        c.evidence_registry = registry;

        // ── GROUNDING: DOES THE MODEL'S STORY SURVIVE ITS OWN EVIDENCE? ─────
        const requiresCommercialSignal =
          opts.mission.required_signals.some((s) => s.type === "hiring");
        // STAGE 2 FIRST. When the pool phase above evaluated this company, its
        // verified result is used; the per-company grounder is the path for the
        // non-Stage-2 case and is not called twice for the same company.
        const grounded = groundedByKey.get(c.key)
          ?? (deps.groundCompany
            ? await deps.groundCompany({
              registry, requiresCommercialSignal, company_key: c.key,
            })
            : null);
        c.grounded = grounded ?? null;

        // ── ENFORCE ONLY, AND ENFORCE MEANS ENFORCE ─────────────────────────
        //
        // In shadow the verification is computed, stored and compared, and the
        // legacy decision is what the user sees — so "would enforcing change
        // this run?" gets an answer before enforcing does.
        //
        // IN ENFORCE, AN ABSENT GROUNDER IS ITSELF A REVIEW.
        //
        // This previously passed `null` when the grounder returned nothing,
        // which let the legacy classifier's verdict stand — so an outage
        // quietly restored exactly the ungrounded QUALIFIED that enforcing
        // exists to prevent, and did it at the moment there was least evidence
        // that the company deserved it. Enforce now degrades to REVIEW rather
        // than to the old behaviour: a human is asked, nobody is rejected, and
        // no company is qualified on a claim nothing checked.
        // ── THE VERIFIER'S FINDINGS, INCLUDING HOW MUCH IT ACTUALLY CHECKED ──
        //
        // The claim COUNTS travel, not just the verdict. Without them the Brain
        // cannot tell a verifier that refuted something from one that examined
        // nothing, and on run ea2d02f2 it could not: the grounder returned zero
        // validated, zero rejected, zero downgrade reasons and a `review`
        // verdict for every company, and every Mission pass was vetoed by that
        // silence. See `groundingRefutes`.
        const groundingForBrain = deps.groundingMode !== "enforce"
          ? null
          : grounded
          ? {
            final_grounded_decision: grounded.final_grounded_decision,
            grounding_score: grounded.grounding_score,
            validated_claim_types: [
              ...new Set(grounded.validated_claims.map((x) => x.claim_type)),
            ],
            downgrade_reasons: grounded.downgrade_reasons,
            validated_claims: grounded.validated_claims.length,
            rejected_claims: grounded.rejected_claims.length,
            unacknowledged_conflicts: grounded.unacknowledged_conflicts.length,
          }
          : {
            // UNAVAILABLE IS NOT REFUTED. The verifier did not run, so it found
            // nothing — `groundingRefutes` reads this as no finding and leaves
            // the Mission verdict standing. The reason is still recorded so an
            // outage is visible rather than inferred from a pile of holds.
            final_grounded_decision: "review" as const,
            grounding_score: 0,
            validated_claim_types: [] as string[],
            downgrade_reasons: [] as string[],
            validated_claims: 0,
            rejected_claims: 0,
            unacknowledged_conflicts: 0,
          };

        // ── A FALSIFIABLE FACT STILL REJECTS, AND ONLY A FALSIFIABLE FACT ───
        //
        // Four checkable facts, and nothing else:
        //
        //   identity_mismatch          the evidence describes a DIFFERENT company
        //   staffing_or_aggregator     the "company" is a job board
        //   excluded_industry          tier 2 — who this workspace can never sell to
        //   employee_count_*           tier 1 — and ONLY ever a MISSION-stated
        //                              bound, because `fitBounds.enforceable`
        //                              passes null for an advisory Brain range,
        //                              so these can physically not fire for a
        //                              workspace preference
        //
        // None is a judgement and none improves by asking a model: a verified
        // headcount of 400 against a stated maximum of 150 is arithmetic.
        //
        // `geography_mismatch` is deliberately NOT here. Its gate is
        // `geography.includes(required_geography)`, and "San Francisco, CA, USA"
        // does not contain "united states" — the check rejects the very
        // companies it is meant to keep. Geography travels to the evaluator
        // inside `brain.hard_constraints`, where a model that knows San
        // Francisco is in the United States can apply it properly. Everything
        // else the old gate rejected on — industry wording, business model, an
        // absent commercial tier — is evidence now, not a wall.
        const FALSIFIABLE_REJECTIONS: readonly string[] = [
          "identity_mismatch", "staffing_or_aggregator", "excluded_industry",
          "employee_count_above_max", "employee_count_below_min",
        ];
        const falsifiable = c.fit.stage === "company_fit_reject" &&
          FALSIFIABLE_REJECTIONS.includes(c.fit.reason);
        if (falsifiable) {
          c.evaluation_path = "fabricated_reject";
          c.decision_source = "hard_constraint_rejection";
          c.mission_evaluation = notEvaluated(
            `rejected on a verified fact before evaluation: ${c.fit.reason}`);
          c.brain = decideCompanyBrain({
            gates: gateInput,
            semantic: {
              business_model: "unknown", company_fit: "fail", confidence: 0.9,
              agentory_use_case: "none", supporting_evidence: [],
              conflicting_evidence: c.fit.failed_gates, unknown_fields: [],
              reason: `verified hard fact: ${c.fit.reason}`,
            },
            policy: appliedPolicy, hiring_verified: hiringVerified,
            grounding: groundingForBrain,
          });
          c.verdict = "reject";
          c.record = advance(c.record, "company_fit_reject", c.fit.reason);
          c.record.failed_gates = c.fit.failed_gates;
          continue;
        }

        // ── THE EVALUATOR DECIDES ───────────────────────────────────────────
        //
        // ONE CALL SITE. There used to be three, and two of them fabricated the
        // model's answer in code:
        //
        //   company_fit_pass   → {company_fit:"pass", confidence:0.8,
        //                         supporting_evidence:["deterministic gates passed"]}
        //   company_fit_reject → {company_fit:"fail", confidence:0.9}
        //
        // Those literals were then reported through
        // `semantic_classification_observability` as though a classifier had
        // produced them, so the telemetry said the model had run on paths where
        // it was never called. The evaluator was an exception handler for cases
        // deterministic code could not settle; it is now the thing that settles
        // them.
        //
        // `evaluateCompanyFit` still runs — above — but as an EVIDENCE
        // SUMMARISER. Its `missing_evidence` tells the evaluator what nobody
        // could establish; its verdict no longer decides.
        const evaluation = deps.evaluateMission
          ? await deps.evaluateMission({
            input: buildMissionEvaluationInput({
              ctx: qualificationCtx,
              authority: resolveBrainAuthority(qualificationCtx, opts.brain),
              registry,
              qualification_rules: opts.brainQualificationRules ?? null,
            }),
            registry,
            company_key: c.key,
          })
          : null;

        if (evaluation) {
          c.evaluation_path = "model_evaluated";
          c.decision_source = "gpt_evaluation";
          c.mission_evaluation = evaluation.evaluation;
          const e = evaluation.evaluation;
          c.brain = decideCompanyBrain({
            gates: gateInput,
            semantic: {
              // The evaluator's Mission verdict, which `decideCompanyBrain`
              // ranks above `company_fit`.
              mission_fit: e.mission_fit,
              icp_fit: e.icp_fit,
              match_score: e.match_score,
              // Kept for the existing telemetry contract. Derived from the
              // Mission verdict rather than asked for separately, so the two
              // cannot disagree.
              business_model: "unknown",
              company_fit: e.mission_fit,
              confidence: e.confidence,
              agentory_use_case: e.icp_fit === "strong"
                ? "strong" : e.icp_fit === "plausible" ? "plausible" : "weak",
              supporting_evidence: e.matched_requirements.map(
                (m) => `${m.requirement}: ${m.excerpt}`),
              conflicting_evidence: e.failed_requirements.map(
                (f) => `${f.requirement}: ${f.why}`),
              unknown_fields: [...new Set([...e.unknown_fields, ...c.fit.missing_evidence])],
              reason: e.reasoning,
            },
            policy: appliedPolicy, hiring_verified: hiringVerified,
            grounding: groundingForBrain,
          });
          c.classification = {
            verdict: e.mission_fit === "pass" ? "pass"
              : e.mission_fit === "fail" ? "fail" : "unknown",
            reason: e.reasoning,
            source: "mission_evaluation",
          };
          // ── ENRICHED EVIDENCE IS A PRECONDITION OF QUALIFYING ─────────────
          //
          // A FALSIFIABLE FACT, so deterministic code owns it rather than the
          // model. When the plan bought enrichment and the provider returned
          // nothing, the only company facts available are discovery-time
          // fields — YC's self-reported headcount, its own one-liner — and
          // qualifying on those is what the enrichment step exists to prevent.
          //
          // This is a HOLD, not a rejection. The provider failing says nothing
          // about the company, so the company becomes insufficient_evidence and
          // stays resolvable on a later run. Inferring "not a fit" from a failed
          // call is the one inference this architecture forbids outright.
          if (c.brain.outcome === "QUALIFIED" && enrichmentPlanned &&
              !enrichmentIsEvidence(c.enrichment_outcome)) {
            c.decision_source = "insufficient_evidence";
            c.verdict = "unknown";
            // WHICH of the four non-evidence outcomes, not merely that there was
            // none. A continuation treats `deferred` and `provider_error` as
            // still-owed work; `empty` is answered and will not improve on a
            // retry. The hold is identical, the reason is not.
            c.record.stage_reason = `enrichment_evidence_missing:${c.enrichment_outcome}`;
            c.record.missing_evidence.push(`company_enrichment:${c.enrichment_outcome}`);
            unknown++;
            continue;
          }
          if (c.brain.outcome === "QUALIFIED") {
            c.verdict = "pass";
            c.record = advance(c.record, "qualified_company", "mission_evaluation_pass");
            passed++;
          } else if (c.brain.outcome === "REJECT") {
            c.verdict = "reject";
            c.record = advance(c.record, "company_fit_reject", c.brain.reason);
            c.record.failed_gates = c.fit.failed_gates;
          } else {
            c.verdict = "unknown";
            c.record.stage_reason = `mission_evaluation_review:${c.brain.reason}`;
            c.record.missing_evidence.push(...c.fit.missing_evidence);
            unknown++;
          }
          continue;
        }

        // ── NO EVALUATOR: HELD, NEVER REJECTED ──────────────────────────────
        //
        // The flag is off, the workspace is not allow-listed, the budget is
        // spent, or the model failed. None of those is a fact about the
        // company. It is recorded as INSUFFICIENT EVIDENCE and reported as
        // never evaluated, which is the distinction the whole architecture
        // exists to preserve.
        // ── THE SECOND EVALUATOR IS DELETED ─────────────────────────────────
        //
        // This branch used to call the pre-Phase-4
        // semantic classifier on every company the Mission evaluator did not
        // reach. It was the ARCHITECTURE'S SECOND SEMANTIC AUTHORITY, and for a
        // long time the one that actually decided in production, because
        // `MISSION_EVALUATION` is off by default and this path is precisely the
        // one taken when it is.
        //
        // The authority inversion already stripped its verdict: `c.verdict`
        // became `unknown` regardless of what it said. What remained was a paid
        // model call per company whose only surviving purpose was to populate
        // `semantic_parse` and feed a `decideCompanyBrain` call whose result no
        // longer changed anything — an entire duplicate evaluator kept alive to
        // fill in telemetry fields.
        //
        // Now the absence is simply recorded. One semantic authority, one call
        // site, and a run with no evaluator makes no model call here at all —
        // it qualifies nobody and says so through `evaluation_paths` and
        // `mission_evaluation_observability`. Silence reported as silence.
        c.decision_source = "insufficient_evidence";
        c.mission_evaluation = notEvaluated("no evaluator was available for this run");
        c.evaluation_path = "model_unavailable";
        // The Brain still runs, with no semantic assessment, so the deterministic
        // gate record exists for a reviewer. It cannot QUALIFY without one — see
        // `decideCompanyBrain`, where an absent assessment is REVIEW.
        c.brain = decideCompanyBrain({
          gates: gateInput, semantic: null, policy: appliedPolicy,
          hiring_verified: hiringVerified, grounding: groundingForBrain,
        });
        c.classification = {
          verdict: "unknown",
          reason: "the mission evaluator did not run for this company",
          source: "unresolved",
        };
        // HELD, NOT REJECTED. The stage stays where the pipeline actually got
        // to; the verdict is what says nothing could decide.
        c.verdict = "unknown";
        c.record.stage_reason = `mission_evaluator_unavailable:${c.fit.reason}`;
        c.record.missing_evidence.push(...c.fit.missing_evidence, "mission_evaluation");
        unknown++;
      }
      state.qualified_company_keys = companies.filter((c) => c.verdict === "pass").map((c) => c.key);
      state.unknown_company_keys = companies.filter((c) => c.verdict === "unknown").map((c) => c.key);

      // "NOBODY PASSED" AND "NOBODY WAS OFFERED" ARE DIFFERENT FACTS.
      //
      // This reason string previously said the former in both cases. A run whose
      // eligible set was EMPTY reported `no company passed the Company Brain`,
      // which reads as twenty rejections and is how a scheduling gap was
      // mistaken for an ICP that was too strict. The distinction costs one
      // branch and is the whole point of the instrumentation.
      // A STAGE THAT STOPPED ON THE CLOCK IS NOT COMPLETE.
      //
      // Reporting `complete` would move the capability onto
      // `completed_capabilities`, and a continuation skips those — so the
      // companies the loop never reached would be skipped for the life of the
      // lineage, exactly as the deferred identity candidates once were.
      const reason = qualificationStopped
        ? `the checkpoint reserve was reached during qualification; ` +
          `${passed} passed and ${unknown} held so far, the rest were not reached`
        : passed > 0
        ? null
        : eligible.length === 0
        ? `no company reached the Company Brain: the eligible set was empty ` +
          `(${companies.length} compan${companies.length === 1 ? "y" : "ies"} ` +
          `carried no hiring assessment) — nothing was evaluated, nothing was rejected`
        : `no company passed the Company Brain; ${unknown} held as unknown pending evidence`;
      finish(
        cap,
        qualificationStopped ? "incomplete" : "complete",
        passed, [], passed > 0 && !qualificationStopped, reason,
      );

      // ── THE YIELD GATE: 2 OF 10 IS NOT A FINISHED RUN ────────────────────
      //
      // The pipeline used to stop here regardless of outcome. A run that
      // qualified 2 of a requested 10, with 39 eligible companies never
      // touched, reported itself complete — because the shortlist had been
      // spent, not because the goal was met or the pool exhausted.
      //
      // Everything selected so far is now closed as `investigated`, the next
      // slice is taken from the frontier, and the paid stages are re-opened for
      // it. The four guards live in `shouldTakeAnotherSlice`; the binding one is
      // the clock, which is measured fresh here rather than assumed.
      const qualifiedSoFar = companies.filter((c) => c.verdict === "pass").length;
      const frontierLeft = companies.filter(
        (c) => isFrontier(c.investigation_state)).length;
      const sliceCapacity = deps.deadline
        ? resolveTimeCapacity({
          remainingMs: deps.deadline.remainingMs(),
          reserveMs: deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS,
          concurrency: LINKEDIN_RESOLUTION_CONCURRENCY,
          enrichmentBatchSize: COMPANY_DETAILS_BATCH_SIZE,
          read: opts.readEnv,
          observedIdentityMs: deps.deadline.estimateFor("apify_linkedin_company_search"),
        }).capacity
        // No deadline (offline callers) ⇒ the clock cannot bind.
        : Number.MAX_SAFE_INTEGER;
      const yieldGate = shouldTakeAnotherSlice({
        qualified: qualifiedSoFar,
        requestedCount: effectiveRequestedCount(opts.mission),
        frontierRemaining: frontierLeft,
        passesTaken: investigationPass,
        timeCapacity: sliceCapacity,
        maxPasses: resolveMaxPasses(opts.readEnv),
      });
      log("investigation_yield_gate", {
        pass: investigationPass, qualified: qualifiedSoFar,
        requested: effectiveRequestedCount(opts.mission),
        frontier_remaining: frontierLeft, time_capacity: sliceCapacity,
        take_another_slice: yieldGate.take, reason: yieldGate.reason,
      });

      if (yieldGate.take) {
        closeInvestigatedSlice(companies);
        const taken = takeInvestigationSlice(companies, investigationPass + 1);
        if (taken > 0) {
          investigationPass++;
          // RE-OPEN THE PAID STAGES FOR THE NEW SLICE. They are complete for the
          // companies already carried; `shouldSkipProviderCall` is what stops
          // those being re-bought, not the completed list.
          for (const reopen of INVESTIGATION_CAPABILITIES) {
            state.completed_capabilities = state.completed_capabilities.filter(
              (x) => x !== reopen);
            if (!state.pending_capabilities.includes(reopen)) {
              state.pending_capabilities.push(reopen);
            }
          }
          const rewindTo = opts.plan.steps.findIndex(
            (x) => x.capability === "company_identity_resolution");
          if (rewindTo >= 0) {
            log("investigation_next_pass", {
              pass: investigationPass, selected: taken, rewind_to: rewindTo,
            });
            stepIndex = rewindTo - 1;   // the loop's ++ lands on identity
            continue;
          }
        }
      }
      // ── THE FRONTIER IS UNFINISHED WORK, AND THE LEDGER MUST SAY SO ────────
      //
      // Whatever is still on the frontier stays there, ranked and recoverable.
      // But "recoverable" was only ever half true: this invocation marked all
      // five capabilities COMPLETE and left `pending_capabilities` empty, while
      // 88 companies sat waiting. A continuation reads `completed_capabilities`
      // and skips what it finds there, so it would have skipped every stage and
      // done nothing — and because nothing was pending, the run reported
      // `round_limit_reached` rather than `continuation_required`, so the UI
      // never offered Continue either.
      //
      // That is why, across 202 sourcing tasks, seventeen asked for a
      // continuation and not one ever ran. The frontier, the checkpoint and the
      // resume guard were all correct and were never given anything to do.
      //
      // A run that stopped because it ran out of CLOCK has not finished
      // investigating. The paid stages are left PENDING so the next invocation
      // has real work, exactly as the multi-pass path above re-opens them.
      // Stopping because the quota was met, the frontier is empty, or the pass
      // ceiling was hit IS finished — those leave the ledger complete.
      // KEYED ON THE OUTCOME, NOT ON THE GATE'S REASON.
      //
      // Enumerating stop reasons missed a case the probe found: the gate can
      // say TAKE and the slice still come back empty, because carried in-flight
      // work has already consumed the allowance (`reason: "no_capacity"`). The
      // run wants to continue and cannot — which is a continuation if anything
      // is. Reached here at all, this invocation is making no further progress.
      //
      // So the question is simply: is there work left, and was it wanted?
      // Quota met ⇒ finished. Frontier empty ⇒ finished, and any shortfall is
      // real. Anything else is unfinished work that a continuation can advance.
      const carryFrontier = frontierLeft > 0 &&
        qualifiedSoFar < effectiveRequestedCount(opts.mission);
      if (carryFrontier) {
        for (const reopen of INVESTIGATION_CAPABILITIES) {
          state.completed_capabilities = state.completed_capabilities.filter(
            (x) => x !== reopen);
          if (!state.pending_capabilities.includes(reopen)) {
            state.pending_capabilities.push(reopen);
          }
        }
        // The terminal reason the checkpoint reads to decide whether a
        // continuation is required at all.
        state.terminal_reason = "execution_deadline_checkpoint";
        log("investigation_frontier_carried", {
          frontier_remaining: frontierLeft,
          qualified: qualifiedSoFar,
          requested: effectiveRequestedCount(opts.mission),
          reopened: [...INVESTIGATION_CAPABILITIES],
        });
      }
      closeInvestigatedSlice(companies);

      log("company_brain_qualification_complete", {
        ...summariseEvaluationPaths(companies),
        // The per-company array is already in the run result; the log carries
        // the aggregate only.
        companies: undefined,
        eligible: eligible.length,
        passed, unknown,
      });
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

  // ══ STAGE 2 — COMPARE THE POOL, THEN LET POLICY DECIDE WHAT SHIPS ═════════
  //
  // AFTER the plan, deliberately. Ranking is the one operation that needs every
  // company at once, so running it inside a capability would mean comparing a
  // set that was still being assembled.
  let pool: CapabilityRunResult["pool"] = null;
  if (poolState) {
    const evaluated = new Set(poolState.evaluatedKeys);
    const summaries: GroundedCandidateSummary[] = companies
      .filter((c) => evaluated.has(c.key))
      .map((c) => buildCandidateSummary({
        company_key: c.key,
        company_name: (c.enriched ?? c.company).company_name ?? null,
        brain_outcome: c.brain?.outcome ?? "REVIEW",
        tier: (c.hiring_assessment?.tier ?? null) as "A" | "B" | "C" | null,
        grounded: c.grounded,
      }));
    // An eligible company with no grounded result was never evaluated — the
    // deadline stopped the run, or its batch failed. Counted, never guessed at.
    const unevaluated = Math.max(0, poolState.pool.eligible.length - summaries.length);

    // ── DID THE POOL ITSELF CHANGE UNDER THIS MISSION? ───────────────────
    //
    // The restore check upstream can only compare mission hashes, so a
    // continuation that discovers a DIFFERENT set under the SAME mission
    // restores the verdicts of the companies still present, re-evaluates the
    // rest, and would otherwise present the resulting order as continuous with
    // the previous one. It is not: the pool being compared is not the pool the
    // earlier ranking described. Unknown is reported as unknown.
    const compositionChanged = deps.restoredPoolFingerprint
      ? deps.restoredPoolFingerprint !== poolState.fingerprint
      : null;
    if (compositionChanged) {
      log("stage2_pool_composition_changed", {
        restored_fingerprint: deps.restoredPoolFingerprint,
        current_fingerprint: poolState.fingerprint,
        note: "same mission, different discovered set; ranking recomputed for this pool",
      });
    }

    // SHADOW RUNS THE RANKER TOO. Its authority is what the mode governs, not
    // whether it executes — the earlier version only passed `rankPool` under
    // enforce, so shadow computed nothing and enforce would have been switched
    // on with no evidence about what it does.
    const rankingMode = deps.rankingMode ?? "shadow";
    let ranking: ValidatedRanking | null = null;
    if (deps.rankPool && summaries.length > 0) {
      // RANKING NEEDS TIME IT MAY NOT HAVE. When the reserve is already reached
      // the deterministic order ships and says so, rather than the run dying
      // holding an unordered pool.
      const outOfTime = deps.deadline
        ? shouldCheckpoint({
          elapsedMs: () => deps.deadline!.elapsedMs(),
          remainingMs: () => deps.deadline!.remainingMs(),
        }, deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS)
        : false;
      if (!outOfTime) {
        try {
          ranking = await deps.rankPool({
            summaries, requestedCount: effectiveRequestedCount(opts.mission),
            unevaluatedCount: unevaluated,
          });
        } catch (e) {
          // A RANKING OUTAGE IS AN ORDERING PROBLEM, NOT A RUN-ENDING ONE. The
          // pool is fully evaluated by this point; losing the comparison costs
          // a better order, and throwing would cost the whole run.
          log("stage2_ranking_failed", { error: String(e) });
          ranking = null;
        }
      } else {
        log("stage2_ranking_skipped_deadline", { evaluated: summaries.length });
      }
    }
    // `validatePoolRanking` with a null answer IS the deterministic fallback,
    // so there is one ordering function and no second code path to drift.
    //
    // ENFORCE lets the comparison decide the order. SHADOW ships the
    // deterministic order and records the difference instead — and says so, so
    // a reader can tell "the ranker is being observed" from "the ranker failed",
    // which the generic fallback reason cannot express.
    const shadowing = rankingMode !== "enforce";
    const validated = shadowing
      ? deterministicRanking(summaries, ranking
        ? "ranking computed in shadow mode; deterministic order shipped"
        : "shadow mode; no ranking was produced to compare")
      : ranking ?? validatePoolRanking({
        raw: null, summaries, requestedCount: effectiveRequestedCount(opts.mission),
      });
    // Computed in shadow only. Under enforce the ranking IS the order, so a
    // comparison against a hypothetical deterministic one would describe
    // nothing that happened.
    const rankingShadow = shadowing
      ? buildRankingShadowComparison({
        proposed: ranking, deterministic: validated, summaries,
        requestedCount: effectiveRequestedCount(opts.mission),
      })
      : null;
    if (rankingShadow) {
      log("stage2_ranking_shadow", {
        computed: rankingShadow.computed,
        proposed_source: rankingShadow.proposed_source,
        moved: rankingShadow.moved_count,
        would_enter: rankingShadow.would_enter_delivery.length,
        would_leave: rankingShadow.would_leave_delivery.length,
      });
    }
    pool = {
      eligible: poolState.pool.metrics,
      excluded: poolState.pool.excluded,
      summaries,
      ranking: validated,
      ranking_mode: rankingMode,
      ranking_shadow: rankingShadow,
      fingerprint: poolState.fingerprint,
      composition_changed: compositionChanged,
      delivery: applyPortfolioPolicy({
        ranking: validated, summaries,
        requestedCount: effectiveRequestedCount(opts.mission),
        eligibleCount: poolState.pool.eligible.length,
        unevaluatedCount: unevaluated,
      }),
      restored: poolState.restored,
      unevaluated,
    };
    log("stage2_pool_complete", {
      evaluated: summaries.length, unevaluated,
      ranking_source: validated.ranking_source,
      ranking_mode: rankingMode,
      composition_changed: compositionChanged,
      delivered: pool.delivery.metrics.delivered,
      shortfall: pool.delivery.metrics.shortfall,
    });
  }

  return {
    state,
    companies,
    pool,
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
    // ── THE STATE THAT SURVIVES THE PROCESS ────────────────────────────────
    //
    // This record IS the durable form of a deferred candidate: the checkpoint
    // writes it to `tasks.result`, so nine candidates the deadline never
    // reached come back as nine rows saying `identity: "deferred"` rather than
    // as an absence. `nextStageFor` reads `deferred` and `provider_error` as
    // "still owes identity", and `shouldSkipProviderCall` refuses to treat
    // either as done — so a continuation resumes precisely them.
    //
    // Checked BEFORE the resolution states, because a blocked company has no
    // resolution to report; checked against `capability` so an enrichment
    // failure cannot be recorded as an identity outcome.
    identity: c.identity === null && c.stage_block?.capability === "company_identity_resolution"
      ? (c.stage_block.reason === "provider_error" ? "provider_error" : "deferred")
      : c.identity === null ? "not_started"
      : identityIsActionable(c.identity) ? "resolved"
      : c.identity.status === "mismatch" ? "mismatch" : "unresolved",
    // THE SAME DISTINCTION IDENTITY ALREADY MAKES, now that enrichment records
    // it. `deferred` and `provider_error` are resumable — `nextStageFor` reads
    // them as "still owes enrichment" — while `empty` was answered and asking
    // again buys the same silence. Collapsing all three into `not_started`
    // (what this did) made a continuation re-buy the answered ones and made a
    // deferred one indistinguishable from a company that was never reached.
    enrichment: c.enriched !== null ? "completed"
      : c.enrichment_outcome === "deferred" ? "deferred"
      : c.enrichment_outcome === "provider_error" ? "provider_error"
      : c.enrichment_outcome === "empty" ? "empty"
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
    // ── THE DURABLE WORKING SET ────────────────────────────────────────────
    //
    // Written for EVERY company, not only the shortlisted ones, so a resume
    // restores the whole pool with its triage verdicts intact — an excluded
    // company must come back excluded rather than come back unknown, or the
    // Workbench would lose the reason it was never pursued.
    snapshot: {
      company: c.company as unknown as Record<string, unknown>,
      yc_open_jobs: c.yc_open_jobs.slice(0, MAX_SNAPSHOT_JOBS) as unknown as Record<
        string, unknown>[],
      prequalified: (c.prequalified ?? null) as unknown as Record<string, unknown> | null,
      prequal_key: c.prequal_key,
      shortlisted: c.shortlisted,
      enriched: (c.enriched ?? null) as unknown as Record<string, unknown> | null,
      // CARRIED, NOT RECOMPUTED. A restored company with no `enriched` row is
      // otherwise indistinguishable from one that was never attempted, so a
      // continuation would report a provider error or a deadline deferral as
      // `not_attempted` — losing precisely the fact the outcome exists to keep.
      enrichment_outcome: c.enrichment_outcome,
      // THE FRONTIER SURVIVES THE PROCESS. Without these three a continuation
      // cannot tell a company that is waiting from one that was closed, and the
      // pool is frozen at whatever the first invocation selected.
      investigation_state: c.investigation_state,
      investigation_rank: c.investigation_rank,
      triage: (c.triage ?? null) as unknown as Record<string, unknown> | null,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Rebuild the working set from a checkpoint — the missing half of resume.
 *
 * Discovery is the only step that populates `companies`, and a continuation
 * skips it as already-complete. Without this, every downstream stage on a
 * resumed run iterates an empty array and nothing is ever finished: deferred
 * identity candidates stay deferred forever, and the capability that stayed
 * `incomplete` to protect them can never reach a truthful completion.
 *
 * Restores identity and enrichment that were already PAID FOR, so a resumed run
 * continues from the evidence it owns rather than buying it again. Records
 * without a snapshot — checkpoints written before the field existed — are
 * skipped, which degrades to the previous behaviour instead of throwing.
 */
export function restoreWorkingSet(
  records: readonly CompanyResumeRecord[],
): EngineCompany[] {
  const out: EngineCompany[] = [];
  for (const r of records) {
    const s = r.snapshot;
    if (!s || !s.company) continue;
    addCompany(
      out,
      s.company as unknown as NormalizedHiringCompany,
      (s.yc_open_jobs ?? []) as unknown as NormalizedHiringJob[],
      s.prequal_key ?? null,
      // KEYED AS RECORDED. See `addCompany` — a restored company whose identity
      // resolved carries a LinkedIn url, and recomputing would rename it.
      r.company_key,
    );
    const c = out.find((x) => x.key === r.company_key);
    if (!c) continue;
    c.prequalified = (s.prequalified ?? null) as unknown as EngineCompany["prequalified"];
    c.shortlisted = s.shortlisted === true;
    c.enriched = (s.enriched ?? null) as unknown as NormalizedHiringCompany | null;
    // NARROWED, because a checkpoint is untrusted input. A record written
    // before this field existed has no outcome and degrades to `not_attempted`
    // — except where the evidence itself survived, which IS a success.
    c.enrichment_outcome = c.enriched !== null
      ? "success"
      : asEnrichmentOutcome(s.enrichment_outcome);
    // NARROWED, and an absent value returns the company to the FRONTIER rather
    // than closing it — the safe direction for a pre-frontier checkpoint.
    c.investigation_state = asInvestigationState(s.investigation_state);
    c.investigation_rank = typeof s.investigation_rank === "number"
      ? s.investigation_rank
      : Number.MAX_SAFE_INTEGER;
    c.triage = (s.triage ?? null) as unknown as TriageVerdict | null;
    // A company already carried to a terminal outcome must not re-enter the
    // frontier; `shortlisted` stays the derived view of that.
    c.shortlisted = wasInvestigated(c.investigation_state);
    // THE LEDGER OF WHAT WAS BOUGHT. `shouldSkipProviderCall` reads this, and it
    // is the only thing standing between a resume and paying twice.
    for (const op of r.completed_operations) {
      if (!c.completed_operations.includes(op)) c.completed_operations.push(op);
    }
  }
  return out;
}

/**
 * Capabilities that BUILD the working set.
 *
 * Skipping any of them on a resume is what leaves `companies` empty, so these
 * are exactly the steps that must trigger a restore.
 */
const WORKING_SET_CAPABILITIES: ReadonlySet<string> = new Set([
  "startup_company_discovery", "general_company_discovery", "known_company_resolution",
]);

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
  // ── A RUN THAT ENDED BEFORE ANY STAGE PUBLISHED STILL HAPPENED ───────────
  //
  // `publish()` runs at the END of a completed capability. When discovery
  // EXHAUSTS every approved provider — every Actor errored, or the entry
  // capability is one the engine does not drive — the loop breaks before the
  // first publish, so `state.progress` was never set. This function returned
  // null, run-agent then wrote no `workbench_progress`, and the frontend's
  // `readWorkbenchProgress` returned null: the Workbench rendered NOTHING.
  //
  // Nothing is the one answer that is never true. The run was attempted, and a
  // measured zero is a result — `progressLines` shows "Accounts found: 0" and
  // leaves every later counter correctly UNREACHED, so this states what
  // happened without implying any stage ran. The terminal reason itself travels
  // separately, on the route result.
  //
  // This is deliberately NOT a success: `qualified_companies` is 0, no
  // evaluation row is invented, and nothing becomes actionable.
  if (!state.progress) {
    if (state.completed_capabilities.length === 0 && !state.terminal_reason) return null;
    return {
      stage: "accounts_found",
      accounts_found: 0,
      evaluated: 0,
      eligible_opportunities: 0,
      exclusion_reasons: {},
      identity_resolved: 0,
      identity_unresolved: 0,
      companies_enriched: 0,
      hiring_verified: 0,
      qualified_companies: 0,
      decision_makers_verified: 0,
      open_jobs_evaluated: 0,
      shortlisted: 0,
      in_progress: false,
      awaiting_external_run: state.pending_runs.length > 0,
    };
  }
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

// `resolveTriageConcurrency` lives in `leadInvestigationBudget.ts` with the
// other capacity resolvers. THE ENGINE READS NO ENVIRONMENT OF ITS OWN — it
// takes `opts.readEnv` and passes it down, which is what keeps it runnable in a
// test without a process environment. Test 20 of `cappedIdentityResolution`
// enforces this by scanning this file for the runtime env accessor, so even
// naming it here would fail the guard.

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
 * SCORE the discovered rows — no provider, no cost, and NO SHORTLIST.
 *
 * ── WHAT WAS DELETED FROM HERE, AND WHY ─────────────────────────────────────
 *
 * This used to also DECIDE the shortlist, via
 * `shortlistForLinkedInResolution(result, requestedLeadCount, ceiling)` — which
 * is `min(ceiling, max(5, requestedLeadCount * 2))`, the exact coupling between
 * "how many leads to return" and "how many companies to pay for" that the
 * investigation budget exists to break.
 *
 * It was also DEAD. `applyMissionIntelligence` runs immediately afterwards and
 * overwrites `c.shortlisted` for every company unconditionally, so this
 * computed a spend decision, wrote it onto the working set, and had it
 * discarded microseconds later. Two shortlist mechanisms, one of them
 * load-bearing, the other still shaping `state.prequalification.shortlist_keys`
 * — which is what the run then REPORTED as the shortlist. The telemetry named a
 * set of companies that had not been the ones investigated.
 *
 * Prequalification now does only what it is good at: dedupe, drop scraper
 * artifacts, and score. Who gets paid for is decided once, downstream, by
 * `buildSmartShortlist` against the investigation budget.
 */
export function applyPrequalification(
  state: CapabilityExecutionState,
  companies: EngineCompany[],
  rawRows: readonly YcCompanyInput[],
  size: { min: number | null; max: number | null },
  /**
   * The Mission's qualification context. Omitted on a missionless run, where
   * the workspace Brain keeps its previous authority and behaviour is unchanged.
   */
  qualification?: QualificationContext | null,
): PrequalificationResult {
  // THE MISSION DECIDES WHAT COUNTS AS A QUALIFYING ROLE, AND WHETHER SIZE MAY
  // REJECT. Both used to be answered by the workspace Brain and a hard-coded
  // commercial role list, which is how a "hiring software engineers" Mission
  // qualified zero of a hundred companies (TEST run cf6cce3d).
  const bounds = qualification
    ? resolveEmployeeBounds(qualification, { employee_min: size.min, employee_max: size.max })
    : { min: size.min, max: size.max, enforceable: true, source: "brain_advisory" as const };
  const result = prequalifyYcCompanies(
    rawRows,
    { min: bounds.min, max: bounds.max },
    {
      vocabulary: qualification?.role_vocabulary ?? null,
      size_enforceable: bounds.enforceable,
    },
  );
  const byKey = new Map(result.companies.map((c) => [c.company_key, c]));

  // SCORE ONLY. `shortlisted` stays false until `buildSmartShortlist` decides
  // it against the investigation budget — see this function's header for the
  // duplicate that used to set it here and be discarded.
  for (const c of companies) {
    c.prequalified = c.prequal_key ? byKey.get(c.prequal_key) ?? null : null;
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

/** Concepts a general company search may be run for, already bounded. */
export interface CompanySearchConcepts {
  queries: string[];
  locations: string[];
  maxItemsPerQuery: number;
  /** Concepts that were dropped, and why. Persisted for audit. */
  rejected: Array<{ value: string; reason: string }>;
}

/** At most this many separate searches, whatever the mission asks for. */
export const MAX_COMPANY_SEARCH_QUERIES = 4;
/** At most this many rows per search. */
export const MAX_COMPANY_SEARCH_ROWS = 50;

const CONCEPT_URL = /https?:\/\/|www\.|\.[a-z]{2,6}(\/|$)/i;
const CONCEPT_VENDOR =
  /\b(apify|harvestapi|memo23|solidcode|crawlworks|actor|scraper|linkedin\.com)\b/i;

/**
 * Compile the concepts a general company search may look for.
 *
 * THE MISSION IS THE SOURCE, not free model text. Company types and verticals
 * come from the validated mission — which the user's own words already outrank —
 * and geography is applied as a FILTER rather than pasted into the query string,
 * because `searchQuery` is a name/concept index and a query carrying a country
 * name returns nothing.
 *
 * Everything is bounded and everything rejected is named:
 *   * URLs and vendor names are stripped — a concept is a business description,
 *     and a model that puts a provider or a link here is reaching for a control
 *     it does not have;
 *   * the query count is capped, because each one is a separate paid Actor run;
 *   * rows per query are capped;
 *   * a concept unrelated to the mission's own verticals is dropped, so an
 *     industrial-automation query cannot quietly acquire "SaaS".
 */
export function compileCompanySearchConcepts(
  mission: LeadMissionV1, maxCandidates: number,
): CompanySearchConcepts {
  const rejected: CompanySearchConcepts["rejected"] = [];
  const seen = new Set<string>();
  const queries: string[] = [];

  // The mission's own verticals first, then any soft company-type preference.
  const raw: string[] = [
    ...mission.company_profile.verticals,
    ...mission.company_profile.business_models,
  ];

  for (const value of raw) {
    const v = String(value ?? "").trim();
    if (!v) continue;
    if (CONCEPT_URL.test(v)) {
      rejected.push({ value: v, reason: "looks like a URL or domain, not a business concept" });
      continue;
    }
    if (CONCEPT_VENDOR.test(v)) {
      rejected.push({ value: v, reason: "names a provider or tool rather than a business" });
      continue;
    }
    // A NAME INDEX WANTS A SHORT CONCEPT. A whole sentence returns nothing, and
    // `compileHarvestCompanySearchInput` refuses it anyway — better to drop it
    // here with a reason than to spend a compile failure on it.
    if (v.split(/\s+/).length > 6) {
      rejected.push({ value: v, reason: "too long for a company-name index" });
      continue;
    }
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (queries.length >= MAX_COMPANY_SEARCH_QUERIES) {
      rejected.push({ value: v, reason: `beyond the ${MAX_COMPANY_SEARCH_QUERIES}-query cap` });
      continue;
    }
    queries.push(v);
  }

  // HARD GEOGRAPHY IS A FILTER, NOT A SEARCH TERM. Concatenating it into the
  // query is what turned "SnapMagic" into "SnapMagic snapmagic.com" and returned
  // zero rows six times.
  const locations = [...new Set(
    mission.company_profile.locations.map((l) => String(l).trim()).filter(Boolean),
  )].slice(0, 20);

  return {
    queries,
    locations,
    maxItemsPerQuery: Math.max(1, Math.min(
      MAX_COMPANY_SEARCH_ROWS,
      Math.ceil(maxCandidates / Math.max(1, queries.length)),
    )),
    rejected,
  };
}

function packTitles(packs: readonly RolePack[]): string[] {
  return [...new Set(packs.flatMap((p) => p.titles))].slice(0, 20);
}

function addCompany(
  set: EngineCompany[], c: NormalizedHiringCompany, ycJobs: NormalizedHiringJob[],
  prequalKey: string | null = null,
  /**
   * THE KEY THIS COMPANY ALREADY HAD, when restoring one rather than
   * discovering it.
   *
   * `companyKey` prefers `linkedin_company_url` over the domain, and identity
   * resolution WRITES that url back onto `company`. So recomputing the key for
   * a restored company would produce `li:…` where the original run recorded
   * `acme.com`, and every ledger entry keyed on the old value — completed
   * operations included — would stop matching. The recorded key is authoritative.
   */
  explicitKey?: string,
): void {
  const key = explicitKey ?? companyKey(c);
  if (set.some((x) => x.key === key)) return;
  set.push({
    key, prequal_key: prequalKey, prequalified: null, shortlisted: false,
    triage: null, shortlist_exclusion: null,
    // PENDING, NOT EXCLUDED. A company enters the frontier and leaves it only
    // by being investigated or by a decision that closes it.
    investigation_state: "pending_investigation", investigation_rank: Number.MAX_SAFE_INTEGER,
    company: c, identity: null, stage_block: null, enriched: null,
    // NOT_ATTEMPTED IS THE HONEST DEFAULT, exactly as with `evaluation_path`.
    // A company leaves it only when the stage actually tries.
    enrichment_outcome: "not_attempted",
    yc_open_jobs: ycJobs, hiring_jobs: [], fit: null, hiring_assessment: null,
    brain: null, completed_operations: [],
    evidence_registry: null, grounded: null,
    classification: null, verdict: null,
    // NOT_REACHED IS THE HONEST DEFAULT. A company only leaves this state when
    // some branch actually decides it.
    evaluation_path: "not_reached",
    decision_source: "not_evaluated",
    mission_evaluation: null,
    founders: [], verified_founders: [], contact_identities: [],
    record: newCompanyRecord(key),
  });
}

// --------------------------------------------------- evaluation telemetry ----

export const EVALUATION_PATH_VERSION = "evaluation-path-telemetry-v1" as const;

export interface EvaluationPathSummary {
  version: typeof EVALUATION_PATH_VERSION;
  /** Companies the Brain's eligible filter actually admitted. */
  reached_evaluation: number;
  /** Verdicts produced WITHOUT consulting a model. */
  decided_without_model: number;
  /** Verdicts produced WITH a parsed model response. */
  decided_by_model: number;
  counts: Record<EvaluationPath, number>;
  /** Per company, so a single row can be explained. */
  companies: Array<{
    company_key: string;
    company_name: string | null;
    evaluation_path: EvaluationPath;
    verdict: "pass" | "reject" | "unknown" | null;
    brain_outcome: BrainDecision["outcome"] | null;
    /** True when the grounded classifier produced a verification for this company. */
    grounded: boolean;
    /** Whether the model decided, a fact decided, or nobody looked. */
    decision_source: DecisionSource;
    /** The evaluator's own terminal answer, when it ran. */
    decision: MissionEvaluation["decision"] | null;
    mission_fit: MissionEvaluation["mission_fit"] | null;
    icp_fit: MissionEvaluation["icp_fit"] | null;
    match_score: number | null;
  }>;
}

/**
 * WHO ACTUALLY DECIDED, per company and in aggregate.
 *
 * This is the measurement the previous audit had to reconstruct by hand from
 * three disagreeing fields. `decided_by_model` is the number the architecture
 * correction is judged on: today it is expected to be ZERO, and a run where it
 * stays zero after the inversion means the inversion did not land.
 *
 * PURE. Reads finished state, changes nothing.
 */
export function summariseEvaluationPaths(
  companies: readonly EngineCompany[],
): EvaluationPathSummary {
  const counts: Record<EvaluationPath, number> = {
    not_reached: 0, fabricated_pass: 0, fabricated_reject: 0,
    model_evaluated: 0, model_unavailable: 0,
  };
  for (const c of companies) counts[c.evaluation_path]++;
  return {
    version: EVALUATION_PATH_VERSION,
    reached_evaluation: companies.length - counts.not_reached,
    decided_without_model: counts.fabricated_pass + counts.fabricated_reject +
      counts.model_unavailable,
    decided_by_model: counts.model_evaluated,
    counts,
    companies: companies.map((c) => ({
      company_key: c.key,
      company_name: c.company.company_name ?? null,
      evaluation_path: c.evaluation_path,
      verdict: c.verdict,
      brain_outcome: c.brain?.outcome ?? null,
      grounded: c.grounded !== null,
      decision_source: c.decision_source,
      decision: c.mission_evaluation?.decision ?? null,
      mission_fit: c.mission_evaluation?.mission_fit ?? null,
      icp_fit: c.mission_evaluation?.icp_fit ?? null,
      match_score: c.mission_evaluation?.match_score ?? null,
    })),
  };
}

/**
 * ONE ORDERED WALK OF THE PIPELINE, built from the companies themselves.
 *
 * The adapter between engine state and `buildMissionFunnel`. Every field is
 * READ, never recomputed — the funnel exists to join views that already agree,
 * and deriving anything here would let it drift from the Workbench and the
 * checkpoint the way two independent counters always eventually do.
 */
export function toFunnelCompanies(
  companies: readonly EngineCompany[],
  opts: { persistedKeys?: readonly string[] } = {},
): FunnelCompany[] {
  const persisted = new Set(opts.persistedKeys ?? []);
  return companies.map((c) => ({
    key: c.key,
    prequalified: c.prequalified !== null,
    triage: c.triage?.relevance ?? null,
    shortlisted: c.shortlisted,
    shortlist_exclusion: c.shortlist_exclusion,
    awaiting_investigation: isFrontier(c.investigation_state),
    // BLOCKED IS CHECKED FIRST. A company the deadline stopped has no identity
    // outcome to report, and calling that "unresolved" would turn a clock
    // decision into a permanent fact about the company.
    identity: c.stage_block?.capability === "company_identity_resolution"
      ? "blocked"
      : c.identity === null ? "not_attempted"
      : identityIsActionable(c.identity) ? "resolved"
      : c.identity.status === "mismatch" ? "mismatch" : "unresolved",
    enrichment: c.enrichment_outcome,
    reached_brain: c.brain !== null,
    brain: c.brain?.outcome ?? null,
    evaluated: c.decision_source === "gpt_evaluation",
    decision_source: c.decision_source,
    verdict: c.verdict,
    persisted: persisted.has(c.key),
  }));
}

/** The funnel for a finished (or partial) run. */
export function missionFunnelFor(
  companies: readonly EngineCompany[],
  opts: { persistedKeys?: readonly string[] } = {},
): MissionFunnel {
  return buildMissionFunnel(toFunnelCompanies(companies, opts));
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
