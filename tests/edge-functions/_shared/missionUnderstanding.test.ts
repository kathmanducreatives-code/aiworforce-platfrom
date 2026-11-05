// S4 — contract v3: the model states the meaning in a closed vocabulary with quotes;
// code validates and never re-decides. Negative tests prove invalid readings never apply.
import { assert, assertEquals, assertFalse, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  editDistance, parseUnderstanding, spanInRequest, UNDERSTANDING_SCHEMA, validateUnderstanding,
} from "../../../supabase/functions/_shared/missionUnderstanding.ts";
import { compileLeadMission, MissionNeedsClarificationError } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { gptMissionSchemaFor } from "../../../supabase/functions/_shared/gptMissionSchema.ts";
import { activeMissionContract } from "../../../supabase/functions/_shared/missionInterpretationContract.ts";
import { BLANK } from "../../../scripts/dev/interpretation-fuzz.ts";

const U = (o: Record<string, unknown>) => ({
  roles: [], role_match: "any", places: [], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...o,
});
const compile = (query: string, understanding: unknown, contract: "v1" | "v3" = "v3", extra: Record<string, unknown> = {}) =>
  compileLeadMission({
    originalUserQuery: query, requestedCount: 5, contract,
    proposal: { ...BLANK, geographies: [], hard_constraints: [], required_signal_terms: [], ...extra, understanding } as never,
  });
const hard = (m: { criteria?: unknown[] }) => (m.criteria ?? []) as { kind: string; dimension: string; value: unknown; geography_scope?: string }[];

Deno.test("spans: typo-tolerant by edit distance, never a word list", () => {
  assert(spanInRequest("hiring acount executives", "acount executives"), "the user's own typo");
  assert(spanInRequest("hiring acount executives", "account executives"), "the model's correction of it");
  assert(spanInRequest("companies operatng in the US", "operating in the US"));
  assert(spanInRequest("Find companies HQ'd in the US", "HQ'd in the US"));
  assertFalse(spanInRequest("Find 5 US companies hiring AEs", "headquartered in the US"), "words the user never wrote");
  assertFalse(spanInRequest("hiring SDRs", "hiring BDRs"), "short tokens must match exactly (SDR ≠ BDR)");
  assertFalse(spanInRequest("hiring AEs", "hiring AEs in Canada"), "a quote longer than anything said");
  assertEquals(editDistance("acount", "account"), 1);
  assertEquals(editDistance("teh", "the"), 1, "a transposition is one edit");
});

Deno.test("validation: invented quotes, unknown ids and empty roles are refused and recorded", () => {
  const v = validateUnderstanding("Find 5 US companies hiring AEs", parseUnderstanding(U({
    roles: [
      { span: "AEs", title: "account_executive", family: null, relation: "required" },
      { span: "sales engineers", title: null, family: "gtm_sales", relation: "required" }, // never said
      { span: "AEs", title: "chief_wizard", family: null, relation: "required" }, // not a registered id
      { span: "AEs", title: null, family: null, relation: "required" }, // no id at all
    ],
    places: [{ span: "US", place: "atlantis", other_place: null, scope: "headquarters", necessity: "required" }],
  }))!);
  assertEquals(v.roles.length, 1);
  assertEquals(v.places.length, 0);
  assertEquals(v.rejected.map((r) => r.reason).sort(), ["no_role_id", "quote_not_in_request", "unknown_place_id", "unknown_title_id"]);
});

Deno.test("validation: a role both required and excluded is a question for the user, never settled silently", () => {
  const v = validateUnderstanding("hiring AEs, not AEs", parseUnderstanding(U({
    roles: [
      { span: "AEs", title: "account_executive", family: null, relation: "required" },
      { span: "not AEs", title: "account_executive", family: null, relation: "excluded" },
    ],
  }))!);
  assertEquals(v.roles, []);
  assertEquals(v.ambiguities.length, 1);
});

