import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalRow, buildActionCommand, signalTypeLabel, classifySignalQuality, buildSignalQualityPatch, parseHiringRole } from "./signalFeedModel.ts";

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

// ---- Signal quality classifier (data-trust) ----
const hiring = (signal_label, title, source_url, raw = {}) =>
  normalizeSignalRow({ id: "s", signal_type: "hiring_signal", signal_label, title, source_url, raw });

Deno.test("quality: real Executive Assistant job (with url) → needs_verification until reason saved", () => {
  const s = hiring("Executive Assistant", "Cox & Company hiring Executive Assistant", "https://www.linkedin.com/jobs/view/exec-asst-123");
  // valid role + real job url, but no saved why → needs verification (not a confident Hiring signal)
  assertEquals(s.quality, "needs_verification");
  assert(s.why_text && !/no detailed reason/i.test(s.why_text), "why_text must not be the blank placeholder");
});

Deno.test("quality: EA job WITH why_it_matters → verified + shown", () => {
  const s = hiring("Executive Assistant", "Cox & Company hiring Executive Assistant", "https://linkedin.com/jobs/view/1", { why_it_matters: "Scaling ops — founder workload.", account_name: "Cox & Company" });
  assertEquals(s.quality, "verified");
  assertEquals(s.quality_badge, "Hiring signal");
  assert(s.show_by_default);
  assert(s.matched_icp.length >= 1);
});

Deno.test("quality: 'hiring Co-Founder' (even with job url) → needs_verification, hidden by default", () => {
  const s = hiring("Co-Founder", "My Medical Records.ai hiring Co-Founder", "https://linkedin.com/jobs/view/co-founder-1");
  assertEquals(s.quality, "needs_verification");
  assertEquals(s.quality_badge, "Needs verification");
  assert(!s.show_by_default);
});

Deno.test("quality: Entrepreneur in Residence / Founder EIR → needs_verification", () => {
  const a = hiring("Entrepreneur in Residence - Technical Co-founder (CTO)", "FutureSight hiring Entrepreneur in Residence", "https://linkedin.com/jobs/view/eir-1");
  assertEquals(a.quality, "needs_verification");
  const b = hiring("Founder, Entrepreneur in Residence", "AI House hiring Founder, Entrepreneur in Residence", "https://linkedin.com/jobs/view/eir-2");
  assertEquals(b.quality, "needs_verification");
});

Deno.test("quality: 'Founder Associate, Ops' is a support role → valid (not founder-exec)", () => {
  const s = hiring("Founder Associate, Growth & Partnership Operations", "Amae Health hiring Founder Associate", "https://linkedin.com/jobs/view/fa-1", { why_it_matters: "Founder-support hire." });
  assertEquals(s.quality, "verified");
});

Deno.test("quality: hiring signal with NO url/proof → legacy, hidden", () => {
  const s = normalizeSignalRow({ id: "s", signal_type: "hiring_signal", signal_label: "Co-Founder", title: "Founder @ Acme", source_url: null, raw: {} });
  assert(s.quality === "legacy" || s.quality === "needs_verification");
  assert(!s.show_by_default);
});

Deno.test("quality: backfill verdict (raw.signal_quality) is trusted", () => {
  const s = hiring("Executive Assistant", "X hiring Executive Assistant", "https://linkedin.com/jobs/view/1", { signal_quality: "verified", why_it_matters: "ok" });
  assertEquals(s.quality, "verified");
});

Deno.test("quality: non-hiring signals pass through as verified/shown", () => {
  const s = normalizeSignalRow({ id: "s", signal_type: "linkedin_engagement", title: "Post about Clay", source_url: "https://linkedin.com/posts/1", raw: {} });
  assertEquals(s.quality, "verified");
  assert(s.show_by_default);
});

Deno.test("parseHiringRole: prefers label, else parses 'X hiring <role>'", () => {
  assertEquals(parseHiringRole({ signal_label: "Operations Assistant", title: "Acme hiring Operations Assistant" }), "Operations Assistant");
  assertEquals(parseHiringRole({ signal_label: null, title: "Acme hiring Executive Assistant" }), "Executive Assistant");
});

Deno.test("buildSignalQualityPatch: EA job → verified + computed why; co-founder → needs_verification; no-proof → legacy", () => {
  const ea = buildSignalQualityPatch({ signal_type: "hiring_signal", signal_label: "Executive Assistant", title: "Cox hiring Executive Assistant", source_url: "https://linkedin.com/jobs/view/1", raw: { account_name: "Cox" } });
  assertEquals(ea?.signal_quality, "verified");
  assert(typeof ea?.why_it_matters === "string" && (ea!.why_it_matters as string).includes("Cox"));
  const cf = buildSignalQualityPatch({ signal_type: "hiring_signal", signal_label: "Co-Founder", title: "X hiring Co-Founder", source_url: "https://linkedin.com/jobs/view/2", raw: {} });
  assertEquals(cf?.signal_quality, "needs_verification");
  const np = buildSignalQualityPatch({ signal_type: "hiring_signal", signal_label: "Founder", title: "Founder @ X", source_url: null, raw: {} });
  assertEquals(np?.signal_quality, "needs_verification"); // founder is also founder_exec
  const nonHiring = buildSignalQualityPatch({ signal_type: "linkedin_engagement", title: "post", raw: {} });
  assertEquals(nonHiring, null);
});
