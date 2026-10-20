// T01: real transport/adapters/engine; only the external HTTP envelope is mocked.
// Run without --allow-net. The injected fetch is the only possible model send.
// deno-lint-ignore no-import-prefix
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gptStructured, type GptDeps } from "../../../supabase/functions/_shared/gptProvider.ts";
import { createGptMissionGenerateJson } from "../../../supabase/functions/_shared/gptMissionModel.ts";
import { buildMissionCompilerBinding } from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { makeGptDiscoveryPlanner } from "../../../supabase/functions/_shared/gptDiscoveryPlanner.ts";
import { makeGptExecutionPlanner } from "../../../supabase/functions/_shared/gptExecutionPlanner.ts";
import { createGptStrategistGenerateJson } from "../../../supabase/functions/_shared/gptStrategistModel.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { createLedgerWriter, ModelCallCollector, PendingModelDrain } from "../../../supabase/functions/_shared/executionLedger.ts";
import { authorizeModelSpend } from "../../../supabase/functions/_shared/modelSpendCeiling.ts";
import type { ModelCallTelemetry } from "../../../supabase/functions/_shared/modelCostModel.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const REQUEST = { purpose: "test", system: "Return JSON", user: "synthetic", maxTokens: 100 };
const BODY = JSON.stringify({ requested_opportunity_count: 5, actors: [], steps: [], reasoning: "synthetic" });
const BAD_FINISHES = ["length", "content_filter", "tool_calls", "function_call", "unknown", null, undefined];
function seam(finish: unknown, content: unknown = BODY, refusal?: string) {
  let calls = 0;
  const events: Array<{ t: ModelCallTelemetry; ok: boolean }> = [];
  const deps: GptDeps = {
    readEnv: (k) => k === "OPENAI_API_KEY" ? "sk-synthetic" : undefined,
    fetch: () => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ finish_reason: finish, message: { content, refusal } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } },
      })));
    },
    sleep: () => { throw new Error("completion failures must not retry"); },
    onModelCall: (t, ok) => events.push({ t, ok }),
  };
  return { deps, events, calls: () => calls };
}

for (const finish of ["stop", ...BAD_FINISHES]) {
  Deno.test(`completion: ${String(finish)} with parseable JSON`, async () => {
    const f = seam(finish);
    const r = await gptStructured(REQUEST, f.deps);
    assertEquals(r.ok, finish === "stop");
    if (!r.ok) {
      assertEquals(r.code, finish === "length" ? "incomplete_response" : "unexpected_completion");
      assertEquals([r.retryable, r.attempts], [false, 1]);
    }
    assertEquals(f.calls(), 1);
    assertEquals(f.events.length, 1);
    assertEquals(f.events[0].ok, r.ok);
    assertEquals([f.events[0].t.input_tokens, f.events[0].t.cached_input_tokens, f.events[0].t.output_tokens], [100, 10, 20]);
    assert((f.events[0].t.estimated_cost_usd ?? 0) > 0, "rejection cannot erase billed usage");
    assertEquals(f.events[0].t.fallback_reason, r.ok ? null : r.code);
  });
}

Deno.test("refusal, empty content and malformed JSON remain distinct and metered once", async () => {
  for (const [content, refusal, code] of [
    [null, "refused", "schema_refused"],
    [" ", undefined, "empty_response"],
    [null, undefined, "empty_response"],
    ["{", undefined, "unparseable_json"],
  ] as const) {
    const f = seam("stop", content, refusal);
    const r = await gptStructured(REQUEST, f.deps);
    assert(!r.ok);
    assertEquals(r.code, code);
    assertEquals([f.calls(), f.events.length, f.events[0].ok], [1, 1, false]);
  }
  const f = seam(undefined, null, "refused");
  const r = await gptStructured(REQUEST, f.deps);
  assert(!r.ok);
  assertEquals(r.code, "schema_refused", "refusal takes precedence over absent finish metadata");
});

