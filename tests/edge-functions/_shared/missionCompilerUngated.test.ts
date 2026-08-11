// SEMANTIC CUTOVER — NO REGEX DECIDES WHETHER THE MODEL READS THE SENTENCE.
//
// `compileCanonicalLeadMission` used to begin with `extractLeadIntent(prompt)`
// and return null unless it recognised a hiring signal WITH a role family. A
// regex therefore decided whether a lead request reached the interpreter at all:
// "Find 5 AI workflow companies in Europe" names no hiring signal, compiled no
// mission, and everything downstream ran on the legacy carrier union. GPT was
// authoritative only over requests a regex had already recognised.
//
// The gate was also redundant as ROUTING — all three call sites are already on a
// lead-sourcing branch, so "is this a lead request?" was answered upstream.
//
// Structural, because the function is inside an edge function with database and
// auth dependencies that cannot be constructed offline. Every assertion names
// the exact construct it forbids, so it fails on reintroduction rather than on
// reformatting.
//
// No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
);

/** Source with comments removed — comments explain what was REMOVED and must not match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The CODE of a named function, up to its closing brace at column 0. */
function fnBody(name: string): string {
  const i = SRC.indexOf(name);
  assert(i >= 0, `${name} must exist`);
  const rest = SRC.slice(i);
  const end = rest.indexOf("\n}\n");
  return stripComments(rest.slice(0, end > 0 ? end + 3 : rest.length));
}

const COMPILER = fnBody("async function compileCanonicalLeadMission");

Deno.test("a regex cannot stop the mission compiler from running", () => {
  assert(
    !/extractLeadIntent\(/.test(COMPILER),
    "compileCanonicalLeadMission must not call extractLeadIntent — a regex reading " +
    "of the sentence may not decide whether the model gets to read it",
  );
  assert(
    !/hiring_signal/.test(COMPILER),
    "no hiring-signal precondition may gate compilation: a lead request that names " +
    "no hiring signal is still a lead request",
  );
  assert(
    !/^\s*if \(![\s\S]{0,120}\) return null;/m.test(COMPILER),
    "no early return may suppress compilation for an unrecognised query shape",
  );
});

Deno.test("nothing replaced the gate with another deterministic parser", () => {
  for (const parser of [
    "compileLeadEntityIntent(", "compileJobSearchSpec(", "separateIntent(",
    "buildLeadSearchIntent(", "parseLeadMissionDeterministic(",
  ]) {
    assert(
      !COMPILER.includes(parser),
      `${parser} must not appear in the compiler entry — the gate was removed, not swapped`,
    );
  }
});

Deno.test("the model still reaches the compiler, bounded and refusable", () => {
  assert(/buildMissionCompilerBinding\(/.test(COMPILER), "the model call must still be made");
  assert(
    /MissionCompilationFailedError/.test(COMPILER),
    "and a failed compilation must still refuse explicitly rather than substitute",
  );
  assert(
    /getLeadIntelligenceCapabilities\(/.test(COMPILER) && /new_architecture/.test(COMPILER),
    "the refusal must remain keyed on the workspace's intelligence mode",
  );
});

Deno.test("the ICP shown to the model comes from the Brain, never from the sentence", () => {
  // `extractLeadIntent.target_geography` is `extractGeo(message)` UNIONED with
  // the Brain's ICP geography. Passing that as `companyBrain` handed a regex
  // reading of the sentence back to the model labelled as configuration — so the
  // regex influenced the model's own reading, under a name that hid it.
  assert(
    /companyBrain: brainContext/.test(COMPILER),
    "the compiler must pass the Brain-derived context",
  );
  for (const leaked of ["target_industry", "target_geography", "company_stage"]) {
    assert(
      !COMPILER.includes(leaked),
      `${leaked} is intent-derived and must not reach the model as workspace context`,
    );
  }
});

Deno.test("no regex count hint is sent either — the model answers null itself", () => {
  assert(
    /requestedCount: null/.test(COMPILER),
    "a regex count hint would re-anchor the model to the reading it replaced; " +
    "the schema permits null, so the model states it",
  );
  assert(!/intent\.count/.test(COMPILER));
});

Deno.test("the Brain-context helper reads the profile and does not parse", () => {
  const helper = fnBody("function companyBrainContextForCompiler");
  assert(/brain\?\.icp/.test(helper), "it must read the Brain's ICP");
  assert(
    !/match\(|RegExp|\btest\(|message|prompt|original_query/.test(helper),
    "it must contain no parsing and touch no raw text",
  );
});

Deno.test("the confirmation card's mission is Brain-sourced too", () => {
  // The card previously built its mission from the same intent-derived context,
  // so the preview and the run could disagree about the ICP for one request.
  const CODE = stripComments(SRC);
  assert(
    /companyBrain: cardBrainContext/.test(CODE),
    "the card path must use the Brain-derived context",
  );
  assert(
    /const cardBrainContext = companyBrainContextForCompiler\(/.test(CODE),
    "and must build it through the same helper, not inline",
  );
});

Deno.test("exactly one semantic authority is constructed per compilation", () => {
  const bindings = [...COMPILER.matchAll(/buildMissionCompilerBinding\(/g)].length;
  assertEquals(bindings, 1, "one compiler binding, so one interpretation of the request");
});
