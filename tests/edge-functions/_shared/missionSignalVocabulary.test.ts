// `required_signals[].type` IS AN ENUM. IT WAS NEVER ENFORCED AS ONE.
//
// THE RUN THESE TESTS EXIST TO PREVENT — TEST plan
// 486928e8-9ae8-424a-9d37-4871dc8f0f97, 2026-08-20 16:09 UTC, build f914e52c.
//
// `gptMissionSchema.preferred_signals` is a free `string[]`, and
// `proposalToMissionCandidate` copied those strings verbatim into
// `required_signals[].type`. GPT wrote "currently hiring". The lead path
// compares that field with `===` in three places and looks it up as an object
// key in two more, and every one of them missed:
//
//     signal_coverage: { signal: "currently hiring", status: "unrecognised",
//       limitation: "…is not a signal this system recognises, so no source was
//       selected for it. It was neither served nor refused — it was not
//       understood." }
//
// Two runs earlier the same morning the same model, on the same query, wrote
// "hiring". The field is not stable between calls, so trusting it is not a
// policy — it is a coin toss on whether a mission's only signal exists.
//
// THE SEAM. `directives.preferred_signals` stays PROSE: it reaches the Company
// Brain fit and the mission evaluator as prompt text, where "currently hiring"
// says more than "hiring" does. `required_signals[].type` is the machine
// vocabulary, and `canonicalSignalType` is the one place prose becomes it.
//
// These tests drive the REAL functions. No network, provider, model or DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalSignalType, isHiringSignal, MISSION_SIGNAL_TYPES,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  SIGNAL_RESEARCH_ROLES, signalResearchRole,
} from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { scenariosForSignal } from "../../../supabase/functions/_shared/signalActorCoverage.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

// ═══ 1. THE VOCABULARY IS ONE LIST ═════════════════════════════════════════

Deno.test("vocabulary: MISSION_SIGNAL_TYPES covers every research role", () => {
  // Two statements of one rule drift. This is the alignment check that keeps a
  // signal type from existing in the research table and nowhere else.
  assertEquals(
    [...MISSION_SIGNAL_TYPES].sort(),
    Object.keys(SIGNAL_RESEARCH_ROLES).sort(),
  );
});

// ═══ 2. CANONICALIZATION IS SPELLING, NOT INFERENCE ════════════════════════

Deno.test("canonical: the wording that broke run 486928e8", () => {
  assertEquals(canonicalSignalType("currently hiring"), "hiring");
});

Deno.test("canonical: the other wordings the compiler has actually produced", () => {
  for (const raw of [
    "hiring", "Hiring", "  hiring  ", "actively hiring", "currently_hiring",
    "hiring signal", "hiring-signal", "hiring software engineers",
  ]) {
    assertEquals(canonicalSignalType(raw), "hiring", `"${raw}"`);
  }
  assertEquals(canonicalSignalType("recent funding"), "funding");
  assertEquals(canonicalSignalType("leadership change"), "leadership_change");
  assertEquals(canonicalSignalType("product launch"), "product_launch");
});

Deno.test("canonical: an unrecognised phrase is returned VERBATIM", () => {
  // The coverage report's sentence names the signal back to the user. It must
  // keep saying what the model actually asked for — canonicalization exists to
  // stop the vocabulary breaking, never to make an unknown signal look known.
  for (const raw of ["partnership interest", "uses Kubernetes", "churn risk"]) {
    assertEquals(canonicalSignalType(raw), raw);
    assertEquals(signalResearchRole(canonicalSignalType(raw)), "qualifier");
  }
  assertEquals(canonicalSignalType(""), "");
});

Deno.test("canonical: a term embedded in a different WORD does not match", () => {
  assertEquals(canonicalSignalType("rehiring"), "rehiring");
});

Deno.test("isHiringSignal: true for every hiring wording, false otherwise", () => {
  assert(isHiringSignal({ type: "currently hiring" }));
  assert(isHiringSignal({ type: "hiring" }));
  assert(!isHiringSignal({ type: "funding" }));
  assert(!isHiringSignal({ type: "" }));
});

// ═══ 3. THE DOWNSTREAM READERS NOW SEE IT ══════════════════════════════════

Deno.test("coverage: the canonical type resolves to a source; the raw one did not", () => {
  assertEquals(scenariosForSignal("currently hiring"), [],
    "this is the lookup that returned nothing on the failing run");
  assert(scenariosForSignal(canonicalSignalType("currently hiring")).length > 0,
    "after canonicalization the hiring scenario is found and a source is selected");
});

Deno.test("research role: the canonical type is a discovery shape", () => {
  assertEquals(signalResearchRole("currently hiring"), "qualifier",
    "unrecognised — the run had no way to discover anything from its only signal");
  assertEquals(signalResearchRole(canonicalSignalType("currently hiring")), "discovery_shape");
});

// ═══ 4. THE SEAM — WHERE PROSE STOPS AND THE ENUM STARTS ═══════════════════

/** Plan 486928e8's request, and the proposal GPT actually returned for it. */
function compiled(preferred_signals: string[]) {
  return compileLeadMission({
    originalUserQuery: "Find 10 qualified AI startups in the US currently hiring",
    proposal: {
      requested_opportunity_count: 10, requested_contact_ready_count: null,
      company_types: ["AI", "startup"], geographies: ["United States"],
      employee_range: { min: null, max: null },
      decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
      preferred_signals, adjacent_signals: [], excluded_signals: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      disallowed_broadening: ["company_types", "geographies", "hiring_status"],
      required_evidence: ["AI focus", "startup status", "US location", "current hiring evidence"],
      required_capabilities: ["startup_company_discovery", "persistence"],
      preferred_source_strategy: ["startup_cohort_first"],
      evaluation_instructions: "", founder_unlock_recommended: true,
      confidence: 1, unknowns: [], known_companies: [],
      required_signal_terms: ["AI startups", "currently hiring"],
      geography_is_hard: true,
    },
  }).final_mission;
}

Deno.test("seam: the mission's signal TYPE is canonical", () => {
  const m = compiled(["currently hiring"]);
  assertEquals(m.required_signals.map((s) => s.type), ["hiring"],
    "the failing run recorded [{ type: 'currently hiring' }]");
  assert(m.required_signals.some(isHiringSignal));
});

Deno.test("seam: the DIRECTIVES keep the model's own words", () => {
  // These reach `companyBrainSemanticFit` and `missionEvaluation` as prompt
  // text. Canonicalizing them would throw away meaning the evaluator can use.
  assertEquals(compiled(["currently hiring"]).directives.preferred_signals,
    ["currently hiring"]);
});

Deno.test("seam: an unrecognised signal survives to be REPORTED, not silently dropped", () => {
  const m = compiled(["partnership interest"]);
  assertEquals(m.required_signals.map((s) => s.type), ["partnership interest"]);
  assertEquals(m.directives.preferred_signals, ["partnership interest"]);
});
