// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { envelope, modelFixture, task } from "../_helpers/pilotModelFixture.ts";
import { runPilotModelProbe } from "../../../supabase/functions/_shared/pilot/pilotModelAdapter.ts";
for (
  const kind of [
    "admission-failure",
    "settlement-failure",
    "attempt-cap",
    "model-cap",
    "provider-cap",
    "combined-cap",
  ] as const
) {
  Deno.test(`P4 accounting admission/settlement fails closed: ${kind}`, async () => {
    const f = await modelFixture();
    if (kind === "admission-failure") f.accounting.reserveFail = true;
    if (kind === "settlement-failure") f.accounting.settleFail = true;
    if (kind === "attempt-cap") f.accounting.runtimeAttempts = 4;
    if (kind === "model-cap") f.accounting.modelSpent = .05;
    if (kind === "provider-cap") f.accounting.providerSpent = .201;
    if (kind === "combined-cap") {
      f.accounting.modelSpent = .049;
      f.accounting.providerSpent = .20;
    }
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, kind === "settlement-failure" ? 1 : 0);
    assertEquals(f.accounting.reserveCalls, 1);
    if (kind === "settlement-failure") {
      assertEquals(f.accounting.started.size, 1);
      assertEquals(f.accounting.receipts.size, 0);
      f.accounting.settleFail = false;
      await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
      assertEquals(f.calls.length, 1);
    }
  });
}
Deno.test("P4 concurrent calls and resumed fresh adapter cannot reset consumed task attempt", async () => {
  const f = await modelFixture();
  const r = await Promise.allSettled([
    runPilotModelProbe(f.scope, f.deps),
    runPilotModelProbe(f.scope, f.deps),
  ]);
  assertEquals(r.filter((x) => x.status === "fulfilled").length, 1);
  assertEquals(f.calls.length, 1);
  assertEquals(f.accounting.receipts.size, 1);
  await assertRejects(() => runPilotModelProbe(f.scope, { ...f.deps }));
  assertEquals(f.calls.length, 1);
  assertEquals(f.accounting.runtimeAttempts, 1);
});
Deno.test("P4 usage priced exactly once; existing raw-transport telemetry is not double-written", async () => {
  const f = await modelFixture();
  const r = await runPilotModelProbe(f.scope, f.deps);
  assertEquals(r.receipt.usage, {
    input_tokens: 100,
    cached_input_tokens: 20,
    output_tokens: 10,
  });
  assertEquals(r.receipt.estimated_cost_usd, .00005);
  assertEquals(r.receipt.actual_cost_usd, null);
  assertEquals(r.receipt.cost_source, "event_priced");
  assertEquals(f.accounting.receipts.size, 1);
  assert(Math.abs(f.accounting.modelSpent - .00005) < 1e-10);
});
for (
  const kind of [
    "missing-output",
    "negative",
    "fractional",
    "cached-too-large",
    "unknown-model",
    "excess-input",
    "excess-output",
    "excess-cost",
  ] as const
) {
  Deno.test(`P4 missing/invalid/excess usage never silently free: ${kind}`, async () => {
    const f = await modelFixture();
    const usage: Record<string, unknown> = {
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 20 },
    };
    if (kind === "missing-output") delete usage.completion_tokens;
    if (kind === "negative") usage.prompt_tokens = -1;
    if (kind === "fractional") usage.prompt_tokens = 1.5;
    if (kind === "cached-too-large") {
      usage.prompt_tokens_details = { cached_tokens: 101 };
    }
    if (kind === "excess-input") usage.prompt_tokens = 10000;
    if (kind === "excess-output") usage.completion_tokens = 1000;
    if (kind === "excess-cost") usage.completion_tokens = 100000;
    f.response(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            envelope({
              ...kind === "unknown-model" ? { model: "unknown" } : {},
              usage,
            }),
          ),
          { headers: { "x-request-id": "req-test" } },
        ),
      )
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    const r = [...f.accounting.receipts.values()][0];
    assertEquals(r.status, "failed");
    assertEquals(f.calls.length, 1);
    assertEquals(r.actual_cost_usd, null);
    if (!kind.startsWith("excess")) {
      assertEquals(r.estimated_cost_usd, null);
      assertEquals(r.accounting_uncertain, true);
      assert(f.accounting.modelSpent > 0);
    }
  });
}
for (
  const kind of [
    "revocation",
    "task-change",
    "policy-change",
    "cancelled",
  ] as const
) {
  Deno.test(`P4 paid result withheld after ${kind}; receipt remains accounted`, async () => {
    const f = await modelFixture();
    const abort = new AbortController();
    f.deps.signal = abort.signal;
    f.response(() => {
      if (kind === "revocation") f.n.tables.workspace_members = [];
      if (kind === "task-change") {
        (task(f.p1).payload as Record<string, unknown>).changed = true;
      }
      if (kind === "policy-change") f.policy.version++;
      if (kind === "cancelled") abort.abort();
      return Promise.resolve(
        new Response(JSON.stringify(envelope()), {
          headers: { "x-request-id": "req-test" },
        }),
      );
    });
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 1);
    assertEquals(f.accounting.receipts.size, 1);
    assertEquals(f.accounting.runtimeAttempts, 1);
  });
}
for (
  const kind of [
    "observe",
    "missing-configuration",
    "past-workspace-spend",
    "unpriced-workspace-spend",
    "insufficient-workspace-headroom",
  ] as const
) {
  Deno.test(`P4 real existing workspace spending guard remains authoritative: ${kind}`, async () => {
    const f = await modelFixture();
    if (kind === "observe") f.settings.MODEL_SPEND_ENFORCEMENT = "observe";
    if (kind === "missing-configuration") {
      delete f.settings.MODEL_SPEND_CEILING_USD;
    }
    if (
      kind === "past-workspace-spend" ||
      kind === "insufficient-workspace-headroom"
    ) {
      f.n.tables.lead_model_calls.push({
        workspace_id: f.scope.workspace_id,
        started_at: new Date().toISOString(),
        cost_source: "event_priced",
        actual_cost_usd: null,
        estimated_cost_usd: kind === "past-workspace-spend" ? .05 : .049,
      });
    }
    if (kind === "unpriced-workspace-spend") {
      f.n.tables.lead_model_calls.push({
        workspace_id: f.scope.workspace_id,
        started_at: new Date().toISOString(),
        cost_source: "unknown",
        estimated_cost_usd: null,
        actual_cost_usd: null,
      });
    }
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 0);
    assertEquals(f.accounting.started.size, 0);
  });
}
Deno.test("P4 cancellation after reservation but before wire dispatch leaves one held, undispatched receipt", async () => {
  const f = await modelFixture(), abort = new AbortController();
  f.deps.signal = abort.signal;
  const reserve = f.accounting.reserve.bind(f.accounting);
  f.accounting.reserve = async (a) => {
    const r = await reserve(a);
    abort.abort();
    return r;
  };
  await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
  assertEquals(f.calls.length, 0);
  assertEquals(f.accounting.started.size, 1);
  const r = [...f.accounting.receipts.values()][0];
  assertEquals(r.transport_dispatched, false);
  assertEquals(r.actual_provider, null);
  assertEquals(r.accounting_uncertain, true);
  assert(f.accounting.modelSpent > 0);
});
