// PHASE 5 — EVENTS BECOME SITUATIONS, AND THE JOIN KEY IS THE RISK.
//
// The plan specified: group by `account_id` over an `occurred_at` window. Read
// from the store on 2026-08-25, all thirteen events carry `account_id: NULL`
// and all thirteen carry `occurred_at: NULL` with basis `unknown`. Grouping by
// account would produce one cluster of nulls; a window over `occurred_at` would
// select nothing.
//
// That is Phase 2's rule holding, not a data gap: a market or competitor signal
// uses a real subject model rather than a borrowed account identity, and no
// source time is invented. So these tests pin the correlation the events can
// actually support, and the honesty that has to travel with it.
//
// Every test the plan named is here: three events on one account cluster;
// events on different accounts do not; stale events fall out of the window;
// priority is reproducible; a single event is a valid cluster of one; and a
// cluster mixing lead-origin and monitor-origin events forms normally with a
// priority that does not depend on origin.
//
// PURE. No network, provider, model or database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clusterSignalEvents, scoreCluster, eventTime, clusterKey,
  identityFragmentationRisk, SIGNAL_CLUSTER_VERSION,
  type ClusterableEvent,
} from "../../../supabase/functions/_shared/signalCluster.ts";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** A monitoring event as the store actually holds one: no account, no date. */
function ev(over: Partial<ClusterableEvent> = {}): ClusterableEvent {
  return {
    workspace_id: "w",
    signal_type: "sales_hiring",
    signal_category: "gtm",
    origin: "scheduled_monitor",
    subject_type: "competitor",
    subject_key: "linkedin-com-company-vercel",
    account_id: null,
    occurred_at: null,
    occurred_at_basis: "unknown",
    observed_at: daysAgo(1),
    verification_status: "unverified",
    lifecycle_status: "active",
    ...over,
  };
}

const opts = { now: NOW };

// ── 1–3. THE JOIN KEY THE EVENTS ACTUALLY CARRY ─────────────────────────────

Deno.test("1. three events on one subject form one situation", () => {
  // The real cluster sitting in the store: Vercel, watched for three signals.
  const { clusters } = clusterSignalEvents([
    ev({ signal_type: "sales_hiring", signal_category: "gtm" }),
    ev({ signal_type: "market_expansion", signal_category: "growth" }),
    ev({ signal_type: "product_launch", signal_category: "product" }),
  ], opts);

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].events.length, 3);
  assertEquals(clusters[0].signal_types, ["market_expansion", "product_launch", "sales_hiring"]);
  assertEquals(clusters[0].categories, ["growth", "gtm", "product"]);
  assertEquals(clusters[0].key_kind, "subject");
  assertEquals(clusters[0].version, SIGNAL_CLUSTER_VERSION);
});

Deno.test("2. events on different subjects do not merge", () => {
  const { clusters } = clusterSignalEvents([
    ev({ subject_key: "eulerhq-com", subject_type: "company" }),
    ev({ subject_key: "labthunder-com", subject_type: "company" }),
  ], opts);
  assertEquals(clusters.length, 2);
  assertEquals(clusters.map((c) => c.subject_key).sort(), ["eulerhq-com", "labthunder-com"]);
});

Deno.test("3. an account_id wins over the subject pair, and the kind is reported", () => {
  // Forward-looking: no event carries an account today, and when one does it is
  // the strongest identity in the system.
  const withAccount = ev({ account_id: "acct-1" });
  assertEquals(clusterKey(withAccount)?.kind, "account");
  assertEquals(clusterKey(ev())?.kind, "subject");
  // An event naming neither cannot be correlated and is never folded into
  // somebody else's situation.
  assertEquals(clusterKey(ev({ subject_type: null, subject_key: null })), null);

  const { clusters, excluded } = clusterSignalEvents([
    ev({ subject_type: null, subject_key: null }),
  ], opts);
  assertEquals(clusters.length, 0);
  assertEquals(excluded.uncorrelatable, 1);
});

