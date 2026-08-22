// GPT IS THE ONLY INTERPRETER OF A LEAD REQUEST.
//
// ── THE RUN THIS ENCODES ────────────────────────────────────────────────────
//
// 2026-08-17, plan c4fc6d4e: "Find 10 qualified AI startups in the United
// States that are currently hiring software engineers."
//
// It compiled with `mission_parser_source: "deterministic_fallback"`, the word
// "AI" reached no provider (`positive_keywords: []`), and the verticals came
// from the Company Brain — `field_provenance.company_profile.verticals =
// "company_brain"`. The pool was YC ∩ B2B ∩ US ∩ hiring ∩ 10–500 employees, and
// 0 of 30 investigated companies qualified.
//
// Nothing was broken. `GPT_LEAD_MISSION_COMPILER` was unset, so no model was
// asked, and a regex reading of the sentence became the mission.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GPT_MISSION_SCHEMA,
  MISSION_PROPOSAL_FIELDS,
} from "../../../supabase/functions/_shared/gptMissionSchema.ts";
import {
  createGptMissionGenerateJson,
  GPT_MISSION_MODEL_ID,
} from "../../../supabase/functions/_shared/gptMissionModel.ts";
import { parseMissionProposal } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

const COMPILER = await Deno.readTextFile(
  new URL("../../../supabase/functions/_shared/leadMissionCompiler.ts", import.meta.url),
);
const BINDING = await Deno.readTextFile(
  new URL("../../../supabase/functions/_shared/leadMissionCompilerBinding.ts", import.meta.url),
);
const PILOT = await Deno.readTextFile(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
);

// ═══════════════════════════════════ schema ↔ parser alignment ══

/**
 * Every `c.<field>` the parser reads off the raw proposal.
 *
 * Derived from the source rather than hand-listed, so the test cannot silently
 * fall out of date the way the schema itself could.
 */
function parserFields(): string[] {
  const body = COMPILER.slice(
    COMPILER.indexOf("export function parseMissionProposal"),
    COMPILER.indexOf("export const MAX_SIGNAL_RECENCY_DAYS"),
  );
  return [...new Set([...body.matchAll(/\bc\.([a-z_]+)/g)].map((m) => m[1]))];
}

Deno.test("1. every field the parser reads is present in the GPT schema", () => {
  // THE DRIFT GUARD. A field the parser reads but the schema omits can never be
  // emitted under `strict: true` — so the parser's handling of it becomes dead
  // code and the constraint vanishes from every mission, silently. That is how
  // "AI" would go missing again one refactor from now.
  const missing = parserFields().filter((f) => !MISSION_PROPOSAL_FIELDS.includes(f));
  assertEquals(
    missing, [],
    "these fields are read by parseMissionProposal but absent from " +
    "GPT_MISSION_SCHEMA, so the model can never send them",
  );
});

Deno.test("2. the schema declares no field the parser ignores", () => {
  // The other direction. A schema field nobody reads is a promise to the model
  // that the system does not keep.
  const read = parserFields();
  const unread = MISSION_PROPOSAL_FIELDS.filter((f) => !read.includes(f));
  assertEquals(unread, [], "these schema fields are never read by the parser");
});

Deno.test("3. the schema is strict everywhere, at every depth", () => {
  // OpenAI rejects the request outright unless every object level sets
  // `additionalProperties: false` AND lists every property in `required`. A
  // schema that fails this does not degrade — the call errors, and before this
  // refactor that error was indistinguishable from "no proposal".
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object") {
      assertEquals(n.additionalProperties, false, `${path} must set additionalProperties:false`);
      const props = Object.keys((n.properties ?? {}) as Record<string, unknown>);
      const required = ((n.required ?? []) as string[]);
      assertEquals(
        props.filter((p) => !required.includes(p)), [],
        `${path}: strict mode requires EVERY property in \`required\` — express ` +
        `optionality as a nullable type instead`,
      );
    }
    for (const [k, v] of Object.entries(n)) {
      if (v && typeof v === "object") walk(v, `${path}.${k}`);
    }
  };
  walk(GPT_MISSION_SCHEMA.schema, "root");
});

Deno.test("4. a schema-shaped proposal survives the parser intact", () => {
  // The two agree in practice, not only in field names. This is the exact
  // request that failed, expressed the way the schema tells the model to.
  const parsed = parseMissionProposal({
    requested_opportunity_count: 10,
    requested_contact_ready_count: null,
    company_types: ["AI", "startup"],
    geographies: ["United States"],
    employee_range: { min: null, max: null },
    decision_maker_roles: [],
    hard_constraints: [{
      field: "company_profile.locations", operator: "in",
      value: ["United States"], reason: "stated in the request",
    }],
    soft_preferences: [],
    preferred_signals: ["hiring"],
    adjacent_signals: [],
    excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: [],
    required_evidence: [],
    required_capabilities: [],
    preferred_source_strategy: [],
    evaluation_instructions: "",
    founder_unlock_recommended: true,
    confidence: 0.9,
    unknowns: [],
    known_companies: [],
    signal_recency_days: null,
    required_signal_terms: ["software engineers"],
    no_broadening_requested: false,
    geography_is_hard: true,
    prohibitions: [],
    strategies: [],
    output_intent: null,
  });

  assert(parsed.proposal, "a schema-conformant proposal must parse");
  const p = parsed.proposal!;

  // ── THE REGRESSION, STATED AS ASSERTIONS ────────────────────────────────
  assertEquals(p.requested_opportunity_count, 10, "the requested count is the user's");
  assert(p.company_types.includes("AI"), "AI MUST survive — this is the whole failure");
  assert(p.company_types.includes("startup"));
  assertEquals(p.geographies, ["United States"]);
  assert(
    p.required_signal_terms.includes("software engineers"),
    "the user's own role words must reach the search verbatim",
  );
  assertEquals(p.geography_is_hard, true);

  // And none of the old defaults may appear from nowhere.
  assertEquals(p.company_types.includes("B2B"), false, "B2B was never requested");
  assertEquals(p.employee_range, { min: null, max: null }, "10–500 was never requested");
});

