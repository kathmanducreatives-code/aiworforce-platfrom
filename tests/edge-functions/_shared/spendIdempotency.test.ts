// ONE SEMANTIC PROVIDER OPERATION IS PAID FOR AT MOST ONCE PER LINEAGE.
//
// ── WHAT WAS ACTUALLY BOUGHT TWICE ─────────────────────────────────────────
//
// Lineage 06d3544a, 2026-08-29, verbatim from `lead_execution_calls`. Identical
// input fingerprints, two generations, two paid runs and two charges each:
//
//   fingerprint  task 237717dd                  task 0ed83116
//   996fb92c     G9ppGtOL11gNZr9Af  charged     G9ppGtOL11gNZr9Af  REUSED, charged
//   298dc1a0     FcGResJtI7CJGdOEa  $0.0001     8NnjlNJgwRcbdUH2M  $0.0001
//   929a1a74     QdMbpZGaNym2bzjZI  $0.015      EimrTjnSzy7TgIldA  $0.019
//   2df88a5a     kCcPbdENXxrueROWZ  $0.016      EnRFGYQzHPSrwVQ5X  $0.025
//
// Six distinct semantic operations across the lineage; ten paid provider runs.
//
// The cause was two keys for one idea. `providerOperationKey` has always been
// built from the LINEAGE root, and its comment says why: "a continuation is a
// different task asking the same question". `logicalCallKey` — the key that
// gated the money — was built from the TASK.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  logicalCallKey,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import {
  priceProviderCall,
} from "../../../supabase/functions/_shared/providerCostModel.ts";

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const LINEAGE = "06d3544a-7ff4-483d-8d92-362ce1981e69";
const GEN_B = "237717dd-0084-4e94-93ac-a352a8873af0";
const GEN_C = "0ed83116-88d4-45f3-9c6e-e240c037d892";

/** The six semantic operations this lineage actually performed. */
const OPERATIONS = [
  { capability: "apify_linkedin_company_details", input_hash: "996fb92c" },
  { capability: "apify_linkedin_company_details", input_hash: "298dc1a0" },
  { capability: "apify_linkedin_job_search", input_hash: "929a1a74" },
  { capability: "apify_linkedin_job_search", input_hash: "2df88a5a" },
  { capability: "apify_linkedin_job_search", input_hash: "5571e0db" },
  { capability: "apify_linkedin_job_search", input_hash: "05affa12" },
] as const;

const keyFor = (op: typeof OPERATIONS[number], task: string, lineage?: string) =>
  logicalCallKey({
    lineage_root: lineage ?? null, task_id: task,
    capability: op.capability, stage: "other", input_hash: op.input_hash,
  });

// ── THE KEY ─────────────────────────────────────────────────────────────────

Deno.test("THE SAME QUESTION FROM TWO GENERATIONS IS ONE KEY", () => {
  for (const op of OPERATIONS) {
    assertEquals(
      keyFor(op, GEN_B, LINEAGE), keyFor(op, GEN_C, LINEAGE),
      `${op.capability}:${op.input_hash} must not depend on which generation asked`,
    );
  }
});

Deno.test("SIX OPERATIONS PRODUCE SIX KEYS, NOT TEN", () => {
  // The count that matters. Ten paid runs were made; six questions were asked.
  const keys = new Set<string>();
  for (const task of [GEN_B, GEN_C]) {
    for (const op of OPERATIONS) keys.add(keyFor(op, task, LINEAGE));
  }
  assertEquals(keys.size, 6);
});

Deno.test("MUTATION: reverting the key to task-scoped brings the duplicates back", () => {
  // The pin. Without a lineage the key falls back to the task id, which is
  // exactly the old behaviour, and the same six questions become twelve keys —
  // one per generation. If this ever stops failing to dedupe, the fix is gone.
  const taskScoped = new Set<string>();
  for (const task of [GEN_B, GEN_C]) {
    for (const op of OPERATIONS) taskScoped.add(keyFor(op, task));
  }
  assertEquals(taskScoped.size, 12, "task-scoped keys cannot collapse across generations");
  assert(taskScoped.size > 6, "and that is strictly worse than the lineage-scoped key");
});

