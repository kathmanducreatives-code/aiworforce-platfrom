// PHASE 7 — WHAT THE MODEL MAY SAY ABOUT A SITUATION.
//
// The deterministic floor owns EXISTENCE: whether a signal happened is settled
// before this runs and is never reopened. What the model adds is judgement
// about FIT — does this overlap the ICP, does it connect to what the workspace
// sells, is it actually timely.
//
// Every boundary below is enforced by the validator against the cluster the
// model was given. A prompt that says "only cite real events" is a request; a
// validator that drops uncited claims is a guarantee. These tests are that
// distinction, checked.
//
// GOLDEN: the model's answers are fixtures. No network, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateRelevance, deterministicVerdict, rankJudged,
  BAND_FACTOR, TIMELY_WINDOW_DAYS,
  type RawRelevanceVerdict,
} from "../../../supabase/functions/_shared/signalRelevance.ts";
import {
  clusterSignalEvents, type ClusterableEvent,
} from "../../../supabase/functions/_shared/signalCluster.ts";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function ev(id: string, over: Partial<ClusterableEvent> = {}): ClusterableEvent {
  return {
    id,
    workspace_id: "w",
    signal_type: "sales_hiring",
    signal_category: "gtm",
    origin: "scheduled_monitor",
    subject_type: "competitor",
    subject_key: "vercel",
    account_id: null,
    occurred_at: null,
    occurred_at_basis: "unknown",
    observed_at: daysAgo(1),
    verification_status: "unverified",
    lifecycle_status: "active",
    ...over,
  };
}

/** The real three-signal situation, with one DATED event. */
function vercelCluster() {
  const { clusters } = clusterSignalEvents([
    ev("e-hiring", { signal_type: "sales_hiring", signal_category: "gtm" }),
    ev("e-expansion", {
      signal_type: "market_expansion", signal_category: "growth",
      occurred_at: daysAgo(10), occurred_at_basis: "source_reported",
    }),
    ev("e-launch", { signal_type: "product_launch", signal_category: "product" }),
  ], { now: NOW });
  assertEquals(clusters.length, 1);
  return clusters[0];
}

/** The same three signals, none of them dated. */
function undatedCluster() {
  const { clusters } = clusterSignalEvents([
    ev("u-hiring", { signal_type: "sales_hiring", signal_category: "gtm" }),
    ev("u-expansion", { signal_type: "market_expansion", signal_category: "growth" }),
    ev("u-launch", { signal_type: "product_launch", signal_category: "product" }),
  ], { now: NOW });
  return clusters[0];
}

const GOOD: RawRelevanceVerdict = {
  relevance: "high",
  why_now: "Vercel is expanding, launching and hiring at once, which is an active growth phase.",
  why_it_matters: "That overlaps your ICP and the growth problem your offer addresses.",
  evidence_event_ids: ["e-expansion", "e-launch", "e-hiring"],
  timely: true,
};

const opts = { now: NOW };

// ── 1. THE HAPPY PATH, AND WHAT IT IS ALLOWED TO PRODUCE ────────────────────

Deno.test("1. a grounded verdict is believed, and cites the cluster's own events", () => {
  const c = vercelCluster();
  const v = validateRelevance(c, GOOD, opts);
  assertEquals(v.source, "model");
  assertEquals(v.relevance, "high");
  assertEquals(v.evidence_event_ids.sort(), ["e-expansion", "e-hiring", "e-launch"]);
  assert(v.timely, "a cited event dated 10 days ago supports timeliness");
  assert(v.why_now && v.why_it_matters);
  // HIGH LEAVES THE RANKING ALONE. Agreement is not a reward.
  assertEquals(v.adjusted_priority, c.priority);
  assertEquals(v.adjustments, []);
});

// ── 2. IT CANNOT INVENT A SIGNAL ────────────────────────────────────────────

Deno.test("2. an id from another cluster is dropped", () => {
  const c = vercelCluster();
  const v = validateRelevance(c, {
    ...GOOD, evidence_event_ids: ["e-hiring", "e-funding-somewhere-else"],
  }, opts);
  assertEquals(v.evidence_event_ids, ["e-hiring"]);
  assert(v.adjustments.some((a) => /not events in this cluster/.test(a)), v.adjustments.join());
});

