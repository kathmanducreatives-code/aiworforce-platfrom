// ORDERED HIRING-SOURCE PLANNING — which approved channel runs first, and what
// has to be true before the next one is allowed to run at all.
//
// A plan says WHERE to look and IN WHAT ORDER. It never says whether a company
// qualifies: that stays with the Company Brain gate (PR #104) and the canonical
// decision, and a strong hiring signal from any source cannot buy past it. It
// never says who to contact: that stays with the decision-maker workflow (PR #105).
//
// WHY ORDERED RATHER THAN A SET OF LANES.
//
// An unordered lane list is really an instruction to run everything. Five sources
// fired at once costs five times as much as one, and for most missions the first
// source already fills a five-lead quota — so four of the five calls were pure
// waste that nobody asked for. Worse, a lane list has no place to record WHY a
// source was chosen or WHEN it should stop, which makes both cost control and
// debugging guesswork. The graph below makes each of those explicit: one step is
// initially active, every later step names the condition that would activate it,
// and the whole plan carries the quota that ends it.
//
// This module owns three things and delegates everything else:
//   * the plan CONTRACT a planner may return
//   * VALIDATION, deterministic repair and acyclicity of that contract
//   * a DETERMINISTIC planner for when Claude is off, unavailable or unsafe
//
// It resolves capabilities through `hiringSourceCatalog`, compiles through
// `actorInputPlanner`, hashes through `planHash`, and reads flags through the
// existing intelligence flag resolver. No second authority for any of those.
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import { isIntelligenceFlagEnabled, type EnvReader } from "./intelligence/intelligenceFlags.ts";
import {
  HIRING_SOURCE_CATALOG, isHiringSourceCapability, resolveHiringSourceActor,
  type HiringSourceCapabilityId,
} from "./hiringSourceCatalog.ts";

export const HIRING_SOURCE_PLAN_VERSION = "ordered-hiring-source-plan-v1";
export const DYNAMIC_SOURCE_WORKSPACES_ENV = "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES";

// ------------------------------------------------------------ enablement ----

export interface SourcePlanningEnablement {
  enabled: boolean;
  reason: "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed" | "enabled";
}

/**
 * Both conditions required, no wildcard. An empty allow-list enables nobody even
 * with the flag on, so "on for everyone" is not a state this can return.
 */
export function isDynamicSourcePlanningEnabled(workspaceId: string, read?: EnvReader): SourcePlanningEnablement {
  if (!isIntelligenceFlagEnabled("DYNAMIC_HIRING_SOURCE_PLANNING", read)) {
    return { enabled: false, reason: "flag_off" };
  }
  let allow: string[] = [];
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    allow = String(get(DYNAMIC_SOURCE_WORKSPACES_ENV) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    return { enabled: false, reason: "no_workspace_allowlist" };
  }
  if (allow.length === 0) return { enabled: false, reason: "no_workspace_allowlist" };
  if (!allow.includes(String(workspaceId))) return { enabled: false, reason: "workspace_not_allowed" };
  return { enabled: true, reason: "enabled" };
}

// ------------------------------------------------------- mission profile ----

export type TriggerRequirement =
  | "active_hiring" | "recent_funding" | "expansion" | "product_launch"
  | "leadership_change" | "technology_usage" | "local_presence" | "general_company_fit";

/**
 * What the mission needs, in source-planning terms.
 *
 * Derived from the Lead mission, the Company Brain and the ICP by the caller —
 * this module never re-parses the user's sentence, because the Lead mission is
 * already the authority on what was asked for.
 */
export interface LeadMissionSourceProfile {
  companyCategory?: string[];
  industries?: string[];
  businessModels?: string[];
  stages?: string[];
  employeeRange?: { min?: number; max?: number };

  triggerRequirements: TriggerRequirement[];

  hiring?: {
    required: boolean;
    roleFamily?: string;
    approvedAliases?: string[];
    geography?: string;
    maximumPostingAgeDays?: number;
  };

  decisionMakerRoles: string[];
  currentEmployerRequired: boolean;

  requestedCount: number;
  countEntity: "contact_ready_lead";
  quotaPolicy: "contact_only";

  requiredEvidence: string[];
}

// ------------------------------------------------------- safe broadening ----
//
// A CLOSED union. Broadening may make the SAME question easier to answer; it may
// never change the question. Everything that would change the question — employee
// ceiling, stage, industry, business model, founder-led requirement, hard
// geography, decision-maker roles, current-employer requirement, CONTACT-only
// quota, budget — is simply absent from this type, so there is no shape a planner
// can return that expresses it.

export type SafeBroadeningAction =
  | { action: "add_approved_role_aliases"; aliases: string[] }
  | { action: "use_equivalent_query_wording"; wording: string }
  | { action: "include_supported_remote_variants"; remotePolicy: string }
  | { action: "extend_recency_window"; postingWindowDays: number }
  | { action: "increase_result_target"; candidateTarget: number }
  | { action: "activate_broader_approved_source"; capability: HiringSourceCapabilityId }
  | { action: "activate_fallback_source"; capability: HiringSourceCapabilityId };

