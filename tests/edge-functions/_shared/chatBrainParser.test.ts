// THE CONTRACT AT THE MODEL SEAM.
//
// The prompt is persuasion; the parser is the contract. Every model seam in
// this repo draws that line — `parseMissionProposalStrict`,
// `parseSemanticFitStrict`, `parseMissionEvaluationStrict` — because a model
// that returns something ALMOST right must produce a refusal the caller can act
// on, not a half-filled object that looks usable.
//
// The rule that carries the money: NEVER INVENT AN OBJECTIVE, and never let the
// model grant itself permission to spend.
//
// Pure. No network, no model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseRequestStrict, REQUEST_PARSER_VERSION,
} from "../../../supabase/functions/_shared/requestV1Parser.ts";

const U = "Find 5 B2B SaaS companies hiring SDRs";
const part = (over: Record<string, unknown> = {}) => ({
  id: "p1", objective: "source",
  subject: { entity: "company" },
  output: { shape: "records", count: 5 },
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  parts: [part()], ambiguity: [], confidence: 0.9, ...over,
});

// ══ 1. THE MODEL MAY NOT GRANT ITSELF SPEND ════════════════════════════════

Deno.test("a model claiming spend authority is ignored", () => {
  // Permission is workspace policy and a user's confirmation. A model that
  // returned `may_spend: true` must not thereby be allowed to spend, so the
  // parser hard-codes the safe value rather than reading one.
  const p = parseRequestStrict({
    ...answer(),
    authority: { may_spend: true, max_cost_units: 9999, requires_confirmation: false },
  }, U);
  assert(p.request);
  assertEquals(p.request!.authority.may_spend, false);
  assertEquals(p.request!.authority.requires_confirmation, true);
  assertEquals(p.request!.authority.max_cost_units, null);
});

Deno.test("the utterance comes from the caller, never the model", () => {
  // A model that paraphrased the user would silently rewrite the record every
  // downstream preview quotes.
  const p = parseRequestStrict({ ...answer(), utterance: "something else entirely" }, U);
  assertEquals(p.request!.utterance, U);
});

// ══ 2. AN OBJECTIVE IS NEVER INVENTED ══════════════════════════════════════

Deno.test("a missing objective is refused, not defaulted", () => {
  const p = parseRequestStrict({ parts: [part({ objective: undefined })] }, U);
  assertEquals(p.request, null);
  assertEquals(p.violations, ["unknown_objective"]);
});

Deno.test("an unknown objective is refused, not mapped to something plausible", () => {
  for (const bad of ["find", "search", "lookup", "SOURCE", ""]) {
    const p = parseRequestStrict({ parts: [part({ objective: bad })] }, U);
    assertEquals(p.request, null, `"${bad}" must not parse`);
    assertEquals(p.violations, ["unknown_objective"]);
  }
});

Deno.test("all six objectives parse", () => {
  for (const o of ["converse", "read", "research", "source", "monitor", "compose"]) {
    const p = parseRequestStrict({ parts: [part({ objective: o })] }, U);
    assert(p.request, `${o} must parse`);
    assertEquals(p.request!.parts[0].objective, o);
  }
});

// ══ 3. STRUCTURE IS REFUSED LOUDLY; NOISE IS DROPPED QUIETLY ═══════════════

Deno.test("a non-object, an empty answer and no parts are all refused", () => {
  assertEquals(parseRequestStrict(null, U).violations, ["not_an_object"]);
  assertEquals(parseRequestStrict("{}", U).violations, ["not_an_object"]);
  assertEquals(parseRequestStrict({ parts: [] }, U).violations, ["no_parts"]);
  assertEquals(parseRequestStrict(answer(), "").violations, ["no_utterance"]);
});

Deno.test("an unknown entity or malformed output is refused", () => {
  assertEquals(
    parseRequestStrict({ parts: [part({ subject: { entity: "spaceship" } })] }, U).violations,
    ["unknown_entity"]);
  assertEquals(
    parseRequestStrict({ parts: [part({ output: { shape: "csv", count: 1 } })] }, U).violations,
    ["malformed_output"]);
});

