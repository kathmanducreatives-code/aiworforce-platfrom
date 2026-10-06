// RC07 — A COMPANY BRAIN LOCATION IS A PREFERENCE, NEVER A STATED REQUIREMENT
// (quality run 2026-10-06, Fix Wave 2 step 3).
//
// The compiler stamped every location `hard_constraints["company_profile.locations"]`
// "stated explicitly in the user's query" — including the Brain's ICP filling a
// field the user left open — so the evaluator and the identity search treated
// it as hard. These tests pin both sides: the request's own location stays hard,
// a Brain-only location does not. Real chain: projection → compiler → criteria.
// Pure.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { missionGeographyIsHard } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { REQUEST_V1_VERSION, type RequestFilter, type RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

const BRAIN = { industries: ["b2b saas"], stages: ["seed"], locations: ["united states"] };

function compile(utterance: string, filters: RequestFilter[]) {
  const r = {
    version: REQUEST_V1_VERSION, utterance, objective: "source",
    parts: [{ id: "p1", objective: "source", subject: { entity: "company", references: [], filters },
      requirements: [], output: { shape: "records", count: 10 } }],
    ambiguity: [], authority: { may_spend: true, max_cost_units: null, requires_confirmation: true },
    provenance: {}, confidence: 0.9,
  } as RequestV1;
  const proj = projectToLeadMission(r);
  return compileLeadMission({ originalUserQuery: utterance, proposal: proj.proposal as never, companyBrain: BRAIN,
    requestedCount: proj.requestedCount }).final_mission;
}
const hardLocation = (m: ReturnType<typeof compile>) =>
  (m.hard_constraints as Record<string, unknown>)["company_profile.locations"];

Deno.test("RC07: a Brain-only location is never stamped as a hard constraint the user stated", () => {
  const m = compile("Find 10 AI infrastructure companies.", [{ field: "industry", op: "eq", value: "AI infrastructure" }]);
  assertEquals(m.field_provenance?.["company_profile.locations"], "company_brain");
  assertEquals(m.company_profile.locations, ["united states"], "the Brain's location is still carried");
  assertEquals(hardLocation(m), undefined);
  assertEquals(missionGeographyIsHard(m), false, "identity search is not filtered by a preference");
  const geo = deriveMissionCriteria(m).filter((c) => c.dimension === "geography");
  assertEquals(geo.map((c) => [c.kind, c.source]), [["target", "company_brain_preference"]]);
});

Deno.test("RC07: the request's own location stays HARD, stated, and filters identity search", () => {
  const m = compile("Find 10 AI companies in the United States.", [
    { field: "industry", op: "eq", value: "AI" }, { field: "geography", op: "eq", value: "United States" },
  ]);
  assert(m.field_provenance?.["company_profile.locations"] !== "company_brain");
  const loc = hardLocation(m) as { value: string[]; reason: string };
  assertEquals(loc.value, ["United States"]);
  assertEquals(loc.reason, "stated explicitly in the user's query");
  assertEquals(missionGeographyIsHard(m), true);
  const geo = deriveMissionCriteria(m).filter((c) => c.dimension === "geography");
  assertEquals(geo.map((c) => [c.kind, c.source]), [["hard", "user_explicit"]]);
});
