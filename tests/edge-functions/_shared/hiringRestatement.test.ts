// A hard constraint that only RESTATES the hiring signal is the signal, not a second requirement.
//
// TEST plan 6999eff6 ("Find 5 US B2B companies actively hiring salespeople …"): the model
// added `hiring_activity: "actively hiring salespeople"` beside the hiring signal that
// already carries "salespeople" (gtm_sales). It compiled to a hard `constraint` no
// evidence answers ("unmappable"), so every company would have stayed needs_verification.
// restatesHiringSignal now reads the restatement by meaning; a genuinely different
// requirement (another role, a specific other title, a count, an exclusion) is kept.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { normaliseFieldName, restatesEmployeeBound, restatesHiringSignal } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { requirementsFromMission } from "../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";

const SALES = [{ type: "hiring", event: "hiring", qualifier: { role_terms: ["salespeople"], role_families: ["gtm_sales"] } }] as never;
const AE = [{ type: "hiring", event: "hiring", qualifier: { role_terms: ["account executives"], role_families: ["gtm_sales"] } }] as never;

Deno.test("the TEST plan's restatement, under any operator the model uses, is the signal itself", () => {
  for (const operator of ["equals", "is_true", "required", "currently_hiring", "contains", "", "is", "must_be"]) {
    assert(restatesHiringSignal("hiring_activity", { operator, value: "actively hiring salespeople" }, SALES), operator);
  }
  // Other spellings of the same statement.
  assert(restatesHiringSignal("hiring_status", { operator: "equals", value: "actively hiring" }, SALES));
  assert(restatesHiringSignal("is_hiring", { operator: "equals", value: true }, SALES));
  assert(restatesHiringSignal("job_postings", { operator: "contains", value: "sales roles" }, SALES));
  assert(restatesHiringSignal("actively_hiring", { operator: "in", value: ["salespeople"] }, SALES));
  assert(restatesHiringSignal("hiring_activity", { operator: "equals", value: "currently hiring Account Executives" }, AE));
});

Deno.test("a genuinely different hiring requirement is kept", () => {
  // A specific other title is a different role, even in the same family.
  assert(!restatesHiringSignal("hiring_activity", { operator: "equals", value: "hiring SDRs" }, AE));
  assert(!restatesHiringSignal("hiring", { operator: "currently_hiring", value: "SDRs" }, AE));
  // Another family.
  assert(!restatesHiringSignal("hiring_activity", { operator: "equals", value: "also hiring engineers" }, SALES));
  // A count, threshold or window: a requirement of its own.
  assert(!restatesHiringSignal("open_roles", { operator: "gte", value: 5 }, SALES));
  assert(!restatesHiringSignal("hiring_activity", { operator: "equals", value: "at least 5 open sales roles" }, SALES));
  assert(!restatesHiringSignal("hiring", { operator: "greater_than", value: "salespeople" }, SALES));
  // An exclusion.
  assert(!restatesHiringSignal("hiring_activity", { operator: "not_equals", value: "salespeople" }, SALES));
  for (const operator of ["except", "other_than", "unless", "neq", "ne", "outside"]) {
    assert(!restatesHiringSignal("hiring_role", { operator, value: "salespeople" }, SALES), operator);
  }
  // A field that does not name hiring.
  assert(!restatesHiringSignal("sales_headcount", { operator: "equals", value: "salespeople" }, SALES));
  assert(!restatesHiringSignal("company_activity", { operator: "equals", value: "actively hiring salespeople" }, SALES));
  // No hiring signal, or two: nothing is assumed.
  assert(!restatesHiringSignal("hiring_activity", { operator: "equals", value: "actively hiring salespeople" }, [] as never));
  assert(!restatesHiringSignal("hiring_activity", { operator: "equals", value: "actively hiring salespeople" },
    [...(SALES as unknown[]), ...(AE as unknown[])] as never));
});

const BLANK = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: null, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: null, strategies: [],
};
const TEST_QUERY = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range and explain why.";
const US_HARD = { field: "geography", operator: "in", value: ["United States"], reason: "US" };
const compile = (hardConstraints: unknown[]) => {
  const m = compileLeadMission({
    originalUserQuery: TEST_QUERY, requestedCount: 5,
    proposal: {
      ...BLANK, geographies: ["United States"], company_types: ["B2B"], employee_range: { min: 20, max: 500 }, requested_opportunity_count: 5,
      preferred_signals: ["hiring"], signal_recency_days: 30, strategies: ["hiring"], output_intent: "companies", required_signal_terms: ["salespeople"],
      hard_constraints: [US_HARD, ...hardConstraints],
    },
  }).final_mission;
  return { m, req: requirementsFromMission(m as never), spec: specFromMission(m as never, { defaultCount: 5 }) };
};

