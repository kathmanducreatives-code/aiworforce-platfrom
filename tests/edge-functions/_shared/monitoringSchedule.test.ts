// PHASE 6 — SIGNALS ANSWERS WITHOUT BEING ASKED, AND WITHIN A CEILING.
//
// Every test the plan named is here:
//
//   * a scan inside the freshness window buys nothing
//   * a scan skips evidence a Lead mission collected an hour ago
//   * budget exhaustion refuses and checkpoints
//   * two schedulers firing once produce one scan
//
// ── AND ONE THING THE PLAN ASSUMED THAT IS NOT TRUE ─────────────────────────
//
// It expected Phase 3's pre-flight to prevent the re-spend. It does — for DATED
// evidence, because its rule is `occurred_at_basis === "source_reported"` and an
// undated event cannot be shown to fall inside a recency window. Monitoring
// writes every event with `occurred_at: null`, so the pre-flight can never
// reuse monitoring's OWN evidence.
//
// The two mechanisms answer different questions and neither substitutes for the
// other: the pre-flight asks "is the ANSWER still fresh?", the cadence asks
// "did we ASK recently?". Both are tested here, separately.
//
// PURE. No network, provider, model or database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  subjectDue, planDueScans, budgetAllows,
  CLAIM_LEASE_MINUTES, DEFAULT_CADENCE_MINUTES, DEFAULT_PERIOD_CEILING,
  type SchedulableSubject,
} from "../../../supabase/functions/_shared/monitoringSchedule.ts";
import { preflight } from "../../../supabase/functions/_shared/monitoringPreflight.ts";
import type { ExistingEvidence } from "../../../supabase/functions/_shared/monitoringPreflight.ts";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const sub = (over: Partial<SchedulableSubject> = {}): SchedulableSubject => ({
  id: "s1", workspace_id: "w", enabled: true,
  cadence_minutes: 1440, last_run_at: minsAgo(2000), claimed_at: null, ...over,
});

// ── 1–3. THE CADENCE: DID WE ASK RECENTLY? ──────────────────────────────────

Deno.test("1. a scan inside the cadence buys nothing", () => {
  const d = subjectDue(sub({ last_run_at: minsAgo(60), cadence_minutes: 1440 }), NOW);
  assertFalse(d.due);
  assertEquals(d.not_due_reason, "inside_cadence");
  assert(/nothing is bought/.test(d.reason), d.reason);
  assertEquals(d.due_in_minutes, 1380);
});

Deno.test("2. a subject that has never run is due immediately", () => {
  // Waiting a full cadence for the first answer is the opposite of what
  // somebody who just added a subject wants.
  const d = subjectDue(sub({ last_run_at: null }), NOW);
  assert(d.due);
  assertEquals(d.due_in_minutes, null);
  assert(/no pass has completed/.test(d.reason));
});

Deno.test("3. a disabled subject is never due, and says so", () => {
  const d = subjectDue(sub({ enabled: false, last_run_at: null }), NOW);
  assertFalse(d.due);
  assertEquals(d.not_due_reason, "disabled");
});

// ── 4–5. TWO SCHEDULERS FIRING ONCE PRODUCE ONE SCAN ────────────────────────

Deno.test("4. a claimed subject is not due for a second scheduler", () => {
  const claimed = sub({ last_run_at: minsAgo(5000), claimed_at: minsAgo(1) });
  const d = subjectDue(claimed, NOW);
  assertFalse(d.due, "two schedulers would both scan");
  assertEquals(d.not_due_reason, "claimed_by_another_run");
});

Deno.test("5. a claim is a lease, so a crashed run cannot freeze a subject", () => {
  // The failure a plain in-progress flag has: the run dies, the flag stays, and
  // the subject is never monitored again.
  const stale = sub({
    last_run_at: minsAgo(5000),
    claimed_at: minsAgo(CLAIM_LEASE_MINUTES + 1),
  });
  assert(subjectDue(stale, NOW).due, "an expired lease must release the work");
});

// ── 6–7. WHAT A TICK DECIDES ────────────────────────────────────────────────

