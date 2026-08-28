// THE START BUTTON, BUILT FROM THE MISSION THAT WILL RUN.
//
// ── THE DEFECT THIS EXISTS TO END ──────────────────────────────────────────
//
// The lead route wrote `type: "workflow_confirmation"` on its reply and put the
// preview under `mission_preview`. `ChatView` renders the card only when BOTH
// `meta.type === 'workflow_confirmation'` AND `meta.workflow_confirmation` are
// present, so every sourcing request produced the narration —
//
//   "Here's what I'd run: discover companies by profile, then resolve company
//    identity, … This one uses credits."
//
// — and no card, no Start, no way to run it. The outcome said REQUIRES_UNLOCK
// and there was nothing to unlock it with. A gate with no key is not a gate;
// it is a dead end, and the request had been understood, compiled and assessed
// perfectly before arriving at it.
//
// The old path built this payload with `generateWorkflowConfirmation`, which
// makes its OWN model call and compiles its OWN mission — a second reading of
// the sentence whose card could describe a run the executor was never going to
// perform. That is why it was removed, and it must not come back.
//
// So the payload is DERIVED. Every field below comes from the compiled
// `LeadMissionV1` or from the capability graph Stage 0 already assessed. No
// model call, no network, no database — the card and the run cannot disagree
// because they are built from the same object.
//
// ── AND IT NAMES NO AGENTS ─────────────────────────────────────────────────
//
// `agent_team` is deliberately empty. The card renders the team only when the
// list is non-empty, and the graph does not say which persona performs a
// capability — so claiming one would be exactly the "Scout will source, Aria
// will screen" narration that `missionPreview` exists to prevent, moved into a
// nicer-looking box.

import type { LeadMissionV1 } from "./leadMission.ts";
import type { MissionPreview } from "./missionPreview.ts";

export const MISSION_CARD_VERSION = "mission-card-v1" as const;

/**
 * The shape `WorkflowConfirmationCard` reads.
 *
 * Only the fields the card actually renders, plus the two it threads back on
 * Start (`lead_mission`, `original_instruction`). The legacy payload carries
 * more; those fields exist for pre-mission conversations and inventing values
 * for them here would be describing a run nobody planned.
 */
export interface MissionConfirmationPayload {
  workflow_id: string;
  workflow_name: string;
  goal: string;
  /** Empty, always. See the header. */
  agent_team: string[];
  inputs: Record<string, unknown>;
  output: string;
  safety: string;
  estimated_credits: number | null;
  blocked: boolean;
  blocked_reason: string | null;
  setup_needed: string | null;
  /** The compiled mission. The card renders from this and Start returns it. */
  lead_mission: LeadMissionV1;
  /** The user's own words, so Start sends the request and not a rewrite. */
  original_instruction: string;
  workflow_kind: string;
  card_version: typeof MISSION_CARD_VERSION;
}

const titleFor = (mission: LeadMissionV1): string => {
  const n = mission.requested_count;
  const what = mission.target_entity === "company" ? "companies" : "people";
  const verticals = mission.company_profile?.verticals ?? [];
  const scope = verticals.length > 0 ? ` in ${verticals.join(", ")}` : "";
  return `Find ${n ?? "matching"} ${what}${scope}`;
};

/**
 * Build the card from the mission and the preview.
 *
 * TOTAL AND PURE. An infeasible mission still produces a payload — marked
 * blocked, with Stage 0's own reason — because a card that silently vanished
 * would leave the user with a narration and no explanation again.
 */
export function buildMissionConfirmation(
  mission: LeadMissionV1,
  preview: MissionPreview,
  originalInstruction: string,
): MissionConfirmationPayload {
  const signals = (mission.required_signals ?? [])
    .map((s) => s.phrase || s.type).filter(Boolean);
  return {
    // STABLE AND DERIVED, not random: the same request previewed twice is the
    // same workflow, and a fresh id each time would make the two look like
    // different work in any telemetry that groups by it.
    workflow_id: `lead-mission:${mission.mission_type}`,
    workflow_name: titleFor(mission),
    goal: mission.original_user_query || originalInstruction,
    agent_team: [],
    inputs: {
      count: mission.requested_count ?? undefined,
      count_entity: mission.target_entity === "company" ? "account" : "person",
      industry: (mission.company_profile?.verticals ?? []).join(", ") || undefined,
      location: (mission.company_profile?.locations ?? []).join(", ") || undefined,
      signals: signals.length > 0 ? signals.join(", ") : undefined,
    },
    output: mission.requested_output === "qualified_companies"
      ? "Qualified companies saved to your leads"
      : "Results saved to your workspace",
    // THE SAFETY LINE IS A FACT ABOUT THE GRAPH, not reassurance. `spends` is
    // computed from whether any step can reach a provider.
    safety: preview.spends
      ? "Nothing is contacted. Results are saved for your review."
      : "Nothing is contacted and nothing is bought.",
    // THE GRAPH'S OWN COST, the same number the narration quotes.
    estimated_credits: preview.estimated_cost_units,
    blocked: !preview.feasible,
    blocked_reason: preview.feasible
      ? null
      : preview.gaps.map((g) => g.detail).join("; ") || null,
    setup_needed: null,
    lead_mission: mission,
    original_instruction: originalInstruction,
    workflow_kind: "account_opportunity_sourcing",
    card_version: MISSION_CARD_VERSION,
  };
}
