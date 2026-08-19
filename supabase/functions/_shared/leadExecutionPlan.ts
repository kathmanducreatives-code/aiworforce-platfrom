// THE WHOLE JOB, PLANNED AT ONCE — not one capability at a time.
//
// ── WHAT THIS ADDS TO `leadDiscoveryStrategy` ────────────────────────────────
//
// `validateDiscoveryStrategy` answers "which Actors discover the pool". That is
// one stage. It cannot express the thing a real lead request actually needs:
//
//     discover companies  →  verify they are hiring  →  enrich them
//                         →  find the decision maker →  enrich the contact
//
// Every one of those is a different capability with a different Actor, and until
// now the SEQUENCE was deterministic: `buildCapabilityGraph` decided which
// stages ran from the mission's fields, and each engine branch hardcoded the
// provider that served it. GPT chose actors inside discovery and nothing else.
//
// The cost of that is not hypothetical. A discovery Actor that carries embedded
// hiring evidence makes a paid hiring-verification step redundant; one that does
// not makes it essential. That is a judgement about what evidence exists and
// what is still missing — exactly the judgement the model is briefed to make,
// and it had no field in which to express it.
//
// ── THE SPLIT, UNCHANGED ─────────────────────────────────────────────────────
//
//   GPT                    decides WHICH steps, in WHAT order, with WHICH Actor
//   validateExecutionPlan  decides whether that is allowed
//   the engine             executes only what survived
//
// ── WHAT CONTAINMENT STILL MEANS ─────────────────────────────────────────────
//
// A step may only name a capability the MISSION's graph already contains, and
// only an Actor that capability already declares. So this widens WHO decides,
// never WHAT is reachable: a plan cannot invent a stage the mission did not
// authorise, cannot reach an Actor the capability does not list, and cannot put
// a people stage into a run that never asked for one. `buildCapabilityGraph`
// remains the containment boundary; this decides how to move through it.
//
// PURE. No network, provider, model or database access.

import {
  CAPABILITY_REGISTRY, isCapabilityId,
  type CapabilityId, type CapabilityPlan,
} from "./leadCapabilityGraph.ts";
import { hiringActorCard } from "./hiringActorCatalog.ts";
import { ACTOR_INPUT_CONTRACTS } from "./actorInputContracts.ts";
import {
  cohortRefusalFor, declaresUnfitForSemantic, missionNeedsSemanticDiscovery,
  conceptTermsOf, type StrategyViolation,
} from "./leadDiscoveryStrategy.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const EXECUTION_PLAN_VERSION = "lead-execution-plan-v1" as const;

/**
 * The most steps one plan may contain.
 *
 * Every step with an Actor is a paid call. The longest legitimate chain today is
 * discover → identity → enrich → verify hiring → find founder → enrich contact
 * → qualify → persist, so eight is generous rather than tight; it exists to stop
 * a model asked for "thorough" returning forty.
 */
export const MAX_PLAN_STEPS = 8;

export interface PlannedStep {
  /** 1-based, renumbered after validation so the executed plan is contiguous. */
  step: number;
  capability: CapabilityId;
  /**
   * The Actor that serves this step, or null for a capability that runs no
   * provider at all (qualification, persistence, deduplication).
   */
  actor_key: string | null;
  /** The model's stated reason for the step. Recorded, never acted on. */
  purpose: string;
  /** Actor input, reduced later to filters that Actor accepts. */
  input: Record<string, unknown>;
  /** Earlier step numbers whose output this consumes. */
  depends_on: number[];
}

export interface ExecutionPlan {
  version: typeof EXECUTION_PLAN_VERSION;
  steps: PlannedStep[];
  reasoning: string;
  source: "model_validated" | "model_repaired" | "blocked";
  violations: StrategyViolation[];
}

export interface ProposedStep {
  capability?: unknown;
  actor_key?: unknown;
  purpose?: unknown;
  input?: unknown;
  depends_on?: unknown;
}

