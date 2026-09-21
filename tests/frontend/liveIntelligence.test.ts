// LIVE INTELLIGENCE — what the dashboard bar may say, in what order.
//
// Rows are built the way the backend writes them (`radarSignalToV2` shape) and
// projected through the real `normalizeSignalEventRow`, so these tests exercise
// the same path the dashboard does.
//
// PURE. No DOM, no network, no clock of its own.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalEventRow, type RawSignalEventRow } from "../../src/lib/signalEventProjection.ts";
import { normalizeSignalRow, type FeedSignal } from "../../src/lib/signalFeedModel.ts";
import {
  rankLiveItems, contextOf, formatAgo, incomingHighlight, mergeArrivals, headlineOf, allUnverified, acceptArrival,
  LIVE_MAX_ITEMS, type LiveItem, type LiveSignalItem,
} from "../../src/lib/liveIntelligence.ts";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let n = 0;
function event(over: Partial<RawSignalEventRow> & { nv?: Record<string, unknown> } = {}): FeedSignal {
  n++;
  const { nv, ...row } = over;
  return normalizeSignalEventRow({
    id: `evt-${n}`,
    workspace_id: "w1",
    signal_type: "sales_hiring",
    signal_category: "gtm",
    origin: "manual_scan",
    subject_type: "company",
    subject_key: null,
    occurred_at: hoursAgo(2),
    occurred_at_basis: "source_reported",
    observed_at: hoursAgo(1),
    verification_status: "provider_verified",
    confidence: "high",
    provider: "firecrawl_search",
    source_url: "https://example.com/job",
    legacy_signal_id: null,
    ...row,
    normalized_value: {
      title: `Company ${n} is hiring account executives`,
      radar_signal_type: "sales_hiring",
      radar_signal_quality: "verified",
      fit_score: 80,
      priority: "warm",
      company_name: `Company ${n}`,
      ...nv,
    },
  });
}

const signals = (items: LiveItem[]) => items.filter((i): i is LiveSignalItem => i.kind === "signal");
const rank = (list: FeedSignal[], extra: Partial<Parameters<typeof rankLiveItems>[0]> = {}) =>
  rankLiveItems({ signals: list, complete: true, now: NOW, ...extra });

Deno.test("only canonical, verified, actionable rows with a real headline qualify", () => {
  const good = [event(), event(), event()];
  const legacy = normalizeSignalRow({ id: "v1", workspace_id: "w1", signal_type: "hiring", title: "Old hiring", created_at: hoursAgo(1), raw: { signal_quality: "verified" } } as never);
  const ignoredPriority = event({ nv: { priority: "ignore" } });
  const decay = event({ signal_type: "person_left_company", nv: { radar_signal_type: "person_left_company" } });
  const dismissed = event();
  const noHeadline = event({ nv: { title: null, company_name: null } });

  const keys = signals(rank([...good, legacy, ignoredPriority, decay, dismissed, noHeadline], { ignoredIds: new Set([dismissed.id]) })).map((i) => i.key);
  assertEquals(keys.sort(), good.map((s) => s.id).sort());
});

Deno.test("unverified rows fill in only when fewer than three verified exist, and say so", () => {
  const verified = [event(), event()];
  const unverified = event({ nv: { radar_signal_quality: "needs_verification" } });
  const few = signals(rank([...verified, unverified]));
  assertEquals(few.length, 3);
  assert(contextOf(few.find((i) => i.key === unverified.id)!, NOW).includes("Needs review"));

  const enough = signals(rank([...verified, event(), unverified]));
  assert(!enough.some((i) => i.key === unverified.id), "with three verified, unverified stays out");
});

Deno.test("priority, fit and freshness decide the order — freshness from when it HAPPENED", () => {
  const hotStrong = event({ nv: { priority: "hot", fit_score: 95 } });
  const warmWeak = event({ nv: { priority: "warm", fit_score: 45 } });
  // Noticed a minute ago, but the round closed three weeks ago: not fresh.
  const oldNews = event({ occurred_at: hoursAgo(24 * 21), observed_at: hoursAgo(0.02), nv: { priority: "hot", fit_score: 95 } });
  const order = signals(rank([oldNews, warmWeak, hotStrong])).map((i) => i.key);
  assertEquals(order[0], hotStrong.id);
  assertEquals(order[order.length - 1], oldNews.id);
});