export const SAFE_BROADENING_ACTIONS: readonly SafeBroadeningAction["action"][] = [
  "add_approved_role_aliases", "use_equivalent_query_wording", "include_supported_remote_variants",
  "extend_recency_window", "increase_result_target", "activate_broader_approved_source",
  "activate_fallback_source",
];

export function isSafeBroadeningAction(a: unknown): a is SafeBroadeningAction {
  const action = (a as { action?: unknown })?.action;
  return typeof action === "string" && (SAFE_BROADENING_ACTIONS as readonly string[]).includes(action);
}

/**
 * Constraints no broadening action may ever touch. Asserted, not assumed.
 *
 * The closed union above already makes these inexpressible. This list exists so
 * that intent is stated positively and a test can walk it: if someone later adds a
 * rung that would move one of these, the union stops being the only guard and this
 * becomes the thing that catches it.
 */
export const IMMUTABLE_CONSTRAINTS = [
  "employee_maximum", "company_stage", "industry", "business_model", "founder_led",
  "hard_geography", "decision_maker_roles", "current_employer_required",
  "contact_only_quota", "provider_budget",
] as const;

export type ImmutableConstraint = typeof IMMUTABLE_CONSTRAINTS[number];

// ------------------------------------------------------------ the contract --

export type SourceStepRole =
  | "precision_discovery" | "broad_discovery" | "cross_check" | "recall_fallback" | "verification";

export type SourceActivationCondition =
  | "initial"
  | "remaining_contact_quota"
  | "low_raw_volume"
  | "low_company_brain_yield"
  | "insufficient_unique_companies"
  | "weak_or_conflicting_job_evidence"
  | "known_ats_identity";

export type SourceAdvanceCondition =
  | "source_exhausted"
  | "no_safe_broadening_remaining"
  | "insufficient_incremental_yield"
  | "quota_remains_and_budget_remains";

export type SourceStopCondition =
  | "contact_ready_quota_reached"
  | "budget_exhausted"
  | "maximum_provider_calls_reached"
  | "valid_exhaustion";

export interface OrderedSourceStep {
  stepId: string;
  order: number;
  capability: HiringSourceCapabilityId;
  role: SourceStepRole;
  reason: string;
  activationCondition: SourceActivationCondition;

  semanticIntent: {
    roleFamily?: string;
    approvedTitleAliases?: string[];
    geography?: string;
    postingWindowDays?: number;
    remotePolicy?: string;
    employmentTypes?: string[];
    companyCategory?: string[];
    candidateTarget: number;
    exclusionConcepts?: string[];
  };

  successCondition: {
    contactReadyTarget?: number;
    minimumQualifiedCompanies?: number;
    minimumIncrementalYield?: number;
  };

  broadeningLadder: SafeBroadeningAction[];
  advanceConditions: SourceAdvanceCondition[];
  stopConditions: SourceStopCondition[];
  nextStepId?: string;
}

export interface OrderedHiringSourcePlan {
  version: typeof HIRING_SOURCE_PLAN_VERSION;
  planHash: string;
  missionProfile: LeadMissionSourceProfile;
  steps: OrderedSourceStep[];

  completionCondition: { metric: "contact_ready_count"; target: number };
  validExhaustionCondition: { allApprovedStepsExhausted: true; noSafeBroadeningRemaining: true };

  maximumSourceSteps: number;
  maximumBroadeningAttempts: number;
  maximumProviderCalls: number;
  maximumEstimatedCostUsd: number;

  /**
   * Set when the approved sources structurally cannot serve the mission.
   *
   * The five approved Actors are all JOB scrapers. A mission that never requires
   * hiring evidence ("find dental clinics in Austin") is not a planning failure —
   * it is a question this capability set cannot answer, and saying so is more
   * useful than spending budget pretending otherwise.
   */
  capabilityGap: { code: "unsupported_capability_gap"; reason: string } | null;
}

// ------------------------------------------------------------ observation ---

/**
 * What one attempt at one step actually produced.
 *
 * PR #106 defines and tests this shape; a later PR populates it from real
 * sequential execution. It is the input to `decideNextAction`, which is the only
 * thing allowed to choose what happens next.
 */
export interface SourceStepObservation {
  stepId: string;
  capability: string;
  attempt: number;

  funnel: {
    rawResults: number;
    normalizedJobs: number;
    uniqueCompanies: number;
    companyBrainPass: number;
    companyBrainFail: number;
    evidencePending: number;
    strongIdentity: number;
    peopleSearched: number;
    employerVerified: number;
    contactReady: number;
  };

  rejectionSummary: {
    wrongRole: number;
    wrongGeography: number;
    companyBrainMismatch: number;
    missingIdentity: number;
    missingDecisionMaker: number;
    employerMismatch: number;
    missingContactMethod: number;
  };

  incrementalContactReady: number;
  totalContactReady: number;
  remainingQuota: number;
  remainingBudgetUsd: number;

