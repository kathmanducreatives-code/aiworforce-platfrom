// A SCHEMA-VALID INPUT CAN STILL ASK THE WRONG QUESTION.
//
// ── THE RUN THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// Run df00b2cd, 2026-08-20. Mission: "Find 10 qualified AI startups in the US
// currently hiring." The planner sent memo23:
//
//     {"mode":"companies","regions":["United States of America"],
//      "isHiring":true,"scrapeOpenJobs":true,
//      "industries":["B2B","Engineering, Product and Design"],"maxItems":100}
//
// Every field legal, every type correct, the actor SUCCEEDED, 100 rows
// returned — and not one row was an AI startup. The top of the dataset was
// Amplitude (750 staff), Algolia (810), Checkr (800), Deel (5,000),
// Flexport (3,000), against a workspace ceiling of 150.
//
// TWO THINGS THE CONTRACT COULD NOT SAY, and both are why:
//
//   1. `industries` is a CLOSED 11-VALUE TAXONOMY WITH NO TECHNOLOGY AXIS.
//      "AI" is not in it and cannot be. The planner reached for B2B as the
//      nearest thing. The field that CAN express a technology is `queries`, a
//      free-text Algolia search, and it was sent empty.
//   2. `maxEmployeeSize` DEFAULTS TO NO CEILING, so the unfiltered directory
//      leads with YC's largest graduates.
//
// The contract listed all three fields — name, type, default — and said
// nothing about what any of them is FOR. A type stops a malformed input; only
// prose stops a well-formed irrelevant one.
//
// AND THE EXAMPLE WAS THE OTHER HALF. It read
// `{mode, regions, isHiring, scrapeOpenJobs, maxItems}` and the planner
// reproduced it exactly, omissions included. The planner imitates the example,
// so an example that omits the fields deciding relevance teaches the omission.
//
// ZERO network, ZERO model calls. These read the contract.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACTOR_INPUT_CONTRACTS,
} from "../../../supabase/functions/_shared/actorInputContracts.ts";

const MEMO23 = "apify_yc_companies_memo23";
const SOLIDCODE = "apify_yc_companies_solidcode";

const field = (actor: string, name: string) => {
  const f = ACTOR_INPUT_CONTRACTS[actor]?.fields.find((x) => x.name === name);
  assert(f, `${actor} declares a ${name} field`);
  return f;
};

// ════════════════════════════════════ 1-4. the fields that decide relevance ══

Deno.test("1. THE REGRESSION: `industries` says it cannot express a technology", () => {
  const f = field(MEMO23, "industries");
  assert(f.note, "the field carries prose, not just a type");
  const note = f.note!.toLowerCase();
  assert(note.includes("no technology axis") || note.includes("technology"),
    "it must state that a technology cannot be said here");
  assert(/\bai\b/.test(note), "AI is the case that broke, and it is named");
  assert(note.includes("queries"), "and it points at the field that CAN say it");
});

Deno.test("2. `queries` is described as the free-text topic field", () => {
  const f = field(MEMO23, "queries");
  assert(f.note, "queries carries prose");
  const note = f.note!.toLowerCase();
  assert(note.includes("free-text") || note.includes("free text"));
  assert(note.includes("technology"),
    "the planner must be able to tell that a technology belongs here");
});

Deno.test("3. `maxEmployeeSize` warns that its default is no ceiling", () => {
  const f = field(MEMO23, "maxEmployeeSize");
  assertEquals(f.default, "1000+", "the live default is unchanged");
  assert(f.note, "maxEmployeeSize carries prose");
  const note = f.note!.toLowerCase();
  assert(note.includes("no ceiling") || note.includes("defaults to no"),
    "the danger is the DEFAULT, not the type");
  assert(note.includes("250"),
    "and the 150-means-250 rounding rule is stated, since 150 is not a legal value");
});

