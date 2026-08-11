// R2 — THE STRATEGY ADAPTER READS THE MISSION, NOT THE SENTENCE AGAIN.
//
// `missionFromSpec` used to take `no_broadening_requested` and
// `required_signal_terms` off `input.spec` — jobSearchSpec's regex reading of
// the raw query. Both are carried on `LeadMissionV1` as of R1, compiled from the
// same sentence by the model. Reading them off the spec meant the regex answered
// a question the compiler had already settled, one layer downstream, with no way
// to tell which answer a run had used.
//
// These tests fix the precedence: when a Mission exists it is the authority, and
// its SILENCE is authoritative too.
//
// Pure — no network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  missionFromSpec, missionConstraintSource,
  type LeadStrategyInitialInput,
} from "../../../supabase/functions/_shared/leadStrategyBridge.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";

const QUERY = "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.";

/** A spec whose regex reading DISAGREES with the mission, so precedence is visible. */
function specSaying(no_broadening_requested: boolean, required_signal_terms: string[]) {
  return {
    original_query: QUERY,
    keyword_queries: ["SDR"],
    requested_person_roles: [],
    location: "London",
    no_broadening_requested,
    required_signal_terms,
  } as unknown as LeadStrategyInitialInput["spec"];
}

function withMission(mission: LeadMissionV1 | null, spec: LeadStrategyInitialInput["spec"]) {
  return missionFromSpec({
    workspaceId: "ws-1", spec, requestedLeadCount: 5, mission,
  } as LeadStrategyInitialInput);
}

function missionSaying(over: Partial<LeadMissionV1>): LeadMissionV1 {
  return { ...parseLeadMissionDeterministic(QUERY), ...over };
}

Deno.test("the Mission wins over the spec's regex reading", () => {
  // Spec says "no broadening, term=WRONG"; mission says "broadening allowed,
  // term=SDR". The mission is the compiled reading of the same sentence.
  const m = withMission(
    missionSaying({ no_broadening_requested: undefined, required_signal_terms: ["SDR"] }),
    specSaying(true, ["WRONG_REGEX_TERM"]),
  );
  assertEquals(m.required_signal_terms, ["SDR"]);
  assertEquals(m.no_broadening_requested, undefined);
});

Deno.test("the Mission's SILENCE is authoritative — it does not fall through to the regex", () => {
  // The subtle one. A mission that states no signal terms means the compiler
  // found none. Falling back to the spec for that field would reintroduce the
  // second opinion this change removes, and would do it invisibly.
  const m = withMission(
    missionSaying({ required_signal_terms: undefined, no_broadening_requested: undefined }),
    specSaying(true, ["REGEX_ONLY_TERM"]),
  );
  assertEquals(m.required_signal_terms, undefined, "spec must not fill a field the mission left empty");
  assertEquals(m.no_broadening_requested, undefined);
});

Deno.test("a mission that says 'do not broaden' carries it through", () => {
  const m = withMission(
    missionSaying({ no_broadening_requested: true, required_signal_terms: ["SDR"] }),
    specSaying(false, []),
  );
  assertEquals(m.no_broadening_requested, true, "the request's hardest constraint must survive");
  assertEquals(m.required_signal_terms, ["SDR"]);
});

Deno.test("with NO mission the spec is still read — the migration path is intact", () => {
  // Deterministic-workspace path. orchestrate gates this separately: a workspace
  // in new_architecture mode returns 422 mission_not_compiled rather than
  // arriving here without one, so this is not a semantic fallback for a
  // compiled request.
  const m = withMission(null, specSaying(true, ["SPEC_TERM"]));
  assertEquals(m.no_broadening_requested, true);
  assertEquals(m.required_signal_terms, ["SPEC_TERM"]);
});

Deno.test("the constraint source is reportable, so a run can say which reading it used", () => {
  assertEquals(missionConstraintSource({ mission: missionSaying({}) }), "lead_mission_v1");
  assertEquals(missionConstraintSource({ mission: null }), "job_search_spec_regex");
  assertEquals(missionConstraintSource({}), "job_search_spec_regex");
});

Deno.test("nothing else on the strategy mission changed shape", () => {
  const m = withMission(missionSaying({}), specSaying(false, []));
  assertEquals(m.original_query, QUERY);
  assertEquals(m.requested_lead_count, 5);
  assertEquals(m.requested_titles, ["SDR"]);
  assertEquals(m.geography, "London");
  assert(Array.isArray(m.maturity_stages));
});
