// THE TESTS THAT WOULD HAVE CAUGHT WHAT SHIPPED.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// 6,000 tests passed while six live turns produced: a generic error on every
// conversational message, a lead count that was a page size, a superlative
// answered with an arbitrary slice, an ops brief for a question about one
// field, and a sourcing request that delegated with no mission.
//
// Every one of those is a property of `handlePilotChat` — the ORDER things run
// in, what reaches which surface, and what the whole path does with a request.
// Module tests cannot see any of it, and the defect that hurt most could not be
// seen by the type checker either: `replyAndReturn` hoisted, the `const` it
// closed over did not, and six refusal paths threw before they could speak.
//
// Executing the real handler needs Deno.serve, a database and a model. What is
// testable without any of those is the handler's SHAPE — and the shape is where
// these lived. Each test below names the live failure it pins.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
const code = (s: string) =>
  s.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

const HANDLER = SRC.indexOf("async function handlePilotChat");
const BLOCK_START = SRC.indexOf("══ START OF THE CHAT BRAIN BLOCK");
const BLOCK_END = SRC.indexOf("══ END OF THE CHAT BRAIN BLOCK");
const BLOCK = SRC.slice(BLOCK_START, BLOCK_END);

// ══ 1. THE TEMPORAL DEAD ZONE ══════════════════════════════════════════════

Deno.test("1. nothing the block calls is declared after it", () => {
  // LIVE: every conversational turn returned "Something went wrong handling
  // that message." `hello` reproduced it. Six refusal paths — all of `converse`,
  // the market-research refusal, outreach-without-leads, both signal
  // clarifications, the onboarding gate and the SAFETY refusal — threw
  // `ReferenceError: Cannot access 'baseMeta' before initialization`.
  for (const helper of ["replyAndReturn", "replyMeta", "showWorkflowConfirmation"]) {
    if (!new RegExp(`\\b${helper}\\(`).test(BLOCK)) continue;
    const decl = Math.max(
      SRC.indexOf(`const ${helper} =`),
      SRC.indexOf(`async function ${helper}`),
      SRC.indexOf(`function ${helper}`),
    );
    assert(decl > 0 && decl < BLOCK_START,
      `${helper} is called in the block but declared after it`);
  }
});

// ══ 2. NOTHING SPENDS WITHOUT AN EXPLICIT START ════════════════════════════

Deno.test("2. the lead route previews before it delegates", () => {
  // LIVE: deleting the category-list confirmation gate left this route
  // delegating straight to orchestrate. The route has carried
  // `requires_confirmation: true` throughout; nothing read it, so a sourcing
  // request would have started a paid run with no Start pressed.
  const i = BLOCK.indexOf('brainRoute.kind === "lead_mission" && brainRoute.lead');
  assert(i > 0, "the lead route must be handled");
  const route = BLOCK.slice(i, BLOCK.indexOf("delegateToOrchestrate", i));
  assert(/brainRoute\.requires_confirmation && !isPreConfirmed/.test(route),
    "an unconfirmed lead route must not reach the delegate");
  assert(route.includes("buildCapabilityGraph("), "Stage 1 previews the real graph");
  assert(route.includes("assessRequestFeasibility("), "Stage 0 runs before the preview");
});

Deno.test("3. an infeasible mission is refused, not previewed", () => {
  const i = BLOCK.indexOf("if (!preview.feasible)");
  assert(i > 0, "Stage 0's verdict must gate the preview");
  const branch = BLOCK.slice(i, i + 700);
  assert(branch.includes('state: "UNSUPPORTED"'));
  assertFalse(branch.includes("delegateToOrchestrate"),
    "nothing may be delegated for a mission Stage 0 refused");
});

// ══ 3. NARRATION COMES FROM THE EXECUTABLE GRAPH ═══════════════════════════

