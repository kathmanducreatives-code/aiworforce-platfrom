// "B2B" is a requirement only in the user's own words (missionCriteria.ts `audienceIntent`).
//
// TEST plan 116a1b45 ("Find 5 US B2B companies actively hiring salespeople …")
// compiled "B2B" as a HARD industry: the model filed it under company_types, the
// word is in the request, and every such value became hard — so every company
// waited on a label no discovery provider can establish. A business-model AUDIENCE
// (B2B / B2C / D2C) is now a business model whose hardness the request's wording
// decides: excluded, required, preferred, permitted, or merely descriptive.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { audienceDescriptor, audienceIntent } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { requirementsFromMission } from "../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { matchBusinessModel } from "../../../supabase/functions/_shared/businessModelMatch.ts";
import { specFromMission, planStrategy, type StrategyContext } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { planChecks } from "../../../scripts/deploy/test-functions-smoke.ts";

const BLANK = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: null, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: null, strategies: [],
};
const US_HARD = { field: "geography", operator: "in", value: ["United States"], reason: "US" };
const hiring = (terms: string[]) => ({
  geographies: ["United States"], hard_constraints: [US_HARD], preferred_signals: ["hiring"], signal_recency_days: 30,
  strategies: ["hiring"], output_intent: "companies", required_signal_terms: terms,
});

function compile(query: string, proposal: Record<string, unknown>, count: number | null = null) {
  const mission = compileLeadMission({ originalUserQuery: query, proposal: { ...BLANK, ...proposal }, requestedCount: count }).final_mission as {
    criteria: { kind: string; dimension: string; value: unknown; source?: string; rationale?: string }[];
  };
  const req = requirementsFromMission(mission as never);
  const audience = mission.criteria.filter((c) => c.dimension === "business_model" || c.dimension === "exclusion" ||
    (c.dimension === "industry" && audienceDescriptor(c.value)));
  return { mission, req, audience, hard: req.hard.map((h) => h.key).sort(), prefs: req.preferences.map((p) => `${p.key}:${JSON.stringify(p.values)}`) };
}

const TEST_QUERY = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range and explain why.";

Deno.test("audience descriptor: only a pure B2B / B2C phrase, read by the controlled vocabulary", () => {
  for (const v of ["B2B", "b2b companies", "business-to-business", "B2C", "D2C", "direct-to-consumer"]) assert(audienceDescriptor(v), v);
  for (const v of ["B2B SaaS", "SaaS", "fintech", "AI B2B", "enterprise", "Account Executive", ""]) assertEquals(audienceDescriptor(v), null, v);
});

Deno.test("audience intent: the user's words decide (exclude > require > prefer > permit > describe)", () => {
  assertEquals(audienceIntent("Find US B2B companies hiring Account Executives.", "b2b"), "describe");
  assertEquals(audienceIntent("Only include verified B2B companies. Exclude B2C businesses.", "b2b"), "require");
  assertEquals(audienceIntent("Only include verified B2B companies. Exclude B2C businesses.", "consumer"), "exclude");
  assertEquals(audienceIntent("Companies must be B2B.", "b2b"), "require");
  assertEquals(audienceIntent("B2B only, hiring sellers.", "b2b"), "require");
  assertEquals(audienceIntent("Prefer B2B companies, but include strong B2C opportunities.", "b2b"), "prefer");
  assertEquals(audienceIntent("Prefer B2B companies, but include strong B2C opportunities.", "consumer"), "permit");
  assertEquals(audienceIntent("Find US B2B companies, no B2C.", "consumer"), "exclude");
  assertEquals(audienceIntent("Find companies with no outside funding that sell B2B software", "b2b"), "describe", "a distant 'no' says nothing about B2B");
  assertEquals(audienceIntent("Find US companies hiring salespeople.", "b2b"), "absent");
  // Deterministic: the same words, the same answer.
  for (let i = 0; i < 3; i++) assertEquals(audienceIntent(TEST_QUERY, "b2b"), "describe");
});

Deno.test("the TEST smoke query: US HQ and hiring hard; B2B and 20–500 preferences", () => {
  const r = compile(TEST_QUERY, { ...hiring(["salespeople"]), company_types: ["B2B"], employee_range: { min: 20, max: 500 }, requested_opportunity_count: 5 }, 5);
  assertEquals(r.hard, ["geography_hq", "signal"]);
  assertEquals(r.prefs, ["business_model:[\"B2B\"]"]);
  assertFalse(r.mission.criteria.some((c) => c.dimension === "industry"), "B2B is not an industry");
  // The planner and the deployed smoke checks agree.
  const spec = specFromMission(r.mission as never, { defaultCount: 5 });
  assertEquals(spec.preferredEmployees, { min: 20, max: 500 }, "the size is a preference (ranking only)");
  assertEquals(spec.employees, null, "and never a hard range");
  assertEquals(spec.industry, []);
  assertEquals(spec.otherHard, []);
  const ctx: StrategyContext = {
    providers: { apify: { enabled: true, connected: true, authorized: true }, leadocean: { enabled: false, connected: false, authorized: true }, apollo: { enabled: false, connected: false, authorized: true } },
    budget: { maxLeadoceanRecords: 50, maxApifyUsd: 0.25 },
  };
  const plan = planStrategy(spec, ctx);
  assertEquals([plan.status, plan.strategy], ["ready", "apify_only"]);
  assertFalse(plan.limitations.some((l) => /industry|business_model/.test(l.detail)), "no unverifiable B2B requirement left to disclose");
  const smoke = planChecks(200, { plan, interpretation: {
    hard: r.req.hard.map((h) => ({ key: h.key })),
    preferences: [{ key: "employee_range", values: spec.preferredEmployees }, ...r.req.preferences.map((p) => ({ key: p.key, values: p.values }))],
    signals: spec.signals.map((s) => ({ kind: s.kind, hard: s.hard, windowDays: s.windowDays, roleTerms: s.roleTerms, roleFamilies: s.roleFamilies })),
    companyBrain: { status: "absent" },
  } } as never);
  assertEquals(smoke.filter((c) => c.status !== "pass").map((c) => c.id), []);
});