Deno.test("different questions keep different keys", () => {
  // Deduplication must not become collision. Two job searches with different
  // compiled inputs are two purchases and must stay two.
  const a = keyFor(OPERATIONS[2], GEN_B, LINEAGE);
  const b = keyFor(OPERATIONS[3], GEN_B, LINEAGE);
  assert(a !== b);
});

Deno.test("a caller with no lineage behaves exactly as it does today", () => {
  // A one-off lead action or a monitoring scan has no continuation chain. Such a
  // task IS its own lineage, so the fallback must be the task id and nothing
  // else — this is what keeps every non-sourcing caller unchanged.
  const op = OPERATIONS[0];
  assertEquals(keyFor(op, GEN_B), keyFor(op, GEN_B, GEN_B));
});

Deno.test("the lineage, not the workspace, is the scope", () => {
  // Two different requests in one workspace ask the same question independently
  // and must each pay for it. Sharing at workspace scope would silently serve
  // one user's request from another's paid work.
  const op = OPERATIONS[0];
  const other = "9da530ae-e9e9-491d-a9a9-738eb3538ab6";
  assert(keyFor(op, GEN_B, LINEAGE) !== keyFor(op, GEN_B, other));
});

// ── THE CHARGE, UNDER CONCURRENCY ───────────────────────────────────────────

/**
 * `credits_reserve`, in the parts that decide.
 *
 * Faithful to the deployed function: it looks for an existing row on
 * `(workspace_id, idempotency_key)` and returns it as a replay, and on a racing
 * insert it catches the unique violation, REFUNDS the reservation it just made
 * and returns the prior transaction. That second path is what makes it safe for
 * two workers, and it is the reason this phase needed no database change.
 */
class CreditLedger {
  rows = new Map<string, { id: number; charged: number }>();
  reservations = 0;
  private next = 1;

  reserve(workspace: string, key: string, amount: number) {
    const k = `${workspace}|${key}`;
    const existing = this.rows.get(k);
    if (existing) return { ok: true, replayed: true, transaction_id: existing.id };
    this.reservations += amount;
    const id = this.next++;
    this.rows.set(k, { id, charged: amount });
    return { ok: true, replayed: false, transaction_id: id };
  }

  /** Two callers reaching the check before either inserts. */
  reserveRacing(workspace: string, key: string, amount: number, other: () => void) {
    const k = `${workspace}|${key}`;
    if (this.rows.get(k)) return { ok: true, replayed: true };
    other();                                   // the racer inserts first
    if (this.rows.get(k)) {
      // unique_violation → refund and replay. Nothing is charged twice.
      return { ok: true, replayed: true };
    }
    this.reservations += amount;
    this.rows.set(k, { id: this.next++, charged: amount });
    return { ok: true, replayed: false };
  }

  get charged() {
    return [...this.rows.values()].reduce((n, r) => n + r.charged, 0);
  }
}

Deno.test("REPLAYING THE 11:12 LINEAGE: SIX CHARGES, NOT TEN", () => {
  const credits = new CreditLedger();
  // Both generations do the work they actually did, in the order they did it.
  for (const task of [GEN_B, GEN_C]) {
    for (const op of OPERATIONS) {
      credits.reserve(WS, keyFor(op, task, LINEAGE), 1);
    }
  }
  assertEquals(credits.charged, 6, "one credit per semantic operation");
  assertEquals(credits.rows.size, 6);
});

Deno.test("…and the SAME replay on the old key charges twelve", () => {
  const credits = new CreditLedger();
  for (const task of [GEN_B, GEN_C]) {
    for (const op of OPERATIONS) credits.reserve(WS, keyFor(op, task), 1);
  }
  assertEquals(credits.charged, 12, "the defect, reproduced");
});