Deno.test("an unknown signal event is FATAL, not dropped", () => {
  // Dropping it would turn "hiring AND funding" into "hiring" — a narrower
  // search presented as the one that was asked for.
  const p = parseRequestStrict({
    parts: [part({ requirements: [
      { event: "hiring", subject: "company", phrase: "hiring" },
      { event: "vibes", subject: "company", phrase: "good vibes" },
    ] })],
  }, U);
  assertEquals(p.request, null);
  assertEquals(p.violations, ["unknown_signal_event"]);
});

Deno.test("extra keys the model invented are ignored, not refused", () => {
  // Additive noise is not an error about the request.
  const p = parseRequestStrict({
    ...answer(), reasoning: "because", extra: { nested: true },
  }, U);
  assert(p.request);
  assertEquals(p.violations, []);
});

// ══ 4. DEPENDENCIES ════════════════════════════════════════════════════════

Deno.test("duplicate ids, dangling and cyclic dependencies are refused", () => {
  assertEquals(parseRequestStrict({
    parts: [part(), part()],
  }, U).violations, ["duplicate_part_id"]);

  assertEquals(parseRequestStrict({
    parts: [part({ depends_on: ["nope"] })],
  }, U).violations, ["dangling_dependency"]);

  assertEquals(parseRequestStrict({
    parts: [part({ id: "a", depends_on: ["b"] }), part({ id: "b", depends_on: ["a"] })],
  }, U).violations, ["cyclic_dependency"]);
});

Deno.test("a valid dependency survives", () => {
  const p = parseRequestStrict({
    parts: [
      part({ id: "a" }),
      part({ id: "b", objective: "compose",
        subject: { entity: "content" },
        output: { shape: "artifact", count: 3 }, depends_on: ["a"] }),
    ],
  }, "Find agencies and give me 3 post ideas.");
  assert(p.request);
  assertEquals(p.request!.parts[1].depends_on, ["a"]);
});

// ══ 5. THE REQUEST'S OBJECTIVE IS THE MOST COMMITTING ONE ══════════════════

Deno.test("a mixed message is classified by its most committing part", () => {
  // A message that reads and then sources IS a spending request. Treating it as
  // a read would let the spend happen without the authority check.
  const p = parseRequestStrict({
    parts: [
      part({ id: "a", objective: "read", subject: { entity: "signal" },
        output: { shape: "answer", count: null } }),
      part({ id: "b", objective: "source", depends_on: ["a"] }),
    ],
  }, "Show me my strongest signals and find people there.");
  assertEquals(p.request!.objective, "source");
});

Deno.test("a pure conversation stays conversation", () => {
  const p = parseRequestStrict({
    parts: [part({ objective: "converse", subject: { entity: "conversation" },
      output: { shape: "answer", count: null } })],
  }, "Do you think my ICP is too broad?");
  assertEquals(p.request!.objective, "converse");
});

// ══ 6. AMBIGUITY DEFAULTS TO BLOCKING ══════════════════════════════════════

Deno.test("ambiguity with no stated severity blocks", () => {
  // A model that did not say how serious its confusion is has not established
  // that proceeding is safe, and the failure this guards — spending against the
  // wrong entity — is the most expensive one in the system.
  const p = parseRequestStrict({
    ...answer(),
    ambiguity: [{ field: "subject", question: "Which company?" }],
  }, "Monitor them.");
  assertEquals(p.request!.ambiguity[0].blocking, true);
});

Deno.test("explicitly non-blocking ambiguity is honoured", () => {
  const p = parseRequestStrict({
    ...answer(),
    ambiguity: [{ field: "filters", question: "How fast?", blocking: false }],
  }, "Find fast-growing companies");
  assertEquals(p.request!.ambiguity[0].blocking, false);
});

