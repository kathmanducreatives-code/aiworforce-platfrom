// Tests 1–9: environment safety, budget, and run-once protection.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertBenchmarkPreflight, limitsAreBounded, resolveEnvironment } from "./env-guard.ts";
import { budgetGate, estimateMaxCost, fitLimitsToBudget } from "./budget.ts";
import { decideLiveRun, markTerminal, newLockRecord } from "./run-lock.ts";
import { looksSensitive } from "./redact.ts";
import { APIFY_HARD_CAP_USD, DEFAULT_LIMITS, PROD_PROJECT_REF, TEST_PROJECT_REF, type ApifyLimits } from "./types.ts";

const boundedEstimate = estimateMaxCost(DEFAULT_LIMITS).estimatedMaxUsd;
const base = {
  hasSupabaseUrl: true, hasSupabaseAnonKey: true, hasApifyToken: true, hasWorkspaceId: true,
  limits: DEFAULT_LIMITS, estimatedMaxUsd: boundedEstimate,
};

Deno.test("1. TEST ref is accepted", () => {
  assertEquals(resolveEnvironment(TEST_PROJECT_REF), "test");
  const p = assertBenchmarkPreflight({ mode: "live", projectRef: TEST_PROJECT_REF, ...base });
  assert(p.ok, p.blockers.join("; "));
  assertEquals(p.environment, "test");
});

Deno.test("2. production ref is rejected in every mode", () => {
  assertEquals(resolveEnvironment(PROD_PROJECT_REF), "production");
  for (const mode of ["dry-run", "live", "replay"] as const) {
    const p = assertBenchmarkPreflight({ mode, projectRef: PROD_PROJECT_REF, ...base });
    assertFalse(p.ok);
    assert(p.blockers.some((b) => /PRODUCTION/i.test(b)));
  }
});

Deno.test("3. unknown ref is rejected", () => {
  assertEquals(resolveEnvironment("zzz-not-real"), "unknown");
  const p = assertBenchmarkPreflight({ mode: "dry-run", projectRef: "zzz-not-real", ...base });
  assertFalse(p.ok);
});

Deno.test("4. missing Apify token blocks live run, with no secret in the message", () => {
  const p = assertBenchmarkPreflight({ mode: "live", projectRef: TEST_PROJECT_REF, ...base, hasApifyToken: false });
  assertFalse(p.ok);
  assert(p.blockers.some((b) => /Apify API token/i.test(b)));
  for (const b of p.blockers) assertFalse(looksSensitive(b));
});

Deno.test("5. a second live run for the same run id is rejected", () => {
  const started = newLockRecord("run-x", "2026-07-23T00:00:00Z");
  assertEquals(decideLiveRun("run-x", null).allowed, true);
  const terminal = markTerminal(started, "2026-07-23T00:05:00Z");
  assertEquals(decideLiveRun("run-x", terminal).allowed, false);
  // A non-terminal in-progress record also refuses a second start.
  assertEquals(decideLiveRun("run-x", started).allowed, false);
});

Deno.test("6. an estimate above $5 blocks the run", () => {
  const huge: ApifyLimits = { rawMaxResults: 100, verifyMaxAccounts: 100, founderLookupMaxAccounts: 100, founderCandidatesPerAccount: 5, finalRankedMax: 100 };
  const est = estimateMaxCost(huge);
  assertFalse(est.withinHardCap);
  const p = assertBenchmarkPreflight({ mode: "live", projectRef: TEST_PROJECT_REF, ...base, limits: huge, estimatedMaxUsd: est.estimatedMaxUsd });
  assertFalse(p.ok);
  assert(p.blockers.some((b) => /hard cap/i.test(b)));
});

Deno.test("7. the soft cap at $4.50 stops further provider calls", () => {
  assertEquals(budgetGate(4.49).proceed, true);
  assertEquals(budgetGate(4.5).level, "soft_stop");
  assertEquals(budgetGate(4.5).proceed, false);
  assertEquals(budgetGate(APIFY_HARD_CAP_USD).level, "hard_stop");
});

Deno.test("8. provider item limits are enforced / bounded", () => {
  assert(limitsAreBounded(DEFAULT_LIMITS));
  assertFalse(limitsAreBounded({ ...DEFAULT_LIMITS, rawMaxResults: 0 }));
  assertFalse(limitsAreBounded({ ...DEFAULT_LIMITS, verifyMaxAccounts: -1 }));
  assertFalse(limitsAreBounded({ ...DEFAULT_LIMITS, founderCandidatesPerAccount: Number.NaN }));
  // Over-budget limits get reduced to fit under the hard cap.
  const over: ApifyLimits = { rawMaxResults: 100, verifyMaxAccounts: 100, founderLookupMaxAccounts: 100, founderCandidatesPerAccount: 5, finalRankedMax: 100 };
  const fit = fitLimitsToBudget(over);
  assert(fit.adjusted);
  assert(estimateMaxCost(fit.limits).estimatedMaxUsd <= APIFY_HARD_CAP_USD);
});

Deno.test("9. actor ids and per-actor costs are recorded in the estimate", () => {
  const est = estimateMaxCost(DEFAULT_LIMITS);
  assert(est.lines.length >= 2);
  for (const l of est.lines) {
    assert(l.actorId.length > 0);
    assert(l.usd >= 0);
  }
  assert(est.lines.some((l) => l.actorKey === "apify_jobs"));
});
