// RAW DISCOVERY VOLUME IS DERIVED, NOT CONSTANT.
//
// Production plan 43fb7313 asked for 5 CONTACT-ready leads and sent
// `max_results: 25` / `maxItems: 27` — a constant unrelated to what remained to
// be delivered, and never reduced as the quota filled.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideDiscoveryBatchSize, batchDecisionDiagnostics,
  DEFAULT_ROWS_PER_LEAD, MINIMUM_DISCOVERY_BATCH, LATER_SOURCE_WIDENING,
} from "./discoveryBatchSize.ts";

const SOURCE_MAX = 50;
const base = {
  requestedLeads: 5, remainingLeads: 5,
  sourceMaximum: SOURCE_MAX, remainingBudgetUsd: 5, costPerCallUsd: 0.25,
};

// ========================================= 12. raw count ≠ requested leads ==

Deno.test("12. the discovery count is separate from, and larger than, the lead quota", () => {
  const d = decideDiscoveryBatchSize(base);
  assertEquals(d.requestedLeads, 5);
  assert(d.count > 5, "raw discovery legitimately exceeds the lead count");
  assertEquals(d.count, 5 * DEFAULT_ROWS_PER_LEAD);
  // The two numbers are reported apart, so neither can stand in for the other.
  const diag = batchDecisionDiagnostics(d);
  assertEquals(diag.requested_leads, 5);
  assertEquals(diag.discovery_count, 25);
  assertFalse(diag.requested_leads === diag.discovery_count);
});

// ---------------------------------------------- 13. responds to the quota ----

Deno.test("13. the batch shrinks as remaining quota falls", () => {
  const counts = [5, 4, 3, 2, 1].map((remainingLeads) =>
    decideDiscoveryBatchSize({ ...base, remainingLeads }).count
  );
  // Monotonically non-increasing.
  for (let i = 1; i < counts.length; i++) {
    assert(counts[i] <= counts[i - 1], `batch grew as quota fell: ${counts.join(",")}`);
  }
  assert(counts[0] > counts[counts.length - 1], `no reduction at all: ${counts.join(",")}`);
});

Deno.test("10. a met quota fetches nothing at all", () => {
  const d = decideDiscoveryBatchSize({ ...base, remainingLeads: 0 });
  assertEquals(d.count, 0);
  assertEquals(d.reason, "quota_met");
});

Deno.test("a small remaining quota still clears the floor", () => {
  const d = decideDiscoveryBatchSize({ ...base, remainingLeads: 1 });
  assertEquals(d.count, MINIMUM_DISCOVERY_BATCH);
  assertEquals(d.reason, "raised_to_floor");
  assertEquals(d.derived, DEFAULT_ROWS_PER_LEAD);
});

// -------------------------------------- 14. source and budget limits hold ----

Deno.test("14. the source ceiling caps the batch", () => {
  const d = decideDiscoveryBatchSize({ ...base, remainingLeads: 100, sourceMaximum: 30 });
  assertEquals(d.count, 30);
  assertEquals(d.reason, "capped_by_source_limit");
  assert(d.derived > 30, "the pre-clamp figure is recorded for the audit trail");
});

Deno.test("14b. an unaffordable round fetches nothing", () => {
  const d = decideDiscoveryBatchSize({ ...base, remainingBudgetUsd: 0.10, costPerCallUsd: 0.25 });
  assertEquals(d.count, 0);
  assertEquals(d.reason, "capped_by_budget");
});

Deno.test("a tiny source ceiling wins over the floor", () => {
  const d = decideDiscoveryBatchSize({ ...base, remainingLeads: 1, sourceMaximum: 4 });
  assertEquals(d.count, 4);
  assertEquals(d.reason, "capped_by_source_limit");
});

// ---------------------------------------------- evidence beats the default ---

Deno.test("an observed conversion rate replaces the default multiplier", () => {
  // A source that needed 12 rows per lead should be asked for more next time.
  const d = decideDiscoveryBatchSize({ ...base, remainingLeads: 2, observedRowsPerLead: 12 });
  assertEquals(d.multiplier, 12);
  assertEquals(d.derived, 24);
  // And an absurd observation is bounded rather than trusted.
  assertEquals(decideDiscoveryBatchSize({ ...base, observedRowsPerLead: 9999 }).multiplier, 20);
  // A nonsense observation falls back to the default.
  assertEquals(decideDiscoveryBatchSize({ ...base, observedRowsPerLead: 0 }).multiplier, DEFAULT_ROWS_PER_LEAD);
});

Deno.test("a later source is widened once, not compounded", () => {
  const first = decideDiscoveryBatchSize({ ...base, remainingLeads: 4 });
  const later = decideDiscoveryBatchSize({ ...base, remainingLeads: 4, completedSources: 1 });
  const muchLater = decideDiscoveryBatchSize({ ...base, remainingLeads: 4, completedSources: 3 });
  assert(later.count > first.count, "a fresh corpus deserves a wider look");
  assertEquals(later.count, Math.ceil(4 * DEFAULT_ROWS_PER_LEAD * LATER_SOURCE_WIDENING));
  assertEquals(muchLater.count, later.count, "widening is capped, not cumulative");
});

Deno.test("the decision is deterministic and fully recorded", () => {
  const a = decideDiscoveryBatchSize(base);
  const b = decideDiscoveryBatchSize(base);
  assertEquals(a, b);
  assertEquals(
    Object.keys(batchDecisionDiagnostics(a)).sort(),
    ["clamping_reason", "derived_count", "discovery_count", "provider_limit", "remaining_leads", "requested_leads", "rows_per_lead"],
  );
});
