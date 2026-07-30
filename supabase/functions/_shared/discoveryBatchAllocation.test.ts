// SPLITTING A BATCH ACROSS QUERY PACKS WITHOUT MULTIPLYING IT.
//
// Crawlworks' `jobsToFetch` applies PER SEARCH URL (up to 3); Indeed's `maxItems`,
// Glassdoor's `limit` and YC's `maxResults` bound the run. Handing three packs a
// per-URL limit of 24 each requests 72 rows while the accounting believes it asked
// for 24 — an unbounded multiplication of volume and cost. So the scope is an
// explicit input, and `effectiveTotalRequested` is what cost must be read from.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allocateBatchAcrossPacks, packAllocationDiagnostics, MINIMUM_PACK_ALLOCATION,
} from "./discoveryBatchAllocation.ts";

const THREE = ["sales_ops_management", "revenue_operations", "sales_ops_ic"];

// ================================ 10. allocation stays bounded ==============

Deno.test("10. an even split sums back to the batch on a per-run limit", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 24, packIds: THREE, scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.allocations.map((a) => a.allocatedResults), [8, 8, 8]);
  assertEquals(d.effectiveTotalRequested, 24);
  assertEquals(d.reason, "even_split");
  assertEquals(d.droppedPackIds, []);
});

Deno.test("a remainder goes to the highest-priority packs, never lost", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 25, packIds: THREE, scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.allocations.map((a) => a.allocatedResults), [9, 8, 8]);
  assertEquals(d.effectiveTotalRequested, 25);
});

// ============================ 11. per-URL does not multiply =================

Deno.test("11. a per-query limit reports the AGGREGATE it will actually request", () => {
  const perRun = allocateBatchAcrossPacks({
    totalBatch: 24, packIds: THREE, scope: "per_run", providerMaximum: 1000,
  });
  const perQuery = allocateBatchAcrossPacks({
    totalBatch: 24, packIds: THREE, scope: "per_query", providerMaximum: 1000,
  });
  // The batch is SPLIT, not applied whole to each query. Both request 24 rows.
  assertEquals(perQuery.effectiveTotalRequested, 24);
  assertEquals(perQuery.effectiveTotalRequested, perRun.effectiveTotalRequested);
  // The naive reading — 24 per URL — would have been 72.
  assertFalse(perQuery.effectiveTotalRequested === 24 * THREE.length);
  assertEquals(perQuery.scope, "per_query");
});

Deno.test("11b. a per-query cap on the number of queries drops the excess packs", () => {
  // Crawlworks accepts at most 3 search URLs.
  const d = allocateBatchAcrossPacks({
    totalBatch: 40, packIds: [...THREE, "gtm_ops", "sales_planning"],
    scope: "per_query", providerMaximum: 1000, maximumQueries: 3,
  });
  assertEquals(d.allocations.length, 3);
  assertEquals(d.droppedPackIds, ["gtm_ops", "sales_planning"]);
  assert(d.effectiveTotalRequested <= 40);
});

// -------------------------------- the floor and the ceiling ----------------

Deno.test("a pack that cannot be funded meaningfully is dropped, not issued", () => {
  // 9 across 3 packs would be 3 each — below the floor, so nothing is worth
  // issuing separately; the highest-priority pack takes the batch.
  const d = allocateBatchAcrossPacks({
    totalBatch: 9, packIds: THREE, scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.allocations.length, 1);
  assertEquals(d.allocations[0].packId, "sales_ops_management");
  assertEquals(d.reason, "floored_and_trimmed");
  assertEquals(d.droppedPackIds.length, 2);
  assert(d.allocations[0].allocatedResults >= MINIMUM_PACK_ALLOCATION);
});

Deno.test("the provider ceiling caps every allocation", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 300, packIds: THREE, scope: "per_run", providerMaximum: 20,
  });
  for (const a of d.allocations) assert(a.allocatedResults <= 20, String(a.allocatedResults));
});

Deno.test("12. a zero batch allocates nothing at all", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 0, packIds: THREE, scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.allocations, []);
  assertEquals(d.effectiveTotalRequested, 0);
  assertEquals(d.reason, "empty_batch");
  assertEquals(d.droppedPackIds, THREE);
});

Deno.test("a single pack takes the batch, bounded by the ceiling", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 24, packIds: ["revenue_operations"], scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.reason, "single_pack");
  assertEquals(d.allocations, [{ packId: "revenue_operations", allocatedResults: 24 }]);
  assertEquals(
    allocateBatchAcrossPacks({ totalBatch: 24, packIds: ["x"], scope: "per_run", providerMaximum: 10 })
      .allocations[0].allocatedResults,
    10,
  );
});

Deno.test("no packs is distinguishable from an empty batch", () => {
  const d = allocateBatchAcrossPacks({
    totalBatch: 24, packIds: [], scope: "per_run", providerMaximum: 200,
  });
  assertEquals(d.reason, "no_packs");
  assertEquals(d.effectiveTotalRequested, 0);
});

Deno.test("allocation is deterministic and fully recorded", () => {
  const args = { totalBatch: 25, packIds: THREE, scope: "per_run" as const, providerMaximum: 200 };
  assertEquals(allocateBatchAcrossPacks(args), allocateBatchAcrossPacks(args));
  const diag = packAllocationDiagnostics(allocateBatchAcrossPacks(args));
  assertEquals(
    Object.keys(diag).sort(),
    ["allocation_reason", "allocations", "dropped_pack_ids", "effective_total_requested", "provider_limit_scope", "query_pack_count"],
  );
  assertEquals(diag.effective_total_requested, 25);
});
