// WHAT CHAT BRAIN IS ALLOWED TO CHANGE IN pilot-chat, AND WHAT IT IS NOT.
//
// The DECISION moves; the machinery does not. Chat Brain replaces the
// classifier's verdict and nothing else — every deterministic boundary below
// the category (Stage 0, Stage 1, identity, unlocks, credits, provider
// selection, execution validation) is untouched and unreachable from here.
//
// Pure. No network, no model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindRoute, chatBrainEnabled, CHAT_BRAIN_FLAG,
} from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import type { Route } from "../../../supabase/functions/_shared/objectiveRouter.ts";

const route = (over: Partial<Route>): Route => ({
  version: "objective-router-v1", kind: "converse", objective: "converse",
  part_ids: ["p1"], may_spend: false, requires_confirmation: true,
  message: null, reason: "r", ...over,
});

// ══ 1. THE ROLLBACK FLAG ═══════════════════════════════════════════════════

Deno.test("Chat Brain is authoritative by DEFAULT", () => {
  assertEquals(chatBrainEnabled(() => undefined), true);
  assertEquals(chatBrainEnabled(() => ""), true);
});

Deno.test("one variable restores the old classifiers, with no deploy", () => {
  assertEquals(chatBrainEnabled(() => "false"), false);
  assertEquals(chatBrainEnabled(() => "FALSE"), false);
  assertEquals(CHAT_BRAIN_FLAG, "CHAT_BRAIN_ENABLED");
});

Deno.test("any other value keeps the new path on", () => {
  // Fail-forward on a typo: a misspelled rollback must not silently disable
  // the path that is now carrying production.
  for (const v of ["true", "1", "yes", "off", "nonsense"]) {
    assertEquals(chatBrainEnabled(() => v), true, v);
  }
});

// ══ 2. WHAT EACH ROUTE MEANS ═══════════════════════════════════════════════

Deno.test("a blocked request replies and stops", () => {
  const b = bindRoute(route({ kind: "blocked", message: "Which company?" }));
  assertEquals(b.kind, "reply");
  assert(b.kind === "reply" && b.message === "Which company?");
});

Deno.test("an unservable objective replies rather than serving something nearby", () => {
  const b = bindRoute(route({
    kind: "clarify", objective: "compose",
    message: "Content generation isn't wired up yet.", reason: "no_surface:compose",
  }));
  assertEquals(b.kind, "reply");
});

Deno.test("conversation becomes conversation", () => {
  const b = bindRoute(route({ kind: "converse" }));
  assertEquals(b.kind, "category");
  assert(b.kind === "category" && b.category === "simple_chat");
});

Deno.test("a lead mission enters the hardened path by its existing category", () => {
  const b = bindRoute(route({ kind: "lead_mission", objective: "source" }));
  assertEquals(b.kind, "category");
  assert(b.kind === "category" && b.category === "qualified_lead_sourcing");
});

Deno.test("read and monitor reach their OWN surfaces, not a category", () => {
  // Phase D gave them surfaces. They still do not become categories: answering
  // "what are my strongest signals?" through `simple_chat` would let the model
  // invent an answer from no data, and turning "keep watching that" into a
  // sourcing run would buy something nobody asked for.
  assertEquals(bindRoute(route({ kind: "read" })).kind, "read");
  assertEquals(bindRoute(route({ kind: "monitor" })).kind, "monitor");
  for (const kind of ["read", "monitor"] as Array<Route["kind"]>) {
    const b = bindRoute(route({ kind }));
    assertEquals(b.kind === "category", false, `${kind} must not become a category`);
  }
});

Deno.test("every route kind is bound — none falls through silently", () => {
  for (const kind of ["blocked", "clarify", "converse", "lead_mission", "read", "monitor"] as Array<Route["kind"]>) {
    const b = bindRoute(route({ kind }));
    assert(["reply", "category", "read", "monitor", "fallback"].includes(b.kind), kind);
    assert(b.reason, `${kind} must state a reason`);
  }
});

// ══ 3. THE SEAM CARRIES A CATEGORY AND NOTHING ELSE ════════════════════════

Deno.test("the binding cannot grant spend", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/chatBrainBinding.ts", import.meta.url));
  const code = SRC.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertEquals(/may_spend\s*[:=]/.test(code), false,
    "spend authority is the router's, computed from workspace policy");
  assertEquals(/credit|provider|invoke|apify/i.test(code), false,
    "the binding names no provider and no credit path");
});

Deno.test("pilot-chat overrides the classifier only for a bound category", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf("if (chatBrainEnabled(readEnvSafe))");
  assert(i > 0, "Chat Brain must be wired");
  // WIDE ENOUGH FOR THE WHOLE WIRING BLOCK. Phase E put referent resolution
  // ahead of the router inside this same block, so the category override now
  // sits further down it. The window is a proximity check, not a length check —
  // what it must contain is the wiring, and it still ends before the Phase 0
  // baseline that follows.
  const block = SRC.slice(i, i + 12000);
  assert(block.includes('if (brainBinding.kind === "category")'),
    "only a bound category replaces the classifier's verdict");
  assert(block.includes("decision.workflow_category ="),
    "and that is the ONLY thing it replaces");
  // A model failure must never become a spending objective.
  assert(block.includes("deferring to classifier"),
    "an unreadable model leaves the old verdict standing");
  // Spend authority is not read from the request anywhere in the wiring.
  assertEquals(/understood\.request\.authority/.test(block), false);
});

Deno.test("a blocked or unservable request returns before anything executes", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf('if (brainBinding.kind === "reply")');
  assert(i > 0);
  const block = SRC.slice(i, i + 700);
  assert(block.includes("return json("), "it must return, not continue");
  assert(block.includes("clarification: true"));
});

// ══ 4. PHASE D — THE TWO NEW SURFACES, AT THE CALL SITE ════════════════════

Deno.test("pilot-chat answers a read without reaching a provider", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf('if (brainBinding.kind === "read")');
  assert(i > 0, "the read surface must be wired");
  // Sized to end just before the monitor block: the negative assertion below is
  // only meaningful while the window covers the read path and nothing else.
  const block = SRC.slice(i, i + 1650);
  assert(block.includes("planRead(") && block.includes("executeRead("));
  assert(block.includes("return json("), "a read answers and stops");
  // Nothing on this path may start work.
  assertEquals(/delegat|orchestrate|run-agent/i.test(block), false,
    "a read must not hand off to execution");
});

Deno.test("pilot-chat records a monitor without starting a scan", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf('if (brainBinding.kind === "monitor")');
  assert(i > 0, "the monitor surface must be wired");
  const block = SRC.slice(i, i + 1400);
  assert(block.includes("planMonitor(") && block.includes("executeMonitor("));
  assert(block.includes("return json("), "recording an intention answers and stops");
  assertEquals(/run-monitoring-scan|invokeScan/.test(block), false,
    "a monitor request must not trigger a scan now");
});
