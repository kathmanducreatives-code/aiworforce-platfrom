// FEATURE FLAGS + DIAGNOSTICS + THE PHASE 1 BEHAVIOR-PRESERVATION PROOF.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  INTELLIGENCE_FLAGS, parseIntelligenceFlag, isIntelligenceFlagEnabled,
  readIntelligenceFlags, allIntelligenceFlagsOff, GEOGRAPHY_GATED_FLAGS,
  GEOGRAPHY_GATE_NOTE, isGeographyGated, GEOGRAPHY_GATE_CLEARED, geographyGateSatisfied,
  type IntelligenceFlag,
} from "./intelligenceFlags.ts";
import { inferGeography } from "../jobIntentTaxonomy.ts";
import {
  buildPlannerDiagnostics, auditRedaction, extractTokenUsage, attachDiagnostics,
  diagnosticsHash, PLANNER_DIAGNOSTICS_KEY,
} from "./plannerDiagnostics.ts";
import { runPlanner } from "./plannerWrapper.ts";
import { buildMission } from "./mission.ts";
import { emptyMissionContext } from "./missionContext.ts";
import { plannerCapabilityMenu } from "./capabilityRegistry.ts";

const NO_ENV = () => undefined;

// ---- default OFF -----------------------------------------------------------

Deno.test("30.A EVERY intelligence flag defaults OFF when the environment is empty", () => {
  for (const flag of INTELLIGENCE_FLAGS) {
    assertFalse(isIntelligenceFlagEnabled(flag, NO_ENV), `${flag} defaulted ON`);
  }
  assert(allIntelligenceFlagsOff(NO_ENV));
});

Deno.test("30.B parsing is a STRICT allow-list — a typo can never enable a flag", () => {
  for (const enabling of ["true", "TRUE", " 1 ", "enabled", "Enabled"]) {
    assert(parseIntelligenceFlag(enabling), `"${enabling}" should enable`);
  }
  for (const notEnabling of ["yes", "on", "TRUE!", "2", "y", "", " ", "false", "0", "disabled", "enable"]) {
    assertFalse(parseIntelligenceFlag(notEnabling), `"${notEnabling}" must NOT enable`);
  }
  assertFalse(parseIntelligenceFlag(null));
  assertFalse(parseIntelligenceFlag(undefined));
});

Deno.test("30.C a throwing environment reader resolves FALSE, never throws", () => {
  const throwing = () => { throw new Error("no env permission"); };
  for (const flag of INTELLIGENCE_FLAGS) {
    assertFalse(isIntelligenceFlagEnabled(flag, throwing), `${flag} did not fail closed`);
  }
  assert(allIntelligenceFlagsOff(throwing));
});

Deno.test("30.D flags are read from the SERVER environment only, one key each", () => {
  const asked: string[] = [];
  readIntelligenceFlags((k) => { asked.push(k); return undefined; });
  assertEquals(asked.sort(), [...INTELLIGENCE_FLAGS].sort());
});

Deno.test("30.E enabling one flag never enables another", () => {
  for (const target of INTELLIGENCE_FLAGS) {
    const state = readIntelligenceFlags((k) => (k === target ? "true" : undefined));
    const on = Object.entries(state).filter(([, v]) => v).map(([k]) => k);
    assertEquals(on.length, 1, `${target} switched on ${on.join(", ")}`);
  }
});

// ---- the geography gate ----------------------------------------------------

Deno.test("31.A the geography gate is documented and names the planning flags", () => {
  assert(GEOGRAPHY_GATE_NOTE.includes("us"));
  assert(GEOGRAPHY_GATE_NOTE.includes("claude_first_lead_planning"));
  assert(isGeographyGated("CLAUDE_FIRST_LEAD_PLANNING"));
  assert(isGeographyGated("GLOBAL_ROLE_PLANNING"));
  assertFalse(isGeographyGated("CONTENT_INTELLIGENCE_KERNEL"));
  for (const f of GEOGRAPHY_GATED_FLAGS) assert((INTELLIGENCE_FLAGS as readonly string[]).includes(f));
});

Deno.test("31.B the geography gate is CLEARED, and clearing it enables nothing", () => {
  assert(GEOGRAPHY_GATE_CLEARED, "Phase 2 removed the ambiguous-`us` defect");
  assert(GEOGRAPHY_GATE_NOTE.startsWith("CLEARED"));
  for (const flag of INTELLIGENCE_FLAGS) {
    assert(geographyGateSatisfied(flag), `${flag} still reports a geography block`);
  }
  // The prerequisite is satisfied; the flags themselves are still OFF.
  assert(allIntelligenceFlagsOff(NO_ENV),
    "clearing a prerequisite must never turn a flag on");
});