Deno.test("an invalid API envelope remains malformed JSON and emits one failed receipt", async () => {
  const f = seam("stop");
  const r = await gptStructured(REQUEST, { ...f.deps, fetch: () => Promise.resolve(new Response("not JSON")) });
  assert(!r.ok);
  assertEquals(r.code, "unparseable_json");
  assertEquals([f.events.length, f.events[0].ok], [1, false]);
});

for (const finish of BAD_FINISHES) {
  Deno.test(`terminal ${String(finish)} survives compiler and strategist adapters`, async () => {
    const f = seam(finish);
    const binding = buildMissionCompilerBinding({
      workspaceId: "synthetic", generate: createGptMissionGenerateJson(f.deps),
    });
    assertEquals(await binding.proposeMission!({ originalUserQuery: "Find five companies" }), null);
    assertEquals(f.calls(), 1, "the compiler must not buy repair/escalation");
    const generate = createGptStrategistGenerateJson(f.deps);
    const r = await generate({ taskType: "helper", messages: [{ role: "user", content: "synthetic" }] });
    assert(!r.ok);
    assertEquals(r.errorCode, finish === "length" ? "incomplete_response" : "unexpected_completion");
    assertEquals(f.calls(), 2, "one attempt for each independent adapter invocation");
  });
}

for (const stage of ["discovery", "execution"] as const) {
  for (const finish of BAD_FINISHES) {
    Deno.test(`engine: ${stage} ${String(finish)} blocks without repair or provider work`, async () => {
      const f = seam(finish);
      const mission = parseLeadMissionDeterministic("Find 3 B2B SaaS startups in the US hiring salespeople");
      let providerCalls = 0;
      const discovery = makeGptDiscoveryPlanner(f.deps);
      const execution = makeGptExecutionPlanner(f.deps);
      await assertRejects(() => runCapabilityPlan({
        planDiscovery: stage === "discovery" ? discovery : stubDiscoverySelector(),
        planExecution: execution,
        invoke: () => { providerCalls++; return Promise.resolve([]); },
        verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
      }, { mission, plan: buildCapabilityGraph(mission), maxCandidates: 10, readEnv: () => undefined }));
      assertEquals(f.calls(), 1, "the engine must not buy a repair after terminal completion failure");
      assertEquals(providerCalls, 0);
      assertEquals(f.events.length, 1);
      assertEquals(f.events[0].ok, false);
    });
  }
}

Deno.test("truncation: failed usage flushes once and blocks the next slice at the spend ceiling", async () => {
  const rows: Record<string, unknown>[] = [];
  const db = { from: () => ({
    insert: (row: Record<string, unknown>) => {
      rows.push({ ...row }); return Promise.resolve({ error: null });
    },
    update: (patch: Record<string, unknown>) => ({ eq: (_col: string, id: unknown) => {
      Object.assign(rows.find((r) => r.id === id)!, patch);
      return Promise.resolve({ error: null });
    } }),
  }) };
  const collector = new ModelCallCollector();
  const pending = new PendingModelDrain();
  pending.arm(collector, createLedgerWriter(db as never), () => ({ workspace_id: "w", task_id: "t", logical_call_key: "t:model" }));
  const f = seam("length");
  const r = await gptStructured(REQUEST, { ...f.deps, onModelCall: collector.sink });
  assert(!r.ok);
  assertEquals(await pending.flush(), 1);
  assertEquals(await pending.flush(), 0, "a later failure/cancel flush must not double charge");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "failed");
  assertEquals(rows[0].failure_code, "incomplete_response");
  const charged = Number(rows[0].estimated_cost_usd);
  assert(charged > 0);
  const spendDb = { from: () => ({ select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: rows, error: null }) }) }) }) };
  const next = await authorizeModelSpend({ db: spendDb, workspace_id: "w", mode: "enforce", ceiling_usd: charged, period_days: 1 });
  assertEquals(next.allowed, false, "a fresh slice must see the failed completion's durable spend");
});
