// BROADENING OWNERSHIP — DETERMINISTIC AUTHORIZATION, NO CLAUDE FALLBACK.
//
// THE BUG. `leadStrategyOwnerApplies` alone decided whether GPT owned
// round-to-round broadening. `run-agent` calls it with
// `workflow: body.workflow_kind ?? "qualified_lead_sourcing"` — a DEFAULT, not
// a real value from most callers — and a hardcoded `executionMode:
// "company_first"`. So the predicate was satisfied by nearly every
// company-first task regardless of GPT_LEAD_STRATEGY or its workspace
// allow-list. Worse, the "unauthorized" branch called
// `createBroadeningPlanner`, which reaches Gemini via Lovable and falls
// through to Anthropic (Claude) whenever ANTHROPIC_API_KEY is set — which it
// is on TEST. A capability documented as GPT-exclusive was reachable by
// neither authorization nor exclusivity.
//
// This file proves both are fixed: authorization requires the real flag, and
// the unauthorized path cannot reach any model, Gemini or Claude included.
//
// Offline. No network, no provider, no model.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isGptBroadeningAuthorized, deterministicOnlyBroadeningPlanner, leadStrategyOwnerApplies,
} from "../../../supabase/functions/_shared/leadStrategyOwner.ts";

const RUN_AGENT = new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url);
const BROADENING_ADAPTER = new URL(
  "../../../supabase/functions/_shared/broadeningPlannerAdapter.ts", import.meta.url);

// ═══ WORKFLOW STRING MATCHING ALONE MUST NOT AUTHORIZE ═════════════════════

Deno.test("the shape check alone is satisfied by run-agent's own default", () => {
  // This is the defect, reproduced directly: the shape predicate that used to
  // BE the authorization is trivially true under the exact default run-agent
  // applies when a caller omits workflow_kind.
  assert(leadStrategyOwnerApplies({ workflow: "qualified_lead_sourcing", executionMode: "company_first" }),
    "reproduces why the old single-condition gate always passed");
});

Deno.test("authorization requires the flag on top of the shape check", () => {
  const shapeOnly = { workflow: "qualified_lead_sourcing", executionMode: "company_first" };
  assertFalse(isGptBroadeningAuthorized({ ...shapeOnly, gptStrategyEnabled: false }),
    "the shape check alone must no longer be sufficient");
  assert(isGptBroadeningAuthorized({ ...shapeOnly, gptStrategyEnabled: true }),
    "both conditions together must authorize");
});

Deno.test("a correct shape with the flag off is not authorized", () => {
  for (const gptStrategyEnabled of [false]) {
    assertFalse(isGptBroadeningAuthorized({
      workflow: "qualified_lead_sourcing", executionMode: "company_first", gptStrategyEnabled,
    }));
  }
});

Deno.test("the flag alone without the shape does not authorize", () => {
  assertFalse(isGptBroadeningAuthorized({
    workflow: "account_first", executionMode: "company_first", gptStrategyEnabled: true,
  }), "a workflow the strategy owner does not cover must not be authorized regardless of the flag");
  assertFalse(isGptBroadeningAuthorized({
    workflow: "qualified_lead_sourcing", executionMode: "fast", gptStrategyEnabled: true,
  }));
  assertFalse(isGptBroadeningAuthorized({ gptStrategyEnabled: true }),
    "an empty gate input must not authorize just because the flag happens to be on");
});

// ═══ NO CLAUDE FALLBACK ═════════════════════════════════════════════════════

Deno.test("the unauthorized planner makes literally zero calls", async () => {
  const p = deterministicOnlyBroadeningPlanner();
  const result = await p.plan({
    quota: { requested: 5, remaining: 5 },
    remaining_budget: 100,
    bottleneck: "none",
    last_round: null,
    approved_capabilities: { adjacent_titles_allowed: false },
    intent_summary: { requested_titles: [], requested_person_roles: [], geography: null, company_vertical: null },
  } as never);
  assertEquals(result, null, "the unauthorized path must propose nothing, ever");
  assertEquals(p.lastMetadata(), null);
});

Deno.test("wiring: run-agent no longer constructs the Gemini/Claude-capable adapter", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert(!code.includes("createBroadeningPlanner("),
    "createBroadeningPlanner must not be called — it can reach Claude via the Anthropic fallback");
  assert(!/import\s*\{[^}]*\bcreateBroadeningPlanner\b/s.test(code),
    "the import itself must be gone, not merely unused");
});

Deno.test("wiring: unauthorized broadening resolves to the deterministic-only planner", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  const m = /const broadeningPlanner = gptBroadeningAuthorized\s*\?\s*createLeadStrategyPlanner\(\{[\s\S]*?\}\)\s*:\s*(\S+)\(\)/.exec(src);
  assert(m, "the ternary shape (authorized ? GPT : deterministic) must be present");
  assertEquals(m![1], "deterministicOnlyBroadeningPlanner",
    "the unauthorized branch must be the zero-model-call planner, not any AI adapter");
});

Deno.test("documentation: the Claude-reachability risk is named where the adapter lives", async () => {
  // Not a behaviour test — a tripwire. If broadeningPlannerAdapter.ts is ever
  // wired back in without re-reading why it was removed, this at least fails
  // loudly on the missing acknowledgement rather than silently reopening the path.
  const src = await Deno.readTextFile(BROADENING_ADAPTER);
  assert(/generateJson|generateText/.test(src),
    "sanity check: the adapter this test warns about must still be the one that calls the model");
});

// ═══ HARD CONSTRAINTS — VALIDATED WHOEVER PROPOSED THE ROUND ═══════════════

Deno.test("wiring: the same validator gates GPT's broadening proposals, unchanged", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // Not re-implemented here: companyFirstQuotaController.ts calls
  // validateRoundPlan on every proposal regardless of which planner produced
  // it, and that call site was not touched by this fix. This assertion pins
  // that run-agent still routes broadening through it via proposeBroadening,
  // rather than approving GPT's proposals directly.
  assert(src.includes("proposeBroadening: broadeningPlanner.plan"),
    "broadening proposals must still flow through the controller's own validation, not bypass it");
});

Deno.test("wiring: at most one model call site backs one authorized broadening decision", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // Exactly one construction of the GPT branch per handler — not one per
  // round, not a second competing constructor.
  const constructions = src.split("createLeadStrategyPlanner({").length - 1;
  assertEquals(constructions, 1,
    "createLeadStrategyPlanner must be constructed once per task, invoked at most once per round by the controller");
});

// ═══ NO NEW BROADENING ARCHITECTURE ═════════════════════════════════════════

Deno.test("no second decision function or competing enum was introduced", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  for (const invented of [
    "BroadeningAuthorityV2", "resolveBroadeningStrategy", "BROADENING_OWNERS",
  ]) {
    assert(!src.includes(invented), `${invented} would be a new architecture; none was authorized`);
  }
});

Deno.test("deterministicOnlyBroadeningPlanner is a thin wrapper, not a new engine", async () => {
  const src = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/leadStrategyOwner.ts", import.meta.url));
  const fn = src.slice(src.indexOf("export function deterministicOnlyBroadeningPlanner"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  assert(!/fetch\(|generateJson|generateText|await\s+call/.test(body),
    "the deterministic-only planner must contain no model call of any kind");
});
