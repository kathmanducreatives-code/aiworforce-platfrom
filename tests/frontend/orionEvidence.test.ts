// The ORION Evidence panel's parser: defensive, safe links, tones, ages.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ageText, readOrionEvidence } from "../../src/lib/chat/orionEvidence.ts";

const row = (o: Record<string, unknown>) => ({ ref: "E1", subject: "Kestrel Fabrication", content: "second plant", verification: "verified",
  verification_label: "verified", date: "2026-11-05", age_days: 6, source_type: "lisa_signal", source_host: "plant-news.example",
  source_url: "https://plant-news.example/k", excluded_by: null, ...o });

Deno.test("evidence parser: reads valid rows with tones, labels and source types", () => {
  const rows = readOrionEvidence({ orion_evidence: { items: [row({}), row({ ref: "E2", verification: "contradicted", verification_label: "contradicted" }),
    row({ ref: "E3", verification: "stale" }), row({ ref: "E4", verification: "single_source", verification_label: "single source" })] } });
  assertEquals(rows.map((r) => [r.ref, r.tone]), [["E1", "verified"], ["E2", "contradicted"], ["E3", "stale"], ["E4", "single"]]);
  assertEquals(rows[0].sourceType, "LISA signal");
});

Deno.test("evidence parser: drops malformed rows and unsafe links; nothing breaks", () => {
  assertEquals(readOrionEvidence(null), []);
  assertEquals(readOrionEvidence({ orion_evidence: { items: "nope" } }), []);
  assertEquals(readOrionEvidence({ orion_evidence: { items: [{ ref: "bad" }, row({ ref: "X1" }), row({ subject: "" })] } }), []);
  assertEquals(readOrionEvidence({ orion_evidence: { items: [row({ source_url: "javascript:alert(1)" })] } })[0].sourceUrl, null);
});

Deno.test("evidence parser: ages read naturally", () => {
  assertEquals([ageText(null), ageText(0), ageText(1), ageText(130)], ["undated", "today", "1 day ago", "130 days ago"]);
});
