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
// ── AND WHY A FAILURE HERE IS NOT A FAILED RUN ───────────────────────────────
//
// If GPT is unavailable, slow, or answers unusably, discovery still happens:
// `resolveDiscoveryStrategy` in the engine falls back to the deterministic
// strategy. That is not a Claude/Lovable fallback — no second model is
// consulted — it is a fallback to CODE. The distinction matters: a
// deterministic plan is inspectable and its cost is known, whereas a quietly
// substituted model is neither.
//
// PURE apart from the injected model call.

import { gptStructured, type GptDeps, type GptResult } from "./gptProvider.ts";
import {
  DEFAULT_MAX_ACTORS, DEFAULT_MAX_ITEMS_PER_ACTOR,
  buildDiscoveryPlannerPayload, type DiscoveryStrategyOptions,
} from "./leadDiscoveryStrategy.ts";
import { scenarioBriefing } from "./discoveryScenarioMatrix.ts";
import { coverMissionSignals } from "./signalActorCoverage.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const GPT_DISCOVERY_PLANNER_VERSION = "gpt-discovery-planner-v1" as const;

/**
 * What the model must return.
 *
 * `strict: true` on the API side means the model CANNOT return a different
 * shape, so the engine's validator is checking semantics — is this Actor
 * registered, is this filter supported — rather than re-checking structure.
 */
const RESPONSE_SCHEMA = {
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
          required: ["actor_key", "role", "input", "rationale"],
          properties: {
            actor_key: {
              type: "string",
              description: "EXACTLY one of the actor_key values in available_actors.",
            },
            role: { type: "string", enum: ["primary", "breadth", "fallback"] },
            input: {
              type: "object",
              additionalProperties: true,
              description:
                "Actor-specific input. Only that actor's supported_filters, and " +
                "only values from its verified_enums.",
            },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You choose which Apify Actors run for a lead-sourcing request, and what each is asked.

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
}

/**
 * Build the question. Exported so a test can assert what the model is shown
 * without a network call — the briefing IS the constraint, so it is worth
 * pinning.
 */
export function buildPrompt(i: GptPlanDiscoveryInput): { system: string; user: string } {
  const opts = i.options ?? {};
  const payload = buildDiscoveryPlannerPayload(i.mission, opts);
  const coverage = coverMissionSignals(i.mission);

  return {
    system: SYSTEM,
    user: JSON.stringify({
      ...payload,
      // WHAT THE REQUEST NEEDS, resolved. The model is not asked to work out
      // which signals map to which capability — that is deterministic and
      // already done, and asking twice invites the two answers to disagree.
      signal_coverage: coverage.signals.map((s) => ({
        signal: s.signal,
        status: s.status,
        actors_that_serve_it: s.actors,
        minimum_evidence: s.minimum_evidence,
        ...(s.limitation ? { limitation: s.limitation } : {}),
      })),
      // Scenarios NO actor can serve, with the verified reason. A planner that
      // cannot see what is impossible keeps proposing it.
      unserveable_scenarios: scenarioBriefing()
        .filter((s) => s.servable === false)
        .map((s) => ({ scenario: s.scenario, why: s.blocked_reason })),
      limits: {
        max_actors: opts.maxActors ?? DEFAULT_MAX_ACTORS,
        max_items_per_actor: opts.maxItemsPerActor ?? DEFAULT_MAX_ITEMS_PER_ACTOR,
        requested_lead_count: i.mission.requested_count,
      },
    }, null, 2),
  };
}

export interface GptDiscoveryProposal {
  reasoning: string;
  actors: Array<{ actor_key: string; role: string; input: Record<string, unknown>; rationale: string }>;
}

/**
 * The `planDiscovery` dependency, ready to hand to `runCapabilityPlan`.
 *
 * Returns the RAW proposal. Validation is the engine's, via
 * `validateDiscoveryStrategy`, and doing it here as well would create a second
 * authority on what is allowed — the exact duplication this architecture keeps
 * removing.
 */
export function makeGptDiscoveryPlanner(deps: GptDeps = {}) {
  return async (i: { payload: Record<string, unknown>; mission_hash: string }): Promise<unknown> => {
    // The engine builds a payload for the generic seam; this planner needs the
    // richer briefing, so it is rebuilt here from what the engine passed.
    const { system, user } = {
      system: SYSTEM,
      user: JSON.stringify(i.payload, null, 2),
    };
    const r: GptResult<GptDiscoveryProposal> = await gptStructured<GptDiscoveryProposal>({
      purpose: "discovery_actor_selection",
      system,
      user,
      schema: RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 2000,
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
    return { actors: r.value.actors, reasoning: r.value.reasoning };
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
