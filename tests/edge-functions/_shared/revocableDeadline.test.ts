// Revoking the deadline is how a lost lease stops paid work: from that moment
// every "is there room to start?" answer is no, through the existing reserve
// checks. Before revocation it must behave exactly like the deadline it wraps.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { revocableDeadline } from "../../../supabase/functions/_shared/revocableDeadline.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

Deno.test("unrevoked: identical to the wrapped deadline", () => {
  const c = clock();
  const base = createExecutionDeadline({ budgetMs: 300_000, now: c.now });
  const d = revocableDeadline(base);
  c.advance(10_000);
  assertEquals(d.budgetMs, 300_000);
  assertEquals(d.elapsedMs(), base.elapsedMs());
  assertEquals(d.remainingMs(), base.remainingMs());
  assertFalse(d.expired());
  assertFalse(d.expired("company_qualification"));
  assertFalse(d.expiredForDurableStart());
  assertEquals(d.revokedReason, null);
});

Deno.test("revoked: no room for anything, immediately, with the first reason kept", () => {
  const c = clock();
  const d = revocableDeadline(createExecutionDeadline({ budgetMs: 300_000, now: c.now }));
  d.revoke("lineage_cancelled");
  d.revoke("something_later");
  assertEquals(d.remainingMs(), 0);
  assert(d.expired());
  assert(d.expired("company_qualification"));
  assert(d.expiredForDurableStart());
  assertEquals(d.revokedReason, "lineage_cancelled");
});

Deno.test("observed latencies still reach the real estimates after revocation", () => {
  const c = clock();
  const base = createExecutionDeadline({ budgetMs: 300_000, now: c.now });
  const d = revocableDeadline(base);
  d.revoke("ownership_lost");
  d.observeCall(90_000, "apify_x");
  assertEquals(base.estimateFor("apify_x"), 90_000);
  assertEquals(d.estimateFor("apify_x"), 90_000);
  assertEquals(d.slowestCallMs, 90_000);
});