Deno.test("4. two workspaces watching one competitor have two situations", () => {
  // The evidence, the ICP and the action all differ.
  const { clusters } = clusterSignalEvents([
    ev({ workspace_id: "w1" }),
    ev({ workspace_id: "w2" }),
  ], opts);
  assertEquals(clusters.length, 2);
});

// ── 5–6. THE WINDOW, AND WHICH TIME IT USES ─────────────────────────────────

Deno.test("5. stale events fall out of the window", () => {
  const { clusters, excluded } = clusterSignalEvents([
    ev({ observed_at: daysAgo(2) }),
    ev({ observed_at: daysAgo(200) }),
  ], { ...opts, window_days: 90 });
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].events.length, 1);
  assertEquals(excluded.out_of_window, 1);
});

Deno.test("6. an observation is never presented as an occurrence", () => {
  // "Three things happened this week" and "we noticed three things this week"
  // are different claims, and only one of them is about the company.
  const dated = ev({
    occurred_at: daysAgo(5), occurred_at_basis: "source_reported",
    observed_at: daysAgo(1),
  });
  assertEquals(eventTime(dated), { at: daysAgo(5), basis: "occurred" });
  assertEquals(eventTime(ev()).basis, "observed");

  const { clusters } = clusterSignalEvents([dated, ev()], opts);
  assertEquals(clusters[0].timing, { occurred: 1, observed_only: 1 });
  // A cluster with no dated event says so in its own reasons.
  const { clusters: undated } = clusterSignalEvents([ev()], opts);
  assert(
    undated[0].priority_reasons.some((r) => /every time here is an observation/.test(r)),
    undated[0].priority_reasons.join(" | "),
  );
});

// ── 7–9. PRIORITY: DETERMINISTIC, AND NOT ABOUT ORIGIN ──────────────────────

Deno.test("7. priority is reproducible", () => {
  const events = [
    ev({ signal_type: "sales_hiring", signal_category: "gtm" }),
    ev({ signal_type: "recent_funding", signal_category: "growth" }),
  ];
  const a = scoreCluster(events);
  const b = scoreCluster([...events].reverse());
  assertEquals(a.priority, b.priority, "order must not change the score");
  assertEquals(a.priority, scoreCluster(events).priority);
});

Deno.test("8. breadth outranks volume", () => {
  // Three funding rows about one company is one fact reported three times.
  const repeated = [1, 2, 3].map(() =>
    ev({ signal_type: "recent_funding", signal_category: "growth" }));
  const broad = [
    ev({ signal_type: "recent_funding", signal_category: "growth" }),
    ev({ signal_type: "sales_hiring", signal_category: "gtm" }),
  ];
  assert(
    scoreCluster(broad).priority > scoreCluster(repeated).priority,
    `broad ${scoreCluster(broad).priority} must beat repeated ${scoreCluster(repeated).priority}`,
  );
  // AND VOLUME IS CAPPED, so a chatty provider cannot outrank a real situation
  // by repeating itself. Pinned on the cap directly: fifty copies of one fact
  // may add no more than five copies would.
  const copies = (n: number) =>
    Array.from({ length: n }, () =>
      ev({ signal_type: "recent_funding", signal_category: "growth" }));
  assertEquals(
    scoreCluster(copies(50)).priority, scoreCluster(copies(5)).priority,
    "volume is uncapped — repeating one fact buys rank",
  );
  assert(
    scoreCluster(copies(50)).priority < scoreCluster(broad).priority,
    "fifty repetitions of one fact outranked two different facts",
  );
});