  sourceExhausted: boolean;
  broadeningActionsUsed: string[];
}

// ---------------------------------------------------------- next actions ----
//
// A CLOSED union again. A planner may RECOMMEND exactly one of these; natural
// language never becomes an executable action, because there is no free-text
// variant to put it in.

export type ApprovedSourceNextAction =
  | { action: "stop_quota_reached" }
  | { action: "broaden_current_source"; stepId: string; broadeningAction: SafeBroadeningAction }
  | { action: "advance_to_next_source"; currentStepId: string; nextStepId: string }
  | { action: "verify_selected_jobs"; companyIds: string[] }
  | { action: "enrich_company_identity"; companyIds: string[] }
  | { action: "enrich_contacts"; personIds: string[] }
  | { action: "stop_valid_exhaustion"; reason: string };

/**
 * What the RUNTIME knows that the plan cannot.
 *
 * A plan is a graph of intentions; this is what actually happened to it. The two
 * are separate because the plan is authored once and the state changes with every
 * attempt — but a decision made from the plan alone can name a step that has
 * already finished, which is a decision nobody can execute.
 *
 * Every field is optional. Omitting the whole context is the pre-PR-#110 behavior,
 * exactly, which is what keeps existing callers correct.
 */
export interface SourceRuntimeState {
  /** Steps that ran and finished: completed, exhausted, failed or quota-inactive. */
  finishedStepIds?: string[];
  /** Broadening rungs already spent, per step. Never reoffered. */
  broadeningUsedByStep?: Record<string, string[]>;
  /**
   * Rungs known to compile to a provider input this step ALREADY SENT.
   *
   * Compilation is async and belongs to the runtime, so the fact is supplied
   * rather than derived here — this module stays pure. A rung listed here is
   * ineligible: re-sending an identical input pays again for a call whose answer
   * is already in hand.
   */
  duplicateBroadeningByStep?: Record<string, string[]>;
  providerCallsUsed?: number;
  cumulativeCostUsd?: number;
}

/** Has this step already finished, as far as the runtime is concerned? */
export function stepIsFinished(runtime: SourceRuntimeState | undefined, stepId: string): boolean {
  return (runtime?.finishedStepIds ?? []).includes(stepId);
}

/**
 * The rungs of this step's ladder that may still be spent.
 *
 * Three exclusions, and they are different questions: the observation reports what
 * THIS attempt already used, the runtime reports what the STEP has used across
 * attempts, and the duplicate map reports what would compile to a call already
 * paid for. A rung has to clear all three.
 */
export function eligibleBroadening(
  step: OrderedSourceStep,
  observation: SourceStepObservation,
  runtime?: SourceRuntimeState,
): SafeBroadeningAction[] {
  const used = new Set<string>([
    ...(observation.broadeningActionsUsed ?? []),
    ...(runtime?.broadeningUsedByStep?.[step.stepId] ?? []),
    ...(runtime?.duplicateBroadeningByStep?.[step.stepId] ?? []),
  ]);
  return (step.broadeningLadder ?? []).filter((b) => isSafeBroadeningAction(b) && !used.has(b.action));
}

/**
 * The next step that can actually run, following the ORDERED CHAIN.
 *
 * Finished steps are stepped over rather than stopped at — a completed second
 * source should not end a run that still has a third — but only along the chain
 * the plan itself authored. There is no search for "some later step that looks
 * eligible", because that is precisely the arbitrary jump the ordered contract
 * exists to prevent.
 *
 * Returns null when the chain runs out, which is what makes honest exhaustion
 * reachable instead of an advance nobody can execute.
 */
export function nextExecutableStepId(
  plan: OrderedHiringSourcePlan,
  from: OrderedSourceStep,
  runtime?: SourceRuntimeState,
): string | null {
  const byId = new Map(plan.steps.map((s) => [s.stepId, s]));
  const seen = new Set<string>([from.stepId]);
  let candidateId = from.nextStepId;

  while (candidateId) {
    // The plan is validated acyclic, but a checkpoint can outlive the validation
    // that produced it, so the walk refuses to visit the same step twice.
    if (seen.has(candidateId)) return null;
    seen.add(candidateId);

    const candidate = byId.get(candidateId);
    if (!candidate) return null;
    if (!stepIsFinished(runtime, candidate.stepId)) return candidate.stepId;
    candidateId = candidate.nextStepId;
  }
  return null;
}

/**
 * The deterministic next move.
 *
 * Agentory decides this, not the planner — a recommendation is only ever compared
 * against this result. The order of the checks is the policy: quota first (so a
 * satisfied request never spends another cent), then broadening within the current
 * source (cheaper than a new vendor), then advancing, then honest exhaustion.
 *
 * `runtime` makes the decision STATE-AWARE. Without it this consulted the plan
 * only, and would happily return `advance_to_next_source` toward a step already
 * marked completed or exhausted. The executor refused that step, so no duplicate
 * work was ever paid for — but the decision was still one nobody could carry out,
 * and a run whose only remaining instruction is impossible is a run that has
 * stalled without saying so. With the runtime supplied, every action this returns
 * is one the current state can actually execute.
 *
 * The parameter is optional so existing callers keep their exact behavior.
 */
