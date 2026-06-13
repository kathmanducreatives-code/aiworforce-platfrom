import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalRow, buildActionCommand, signalTypeLabel } from "./signalFeedModel.ts";

Deno.test("normalizeSignalRow: maps fields + competitor metadata, no invention", () => {
  const s = normalizeSignalRow({
    id: "sig-1",
    signal_type: "competitor_engagement",
    signal_label: "Clay",
    title: "Jane — Clay",
    description: "Discussing Clay alternatives",
    source_url: "https://linkedin.com/posts/x",
    created_at: "2026-06-12T00:00:00Z",
    raw: {
      competitor_name: "Clay",
      competitor_source: "post_content",
      competitor_category: "data_enrichment",
      competitor_confidence: 0.82,
      conversation_type: "comparison",
      matched_query: "Clay alternatives for outbound",
      original_business_description: "AI outreach copilot for tiny startups",
      original_website_url: "https://screeningpilot.com",
    },
  });
  assertEquals(s.signal_type, "competitor_engagement");
  assertEquals(s.competitor_name, "Clay");
  assertEquals(s.competitor_source, "post_content");
  assertEquals(s.competitor_category, "data_enrichment");
  assertEquals(s.competitor_confidence, 0.82);
  assertEquals(s.conversation_type, "comparison");
  assertEquals(s.matched_query, "Clay alternatives for outbound");
  assertEquals(s.original_business_description, "AI outreach copilot for tiny startups");
  assertEquals(s.original_website_url, "https://screeningpilot.com");
  assertEquals(s.source_url, "https://linkedin.com/posts/x");
});

Deno.test("normalizeSignalRow: competitor_confidence only maps numbers, not strings", () => {
  const s = normalizeSignalRow({
    id: "sig-2",
    signal_type: "competitor_engagement",
    raw: { competitor_confidence: "high", competitor_category: "data_enrichment" },
  });
  assertEquals(s.competitor_confidence, null);
  assertEquals(s.competitor_category, "data_enrichment");
  assertEquals(s.matched_query, null);
  assertEquals(s.original_business_description, null);
  assertEquals(s.original_website_url, null);
});

Deno.test("normalizeSignalRow: missing fields fall back, never undefined-crash", () => {
  const s = normalizeSignalRow({ id: "x", signal_type: "linkedin_engagement" });
  assertEquals(s.title, "LinkedIn engagement");
  assertEquals(s.description, null);
  assertEquals(s.competitor_name, null);
  assertEquals(s.source_url, null);
});

Deno.test("signalTypeLabel", () => {
  assertEquals(signalTypeLabel("competitor_engagement"), "Competitor engagement");
  assertEquals(signalTypeLabel("hiring_signal"), "Hiring signal");
  assertEquals(signalTypeLabel("some_new_type"), "Some New Type");
  assertEquals(signalTypeLabel(null), "Signal");
});

Deno.test("buildActionCommand: draft-only / ask-Pilot commands", () => {
  const s = normalizeSignalRow({ id: "1", signal_type: "competitor_engagement", title: "Jane — Clay", source_url: "https://x" });
  assert(buildActionCommand("draft_comment", s).startsWith("Draft a thoughtful LinkedIn comment for this signal:"));
  assert(buildActionCommand("draft_dm", s).startsWith("Draft a soft LinkedIn DM for this lead:"));
  assert(buildActionCommand("enrich", s).startsWith("Enrich this lead/account:"));
  assertEquals(buildActionCommand("rank"), "Rank these saved signals by fit and urgency.");
  assert(buildActionCommand("create_outreach", s).includes("saved signal context"));
  // never contains an auto-send/post instruction
  for (const a of ["draft_comment", "draft_dm", "enrich", "create_outreach"] as const) {
    const cmd = buildActionCommand(a, s).toLowerCase();
    assert(!cmd.includes("automatically") && !cmd.includes("auto-"), `${a} must not auto-act`);
  }
});
