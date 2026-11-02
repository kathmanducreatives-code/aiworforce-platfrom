// Stage 4 (Option E): the closed requirement vocabulary, in SHADOW.
//
// requirementVocabulary.ts is not on any request path yet. These tests pin (1) how it
// classifies fields, (2) the offline shadow report of what renaming every stored
// constraint to its canonical field would change in meaning
// (scripts/dev/contract-shadow.ts), and (3) the blocker the shadow found for activation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyConstraint, classifyConstraints } from "../../../supabase/functions/_shared/requirementVocabulary.ts";
import { SHADOW_REPORT_PATH, shadowReport, summarise } from "../../../scripts/dev/contract-shadow.ts";

const recorded = JSON.parse(Deno.readTextFileSync(new URL(`../../../${SHADOW_REPORT_PATH}`, import.meta.url)));

Deno.test("the shadow report is what was recorded (re-record with contract-shadow.ts --write and explain)", async () => {
  assertEquals(await shadowReport(), recorded);
});

Deno.test("every stored constraint is classified; none is unknown or silently dropped", () => {
  const s = summarise(recorded);
  assert(s.constraints >= 80, `constraints seen: ${s.constraints}`);
  assertEquals(s.canonical + s.otherQuoted + s.otherUnquoted, s.constraints, "every constraint has a class");
  assertEquals(s.otherUnquoted, 0, "no stored constraint is the model's unquoted invention");
});

Deno.test("spellings of one field are one type; a count is never a role", () => {
  for (const f of ["hiring_role", "hiring.role", "hiringRole", "HIRING_ROLE", "hiring role", "hiring_activity", "open_roles"]) {
    assertEquals(classifyConstraint(f, "Account Executives", "q"), { kind: "canonical", field: "hiring_role", originalField: f }, f);
  }
  assertEquals(classifyConstraint("open_roles", 5, "q"), { kind: "canonical", field: "hiring_count", originalField: "open_roles" });
  assertEquals(classifyConstraint("open_roles", "5", "q").kind === "canonical" && classifyConstraint("open_roles", "5", "q"), { kind: "canonical", field: "hiring_count", originalField: "open_roles" });
  assertEquals(classifyConstraint("company_profile.locations", ["United States"], "q").kind === "canonical" ? "geography" : "?", "geography");
  assertEquals(classifyConstraint("industry_or_company_type", "fintech", "q"), { kind: "canonical", field: "industry", originalField: "industry_or_company_type" });
});

Deno.test("an unknown field is `other`, quoted only when the request itself says it", () => {
  const q = "Find US companies hiring Account Executives that sell to hospitals.";
  assertEquals(classifyConstraint("sells_to", "hospitals", q), { kind: "other", originalField: "sells_to", quoted: true, phrase: "hospitals" });
  assertEquals(classifyConstraint("sells_to", "banks", q), { kind: "other", originalField: "sells_to", quoted: false, phrase: "" });
  // Both proposal (array) and mission (record) shapes.
  assertEquals(classifyConstraints([{ field: "hiring.role", value: "AEs" }], q)[0].kind, "canonical");
  assertEquals(classifyConstraints({ "hiring.role": { operator: "eq", value: "AEs" } }, q)[0].kind, "canonical");
});

Deno.test("ACTIVATION BLOCKER (Stage 6): a canonical `industry` constraint is skipped by the compiler", () => {
  // missionHiringSalesRoles: renaming `industry_or_company_type` to `industry` drops a
  // preference, because deriveMissionCriteria reads industries from company_profile and
  // skips an `industry` hard constraint. The strict contract must not activate until the
  // compiler routes canonical industry constraints; this test then changes deliberately.
  const e = recorded.entries["persisted:tests/edge-functions/_shared/fixtures/missionHiringSalesRoles.json#$"];
  assert(e.diff.some((d: string) => d.startsWith("removed target constraint:_field_industry_or_company_type")), JSON.stringify(e.diff));
  assertEquals(summarise(recorded).missionsWithSemanticChange, 1, "the only mission whose meaning the vocabulary would change");
});
