// THE WORKBENCH MUST BE ABLE TO EXPLAIN EVERY COMPANY IT COUNTED.
//
// ── THE SCREEN THIS PINS ───────────────────────────────────────────────────
//
// Task 5c461aa3, 2026-08-28. The Workbench showed:
//
//   30 companies reviewed · Qualified 0 · In review 0 · Not reached 1
//
// Twenty-nine companies were on no tab at all — not even in Run details. The
// fixture beside this file is those thirty rows, copied from
// `tasks.result.workbench_evaluation_rows`.
//
// Each selector was individually correct; all of them keyed on DECISION fields,
// and that run decided nothing (`decision_source: not_evaluated` on all thirty).
// Eighteen carried a real stated rejection in `shortlist_exclusion` and eleven
// sat at `verifying`, and no bucket's vocabulary included either.
//
// The invariant these tests exist for:
//
//   reviewed = qualified + in_review + rejected + not_reached + unclassified
//   and unclassified is empty
//
// The second half is what makes the first half worth asserting: a catch-all
// that absorbed everything would satisfy the sum and hide the same bug.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  partitionAllRows, bucketFor, bucketReasonFor, tabsFor, LEAD_TAB_LABEL,
} from "../../src/lib/workbench/leadTabs.ts";

// deno-lint-ignore no-explicit-any
const ROWS: any[] = JSON.parse(
  await Deno.readTextFile(new URL("../fixtures/run5c461aa3WorkbenchRows.json", import.meta.url)));

Deno.test("0. the fixture is the run the Workbench actually showed", () => {
  assertEquals(ROWS.length, 30, "30 companies reviewed");
  assertEquals(ROWS.filter((r) => r.status === "not_investigated").length, 18);
  assertEquals(ROWS.filter((r) => r.status === "verifying").length, 11);
  assertEquals(ROWS.filter((r) => r.status === "deferred").length, 1);
  assertEquals(ROWS.every((r) => r.decision_source === "not_evaluated"), true,
    "the run decided nothing — every bucket keyed on a decision saw zero");
});

Deno.test("1. every reviewed company lands in exactly one bucket", () => {
  const b = partitionAllRows(ROWS);
  const total = b.qualified.length + b.in_review.length + b.rejected.length +
    b.not_reached.length + b.unclassified.length;
  assertEquals(total, ROWS.length, "reviewed must equal the sum of the buckets");

  // And exactly one — no row may be counted twice.
  const seen = new Set<string>();
  for (const list of Object.values(b)) {
    for (const r of list) {
      assertEquals(seen.has(r.company_key), false, `${r.company_name} is in two buckets`);
      seen.add(r.company_key);
    }
  }
  assertEquals(seen.size, ROWS.length);
});

Deno.test("2. NOTHING is unclassified", () => {
  // The assertion that gives the sum its meaning. A status nobody mapped must
  // fail here rather than disappear from the screen.
  const b = partitionAllRows(ROWS);
  assertEquals(b.unclassified.map((r) => `${r.company_name}:${r.status}`), []);
});

Deno.test("3. the eighteen headcount rejections are visible, with their reason", () => {
  // These were the largest invisible group: every one over the Company Brain's
  // 150-employee ceiling, from 157 to 29,939.
  const b = partitionAllRows(ROWS);
  assertEquals(b.rejected.length, 18);
  for (const r of b.rejected) {
    assertEquals(r.shortlist_exclusion, "mission_constraint:employee_size");
    assert((r.employee_count ?? 0) > 150, `${r.company_name} is over the ceiling`);
    const why = bucketReasonFor(r);
    assert(why.length > 0 && why !== "No reason was recorded.",
      `${r.company_name} must say why it was ruled out`);
  }
});

Deno.test("4. the eleven mid-verification companies are in review, not gone", () => {
  const b = partitionAllRows(ROWS);
  assertEquals(b.in_review.length, 11);
  assertEquals(b.in_review.every((r) => r.status === "verifying"), true);
  // Named, because these are the six the replay proves would now qualify.
  for (const expected of ["Pursuit", "Blue Signal Search", "Talentoma", "ForceBrands"]) {
    assert(b.in_review.some((r) => r.company_name === expected),
      `${expected} had real sales openings and must be visible`);
  }
});