export function decideNextAction(
  plan: OrderedHiringSourcePlan,
  observation: SourceStepObservation,
  runtime?: SourceRuntimeState,
): ApprovedSourceNextAction {
  if (observation.totalContactReady >= plan.completionCondition.target) {
    return { action: "stop_quota_reached" };
  }

  const step = plan.steps.find((s) => s.stepId === observation.stepId);
  if (!step) return { action: "stop_valid_exhaustion", reason: "unknown_step" };

  if (observation.remainingBudgetUsd <= 0) {
    return { action: "stop_valid_exhaustion", reason: "budget_exhausted" };
  }
  if (runtime?.cumulativeCostUsd != null && runtime.cumulativeCostUsd >= plan.maximumEstimatedCostUsd) {
    return { action: "stop_valid_exhaustion", reason: "budget_exhausted" };
  }
  // A step nobody can pay to call is not an option, so the ceiling ends the run
  // here rather than producing an advance the executor would refuse.
  if (runtime?.providerCallsUsed != null && runtime.providerCallsUsed >= plan.maximumProviderCalls) {
    return { action: "stop_valid_exhaustion", reason: "maximum_provider_calls_reached" };
  }

  // Broaden the CURRENT source before paying a new vendor — but only with a rung
  // of this step's own ladder that has not been used yet, and only while the
  // attempt budget allows.
  if (
    !observation.sourceExhausted
    && !stepIsFinished(runtime, step.stepId)
    && observation.attempt < plan.maximumBroadeningAttempts
  ) {
    const next = eligibleBroadening(step, observation, runtime)[0];
    if (next) return { action: "broaden_current_source", stepId: step.stepId, broadeningAction: next };
  }

  const nextStepId = nextExecutableStepId(plan, step, runtime);
  if (nextStepId) {
    return { action: "advance_to_next_source", currentStepId: step.stepId, nextStepId };
  }

  return { action: "stop_valid_exhaustion", reason: "all_approved_steps_exhausted" };
}

// ---------------------------------------------------------- deterministic ----

/** Does this mission describe early-stage / venture-backed technology companies? */
function looksEarlyStageTech(p: LeadMissionSourceProfile): boolean {
  const stages = (p.stages ?? []).join(" ").toLowerCase();
  const inds = [...(p.industries ?? []), ...(p.companyCategory ?? [])].join(" ").toLowerCase();
  const earlyStage = /pre-?seed|seed|series a|early/.test(stages);
  const techVertical = /saas|software|developer tool|devtool|dev-tool|api|platform|b2b tech|technology/.test(inds);
  return earlyStage && techVertical;
}

/**
 * Developer tooling specifically.
 *
 * Separated from general SaaS because it changes the ORDER, not just the mix:
 * these companies are engineering-dense with unusually strong professional-network
 * presence and near-universal Greenhouse/Lever/Ashby adoption. That makes LinkedIn
 * a better second source than Indeed, and makes ATS verification worth reaching
 * before the Glassdoor recall fallback.
 */
function looksDeveloperTooling(p: LeadMissionSourceProfile): boolean {
  const blob = [...(p.industries ?? []), ...(p.companyCategory ?? []), ...(p.businessModels ?? [])]
    .join(" ").toLowerCase();
  return /developer tool|devtool|dev-tool|developer platform|api|infrastructure|devops|developer/.test(blob);
}

/** A local service business — structurally outside every approved source. */
function looksLocalService(p: LeadMissionSourceProfile): boolean {
  const blob = [...(p.industries ?? []), ...(p.companyCategory ?? [])].join(" ").toLowerCase();
  return /dental|clinic|salon|restaurant|retail store|gym|spa|plumb|hvac|landscap/.test(blob);
}

function stepId(capability: HiringSourceCapabilityId, order: number): string {
  return `s${order}-${capability}`;
}

interface StepSeed {
  capability: HiringSourceCapabilityId;
  role: SourceStepRole;
  reason: string;
  activation: SourceActivationCondition;
  share: number;
}

/**
 * The ordered source sequence for a mission.
 *
 * Composed from derived PROFILE attributes — early-stage, developer tooling,
 * local service, hiring required — never from the literal sentence. Two missions
 * with the same shape get the same plan whatever words they used.
 */
