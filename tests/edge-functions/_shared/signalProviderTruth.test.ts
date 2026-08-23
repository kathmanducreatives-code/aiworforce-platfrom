// A PROVIDER REFUSAL AND AN EMPTY MARKET ARE DIFFERENT ANSWERS.
//
// ── WHAT HAPPENED ───────────────────────────────────────────────────────────
//
//     if (!res.ok) { console.warn("firecrawl search non-200", res.status); return []; }
//
// On 2026-08-23 Firecrawl returned 429 to ALL NINETY searches of one scan.
// Every one became `[]`. Every source reported `raw_count: 0` with no error.
// The scan returned HTTP 200. `signals` had held zero rows since the feature
// was built, and the reason was invisible in the response, the diagnostics and
// the UI — so the natural conclusion was "no results match this ICP", and the
// hunt would have gone to the scorer, the queries and the Brain. All of which
// were fine: the Brain compiled at `strong` confidence with zero warnings.
//
// The second time this exact shape has cost a day. The first was OpenAI
// answering 429 `insufficient_quota` and the code reporting `no_result`.
//
// ZERO network, ZERO providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runFirecrawlSource, type FirecrawlSearchResult,
} from "../../../supabase/functions/_shared/radarSourceExecution.ts";
import {
  resolveScanBudget, ScanBudgetTracker, MAX_SEARCHES_PER_SCAN,
} from "../../../supabase/functions/_shared/signalScanBudget.ts";
import { priceFor } from "../../../supabase/functions/_shared/creditPricing.ts";

const ok = (n: number): FirecrawlSearchResult => ({
  hits: Array.from({ length: n }, (_, i) => ({ url: `https://e.com/${i}`, title: `t${i}` })),
  error: null,
});
const refused = (e: string): FirecrawlSearchResult => ({ hits: [], error: e });

// deno-lint-ignore no-explicit-any
const plan = (o: Record<string, unknown> = {}): any => ({
  source: "competitor", enabled: true, reason: "test",
  queries: ["a", "b"], negative_terms: [], required_proof: [], cap: 5,
  // THE REAL SHAPE. The first draft invented `stages: [[...]]`; the planner
  // emits `staged_queries: { exact, synonym, adjacent }` and the executor reads
  // those three by name.
  staged_queries: { exact: ["a"], synonym: ["b"], adjacent: [] }, ...o,
});
// deno-lint-ignore no-explicit-any
const run = (search: any, p = plan()) => runFirecrawlSource({
  plan: p, wanted: 5, search, scanPlanReason: "test", setupRequired: false,
});

// ═══ 1. THE REFUSAL SURVIVES ═══════════════════════════════════════════════

Deno.test("1. A REFUSED SOURCE IS NOT A `ready` SOURCE WITH ZERO HITS", () => {
  return run(() => Promise.resolve(refused("http_429"))).then((r) => {
    assertEquals(r.found, 0);
    assertEquals(r.provider_error, "http_429", "the status reaches the caller");
    assert(r.provider_failures > 0);
    assertEquals(r.status, "skipped",
      "reporting `ready` with found:0 is exactly what made 90 refusals look " +
      "like a market with nothing in it");
    assert(/refused every request/i.test(r.reason ?? ""), r.reason);
  });
});

Deno.test("2. an honestly empty search stays `ready` with NO error", () => {
  return run(() => Promise.resolve(ok(0))).then((r) => {
    assertEquals(r.found, 0);
    assertEquals(r.provider_error, null, "nothing refused us — the market is quiet");
    assertEquals(r.provider_failures, 0);
    assertEquals(r.status, "ready");
  });
});

Deno.test("3. THE FIRST failure is kept, not the last", () => {
  // Ninety identical 429s are one fact. Overwriting with the last would report
  // the same string while implying the earlier ones succeeded.
  let n = 0;
  return run(() => Promise.resolve(refused(n++ === 0 ? "http_429" : "http_500"))).then((r) => {
    assertEquals(r.provider_error, "http_429");
    assertEquals(r.provider_failures, 2, "and every failure is counted");
  });
});

Deno.test("4. partial success is still success", () => {
  // One stage refused, one returned hits. The source ran and found something;
  // marking it `skipped` would discard real results over a transient failure.
  let n = 0;
  return run(() => Promise.resolve(n++ === 0 ? refused("http_429") : ok(3))).then((r) => {
    assertEquals(r.found, 3);
    assertEquals(r.status, "ready");
    assertEquals(r.provider_error, "http_429", "…and the failure is still reported");
  });
});

Deno.test("5. a missing key is a REASON, not an empty result", () => {
  return run(() => Promise.resolve(refused("not_configured"))).then((r) => {
    assertEquals(r.provider_error, "not_configured");
    assertEquals(r.status, "skipped");
  });
});

