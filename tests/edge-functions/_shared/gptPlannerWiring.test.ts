// IS THE PLANNER ACTUALLY CONSTRUCTED?
//
// `gptProvider` and `gptDiscoveryPlanner` shipped fully tested and completely
// inert: the engine had accepted a `planDiscovery` dependency for some time, and
// nothing ever built one. `resolveDiscoveryStrategy` therefore took the
// deterministic branch on every run, and the request had no influence on which
// Actors were called.
//
// Every unit test still passed. That is the point of this file — a module can be
// correct, covered, and unreachable, and only a wiring assertion catches the
// difference between "implemented" and "running".
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const RUN_AGENT = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
);
const PLANNER = await Deno.readTextFile(
  new URL("../../../supabase/functions/_shared/gptDiscoveryPlanner.ts", import.meta.url),
);
/** Comments legitimately NAME the validator while explaining the split. */
const PLANNER_CODE = PLANNER.replace(/^\s*\/\/.*$/gm, "");

Deno.test("1. run-agent constructs the GPT planner and passes it to the engine", () => {
  assert(
    /import \{ makeGptDiscoveryPlanner \}/.test(RUN_AGENT),
    "run-agent must import the planner factory",
  );
  assert(
    /planDiscovery:\s*makeGptDiscoveryPlanner\(\{/.test(RUN_AGENT),
    "planDiscovery must be supplied to runCapabilityPlan, unconditionally",
  );
  assert(
    /makeGptDiscoveryPlanner\(\{/.test(RUN_AGENT),
    "and it must actually be built, not merely imported",
  );
});

// ── UPDATED 2026-08-17: THE CREDENTIAL GATE IS GONE TOO ──────────────────
//
// This asserted the planner was gated on `gptAvailable(readEnvSafe)` and
// `undefined` without a key, "so the engine falls back". That fallback was the
// YC/B2B literal, so a missing credential produced a confident search for
// something the user had not asked for. With the literal deleted there is
// nothing to fall back TO, and the gate would only convert a blocked run into
// a wrong one.
Deno.test("2. the planner is unconditional — no flag AND no credential gate", () => {
  const block = RUN_AGENT.slice(
    RUN_AGENT.indexOf("planDiscovery:"),
    RUN_AGENT.indexOf("planDiscovery:") + 400,
  );
  assertEquals(
    /gptAvailable\(/.test(block), false,
    "a missing key must block the run, not select a default actor",
  );
  assertEquals(
    /:\s*undefined/.test(block), false,
    "there is no `undefined` branch left for the engine to interpret",
  );
  assertEquals(
    /INTELLIGENCE_FLAG|isIntelligenceFlagEnabled|FEATURE_/.test(block), false,
    "and no feature flag either",
  );
});

Deno.test("3. the planner returns a proposal and validates nothing itself", () => {
  // The split the architecture rests on: GPT decides WHAT, deterministic code
  // decides WHETHER. A second validation here would be a second authority on
  // what is allowed, and the two would drift.
  assertEquals(
    /validateDiscoveryStrategy\s*\(/.test(PLANNER_CODE), false,
    "the planner must not CALL the validator — that is the engine's job. Naming " +
    "it in a comment is fine; invoking it would create a second authority.",
  );
  // IT RETURNS THE PROPOSAL, and the only thing it does to it is DESERIALISE.
  //
  // This asserted the literal `return { actors: r.value.actors`, which broke the
  // moment the actor input became a JSON string — a change forced by OpenAI's
  // strict structured-output mode, which refuses an open object outright. The
  // property that matters is unchanged: the planner shapes the answer and judges
  // none of it.
  assert(/r\.value\.actors/.test(PLANNER),
    "it returns the model's own actor list");
  assert(/parsePlannedInput/.test(PLANNER),
    "deserialising the input string is shaping, not judging — the values are " +
    "still checked against that actor's supported_filters and verified_enums " +
    "by the validator");
  // NOTE: the planner's PROMPT names `not_for` — it tells the model to read the
  // catalog's own field. That is briefing, not enforcement, and the assertion
  // above (it never calls `validateDiscoveryStrategy`) is what separates them.
  assertEquals(/declaresUnfitForSemantic|cohortRefusalFor/.test(PLANNER_CODE), false,
    "it imports no refusal helper — a rule applied here would be a second " +
    "authority on what is allowed");
});

Deno.test("4. a planner failure returns null rather than throwing", () => {
  // The engine's resolver treats an unusable answer as a reason to run the
  // deterministic strategy. A throw would abandon a run that may already have
  // paid for discovery.
  assert(/if \(!r\.ok\)/.test(PLANNER));
  assert(
    /return null;/.test(PLANNER.slice(PLANNER.indexOf("if (!r.ok)"))),
    "an unusable model answer must degrade to code, not to an exception",
  );
});

Deno.test("5. the lead path still imports no other model provider", () => {
  // Re-asserted at the WIRING level, not just inside the modules: run-agent is
  // where a well-meaning fallback would most plausibly be added.
  const gptBlock = RUN_AGENT.slice(
    RUN_AGENT.indexOf("planDiscovery:"),
    RUN_AGENT.indexOf("planDiscovery:") + 600,
  );
  for (const other of ["anthropic", "lovable", "claude", "gemini"]) {
    assertEquals(
      new RegExp(other, "i").test(gptBlock.replace(/\/\/.*$/gm, "")), false,
      `the discovery planner must not reference ${other} — GPT answers or code does`,
    );
  }
});