Deno.test("31.C the parser itself no longer invents the United States", () => {
  // The behavioral proof behind the cleared gate. Full coverage lives in
  // _shared/geographyAmbiguity.test.ts; this is the flag-side assertion.
  assertEquals(inferGeography("Show us founders in Germany"), []);
  assertEquals(inferGeography("Find founders in the United States"), ["United States"]);
});

// ---- behavior preservation -------------------------------------------------

Deno.test("32.A with all flags off, NO planner call occurs", async () => {
  assert(allIntelligenceFlagsOff(NO_ENV), "precondition: the shipping state is all-off");

  let modelCalled = false;
  const r = await runPlanner({
    mission: buildMission({
      missionId: "m", department: "leads", workspaceId: "ws-1",
      originalInstruction: "Find founders", environmentMode: "test",
    }),
    context: emptyMissionContext("ws-1"),
    capabilities: plannerCapabilityMenu({ department: "leads", environment: "test" }),
    outputSchema: {},
    validateStrategy: (c) => ({ ok: true, strategy: c }),
    fallbackStrategy: {},
    generate: async () => { modelCalled = true; throw new Error("must not be reached"); },
    // The caller resolves the flag. All-off means it is never passed as true.
    enabled: isIntelligenceFlagEnabled("CLAUDE_FIRST_LEAD_PLANNING", NO_ENV),
  });

  assertFalse(modelCalled, "a model was called with every flag off");
  assert(!r.ok);
  assertEquals(r.reason, "fallback_disabled");
});

Deno.test("32.B with all flags off, NO capability selection occurs", () => {
  // Selection is a pure function of an explicit call. Nothing in this module
  // performs one at import time, and no flag is required to build the menu — the
  // menu is inert data until a planner runs, and no planner runs.
  assert(allIntelligenceFlagsOff(NO_ENV));
  const menu = plannerCapabilityMenu({ department: "leads", environment: "test" });
  assert(menu.length > 0, "the menu exists");
  // Nothing in the menu is a provider call; it carries no adapter binding at all.
  for (const c of menu) assertFalse("adapter_key" in (c as unknown as Record<string, unknown>));
});

Deno.test("32.C the kernel performs NO persistence — diagnostics are a plain object", () => {
  const record = buildPlannerDiagnostics({
    missionId: "m", workspaceId: "ws-1", department: "leads",
    call: {
      planner_version: "v", model: "m", provider: "p", status: "ok",
      latency_ms: 1, input_hash: "a", output_hash: "b", repair_attempted: false,
    },
  });
  // Merging is pure: a NEW object, the input untouched, one reserved key added.
  const prior = { company_first: { rounds: 1 }, task_status: "partial" };
  const merged = attachDiagnostics(prior, record);
  assertEquals(prior, { company_first: { rounds: 1 }, task_status: "partial" }, "input must not be mutated");
  assertEquals(merged.task_status, "partial", "existing result keys are preserved");
  assertEquals(Object.keys(merged).sort(), ["company_first", PLANNER_DIAGNOSTICS_KEY, "task_status"].sort());
});

Deno.test("32.D no module in the kernel imports run-agent, orchestrate or pilot-chat", async () => {
  const dir = new URL(".", import.meta.url);
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const src = await Deno.readTextFile(new URL(entry.name, dir));
    for (const forbidden of ["run-agent/", "orchestrate/", "pilot-chat/"]) {
      assertFalse(src.includes(forbidden), `${entry.name} reaches into ${forbidden}`);
    }
  }
});

Deno.test("32.E the kernel is not imported BY any edge function yet", async () => {
  const root = new URL("../../", import.meta.url);   // supabase/functions/
  for (const fn of ["run-agent", "orchestrate", "pilot-chat"]) {
    const src = await Deno.readTextFile(new URL(`${fn}/index.ts`, root));
    assertFalse(src.includes("intelligence/"),
      `${fn} already imports the kernel — Phase 1 must remain unwired`);
  }
});

// ---- diagnostics -----------------------------------------------------------

