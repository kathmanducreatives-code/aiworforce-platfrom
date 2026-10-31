// "Under 100 employees" arrives twice: as `employee_range.max = 100` and as the
// model's `employee_max lte 100`. The second used to compile to a hard
// `constraint` no evidence dimension answers (`unprovable_today`), so every
// candidate of the mission was held. Found by PR #198's provider tests, which
// failed on the merge with this engine for exactly this row.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria, restatesEmployeeBound } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";

const QUERY = "Find 5 US manufacturers under 100 employees and their founder or CEO. Do not broaden.";
const compile = (bound: number) => compileLeadMission({
  originalUserQuery: QUERY, requestedCount: 5,
  proposal: {
    requested_opportunity_count: 5, requested_contact_ready_count: null, company_types: ["manufacturing"], geographies: ["United States"],
    employee_range: { min: null, max: 100 }, decision_maker_roles: ["Founder", "CEO"],
    hard_constraints: [{ field: "employee_max", operator: "lte", value: bound, reason: "size" }],
    soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: ["geography", "employee_range"], required_evidence: [], required_capabilities: [],
    preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [],
  } as never,
}).final_mission;

Deno.test("an EQUAL restated size bound compiles to no second requirement; the size criterion carries it", () => {
  const hard = deriveMissionCriteria(compile(100) as never, PRODUCTION_READINESS).filter((c) => c.kind === "hard");
  assert(!hard.some((c) => c.dimension === "constraint"), JSON.stringify(hard.map((c) => c.id)));
  assertEquals(hard.find((c) => c.dimension === "company_size")?.value, { min: null, max: 100 });
});

Deno.test("restatesEmployeeBound: only the same bound, a size field and a bound operator", () => {
  const r = { min: 11, max: 100 };
  assert(restatesEmployeeBound("employee_max", { operator: "lte", value: 100 }, r));
  assert(restatesEmployeeBound("employee_min", { operator: ">=", value: "11" }, r));
  assert(!restatesEmployeeBound("employee_max", { operator: "lte", value: 50 }, r), "a stricter bound is its own requirement");
  assert(!restatesEmployeeBound("employee_max", { operator: "gte", value: 100 }, r), "the opposite direction is not a restatement");
  assert(!restatesEmployeeBound("employee_max", { operator: "lt", value: 100 }, r), "strictly-less is not the range's inclusive bound");
  assert(!restatesEmployeeBound("sales_headcount", { operator: "lte", value: 100 }, r));
  assert(!restatesEmployeeBound("employee_max", { operator: "lte", value: 100 }, null), "no range, nothing to restate");
});