function orderedSeeds(p: LeadMissionSourceProfile): StepSeed[] {
  const earlyTech = looksEarlyStageTech(p);
  const devtool = looksDeveloperTooling(p);

  if (earlyTech) {
    // YC first: for early-stage technology hiring it is by far the highest
    // precision channel, and a five-lead quota is frequently filled there alone.
    const seeds: StepSeed[] = [{
      capability: "yc_job_discovery", role: "precision_discovery", activation: "initial", share: 0.35,
      reason: "Early-stage technology mission: YC is the highest-precision startup hiring channel.",
    }];

    if (devtool) {
      seeds.push({
        capability: "linkedin_job_discovery", role: "broad_discovery",
        activation: "remaining_contact_quota", share: 0.30,
        reason: "Developer-tooling companies are engineering-dense with strong LinkedIn company presence.",
      });
      seeds.push({
        capability: "indeed_job_discovery", role: "broad_discovery",
        activation: "insufficient_unique_companies", share: 0.20,
        reason: "Broad role-first recall for companies outside the startup ecosystem.",
      });
      seeds.push({
        capability: "ats_job_verification", role: "verification",
        activation: "known_ats_identity", share: 0.10,
        reason: "Developer-tool startups almost universally run Greenhouse, Lever or Ashby; verify before spending recall budget.",
      });
      seeds.push({
        capability: "glassdoor_job_discovery", role: "recall_fallback",
        activation: "low_raw_volume", share: 0.05,
        reason: "Last-resort recall expansion once precision sources are exhausted.",
      });
    } else {
      seeds.push({
        capability: "indeed_job_discovery", role: "broad_discovery",
        activation: "remaining_contact_quota", share: 0.30,
        reason: "Broad role-first discovery beyond the startup ecosystem.",
      });
      seeds.push({
        capability: "linkedin_job_discovery", role: "cross_check",
        activation: "insufficient_unique_companies", share: 0.20,
        reason: "Company identity and cross-check; strongest LinkedIn company evidence.",
      });
      seeds.push({
        capability: "glassdoor_job_discovery", role: "recall_fallback",
        activation: "low_raw_volume", share: 0.10,
        reason: "Recall expansion only when qualified-company volume is insufficient.",
      });
      seeds.push({
        capability: "ats_job_verification", role: "verification",
        activation: "weak_or_conflicting_job_evidence", share: 0.05,
        reason: "Confirm the posting is live on the company's own ATS when job evidence is uncertain.",
      });
    }
    return seeds;
  }

  // Non-startup missions. YC is deliberately ABSENT: it structurally cannot serve
  // a manufacturer or a security integrator, and proposing it would spend budget
  // on a source guaranteed to return nothing.
  return [
    {
      capability: "indeed_job_discovery", role: "broad_discovery", activation: "initial", share: 0.45,
      reason: "General B2B hiring discovery with the widest coverage across SMB and mid-market.",
    },
    {
      capability: "linkedin_job_discovery", role: "cross_check",
      activation: "remaining_contact_quota", share: 0.30,
      reason: "Professional-company discovery and the strongest company identity evidence.",
    },
    {
      capability: "glassdoor_job_discovery", role: "recall_fallback",
      activation: "low_raw_volume", share: 0.15,
      reason: "Recall expansion only when qualified-company volume is insufficient.",
    },
    {
      capability: "ats_job_verification", role: "verification",
      activation: "known_ats_identity", share: 0.10,
      reason: "Verify the posting on the company's own ATS once identity is resolved.",
    },
  ];
}

/** The ladder for a step. Verification steps never broaden. */
function ladderFor(seed: StepSeed, p: LeadMissionSourceProfile, target: number): SafeBroadeningAction[] {
  if (seed.role === "verification") return [];
  const ladder: SafeBroadeningAction[] = [];
  const aliases = p.hiring?.approvedAliases ?? [];
  if (aliases.length > 0) ladder.push({ action: "add_approved_role_aliases", aliases: [...aliases] });
  ladder.push({ action: "increase_result_target", candidateTarget: Math.min(200, target * 2) });
  const window = p.hiring?.maximumPostingAgeDays;
  if (typeof window === "number" && window > 0) {
    ladder.push({ action: "extend_recency_window", postingWindowDays: Math.min(365, window * 2) });
  }
  return ladder;
}

export interface DeterministicPlanOptions {
  maximumProviderCalls?: number;
  maximumEstimatedCostUsd?: number;
  maximumBroadeningAttempts?: number;
  maximumSourceSteps?: number;
}

/**
 * The deterministic ordered strategy.
 *
 * Used whenever Claude is off, unavailable, or produced something unsafe — and as
 * the baseline a Claude plan is measured against.
 */