// ══ 7. NON-FATAL REPAIRS ARE REPORTED ══════════════════════════════════════

Deno.test("a missing part id is generated and reported", () => {
  const p = parseRequestStrict({ parts: [part({ id: "" })] }, U);
  assert(p.request);
  assert(p.repairs.some((r) => r.startsWith("part_id_generated")));
});

Deno.test("an unknown filter op widens rather than narrows, and says so", () => {
  // A filter whose operator we do not know is still a filter the user stated;
  // `in` cannot narrow further than the request asked.
  const p = parseRequestStrict({
    parts: [part({ subject: { entity: "company",
      filters: [{ field: "industry", op: "≈", value: ["SaaS"] }] } })],
  }, U);
  assertEquals(p.request!.parts[0].subject.filters![0].op, "in");
  assert(p.repairs.some((r) => r.startsWith("filter_op_defaulted")));
});

Deno.test("the user's role words are kept verbatim", () => {
  // `role_terms` decides what counts as evidence. Normalising here would change
  // which jobs match — the exact class of bug that made "sales roles" mean
  // something else in Phase 8.
  const p = parseRequestStrict({
    parts: [part({ requirements: [{ event: "hiring", subject: "company",
      phrase: "hiring sales roles", qualifier: { role_terms: ["sales roles"] } }] })],
  }, U);
  assertEquals(p.request!.parts[0].requirements![0].qualifier!.role_terms, ["sales roles"]);
});

// ══ 8. NO KEYWORD DICTIONARY ═══════════════════════════════════════════════

Deno.test("neither module MATCHES on the utterance", () => {
  // ── WHY THIS IS NOT A SUBSTRING SEARCH ──────────────────────────────────
  //
  // The prompt names phrasings on purpose — it tells the model that "show me",
  // "find", "what" and "who" appear in all three of read/research/source and
  // therefore decide nothing. That is the opposite of a keyword table, and a
  // test that banned the words would forbid teaching the lesson.
  //
  // What must not exist is CODE that inspects the user's words. The existing
  // classifiers are regex-first, which is exactly why every unseen phrasing
  // needs a new patch; this path must derive nothing from the string itself.
  const files: Record<string, string> = {};
  for (const f of ["chatBrain.ts", "requestV1Parser.ts"]) {
    files[f] = Deno.readTextFileSync(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
  }
  for (const [f, SRC] of Object.entries(files)) {
    const code = SRC.split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      // The system prompt is data handed to the model, not logic. Everything
      // between the backticks is prose.
      .join("\n").replace(/`[\s\S]*?`/g, "``");
    for (const [label, re] of [
      ["utterance.includes", /utterance\s*\.\s*(includes|indexOf|search|match|startsWith|endsWith)/],
      ["utterance.toLowerCase", /utterance\s*\.\s*toLowerCase/],
      ["regex against utterance", /\.test\s*\(\s*utterance/],
      ["utterance split for matching", /utterance\s*\.\s*split/],
    ] as Array<[string, RegExp]>) {
      assertEquals(re.test(code), false,
        `${f} must not decide anything by ${label}`);
    }
  }
});

Deno.test("the objective comes from the model, never from the string", () => {
  // The proof by construction: the SAME utterance with different model answers
  // yields different objectives, and a DIFFERENT utterance with the same answer
  // yields the same one. The words are inert.
  const a = parseRequestStrict({ parts: [part({ objective: "read",
    output: { shape: "answer", count: null } })] }, "Find companies hiring SDRs");
  const b = parseRequestStrict({ parts: [part({ objective: "source" })] },
    "Find companies hiring SDRs");
  assertEquals(a.request!.objective, "read");
  assertEquals(b.request!.objective, "source");

  const c = parseRequestStrict({ parts: [part({ objective: "source" })] },
    "totally different wording with no keywords at all");
  assertEquals(c.request!.objective, "source");
});

Deno.test("the parser version is pinned", () => {
  assertEquals(REQUEST_PARSER_VERSION, "request-v1-parser-1");
});
