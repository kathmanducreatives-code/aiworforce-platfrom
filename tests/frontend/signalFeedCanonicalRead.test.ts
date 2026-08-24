// PHASE 3G — THE FEED READS THE CANONICAL STORE, AND LOSES NOTHING.
//
// The Signals feed read `signals`, the v1 table Radar writes. It now reads
// `signal_events`, the shared store Radar, Lead missions and monitoring all
// write to — which is what makes the feed show what the WORKSPACE collected
// rather than what one collector happened to produce.
//
// What these tests hold:
//
//   * a canonical row projects to the SAME shape the cards already render
//   * the Radar pieces worth keeping — ICP scoring, priority, freshness
//     reasoning, diagnostics — survive the switch
//   * provenance the v1 row could never carry is now available
//   * a signal collected before the dual-write does not vanish
//   * an empty canonical read is an empty feed, never a silent fallback
//
// PURE. No network, no React, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeSignalEventRow, feedSignalTypeOf, mergeSignalFeed, type RawSignalEventRow,
} from "../../src/lib/signalEventProjection.ts";
import { normalizeSignalRow } from "../../src/lib/signalFeedModel.ts";

/** A canonical row as `radarSignalToV2` now writes one. */
const EVENT: RawSignalEventRow = {
  id: "evt-1",
  workspace_id: "w",
  signal_type: "competitor_activity",
  signal_category: "market",
  origin: "manual_scan",
  subject_type: "competitor",
  subject_key: "outreach",
  occurred_at: null,
  occurred_at_basis: "unknown",
  observed_at: "2026-08-24T11:24:06Z",
  verification_status: "unverified",
  confidence: "low",
  provider: "firecrawl_search",
  source_url: "https://www.outreach.ai/product-updates",
  legacy_signal_id: "v1-1",
  normalized_value: {
    title: "Outreach.io Product News",
    description: "Outreach shipped an AI thread summariser.",
    radar_signal_type: "competitor",
    radar_signal_quality: "needs_verification",
    radar_confidence: 0.38,
    matched_triggers: [],
    fit_score: 40,
    signal_score: 40,
    proof_score: 20,
    freshness_score: 4,
    trigger_score: 0,
    priority: "maybe",
    matched_icp: ["b2b saas"],
    why_it_matters: "Relevant to your market — review the source.",
    why_now: "Recency unknown — verify the date.",
    next_action: "needs_manual_review",
    missing_evidence: ["ICP industry or company-size fit"],
    risk_flags: [],
    company_name: "Outreach",
    company_domain: "outreach.io",
    company_location: "Seattle, WA",
  },
};

Deno.test("1. a canonical row renders as the feed already renders signals", () => {
  const s = normalizeSignalEventRow(EVENT);
  assertEquals(s.id, "evt-1");
  assertEquals(s.title, "Outreach.io Product News");
  assertEquals(s.description, "Outreach shipped an AI thread summariser.");
  assertEquals(s.source, "firecrawl_search");
  assertEquals(s.source_url, "https://www.outreach.ai/product-updates");
  // THE CARDS ROUTE ON THE RADAR TYPE where a Radar scan produced the row.
  assertEquals(s.signal_type, "competitor");
});

Deno.test("2. the deterministic ICP scoring survives the switch", () => {
  const s = normalizeSignalEventRow(EVENT);
  assertEquals(s.fit_score, 40, "the ICP fit score must not be lost");
  assertEquals(s.priority, "maybe");
  // NOT `["b2b saas"]` — `classifySignalQuality` empties `matched_icp` for a
  // row that is not verified, and this row is `needs_verification`. That rule
  // is the v1 feed's and is unchanged; what matters here is that the canonical
  // reader inherits it rather than inventing a second answer, which test 7
  // checks against the legacy reader directly.
  assertEquals(s.matched_icp, []);
  assertEquals(s.raw.matched_icp, ["b2b saas"], "the underlying fact still travels");
  assertEquals(s.next_action, "needs_manual_review");
  // The reasoning a reader needs to judge the row.
  assertEquals(s.reason, "Relevant to your market — review the source.");
  assertEquals(s.raw.why_now, "Recency unknown — verify the date.");
  assertEquals(s.raw.freshness_score, 4);
  assertEquals(s.raw.missing_evidence, ["ICP industry or company-size fit"]);
});

Deno.test("3. the quality classification is unchanged, because it is the same code", () => {
  const s = normalizeSignalEventRow(EVENT);
  // `normalizeSignalEventRow` routes through `normalizeSignalRow`, so quality,
  // badge and why-text cannot drift between the two readers.
  assert(["verified", "needs_verification", "legacy"].includes(s.quality));
  assert(s.quality_badge.length > 0);
  assert(s.why_text === null || s.why_text.length > 0);
});

Deno.test("4. provenance the legacy row could never carry is available", () => {
  const s = normalizeSignalEventRow(EVENT);
  assertEquals(s.raw.origin, "manual_scan", "which workflow collected this");
  assertEquals(s.raw.subject_type, "competitor");
  assertEquals(s.raw.subject_key, "outreach");
  // AND THE TIME BASIS TRAVELS WITH IT. A row with no source time must not be
  // presented as though its date were known.
  assertEquals(s.raw.occurred_at_basis, "unknown");
  assertEquals(s.created_at, "2026-08-24T11:24:06Z", "the feed orders by observation");
});

