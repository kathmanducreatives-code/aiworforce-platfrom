// FEATURE OFF MEANS PHASE 2 IS NOT THERE.
//
// Not "Phase 2 ran and decided to do nothing" — not there. No planner call, no
// environment resolution, no mission, no capability selection, no strategy hash,
// no latency measurement, and NO diagnostics key in the task result.
//
// The last one is the subtle one. A `{ status: "disabled" }` record would add a
// Phase 2 key to every task result of every workspace that never opted in, which
// changes the stored task shape, the run context the Workbench reads back on
// reload, and anything exporting either. The ABSENCE of the block is the signal.
//
// ZERO live model calls, ZERO provider calls, ZERO database access.

import { assert, assertEquals, assertFalse, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyClaudeFirstLeadPlanning, bridgeDiagnostics, isClaudeFirstLeadPlanningEnabled,
  CLAUDE_FIRST_WORKSPACES_ENV, type JobSearchSpecSlice,
} from "../../functions/_shared/leadPlanningBridge.ts";
import { CANONICAL_PROJECT_REFS } from "../../functions/runtimeEnvironment.ts";
import type { GenerateJsonFn } from "../../functions/plannerWrapper.ts";

const PRIMARY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const WS = "ws-test-1";

const TEST_URL = `https://${CANONICAL_PROJECT_REFS.test}.supabase.co`;
const PROD_URL = `https://${CANONICAL_PROJECT_REFS.production}.supabase.co`;

function spec(): JobSearchSpecSlice {
  return {
    keyword_queries: ["Sales Operations", "Revenue Operations"],
    requested_person_roles: ["Founder", "Co-Founder", "CEO"],
    location: "United States",
    country: "US",
    company_vertical: "b2b_saas",
    original_query: PRIMARY,
  };
}

const reader = (vars: Record<string, string | undefined>) => (k: string) => vars[k];

/** A planner that fails the test if it is ever reached. */
function forbiddenPlanner(): { generate: GenerateJsonFn; calls: () => number } {
  let calls = 0;
  return {
    generate: async () => {
      calls++;
      throw new Error("the planner must never be invoked while disabled");
    },
    calls: () => calls,
  };
}

/** Every way Phase 2 can be off. */
const DISABLED_ENVS: Array<[string, Record<string, string | undefined>]> = [
  ["nothing configured", {}],
  ["only the TEST project url", { SUPABASE_URL: TEST_URL }],
  ["flag on, no allow-list", { SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "true" }],
  ["flag on, empty allow-list", { SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: "" }],
  ["flag on, other workspace", { SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: "ws-other" }],
  ["allow-listed but flag off", { SUPABASE_URL: TEST_URL, [CLAUDE_FIRST_WORKSPACES_ENV]: WS }],
  ["allow-listed but flag typo", { SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "yes", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }],
];

// ============================================================ the true no-op ===

Deno.test("OFF1 nothing is done, and the spec comes back by reference", async () => {
  for (const [name, vars] of DISABLED_ENVS) {
    const original = spec();
    const planner = forbiddenPlanner();

    const r = await applyClaudeFirstLeadPlanning({
      workspaceId: WS, originalInstruction: PRIMARY, spec: original,
      missionId: "m", generate: planner.generate, readEnv: reader(vars),
    });

    assertEquals(planner.calls(), 0, `${name}: the planner was invoked`);
    assertStrictEquals(r.spec, original, `${name}: the spec was not returned by reference`);
    assertEquals(r.specRewritten, false, name);
    assertEquals(r.outcome, null, `${name}: planning work was performed`);
    assertEquals(r.mission, null, `${name}: a mission was constructed`);
    assertEquals(r.environment, null, `${name}: the environment was resolved unnecessarily`);
    assertEquals(bridgeDiagnostics(r), null, `${name}: a diagnostics block was emitted`);
  }
});

Deno.test("OFF2 the returned spec is deeply equal to the untouched deterministic spec", async () => {
  const fixture = spec();                       // what main produces, unchanged
  for (const [name, vars] of DISABLED_ENVS) {
    const original = spec();
    const r = await applyClaudeFirstLeadPlanning({
      workspaceId: WS, originalInstruction: PRIMARY, spec: original,
      missionId: "m", readEnv: reader(vars),
    });
    assertEquals(r.spec, fixture, `${name}: provider compilation input changed`);
    assertEquals(Object.keys(r.spec).sort(), Object.keys(fixture).sort(), `${name}: key set changed`);
  }
});

// ================================ the task result, assembled the way run-agent does ===

/** Mirrors the run-agent result assembly, so the key's absence is observable. */
function taskResult(diagnostics: Record<string, unknown> | null) {
  const runContext = { requested: 5, entity: "contact_ready_lead", quota: "contact_only" };
  const intent = { target_entity: "company_and_person", output_type: "qualified_lead" };
  return {
    qualified_lead_run_context: runContext,
    ...(diagnostics ? { claude_first_planning: diagnostics } : {}),
    lead_entity_intent: intent,
    routing: { target_entity: intent.target_entity, execution_mode: "company_first", company_first: true },
  };
}