export async function deterministicOrderedPlan(
  p: LeadMissionSourceProfile,
  opts: DeterministicPlanOptions = {},
): Promise<OrderedHiringSourcePlan> {
  const maximumSourceSteps = opts.maximumSourceSteps ?? 5;
  const maximumBroadeningAttempts = opts.maximumBroadeningAttempts ?? 2;
  const maximumProviderCalls = opts.maximumProviderCalls ?? 8;
  const maximumEstimatedCostUsd = opts.maximumEstimatedCostUsd ?? 5;

  const base: Omit<OrderedHiringSourcePlan, "planHash"> = {
    version: HIRING_SOURCE_PLAN_VERSION,
    missionProfile: p,
    steps: [],
    completionCondition: { metric: "contact_ready_count", target: p.requestedCount },
    validExhaustionCondition: { allApprovedStepsExhausted: true, noSafeBroadeningRemaining: true },
    maximumSourceSteps, maximumBroadeningAttempts, maximumProviderCalls, maximumEstimatedCostUsd,
    capabilityGap: null,
  };

  // No hiring requirement ⇒ no job scraper can help. Say so.
  if (!p.hiring?.required) {
    const gap: OrderedHiringSourcePlan = {
      ...base, planHash: "",
      capabilityGap: {
        code: "unsupported_capability_gap",
        reason: looksLocalService(p)
          ? "The mission targets local service businesses with no hiring requirement; the approved sources are all job scrapers."
          : "The mission does not require current hiring evidence, and every approved source is a job scraper.",
      },
    };
    return { ...gap, planHash: await orderedPlanHash(gap) };
  }

  const totalTarget = Math.max(20, Math.min(200, p.requestedCount * 12));
  const seeds = orderedSeeds(p).slice(0, maximumSourceSteps);

  const steps: OrderedSourceStep[] = seeds.map((seed, i) => {
    const order = i + 1;
    const cap = HIRING_SOURCE_CATALOG[seed.capability];
    const target = Math.max(
      1,
      Math.min(cap.operatingPolicy.maximumResultsPerCall, Math.round(totalTarget * seed.share)),
    );
    return {
      stepId: stepId(seed.capability, order),
      order,
      capability: seed.capability,
      role: seed.role,
      reason: seed.reason,
      activationCondition: seed.activation,
      semanticIntent: {
        ...(p.hiring?.roleFamily ? { roleFamily: p.hiring.roleFamily } : {}),
        ...(p.hiring?.approvedAliases?.length ? { approvedTitleAliases: [...p.hiring.approvedAliases] } : {}),
        ...(p.hiring?.geography ? { geography: p.hiring.geography } : {}),
        ...(p.hiring?.maximumPostingAgeDays ? { postingWindowDays: p.hiring.maximumPostingAgeDays } : {}),
        ...(p.companyCategory?.length ? { companyCategory: [...p.companyCategory] } : {}),
        candidateTarget: target,
      },
      successCondition: {
        contactReadyTarget: p.requestedCount,
        minimumQualifiedCompanies: Math.max(1, Math.ceil(p.requestedCount / 2)),
        minimumIncrementalYield: 1,
      },
      broadeningLadder: ladderFor(seed, p, target),
      advanceConditions: ["source_exhausted", "no_safe_broadening_remaining", "quota_remains_and_budget_remains"],
      stopConditions: ["contact_ready_quota_reached", "budget_exhausted", "maximum_provider_calls_reached", "valid_exhaustion"],
    };
  });

  // Link the chain. The last step has no successor, which is what makes valid
  // exhaustion reachable rather than an infinite loop.
  for (let i = 0; i < steps.length - 1; i++) steps[i].nextStepId = steps[i + 1].stepId;

  const plan: OrderedHiringSourcePlan = { ...base, steps, planHash: "" };
  return { ...plan, planHash: await orderedPlanHash(plan) };
}

// ------------------------------------------------------------ validation ----

export interface SourcePlanViolation { code: string; message: string; severity: "block" | "repair" }

export interface OrderedPlanValidation {
  ok: boolean;
  plan: OrderedHiringSourcePlan;
  approvedSteps: OrderedSourceStep[];
  rejectedSteps: Array<{ step: OrderedSourceStep; reason: string }>;
  repairs: string[];
  violations: SourcePlanViolation[];
}

/**
 * Public acyclicity check: walk the chain from the first step and refuse to see
 * the same step twice, or a link to a step that does not exist.
 *
 * Distinct from the internal `findCycle` below, which sweeps EVERY step so a
 * cycle among orphaned steps is caught too. This one answers the question a
 * caller actually asks — "is the executable chain safe to follow?"
 */
export function isPlanAcyclic(plan: Pick<OrderedHiringSourcePlan, "steps">): boolean {
  const byId = new Map(plan.steps.map((s) => [s.stepId, s]));
  const visited = new Set<string>();
  let cur: OrderedSourceStep | undefined = plan.steps[0];
  while (cur) {
    if (visited.has(cur.stepId)) return false;
    visited.add(cur.stepId);
    if (!cur.nextStepId) break;
    const next = byId.get(cur.nextStepId);
    if (!next) return false;
    cur = next;
  }
  return true;
}

/** Depth-first cycle detection over `nextStepId`. */
function findCycle(steps: OrderedSourceStep[]): string[] | null {
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const state = new Map<string, "visiting" | "done">();

  const walk = (id: string, path: string[]): string[] | null => {
    const st = state.get(id);
    if (st === "done") return null;
    if (st === "visiting") return [...path, id];
    state.set(id, "visiting");
    const next = byId.get(id)?.nextStepId;
    if (next && byId.has(next)) {
      const cyc = walk(next, [...path, id]);
      if (cyc) return cyc;
    }
    state.set(id, "done");
    return null;
  };

  for (const s of steps) {
    const cyc = walk(s.stepId, []);
    if (cyc) return cyc;
  }
  return null;
}