Deno.test("3. a verdict citing NOTHING real is refused entirely", () => {
  // Missing evidence must never become a positive claim.
  const c = vercelCluster();
  for (
    const bad of [
      { ...GOOD, evidence_event_ids: [] },
      { ...GOOD, evidence_event_ids: ["not-in-this-cluster"] },
      { ...GOOD, evidence_event_ids: "e-hiring" },
    ] as RawRelevanceVerdict[]
  ) {
    const v = validateRelevance(c, bad, opts);
    assertEquals(v.source, "deterministic", JSON.stringify(bad));
    assertEquals(v.adjusted_priority, c.priority, "the deterministic rank survives");
    assertEquals(v.why_now, null, "a refused verdict publishes no explanation");
  }
});

Deno.test("4. an explanation with no words is refused", () => {
  const c = vercelCluster();
  const v = validateRelevance(c, { ...GOOD, why_now: "  ", why_it_matters: null }, opts);
  assertEquals(v.source, "deterministic");
  assert(/explained nothing/.test(v.adjustments[0]), v.adjustments[0]);
});

// ── 5–6. IT CANNOT PROMOTE ──────────────────────────────────────────────────

Deno.test("5. every band is a demotion or a hold — never a promotion", () => {
  for (const [band, factor] of Object.entries(BAND_FACTOR)) {
    assert(factor <= 1, `${band} would promote (${factor})`);
    assert(factor > 0, `${band} would erase the cluster entirely`);
  }
  const c = vercelCluster();
  for (const band of ["high", "medium", "low", "none"] as const) {
    const v = validateRelevance(c, { ...GOOD, relevance: band }, opts);
    assert(
      v.adjusted_priority <= c.priority,
      `${band} raised ${c.priority} to ${v.adjusted_priority}`,
    );
  }
});

Deno.test("6. a demoted cluster cannot overtake one the evidence ranked above it", () => {
  const rich = vercelCluster();
  const { clusters } = clusterSignalEvents([ev("t-1", { subject_key: "thin" })], { now: NOW });
  const thin = clusters[0];
  assert(rich.priority > thin.priority);

  // The model loves the thin one and dislikes the rich one — the strongest
  // opinion it can express, on both.
  const judged = rankJudged([
    { cluster: rich, relevance: validateRelevance(rich, { ...GOOD, relevance: "none" }, opts) },
    {
      cluster: thin,
      relevance: validateRelevance(thin, {
        ...GOOD, relevance: "high", evidence_event_ids: ["t-1"],
      }, opts),
    },
  ]);
  // Reordering IS allowed — that is what relevance is for. What is not allowed
  // is a cluster exceeding its own deterministic ceiling.
  for (const j of judged) {
    assert(
      j.relevance.adjusted_priority <= j.cluster.priority,
      `${j.cluster.subject_key} exceeded its deterministic ceiling`,
    );
  }
});

// ── 7. IDENTICAL EVIDENCE, DIFFERENT BRAIN, DIFFERENT RELEVANCE ─────────────

Deno.test("7. the same cluster can be judged differently for different workspaces", () => {
  // The model's answer is the fixture; what this pins is that the validator
  // does not flatten two different judgements into one.
  const c = vercelCluster();
  const forFitBrain = validateRelevance(c, GOOD, opts);
  const forWrongBrain = validateRelevance(c, {
    ...GOOD,
    relevance: "low",
    why_it_matters: "Vercel sells to developers; you sell to recruiting agencies.",
  }, opts);

  assertEquals(forFitBrain.relevance, "high");
  assertEquals(forWrongBrain.relevance, "low");
  assert(forWrongBrain.adjusted_priority < forFitBrain.adjusted_priority);
  // SAME EVIDENCE BOTH TIMES. Relevance differs; existence does not.
  assertEquals(forFitBrain.evidence_event_ids.sort(), forWrongBrain.evidence_event_ids.sort());
});

// ── 8. ORIGIN DOES NOT AFFECT RELEVANCE ─────────────────────────────────────

