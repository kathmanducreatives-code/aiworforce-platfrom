// A PERMISSION RESTRICTS NOTHING (TEST smoke 2026-11-08). After MRLE Phase 0 made a REQUIRED
// "Not checked" item block approval, the smoke request
//   "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but
//    include strong opportunities outside that range."
// was refused on both live runs: the model filed the widening clause as unsupported, and it
// became a REQUIRED requirement. It is disclosed as a preference instead; anything that
// restricts or excludes still blocks.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal, PERMISSION_POLICY } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { approvability } from "../../../supabase/functions/_shared/missionContract/contract.ts";

const SMOKE = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range.";
const read = (query: string, unsupported: { span: string; why: string }[]) => contractFromProposal(query, {
  understanding: {
    roles: [{ span: "salespeople", title: null, family: "sales", relation: "required" }], role_match: "any",
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    industries: [{ span: "B2B", industry: "B2B", necessity: "required" }],
    signals: [{ span: "actively hiring salespeople", kind: "hiring", necessity: "required" }],
    signal_logic: "all", ambiguities: [], unsupported,
  },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] },
  company_size: { span: "Prefer 20–500 employees", min: 20, max: 500, necessity: "preferred" }, funding_stages: [], forbid_broadening: [],
} as never).contract;
const unsupportedOf = (c: ReturnType<typeof read>) => c.requirements.filter((r) => r.dimension === "unsupported");

Deno.test("the live smoke request: the widening clause is a disclosed preference, and the contract is approvable", () => {
  // Both quotes the model returned on TEST (14:49 and 15:03 runs).
  for (const span of ["strong opportunities outside that range", "strong opportunities", "include strong opportunities outside that range"]) {
    const c = read(SMOKE, [{ span, why: "no criterion for an exception to a preference" }]);
    const [u] = unsupportedOf(c);
    assertEquals([u.necessity, u.origin.policy], ["preferred", PERMISSION_POLICY], span);
    assertEquals(approvability(c), { ok: true }, span);
    assert(c.assumptions.some((a) => a.policy === PERMISSION_POLICY), "recorded as an assumption the user sees");
  }
});

Deno.test("anything that restricts or excludes still blocks approval (no weakening)", () => {
  const cases: [string, string][] = [
    ["Find 5 US B2B companies actively hiring salespeople with a SOC 2 report.", "with a SOC 2 report"],
    ["Find 5 US B2B companies actively hiring salespeople, not owned by private equity.", "not owned by private equity"],
    ["Find 5 US B2B companies actively hiring salespeople; they must include a public pricing page.", "include a public pricing page"],
    ["Find 5 US B2B companies actively hiring salespeople. Include only companies with a public API.", "companies with a public API"],
  ];
  for (const [q, span] of cases) {
    const c = read(q, [{ span, why: "x" }]);
    assertEquals(unsupportedOf(c)[0].necessity, "required", q);
    assertEquals(approvability(c).ok, false, q);
  }
});
