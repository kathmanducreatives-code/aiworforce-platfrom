// R2 — "THE USER NAMED NO NUMBER" SURVIVES FROM MODEL TO MISSION.
//
// R2-1 made `LeadMissionV1.requested_count` nullable, but the model could not
// USE that: `requested_opportunity_count` was a required number, so a request
// naming no count forced the model to invent one, and the invention was
// indistinguishable from a count the user gave.
//
// Four eval cases genuinely state no count — tight-01, tight-02, geo-02,
// enrich-01. This asserts the whole path preserves that: proposal -> parse ->
// compile -> mission -> provenance, with the execution default applied in
// exactly one place and never written back onto the mission.
//
// Mocked proposals only. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadMission, parseMissionProposal,
  MAX_REQUESTED_OPPORTUNITIES, MIN_REQUESTED_OPPORTUNITIES,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  DEFAULT_REQUESTED_COUNT, effectiveRequestedCount,
} from "../../../supabase/functions/_shared/leadMission.ts";

/** A minimal well-formed proposal; the count is what each test varies. */
function proposal(over: Record<string, unknown> = {}) {
  return {
    requested_opportunity_count: 5,
    requested_contact_ready_count: null,
    company_types: [], geographies: [], employee_range: { min: null, max: null },
    decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [],
    preferred_source_strategy: [], evaluation_instructions: "",
    founder_unlock_recommended: false, confidence: 0.9, unknowns: [],
    known_companies: [], signal_recency_days: null, required_signal_terms: [],
    no_broadening_requested: false, geography_is_hard: false, prohibitions: [],
    output_intent: null,
    ...over,
  };
}

// tight-01: names an ICP, a signal and a geography — and no number.
const NO_COUNT_QUERY =
  "Find B2B SaaS companies hiring Revenue Operations, RevOps, or first sales in the United States.";

// ===========================================================================
// PARSE — three cases, and only one of them is malformed
// ===========================================================================

Deno.test("an explicit null count is accepted as a statement", () => {
  const r = parseMissionProposal(proposal({ requested_opportunity_count: null }));
  assert(r.proposal != null, `null must not be rejected; violations: ${JSON.stringify(r.violations)}`);
  assertEquals(r.proposal!.requested_opportunity_count, null);
  assertEquals(r.repairs, [], "a statement is not a repair");
});

Deno.test("a stated number is still accepted and still clamped", () => {
  assertEquals(parseMissionProposal(proposal({ requested_opportunity_count: 30 })).proposal!
    .requested_opportunity_count, 30);

  const tooMany = parseMissionProposal(proposal({ requested_opportunity_count: 5000 }));
  assertEquals(tooMany.proposal!.requested_opportunity_count, MAX_REQUESTED_OPPORTUNITIES);
  assert(tooMany.repairs.some((x) => x.startsWith("requested_opportunity_count_capped")));

  const tooFew = parseMissionProposal(proposal({ requested_opportunity_count: 0 }));
  assertEquals(tooFew.proposal!.requested_opportunity_count, MIN_REQUESTED_OPPORTUNITIES);
  assert(tooFew.repairs.some((x) => x.startsWith("requested_opportunity_count_raised")));
});

Deno.test("everything that is NOT a number and NOT an explicit null is still malformed", () => {
  // The distinction the change turns on. Widening null must not widen the rest:
  // a proposal that cannot state the count has not understood the schema, and
  // defaulting it would build a confident mission on a value nobody supplied.
  for (const bad of [undefined, "", "abc", true, false, {}, []]) {
    const r = parseMissionProposal(proposal({ requested_opportunity_count: bad }));
    assertEquals(
      r.proposal, null,
      `${JSON.stringify(bad)} must be rejected, not read as "no count"`,
    );
    assertEquals(r.violations[0]?.path, "requested_opportunity_count");
  }
});

// ===========================================================================
// COMPILE — the null reaches the mission, and the default does not
// ===========================================================================

Deno.test("a null count compiles to a mission that says null", () => {
  const r = compileLeadMission({
    originalUserQuery: NO_COUNT_QUERY,
    proposal: proposal({ requested_opportunity_count: null }),
  });
  assertEquals(r.parser_source, "gpt_validated");
  assertEquals(r.final_mission.requested_count, null, "the mission must not acquire a number");
  assertEquals(
    r.final_mission.field_provenance["requested_count"], "system_default",
    "and must not attribute one to the user",
  );
});

Deno.test("the execution default is applied at the edge, never written onto the mission", () => {
  const r = compileLeadMission({
    originalUserQuery: NO_COUNT_QUERY,
    proposal: proposal({ requested_opportunity_count: null }),
  });
  assertEquals(effectiveRequestedCount(r.final_mission), DEFAULT_REQUESTED_COUNT);
  assertEquals(r.final_mission.requested_count, null, "reading the default must not mutate the mission");
});

Deno.test("a null count is not silently clamped by the compiler's ceiling", () => {
  // compileLeadMission caps/raises requested_count. Null has nothing to cap, and
  // substituting the default there would re-erase the distinction.
  const r = compileLeadMission({
    originalUserQuery: NO_COUNT_QUERY,
    proposal: proposal({ requested_opportunity_count: null }),
  });
  assert(
    !r.validator_changes.some((c) => c.startsWith("requested_count_capped") || c.startsWith("requested_count_raised")),
    `null must not be clamped; got ${r.validator_changes.join(", ")}`,
  );
});

Deno.test("a stated count still survives compilation unchanged", () => {
  const r = compileLeadMission({
    originalUserQuery: "Find 30 early-stage SaaS companies in the US hiring SDRs",
    proposal: proposal({ requested_opportunity_count: 30 }),
  });
  assertEquals(r.final_mission.requested_count, 30);
  assertEquals(effectiveRequestedCount(r.final_mission), 30, "a stated count is never overridden");
  assertEquals(r.final_mission.field_provenance["requested_count"], "explicit_user_request");
});

Deno.test("the model is TOLD null is available, so it need not invent a number", () => {
  // A schema that permits null while the prompt still demands a number would
  // leave the model inventing counts exactly as before.
  const { MISSION_COMPILER_SYSTEM_PROMPT, buildMissionCompilerPayload } = compilerModule;
  assert(
    /requested_opportunity_count.*null/s.test(MISSION_COMPILER_SYSTEM_PROMPT),
    "the system prompt must say null is the answer when no number is named",
  );
  const shape = (buildMissionCompilerPayload({ originalUserQuery: "x" })
    .response_shape as Record<string, unknown>);
  assert(
    String(shape.requested_opportunity_count).includes("null"),
    "the response shape must advertise null",
  );
});

import * as compilerModule from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