/** Capabilities that CREATE the working set rather than consuming it. */
const PRODUCERS: ReadonlySet<CapabilityId> = new Set(
  (Object.keys(CAPABILITY_REGISTRY) as CapabilityId[])
    .filter((c) => CAPABILITY_REGISTRY[c].produces.includes("company_candidate")),
);

/**
 * Stages that spend money on a PERSON.
 *
 * Never inferable from the plan alone. `compileLeadMission` already strips these
 * from any automatic plan and names them prohibited, and `buildCapabilityGraph`
 * refuses to insert them — this is the third guard, at the layer where a model
 * now proposes steps, and it exists because this is the one that spends on
 * somebody the user never agreed to buy.
 */
const PEOPLE_STAGES: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  "founder_discovery", "employer_verification", "contact_enrichment",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

function intArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
}

export interface ExecutionPlanOptions {
  maxSteps?: number;
}

/**
 * Decide whether a proposed chain may run.
 *
 * Returns `blocked` when nothing survives — never a substituted plan. The engine
 * turns that into a stopped run with the violations attached, which is the same
 * contract `validateDiscoveryStrategy` has: a refusal the model can be told
 * about beats a confident plan nobody chose.
 */
export function validateExecutionPlan(
  proposed: unknown,
  mission: LeadMissionV1,
  graph: CapabilityPlan,
  opts: ExecutionPlanOptions = {},
): ExecutionPlan {
  const violations: StrategyViolation[] = [];
  const maxSteps = opts.maxSteps ?? MAX_PLAN_STEPS;
  const base = {
    version: EXECUTION_PLAN_VERSION,
    reasoning: "",
  } as const;

  if (!Array.isArray(proposed)) {
    return {
      ...base, steps: [], source: "blocked",
      violations: [{
        code: "plan_not_a_list",
        message: "the planner returned no list of steps",
        severity: "block",
      }],
    };
  }

  /** Capabilities the MISSION authorised. The containment boundary. */
  const authorised = new Set(graph.steps.map((s) => s.capability));
  let repaired = false;
  const kept: PlannedStep[] = [];
  /** capability|actor pairs already accepted, so a plan cannot buy one twice. */
  const seen = new Set<string>();

  for (const raw of proposed as ProposedStep[]) {
    const p = asRecord(raw);
    if (!p) {
      violations.push({
        code: "step_not_an_object", message: "a step was not an object",
        severity: "block",
      });
      continue;
    }

    const capability = String(p.capability ?? "");
    if (!isCapabilityId(capability)) {
      violations.push({
        code: "unknown_capability", message: `"${capability}" is not a capability`,
        severity: "block",
      });
      continue;
    }

    // ── THE PEOPLE GUARD IS CHECKED FIRST, DELIBERATELY ────────────────────
    //
    // A people stage is almost never in the graph, so the containment check
    // below would already refuse it — with `capability_not_in_mission_plan`,
    // which reads as a scoping accident rather than the rule it actually is.
    // This refusal has to survive the case where a mission DID authorise the
    // stage (a founder-unlock offer puts it in reach), and it has to say why in
    // its own words, because it is the one that spends on somebody the user
    // never agreed to buy.
    if (PEOPLE_STAGES.has(capability)) {
      violations.push({
        code: "people_stage_never_automatic", message:
          `${capability} spends on a person and is only ever OFFERED, never ` +
          `planned — the user presses the button or it does not happen`,
        severity: "block",
      });
      continue;
    }

    // ── THE MISSION AUTHORISED THIS STAGE, OR IT DOES NOT RUN ──────────────
    //
    // A model that decides a run "should also" search job boards is proposing
    // spend the user never approved. The graph is where that approval lives.
    if (!authorised.has(capability)) {
      violations.push({
        code: "capability_not_in_mission_plan", message:
          `${capability} is not part of this mission's plan — the mission ` +
          `authorises ${[...authorised].join(", ")}`,
        severity: "block",
      });
      continue;
    }

    const declared = CAPABILITY_REGISTRY[capability].providers as readonly string[];
    const actorKey = typeof p.actor_key === "string" && p.actor_key ? p.actor_key : null;

    // A capability with no providers runs no Actor. Naming one is a category
    // error, not a permission problem.
    if (declared.length === 0) {
      if (actorKey) {
        violations.push({
          code: "capability_runs_no_actor", actor_key: actorKey, message:
            `${capability} runs no provider; it cannot be served by ${actorKey}`,
          severity: "repair",
        });
        repaired = true;
      }
      const key = `${capability}|-`;
      if (seen.has(key)) { repaired = true; continue; }
      seen.add(key);
      kept.push({
        step: kept.length + 1, capability, actor_key: null,
        purpose: String(p.purpose ?? "").slice(0, 400),
        input: {}, depends_on: intArray(p.depends_on),
      });
      continue;
    }

    if (!actorKey) {
      violations.push({
        code: "step_names_no_actor", message:
          `${capability} needs an Actor and the step names none`,
        severity: "block",
      });
      continue;
    }

    const card = hiringActorCard(actorKey);
    if (!card) {
      violations.push({
        code: "unknown_actor", actor_key: actorKey,
        message: `"${actorKey}" is not in the actor catalog`, severity: "block",
      });
      continue;
    }

    // ── CONTAINMENT: THE CAPABILITY'S OWN PROVIDER LIST ────────────────────
    //
    // The same rule `guardedInvoker` enforces at call time, applied at plan time
    // so a refusal is something the model can be TOLD rather than an exception
    // it discovers by being executed.
    if (!declared.includes(actorKey)) {
      violations.push({
        code: "actor_not_declared_by_capability", actor_key: actorKey, message:
          `${actorKey} is not a provider for ${capability} — that capability ` +
          `may reach ${declared.join(", ")}`,
        severity: "block",
      });
      continue;
    }

    // ── DISCOVERY STEPS CARRY THE DISCOVERY REFUSALS ───────────────────────
    //
    // The same two the single-stage validator applies, for the same reasons: a
    // name matcher cannot produce a concept cohort, and a cohort source cannot
    // produce a population outside its cohort. Applied here so a CHAIN cannot
    // smuggle in the actor a single-stage plan would have been refused for.
    if (PRODUCERS.has(capability)) {
      if (missionNeedsSemanticDiscovery(mission) && declaresUnfitForSemantic(card)) {
        violations.push({
          code: "actor_not_for_semantic_discovery", actor_key: actorKey, message:
            `${actorKey} declares not_for "${card.not_for.join('", "')}" — this ` +
            `mission discovers by concept (${conceptTermsOf(mission).join(", ")}) ` +
            `and names no specific companies, so a name matcher cannot produce ` +
            `this cohort`,
          severity: "block",
        });
        continue;
      }
      const cohort = cohortRefusalFor(card, mission);
      if (cohort) {
        violations.push({
          code: "actor_outside_mission_cohort", actor_key: actorKey, message:
            `${actorKey} can only return companies from ${cohort.label} — this ` +
            `mission does not target that cohort`,
          severity: "block",
        });
        continue;
      }
    }

    const key = `${capability}|${actorKey}`;
    if (seen.has(key)) {
      violations.push({
        code: "duplicate_step", actor_key: actorKey,
        message: `${actorKey} was planned for ${capability} more than once`,
        severity: "repair",
      });
      repaired = true;
      continue;
    }
    seen.add(key);

    kept.push({
      step: kept.length + 1,
      capability,
      actor_key: actorKey,
      purpose: String(p.purpose ?? "").slice(0, 400),
      input: asRecord(p.input) ?? {},
      depends_on: intArray(p.depends_on),
    });
  }

  // ── A CONSUMER WITHOUT A PRODUCER IS NOT A PLAN ────────────────────────────
  //
  // "Enrich the companies" with nothing that finds companies is a chain with no
  // first link. Dropped rather than refused whole: the rest of the plan may be
  // perfectly executable, and the engine reports the stage it could not reach.
  const firstProducer = kept.findIndex((s) => PRODUCERS.has(s.capability));
  const ordered = kept.filter((s, i) => {
    if (PRODUCERS.has(s.capability)) return true;
    if (s.capability === "known_company_resolution") return true;
    if (firstProducer === -1) {
      violations.push({
        code: "consumer_without_producer", message:
          `${s.capability} consumes companies and no step discovers any`,
        severity: "repair",
      });
      repaired = true;
      return false;
    }
    if (i < firstProducer) {
      violations.push({
        code: "step_before_its_producer", message:
          `${s.capability} was planned before the step that produces companies`,
        severity: "repair",
      });
      repaired = true;
      return false;
    }
    return true;
  });

  // ── DEPENDENCIES POINT BACKWARDS, ALWAYS ───────────────────────────────────
  //
  // Forward or self references are dropped rather than blocking: they are a
  // numbering slip, and the plan's ORDER already carries the real sequencing.
  const final = ordered.map((s, i) => {
    const step = i + 1;
    const back = s.depends_on.filter((d) => d < step);
    if (back.length !== s.depends_on.length) {
      violations.push({
        code: "dependency_not_backwards", message:
          `step ${step} (${s.capability}) declared a dependency on a later step`,
        severity: "repair",
      });
      repaired = true;
    }
    return { ...s, step, depends_on: back };
  });

  if (final.length > maxSteps) {
    violations.push({
      code: "too_many_steps",
      message: `plan trimmed from ${final.length} to ${maxSteps} steps`,
      severity: "repair",
    });
    repaired = true;
    final.length = maxSteps;
  }

  if (final.length === 0) {
    violations.push({
      code: "no_valid_step",
      message: "no proposed step survived validation",
      severity: "block",
    });
    return { ...base, steps: [], source: "blocked", violations };
  }

  return {
    ...base,
    steps: final,
    source: repaired ? "model_repaired" : "model_validated",
    violations,
  };
}