/**
 * Validate and deterministically repair a proposed ordered plan.
 *
 * REPAIRS are for things with an obviously correct narrower answer: a target above
 * the capability ceiling, a missing order, a duplicate step. BLOCKS are for things
 * with no safe interpretation: an unknown or disabled capability, a job scraper on
 * a mission that never asked for hiring evidence, ATS used as discovery, a cycle,
 * or a plan left with nothing to run.
 *
 * The two are kept distinct because they mean different things to the caller: a
 * repaired plan still runs, a blocked one falls back.
 */
export async function validateOrderedPlan(
  proposed: OrderedHiringSourcePlan,
  p: LeadMissionSourceProfile,
): Promise<OrderedPlanValidation> {
  const approvedSteps: OrderedSourceStep[] = [];
  const rejectedSteps: Array<{ step: OrderedSourceStep; reason: string }> = [];
  const repairs: string[] = [];
  const violations: SourcePlanViolation[] = [];
  const seen = new Set<string>();

  const hiringRequired = p.hiring?.required === true;

  for (const raw of proposed.steps ?? []) {
    const s = { ...raw };

    if (!isHiringSourceCapability(s.capability)) {
      rejectedSteps.push({ step: s, reason: `unknown_capability:${s.capability}` }); continue;
    }
    const resolved = resolveHiringSourceActor(s.capability);
    if (!resolved.ok) { rejectedSteps.push({ step: s, reason: resolved.reason }); continue; }

    if (!hiringRequired) {
      rejectedSteps.push({ step: s, reason: "mission_does_not_require_hiring_evidence" }); continue;
    }

    const cap = HIRING_SOURCE_CATALOG[s.capability];

    // A verification-authority source is not a discovery lane, and cannot run
    // before a company identity exists to verify.
    if (cap.operatingPolicy.requiresKnownCompany) {
      if (s.role !== "verification") {
        rejectedSteps.push({ step: s, reason: "requires_known_company_not_a_discovery_step" }); continue;
      }
      if (s.activationCondition === "initial") {
        rejectedSteps.push({ step: s, reason: "verification_cannot_be_the_initial_step" }); continue;
      }
      if (s.activationCondition !== "known_ats_identity" && s.activationCondition !== "weak_or_conflicting_job_evidence") {
        s.activationCondition = "known_ats_identity";
        repairs.push(`verification_activation_normalized:${s.capability}`);
      }
    }

    if (seen.has(s.capability)) {
      rejectedSteps.push({ step: s, reason: "duplicate_step" });
      repairs.push(`deduplicated_step:${s.capability}`);
      continue;
    }
    seen.add(s.capability);

    // Bound the target to the capability's own verified ceiling.
    const ceiling = cap.operatingPolicy.maximumResultsPerCall;
    const requested = s.semanticIntent?.candidateTarget;
    let target = requested;
    if (!Number.isFinite(target) || (target as number) <= 0) {
      target = 25; repairs.push(`step_target_defaulted:${s.capability}->25`);
    } else if ((target as number) > ceiling) {
      target = ceiling; repairs.push(`step_target_capped:${s.capability}:${requested}->${ceiling}`);
    }
    s.semanticIntent = { ...s.semanticIntent, candidateTarget: target as number };

    // Only APPROVED broadening survives. An unrecognised rung is dropped rather
    // than blocking the plan — the step is still safe without it.
    const ladder = (s.broadeningLadder ?? []).filter((b) => {
      if (isSafeBroadeningAction(b)) return true;
      repairs.push(`unsafe_broadening_dropped:${s.capability}:${String((b as { action?: unknown })?.action)}`);
      return false;
    });
    s.broadeningLadder = s.role === "verification" ? [] : ladder;

    approvedSteps.push(s);
  }

  // ---- ordering ----------------------------------------------------------
  approvedSteps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  approvedSteps.forEach((s, i) => {
    const expected = i + 1;
    if (s.order !== expected) { repairs.push(`step_order_normalized:${s.stepId}:${s.order}->${expected}`); s.order = expected; }
  });

  // EXACTLY ONE initial step, and it must be the first.
  const initial = approvedSteps.filter((s) => s.activationCondition === "initial");
  if (approvedSteps.length > 0) {
    if (initial.length === 0) {
      approvedSteps[0].activationCondition = "initial";
      repairs.push(`initial_step_assigned:${approvedSteps[0].stepId}`);
    } else if (initial.length > 1) {
      // Every source firing at once is the exact failure this contract exists to
      // prevent, so the extras are demoted rather than the plan blocked.
      for (const s of initial.slice(1)) {
        s.activationCondition = "remaining_contact_quota";
        repairs.push(`extra_initial_step_demoted:${s.stepId}`);
      }
      violations.push({
        code: "multiple_initial_steps",
        message: "More than one step was marked initial; all but the first were demoted to conditional activation.",
        severity: "repair",
      });
    }
    if (approvedSteps[0].activationCondition !== "initial") {
      approvedSteps[0].activationCondition = "initial";
      repairs.push(`first_step_forced_initial:${approvedSteps[0].stepId}`);
    }
  }

  // Relink the chain from the surviving, ordered steps. Rebuilding rather than
  // trusting the proposed links is what guarantees acyclicity by construction.
  for (let i = 0; i < approvedSteps.length; i++) {
    const next = approvedSteps[i + 1]?.stepId;
    if (approvedSteps[i].nextStepId !== next) {
      if (next) approvedSteps[i].nextStepId = next; else delete approvedSteps[i].nextStepId;
      repairs.push(`step_chain_relinked:${approvedSteps[i].stepId}`);
    }
  }

  const cycle = findCycle(approvedSteps);
  if (cycle) {
    violations.push({ code: "cyclic_plan", message: `Step chain contains a cycle: ${cycle.join(" -> ")}.`, severity: "block" });
  }

  // ---- caps ---------------------------------------------------------------
  const maximumSourceSteps = Math.max(1, proposed.maximumSourceSteps ?? 5);
  if (approvedSteps.length > maximumSourceSteps) {
    repairs.push(`steps_truncated:${approvedSteps.length}->${maximumSourceSteps}`);
    approvedSteps.length = maximumSourceSteps;
    const last = approvedSteps[approvedSteps.length - 1];
    if (last) delete last.nextStepId;
  }

  // ---- structural completeness -------------------------------------------
  const discovery = approvedSteps.filter((s) => s.role !== "verification");
  if (hiringRequired && discovery.length === 0) {
    violations.push({
      code: "no_executable_hiring_source",
      message: "The mission requires current hiring evidence but no approved discovery step survived validation.",
      severity: "block",
    });
  }

  const target = proposed.completionCondition?.target ?? p.requestedCount;
  if (!Number.isFinite(target) || target <= 0) {
    violations.push({
      code: "missing_completion_condition",
      message: "The plan has no positive CONTACT-ready completion target, so nothing would ever stop it.",
      severity: "block",
    });
  }

  const plan: OrderedHiringSourcePlan = {
    version: HIRING_SOURCE_PLAN_VERSION,
    planHash: "",
    missionProfile: p,
    steps: approvedSteps,
    completionCondition: { metric: "contact_ready_count", target: p.requestedCount },
    validExhaustionCondition: { allApprovedStepsExhausted: true, noSafeBroadeningRemaining: true },
    maximumSourceSteps,
    maximumBroadeningAttempts: Math.max(0, proposed.maximumBroadeningAttempts ?? 2),
    maximumProviderCalls: Math.max(1, proposed.maximumProviderCalls ?? 8),
    maximumEstimatedCostUsd: Math.max(0, proposed.maximumEstimatedCostUsd ?? 5),
    capabilityGap: hiringRequired ? null : {
      code: "unsupported_capability_gap",
      reason: "The mission does not require current hiring evidence, and every approved source is a job scraper.",
    },
  };

  return {
    ok: violations.every((v) => v.severity !== "block"),
    plan: { ...plan, planHash: await orderedPlanHash(plan) },
    approvedSteps, rejectedSteps, repairs, violations,
  };
}

