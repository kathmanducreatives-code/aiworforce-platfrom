// GPT SELECTS THE ACTORS. DETERMINISTIC CODE DECIDES WHETHER IT MAY.
//
// This is the `planDiscovery` dependency the engine already accepts. It closes
// the last gap in the intended architecture: the actor catalog, the scenario
// matrix and the strategy validator were all built, and nothing was making the
// choice they exist to constrain.
//
// ── THE SPLIT THIS FILE ENFORCES ─────────────────────────────────────────────
//
//   GPT              decides WHAT should happen — which Actors, what filters
//   validateDiscoveryStrategy  decides WHETHER it is allowed
//   the engine       executes only what survived
//
// GPT never names an Actor id of its own invention, because the only ids it is
// shown come from the catalog and `validateDiscoveryStrategy` rejects anything
// else. It never sends an unsupported filter, because the compiler drops fields
// the live schema has no key for. It never sends an invalid enum, because the
// compiler checks values against the enums read from the Store.
//
// So this module is deliberately thin: it assembles a briefing, asks one
// question, and hands the answer to a validator that already exists. Putting
// judgement here — "this actor looks right" — would move the decision out of the
// layer that can prove it.
//
// ── AND WHY A FAILURE HERE STOPS THE RUN ─────────────────────────────────────
//
// This comment used to say the opposite: that if GPT was unavailable, slow or
// unusable, "discovery still happens" because the engine fell back to the
// deterministic strategy. That fallback is DELETED, and describing it here
// outlasted it by several commits.
//
// The floor WAS the defect. It pinned `startup_company_discovery` to the YC
// scraper with `industries: ["B2B"]` written as a literal, so a missing
// credential, a model outage and a deliberately-chosen YC search were
// indistinguishable from outside — and every mission asked the same question.
//
// Now an unusable answer returns null, `resolveDiscoveryStrategy` returns a
// `blocked` strategy, and the run stops with a stated reason and no spend.
// "We could not decide what to search for" is the honest answer to that
// situation, and a stopped run is recoverable in a way that a confident,
// unrelated pool is not.
//
// PURE apart from the injected model call.

import { gptStructured, type GptDeps, type GptResult } from "./gptProvider.ts";
import { routeModel, type ModelRoute } from "./gptModelRouter.ts";
import { parsePlannedInput } from "./gptExecutionPlanner.ts";
import {
  buildDiscoveryPlannerPayload, type DiscoveryStrategyOptions,
} from "./leadDiscoveryStrategy.ts";
import {
  buildAgentoryBriefing, type CompanyBrainBriefing, type DiscoveryResultsSummary,
} from "./agentoryBriefing.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const GPT_DISCOVERY_PLANNER_VERSION = "gpt-discovery-planner-v1" as const;

/**
 * What the model must return.
 *
 * `strict: true` on the API side means the model CANNOT return a different
 * shape, so the engine's validator is checking semantics — is this Actor
 * registered, is this filter supported — rather than re-checking structure.
 */
