// V5 PHASE C — asynchronous Apify runs, recorded run ids, real receipts, at-most-once purchase.
// Offline: a fake Apify API (scripts/dev/atlas-sim/fakeApifyAsync.ts) on a virtual clock, and
// receipt documents recorded from this account's own TEST runs (tests/fixtures/apify-runs/).

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { ACTOR_BUILDS } from "../../../../supabase/functions/_shared/leadPipeline/actorBuilds.ts";
import { ApifyRefusal, PIPELINE_ACTORS, usdToUnits } from "../../../../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";
import {
  abortRun, apifyHttpTransport, asyncLedgeredInvoker, memoryRunLedger, RunFailed, RunPending, spendBasis,
} from "../../../../supabase/functions/_shared/leadPipeline/apifyRuns.ts";
import { worstCaseUsd } from "../../../../supabase/functions/_shared/leadPipeline/signals.ts";
import { fakeApify, type FakeApifyOptions } from "../../../../scripts/dev/atlas-sim/fakeApifyAsync.ts";

const RECORDED = JSON.parse(Deno.readTextFileSync(new URL("../../../fixtures/apify-runs/recorded-receipts.json", import.meta.url)));
const BUILDS = Object.fromEntries(Object.values(ACTOR_BUILDS).map((b) => [b.actorId, b.build]));
const JOBS = "apify_linkedin_job_search";
const RECORD = "apify_linkedin_company_details";
const SEARCH = "apify_linkedin_company_search";
const jobInput = { jobTitles: ["Sales"], locations: ["United States"], maxItems: 10, functionIds: ["sale"] };
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, companyName: `Co ${i}` }));
const worst = (actor: string, n: number) => worstCaseUsd({ key: actor, ...PIPELINE_ACTORS[actor] }, n);

function rig(o: FakeApifyOptions = {}, deadlineMs = 90_000) {
  const api = fakeApify({ builds: BUILDS, ...o });
  const base = memoryLedger();
  const ledger = memoryRunLedger(base);
  const transport = apifyHttpTransport({ token: "test-token", fetch: api.fetch as never });
  const make = () => asyncLedgeredInvoker(transport, ledger, { workspaceId: "ws", missionId: "m:apify", maxUsd: 1 }, { deadlineMs, now: api.now, sleep: api.sleep });
  return { api, base, ledger, transport, make };
}

Deno.test("start → poll → items → receipt: the run is bound to the reviewed build and its charge is settled from Apify's own figure", async () => {
  const { api, base, make } = rig({ plan: () => ({ durationS: 30, items: items(10), pricing: { "apify-actor-start": 0.001, "job": 0.001 }, counts: { "apify-actor-start": 1, "job": 10 } }) });
  const inv = make();
  const run = await inv(JOBS, jobInput, { maxItems: 10, idempotencyKey: "ms:w:hash:jobs" });
  assertEquals(run.items.length, 10);
  assertEquals(run.chargedUsd, 0.011);
  const s = api.starts[0];
  assertEquals([s.query.build, s.query.waitForFinish, s.query.maxItems, s.authHeader], ["0.0.62", "0", "10", true]);
  assertEquals(Number(s.query.maxTotalChargeUsd), worst(JOBS, 10));
  assert(!("restartOnError" in s.query), "restartOnError is never sent (Apify default: false)");
  assertEquals(s.input, jobInput, "the exact input is sent");
  assertEquals(inv.charges.map((c) => [c.state, c.usd, c.runId]), [["settled", 0.011, "run1"]]);
  const e = [...base.entries.values()][0];
  assertEquals([e.state, e.actual], ["settled", usdToUnits(0.011)]);
});

Deno.test("recorded receipt: a 1-record company read settles at $0.00405 (1 × $0.004 + $0.00005 start)", async () => {
  const r = RECORDED.company_record_one.run;
  const prices = Object.fromEntries(Object.entries(r.pricingInfo.pricingPerEvent.actorChargeEvents).map(([k, v]) => [k, (v as { eventPriceUsd: number }).eventPriceUsd]));
  const { make } = rig({ plan: () => ({ durationS: 18, items: items(1), pricing: prices, counts: r.chargedEventCounts, usageUsd: r.usageTotalUsd }) });
  const inv = make();
  const run = await inv(RECORD, { companies: ["https://www.linkedin.com/company/x"] }, { maxItems: 1, idempotencyKey: "k-rec" });
  assertEquals(run.chargedUsd, 0.00405);
  assertEquals(inv.charges[0].state, "settled");
});