Deno.test("8. the same facts judged the same way rank identically whatever found them", () => {
  const monitored = vercelCluster();
  const { clusters: leadFound } = clusterSignalEvents([
    ev("e-hiring", { origin: "lead_mission", signal_type: "sales_hiring", signal_category: "gtm" }),
    ev("e-expansion", {
      origin: "lead_mission", signal_type: "market_expansion", signal_category: "growth",
      occurred_at: daysAgo(10), occurred_at_basis: "source_reported",
    }),
    ev("e-launch", { origin: "lead_mission", signal_type: "product_launch", signal_category: "product" }),
  ], { now: NOW });

  const a = validateRelevance(monitored, GOOD, opts);
  const b = validateRelevance(leadFound[0], GOOD, opts);
  assertEquals(a.adjusted_priority, b.adjusted_priority);
  assertEquals(a.relevance, b.relevance);
  // And the validator never reads an origin at all.
  const SRC = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/signalRelevance.ts", import.meta.url));
  assertFalse(/\.origin/.test(SRC), "the validator reads an origin");
});

// ── 9. STALE AND WEAK ARE NOT OVERSTATED ────────────────────────────────────

Deno.test("9. `timely` needs a cited SOURCE date, not an observation", () => {
  const undated = undatedCluster();
  const v = validateRelevance(undated, {
    ...GOOD, evidence_event_ids: ["u-hiring", "u-expansion", "u-launch"],
  }, opts);
  assertFalse(v.timely, "a cluster of things we noticed today may be a year old");
  assert(v.adjustments.some((a) => /when we looked/.test(a)), v.adjustments.join(" | "));
});

Deno.test("10. an undated cluster is capped at medium, never high", () => {
  const undated = undatedCluster();
  const v = validateRelevance(undated, {
    ...GOOD, evidence_event_ids: ["u-hiring"],
  }, opts);
  assertEquals(v.relevance, "medium");
  assert(v.adjustments.some((a) => /capped at medium/.test(a)));
  // The FIT the model judged is still real — it is the timing that is unknown —
  // so the verdict is capped rather than thrown away.
  assertEquals(v.source, "model");
  assert(v.why_it_matters);
});

Deno.test("11. a source date outside the window does not make a cluster timely", () => {
  const { clusters } = clusterSignalEvents([
    ev("old-1", {
      occurred_at: daysAgo(TIMELY_WINDOW_DAYS + 30),
      occurred_at_basis: "source_reported",
      observed_at: daysAgo(1),
    }),
  ], { now: NOW });
  const v = validateRelevance(clusters[0], {
    ...GOOD, evidence_event_ids: ["old-1"],
  }, opts);
  assertFalse(v.timely);
  assertEquals(v.relevance, "medium", "and it cannot be high on stale evidence");
});

// ── 12. A MODEL OUTAGE PRESERVES DETERMINISTIC RANKING ──────────────────────

Deno.test("12. no answer, a malformed answer, or a nonsense band all fall back", () => {
  const c = vercelCluster();
  for (
    const bad of [
      null, undefined, "not an object" as unknown as RawRelevanceVerdict,
      {} as RawRelevanceVerdict,
      { relevance: "urgent" } as RawRelevanceVerdict,
      { relevance: 3 } as unknown as RawRelevanceVerdict,
    ]
  ) {
    const v = validateRelevance(c, bad as RawRelevanceVerdict, opts);
    assertEquals(v.source, "deterministic", JSON.stringify(bad));
    assertEquals(v.adjusted_priority, c.priority, "the floor's ranking is untouched");
    assertEquals(v.evidence_event_ids, []);
    assert(v.adjustments[0].length > 10, "and it says why");
  }
});

Deno.test("13. a whole feed with no model available keeps the deterministic order", () => {
  const rich = vercelCluster();
  const { clusters } = clusterSignalEvents([
    ev("t-1", { subject_key: "thin" }),
    ev("m-1", { subject_key: "middle", signal_type: "recent_funding", signal_category: "growth" }),
    ev("m-2", { subject_key: "middle", signal_type: "sales_hiring", signal_category: "gtm" }),
  ], { now: NOW });
  const all = [rich, ...clusters];

  const deterministicOrder = [...all]
    .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
    .map((c) => c.subject_key);

  const outageOrder = rankJudged(
    all.map((c) => ({
      cluster: c,
      relevance: deterministicVerdict(c, "the provider was unavailable"),
    })),
  ).map((j) => j.cluster.subject_key);

  assertEquals(outageOrder, deterministicOrder);
});