export const RESPONSE_SCHEMA = {
  name: "discovery_actor_strategy",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["actors", "reasoning"],
    properties: {
      reasoning: {
        type: "string",
        description:
          "Why this set of actors answers THIS request. Names the signals it " +
          "covers and any it cannot. Recorded, never acted on.",
      },
      actors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["actor_key", "role", "input_json", "rationale"],
          properties: {
            actor_key: {
              type: "string",
              description: "EXACTLY one of the actor_key values in available_actors.",
            },
            role: { type: "string", enum: ["primary", "breadth", "fallback"] },
            // ── A JSON STRING, NOT AN OPEN OBJECT ──────────────────────
            //
            // This was `{ type: "object", additionalProperties: true }`, which
            // OpenAI's strict structured-output mode REFUSES outright:
            //
            //   HTTP 400 — Invalid schema for response_format: in context
            //   ('properties','input'), 'additionalProperties' is required to
            //   be supplied and to be false.
            //
            // So every call this planner ever made failed, and the failure was
            // invisible because `gptStructured` reports `!r.ok` and the caller
            // treats that as "the model had nothing to say". Found by running
            // the thing against the real API; no unit test could see it,
            // because every test injects the model.
            //
            // Strict mode cannot express "an object with actor-specific keys",
            // and dropping strict to get one would trade a guaranteed shape for
            // a convenient field. The input travels as a JSON STRING and is
            // parsed here — the schema stays strict, and the actor input is
            // validated where it always was: against that actor's own
            // supported_filters and verified_enums.
            input_json: {
              type: "string",
              description:
                "Actor-specific input as a JSON OBJECT serialised to a string. " +
                "Only that actor's supported_filters, and only values from its " +
                "verified_enums. Send \"{}\" if no filters are needed.",
            },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

// ── THE CANONICAL BRIEFING PREFIXES THE STAGE PROMPT ──────────────────────
//
// This stage used to be told only its own job — "choose which Actors run" —
// with no idea what Agentory is, what happens to the pool it produces, or that
// "nothing here can serve this" was an allowed answer. It made a locally
// sensible choice that was globally wrong (2026-08-17: a name matcher asked to
// discover a concept, 20 newsletters and communities, 0 qualified).
//
// `buildAgentoryBriefing` supplies the whole picture; the rules below stay,
// because they are this stage's specific output contract rather than general
// knowledge.
const STAGE_RULES = `You choose which Apify Actors run for a lead-sourcing request, and what each is asked.

RULES, in order of importance:

1. Use ONLY actor_key values listed in available_actors. Any other value is
   rejected and wastes the request.
2. For each actor, use ONLY the fields in ITS supported_filters, and for any
   field with verified_enums, ONLY values from that list. A field the live
   schema lacks is dropped; an enum value outside the list is dropped.
3. Read best_for, not_for and known_defects. An actor listed as not_for a task
   will not do it well no matter how its name reads.
4. An actor whose input_entities do not include "query" CANNOT discover. It must
   be given the URLs or domains it reads, so it can only enrich what discovery
   already found.
5. Prefer fewer actors. Every actor is a paid call and every candidate it adds
   costs a further paid enrichment before it can qualify.
6. Exactly one actor is "primary" — the one that must run. Use "breadth" for an
   actor that widens the pool and may be skipped once the pool is full, and
   "fallback" for one worth running only if nothing else returned anything.

You are choosing for THIS request. Do not default to a familiar actor because it
is usually right; read what the request actually asks for and what each actor
can prove.`;

export interface GptPlanDiscoveryInput {
  mission: LeadMissionV1;
  options?: DiscoveryStrategyOptions;
  /** The user's standing ICP. Context for the choice, never the mission. */
  brain?: CompanyBrainBriefing | null;
  /** What the previous attempt produced, when re-planning after poor results. */
  results?: DiscoveryResultsSummary | null;
}

/**
 * Build the question. Exported so a test can assert what the model is shown
 * without a network call — the briefing IS the constraint, so it is worth
 * pinning.
 */
/** The stage prompt, prefixed by everything GPT should know about Agentory. */
function systemPromptFor(brain: CompanyBrainBriefing | null, results?: DiscoveryResultsSummary | null): string {
  return [buildAgentoryBriefing({ brain, results }), "", STAGE_RULES].join("\n");
}

export function buildPrompt(i: GptPlanDiscoveryInput): { system: string; user: string } {
  // ONE PAYLOAD, BUILT ONCE. `signal_coverage`, `unserveable_scenarios` and
  // `limits.requested_lead_count` used to be assembled HERE, on top of
  // `buildDiscoveryPlannerPayload`. The live planner below calls the payload
  // builder directly, so it never saw any of them: this helper — the one the
  // tests pin — described a richer prompt than a real run ever sent.
  //
  // They now live in `buildDiscoveryPlannerPayload` itself, so there is a
  // single definition and the two callers cannot drift.
  return {
    system: systemPromptFor(i.brain ?? null, i.results ?? null),
    user: JSON.stringify(
      buildDiscoveryPlannerPayload(i.mission, i.options ?? {}), null, 2),
  };
}

export interface GptDiscoveryProposal {
  reasoning: string;
  actors: Array<{
    actor_key: string; role: string; rationale: string;
    /** A JSON object serialised as a string. See the schema note. */
    input_json?: string;
  }>;
}

/**
 * The `planDiscovery` dependency, ready to hand to `runCapabilityPlan`.
 *
 * Returns the RAW proposal. Validation is the engine's, via
 * `validateDiscoveryStrategy`, and doing it here as well would create a second
 * authority on what is allowed — the exact duplication this architecture keeps
 * removing.
 */
/**
 * Render the validator's refusal as instructions the model can act on.
 *
 * PLAIN AND SPECIFIC. The model is told which actor was refused and why, and
 * that the catalog it already has is the whole option space — so the useful
 * move is a DIFFERENT actor, not the same one with the filter renamed.
 */
function validationFeedbackSection(
  feedback: ReadonlyArray<{ code: string; message: string; actor_key?: string }>,
): string {
  if (feedback.length === 0) return "";
  return [
    "",
    "── YOUR PREVIOUS PLAN WAS REFUSED ──────────────────────────────────────",
    "",
    "You already proposed a strategy for this mission and the runtime refused it.",
    "The refusals are below, verbatim:",
    "",
    ...feedback.map((v) =>
      `  • ${v.actor_key ? `${v.actor_key}: ` : ""}${v.message} [${v.code}]`),
    "",
    "Choose again. These are not style notes — a refused actor cannot run, so",
    "repeating it produces nothing. Read what the mission actually requires and",
    "pick an actor from the catalog whose capabilities match it. If an actor was",
    "refused for being a NAME matcher on a CONCEPT mission, you need an actor",
    "that can discover a cohort, not the same one with different filters.",
    "",
    "If no actor in the catalog can serve this mission, return an empty list",
    "rather than a plan you expect to be refused again.",
  ].join("\n");
}

export interface GptDiscoveryPlannerContext {
  /** Leads the user asked for. Read only by the model router. */
  requestedCount?: number;
  /** Every routing decision, so the run can report which model ran what. */
  onRoute?: (route: ModelRoute) => void;
  /**
   * The user's standing ICP, threaded from the caller that actually has it.
   *
   * This was hardcoded `null` with a comment saying the Brain "is not threaded
   * to this seam yet". Honest, and still a gap: the stage choosing which actors
   * to pay for could not see who the user sells to, so it could not prefer a
   * source whose cohort matches the ICP or warn when the request and the ICP
   * disagree. `companyBrainSection` states the precedence — the user's typed
   * request always wins — so supplying it cannot reintroduce the Brain silently
   * overriding a mission.
   */
  brain?: CompanyBrainBriefing | null;
}

export function makeGptDiscoveryPlanner(
  deps: GptDeps = {}, ctx: GptDiscoveryPlannerContext = {},
) {
  return async (i: {
    payload: Record<string, unknown>;
    mission_hash: string;
    validation_feedback?: Array<{ code: string; message: string; actor_key?: string }>;
    /** What the previous pass produced, on a re-plan. See `resultsSection`. */
    results?: DiscoveryResultsSummary | null;
  }): Promise<unknown> => {
    // The engine builds a payload for the generic seam; this planner needs the
    // richer briefing, so it is rebuilt here from what the engine passed.
    // THE LIVE PATH. `buildPrompt` above is test-facing; THIS is what a real
    // run sends, so the briefing has to be applied here too. Wiring only the
    // helper is exactly the "correct, covered and unreachable" failure this
    // codebase has already paid for once.
    //
    // THE BRAIN AND THE LAST ATTEMPT BOTH REACH THIS CALL NOW. `brain` comes
    // from the caller that compiled it; `results` comes from the engine when it
    // is re-planning, and is what turns a one-shot chooser into something that
    // can notice its own strategy failing.
    const feedback = i.validation_feedback ?? [];
    const { system, user } = {
      system: systemPromptFor(ctx.brain ?? null, i.results ?? null) +
        validationFeedbackSection(feedback),
      user: JSON.stringify(i.payload, null, 2),
    };
    // ROUTED, NOT DEFAULTED. This call passed no tier at all, so it inherited
    // `reasoning` silently — the right answer, arrived at by nobody, and absent
    // from the cost trace. The router states it, and the repair round is a
    // SEPARATE stage so the trace shows how often a first plan is refused: a
    // rising repair rate is a prompt problem, not a reason for another rule.
    const route = routeModel(
      feedback.length > 0
        ? "discovery_actor_selection_repair"
        : "discovery_actor_selection",
      { requested_count: ctx.requestedCount ?? undefined },
    );
    ctx.onRoute?.(route);
    const r: GptResult<GptDiscoveryProposal> = await gptStructured<GptDiscoveryProposal>({
      purpose: route.stage,
      system,
      user,
      schema: RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 2000,
      // THE ROUTER'S MODEL, NOT A TIER LOOKUP. Luna on the first attempt;
      // the repair stage routes to Terra, and `feedback` is the real
      // validator's violations — `validateDiscoveryStrategy` produced them.
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
    }, deps);

    if (!r.ok) {
      (deps.log ?? (() => {}))("gpt_discovery_planner_failed", {
        code: r.code, detail: r.detail, latency_ms: r.latency_ms,
      });
      // Null, not a throw. The engine's resolver treats an unusable answer as a
      // reason to run the deterministic strategy, which is a plan made of code
      // rather than a different model.
      return null;
    }
    return {
      reasoning: r.value.reasoning,
      actors: (r.value.actors ?? []).map((a) => ({
        ...a,
        input: parsePlannedInput(
          (a as { input_json?: unknown; input?: unknown }).input_json ??
          (a as { input?: unknown }).input),
      })),
    };
  };
}

/** The full planner, for callers that have the mission rather than the payload. */
export async function planDiscoveryWithGpt(
  i: GptPlanDiscoveryInput, deps: GptDeps = {},
): Promise<GptResult<GptDiscoveryProposal>> {
  const { system, user } = buildPrompt(i);
  return await gptStructured<GptDiscoveryProposal>({
    purpose: "discovery_actor_selection",
    system, user,
    schema: RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    maxTokens: 2000,
  }, deps);
}
