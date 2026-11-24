// NOTHING CHECKABLE IS A QUESTION, NEVER A CRASH (ATLAS inventory 2026-11-20).
// "Find companies using HubSpot." reads as one disclosed requirement the vocabulary cannot
// express. Compiling it froze an empty criteria list (freezeCriteria threw a plain Error) and
// lead-pipeline answered HTTP 500. Now the interpreter asks, and the validator refuses with a
// typed error, so the request can never reach the compiler as a valid mission.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract, ContractInvalidError } from "../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractProblems } from "../../../supabase/functions/_shared/missionContract/contract.ts";

const read = (query: string, understanding: Record<string, unknown>) => contractFromProposal(query, {
  understanding: { roles: [], role_match: "any", places: [], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...understanding },
  signal_windows: [], deliverable: { entity: "company", count: null, count_span: null, person_roles: [] },
  company_size: null, funding_stages: [], forbid_broadening: [],
} as never).contract;

Deno.test("an unsupported-only request asks what qualifies a result, naming what it cannot check", () => {
  const c = read("Find companies using HubSpot.", { unsupported: [{ span: "using HubSpot", why: "technology adoption is not a mission dimension" }] });
  assertEquals(c.ambiguities.length, 1);
  assert(c.ambiguities[0].question.includes('"using HubSpot"'), c.ambiguities[0].question);
});

Deno.test("…and such a contract is refused as invalid (typed), never frozen empty", async () => {
  const c = read("Find companies using HubSpot.", { unsupported: [{ span: "using HubSpot", why: "technology adoption" }] });
  assert(contractProblems(c).some((p) => p.code === "empty_mission"));
  await assertRejects(() => compileContract(c), ContractInvalidError, "no requirement can be checked");
});

Deno.test("a request with one checkable requirement beside a disclosed one is unchanged (no extra question)", () => {
  const c = read("Find US companies using HubSpot.", {
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    unsupported: [{ span: "using HubSpot", why: "technology adoption" }],
  });
  assertEquals(c.ambiguities.filter((a) => a.question.includes("What else should a company match")), []);
  assertEquals(contractProblems(c).filter((p) => p.code === "empty_mission"), []);
});

Deno.test("an existing clarification is not duplicated by the nothing-checkable question", () => {
  const c = read("Find potential channel partners.", { ambiguities: [{ span: "channel partners", question: "What kind of partner?" }] });
  assertEquals(c.ambiguities.map((a) => a.question), ["What kind of partner?"]);
});