Deno.test("OFF3 the task result is deeply equal to the pre-Phase-2 shape", async () => {
  const prePhase2 = taskResult(null);

  for (const [name, vars] of DISABLED_ENVS) {
    const r = await applyClaudeFirstLeadPlanning({
      workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
      missionId: "m", readEnv: reader(vars),
    });
    const actual = taskResult(bridgeDiagnostics(r));

    assertEquals(actual, prePhase2, `${name}: the task result changed`);
    assertEquals(Object.keys(actual), Object.keys(prePhase2), `${name}: key ORDER or set changed`);
    assertFalse("claude_first_planning" in actual, `${name}: a Phase 2 key leaked into the result`);
    assertFalse(
      JSON.stringify(actual).includes("claude_first"),
      `${name}: a Phase 2 marker leaked into the serialised result`,
    );
    // The run context and executor selection are untouched.
    assertEquals(actual.qualified_lead_run_context, prePhase2.qualified_lead_run_context, name);
    assertEquals(actual.routing, prePhase2.routing, name);
  }
});

Deno.test("OFF4 no planner diagnostic field is exportable when disabled", async () => {
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
    missionId: "m", readEnv: reader({ SUPABASE_URL: TEST_URL }),
  });
  const serialised = JSON.stringify(taskResult(bridgeDiagnostics(r)));
  for (const column of [
    "planner_source", "planner_status", "planner_version", "strategy_hash", "plan_hash",
    "input_hash", "output_hash", "latency_ms", "selected_capabilities", "approved_titles",
    "rejected_titles", "approval_required", "fallback_reason", "enablement_reason", "model",
  ]) {
    assertFalse(serialised.includes(column), `disabled run exported ${column}`);
  }
});

// ======================================== an ELIGIBLE workspace still reports ====

Deno.test("OFF5 diagnostics DO appear once a workspace genuinely opts in", async () => {
  // The absence must mean "not enabled", not "we stopped reporting".
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
    missionId: "m",
    generate: async () => ({ ok: false, content: "", provider: "none", model: "", errorCode: "boom", latencyMs: 1 }),
    readEnv: reader({
      SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS,
    }),
  });
  const d = bridgeDiagnostics(r);
  assert(d, "an eligible workspace must produce diagnostics");
  assertEquals(d.claude_first_enabled, true);
  assertEquals(d.planner_source, "deterministic_registry");
  assert("claude_first_planning" in taskResult(d));
});

Deno.test("OFF6 an eligible workspace in an UNRESOLVABLE environment falls back and says why", async () => {
  const planner = forbiddenPlanner();
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
    missionId: "m", generate: planner.generate,
    readEnv: reader({
      // A well-formed ref (Supabase refs are lowercase alphanumeric) that is
      // simply not one of ours — a third project must never be planned for.
      SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS,
    }),
  });
  assertEquals(planner.calls(), 0, "an unresolved environment must not reach the model");
  assertEquals(r.specRewritten, false);
  assertEquals(r.mission, null, "no mission is built for an environment we cannot identify");
  const d = bridgeDiagnostics(r)!;
  assertEquals(d.planner_source, "deterministic_registry");
  assertEquals(d.fallback_reason, "environment_unresolved:unrecognised_project_ref");
  assertFalse(JSON.stringify(d).includes(CANONICAL_PROJECT_REFS.production), "a project ref leaked");
  assertFalse(JSON.stringify(d).includes(CANONICAL_PROJECT_REFS.test), "a project ref leaked");
});

// ================================================ TEST / production isolation ====

Deno.test("OFF7 allow-listing a workspace in TEST does not enable it in production", () => {
  // Secrets are per-project: the operator configured the TEST project only, so the
  // production runtime simply does not see these variables.
  const testProject = reader({
    SUPABASE_URL: TEST_URL, CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS,
  });
  const productionProject = reader({ SUPABASE_URL: PROD_URL });

  assertEquals(isClaudeFirstLeadPlanningEnabled(WS, testProject).enabled, true);
  assertEquals(isClaudeFirstLeadPlanningEnabled(WS, productionProject).enabled, false);
});

Deno.test("OFF8 production cannot be activated by ONE variable", () => {
  const prod = (vars: Record<string, string | undefined>) =>
    isClaudeFirstLeadPlanningEnabled(WS, reader({ SUPABASE_URL: PROD_URL, ...vars }));

  assertEquals(prod({ CLAUDE_FIRST_LEAD_PLANNING: "true" }).enabled, false, "the flag alone");
  assertEquals(prod({ [CLAUDE_FIRST_WORKSPACES_ENV]: WS }).enabled, false, "the allow-list alone");
  assertEquals(prod({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: "*" }).enabled, false, "no wildcard");
  // Both, deliberately, is the only combination that works — and it is a deliberate act.
  assertEquals(prod({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }).enabled, true);
});

// ============================================ run-agent must keep the key optional ==

Deno.test("OFF9 run-agent adds the diagnostics key CONDITIONALLY", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../run-agent/index.ts", import.meta.url),
  );
  assert(
    /\.\.\.\(\s*claudeFirstDiagnostics\s*\?\s*\{\s*claude_first_planning:/.test(src),
    "run-agent must spread the Phase 2 key only when diagnostics exist",
  );
  assertFalse(
    /^\s*claude_first_planning:\s*bridgeDiagnostics\(/m.test(src),
    "run-agent must not add the key unconditionally",
  );
  assertFalse(
    /environment:\s*"(test|production|development)"/.test(src),
    "run-agent must not hardcode an environment",
  );
});