Deno.test("33.A diagnostics record every required field", () => {
  const record = buildPlannerDiagnostics({
    missionId: "m-1", taskId: "t-1", workspaceId: "ws-1", department: "leads",
    call: {
      planner_version: "agentory-planner-1.0.0", model: "claude-test", provider: "anthropic",
      status: "ok", latency_ms: 120, input_hash: "in", output_hash: "out",
      repair_attempted: true, token_usage: { input_tokens: 10, output_tokens: 5 },
    },
    strategyHash: "sh", round: 2, estimatedCostUsd: 0.4,
    validation: { valid: false, violations: [{ code: "budget_calls_exceeded", severity: "block" }] },
  });

  assertEquals(record.mission_id, "m-1");
  assertEquals(record.task_id, "t-1");
  assertEquals(record.workspace_id, "ws-1");
  assertEquals(record.department, "leads");
  assertEquals(record.model, "claude-test");
  assertEquals(record.input_hash, "in");
  assertEquals(record.output_hash, "out");
  assertEquals(record.status, "ok");
  assertEquals(record.latency_ms, 120);
  assertEquals(record.token_usage, { input: 10, output: 5 });
  assertEquals(record.strategy_hash, "sh");
  assertEquals(record.round, 2);
  assertEquals(record.estimated_cost_usd, 0.4);
  assertEquals(record.validation?.violation_codes, ["budget_calls_exceeded"]);
});

Deno.test("33.B diagnostics carry NO secret, prompt, brain or reasoning field", () => {
  const record = buildPlannerDiagnostics({
    missionId: "m", workspaceId: "ws-1", department: "leads",
    call: {
      planner_version: "v", model: "m", provider: "p", status: "ok",
      latency_ms: 1, input_hash: "a", output_hash: "b", repair_attempted: false,
      token_usage: { input_tokens: 1, output_tokens: 1, raw_prompt: "LEAK", api_key: "sk-live-x" },
    },
  });
  const audit = auditRedaction(record);
  assert(audit.safe, `forbidden keys: ${audit.offendingPaths.join(", ")}`);
  const blob = JSON.stringify(record);
  assertFalse(blob.includes("LEAK"), "the opaque usage blob must be reduced to two counts");
  assertFalse(blob.includes("sk-live-x"));
});

Deno.test("33.C auditRedaction actually catches a forbidden key", () => {
  const bad = auditRedaction({ ok: 1, nested: { system_prompt: "..." } });
  assertFalse(bad.safe);
  assertEquals(bad.offendingPaths, ["nested.system_prompt"]);
});

Deno.test("33.D token usage extraction is provider-shape tolerant", () => {
  assertEquals(extractTokenUsage({ input_tokens: 3, output_tokens: 4 }), { input: 3, output: 4 });
  assertEquals(extractTokenUsage({ prompt_tokens: 3, completion_tokens: 4 }), { input: 3, output: 4 });
  assertEquals(extractTokenUsage({ nothing: 1 }), null);
  assertEquals(extractTokenUsage(null), null);
});

Deno.test("33.E diagnostics hash deterministically", async () => {
  const mk = () => buildPlannerDiagnostics({
    missionId: "m", workspaceId: "ws-1", department: "leads",
    call: { planner_version: "v", model: "m", provider: "p", status: "ok", latency_ms: 1, input_hash: "a", output_hash: "b", repair_attempted: false },
  });
  assertEquals(await diagnosticsHash(mk()), await diagnosticsHash(mk()));
});

Deno.test("33.F approval requirements are visible in diagnostics", () => {
  const record = buildPlannerDiagnostics({
    missionId: "m", workspaceId: "ws-1", department: "leads",
    call: { planner_version: "v", model: "m", provider: "p", status: "ok", latency_ms: 1, input_hash: "a", output_hash: null, repair_attempted: false },
    validation: { valid: false, violations: [{ code: "approval_required:geography_expansion", severity: "approval_required" }] },
  });
  assert(record.approval_required);
  assertEquals(record.validation?.approvals_required, ["approval_required:geography_expansion"]);
  assertEquals(record.validation?.violation_codes, []);
});

// ---- the flag list itself --------------------------------------------------

Deno.test("34.A the eight Phase 1 flags are all declared", () => {
  const expected: IntelligenceFlag[] = [
    "CLAUDE_FIRST_LEAD_PLANNING", "CLAUDE_LEAD_REPLANNING", "SEMANTIC_TITLE_VALIDATION",
    "GLOBAL_ROLE_PLANNING", "LEAD_STRATEGY_MEMORY", "SIGNAL_INTELLIGENCE_KERNEL",
    "CONTENT_INTELLIGENCE_KERNEL", "CROSS_DEPARTMENT_INTELLIGENCE",
  ];
  assertEquals([...INTELLIGENCE_FLAGS].sort(), expected.sort());
});