Deno.test("Query A — 'US B2B companies hiring Account Executives': B2B is a preference", () => {
  const r = compile("Find US B2B companies hiring Account Executives.", { ...hiring(["Account Executive"]), company_types: ["B2B"] });
  assertEquals(r.hard, ["geography_hq", "signal"]);
  assertEquals(r.prefs, ["business_model:[\"B2B\"]"]);
  assert(r.audience[0].rationale!.includes("ranks and never rejects"));
});

Deno.test("Query B — 'Only include verified B2B companies. Exclude B2C': required and excluded, decided on evidence", () => {
  const q = "Find US companies hiring Account Executives. Only include verified B2B companies. Exclude B2C businesses.";
  // Whether the model files the exclusion in hard_constraints, in company_types, or both.
  for (const proposal of [
    { company_types: ["B2B"], hard_constraints: [US_HARD, { field: "excluded_company_types", operator: "not_in", value: ["B2C"], reason: "excluded" }] },
    { company_types: ["B2B", "B2C"] },
    { company_types: ["B2B", "B2C"], hard_constraints: [US_HARD, { field: "excluded_company_types", operator: "not_in", value: ["B2C"], reason: "excluded" }] },
  ]) {
    const r = compile(q, { ...hiring(["Account Executive"]), ...proposal });
    assertEquals(r.hard, ["business_model", "excluded_company_types", "geography_hq", "signal"], JSON.stringify(proposal));
    assertEquals(r.req.hard.filter((h) => h.key === "excluded_company_types").length, 1, "the exclusion is compiled once");
    assertEquals(r.req.hard.find((h) => h.key === "business_model")!.values, ["B2B"]);
    assert(r.audience.find((c) => c.dimension === "business_model")!.rationale!.includes("missing evidence is never taken as proof"));
  }
  // Missing evidence is unknown — never a pass. Contrary evidence fails.
  assertEquals(matchBusinessModel("B2B", ""), "unknown");
  assertEquals(matchBusinessModel("B2B", "Software Development"), "unknown");
  assertEquals(matchBusinessModel("B2B", "a consumer app for families"), "fail");
  assertEquals(matchBusinessModel("B2B", "B2B payroll platform for businesses"), "pass");
});

Deno.test("Query C — 'Prefer B2B, but include strong B2C': B2B ranks, B2C stays eligible", () => {
  const r = compile("Find US companies hiring Account Executives. Prefer B2B companies, but include strong B2C opportunities.",
    { ...hiring(["Account Executive"]), company_types: ["B2B", "B2C"] });
  assertEquals(r.hard, ["geography_hq", "signal"]);
  assertEquals(r.prefs, ["business_model:[\"B2B\"]"], "B2C is neither required, excluded, nor preferred");
});

Deno.test("Query D — 'Ideally 20–500 employees': size is a preference, US and hiring stay hard", () => {
  const r = compile("Find US companies hiring salespeople. Ideally 20–500 employees.", { ...hiring(["salespeople"]), employee_range: { min: 20, max: 500 } });
  assertEquals(r.hard, ["geography_hq", "signal"]);
  const spec = specFromMission(r.mission as never);
  assertEquals([spec.preferredEmployees, spec.employees], [{ min: 20, max: 500 }, null]);
});

Deno.test("GPT marking B2B HARD does not make it hard: the request's words decide", () => {
  const viaConstraint = compile("Find US B2B companies hiring Account Executives.", {
    ...hiring(["Account Executive"]), company_types: ["B2B"],
    hard_constraints: [US_HARD, { field: "business_model", operator: "in", value: ["B2B"], reason: "the model says hard" }],
  });
  assertEquals(viaConstraint.hard, ["geography_hq", "signal"]);
  assertEquals(viaConstraint.prefs, ["business_model:[\"B2B\"]"]);
  // B2B the request never mentions: the model's own idea, never hard.
  const invented = compile("Find US companies hiring Account Executives.", {
    ...hiring(["Account Executive"]), company_types: ["B2B"],
    hard_constraints: [US_HARD, { field: "business_model", operator: "in", value: ["B2B"], reason: "inferred" }],
  });
  assertEquals(invented.hard, ["geography_hq", "signal"]);
  assertFalse(invented.req.hard.some((h) => h.key === "unmappable"), "an invented constraint never blocks the plan either");
});

Deno.test("unchanged: a real industry the user states stays hard; a Brain business model stays a target", () => {
  const saas = compile("Find US B2B SaaS companies hiring Account Executives.", { ...hiring(["Account Executive"]), company_types: ["B2B SaaS"] });
  assert(saas.hard.includes("industry"), "'B2B SaaS' is not a bare audience: the existing industry rule applies");
  const fintech = compile("Find US fintech companies hiring Account Executives.", { ...hiring(["Account Executive"]), company_types: ["fintech"] });
  assert(fintech.hard.includes("industry"));
  const brain = compileLeadMission({
    originalUserQuery: "Find US companies hiring Account Executives.",
    proposal: { ...BLANK, ...hiring(["Account Executive"]) }, requestedCount: null,
    companyBrain: { business_models: ["B2B"] } as never,
  }).final_mission as { criteria: { kind: string; dimension: string }[] };
  assertFalse(brain.criteria.some((c) => c.kind === "hard" && (c.dimension === "business_model" || c.dimension === "industry")),
    "the Company Brain's business model never becomes a requirement");
});