Deno.test("9. a cluster mixing origins forms normally, and origin does not score", () => {
  // THE PLAN'S OWN TEST, and the one that keeps this reusable by Content.
  const mixed = [
    ev({ origin: "lead_mission", signal_type: "sales_hiring", signal_category: "gtm" }),
    ev({ origin: "scheduled_monitor", signal_type: "recent_funding", signal_category: "growth" }),
  ];
  const { clusters } = clusterSignalEvents(mixed, opts);
  assertEquals(clusters.length, 1, "one situation, whatever found the parts");
  assertEquals(clusters[0].origins, { lead_mission: 1, scheduled_monitor: 1 });

  // The SAME two facts, both from one origin, must score identically.
  const singleOrigin = mixed.map((e) => ({ ...e, origin: "scheduled_monitor" }));
  assertEquals(
    scoreCluster(mixed).priority, scoreCluster(singleOrigin).priority,
    "priority changed with origin — the cluster is not origin-agnostic",
  );
  // Nothing in the reasons mentions an origin either.
  assertFalse(
    scoreCluster(mixed).reasons.some((r) => /lead|monitor|origin|radar/i.test(r)),
    scoreCluster(mixed).reasons.join(" | "),
  );
});

Deno.test("10. proven and dated outrank asserted and merely noticed", () => {
  const base = { signal_type: "recent_funding", signal_category: "growth" } as const;
  const asserted = [ev(base)];
  const proven = [ev({ ...base, verification_status: "provider_verified" })];
  const dated = [ev({ ...base, occurred_at: daysAgo(3), occurred_at_basis: "source_reported" })];
  assert(scoreCluster(proven).priority > scoreCluster(asserted).priority);
  assert(scoreCluster(dated).priority > scoreCluster(asserted).priority);
});

// ── 11–13. THE SHAPE A CONSUMER GETS ────────────────────────────────────────

Deno.test("11. a single event is a valid cluster of one", () => {
  const { clusters } = clusterSignalEvents([ev()], opts);
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].events.length, 1);
  assertEquals(clusters[0].signal_types, ["sales_hiring"]);
  assert(clusters[0].priority > 0, "a lone signal is still a situation");
});

Deno.test("12. clusters are ordered highest-priority first, and stably", () => {
  const rich = [
    ev({ subject_key: "rich", signal_type: "recent_funding", signal_category: "growth" }),
    ev({ subject_key: "rich", signal_type: "sales_hiring", signal_category: "gtm" }),
  ];
  const thin = [ev({ subject_key: "thin" })];
  const a = clusterSignalEvents([...thin, ...rich], opts).clusters.map((c) => c.subject_key);
  const b = clusterSignalEvents([...rich, ...thin], opts).clusters.map((c) => c.subject_key);
  assertEquals(a, ["rich", "thin"]);
  assertEquals(a, b, "input order must not change output order");
});

Deno.test("13. a non-active event is excluded, and counted", () => {
  const { clusters, excluded } = clusterSignalEvents([
    ev(), ev({ lifecycle_status: "dismissed" }),
  ], opts);
  assertEquals(clusters[0].events.length, 1);
  assertEquals(excluded.wrong_lifecycle, 1);
});

// ── 14. THE RISK THE PLAN NAMED ─────────────────────────────────────────────

Deno.test("14. fragmentation candidates are named, never merged", () => {
  // "Correlation is only as good as the join key." A company watched by
  // LinkedIn URL and the same company discovered by a funding round land under
  // different keys, and their situations split with nothing saying so.
  const { clusters } = clusterSignalEvents([
    ev({ subject_key: "linkedin-com-company-vercel" }),
    ev({ subject_key: "vercel-com", subject_type: "company" }),
  ], opts);
  // NOT MERGED. Guessing from string shape would join two companies sharing a
  // word — the mistake `acceptLinkedInMatch` exists to prevent.
  assertEquals(clusters.length, 2);

  const risk = identityFragmentationRisk(clusters);
  assertEquals(risk.length, 1);
  assertEquals(risk[0].token, "vercel");
  assertEquals(risk[0].keys, ["linkedin-com-company-vercel", "vercel-com"]);

  // Two genuinely different companies raise no false candidate.
  const { clusters: distinct } = clusterSignalEvents([
    ev({ subject_key: "eulerhq-com", subject_type: "company" }),
    ev({ subject_key: "labthunder-com", subject_type: "company" }),
  ], opts);
  assertEquals(identityFragmentationRisk(distinct), []);
});
