// A RESTATED size or location is covered by the criterion that carries it —
// whatever status the shared compiler gives the restatement — and a DIFFERENT
// bound is a requirement of its own that no filter expresses (fail closed).
//
// Root cause of PR #198's 46 CI failures on the merge with launch/hardening:
// the shared compiler now compiles a stated hard `constraint` (e.g. the
// model's `employee_max lte 100` beside `employee_range.max = 100`) as
// `unprovable_today`; the status was checked before the "the range already
// carries it" rule, so the restatement became `unmappable` and blocked every
// plan. The old rule also dropped ANY employee bound, equal or not.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";

const size = (max: number | null, min: number | null = null) =>
  ({ id: "company_size", kind: "hard", dimension: "company_size", value: { min, max }, status: "ok" });
const geo = { id: "geography:united_states", kind: "hard", dimension: "geography", value: "United States", status: "ok", geography_scope: "headquarters" as const };
const constraint = (field: string, value: unknown, status = "unprovable_today") =>
  ({ id: `constraint:${field}`, kind: "hard", dimension: "constraint", value: { field, value }, status });
const keys = (criteria: unknown[]) => requirementsFromMission({ criteria: criteria as never }).hard.map((h) => h.key).sort();

for (const status of ["ok", "unprovable_today"]) {
  Deno.test(`a restatement of the size bound is covered by the range (constraint status ${status})`, () => {
    assertEquals(keys([size(100), geo, constraint("employee_max", 100, status)]), ["employee_range", "geography_hq"]);
    assertEquals(keys([size(null, 11), constraint("employee_min", 11, status)]), ["employee_range"]);
  });
  Deno.test(`a restated location is covered by the geography criterion (status ${status})`, () => {
    assertEquals(keys([geo, constraint("geography", ["United States"], status)]), ["geography_hq"]);
  });
}

Deno.test("a DIFFERENT bound is its own requirement: unmappable, never silently dropped", () => {
  assert(keys([size(100), constraint("employee_max", 50, "ok")]).includes("unmappable"), "at most 50 is stricter than the range");
  assert(keys([size(100), constraint("employee_min", 10, "ok")]).includes("unmappable"), "a min the range does not carry");
});

Deno.test("a location constraint with no geography criterion is not covered by anything", () => {
  assert(keys([constraint("geography", ["United States"], "ok")]).includes("unmappable"));
});

Deno.test("any other stated hard constraint still fails closed", () => {
  assert(keys([size(100), constraint("sales_headcount", "11 SDRs")]).includes("unmappable"));
});
