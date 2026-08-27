// THE SENTENCE IS UNDERSTOOD ONCE, AND THAT UNDERSTANDING BECOMES THE MISSION.
//
// ── THE SEAM THIS CLOSES ───────────────────────────────────────────────────
//
// Phase A designed one path: `RequestV1` -> `projectToLeadMission` ->
// `GptMissionProposal` -> the EXISTING `compileLeadMission`. Every piece of it
// was built. Nothing connected the last link.
//
// What ran instead: the router computed a `LeadProjection`, pilot-chat read one
// field off it (`known_companies`, for the held-evidence check) and dropped the
// rest, expressed the whole route as the string "qualified_lead_sourcing", and
// the legacy chain re-derived a mission from the raw sentence with a SECOND
// model call. Two models read the same sentence and the second one won.
//
// Worse, "qualified_lead_sourcing" is not a member of `WorkflowCategory`, so no
// branch matched it, the request fell through to a deep fallback that delegated
// with no mission at all, and orchestrate answered `422 mission_not_compiled`.
// Understanding the request correctly is what broke it.
//
// ── WHY THERE IS NO MODEL CALL IN HERE ─────────────────────────────────────
//
// `compileCanonicalLeadMission` calls `proposeMission`, which is a fresh GPT
// read of the user's sentence. On this path that call is not merely redundant,
// it is a SECOND BRAIN: it can disagree with Chat Brain about what was asked,
// and whichever answer reaches the compiler last decides what gets bought.
//
// Chat Brain already read the sentence. `projectToLeadMission` already
// expressed that reading in the compiler's own input vocabulary. So the
// proposal is handed over directly and the compiler's precedence rules —
// explicit query, then proposal, then Company Brain, then defaults — apply
// unchanged. One semantic read per message, which is the invariant.
//
// Pure apart from the compiler it delegates to. No network, no database.

import {
  compileLeadMission, MissionCompilationBlockedError,
  type CompiledMissionResult, type GptMissionProposal,
} from "./leadMissionCompiler.ts";
import type { LeadProjection } from "./projectToLeadMission.ts";
import type { RequestV1 } from "./requestV1.ts";
import type { BrainMergeInput } from "./leadMission.ts";

export const REQUEST_TO_MISSION_VERSION = "request-to-mission-v1" as const;

export type MissionFromRequest =
  | { ok: true; result: CompiledMissionResult; proposal: GptMissionProposal }
  /**
   * The request could not become a mission. `message` is what to tell the user;
   * `violations` says which part of the proposal was unusable.
   *
   * A REFUSAL, NOT A FALLBACK. Nothing here substitutes a deterministic reading
   * — that is the behaviour `compileLeadMission` deleted on purpose, because a
   * confident misreading costs more than a stated failure.
   */
  | { ok: false; reason: string; message: string; violations: string[] };

export interface RequestMissionOptions {
  /** The user's verbatim sentence. Never a rewrite — the compiler reads it. */
  originalUserQuery: string;
  /** Workspace profile, applied by the compiler's own precedence rules. */
  companyBrain?: BrainMergeInput | null;
}

/**
 * Compile a routed lead request into the mission everything downstream obeys.
 *
 * TOTAL. Every input yields either a mission or a stated refusal; there is no
 * path that returns a half-built mission, and no path that reaches a provider.
 */
export function compileRequestMission(
  request: RequestV1,
  projection: LeadProjection,
  opts: RequestMissionOptions,
): MissionFromRequest {
  // A projection that already refused is not a compilation failure; it is the
  // surface saying this request is not one it can serve. Passed through with
  // its own reason so the caller does not report it as a compiler fault.
  if (projection.refusal) {
    return {
      ok: false,
      reason: `projection_refused:${projection.refusal}`,
      message: projection.refusal === "research_without_identity"
        ? "Which company should I look into? I can check a specific one, but I won't go searching without knowing who you mean."
        : "I understood the request, but it isn't something the lead pipeline can serve.",
      violations: [],
    };
  }

  try {
    const result = compileLeadMission({
      originalUserQuery: opts.originalUserQuery,
      // THE UNDERSTANDING, NOT A SECOND READING OF THE SENTENCE.
      proposal: projection.proposal,
      companyBrain: opts.companyBrain ?? null,
      // The count the model read, or null. No regex supplies this.
      requestedCount: projection.requestedCount,
    });
    return { ok: true, result, proposal: projection.proposal };
  } catch (e) {
    if (e instanceof MissionCompilationBlockedError) {
      const violations = (e as { violations?: unknown }).violations;
      return {
        ok: false,
        reason: "mission_compilation_blocked",
        message:
          "I understood what you're asking for, but I couldn't turn it into a run I can safely execute. Nothing was started and nothing was charged.",
        violations: Array.isArray(violations) ? violations.map(String) : [],
      };
    }
    throw e;
  }
}

/**
 * Requirements the request stated that the mission does not carry.
 *
 * REPORTED, NEVER DROPPED SILENTLY. `projectToLeadMission` already records what
 * it could not express; surfacing it here is what lets a preview tell the user
 * "I understood X but cannot filter on it" instead of quietly running a
 * narrower question than the one they asked.
 */
export function unrepresentedRequirements(projection: LeadProjection): string[] {
  return [...projection.unprojected];
}