Deno.test("v3 compile: the understanding decides NL1–NL4 — roles by id, indirect necessity, informal places, presence", () => {
  const m = compile("any companies in the states looking to bring on acount execs? need 5", U({
    roles: [{ span: "acount execs", title: "account_executive", family: null, relation: "required" }],
    places: [{ span: "in the states", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    signals: [{ span: "looking to bring on acount execs", kind: "hiring", necessity: "required" }],
  })).final_mission;
  const hiring = hard(m).find((c) => c.dimension === "hiring")!;
  assertEquals(hiring.kind, "hard", "NL2: indirect wording, still required");
  assertEquals((hiring.value as { qualifier: { role_terms: string[] } }).qualifier.role_terms, ["Account Executive"], "NL1: the registered title, not the typo");
  const geo = hard(m).find((c) => c.dimension === "geography")!;
  assertEquals([geo.kind, geo.value, geo.geography_scope], ["hard", "United States", "headquarters"], "NL3: 'the states' is a hard US requirement");
  const office = compile("5 companies that have a US office", U({
    places: [{ span: "have a US office", place: "united states", other_place: null, scope: "presence", necessity: "required" }],
  })).final_mission;
  assertEquals(hard(office).find((c) => c.dimension === "geography")!.geography_scope, "presence", "NL4");
});

Deno.test("v3 compile negative: an invalid item is NOT applied — the v1 reading stands for it", () => {
  const r = compile("Find 5 US companies hiring AEs", U({
    places: [{ span: "headquartered in Canada", place: "canada", other_place: null, scope: "headquarters", necessity: "required" }],
  }), "v3", { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "x" }] });
  assert(!hard(r.final_mission).some((c) => c.dimension === "geography" && c.value === "Canada"), "an invented place never becomes a requirement");
  assert(r.validator_changes.some((c) => c.startsWith("understanding_rejected:")));
});

Deno.test("v3 compile: a genuine ambiguity stops before anything is spent and asks the user", () => {
  const e = assertThrows(() => compile("Find 5 companies hiring reps", U({
    ambiguities: [{ span: "reps", question: "Do you mean sales representatives, or any customer-facing representative?" }],
  })), MissionNeedsClarificationError) as MissionNeedsClarificationError;
  assertEquals(e.questions.length, 1);
  assert(e.userMessage.includes("Nothing has been started or charged"));
});

Deno.test("v3 compile: what the vocabulary cannot express is disclosed, never dropped", () => {
  const m = compile("US companies growing their sales team", U({
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    signals: [{ span: "growing their sales team", kind: "headcount_growth", necessity: "required" }],
    unsupported: [{ span: "sales team", why: "growth of one team is not measured separately" }],
  })).final_mission;
  assert(hard(m).some((c) => c.dimension === "unrepresentable_evidence" && JSON.stringify(c.value).includes("sales team")));
});

Deno.test("contract gating: v1 ignores an understanding (and records it); v3 is off unless chosen", () => {
  const r = compile("Find 5 US companies hiring AEs", U({ roles: [{ span: "AEs", title: "account_executive", family: null, relation: "required" }] }), "v1");
  assert(r.validator_changes.includes("understanding_ignored:contract_v1"));
  assertEquals((r.final_mission as { understanding?: unknown }).understanding, undefined);
  assertEquals(activeMissionContract(() => undefined), "v1");
  assertEquals(activeMissionContract(() => "v3"), "v3");
});

Deno.test("schema: v3 is strict — every key required, closed enums for ids, no free field names", () => {
  const s = gptMissionSchemaFor("v3").schema as { required: string[]; properties: Record<string, unknown> };
  assert(s.required.includes("understanding"));
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const x = o as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
    if (x.type === "object" && x.properties) {
      assertEquals(x.additionalProperties, false);
      assertEquals([...(x.required ?? [])].sort(), Object.keys(x.properties).sort());
    }
    for (const v of Object.values(x.properties ?? {})) walk(v);
    walk(x.items);
  };
  walk(UNDERSTANDING_SCHEMA);
  const role = (UNDERSTANDING_SCHEMA.properties.roles.items.properties.title as { enum: unknown[] }).enum;
  assert(role.includes("account_executive") && role.includes(null));
});

Deno.test("instruction: default readings are settled, never questions (live study 2026-11-05; TEST smoke P0)", async () => {
  const { UNDERSTANDING_INSTRUCTION } = await import("../../../supabase/functions/_shared/missionUnderstanding.ts");
  for (const rule of [
    "a time window the user did not state", "Agentory applies and discloses its default window",
    "a bare 'in the US / in the States / US companies'", "headquarters",
    "a broad role word ('salespeople'", "X is an excluded role",
    "'growing the team / getting bigger / expanding headcount' — headcount_growth, not hiring",
    "'hiring / recruiting / taking on staff / needing <role>' — hiring",
  ]) assert(UNDERSTANDING_INSTRUCTION.includes(rule), rule);
  // Genuine ambiguity is still asked, after the settled readings.
  assert(UNDERSTANDING_INSTRUCTION.indexOf("still cannot be settled") > UNDERSTANDING_INSTRUCTION.indexOf("settled readings"));
});