Deno.test("recorded receipt: an EMPTY company search still bills its start ($0.001) — reported, never $0", async () => {
  const r = RECORDED.company_search_empty.run;
  const prices = Object.fromEntries(Object.entries(r.pricingInfo.pricingPerEvent.actorChargeEvents).map(([k, v]) => [k, (v as { eventPriceUsd: number }).eventPriceUsd]));
  const { make } = rig({ plan: () => ({ durationS: 10, items: [], pricing: prices, counts: r.chargedEventCounts, usageUsd: r.usageTotalUsd }) });
  const inv = make();
  const run = await inv(SEARCH, { scraperMode: "short", maxItems: 25, industryIds: ["4"] }, { maxItems: 25, idempotencyKey: "k-search" });
  assertEquals([run.items.length, run.chargedUsd, inv.charges[0].state], [0, 0.001, "settled"]);
});

Deno.test("a run that outlives the request is RunPending with its id RECORDED; the next request ADOPTS it — one purchase", async () => {
  const { api, make, ledger } = rig({ plan: () => ({ durationS: 200, items: items(5) }) }, 70_000);
  const first = make();
  const e = await assertRejects(() => first(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-long" }), RunPending);
  assertEquals([e.runId, e.status], ["run1", "RUNNING"]);
  assertEquals((await ledger.recordedRun("k-long"))?.runId, "run1", "the run id is durable before the first poll");
  assertEquals(first.charges[0].state, "reserved");
  // a fresh request (new process): adopts, never starts again
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-long" }), RunPending);
  const third = make();
  const run = await third(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-long" });
  assertEquals([run.items.length, run.runId], [5, "run1"]);
  assertEquals(api.purchases(), 1);
  // and once settled, a repeat replays the stored items at $0
  const again = await make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-long" });
  assertEquals([again.items.length, again.chargedUsd, api.purchases()], [5, 0, 1]);
});

Deno.test("adoption refuses a run that was started with a different input (the plan changed)", async () => {
  const { make } = rig({ plan: () => ({ durationS: 200 }) }, 30_000);
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-x" }), RunPending);
  await assertRejects(() => make()(JOBS, { ...jobInput, locations: ["Canada"] }, { maxItems: 10, idempotencyKey: "k-x" }), ApifyRefusal, "different input");
});

Deno.test("connection dropped AFTER Apify created the run: unknown charge, worst case kept, NEVER started again", async () => {
  const { api, base, make } = rig({ dropStartResponse: () => true, plan: () => ({ items: items(3) }) });
  const inv = make();
  const e = await assertRejects(() => inv(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-drop" }));
  assertEquals((e as Error).name, "StartUnknown");
  assertEquals(inv.charges[0].state, "unknown");
  assertEquals([...base.entries.values()][0].state, "uncertain");
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k-drop" }), ApifyRefusal, "charge_uncertain");
  assertEquals(api.purchases(), 1);
  assertEquals(await base.spent("ws", "m:apify"), usdToUnits(worst(JOBS, 10)), "the worst case stays counted");
});

Deno.test("a 5xx on start is unknown (may have started); a 4xx is definite (nothing bought, reservation released)", async () => {
  const a = rig({ startStatus: () => 502 });
  await assertRejects(() => a.make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k5" }));
  assertEquals([...a.base.entries.values()][0].state, "uncertain");
  const b = rig({ startStatus: () => 400 });
  await assertRejects(() => b.make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "k4" }), ApifyRefusal, "refused the start (400)");
  assertEquals([...b.base.entries.values()][0].state, "released");
  assertEquals(await b.base.spent("ws", "m:apify"), 0);
});

Deno.test("a build Apify no longer has fails CLOSED: 404 on start, nothing bought, no silent upgrade", async () => {
  const { api, base, make } = rig({ builds: { ...BUILDS, "harvestapi/linkedin-job-search": "0.0.99" } });
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kb" }), ApifyRefusal, "404");
  assertEquals([api.purchases(), [...base.entries.values()][0].state], [0, "released"]);
});

Deno.test("an input field the reviewed build's schema does not have is refused BEFORE anything is reserved or started", async () => {
  const { api, base, make } = rig();
  await assertRejects(() => make()(JOBS, { ...jobInput, jobTitle: ["typo"] }, { maxItems: 10, idempotencyKey: "ks" }), ApifyRefusal, "jobTitle");
  assertEquals([api.starts.length, base.entries.size], [0, 0]);
});

Deno.test("status reads that fail are retried within the deadline; an UNREADABLE receipt is 'unknown' at the worst case", async () => {
  let i = 0;
  const { make, base } = rig({ pollFailRate: 0.5, rand: () => (i++ % 2 ? 0.9 : 0.1), plan: () => ({ durationS: 40, items: items(4), receiptUnreadable: true }) });
  const inv = make();
  const run = await inv(JOBS, jobInput, { maxItems: 10, idempotencyKey: "ku" });
  assertEquals(run.items.length, 4);
  assertEquals([inv.charges[0].state, run.chargedUsd], ["unknown", worst(JOBS, 10)]);
  assertEquals([...base.entries.values()][0].actual, usdToUnits(worst(JOBS, 10)), "the worst case stays counted");
});

Deno.test("a run whose status cannot be read at all stays PENDING (never assumed finished); its id is kept for adoption", async () => {
  const { make, ledger } = rig({ plan: () => ({ durationS: 10, items: items(2), statusUnreadable: true }) }, 30_000);
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kz" }), RunPending);
  assertEquals((await ledger.recordedRun("kz"))?.runId, "run1");
});

Deno.test("charges posted late: a receipt that changes between reads is provider_reported, not settled, and the later figure is kept", async () => {
  const { make } = rig({ plan: () => ({ durationS: 20, items: items(6), lateS: 30, lateUsd: 0.001 }) }, 20_000 + 40_000);
  const inv = make();
  const run = await inv(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kl" });
  // settle wait (10 s) falls inside the late window (30 s): the two reads both say $0.001
  assert(["provider_reported", "settled"].includes(inv.charges[0].state));
  assert(run.chargedUsd !== null);
  const b = rig({ plan: () => ({ durationS: 20, items: items(6), lateS: 5, lateUsd: 0.001 }) });
  const inv2 = b.make();
  const run2 = await inv2(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kl2" });
  assertEquals(inv2.charges[0].state, "provider_reported", "first read $0.001, later read $0.011: not stable, not settled");
  assertEquals(run2.chargedUsd, 0.011, "the later figure, capped by maxTotalChargeUsd as Apify caps it");
});

Deno.test("a FAILED run is final: its receipt is still read and counted, and it is never re-run", async () => {
  const { api, make } = rig({ plan: () => ({ durationS: 15, terminal: "FAILED", items: [], usageUsd: 0.001 }) });
  const e = await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kf" }), RunFailed);
  assertEquals([e.status, e.chargedUsd], ["FAILED", 0.001]);
  const replay = await make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kf" });
  assertEquals([replay.items.length, replay.chargedUsd, api.purchases()], [0, 0, 1]);
});

Deno.test("two requests at once for the same step: ONE start; the other waits (STARTING) or adopts", async () => {
  const { api, make } = rig({ plan: () => ({ durationS: 5, items: items(2) }) });
  const [a, b] = await Promise.allSettled([make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kc" }), make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kc" })]);
  assertEquals(api.purchases(), 1);
  assert([a, b].some((x) => x.status === "fulfilled"));
  for (const x of [a, b]) if (x.status === "rejected") assert(x.reason instanceof RunPending, String(x.reason));
});

Deno.test("abort: a recorded run can be aborted (cancelled mission); its receipt is still read on adoption", async () => {
  const { api, ledger, transport, make } = rig({ plan: () => ({ durationS: 500, items: items(3) }) }, 20_000);
  await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "ka" }), RunPending);
  assertEquals(await abortRun(transport, ledger, "ka"), { aborted: true, runId: "run1" });
  const e = await assertRejects(() => make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: "ka" }), RunFailed);
  assertEquals([e.status, api.purchases()], ["ABORTED", 1]);
});