/**
 * Deterministic hash over the EXECUTABLE plan.
 *
 * Ordering is part of the identity: the same sources in a different sequence are a
 * different strategy with a different cost profile, so they must not share a hash.
 */
export async function orderedPlanHash(plan: Omit<OrderedHiringSourcePlan, "planHash">): Promise<string> {
  return await sha256Hex(canonicalJson({
    version: plan.version,
    steps: plan.steps.map((s) => ({
      o: s.order, c: s.capability, r: s.role,
      a: s.activationCondition, t: s.semanticIntent.candidateTarget,
      n: s.nextStepId ?? null,
    })),
    completion: plan.completionCondition,
    caps: {
      steps: plan.maximumSourceSteps, broadening: plan.maximumBroadeningAttempts,
      calls: plan.maximumProviderCalls, cost: plan.maximumEstimatedCostUsd,
    },
    gap: plan.capabilityGap?.code ?? null,
  }));
}

/** Safe, redacted diagnostics for the task result. No provider internals. */
export function orderedPlanDiagnostics(v: OrderedPlanValidation): Record<string, unknown> {
  return {
    plan_version: v.plan.version,
    plan_hash: v.plan.planHash,
    ordered_capabilities: v.plan.steps.map((s) => s.capability),
    step_activation: v.plan.steps.map((s) => ({ step: s.stepId, order: s.order, activation: s.activationCondition })),
    stop_conditions: v.plan.steps[0]?.stopConditions ?? [],
    completion_target: v.plan.completionCondition.target,
    capability_gap: v.plan.capabilityGap?.code ?? null,
    rejected_steps: v.rejectedSteps.map((r) => ({ capability: r.step.capability, reason: r.reason })),
    repairs: v.repairs,
    violations: v.violations.map((x) => ({ code: x.code, severity: x.severity })),
  };
}
