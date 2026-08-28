// WHAT CHAT BRAIN IS ALLOWED TO CHANGE IN pilot-chat, AND WHAT IT IS NOT.
//
// The DECISION moves; the machinery does not. Chat Brain replaces the
// classifier's verdict and nothing else — every deterministic boundary below
// the category (Stage 0, Stage 1, identity, unlocks, credits, provider
// selection, execution validation) is untouched and unreachable from here.
//
// Pure. No network, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindRoute,
} from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import type { Route } from "../../../supabase/functions/_shared/objectiveRouter.ts";

const route = (over: Partial<Route>): Route => ({
  version: "objective-router-v1", kind: "converse", objective: "converse",
  part_ids: ["p1"], may_spend: false, requires_confirmation: true,
  message: null, reason: "r", ...over,
});

// ══ 1. THERE IS NO ROLLBACK FLAG ═══════════════════════════════════════════

Deno.test("the rollback switch is gone, and nothing can reinstate it", async () => {
  // `CHAT_BRAIN_ENABLED=false` restored `workflowClassifier`, `leadIntent`,
  // `leadIntentModel` and `classifyIntent` as authoritative in one variable.
  // That was the right safety valve while those existed. They are deleted, and
  // a flag that switches to nothing is worse than no flag: it reads as an
  // escape hatch, and the first person to reach for it in an incident would
  // find the request path doing nothing at all.
  const binding = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/chatBrainBinding.ts", import.meta.url));
  const code = binding.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(code.includes("CHAT_BRAIN_ENABLED"),
    "no flag may gate the only understanding path");
  assertFalse(/export function chatBrainEnabled/.test(code));

  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const pilotCode = pilot.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(/chatBrainEnabled\(/.test(pilotCode),
    "understanding must run unconditionally");
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

Deno.test("a lead mission is a ROUTE, never a category", () => {
  // It used to bind to the category "qualified_lead_sourcing", which is not a
  // member of `WorkflowCategory`. Nothing downstream matched it, so a correctly
  // understood sourcing request fell through every branch, delegated with no
  // mission, and was refused as `mission_not_compiled`.
  //
  // The caller now compiles `route.lead` and delegates the mission itself.
  const b = bindRoute(route({ kind: "lead_mission", objective: "source" }));
  assertEquals(b.kind, "lead_route");
  assertEquals(b.kind === "category", false, "a lead route carries a payload, not a string");
});

Deno.test("the surviving category vocabulary is one value wide", async () => {
  // `BoundCategory` is what stops the laundering growing back. A category
  // outside it must not type-check, so the union is asserted literally.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/chatBrainBinding.ts", import.meta.url));
  const m = SRC.match(/export type BoundCategory\s*=\s*([^;]+);/);
  assert(m, "BoundCategory must be declared");
  assertEquals(m![1].trim(), '"simple_chat"');
  // Comments stripped — the header names the removed value in order to record
  // why it was removed, and that is documentation, not a live category.
  const code = SRC.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(code.includes("qualified_lead_sourcing"),
    "the invalid category must not survive in executable code");
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
    assert(["reply", "category", "lead_route", "read", "monitor", "fallback"].includes(b.kind), kind);
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

Deno.test("pilot-chat routes; it no longer translates into a category", async () => {
  // This asserted first that a bound category replaced the classifier's verdict,
  // then that `simple_chat` was the one surviving translation. Both are gone:
  // `converse` has its own grounded surface, so nothing is expressed as a
  // legacy category at all, and there is no classifier verdict left to replace.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = SRC.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const end = SRC.indexOf("══ END OF THE CHAT BRAIN BLOCK", i);
  assert(i > 0 && end > i);
  const code = SRC.slice(i, end).split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

  assertFalse(/decision\.workflow_category\s*=[^=]/.test(code),
    "no route may be written back as a category");
  assert(code.includes('brainRoute.kind === "converse"'),
    "conversation is answered by its own surface");
  assert(code.includes("deferring to classifier") === false,
    "and there is no classifier left to defer to");
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
  // Ends where the monitor surface begins — the negative assertion below is
  // only meaningful while the window covers the read path and nothing else, and
  // a byte count expresses that far less reliably than the boundary itself.
  const monitorAt = SRC.indexOf('if (brainBinding.kind === "monitor")', i);
  assert(monitorAt > i, "the monitor surface must follow the read surface");
  const block = SRC.slice(i, monitorAt);
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