Deno.test("spend basis: provider_reported only when every paid run was read; otherwise estimate, with the states counted", () => {
  const c = (state: "settled" | "unknown" | "provider_reported", status = "SUCCEEDED") => ({ actorKey: JOBS, key: "k", runId: "r", state, usd: 0.01, reservedUsd: 0.02, build: "0.0.62", status });
  assertEquals(spendBasis([c("settled"), c("provider_reported")]).basis, "provider_reported");
  assertEquals(spendBasis([c("settled"), c("unknown")]), { basis: "estimate", states: { settled: 1, unknown: 1 } });
  assertEquals(spendBasis([]).basis, "estimate");
});

Deno.test("1,000 randomized interruptions: never two purchases for one step, never more than the worst case", async () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let pending = 0, adopted = 0, unknown = 0;
  for (let t = 0; t < 1000; t++) {
    const drop = rnd() < 0.1, s5 = rnd() < 0.05, failed = rnd() < 0.1, unreadable = rnd() < 0.1;
    const { api, base, make } = rig({
      dropStartResponse: () => drop, startStatus: () => (s5 ? 503 : null), pollFailRate: rnd() * 0.4, rand: rnd,
      plan: () => ({ durationS: Math.floor(rnd() * 400), terminal: failed ? "FAILED" : "SUCCEEDED", items: items(Math.floor(rnd() * 10)), receiptUnreadable: unreadable, statusUnreadable: rnd() < 0.05, lateS: rnd() < 0.3 ? 20 : 0 }),
    }, 5_000 + Math.floor(rnd() * 120_000));
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt++) {
      try { await make()(JOBS, jobInput, { maxItems: 10, idempotencyKey: `k${t}` }); done = true; if (attempt) adopted++; }
      catch (e) {
        if (e instanceof RunPending) { pending++; api.advance(Math.floor(rnd() * 120_000)); continue; }
        if ((e as Error).name === "StartUnknown") unknown++;
        done = true;
      }
    }
    assert(api.purchases() <= 1, `trial ${t}: ${api.purchases()} purchases`);
    assert(await base.spent("ws", "m:apify") <= usdToUnits(worst(JOBS, 10)), `trial ${t}: spent above the worst case`);
  }
  assert(pending > 0 && adopted > 0 && unknown > 0, `the trials exercised pending (${pending}), adoption (${adopted}) and unknown starts (${unknown})`);
});