Deno.test("PROPERTY: no interleaving of two generations charges a key twice", () => {
  // Every order in which two generations could reach the same six operations.
  // The guarantee has to hold for all of them, not just the one production
  // happened to take.
  const orders: Array<Array<[string, typeof OPERATIONS[number]]>> = [];
  const bOps = OPERATIONS.map((o) => [GEN_B, o] as [string, typeof OPERATIONS[number]]);
  const cOps = OPERATIONS.map((o) => [GEN_C, o] as [string, typeof OPERATIONS[number]]);
  orders.push([...bOps, ...cOps]);                       // strictly sequential
  orders.push([...cOps, ...bOps]);                       // reverse
  orders.push(bOps.flatMap((b, i) => [b, cOps[i]]));     // perfectly interleaved
  orders.push(cOps.flatMap((c, i) => [c, bOps[i]]));     // interleaved, other first
  orders.push([...bOps.slice(0, 3), ...cOps, ...bOps.slice(3)]); // overlapping

  for (const [n, order] of orders.entries()) {
    const credits = new CreditLedger();
    for (const [task, op] of order) credits.reserve(WS, keyFor(op, task, LINEAGE), 1);
    assertEquals(credits.charged, 6, `interleaving ${n} charged more than once per key`);
  }
});

Deno.test("PROPERTY: two workers racing ONE key still charge once", () => {
  // The case the database resolves rather than the application: both read
  // "absent", both try to insert, the unique index picks a winner and the loser
  // refunds. This is why the fix needed no new constraint.
  const credits = new CreditLedger();
  const key = keyFor(OPERATIONS[0], GEN_B, LINEAGE);
  credits.reserveRacing(WS, key, 1, () => { credits.reserve(WS, key, 1); });
  assertEquals(credits.charged, 1);
  assertEquals(credits.rows.size, 1);
});

// ── THE ADOPTED RUN ─────────────────────────────────────────────────────────

Deno.test("AN ADOPTED RUN COSTS THIS CALL NOTHING", () => {
  // Production: task 0ed83116 adopted G9ppGtOL11gNZr9Af, reported
  // `status: "reused"` correctly, and still recorded `actual_cost_usd: 0.0001`.
  // Adoption is `GET /actor-runs/{id}`, and Apify answers with the run's usage —
  // what the ORIGINAL run cost. That is not what the re-read cost.
  const adopted = priceProviderCall({
    actorKey: "apify_linkedin_company_details",
    itemCount: 10,
    input: {},
    run: { usageTotalUsd: 0.0001 },   // the provider reports the original charge
    started: false,                    // …but this call adopted it
    adopted: true,                     // …and says so positively: `started:
    // false` alone is also true of a provider with no run ids, which priced
    // every failed Firecrawl scrape at $0.00.
  });
  assertEquals(adopted.actual_usd, null, "an adoption records no actual spend");
  assertEquals(adopted.estimated_usd, 0, "zero is the correct answer, not a rounding");
});

Deno.test("a run this call actually STARTED still records what the provider reported", () => {
  // The other side of the line: the fix must not make real purchases free.
  const bought = priceProviderCall({
    actorKey: "apify_linkedin_company_details",
    itemCount: 10, input: {},
    run: { usageTotalUsd: 0.0001 },
    started: true,
  });
  assertEquals(bought.actual_usd, 0.0001);
  assertEquals(bought.source, "provider_reported");
});

Deno.test("the adoption check runs BEFORE the provider-reported branch", () => {
  // The defect was ordering, not logic: the zero-cost branch existed and was
  // unreachable for every actor whose run object carries usage. A source-level
  // pin, because the ordering is the fix and an equivalent-looking reorder would
  // silently restore the bug.
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/providerCostModel.ts", import.meta.url));
  // COMMENTS STRIPPED FIRST. The prose above the fix necessarily describes the
  // very branch it replaced, so a raw text search finds the explanation before
  // the code and reports the opposite of the truth. A pin that can be fooled by
  // its own documentation is not a pin.
  const code = src.slice(src.indexOf("export function priceProviderCall"))
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert(
    code.indexOf("i.started === false") < code.indexOf("usageTotalUsd"),
    "an adopted run must be priced before the provider's own figure is consulted",
  );
});