Deno.test("the TEST query with the model's restatement compiles to exactly US HQ + hiring", () => {
  const { req, spec } = compile([{ field: "hiring_activity", operator: "equals", value: "actively hiring salespeople", reason: "active hiring" }]);
  assertEquals(req.hard.map((h) => h.key).sort(), ["geography_hq", "signal"], "no unmappable constraint");
  assertEquals(spec.otherHard, [], "nothing left for the planner to disclose as unverifiable");
  assertEquals(spec.signals[0].roleFamilies, ["gtm_sales"]);
  assertEquals(spec.preferredEmployees, { min: 20, max: 500 });
});

Deno.test("a distinct stated requirement beside it still compiles as its own hard requirement", () => {
  const { req } = compile([{ field: "open_roles", operator: "gte", value: 5, reason: "the model invented a count" }]);
  // Not in the request's words: a target, never hard — and never silently dropped as a restatement.
  assertEquals(req.hard.map((h) => h.key).sort(), ["geography_hq", "signal"]);
  const stated = compileLeadMission({
    originalUserQuery: "Find US companies actively hiring salespeople with at least 5 open roles.", requestedCount: 5,
    proposal: { ...BLANK, geographies: ["United States"], preferred_signals: ["hiring"], strategies: ["hiring"], output_intent: "companies",
      required_signal_terms: ["salespeople"], hard_constraints: [US_HARD, { field: "open_roles", operator: "gte", value: "5", reason: "stated" }] },
  }).final_mission;
  const kept = ((stated as { criteria?: { dimension: string; value?: { field?: string } }[] }).criteria ?? [])
    .filter((c) => c.dimension === "constraint" && c.value?.field === "open_roles");
  assertEquals(kept.length, 1, "a count is never swallowed as a restatement of the signal");
});

// TEST plan run 41466774814: the model wrote the restatement's FIELD as "hiring.role"
// ("hiring role: Account Executives"); only "hiring_role" was recognised, so it compiled
// to an unmappable hard requirement and the plan-only workflow refused the plan.
Deno.test("the field name is read in any spelling: hiring.role, hiring role, hiringRole", () => {
  for (const f of ["hiring_role", "hiring.role", "hiring role", "hiring-role", "hiringRole", "HiringRole", " Hiring.Role "]) {
    assertEquals(normaliseFieldName(f), "hiring_role", f);
    assert(restatesHiringSignal(f, { operator: "equals", value: "Account Executives" }, AE), f);
  }
  assertEquals(normaliseFieldName("employeeMax"), "employee_max");
  assert(restatesEmployeeBound("employee.max", { operator: "lte", value: 500 }, { min: 20, max: 500 }), "the size restatement too");
  // A normalised name never turns a different requirement into a restatement.
  assert(!restatesHiringSignal("hiring.role", { operator: "except", value: "Account Executives" }, AE));
  assert(!restatesHiringSignal("hiring.role", { operator: "equals", value: "SDRs" }, AE));
  assert(!restatesHiringSignal("sales.headcount", { operator: "equals", value: "Account Executives" }, AE));
});

Deno.test("the owner's paid-run query with the model's hiring.role restatement compiles to exactly US HQ + hiring", () => {
  const q = "Find 3 US companies actively hiring Account Executives. Prefer B2B companies with 20–500 employees, but include strong opportunities outside that range.";
  const m = compileLeadMission({
    originalUserQuery: q, requestedCount: 3,
    proposal: {
      ...BLANK, geographies: ["United States"], company_types: ["B2B"], employee_range: { min: 20, max: 500 }, requested_opportunity_count: 3,
      preferred_signals: ["hiring"], signal_recency_days: 30, strategies: ["hiring"], output_intent: "companies", required_signal_terms: ["Account Executives"],
      hard_constraints: [US_HARD, { field: "hiring.role", operator: "equals", value: "Account Executives", reason: "the role" }],
    },
  }).final_mission;
  assertEquals(requirementsFromMission(m as never).hard.map((h) => h.key).sort(), ["geography_hq", "signal"]);
});