Deno.test("a provider_reported figure is confirmed on the next request (a free re-read), never charged again", async () => {
  // late charges: the first request's two reads disagree ($0.001 then $0.011) → provider_reported
  const { api, base, make } = rig({ plan: () => ({ durationS: 20, items: items(6), lateS: 5, lateUsd: 0.001 }) });
  const first = make();
  await first(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kr" });
  assertEquals(first.charges[0].state, "provider_reported");
  api.advance(60_000);
  const second = make();
  const again = await second(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kr" });
  assertEquals([again.chargedUsd, second.charges[0].state, api.purchases()], [0, "settled", 1]);
  const e = [...base.entries.values()][0] as { actual: number; result: { charge: { state: string; usd: number } } };
  assertEquals([e.actual, e.result.charge.state, e.result.charge.usd], [usdToUnits(0.011), "settled", 0.011]);
});

Deno.test("an UNKNOWN receipt is read again on the next request and becomes provider_reported when readable", async () => {
  const { base, make, api } = rig({ plan: () => ({ durationS: 10, items: items(2), receiptUnreadable: true }) });
  const first = make();
  await first(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kq" });
  assertEquals(first.charges[0].state, "unknown");
  api.runs.get("run1")!.plan.receiptUnreadable = false; api.advance(30_000);
  const second = make();
  await second(JOBS, jobInput, { maxItems: 10, idempotencyKey: "kq" });
  assertEquals(second.charges[0].state, "provider_reported", "one read is not yet confirmation");
  const e = [...base.entries.values()][0] as { actual: number };
  assertEquals(e.actual, usdToUnits(0.005), "the ledger moves from the worst case to Apify's figure");
});
