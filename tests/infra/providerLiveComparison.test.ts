// The live provider comparison's cumulative budget: proven before any paid request.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ALLOCATION, allocationFits, type Call, remainingFits, runComparison, TOTAL } from "../../scripts/test-project/provider-live-comparison.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ZERO = { apifyUsd: 0, leadoceanRecords: 0 };

const WS = "40e2512f-09b6-433e-97fe-f9999a1f1897";
const stub = (o: { estimate?: (b: Record<string, unknown>) => { apifyUsd: number; leadoceanRecords: number }; spend?: (b: Record<string, unknown>) => { apifyUsd: number; leadoceanRecords: number } } = {}) => {
  const calls: Record<string, unknown>[] = [];
  const call: Call = (_fn, body) => {
    calls.push(body);
    if (body.action === "strategy_plan") {
      const est = o.estimate?.(body) ?? { apifyUsd: Number(body.max_apify_usd), leadoceanRecords: Number(body.max_leadocean_records) };
      return Promise.resolve({ status: 200, body: { plan: { status: "ready", estimate: est, planHash: `h-${body.strategy}` }, approval_token: "t" } });
    }
    const a = body.approval as { apify_usd: number; leadocean_records: number };
    return Promise.resolve({ status: 200, body: { status: "completed", spend: o.spend?.(body) ?? { apifyUsd: a.apify_usd, leadoceanRecords: a.leadocean_records }, providerSummary: {} } });
  };
  return { call, calls };
};

Deno.test("allocation: the three slices together never exceed the approved cumulative cap", () => {
  assert(allocationFits());
  assertEquals(ALLOCATION.reduce((s, x) => s + x.apifyUsd, 0) <= TOTAL.apifyUsd + 1e-9, true);
  assertEquals(ALLOCATION.reduce((s, x) => s + x.leadoceanRecords, 0) <= TOTAL.leadoceanRecords, true);
  assertEquals(allocationFits([...ALLOCATION, { ...ALLOCATION[0], apifyUsd: 0.01 }]), false, "one cent more is refused");
});

Deno.test("every request carries its slice explicitly (never the server's larger default) and the approval is the slice", async () => {
  const { call, calls } = stub();
  const r = await runComparison(call, WS, { dryRun: false, prior: ZERO });
  for (const b of calls) { assert("max_apify_usd" in b && "max_leadocean_records" in b, JSON.stringify(b)); }
  for (const b of calls.filter((x) => x.action === "strategy_run")) {
    const s = ALLOCATION.find((x) => x.strategy === b.strategy)!;
    assertEquals(b.approval, { plan_hash: `h-${b.strategy}`, apify_usd: s.apifyUsd, leadocean_records: s.leadoceanRecords, token: "t" });
  }
  assert(r.spent.apifyUsd <= TOTAL.apifyUsd + 1e-9 && r.spent.leadoceanRecords <= TOTAL.leadoceanRecords, JSON.stringify(r.spent));
  assertEquals(calls.filter((x) => "phone_lookups" in x || "enrich" in x).length, 0, "no enrichment can be requested");
});

Deno.test("a plan whose worst case exceeds its slice is never run", async () => {
  const { call, calls } = stub({ estimate: (b) => ({ apifyUsd: Number(b.max_apify_usd) + 0.01, leadoceanRecords: Number(b.max_leadocean_records) }) });
  const r = await runComparison(call, WS, { dryRun: false, prior: ZERO });
  assertEquals(calls.filter((x) => x.action === "strategy_run").length, 0);
  assert(r.outcomes.every((o) => o.skipped?.includes("exceeds the slice")));
  assert(r.stopped?.includes("nothing was bought"));
});

Deno.test("a run reporting spend above its slice stops the comparison: no later mode runs", async () => {
  const { call, calls } = stub({ spend: (b) => b.strategy === "apify_only" ? { apifyUsd: 0.2, leadoceanRecords: 0 } : { apifyUsd: 0, leadoceanRecords: 0 } });
  const r = await runComparison(call, WS, { dryRun: false, prior: ZERO });
  assertEquals(calls.filter((x) => x.action === "strategy_run").map((x) => x.strategy), ["apify_only"]);
  assert(r.stopped?.includes("above its slice"));
  assert(r.outcomes.slice(1).every((o) => o.skipped === r.stopped));
});