Deno.test("5. the one deferred company is still the only Not reached", () => {
  // The number the screen already got right must not move.
  const b = partitionAllRows(ROWS);
  assertEquals(b.not_reached.length, 1);
  assertEquals(b.not_reached[0].company_name, "Odiin.");
  assertEquals(b.not_reached[0].resumable, true);
});

Deno.test("6. nothing qualified, and that stays true", () => {
  // The fix makes rejections visible; it must not invent an acceptance.
  const b = partitionAllRows(ROWS);
  assertEquals(b.qualified.length, 0);
});

Deno.test("7. the tab row now accounts for the ruled-out companies", () => {
  const b = partitionAllRows(ROWS);
  const tabs = tabsFor({
    qualified: b.qualified.length,
    inReview: b.in_review.length,
    rejected: b.rejected.length,
    notReached: b.not_reached.length,
    hasInsights: false,
  });
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t.count]));
  assertEquals(byId.qualified, 0);
  assertEquals(byId.in_review, 11);
  assertEquals(byId.rejected, 18);
  assertEquals(byId.not_reached, 1);
  // 0 + 11 + 18 + 1 = 30. The screen can now explain every company.
  assertEquals(
    (byId.qualified ?? 0) + (byId.in_review ?? 0) + (byId.rejected ?? 0) + (byId.not_reached ?? 0),
    ROWS.length);
  assertEquals(LEAD_TAB_LABEL.rejected, "Ruled out");
});

Deno.test("8. an acceptance outranks a rejection", () => {
  // Ordering is the design. A qualified company that also carries a stale
  // exclusion must read as qualified.
  //
  // `resolveQualification` reads the gates, not a summary flag — it carries the
  // scar of once reporting 20 qualified companies for a run that qualified
  // none. So this row passes the gates AND keeps a stale exclusion.
  const row = {
    ...ROWS[0], status: "qualified",
    quota_eligible: true, decision_maker_status: "verified", contact_status: "verified",
    decided: true, decision_source: "company_brain",
    shortlist_exclusion: "mission_constraint:employee_size",
  };
  assertEquals(bucketFor(row), "qualified");
});

Deno.test("9. a company with no stated reason is not called a rejection", () => {
  // The failure this codebase already fixed once: absence of a pass is not a
  // rejection. A `verifying` row with no exclusion must never land in rejected.
  const row = {
    ...ROWS.find((r: { status: string }) => r.status === "verifying"),
    shortlist_exclusion: null, exclusion: null,
  };
  assertEquals(bucketFor(row), "in_review");
});

Deno.test("10. an unmodelled status surfaces instead of vanishing", () => {
  // The whole point of keeping `unclassified` rather than making in_review the
  // catch-all: a new lifecycle state must break a test, not a screen.
  const row = { ...ROWS[0], status: "some_future_state", shortlist_exclusion: null,
    exclusion: null, resumable: false };
  assertEquals(bucketFor(row), "unclassified");
});

// ══ THE SCREEN ACTUALLY USES IT ════════════════════════════════════════════

const VIEW = await Deno.readTextFile(new URL(
  "../../src/components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url));

Deno.test("11. the Workbench computes the full partition, not just two buckets", () => {
  assert(VIEW.includes("partitionAllRows(evaluationRows"),
    "the view must partition every reviewed company");
  assert(VIEW.includes("rejected: ruledOut.length"),
    "and hand the ruled-out count to the tab row");
});

Deno.test("12. the ruled-out tab renders a reason per company", () => {
  const at = VIEW.indexOf("tab === 'rejected'");
  assert(at > 0, "the bucket must have somewhere to render");
  const block = VIEW.slice(at, at + 1800);
  assert(block.includes("ruledOut.map("), "it lists the companies");
  assert(block.includes("bucketReasonFor(c)"),
    "and says why each one was ruled out — a bucket with no reason is the same silence");
});