/**
 * What the planner is shown.
 *
 * The mission, the capabilities it authorised WITH the Actors each may reach,
 * and what each Actor is good and bad at. The model's job is to compose them
 * into a chain; it cannot reach outside this object, and everything in it is
 * derived from the graph and the catalog rather than restated.
 */
export function buildExecutionPlannerPayload(
  mission: LeadMissionV1, graph: CapabilityPlan, opts: ExecutionPlanOptions = {},
): Record<string, unknown> {
  const p = mission.company_profile;
  return {
    task: "plan_the_whole_job",
    request: {
      original_user_query: mission.original_user_query,
      requested_count: mission.requested_count,
      requested_output: mission.requested_output,
    },
    compiled_mission: {
      verticals: p.verticals,
      business_models: p.business_models,
      stages: p.stages,
      locations: p.locations,
      employee_range: p.employee_range ?? null,
      required_signals: mission.required_signals,
      required_evidence: mission.directives?.required_evidence ?? [],
      source_strategy: mission.directives?.source_strategy ?? [],
    },
    // THE STAGES THIS MISSION AUTHORISED, and the Actors each may reach. A
    // capability absent from this list cannot be planned; an Actor absent from a
    // capability's list cannot serve it.
    authorised_capabilities: graph.steps.map((s) => {
      const spec = CAPABILITY_REGISTRY[s.capability];
      return {
        capability: s.capability,
        label: spec.label,
        why_it_is_in_the_plan: s.reason,
        runs_an_actor: spec.providers.length > 0,
        actors: spec.providers.map((key) => {
          const card = hiringActorCard(key);
          return card
            ? {
              actor_key: key,
              best_for: card.best_for,
              not_for: card.not_for,
              outputs: card.outputs,
              cost_tier: card.cost_model.tier,
              confidence: card.confidence,
              requires_enrichment_before_qualification:
                card.requires_enrichment_before_qualification,
              ...(card.cohort_scope ? { only_returns: card.cohort_scope.label } : {}),
              known_defects: card.known_defects.map((d) => d.summary),
              // The live input shape and the store's own maturity signal. A
              // planner that knows a field is an ARRAY of enum values does not
              // send a bare string, which is how three runs died in one week.
              ...(ACTOR_INPUT_CONTRACTS[key]
                ? {
                  input_contract: {
                    fields: ACTOR_INPUT_CONTRACTS[key].fields,
                    example: ACTOR_INPUT_CONTRACTS[key].example,
                  },
                  quality: ACTOR_INPUT_CONTRACTS[key].quality,
                }
                : {}),
            }
            : { actor_key: key, uncarded: true };
        }),
      };
    }),
    ...(graph.routing_advisories.length
      ? { execution_advisories: graph.routing_advisories }
      : {}),
    limits: {
      max_steps: opts.maxSteps ?? MAX_PLAN_STEPS,
      requested_lead_count: mission.requested_count,
    },
    response_shape: {
      reasoning: "<why this chain answers THIS request>",
      steps: [{
        capability: "<one of authorised_capabilities[].capability>",
        actor_key: "<one of THAT capability's actors, or null if runs_an_actor is false>",
        purpose: "<what this step contributes that the ones before it did not>",
        input: "<object using only that actor's supported filters>",
        depends_on: "[earlier step numbers whose output this consumes]",
      }],
    },
  };
}