Deno.test("dry run: plans only, nothing paid is requested", async () => {
  const { call, calls } = stub();
  await runComparison(call, WS, { dryRun: true });
  assertEquals(calls.filter((x) => x.action === "strategy_run").length, 0);
});

Deno.test("the allocation cannot be widened at run time, and an over-cap allocation never fits", () => {
  assert(Object.isFrozen(ALLOCATION));
  assertEquals(allocationFits([{ ...ALLOCATION[0], apifyUsd: 0.5 }, ...ALLOCATION.slice(1)]), false);
  assertEquals(allocationFits([...ALLOCATION.slice(0, 2), { ...ALLOCATION[2], leadoceanRecords: 16 }]), false);
  assertEquals(allocationFits([{ ...ALLOCATION[0], apifyUsd: -1 }, ...ALLOCATION.slice(1)]), false);
});

Deno.test("one shot across invocations: unknown or existing prior spend refuses a live run before any request", async () => {
  for (const prior of [null, undefined, { apifyUsd: 0.01, leadoceanRecords: 0 }, { apifyUsd: 0, leadoceanRecords: 1 }, { apifyUsd: Number.NaN, leadoceanRecords: 0 }]) {
    const { call, calls } = stub();
    await assertRejects(() => runComparison(call, WS, { dryRun: false, prior: prior as never }), Error, "nothing was requested");
    assertEquals(calls.length, 0, JSON.stringify(prior));
  }
  assertEquals(remainingFits(ZERO), { ok: true });
  // A dry run needs no ledger reading: it buys nothing.
  const { call } = stub();
  await runComparison(call, WS, { dryRun: true });
});

Deno.test("all three plans must be ready before anything is bought (no half-spent comparison)", async () => {
  const calls: Record<string, unknown>[] = [];
  const call: Call = (_fn, body) => {
    calls.push(body);
    if (body.strategy === "leadocean_only") return Promise.resolve({ status: 409, body: { status: "blocked", plan: { status: "blocked", blockedReason: "leadocean disabled (feature flag off)", estimate: ZERO, planHash: "h" } } });
    return Promise.resolve({ status: 200, body: { plan: { status: "ready", estimate: { apifyUsd: 0.01, leadoceanRecords: 0 }, planHash: `h-${body.strategy}` }, approval_token: "t" } });
  };
  const r = await runComparison(call, WS, { dryRun: false, prior: ZERO });
  assertEquals(calls.filter((x) => x.action === "strategy_run").length, 0);
  assert(r.stopped?.includes("leadocean disabled (feature flag off)") && r.stopped.includes("nothing was bought"), r.stopped ?? "");
  assertEquals(r.spent, ZERO);
});

Deno.test("a run without a readable spend (error, timeout, 5xx) stops the comparison: spend is unknown", async () => {
  const calls: Record<string, unknown>[] = [];
  const call: Call = (_fn, body) => {
    calls.push(body);
    if (body.action === "strategy_plan") return Promise.resolve({ status: 200, body: { plan: { status: "ready", estimate: ZERO, planHash: `h-${body.strategy}` }, approval_token: "t" } });
    return Promise.resolve({ status: 546, body: {} });
  };
  const r = await runComparison(call, WS, { dryRun: false, prior: ZERO });
  assertEquals(calls.filter((x) => x.action === "strategy_run").map((x) => x.strategy), ["apify_only"]);
  assert(r.stopped?.includes("spend unknown"), r.stopped ?? "");
});

Deno.test("the live path is closed unless AGENTORY_PROVIDER_LIVE_TESTS=enabled (the repository-wide gate)", async () => {
  const src = await Deno.readTextFile(new URL("../../scripts/test-project/provider-live-comparison.ts", import.meta.url));
  assert(src.includes('import { assertLiveTestsEnabled } from "../_liveTestGate.ts"'));
  assert(/if \(!dryRun\) assertLiveTestsEnabled\(\);/.test(src));
});