Deno.test("4. the preview never names an agent", async () => {
  // LIVE: "Scout will source…, Aria will screen…, Hawk will verify…" for a plan
  // that carried no mission, whose capability graph was never built, and which
  // the preflight refused before a single provider call.
  const preview = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/missionPreview.ts", import.meta.url));
  const c = code(preview);
  for (const agent of ["Scout", "Aria", "Hawk", "Penn", "Scribe", "Lyra", "Mira"]) {
    assertFalse(new RegExp(`["'\`][^"'\`]*\\b${agent}\\b`).test(c),
      `the preview must not narrate ${agent} — which agent runs a capability is ` +
      `an execution detail the preview does not know`);
  }
  assert(c.includes("plan?.steps"), "the narration is the graph's own step list");
  assertFalse(/generateText|gptStructured|proposeMission/.test(c),
    "a preview that called a model would be a second interpretation");
});

Deno.test("5. the lead route does not use the model-calling confirmation builder", () => {
  // `generateWorkflowConfirmation` compiles its OWN mission with its own model
  // call, so its narration can describe a run the executor was never going to
  // perform.
  const i = BLOCK.indexOf('brainRoute.kind === "lead_mission" && brainRoute.lead');
  const route = BLOCK.slice(i, BLOCK.indexOf("delegateToOrchestrate", i));
  assertFalse(route.includes("generateWorkflowConfirmation("),
    "the lead preview must come from the compiled mission, not a second compile");
});

// ══ 4. FAILURES KEEP THEIR CATEGORY ════════════════════════════════════════

Deno.test("6. an unread request fails honestly instead of delegating", () => {
  // LIVE: "I started building a plan but the orchestrator failed:
  // mission_not_compiled" — an internal contract name shown to a user for what
  // was a model outage, because the fall-through delegated with no mission.
  const i = SRC.indexOf("unreadable — no fallback interpreter");
  assert(i > 0);
  const branch = SRC.slice(i, i + 1600);
  assert(branch.includes('category: "model_failure"'));
  assert(branch.includes("!actionSource && !isPreConfirmed"),
    "card actions carry their own metadata and must still work during an outage");
});

Deno.test("7. the catch preserves the category on the row", () => {
  const serve = SRC.slice(SRC.indexOf("Deno.serve("));
  assert(serve.includes("failureMetadata(e"),
    "the reason is in scope at the catch and must reach the database");
});

// ══ 5. ORDER OF OPERATIONS ═════════════════════════════════════════════════

Deno.test("8. safety runs before any surface can be reached", () => {
  const guard = BLOCK.indexOf("asksForUnsafeAction(message)");
  const firstSurface = Math.min(
    ...['brainRoute.kind === "signal_sourcing"', 'brainRoute.kind === "compose"',
        'brainRoute.kind === "lead_mission" && brainRoute.lead',
        'brainRoute.kind === "converse"']
      .map((m) => BLOCK.indexOf(m)).filter((n) => n > 0));
  assert(guard > 0 && guard < firstSurface,
    "the unsafe refusal must precede every surface");
});

Deno.test("9. referents are resolved before the router runs", () => {
  const resolve = BLOCK.indexOf("const resolution = resolveReferents(");
  const route = BLOCK.indexOf("brainRoute = routeRequest(");
  assert(resolve > 0 && route > resolve,
    "an unresolvable reference must cost a question, not a mission");
});

Deno.test("10. memory is readable before the request is routed", () => {
  const load = SRC.indexOf("await loadConversationMemory({");
  assert(load > HANDLER && load < BLOCK_START,
    "a request about remembered leads must be routable against them");
});

// ══ 6. READS STATE WHAT THEY COUNTED ═══════════════════════════════════════

Deno.test("11. the read persists what it displayed, so a follow-up can point at it", () => {
  // LIVE: "10 leads saved." then "Which of those look strongest?" had nothing
  // to resolve against — the answer named no company, so no referent set
  // existed and the follow-up could only clarify.
  const i = BLOCK.indexOf('brainBinding.kind === "read"');
  assert(i > 0);
  const read = BLOCK.slice(i, BLOCK.indexOf("brainBinding.kind === \"monitor\"", i));
  assert(read.includes("presentedCompanies(result)"),
    "referents must be built from the renderer's own list");
  assert(read.includes("PRESENTED_REFERENTS_KEY"),
    "and persisted on the message that displayed them");
});