// ═══ 2. THE SCAN CANNOT SPEND WITHOUT A CEILING ════════════════════════════

Deno.test("6. the ceiling is the smaller of balance and the per-scan cap", () => {
  assertEquals(
    resolveScanBudget({ balance: 1000, pricePerSearch: 1 }),
    { ceiling: MAX_SEARCHES_PER_SCAN, limited_by: "scan_cap" },
    "a funded workspace must not lose its balance to one runaway fan-out",
  );
  assertEquals(
    resolveScanBudget({ balance: 7, pricePerSearch: 1 }),
    { ceiling: 7, limited_by: "workspace_balance" },
  );
  assertEquals(
    resolveScanBudget({ balance: 0, pricePerSearch: 1 }).ceiling, 0,
    "no balance buys no searches",
  );
});

Deno.test("7. A FREE SEARCH IS STILL CAPPED", () => {
  // If the price drops to zero the balance stops constraining anything, and the
  // per-scan ceiling becomes the only thing between one click and an unbounded
  // fan-out.
  const b = resolveScanBudget({ balance: 0, pricePerSearch: 0 });
  assertEquals(b.ceiling, MAX_SEARCHES_PER_SCAN);
  assertEquals(b.limited_by, "scan_cap");
});

Deno.test("8. the cap is BELOW the fan-out that exposed this", () => {
  // The scan that revealed the unmetered path made 90 provider searches from
  // one click. A cap at or above that would not have contained it.
  assert(MAX_SEARCHES_PER_SCAN < 90,
    `cap ${MAX_SEARCHES_PER_SCAN} must be below the observed 90-call fan-out`);
});

Deno.test("9. the tracker stops at the ceiling and says so", () => {
  const t = new ScanBudgetTracker({ ceiling: 2, limited_by: "scan_cap" });
  assert(t.take()); assert(t.take());
  assert(!t.take(), "the third is refused");
  assertEquals(t.spend.used, 2, "and a refused take costs nothing");
  assert(t.spend.exhausted);
});

Deno.test("10. a zero ceiling authorizes nothing at all", () => {
  const t = new ScanBudgetTracker({ ceiling: 0, limited_by: "workspace_balance" });
  assert(!t.take());
  assertEquals(t.spend.used, 0);
});

// ═══ 3. THE BOUNDARY IS IN THE RIGHT ORDER ═════════════════════════════════

const SCAN = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-radar-scan/index.ts", import.meta.url));
const code = SCAN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

Deno.test("11. budget is checked BEFORE the reserve", () => {
  // A scan at its ceiling must not reserve a credit it will not use.
  const take = code.indexOf("tracker.take()");
  const auth = code.indexOf("authorizeProviderCall({");
  assert(take !== -1 && auth !== -1);
  assert(take < auth, "the free check comes first");
});

Deno.test("12. the reserve happens BEFORE the provider call", () => {
  const auth = code.indexOf("authorizeProviderCall({");
  const call = code.indexOf("firecrawlSearchRaw(query, limit)");
  assert(auth !== -1 && call !== -1);
  assert(auth < call, "no provider work before authorization");
});

Deno.test("13. every search settles, including on a throw", () => {
  assert(/finally\s*\{[\s\S]{0,200}settleProviderCall/.test(code),
    "settle must run in a `finally` — a throw that skipped it would leak the " +
    "reservation until the stale-release reaper found it");
});

Deno.test("14. a refused reserve returns without calling the provider", () => {
  const at = code.indexOf("if (!auth.allowed)");
  assert(at !== -1);
  const block = code.slice(at, code.indexOf("let started", at));
  assert(block.includes("CREDIT_REFUSED_ERROR"), "reported with its own code");
  assert(block.includes("return"), "and it returns before any provider work");
  assert(!block.includes("firecrawlSearchRaw"), "nothing is executed inside it");
});

Deno.test("15. the idempotency key is per QUERY, not per scan", () => {
  // Per-scan would reserve once for a fan-out of ninety.
  assert(/signal_scan:\$\{scan_run_id\}:\$\{query\}/.test(code),
    "a replayed scan must reserve nothing further, and each query is its own call");
});

Deno.test("16. searches are priced per search", () => {
  assertEquals(priceFor("signal_search"), 1);
  assert(code.includes('priceFor("signal_search")'),
    "the amount reserved comes from the shared table, not a literal");
});

Deno.test("17. the response says WHICH zero it is", () => {
  for (const field of ["credit_spend", "refused:", "price_per_search", "tracker.spend"]) {
    assert(code.includes(field), `the response must carry ${field}`);
  }
  // `limited_by`, `used`, `ceiling` and `exhausted` arrive via `...tracker.spend`
  // rather than being restated here — one source for the shape, so the response
  // cannot drift from what the tracker actually counted.
});
