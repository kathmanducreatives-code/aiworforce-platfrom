// RC01 — A NEGATED REQUIREMENT IS ASKED ABOUT, NEVER COMPILED AS ITS OPPOSITE
// (quality run 2026-10-06, Fix Wave 1 step 6).
//
// "outside the United States" compiled to a hard US requirement, "not currently
// hiring sales" to a hard hiring requirement. An exclusion cannot be checked yet,
// so the request is refused at compile time with a question. These tests pin
// what is detected, what must NOT be (emphasis, size bounds), and that the
// compile path refuses with the question instead of a card.
//
// Pure. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { negatedRequirements, negationQuestion } from "../../../supabase/functions/_shared/requestNegation.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { REQUEST_V1_VERSION, type RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

const kinds = (utterance: string) => negatedRequirements({ utterance, parts: [] }).map((n) => n.kind);
const request = (utterance: string, filters: RequestV1["parts"][number]["subject"]["filters"] = []): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance, objective: "source",
  parts: [{ id: "p1", objective: "source", subject: { entity: "company", references: [], filters },
    requirements: [], output: { shape: "records", count: null } }],
  ambiguity: [], authority: { may_spend: true, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
} as RequestV1);

Deno.test("RC01: every negation in the quality catalogue is detected", () => {
  assertEquals(kinds("Find companies outside the United States."), ["geography"]);
  assertEquals(kinds("Find companies serving the US but headquartered outside the US."), ["geography"]);
  assertEquals(kinds("Find AI companies that are NOT hiring sales."), ["hiring"]);
  assertEquals(kinds("Find recently funded AI startups that are not currently hiring sales."), ["hiring"]);
  assertEquals(kinds("Find US companies with 11–50 employees that have no open sales roles."), ["hiring"]);
  assertEquals(kinds("Find companies hiring sales roles but not engineering roles."), ["hiring"]);
  assertEquals(kinds("Find AI companies that have NOT raised venture funding."), ["funding"]);
  assertEquals(kinds("Find companies that received grants but have not raised venture funding."), ["funding"]);
  assertEquals(kinds("Find SaaS companies that haven't raised funding."), ["funding"]);
  assertEquals(kinds("Find fintech companies that aren't hiring."), ["hiring"]);
  assertEquals(negatedRequirements({ utterance: "Find companies outside the United States.", parts: [] })[0].phrase,
    "outside the United States", "no trailing punctuation in the quoted phrase");
});

Deno.test("RC01: emphasis, bounds and ordinary requests are NOT negations", () => {
  for (const q of [
    "Find companies that are not only hiring sales but also growing.",
    "Find companies that are not just hiring engineers.",
    "Find companies with no more than 50 employees.",
    "Find companies with fewer than 50 employees.",
    "Find non-profit organisations in the US.",
    "Find 5 US AI companies with 11–50 employees that raised funding in the last 2 years and are hiring sales.",
    "Check whether LlamaIndex currently has an open sales role.",
    "Find companies in New York or California.",
  ]) assertEquals(kinds(q), [], q);
});

Deno.test("RC01: a negated FILTER is caught from the request's structure, whatever the words", () => {
  const n = negatedRequirements(request("Find SaaS companies.", [{ field: "industry", op: "not", value: "fintech" }]));
  assertEquals(n.map((x) => [x.kind, x.phrase]), [["filter", "not fintech"]]);
});

Deno.test("RC01: the compile path refuses with the question — no card, no spend", () => {
  const r = request("Find companies outside the United States.", [{ field: "geography", op: "not", value: "United States" }]);
  const out = compileRequestMission(r, projectToLeadMission(r), { originalUserQuery: r.utterance });
  assert(!out.ok, "a negated request never compiles into a mission");
  if (out.ok) return;
  assertEquals(out.reason, "negated_requirement:geography");
  assert(out.message.includes("outside the United States"), out.message);
  assert(/can't exclude one yet/.test(out.message), out.message);
  assertEquals(negationQuestion([{ kind: "hiring", phrase: "not hiring" }]).includes("open role"), true);
});
