// THE REQUESTED COUNT IS A SEMANTIC FIELD, AND THE MISSION OWNS IT.
//
// The three lead paths passed `extractRequestedLeadCount(sentence)` into
// `compileCanonicalLeadMission`, which handed it to `compileLeadMission` as
// `opts.requestedCount`. There it OVERRODE the count the model had read from the
// same sentence: `parseLeadMissionDeterministic` takes `opts.requestedCount ??
// extractRequestedCount(q)`, and `validateLeadMission` falls back to that base.
//
// So a regex could overrule the interpreter about how many leads the user asked
// for, and the mission's own provenance would still say the value came from the
// request.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_REQUESTED_COUNT, effectiveRequestedCount,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

const CODE = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("no lead path injects a regex count into mission compilation", () => {
  const injections = [...CODE.matchAll(/requestedCount:\s*extractRequestedLeadCount\(/g)];
  assertEquals(
    injections.length, 0,
    "a regex count passed as opts.requestedCount overrides what the model read",
  );
});

Deno.test("every compiler call site states the count as null", () => {
  // Null is the honest input: the compiler's job is to READ the count out of the
  // sentence, not to be told it by another reader of the same sentence.
  const sites = [...CODE.matchAll(/compileCanonicalLeadMission\(\{[\s\S]{0,400}?\}\)/g)]
    .map((m) => m[0]);
  assert(sites.length >= 3, `expected the three lead paths, found ${sites.length}`);
  for (const site of sites) {
    assert(
      /requestedCount:\s*null/.test(site),
      `a compiler call site still supplies a count:\n${site}`,
    );
  }
});

Deno.test("a supplied count overrides the sentence's own reading — which is why none is supplied", () => {
  // Proves the mechanism the change removes rather than asserting its absence.
  //
  // On the GPT path R2-4 already neutralised it: an explicit null from the model
  // is a STATEMENT and wins over opts.requestedCount. The injection still bites
  // on the DETERMINISTIC path, which every non-new-architecture workspace uses —
  // `parseLeadMissionDeterministic(query, { requestedCount })` takes the injected
  // value ahead of what the query says, and provenance then credits the user.
  const q = "Find B2B SaaS companies hiring SDRs";

  const clean = compileLeadMission({ originalUserQuery: q });
  assertEquals(clean.final_mission.requested_count, null, "the query names no count");
  assertEquals(clean.final_mission.field_provenance["requested_count"], "system_default");

  const injected = compileLeadMission({ originalUserQuery: q, requestedCount: 7 });
  assertEquals(
    injected.final_mission.requested_count, 7,
    "an injected count replaces the reading of the sentence",
  );
  assertEquals(
    injected.final_mission.field_provenance["requested_count"], "explicit_user_request",
    "and is then attributed to the user, who never said it",
  );
});

Deno.test("execution still gets a number, from the Mission and its default only", () => {
  assertEquals(effectiveRequestedCount({ requested_count: null }), DEFAULT_REQUESTED_COUNT);
  assertEquals(effectiveRequestedCount({ requested_count: 30 }), 30);
});

Deno.test("the count the model states survives compilation untouched", () => {
  const mk = (n: number | null) => ({
    requested_opportunity_count: n,
    requested_contact_ready_count: null, company_types: [], geographies: [],
    employee_range: { min: null, max: null }, decision_maker_roles: [],
    hard_constraints: [], soft_preferences: [], preferred_signals: [],
    adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [],
    preferred_source_strategy: [], evaluation_instructions: "",
    founder_unlock_recommended: false, confidence: 0.9, unknowns: [],
    known_companies: [], signal_recency_days: null, required_signal_terms: [],
    no_broadening_requested: false, geography_is_hard: false, prohibitions: [],
    output_intent: null, strategies: [],
  });
  assertEquals(
    compileLeadMission({ originalUserQuery: "Find 30 SaaS companies", proposal: mk(30) })
      .final_mission.requested_count, 30);
  assertEquals(
    compileLeadMission({ originalUserQuery: "Find SaaS companies", proposal: mk(null) })
      .final_mission.requested_count, null, "and an unstated count stays unstated");
});
