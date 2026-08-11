// R2 — `LeadStrategyMission` IS A PROJECTION, AND `strategies[]` REACHES DOWNSTREAM.
//
// Two things, both about the same rule: a request is interpreted ONCE, into
// `LeadMissionV1`, and every other mission-shaped object downstream is a
// projection of it rather than a second reading.
//
// PART 1 — the broadening path used to drop the user's hardest constraint.
//   `missionFromSpec` (initial planning) carried `no_broadening_requested` and
//   `required_signal_terms`. `missionFromPlannerInput` (round-to-round
//   broadening) did not carry them AT ALL, so `validateLeadStrategy` read them
//   as `?? false` / `[]` — the user's "do not broaden" vanished at exactly the
//   moment broadening was being decided. Nothing compared the two constructors.
//
// PART 2 — `strategies[]` must survive proposal -> mission intact, so R3 has
//   something real to route. R2 does not build strategy execution.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectStrategyMissionSemantics, type LeadStrategyMission,
} from "../../../supabase/functions/_shared/leadStrategyContract.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  MISSION_STRATEGIES, parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";

const BASE: LeadStrategyMission = {
  original_query: "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.",
  requested_lead_count: 5,
  requested_titles: ["SDR"],
  decision_maker_roles: [],
  geography: "London",
  company_vertical: null,
  company_size: null,
  maturity_stages: [],
};

// ===========================================================================
// PART 1 — PROJECTION, NOT RE-DERIVATION
// ===========================================================================

Deno.test("the projector carries the canonical mission's constraints onto the projection", () => {
  const p = projectStrategyMissionSemantics(BASE, {
    no_broadening_requested: true,
    required_signal_terms: ["SDR"],
  });
  assertEquals(p.no_broadening_requested, true);
  assertEquals(p.required_signal_terms, ["SDR"]);
  // Everything structural is untouched — this projects semantics only.
  assertEquals(p.requested_titles, ["SDR"]);
  assertEquals(p.geography, "London");
  assertEquals(p.requested_lead_count, 5);
});

Deno.test("a canonical mission that says nothing projects nothing — no invention", () => {
  const p = projectStrategyMissionSemantics(BASE, {});
  assertEquals(p.no_broadening_requested, undefined);
  assertEquals(p.required_signal_terms, undefined);
});

Deno.test("NO canonical mission leaves the projection untouched", () => {
  // The deterministic-workspace path. orchestrate gates it separately, so this
  // is a migration state rather than a semantic fallback for a compiled request.
  assertEquals(projectStrategyMissionSemantics(BASE, null), BASE);
  assertEquals(projectStrategyMissionSemantics(BASE, undefined), BASE);
});

Deno.test("the projector never reads raw text", () => {
  // It takes the canonical mission STRUCTURALLY and has no access to the
  // sentence. A projection that could re-parse `original_query` would be a
  // second interpreter wearing a projection's name.
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadStrategyContract.ts", import.meta.url),
  );
  const fn = src.slice(src.indexOf("export function projectStrategyMissionSemantics"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert(!/original_query/.test(body), "the projector must not touch the raw query");
  assert(!/match\(|test\(|RegExp|\/\^/.test(body), "the projector must contain no parsing");
});

Deno.test("the broadening constructor now has somewhere to put the constraints", () => {
  // Structural: missionFromPlannerInput must read them from `overrides` — which
  // the caller projects — and must NOT fall back to anything derived from
  // PlannerInput, which carries no reading of the user's sentence.
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadStrategyOwner.ts", import.meta.url),
  );
  const fn = src.slice(src.indexOf("function missionFromPlannerInput"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert(/no_broadening_requested: overrides\?\.no_broadening_requested/.test(body));
  assert(/required_signal_terms: overrides\?\.required_signal_terms/.test(body));
  assert(
    !/no_broadening_requested: overrides\?\.no_broadening_requested \?\?/.test(body),
    "there must be no fallback beyond the projected overrides",
  );
});

Deno.test("run-agent projects the broadening mission from the canonical mission", () => {
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(
    /projectStrategyMissionSemantics\(\{/.test(src),
    "the broadening planner's mission must be built through the projector",
  );
  assert(
    /projectStrategyMissionSemantics\([\s\S]{0,2000}?readPersistedLeadMission\(/.test(src),
    "and its second argument must be the persisted canonical mission",
  );
});

// ===========================================================================
// PART 2 — strategies[] SURVIVES PROPOSAL -> MISSION
// ===========================================================================

function proposal(over: Record<string, unknown> = {}) {
  return {
    requested_opportunity_count: 3, requested_contact_ready_count: null,
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
    output_intent: null, strategies: [],
    ...over,
  };
}

Deno.test("a proposed strategy set reaches the compiled mission intact", () => {
  const r = compileLeadMission({
    originalUserQuery: "Find 3 AI SaaS companies recently funded hiring SDRs",
    proposal: proposal({ strategies: ["funding", "hiring", "multi_signal"] }),
  });
  assertEquals(r.parser_source, "gpt_validated");
  assertEquals(r.final_mission.strategies, ["funding", "hiring", "multi_signal"]);
});

Deno.test("every strategy in the vocabulary survives a round trip", () => {
  // If one of the six were dropped by the parse or the validator, R3 would find
  // it missing only when it tried to route it.
  const r = compileLeadMission({
    originalUserQuery: "Find companies",
    proposal: proposal({ strategies: [...MISSION_STRATEGIES] }),
  });
  assertEquals(r.final_mission.strategies, [...MISSION_STRATEGIES]);
});

Deno.test("an unroutable strategy is dropped and NAMED, at the compiler boundary", () => {
  const r = compileLeadMission({
    originalUserQuery: "Find companies",
    proposal: proposal({ strategies: ["hiring", "astrology"] }),
  });
  assertEquals(r.final_mission.strategies, ["hiring"]);
  assert(
    r.validator_changes.some((c) => c === "unknown_strategy_dropped:astrology"),
    `the drop must be recorded; got ${r.validator_changes.join(", ")}`,
  );
});

Deno.test("no strategies proposed leaves the mission's field absent", () => {
  const r = compileLeadMission({
    originalUserQuery: "Find 5 AI workflow companies in Europe",
    proposal: proposal({ strategies: [] }),
  });
  assertEquals(r.final_mission.strategies, undefined, "empty is absent, not a claim");
});

Deno.test("the deterministic path proposes no strategies at all", () => {
  // Strategy selection is a model judgement. The regex reading has no basis for
  // one, and inventing a default here would put a research shape on a request
  // that never asked for it.
  assertEquals(
    parseLeadMissionDeterministic("Find 5 AI workflow companies in Europe").strategies,
    undefined,
  );
});

Deno.test("the model is asked for strategies, from the closed vocabulary", () => {
  const { buildMissionCompilerPayload } = compilerModule;
  const shape = buildMissionCompilerPayload({ originalUserQuery: "x" })
    .response_shape as Record<string, unknown>;
  assertEquals(shape.strategies, MISSION_STRATEGIES);
});

import * as compilerModule from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