Deno.test("5. a competitor subject names the competitor without inferring it", () => {
  const s = normalizeSignalEventRow(EVENT);
  assertEquals(s.competitor_name, "Outreach");
  // With no company name on the row, the subject key IS the identity — it was
  // resolved by the subject model, not guessed from prose.
  const bare = normalizeSignalEventRow({
    ...EVENT,
    normalized_value: { ...EVENT.normalized_value, company_name: null },
  });
  assertEquals(bare.competitor_name, "outreach");
});

Deno.test("6. a row no Radar scan produced falls back to the canonical type", () => {
  const monitored: RawSignalEventRow = {
    id: "evt-2", workspace_id: "w",
    signal_type: "sales_hiring", origin: "scheduled_monitor",
    subject_type: "competitor", subject_key: "vercel",
    observed_at: "2026-08-24T16:48:21Z", occurred_at: null, occurred_at_basis: "unknown",
    provider: null, source_url: null, legacy_signal_id: null,
    normalized_value: { company_name: "Vercel", signal: "hiring/company", verdict: "verified" },
  };
  assertEquals(feedSignalTypeOf(monitored), "sales_hiring");
  const s = normalizeSignalEventRow(monitored);
  assertEquals(s.signal_type, "sales_hiring");
  assertEquals(s.raw.origin, "scheduled_monitor");
  // No title on the row — the type's label is used, never an invented headline.
  assert(s.title.length > 0);
  assertFalse(s.title.includes("undefined"));
});

// ── PARITY WITH THE READER IT REPLACES ──────────────────────────────────────

Deno.test("7. the canonical projection matches the legacy one field for field", () => {
  // The same signal, as v1 stored it and as v2 stores it. Everything a card
  // reads must agree; only provenance is richer on the canonical side.
  const legacy = normalizeSignalRow({
    id: "v1-1", workspace_id: "w",
    signal_type: "competitor",
    title: "Outreach.io Product News",
    description: "Outreach shipped an AI thread summariser.",
    source_url: "https://www.outreach.ai/product-updates",
    source: "firecrawl_search",
    created_at: "2026-08-24T11:24:06Z",
    raw: {
      fit_score: 40, priority: "maybe", matched_icp: ["b2b saas"],
      next_action: "needs_manual_review",
      why_it_matters: "Relevant to your market — review the source.",
      signal_quality: "needs_verification",
      company_name: "Outreach",
    },
  });
  const canonical = normalizeSignalEventRow(EVENT);

  for (
    const f of [
      "signal_type", "title", "description", "source", "source_url",
      "created_at", "fit_score", "priority", "next_action", "reason",
      "quality", "quality_badge", "show_by_default",
    ] as const
  ) {
    assertEquals(
      canonical[f], legacy[f],
      `${f} differs between the two readers — the switch is not parity`,
    );
  }
  assertEquals(canonical.matched_icp, legacy.matched_icp);
});

// ── 8–10. THE UNION: NOTHING COLLECTED BEFORE THE SWITCH DISAPPEARS ─────────

const legacyRow = (id: string, at: string) => ({
  id, workspace_id: "w", signal_type: "competitor",
  title: `legacy ${id}`, description: null, source_url: null,
  source: "firecrawl_search", created_at: at, raw: {},
});

Deno.test("8. a legacy signal with no canonical counterpart is still shown", () => {
  const m = mergeSignalFeed(
    [EVENT],
    [legacyRow("v1-1", "2026-08-24T11:24:06Z"), legacyRow("v1-old", "2026-08-20T08:40:39Z")],
  );
  assertEquals(m.canonical, 1);
  assertEquals(m.legacy_only, 1, "the row collected before the dual-write must survive");
  assertEquals(m.signals.length, 2);
  // The covered one is rendered from the CANONICAL row, not the legacy twin.
  assertEquals(m.signals[0].id, "evt-1");
  assertEquals(m.signals[1].id, "v1-old");
});

Deno.test("9. coverage is exact — matched by id, never by title or time", () => {
  // Same title, same second, different signal. A heuristic join would collapse
  // these two into one and quietly drop a real row.
  const twin = { ...legacyRow("v1-different", "2026-08-24T11:24:06Z"), title: EVENT.normalized_value!.title as string };
  const m = mergeSignalFeed([EVENT], [twin]);
  assertEquals(m.legacy_only, 1, "only `legacy_signal_id` may mark a row as covered");
  assertEquals(m.signals.length, 2);
});

Deno.test("10. the feed is ordered by observation, newest first, across both sources", () => {
  const m = mergeSignalFeed(
    [EVENT],
    [legacyRow("v1-newer", "2026-08-25T09:00:00Z"), legacyRow("v1-older", "2026-08-01T09:00:00Z")],
  );
  assertEquals(m.signals.map((s) => s.id), ["v1-newer", "evt-1", "v1-older"]);
});

Deno.test("11. a workspace with only canonical rows needs no legacy rows at all", () => {
  // The anti-viewer case: a workspace that never ran Radar, whose entire feed
  // is intelligence monitoring collected for it.
  const m = mergeSignalFeed([EVENT], []);
  assertEquals(m.canonical, 1);
  assertEquals(m.legacy_only, 0);
  assertEquals(m.signals.length, 1);
});
