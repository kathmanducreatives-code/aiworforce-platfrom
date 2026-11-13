// LISA V2 rows in the Signals feed: shown by default only when verified by COUNTING.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lisaFeedQuality, normalizeSignalEventRow } from "../../src/lib/signalEventProjection.ts";

const row = (level: string, over: Record<string, unknown> = {}) => ({
  id: "e1", workspace_id: "w", signal_type: "geographic_expansion", signal_category: "growth", origin: "scheduled_monitor",
  subject_type: "company", subject_key: "brightforge-robotics", occurred_at: "2026-11-06T00:00:00Z", occurred_at_basis: "source_reported",
  observed_at: "2026-11-10T12:00:00Z", verification_status: level === "corroborated" ? "provider_verified" : "unverified", confidence: "high",
  provider: "firecrawl", source_url: "https://ohio-business-journal.example/brightforge-columbus", legacy_signal_id: null, lifecycle_status: "active",
  normalized_value: { title: "Brightforge Robotics opens new manufacturing plant in Columbus, Ohio", summary: "A $60 million plant.",
    company_name: "Brightforge Robotics", lisa: { verification: { level }, relevance: { why_it_matters: "Relevant because it is in Manufacturing." } } },
  ...over,
});

Deno.test("a corroborated LISA signal is verified and shown by default, with its why", () => {
  const f = normalizeSignalEventRow(row("corroborated"));
  assertEquals(f.signal_quality ?? f.quality, "verified");
  assertEquals(f.show_by_default, true);
  assertEquals(f.why_text, "Relevant because it is in Manufacturing.");
});

Deno.test("single-source, contradicted, unsourced or non-active LISA signals are never shown as verified", () => {
  for (const [level, over] of [["single_source", {}], ["contradicted", {}], ["corroborated", { source_url: null }], ["corroborated", { lifecycle_status: "retracted" }]] as const) {
    const r = row(level, over);
    assertEquals(lisaFeedQuality(r, r.normalized_value.lisa), "needs_verification", `${level} ${JSON.stringify(over)}`);
    assertEquals(normalizeSignalEventRow(r).show_by_default, false);
  }
});
