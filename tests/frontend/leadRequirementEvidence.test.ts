// The Leads page shows what each hard requirement rests on, with its standing,
// from the evidence the engine persists on the lead row
// (`canonical_decision.hard_evidence`). Pure; no DOM.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requirementEvidenceLines, requirementEvidenceOf } from "../../src/lib/leadLibrary/requirementEvidence.ts";

const raw = { canonical_decision: { hard_evidence: [
  { dimension: "hiring", result: "pass", reason: "hiring is proven", source: "deterministic_verdict",
    method: "deterministic_derivation", status: "proven", confidence: "high", url: "https://www.linkedin.com/jobs/view/1", excerpt: null },
  { dimension: "funding", result: "pass", reason: "series_a announced 60 days ago", source: "apify_funding_atomus",
    method: "provider_field", status: "proven", confidence: "medium", url: null, excerpt: null },
  { dimension: "geography", result: "unknown", reason: "no headquarters returned", source: null,
    method: null, status: null, confidence: null, url: null, excerpt: null },
  { dimension: 7, result: "pass" },
] } };

Deno.test("standing: a provider's field is a provider record, never 'verified'; unknown is missing", () => {
  const lines = requirementEvidenceLines(raw);
  assertEquals(lines.map((l) => [l.dimension, l.standing]), [["hiring", "verified"], ["funding", "provider_record"], ["geography", "missing"]]);
  assert(lines[1].headline.includes("provider record (apify_funding_atomus)"), lines[1].headline);
  assertEquals(lines[0].url, "https://www.linkedin.com/jobs/view/1");
});

Deno.test("malformed or absent evidence yields nothing, never a guessed line", () => {
  assertEquals(requirementEvidenceOf(null), []);
  assertEquals(requirementEvidenceOf({ canonical_decision: { hard_evidence: "x" } }), []);
  assertEquals(requirementEvidenceOf(raw).length, 3);
});

Deno.test("wiring: the canonical Leads view turns requirement evidence into sources with headlines", () => {
  const view = Deno.readTextFileSync(new URL("../../src/lib/leadLibrary/canonicalLeadView.ts", import.meta.url));
  assert(view.includes("requirementEvidenceLines(jsonbOf(lc))"));
  const row = Deno.readTextFileSync(new URL("../../src/lib/leadLibrary/canonicalLeadRow.ts", import.meta.url));
  assert(row.includes("headline: s.headline ?? null"));
});