Deno.test("4. the enums are still exactly the live schema's", () => {
  // The prose must never drift from what the actor actually accepts.
  assertEquals(field(MEMO23, "maxEmployeeSize").enum,
    ["1+", "5", "10", "25", "50", "100", "250", "500", "1000+"]);
  assertEquals(field(MEMO23, "minEmployeeSize").enum,
    ["1+", "5+", "10+", "25+", "50+", "100+", "250+", "500+", "1000+"]);
  // solidcode's enums were previously absent entirely — read live 2026-08-20.
  assertEquals(field(SOLIDCODE, "status").enum, ["Active", "Public", "Acquired", "Inactive"]);
  assertEquals(field(SOLIDCODE, "teamSize").enum,
    ["1", "2-10", "11-50", "51-200", "201-500", "500+"]);
  assertEquals(field(SOLIDCODE, "industries").enum,
    ["B2B", "Consumer", "Education", "Fintech", "Government", "Healthcare",
      "Industrials", "Real Estate and Construction"]);
});

// ═══════════════════════════════════════════ 5-7. the example is imitated ══

Deno.test("5. THE OTHER REGRESSION: memo23's example asks a complete question", () => {
  const ex = ACTOR_INPUT_CONTRACTS[MEMO23].example;
  // The exact shape run df00b2cd copied, and what was missing from it.
  assert(Array.isArray(ex.queries) && (ex.queries as unknown[]).length > 0,
    "the topic is present — its absence is what returned 100 irrelevant rows");
  assert(typeof ex.maxEmployeeSize === "string",
    "a ceiling is present — its absence is what returned Deel at 5,000 staff");
  assert(typeof ex.minEmployeeSize === "string",
    "and a floor, which removes the 1-2 person shells in the newest batches");
  assertFalse("industries" in ex,
    "industries is deliberately absent: the example mission's subject is a technology");
});

Deno.test("6. every example is a legal input against its own declared enums", () => {
  for (const [actor, contract] of Object.entries(ACTOR_INPUT_CONTRACTS)) {
    for (const [key, value] of Object.entries(contract.example)) {
      const f = contract.fields.find((x) => x.name === key);
      assert(f, `${actor} example uses ${key}, which the contract must declare`);
      if (!f.enum) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        assert(f.enum.includes(String(v)),
          `${actor} example sends ${key}=${JSON.stringify(v)}, not in its enum`);
      }
      // Array-typed fields must be shown as arrays. Sending a bare string into
      // one is the defect that made the validator read "Engineering, Product
      // and Design" character by character.
      if (f.type === "array") {
        assert(Array.isArray(value), `${actor} example sends ${key} as a bare ${typeof value}`);
      }
    }
  }
});

Deno.test("7. the two YC actors do not teach each other's vocabulary", () => {
  // Their filter names and value formats genuinely differ, and a value copied
  // across is refused. The contracts must say so, because both are offered to
  // the planner for the same missions.
  const notes = (ACTOR_INPUT_CONTRACTS[SOLIDCODE].selection_notes ?? []).join(" ").toLowerCase();
  assert(notes.includes("not memo23") || notes.includes("memo23"),
    "solidcode states that its vocabulary differs from its sibling's");
  assertEquals(field(SOLIDCODE, "batches").enum?.includes("W25"), true, "short codes");
  assertEquals(field(MEMO23, "batch").default, ["All Batches"], "full names");
  assert(field(SOLIDCODE, "batches").note?.includes("memo23"),
    "the batch-code mismatch is called out on the field itself");
});

// ══════════════════════════════════ 8-9. it actually reaches the planner ══

Deno.test("8. selection_notes exist for both discovery actors", () => {
  for (const actor of [MEMO23, SOLIDCODE]) {
    const notes = ACTOR_INPUT_CONTRACTS[actor].selection_notes;
    assert(notes && notes.length > 0, `${actor} carries selection notes`);
  }
});

Deno.test("9. and both planner payloads forward them", () => {
  // Knowledge that never reaches the model is knowledge the model does not
  // have. Both builders send `fields` and `example` already; the notes must
  // travel with them.
  for (const rel of ["leadDiscoveryStrategy.ts", "leadExecutionPlan.ts"]) {
    const src = Deno.readTextFileSync(
      new URL(`../../../supabase/functions/_shared/${rel}`, import.meta.url));
    assert(src.includes("selection_notes"),
      `${rel} forwards selection_notes to the planner`);
  }
});
