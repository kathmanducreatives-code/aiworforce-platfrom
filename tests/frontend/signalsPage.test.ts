// Signals recovery · the Signals page presenter: every canonical signal type has a view with its
// provenance; tabs, counters and filters come from ONE classifier; review status filters; fixture
// rows are labelled; a scan with no configured source says "nothing ran". [TEST FIXTURE] data only.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalEventRow } from "../../src/lib/signalEventProjection.ts";
import { matchesCategory, matchesReview, signalCounters, signalTab, signalView } from "../../src/lib/signalCardView.ts";
import { radarScanOutcome } from "../../src/lib/radarScanOutcome.ts";

const row = (id: string, signal_type: string, over: Record<string, unknown> = {}) => normalizeSignalEventRow({
  id, workspace_id: "ws", signal_type, signal_category: "growth", origin: "lisa_monitor", subject_type: "company",
  subject_key: `${id}.example.test`, occurred_at: "2026-11-25T00:00:00Z", occurred_at_basis: "source_reported",
  observed_at: "2026-11-27T09:00:00Z", verification_status: "provider_verified", confidence: "medium", provider: "fixture",
  source_url: `https://news.example.test/${id}`, legacy_signal_id: null, lifecycle_status: "active",
  normalized_value: { lisa: { company: { name: `[TEST FIXTURE] ${id}` }, title: `${signal_type} event`, event_date: "2026-11-25",
    verification: { level: "corroborated" }, relevance: { band: "high", reasons: ["Matches your target industry: Manufacturing"] },
    evidence: [{ excerpt: "opens a new plant", source_type: "news" }] } },
  ...over,
} as never);

const LISA_TYPES: Array<[string, string, string]> = [
  ["geographic_expansion", "expansion", "other"], ["market_expansion", "expansion", "other"], ["sales_hiring", "hiring", "hiring"],
  ["recent_funding", "funding", "other"], ["new_revenue_leader", "leadership", "other"], ["product_launch", "launch", "other"],
  ["new_integration", "technology", "other"],
];

Deno.test("every LISA canonical type has a card view with full provenance (none invisible)", () => {
  for (const [t, cat, tab] of LISA_TYPES) {
    const s = row(t, t);
    const v = signalView(s);
    assertEquals(v.category, cat, t);
    assertEquals(signalTab(s), tab, t);
    assertEquals(v.store, "signal_events");
    assertStringIncludes(v.company ?? "", "[TEST FIXTURE]");
    assertEquals(v.verification.tone, "verified");
    assertEquals(v.eventDate, "2026-11-25");
    assertEquals(v.relevance.band, "high");
    assertEquals(v.excerpt, "opens a new plant");
    assert(v.isFixture, "fixture provider is labelled");
    assertEquals(v.gaps, []);
  }
});

Deno.test("counters equal the tab contents; category and review filters work", () => {
  const signals = [row("a", "sales_hiring"), row("b", "geographic_expansion"), row("c", "product_launch", { subject_type: "competitor" })];
  const reviews: Record<string, string> = { a: "reviewed", b: "ignored" };
  const c = signalCounters(signals, (id) => reviews[id]);
  assertEquals(c.hiring, signals.filter((s) => signalTab(s) === "hiring").length);
  assertEquals(c.competitor, 1);
  assertEquals(c.reviewed, 1, "ignored is not 'reviewed'");
  assertEquals(signals.filter((s) => matchesCategory(s, "expansion")).map((s) => s.id), ["b"]);
  assertFalse(matchesReview("ignored", "all"), "ignored hidden by default");
  assert(matchesReview("ignored", "ignored"));
  assert(matchesReview(null, "unreviewed"));
});

Deno.test("an unverified or undated row says what it lacks", () => {
  const s = row("u", "market_expansion", { occurred_at_basis: "unknown", occurred_at: null, source_url: null,
    normalized_value: { lisa: { title: "maybe expanding", verification: { level: "single_source" } } } });
  const v = signalView(s);
  assertEquals(v.verification.tone, "caution");
  assert(v.gaps.includes("no source link") && v.gaps.includes("event date unknown"));
});

Deno.test("a scan with no configured source says NOTHING RAN — never 'added 0'", () => {
  const none = radarScanOutcome({ inserted: 0, per_category: { linkedin_intent: { status: "setup_needed", reason: "Firecrawl required" }, competitor: { status: "skipped" } } });
  assertEquals(none.kind, "nothing_ran");
  assertStringIncludes(none.message, "No credits were used");
  assertEquals(radarScanOutcome({ inserted: 2, per_category: { competitor: { status: "ready" } } }).kind, "added");
  assertEquals(radarScanOutcome({ inserted: 0, per_category: { competitor: { status: "ready" } } }).kind, "ran_empty");
});

// ── chat Markdown (executive brief / LISA answers) ───────────────────────────────────────────
import { looksLikeMarkdown, parseMarkdown } from "../../src/lib/miniMarkdown.ts";
Deno.test("the executive brief's Markdown is parsed into headings, bold and lists — no raw ## or **", () => {
  const brief = "## This week\n\n**Three priorities** for Northwind:\n\n1. Watch **expansion** in Ohio\n2. Track AE hiring\n\n- note one\n- note two";
  assert(looksLikeMarkdown(brief));
  const b = parseMarkdown(brief);
  assertEquals(b.map((x) => x.type), ["h", "p", "ol", "ul"]);
  assertEquals((b[1] as { inline: Array<{ text: string; bold: boolean }> }).inline[0], { text: "Three priorities", bold: true });
  assertEquals((b[2] as { items: unknown[] }).items.length, 2);
  assertFalse(JSON.stringify(b).includes("##") || JSON.stringify(b).includes("**"));
  assertFalse(looksLikeMarkdown("Plain answer with no formatting."), "plain text stays plain");
});