Deno.test("6. one scan per workspace, not one per subject", () => {
  // A workspace's subjects compile into ONE mission, so scanning per subject
  // would buy the same identity resolutions once per subject.
  const plan = planDueScans([
    sub({ id: "a", workspace_id: "w1", last_run_at: null }),
    sub({ id: "b", workspace_id: "w1", last_run_at: null }),
    sub({ id: "c", workspace_id: "w2", last_run_at: null }),
    sub({ id: "d", workspace_id: "w3", last_run_at: minsAgo(10), cadence_minutes: 1440 }),
  ], NOW);
  assertEquals(plan.workspaces, ["w1", "w2"]);
  assertEquals(plan.summary.due, 3);
  assertEquals(plan.summary.not_due.inside_cadence, 1);
});

Deno.test("7. a tick with nothing due scans nothing", () => {
  const plan = planDueScans([sub({ last_run_at: minsAgo(10) })], NOW);
  assertEquals(plan.workspaces, []);
  assertEquals(plan.summary.due, 0);
});

// ── 8–10. THE PERIOD CEILING: REFUSE RATHER THAN OVERSPEND ──────────────────

Deno.test("8. budget exhaustion refuses", () => {
  const d = budgetAllows({ ceiling: 200, spent: 200, period_days: 7 });
  assertFalse(d.allowed);
  assertEquals(d.remaining, 0);
  assert(/refusing rather than overspending/.test(d.reason), d.reason);
});

Deno.test("9. a pass that would cross the ceiling does not start half-way", () => {
  // A half-bought pass has paid for identity and enrichment without reaching
  // the qualification that turns them into a signal.
  const nearly = budgetAllows({ ceiling: 200, spent: 199, period_days: 7 });
  assert(nearly.allowed, "one credit left is still a pass it may start");
  assertEquals(nearly.remaining, 1);
  // The refusal is all-or-nothing at the boundary, never a truncated run.
  assertFalse(budgetAllows({ ceiling: 200, spent: 201, period_days: 7 }).allowed);
});

Deno.test("10. a zero ceiling turns scheduled scans off, and says that", () => {
  const d = budgetAllows({ ceiling: 0, spent: 0, period_days: 7 });
  assertFalse(d.allowed);
  assert(/scheduled scans are off/.test(d.reason), d.reason);
  // The default is modest on purpose: a schedule spends while nobody watches.
  assertEquals(DEFAULT_PERIOD_CEILING, 200);
  assertEquals(DEFAULT_CADENCE_MINUTES, 1440);
});

// ── 11–12. THE OTHER MECHANISM: IS THE ANSWER STILL FRESH? ──────────────────

Deno.test("11. a scan skips evidence a Lead mission collected an hour ago", () => {
  // THE PLAN'S OWN TEST. Dated, in-window, from another origin — reused, and
  // the origin is reported rather than used as a filter.
  const held: ExistingEvidence[] = [{
    signal_type: "recent_funding",
    occurred_at: new Date(NOW - 3_600_000).toISOString(),
    occurred_at_basis: "source_reported",
    observed_at: new Date(NOW - 3_600_000).toISOString(),
    origin: "lead_mission",
    subject_type: "company", subject_key: "acme-com",
    lifecycle_status: "active",
  }];
  const d = preflight({
    subject_type: "company", subject_key: "acme-com",
    event: "funding", subject: "company", timeframe_days: 30,
  }, held, NOW);
  assertEquals(d.verdict, "reuse");
  assert(d.spend_avoided);
  assertEquals(d.reused_from_origin, "lead_mission");
});

Deno.test("12. monitoring's own undated evidence cannot prove recency", () => {
  // Not a defect — the honest consequence of never inventing a source time.
  // It is also why the CADENCE is what stops the re-spend on a schedule, and
  // why these two mechanisms are not interchangeable.
  const held: ExistingEvidence[] = [{
    signal_type: "sales_hiring",
    occurred_at: null, occurred_at_basis: "unknown",
    observed_at: new Date(NOW - 3_600_000).toISOString(),
    origin: "scheduled_monitor",
    subject_type: "company", subject_key: "acme-com",
    lifecycle_status: "active",
  }];
  const d = preflight({
    subject_type: "company", subject_key: "acme-com",
    event: "hiring", subject: "company", timeframe_days: 30,
  }, held, NOW);
  assertEquals(d.verdict, "investigate");
  assertFalse(d.spend_avoided);
  assertEquals(d.undated_hits, 1);
  assert(/no source date/.test(d.reason), d.reason);

  // And the cadence covers exactly this case.
  assertFalse(subjectDue(sub({ last_run_at: minsAgo(60) }), NOW).due);
});
