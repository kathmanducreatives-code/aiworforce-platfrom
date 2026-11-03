// Stage 5 (Option E): one invariant over every interpretation guard — nothing a mission
// states is dropped or softened without a named, reviewed rule (scripts/dev/requirement-coverage.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coverage, findings, GUARDS } from "../../../scripts/dev/requirement-coverage.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";

Deno.test("coverage: every stored mission and corpus case keeps each stated requirement, or a named guard explains it", async () => {
  const c = await coverage();
  const unexplained = Object.entries(c).flatMap(([k, fs]) => fs.filter((f) => !f.guard).map((f) => `${k}: ${f.kind} ${f.item}`));
  assertEquals(unexplained, []);
  const used = new Set(Object.values(c).flat().map((f) => f.guard));
  for (const g of GUARDS) assert(used.has(g.name), `guard ${g.name} explains at least one real case (or it is dead and should go)`);
});

Deno.test("coverage: a monitoring mission keeps its ICP's 'startup' as a disclosed target (production replay finding)", () => {
  const mission = {
    version: "lead-mission-v1", original_user_query: "[monitoring] the workspace ICP", mission_type: "company_research",
    target_entity: "company", requested_output: "qualified_companies", requested_count: null,
    company_profile: { business_models: [], verticals: ["b2b saas"], stages: ["startup"], locations: ["United States"] },
    required_signals: [{ type: "hiring", timeframe_days: 30 }], decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {}, required_capabilities: [], prohibited_capabilities: [],
    field_provenance: { company_profile: "monitoring_subject", required_signals: "monitoring_subject" }, confidence: 1, mission_objective: "monitoring",
  };
  const crit = deriveMissionCriteria(mission as never);
  const startup = crit.find((c) => c.dimension === "company_stage" && c.value === "startup");
  assert(startup, "the ICP's startup is not dropped");
  assertEquals([startup.kind, startup.status], ["target", "unprovable_today"], "disclosed, ranks, never rejects");
  assertEquals(findings(mission, crit as never), []);
});

Deno.test("coverage: a stated user 'startup' without the word in the request is still governed by Q3", () => {
  const mission = {
    version: "lead-mission-v1", original_user_query: "Find 5 AI companies that raised Series A.", mission_type: "company_research",
    target_entity: "company", requested_output: "qualified_companies", requested_count: 5,
    company_profile: { business_models: [], verticals: ["AI"], stages: ["startup"], locations: [] },
    required_signals: [], decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {}, required_capabilities: [], prohibited_capabilities: [], field_provenance: {}, confidence: 0.9,
  };
  assertEquals(deriveMissionCriteria(mission as never).filter((c) => c.value === "startup"), [], "no invented company kind from a sentence");
});