Deno.test("an event without a source date falls back to when Agentory observed it", () => {
  const undated = event({ occurred_at: null, occurred_at_basis: "unknown", observed_at: hoursAgo(1), nv: { priority: "hot", fit_score: 95 } });
  const staleDated = event({ occurred_at: hoursAgo(24 * 30), nv: { priority: "hot", fit_score: 95 } });
  assertEquals(signals(rank([staleDated, undated]))[0].key, undated.id);
});

Deno.test("one slot per company; the rest are counted, not repeated", () => {
  const a1 = event({ nv: { company_name: "Linear", priority: "hot" } });
  const a2 = event({ nv: { company_name: "linear", priority: "maybe" } });
  const a3 = event({ nv: { company_name: "Linear", priority: "warm" } });
  const b = event({ nv: { company_name: "Nova Labs" } });
  const items = signals(rank([a2, b, a3, a1]));
  assertEquals(items.length, 2);
  const linear = items.find((i) => i.company === "Linear")!;
  assertEquals(linear.key, a1.id);
  assertEquals(linear.moreAtCompany, 2);
  assert(contextOf(linear, NOW).includes("+2 more at Linear"));
});

Deno.test("never three of the same type in a row when another type is available", () => {
  const hiring = [0, 1, 2, 3].map((i) => event({ nv: { priority: "hot", fit_score: 99 - i } }));
  const funding = event({ signal_type: "recent_funding", nv: { radar_signal_type: "recent_funding", priority: "maybe", fit_score: 40 } });
  const labels = signals(rank([...hiring, funding])).map((i) => i.typeLabel);
  for (let i = 2; i < labels.length; i++) {
    assert(!(labels[i] === labels[i - 1] && labels[i - 1] === labels[i - 2]) || !labels.slice(i + 1).some((l) => l !== labels[i]),
      `three in a row at ${i}: ${labels.join(", ")}`);
  }
});

Deno.test("a pattern across five companies becomes one trend; week-over-week only when data is complete", () => {
  const thisWeek = [1, 2, 3, 4, 5, 6].map((i) => event({ occurred_at: hoursAgo(i * 10), nv: { company_name: `Hirer ${i}` } }));
  const lastWeek = [1, 2, 3, 4].map((i) => event({ occurred_at: hoursAgo(24 * 8 + i), nv: { company_name: `Old ${i}` } }));

  const complete = rank([...thisWeek, ...lastWeek]).filter((i) => i.kind === "trend");
  assertEquals(complete.length, 1);
  assertEquals(complete[0].kind === "trend" && complete[0].companies, 6);
  assertEquals(contextOf(complete[0], NOW), "↑50% vs last week");

  const truncated = rank([...thisWeek, ...lastWeek], { complete: false }).filter((i) => i.kind === "trend");
  assertEquals(contextOf(truncated[0], NOW), "Across your monitored market", "a partial read may not claim a comparison");

  assertEquals(rank(thisWeek.slice(0, 4)).filter((i) => i.kind === "trend").length, 0, "four companies is not a trend");
});

Deno.test("never more than the cap, and a trend never takes the first slot", () => {
  const many = Array.from({ length: 30 }, (_, i) => event({ occurred_at: hoursAgo(i + 1), nv: { company_name: `Co ${i}` } }));
  const items = rank(many);
  assertEquals(items.length, LIVE_MAX_ITEMS);
  assertEquals(items[0].kind, "signal");
});

Deno.test("context is only stored facts — no 'null', no 'undefined', no invented numbers", () => {
  const bare = event({ nv: { fit_score: null, company_location: null } });
  const ctx = contextOf(signals(rank([bare]))[0], NOW);
  assert(!/null|undefined|NaN/.test(ctx), ctx);
  assertEquals(ctx, "Detected 1h ago");

  const rich = event({ nv: { fit_score: 94.4, company_location: "United States" } });
  assertEquals(contextOf(signals(rank([rich]))[0], NOW), "ICP fit 94 · United States · Detected 1h ago");

  // Live data ran 35–53: a weak fit is not advertised as a reason to look.
  const weak = event({ nv: { fit_score: 40 } });
  assertEquals(contextOf(signals(rank([weak]))[0], NOW), "Detected 1h ago");
});

