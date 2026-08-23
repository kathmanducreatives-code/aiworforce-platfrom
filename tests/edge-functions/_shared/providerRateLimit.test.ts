// THE SCAN WAS RATE-LIMITING ITSELF.
//
// ── MEASURED, NOT SUSPECTED ─────────────────────────────────────────────────
//
// The 2026-08-23 scan produced 21 × HTTP 429 in 3.4 seconds — 6.2 requests per
// second, roughly 371/minute, against a provider whose free tier allows ~10/min
// and whose Hobby tier allows ~100. Three categories ran under `Promise.all`,
// each firing its queries in a bare loop with no spacing.
//
// It looked exactly like an exhausted account. It was not: the same burst would
// have hit any key, and a fresh key with credit produced the identical result.
//
// ZERO network. The clock and the sleep are injected.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ProviderRateLimiter, DEFAULT_PROVIDER_RPM,
  parseRetryAfterMs, classifyRateLimitBody,
} from "../../../supabase/functions/_shared/providerRateLimit.ts";

/** A controllable clock: `sleep` advances time instead of waiting. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => { t += ms; return Promise.resolve(); },
    advance: (ms: number) => { t += ms; },
    get time() { return t; },
  };
}

// ═══ 1. THE GATE SPACES REQUESTS ═══════════════════════════════════════════

Deno.test("1. requests are spaced by the configured interval", async () => {
  const c = fakeClock();
  const l = new ProviderRateLimiter(100, c);
  await l.acquire();                       // immediate
  assertEquals(c.time, 0);
  await l.acquire();
  assertEquals(c.time, 100, "the second waits one interval");
  await l.acquire();
  assertEquals(c.time, 200);
});

Deno.test("2. CONCURRENT CALLERS QUEUE — each claims its own slot", async () => {
  // The bug that turns a rate limiter into a delay that changes nothing: every
  // caller reads the same `nextFreeAt`, sleeps the same amount, then fires
  // simultaneously anyway. The slot must be claimed BEFORE the wait.
  //
  // ASSERTED ON THE WAITS REQUESTED, not on observed time. The first version of
  // this test used a fake clock whose `sleep` advanced a shared counter, which
  // models concurrent waits SERIALLY — real timers elapse in parallel. It was
  // measuring the fake clock, not the limiter.
  const waits: number[] = [];
  const l = new ProviderRateLimiter(100, {
    now: () => 0,
    sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  await Promise.all([l.acquire(), l.acquire(), l.acquire()]);
  assertEquals(waits, [100, 200],
    "the first goes immediately; each subsequent caller waits one more " +
    "interval, which is only true if the slot is taken before the sleep");
});

Deno.test("3. rpm converts to an interval, and a bad rpm falls back", () => {
  assertEquals(ProviderRateLimiter.fromRpm(60).minIntervalMs, 1000);
  assertEquals(ProviderRateLimiter.fromRpm(10).minIntervalMs, 6000, "free tier");
  for (const bad of [0, -5, NaN]) {
    assertEquals(
      ProviderRateLimiter.fromRpm(bad).minIntervalMs,
      Math.ceil(60_000 / DEFAULT_PROVIDER_RPM),
      "a nonsense rate must not become an unbounded one",
    );
  }
});

Deno.test("4. THE OBSERVED BURST IS NOW IMPOSSIBLE", () => {
  // 6.2 req/sec was the measured rate. At the default the gate cannot exceed
  // its configured rpm however many callers pile in.
  const l = ProviderRateLimiter.fromRpm(DEFAULT_PROVIDER_RPM);
  const perSecond = 1000 / l.minIntervalMs;
  assert(perSecond <= 1.01, `gate allows ${perSecond}/sec; the burst was 6.2/sec`);
});

// ═══ 2. BACK-OFF APPLIES TO THE ACCOUNT, NOT ONE REQUEST ═══════════════════

Deno.test("5. a 429 pushes back EVERY queued caller", async () => {
  // A 429 is a statement about the account. Retrying just the request that hit
  // it while the others continue at full speed is how a rate limit becomes
  // permanent.
  const c = fakeClock();
  const l = new ProviderRateLimiter(100, c);
  await l.acquire();
  l.backOff(5_000);
  await l.acquire();
  assert(c.time >= 5_000, `next caller waited ${c.time}ms, expected >= 5000`);
});

Deno.test("6. back-off never moves the gate backwards", async () => {
  const c = fakeClock();
  const l = new ProviderRateLimiter(1000, c);
  await l.acquire();
  l.backOff(10_000);
  l.backOff(1);          // a smaller, later back-off must not shorten the wait
  await l.acquire();
  assert(c.time >= 10_000, `gate shortened to ${c.time}ms`);
});

// ═══ 3. RETRY-AFTER ════════════════════════════════════════════════════════

Deno.test("7. Retry-After seconds are honoured", () => {
  assertEquals(parseRetryAfterMs("2"), 2000);
  assertEquals(parseRetryAfterMs(" 5 "), 5000);
  assertEquals(parseRetryAfterMs("0"), 0);
});

Deno.test("8. IT IS CAPPED — a provider cannot park an edge invocation", () => {
  // `Retry-After: 3600` is legal. Honouring it literally would hold the
  // function open for an hour; the scan should give up and say why.
  assertEquals(parseRetryAfterMs("3600"), 15_000);
  assertEquals(parseRetryAfterMs("3600", 5_000), 5_000);
});

Deno.test("9. absent or unparseable yields null, not zero", () => {
  // Zero would mean "retry immediately", which is the opposite instruction.
  for (const v of [null, undefined, "", "later", "Wed, 21 Oct 2015 07:28:00 GMT", "-3"]) {
    assertEquals(parseRetryAfterMs(v), null, `${v} must not read as "retry now"`);
  }
});

// ═══ 4. WHICH 429 IS THIS ══════════════════════════════════════════════════

Deno.test("10. rate-limited and out-of-credit are told apart", () => {
  // Same status, opposite remedies: one is ours to fix by slowing down, the
  // other needs a human to top up. `http_429` alone conflated them.
  assertEquals(classifyRateLimitBody("Rate limit exceeded, try again"), "rate_limited");
  assertEquals(classifyRateLimitBody("Too Many Requests"), "rate_limited");
  assertEquals(classifyRateLimitBody("Insufficient credits on your plan"), "out_of_credits");
  assertEquals(classifyRateLimitBody("Please upgrade your plan"), "out_of_credits");
  assertEquals(classifyRateLimitBody("payment required"), "out_of_credits");
});

Deno.test("11. an unrecognised body is `unknown`, never guessed", () => {
  assertEquals(classifyRateLimitBody(""), "unknown");
  assertEquals(classifyRateLimitBody("something new"), "unknown",
    "guessing would send someone to top up an account that is merely busy");
});

// ═══ 5. THE SCAN MUST FIT ITS WALL CLOCK ═══════════════════════════════════

Deno.test("12. capacity says how many requests fit the time available", () => {
  // At 10/min a 30-search scan needs 3 minutes and would be killed mid-flight,
  // losing everything already paid for. Better to plan a smaller scan.
  assertEquals(ProviderRateLimiter.fromRpm(10).capacityWithin(90_000), 15);
  assertEquals(ProviderRateLimiter.fromRpm(60).capacityWithin(90_000), 90);
  assertEquals(ProviderRateLimiter.fromRpm(10).capacityWithin(0), 0);
});

Deno.test("13. the scan wires all three ceilings together", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/run-radar-scan/index.ts", import.meta.url));
  assert(/maxPerScan: Math\.min\(MAX_SEARCHES_PER_SCAN, timeCapacity\)/.test(src),
    "the ceiling is the smallest of scan cap, balance and what fits the clock");
  assert(src.includes("RADAR_PROVIDER_RPM"),
    "the rate must be configurable — the right number is the key's tier, " +
    "which this code cannot see");
});

Deno.test("14. every search goes through the SAME gate", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/run-radar-scan/index.ts", import.meta.url));
  assertEquals((src.match(/ProviderRateLimiter\.fromRpm\(/g) ?? []).length, 1,
    "one limiter per scan — a per-category limiter would restore the burst " +
    "the `Promise.all` created");
  assert(src.includes("firecrawlSearchRaw(query, limit, limiter)"));
});

Deno.test("15. one retry, and only when the provider did not say `out of credits`", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/run-radar-scan/index.ts", import.meta.url));
  assert(/attempt < 2/.test(src), "bounded at one retry");
  assert(/why !== "out_of_credits"/.test(src),
    "retrying an empty account just spends the clock to be refused again");
});
