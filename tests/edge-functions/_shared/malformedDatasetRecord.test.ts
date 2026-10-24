// A7 S18a — A MALFORMED VENDOR DATASET IS RECORDED AS MALFORMED, NOT AS EMPTY.
//
// A 2xx dataset read whose body was not a JSON array became `[]`, so the ledger
// row of a broken vendor answer was identical to a search that found nothing.
// The fix changes only the record: zero rows, charged, exactly as before.
// End to end (real worker, real ledger writer): a7Reliability S18a / S19.
//
// Offline: no database, no provider, no network.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { outcomeFromToolResultForTest } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { creditSettlementFor } from "../../../supabase/functions/_shared/creditAuthorization.ts";

const malformed = { ok: true, data: { items: [], run_id: "r1", dataset_id: "d1", no_results: true, dataset_malformed: true } };
const empty = { ok: true, data: { items: [], run_id: "r1", dataset_id: "d1", no_results: true } };

Deno.test("S18a ledger: a malformed dataset's row says so in metadata", () => {
  const o = outcomeFromToolResultForTest(malformed, {});
  assertEquals(o.status, "succeeded");
  assertEquals(o.metadata?.no_results, true);
  assertEquals(o.metadata?.dataset_malformed, true);
});

Deno.test("S18a ledger: a genuinely empty dataset carries no malformed flag", () => {
  const o = outcomeFromToolResultForTest(empty, {});
  assertEquals(o.metadata?.no_results, true);
  assertEquals("dataset_malformed" in (o.metadata ?? {}), false);
});

Deno.test("S18a credits: a malformed dataset settles exactly as an empty one (the run was bought)", () => {
  assertEquals(creditSettlementFor(malformed), creditSettlementFor(empty));
  assertEquals(creditSettlementFor(malformed), { action: "settle", started: true });
});

Deno.test("S18a ledger: the count columns are those of an empty read", () => {
  const a = outcomeFromToolResultForTest(malformed, {});
  const b = outcomeFromToolResultForTest(empty, {});
  assertEquals(a.counts, b.counts);
  assertEquals(a.cost, b.cost);
});
