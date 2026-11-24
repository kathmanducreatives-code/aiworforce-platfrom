// A REQUEST CAN SAY "B2B" TWICE (live TEST plan 2026-11-09, first real ATLAS pilot):
//   "Find up to 5 active B2B companies … Companies must be B2B. …"
// The model quoted the first, descriptive mention, so B2B was downgraded to a preference
// and the coverage guard (rightly) stopped the plan for clarification. The user's own strong
// words are in the request, so B2B stays REQUIRED. Without them it is still a preference
// (owner rule, corpus M01: "US B2B companies" ranks by B2B).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";

const read = (query: string, span: string) => contractFromProposal(query, {
  understanding: {
    roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }], role_match: "any",
    places: [{ span: "United States", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    industries: [{ span, industry: "B2B", necessity: "required" }],
    signals: [{ span: "actively hiring Account Executives", kind: "hiring", necessity: "required" }],
    signal_logic: "all", ambiguities: [], unsupported: [],
  },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] },
  company_size: null, funding_stages: [], forbid_broadening: [],
} as never);
const b2b = (r: ReturnType<typeof read>) => r.contract.requirements.find((x) => x.id.startsWith("business_model:"))?.necessity;

const PILOT = "Find up to 5 active B2B companies headquartered in the United States that are actively hiring Account Executives. Companies must be B2B.";

Deno.test("B2B said twice: the first, descriptive quote stays REQUIRED because the user also says 'must be B2B'", () => {
  const r = read(PILOT, "active B2B companies");
  assertEquals(b2b(r), "required");
  assertEquals(r.contract.ambiguities, [], "no clarification: the contract already says what the user said");
});

Deno.test("B2B said once, descriptively, is still a preference (owner rule M01)", () => {
  assertEquals(b2b(read("Find 5 active B2B companies in the United States actively hiring Account Executives.", "active B2B companies")), "preferred");
});

Deno.test("permission words do not require it ('B2B preferred')", () => {
  assertEquals(b2b(read("Find 5 B2B companies in the United States actively hiring Account Executives; B2B preferred but not required.", "B2B companies")), "preferred");
});
