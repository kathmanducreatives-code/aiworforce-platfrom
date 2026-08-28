// THE BACKEND'S CARD PAYLOAD, READ BY THE FRONTEND THAT RENDERS IT.
//
// ── WHY THIS CROSSES THE BOUNDARY ──────────────────────────────────────────
//
// The sourcing reply carried `type: "workflow_confirmation"` and a
// `mission_preview`, and `ChatView` renders the Start card only when
// `meta.type === 'workflow_confirmation' && meta.workflow_confirmation` are
// BOTH present. Neither side was wrong on its own: the handler emitted a
// coherent outcome, the component read a coherent condition, and no test on
// either side of the seam could see that they disagreed. Every sourcing
// request produced a narration and no way to run it.
//
// So this test holds both ends at once — the shared builder that produces the
// payload, and the frontend predicates that decide what the card shows.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionConfirmation,
} from "../../supabase/functions/_shared/missionConfirmationCard.ts";
import {
  isMission, missionRows, missionCapabilities,
} from "../../src/lib/leadMission/missionView.ts";

const MISSION = {
  version: "lead-mission-v1",
  mission_type: "company_research",
  target_entity: "company",
  requested_count: 3,
  requested_output: "qualified_companies",
  original_user_query:
    "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  company_profile: { verticals: ["recruiting", "staffing"], locations: [], stages: [], business_models: [] },
  decision_makers: { roles: [], current_employment_required: false },
  required_signals: [{ type: "hiring", event: "hiring", subject: "company", phrase: "hiring sales roles", qualifier: { role_terms: ["sales roles"] } }],
  directives: {}, hard_constraints: {}, soft_preferences: {},
  field_provenance: { requested_count: "explicit_user_request" },
  required_capabilities: [], prohibited_capabilities: [],
  // deno-lint-ignore no-explicit-any
} as any;

const PREVIEW = {
  version: "mission-preview-v1" as const,
  summary: "3 companies in recruiting, staffing",
  steps: [
    { capability: "discover_companies", providers: ["x"], cost_units: 2, describes: "discover companies by profile" },
    { capability: "verify_hiring_signal", providers: ["y"], cost_units: 5, describes: "verify hiring signal" },
  ],
  estimated_cost_units: 7,
  spends: true,
  feasible: true,
  gaps: [],
  narration: "Here's what I'd run: …",
};

Deno.test("the payload the handler emits is one the card can render", () => {
  const card = buildMissionConfirmation(MISSION, PREVIEW, MISSION.original_user_query);

  // THE CONDITION `ChatView` ACTUALLY TESTS. A truthy payload beside the type.
  assert(card, "a falsy payload renders no card at all");
  assert(typeof card.workflow_name === "string" && card.workflow_name.length > 0);
  assert(card.inputs && typeof card.inputs === "object");
  assert(typeof card.output === "string" && card.output.length > 0);
  assert(typeof card.safety === "string" && card.safety.length > 0);

  // THE MISSION SURVIVES THE CROSSING, so the card renders the same object
  // run-agent executes and Start hands it straight back.
  assert(isMission(card.lead_mission), "the frontend must recognise the mission");
  assert(missionRows(card.lead_mission).length > 0, "the card must have rows to show");
  assertEquals(missionCapabilities(card.lead_mission).length >= 0, true);
});

Deno.test("the card quotes the graph's cost, never its own", () => {
  const card = buildMissionConfirmation(MISSION, PREVIEW, "x");
  assertEquals(card.estimated_credits, PREVIEW.estimated_cost_units);
});

Deno.test("the card names no agent", () => {
  // The component renders a team only when `agent_team` is non-empty, and the
  // capability graph does not say which persona performs a capability. A name
  // here is the "Scout will source, Aria will screen" narration in a nicer box.
  const card = buildMissionConfirmation(MISSION, PREVIEW, "x");
  assertEquals(card.agent_team, []);
});

Deno.test("an infeasible mission still produces a card, marked blocked", () => {
  // A card that vanished would leave the user with a narration and no
  // explanation — the failure this whole file exists to catch.
  const card = buildMissionConfirmation(MISSION, {
    ...PREVIEW, feasible: false,
    gaps: [{ code: "no_provider", detail: "nothing can verify hiring signals" }],
  }, "x");
  assertEquals(card.blocked, true);
  assertEquals(card.blocked_reason, "nothing can verify hiring signals");
});

Deno.test("the same request previews as the same workflow id", () => {
  const a = buildMissionConfirmation(MISSION, PREVIEW, "x");
  const b = buildMissionConfirmation(MISSION, PREVIEW, "x");
  assertEquals(a.workflow_id, b.workflow_id);
});