Deno.test("5. an explicit null count is preserved, never invented", () => {
  const p = parseMissionProposal({
    requested_opportunity_count: null, company_types: ["AI"], geographies: [],
    employee_range: { min: null, max: null }, confidence: 0.5,
  }).proposal;
  assert(p);
  assertEquals(p!.requested_opportunity_count, null, "no number asked, none invented");
});

// ═══════════════════════════════════════════ the model is GPT ══

const gen = createGptMissionGenerateJson;

Deno.test("6. it calls OpenAI, with the mission schema and temperature 0", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const f = gen({
    readEnv: () => "sk-test",
    fetch: (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(String(init.body));
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: '{"requested_opportunity_count":10}' } }],
        })),
      });
    },
  });

  const r = await f({ taskType: "planning", messages: [{ role: "user", content: "find 10 AI startups" }] } as never);

  assert(url.includes("openai.com"), `must call OpenAI, called ${url}`);
  assertEquals(body.temperature, 0, "compilation must be reproducible");
  const rf = body.response_format as Record<string, unknown>;
  const js = rf.json_schema as Record<string, unknown>;
  assertEquals(js.name, "lead_mission_proposal");
  assertEquals(js.strict, true);
  assertEquals(r.ok, true);
  assertEquals(r.model, GPT_MISSION_MODEL_ID);
});

Deno.test("7. a GPT failure is reported as a failure, never as a proposal", async () => {
  // The contract the block depends on: no proposal, and a code the caller can
  // put in front of the user.
  const f = gen({ readEnv: () => undefined });
  const r = await f({ taskType: "planning", messages: [] } as never);
  assertEquals(r.ok, false);
  assertEquals(r.errorCode, "no_api_key");
  assertEquals(r.json, undefined, "a failed call must not carry a JSON body");
});

Deno.test("8. this stage reaches no other provider", () => {
  const MODEL = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/gptMissionModel.ts", import.meta.url),
  ).replace(/^\s*\/\/.*$/gm, "");
  for (const other of ["anthropic", "lovable", "claude", "gemini", "strategist"]) {
    assertEquals(
      new RegExp(other, "i").test(MODEL), false,
      `the mission model must not reference ${other} — GPT answers or the run blocks`,
    );
  }
});

// ══════════════════════════════════════════════════ the wiring ══

Deno.test("9. the compiler is no longer flag-gated", () => {
  const code = BINDING.replace(/^\s*\/\/.*$/gm, "");
  assertEquals(
    /if \(!enablement\.enabled\)[\s\S]{0,120}proposeMission: null/.test(code), false,
    "an unset flag must no longer switch interpretation off",
  );
  // Matched on the CALL, not on empty parens. The adapter now receives a
  // telemetry sink so model spend reaches the ledger, and the original
  // `createGptMissionGenerateJson\(\)` pattern failed on the argument — for a
  // change that does not touch what this test is about, which is that the GPT
  // adapter and not the strategist reads the user's sentence.
  assert(
    /createGptMissionGenerateJson\(/.test(code),
    "production must use the GPT adapter, not the Claude/Lovable strategist",
  );
  assertEquals(
    /createStrategistGenerateJson\(/.test(code), false,
    "the strategist adapter must not be reachable from this stage",
  );
});

Deno.test("10. a deterministic reading can never be returned as the mission", () => {
  // THE PROOF THAT THE OLD PATH IS UNREACHABLE, not merely discouraged.
  //
  // `deterministic()` still exists in the compiler and is still used as the
  // SCAFFOLD a validated proposal is overlaid onto — structure, not
  // interpretation. What must be impossible is it becoming the ANSWER.
  const code = PILOT.replace(/^\s*\/\/.*$/gm, "");
  assert(
    /if \(mission\.mission_parser_source === "deterministic_fallback"\)[\s\S]{0,220}throw new MissionCompilationFailedError/
      .test(code),
    "pilot-chat must refuse any mission still carrying deterministic_fallback",
  );
  assertEquals(
    /intelligence\.mode === "new_architecture" &&\s*\n?\s*mission\.mission_parser_source/.test(code),
    false,
    "the refusal must not be gated on the intelligence mode — that gate is why " +
    "the check never fired on a real run",
  );
});