/** The Actor this plan chose for a capability, if it chose one. */
export function plannedActorFor(
  plan: ExecutionPlan | null, capability: CapabilityId,
): string | null {
  return plan?.steps.find((s) => s.capability === capability)?.actor_key ?? null;
}

/** Every Actor this plan chose for a capability, in plan order. */
export function plannedActorsFor(
  plan: ExecutionPlan | null, capability: CapabilityId,
): PlannedStep[] {
  return (plan?.steps ?? []).filter((s) => s.capability === capability);
}

/**
 * Did the plan schedule this capability at all?
 *
 * `null` — no plan — means "the graph decides", which is the behaviour every
 * caller had before a plan existed. Only a real plan can deselect a stage.
 */
export function capabilityIsPlanned(
  plan: ExecutionPlan | null, capability: CapabilityId,
): boolean {
  if (!plan) return true;
  return plan.steps.some((s) => s.capability === capability);
}

/**
 * Raised when a WIRED execution planner produced nothing usable.
 *
 * A distinct class, because "the model could not plan this" and "a provider
 * failed" lead to different answers and must never be confused. The run stops
 * before spending, exactly as a blocked discovery strategy does.
 *
 * NOT raised when no planner is wired at all — that is the graph's own
 * authorised order, which is a decision the mission already made.
 */
export class ExecutionPlanBlockedError extends Error {
  readonly violations: StrategyViolation[];
  readonly userMessage: string;
  constructor(violations: StrategyViolation[]) {
    const first = violations[0];
    super(
      `execution planning was blocked (${first?.code ?? "unknown"}): ` +
      `${first?.message ?? "no steps were planned"}. No deterministic plan was ` +
      `substituted and no provider work was scheduled.`,
    );
    this.name = "ExecutionPlanBlockedError";
    this.violations = violations;
    this.userMessage = [
      "I stopped before spending anything. I could not work out a reliable way " +
      "to answer this request with the tools available.",
      "",
      ...violations.filter((v) => v.severity === "block").map((v) => `  • ${v.message}`),
      "",
      "Rephrasing the request, naming specific companies, or narrowing it to a " +
      "cohort I have a real source for will usually give me something to plan.",
    ].join("\n");
  }
}
