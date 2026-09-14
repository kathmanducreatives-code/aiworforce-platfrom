// LEAD V2 — MODEL SPEND IS LEDGERED WHETHER THE RUN SUCCEEDS OR THROWS.
//
// The same-mission rerun of 4250f181 (task 9144eaa4) made two execution-planner
// calls — gpt-5.6-luna 26,827→364 tokens (~$0.0058), then the gpt-5.6-terra
// repair 26,930→404 (~$0.0587) — and threw `ExecutionPlanBlockedError`. The
// collector drained only on run-agent's success path, so neither call reached
// `lead_model_calls` and the daily spend ceiling never saw them.
//
// Pinned here against the REAL engine and the REAL ledger writer, over a fake
// database that enforces the table's unique index.

import { assert, assertAlmostEquals, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createLedgerWriter, ModelCallCollector, PendingModelDrain,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import { MODEL_COST_MODEL_VERSION, type ModelCallTelemetry } from
  "../../../supabase/functions/_shared/modelCostModel.ts";
import { authorizeModelSpend } from "../../../supabase/functions/_shared/modelSpendCeiling.ts";
import { runCapabilityPlan, type CapabilityEngineDeps } from
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const TASK = "9144eaa4-0000-4000-8000-000000000000";

/** `lead_execution_calls`, with `(workspace_id, logical_call_key, attempt_number)` unique. */
function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    from(_t: string) {
      return {
        insert(v: Record<string, unknown>) {
          const clash = rows.some((r) => r.workspace_id === v.workspace_id &&
            r.logical_call_key === v.logical_call_key && r.attempt_number === v.attempt_number);
          if (clash) return Promise.resolve({ error: { code: "23505", message: "duplicate key value" } });
          rows.push({ ...v });
          return Promise.resolve({ error: null });
        },
        update(p: Record<string, unknown>) {
          return {
            eq(_c: string, id: string) {
              const r = rows.find((x) => x.id === id);
              if (r) Object.assign(r, p);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  /** The `lead_model_calls` view, as the spend ceiling queries it. */
  const spendDb = {
    from(_t: string) {
      return {
        select(_c: string) {
          return {
            eq(_col: string, ws: unknown) {
              return {
                gte: () => Promise.resolve({
                  data: rows.filter((r) => r.record_kind === "model_call" && r.workspace_id === ws),
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  return { rows, db, spendDb, models: () => rows.filter((r) => r.record_kind === "model_call") };
}

function telemetry(role: string, model: string, input: number, output: number, usd: number): ModelCallTelemetry {
  return {
    version: MODEL_COST_MODEL_VERSION, role, model, reasoning_effort: "low",
    input_tokens: input, cached_input_tokens: 0, output_tokens: output,
    estimated_cost_usd: usd, actual_cost_usd: null, cost_source: "event_priced",
    latency_ms: 7000, fallback_reason: null,
  } as ModelCallTelemetry;
}
const LUNA = telemetry("execution_plan", "gpt-5.6-luna", 26827, 364, 0.005802);
const TERRA = telemetry("execution_plan_repair", "gpt-5.6-terra", 26930, 404, 0.058708);

/** Arms exactly as run-agent does; the caller flushes after the run settles. */
function armed(collector: ModelCallCollector, db: ReturnType<typeof fakeDb>["db"]) {
  const pending = new PendingModelDrain();
  pending.arm(collector, createLedgerWriter(db as never), () => ({
    workspace_id: WS, task_id: TASK, plan_id: null, logical_call_key: `${TASK}:model`,
  }));
  return pending;
}

Deno.test("planner call succeeds, the engine then throws — the call is ledgered exactly once", async () => {
  const f = fakeDb();
  const collector = new ModelCallCollector();
  const pending = armed(collector, f.db);
  const m = parseLeadMissionDeterministic(
    "Find 3 seed-stage B2B SaaS startups in the US hiring their first growth marketer.");
  let plannerCalls = 0;
  // The live failure, reproduced: the planner answers (and is billed) with an
  // empty plan, twice, and the engine refuses to run an empty chain.
  await assertRejects(() => runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    planExecution: () => {
      collector.sink(plannerCalls++ === 0 ? LUNA : TERRA, true);
      return Promise.resolve({ reasoning: "no authorised chain can prove this", steps: [] });
    },
    invoke: () => Promise.resolve([]),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as unknown as CapabilityEngineDeps as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 10,
    readEnv: () => undefined,
  } as never));
  assertEquals(plannerCalls, 2, "the plan and its repair both reached the model");
  assertEquals(f.models().length, 0, "nothing was written before the run settled — the old gap");

  assertEquals(await pending.flush(), 2);
  const rows = f.models();
  assertEquals(rows.length, 2);
  const byModel = Object.fromEntries(rows.map((r) => [(r.metadata as { model: string }).model, r]));
  const luna = byModel["gpt-5.6-luna"], terra = byModel["gpt-5.6-terra"];
  assertEquals(luna.provider_id, "openai");
  assertEquals(luna.status, "succeeded");
  assertEquals((luna.metadata as Record<string, unknown>).input_tokens, 26827);
  assertEquals((luna.metadata as Record<string, unknown>).output_tokens, 364);
  assertAlmostEquals(Number(luna.estimated_cost_usd), 0.005802, 1e-9);
  assertAlmostEquals(Number(terra.estimated_cost_usd), 0.058708, 1e-9);
  assertEquals(luna.task_id, TASK);

  // A second flush — a retry of the exit path — writes nothing.
  assertEquals(await pending.flush(), 0);
  assertEquals(f.models().length, 2, "exactly once");
});

Deno.test("the spend ceiling sees a failed run's model spend", async () => {
  const f = fakeDb();
  const collector = new ModelCallCollector();
  const pending = armed(collector, f.db);
  const failingRun = async () => {
    collector.sink(LUNA, true);
    collector.sink(TERRA, true);
    throw new Error("execution planning was blocked (no_valid_step)");
  };
  await failingRun().catch(() => "500");
  await pending.flush();
  const v = await authorizeModelSpend({
    db: f.spendDb as never, workspace_id: WS, mode: "enforce", ceiling_usd: 5, period_days: 1,
  });
  assertAlmostEquals(v.spent_usd, 0.06451, 1e-6);
  assertEquals(v.reason, "under_ceiling");
  const over = await authorizeModelSpend({
    db: f.spendDb as never, workspace_id: WS, mode: "enforce", ceiling_usd: 0.05, period_days: 1,
  });
  assertEquals(over.allowed, false, "a ceiling below the failed run's spend now refuses the next call");
});

Deno.test("success-path drain, then a later throw — no row written twice, later calls still ledgered", async () => {
  const f = fakeDb();
  const collector = new ModelCallCollector();
  const pending = armed(collector, f.db);
  collector.sink(LUNA, true);
  // run-agent's existing success-path drain…
  await collector.drain(createLedgerWriter(f.db as never),
    { workspace_id: WS, task_id: TASK, logical_call_key: `${TASK}:model` });
  // …then a later call in the SAME role (so a restarted sequence would reuse
  // `execution_plan:1`), then the run throws.
  collector.sink({ ...LUNA, estimated_cost_usd: 0.0061 }, true);
  await Promise.reject(new Error("late failure")).catch(() => null);
  await pending.flush();
  await pending.flush();
  const rows = f.models();
  assertEquals(rows.length, 2);
  assertEquals(new Set(rows.map((r) => r.logical_call_key)).size, 2, "the sequence continues; keys never reused");
  assert(rows.every((r) => r.attempt_number === 1), "no key collision needed escalating");
});

Deno.test("a resumed slice ledgers its own calls beside the first slice's, never re-writing them", async () => {
  const f = fakeDb();
  // Slice 1 and slice 2 of the same task: two processes, two collectors.
  const s1 = new ModelCallCollector();
  const p1 = armed(s1, f.db);
  s1.sink(LUNA, true); s1.sink(TERRA, true);
  await p1.flush();
  const s2 = new ModelCallCollector();
  const p2 = armed(s2, f.db);
  s2.sink(LUNA, true);
  await p2.flush();
  await p1.flush(); await p2.flush();
  assertEquals(f.models().length, 3, "three calls made, three rows — none twice");
});

Deno.test("run-agent arms the drain with the collector and flushes it on every exit", () => {
  const ra = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const declared = ra.indexOf("const pendingModelDrain = new PendingModelDrain();");
  const region = ra.indexOf("const guardedResponse = await terminalGuard.run(");
  const armedAt = ra.indexOf("pendingModelDrain.arm(\n          modelCalls,");
  const collectorAt = ra.indexOf("const modelCalls = new ModelCallCollector(resolveRunBudget());");
  const flushAt = ra.indexOf("await pendingModelDrain.flush();");
  const finalReturn = ra.indexOf('return guardedResponse ?? json({ error: "run_agent_no_response" }, 500);');
  assert(declared > 0 && declared < region, "declared outside the guarded region, so the catch path reaches it");
  assert(armedAt > collectorAt && armedAt - collectorAt < 200, "armed as soon as the collector exists");
  assert(flushAt > ra.indexOf('console.error("[run-agent][unhandled]"') && flushAt < finalReturn,
    "flushed after the run settles — success, failure or throw — before the response returns");
});
