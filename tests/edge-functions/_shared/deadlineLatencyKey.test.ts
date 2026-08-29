// ONE ACTOR, TWO STAGES, TWO VERY DIFFERENT CALLS.
//
// `apify_linkedin_company_search` runs twice in a lead run. Discovery asks it
// for a whole pool — fifty companies in one call. Identity resolution asks it
// about ONE company. Keyed on the provider alone, the deadline learned a single
// latency for both, and the pool call is the one that sets it.
//
// ── THE TWO RUNS THIS IS MEASURED FROM ──────────────────────────────────────
//
// The same mission, the same 50-company pool, fifty minutes apart:
//
//   task a76c7b4c   discovery 15.2s → identity estimate 16,375ms → capacity 4
//                   10 shortlisted, 5 resolved
//   task 43355471   discovery 21.5s → identity estimate 23,513ms → capacity 3
//                   10 shortlisted, 2 resolved, 8 deferred
//
// Nothing about identity resolution changed between them. The number it was
// charged did, and the eight companies it gave up on included every one the
// earlier run had already proven was hiring sales roles.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  STAGE_SCOPED_PROVIDERS, createExecutionDeadline, deadlineOperationFor,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import {
  resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  IDENTITY_SEARCH_OP,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

const SEARCH = "apify_linkedin_company_search";
const DISCOVERY_OP = deadlineOperationFor("general_company_discovery", SEARCH);

/** The capacity call the identity stage makes, with everything else held fixed. */
const capacityFrom = (identityEstimateMs: number) =>
  resolveTimeCapacity({
    remainingMs: 63_100, reserveMs: 18_000,
    concurrency: 4, enrichmentBatchSize: 10,
    read: () => undefined,
    observedIdentityMs: identityEstimateMs,
  });

// ── 1. the key ─────────────────────────────────────────────────────────────

Deno.test("1. a shared Actor gets one latency key per stage", () => {
  assert(STAGE_SCOPED_PROVIDERS.includes(SEARCH),
    "the Actor discovery and identity resolution share must be declared");
  assert(DISCOVERY_OP !== IDENTITY_SEARCH_OP,
    "the pool call and the one-company call must not be the same question");
  assertEquals(IDENTITY_SEARCH_OP, `company_identity_resolution:${SEARCH}`);
});

Deno.test("2. and every other Actor is untouched", () => {
  for (const p of ["apify_linkedin_job_search", "apify_linkedin_company_details",
    "apify_yc_companies_memo23", "apify_linkedin_company_employees"]) {
    assertEquals(deadlineOperationFor("hiring_verification", p), p,
      `${p} serves one stage; its key must stay the provider name`);
  }
});

// ── 3. what discovery may and may not teach ────────────────────────────────

Deno.test("3. a slow discovery no longer prices a one-company lookup", () => {
  const d = createExecutionDeadline({ budgetMs: 132_000 });
  // Task 43355471's discovery call, to the millisecond the deadline observed.
  d.observeCall(23_513, DISCOVERY_OP);

  assertEquals(d.estimateFor(DISCOVERY_OP), 23_513,
    "discovery still learns its own cost — a slow pool call must price itself");
  assertEquals(d.estimateFor(IDENTITY_SEARCH_OP), 12_000,
    "but identity resolution keeps the conservative floor until it measures ITSELF");
});

Deno.test("4. identity still learns from identity, and only upwards", () => {
  const d = createExecutionDeadline({ budgetMs: 132_000 });
  d.observeCall(8_600, IDENTITY_SEARCH_OP);
  assertEquals(d.estimateFor(IDENTITY_SEARCH_OP), 12_000,
    "one fast call may never talk the floor down");
  d.observeCall(19_400, IDENTITY_SEARCH_OP);
  assertEquals(d.estimateFor(IDENTITY_SEARCH_OP), 19_400,
    "a genuinely slow identity search must still price itself out");
});

// ── 5. and what that is worth, in companies ────────────────────────────────

Deno.test("5. the run that resolved 2 of 10 would have carried more", () => {
  // AS RAN. The 21.5s discovery call, read back as the identity estimate.
  const asRan = capacityFrom(23_513);
  assertEquals(asRan.identity_call_ms, 23_513);
  assertEquals(asRan.per_company_ms, 14_078, "production recorded exactly this");
  assertEquals(asRan.capacity, 3);

  // AS FIXED. Identity has made no call of its own, so it is priced at the
  // floor rather than at discovery's.
  const d = createExecutionDeadline({ budgetMs: 132_000 });
  d.observeCall(23_513, DISCOVERY_OP);
  const fixed = capacityFrom(d.estimateFor(IDENTITY_SEARCH_OP));
  assert(fixed.capacity > asRan.capacity,
    `capacity must rise: ${asRan.capacity} → ${fixed.capacity}`);
  assert(fixed.identity_call_ms < asRan.identity_call_ms,
    "and it must rise because identity stopped being charged for discovery");
});

Deno.test("6. the stage's own stop guard moves with it", () => {
  const d = createExecutionDeadline({ budgetMs: 132_000 });
  d.observeCall(23_513, DISCOVERY_OP);
  // 60 seconds left — roughly where task 43355471 stopped resolving.
  const remaining = 60_000;
  assert(remaining > d.estimateFor(IDENTITY_SEARCH_OP),
    "there IS room for another identity search");
  assert(remaining < 2 * 23_513 + 13_000,
    "while the old provider-keyed estimate is what made it look unaffordable");
});