Deno.test("an all-unverified bar says so once, not on every line", () => {
  // The live workspace today: every row needs verification.
  const pool = [1, 2, 3].map(() => event({ nv: { radar_signal_quality: "needs_verification" } }));
  const items = rank(pool);
  assert(allUnverified(items));
  const item = signals(items)[0];
  assert(contextOf(item, NOW).includes("Needs review"));
  assert(!contextOf(item, NOW, { markUnverified: false }).includes("Needs review"));
  assert(!allUnverified(rank([event(), ...pool])), "one verified item means per-item marking instead");
});

Deno.test("a headline is a real title, or company plus type — never just the category", () => {
  assertEquals(headlineOf(event({ nv: { title: "Nova Labs raised an $8.4M Seed round" } })), "Nova Labs raised an $8.4M Seed round");
  assertEquals(headlineOf(event({ nv: { title: null, company_name: "Nova Labs" } })), "Nova Labs · Sales Hiring");
  assertEquals(headlineOf(event({ nv: { title: null, company_name: null } })), null);
});

Deno.test("an arrival earns the ripple only if it ranks into the bar", () => {
  const strong = event({ nv: { priority: "hot", fit_score: 95 } });
  const items = rank([strong, event(), event()]);
  assertEquals(incomingHighlight(items, new Set([strong.id]))?.key, strong.id);
  assertEquals(incomingHighlight(items, new Set(["not-ranked"])), null);
});

Deno.test("arrivals are prepended once, never duplicated", () => {
  const a = event(), b = event(), c = event();
  assertEquals(mergeArrivals([a, b], [c, a]).map((s) => s.id), [c.id, a.id, b.id]);
  assertEquals(mergeArrivals([a], [a]).map((s) => s.id), [a.id]);
});

Deno.test("relative time reads naturally", () => {
  assertEquals(formatAgo(new Date(NOW - 20_000).toISOString(), NOW), "just now");
  assertEquals(formatAgo(hoursAgo(4 / 60), NOW), "4m ago");
  assertEquals(formatAgo(hoursAgo(3), NOW), "3h ago");
  assertEquals(formatAgo(hoursAgo(50), NOW), "2d ago");
  assertEquals(formatAgo(null, NOW), null);
});

Deno.test("a realtime row from any other workspace never reaches the bar", () => {
  assert(acceptArrival({ id: "e1", workspace_id: "w1", lifecycle_status: "active" }, "w1"));
  assert(!acceptArrival({ id: "e1", workspace_id: "w2", lifecycle_status: "active" }, "w1"), "other workspace");
  assert(!acceptArrival({ id: "e1", workspace_id: "w1", lifecycle_status: "active" }, null), "no workspace selected");
  assert(!acceptArrival({ id: "e1", workspace_id: "w1", lifecycle_status: "dismissed" }, "w1"), "not active");
  assert(!acceptArrival({ workspace_id: "w1" }, "w1"), "no id");
  assert(!acceptArrival(null, "w1"));
});

Deno.test("a subject key groups signals but is never printed as a company name", () => {
  // Live shape: competitor rows with subject_key "outreach" and no company_name.
  const c1 = event({ subject_type: "competitor", subject_key: "outreach", nv: { title: "Outreach shipped an AI summariser", company_name: null, priority: "warm" } });
  const c2 = event({ subject_type: "competitor", subject_key: "outreach", nv: { title: "Outreach changed its pricing page", company_name: null, priority: "maybe" } });
  const items = signals(rank([c1, c2]));
  assertEquals(items.length, 1, "same subject folds into one slot");
  assertEquals(items[0].company, null);
  const ctx = contextOf(items[0], NOW);
  assert(!ctx.includes("outreach"), ctx);
  assert(ctx.includes("+1 related"), ctx);
});
