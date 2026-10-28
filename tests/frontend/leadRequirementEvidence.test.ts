// The Leads page shows what each hard requirement rests on, from the evidence
// the engine persists on the lead row (`canonical_decision.hard_evidence`):
// the named provider, never an engine rule, and "independently confirmed" only
// when two independent sources agree. Pure; no DOM.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { providerName, requirementEvidenceLines, requirementEvidenceOf } from "../../src/lib/leadLibrary/requirementEvidence.ts";

const ev = (o: Record<string, unknown>) => ({ dimension: "funding", result: "pass", reason: "", source: null,
  providers: [], corroborated: false, method: "provider_field", status: "proven", confidence: "medium", url: null, excerpt: null, ...o });

Deno.test("one provider's record is 'reported by <provider>', never independently confirmed", () => {
  const [l] = requirementEvidenceLines({ canonical_decision: { hard_evidence: [ev({
    source: "apify_funding_atomus", providers: ["apify_funding_atomus"],
    reason: "a verified funding event (series_a) was announced 2026-08-29, 60 day(s) ago" })] } });
  assertEquals(l.standing, "provider_reported");
  assertEquals(l.headline, "Funding · Reported by Atomus funding data (via Apify) · not independently confirmed");
  assertEquals(l.detail, "a funding event (series_a) was announced 2026-08-29, 60 day(s) ago", "no 'verified' in the detail");
});

Deno.test("two independent origins agreeing is the only 'independently confirmed'", () => {
  const [l] = requirementEvidenceLines({ canonical_decision: { hard_evidence: [ev({
    source: "funding_corroboration", providers: ["apify_funding_atomus", "apify_funding_pvalyou"], corroborated: true,
    reason: "a verified funding event (seed) was announced" })] } });
  assertEquals(l.standing, "independently_verified");
  assert(l.headline.startsWith("Funding · Independently confirmed ("), l.headline);
  assertEquals(l.providers, ["Atomus and Pvalyou, cross-checked", "Atomus funding data (via Apify)", "Pvalyou company record (via Apify)"]);
});

Deno.test("a rule over a provider's data names the provider and says the rule checked it", () => {
  const [l] = requirementEvidenceLines({ canonical_decision: { hard_evidence: [ev({
    dimension: "hiring", source: "apify_linkedin_job_search", providers: ["apify_linkedin_job_search"], checked_by_rule: true,
    method: "deterministic_derivation", reason: "hiring is proven by deterministic_verdict", url: "https://www.linkedin.com/jobs/view/1" })] } });
  assertEquals(l.headline, "Hiring · Reported by LinkedIn job posting (via Apify) · checked against the requirement by Agentory, not independently confirmed");
  assertFalse(/deterministic_verdict|proven|verified/.test(l.detail), l.detail);
  assertEquals(l.url, "https://www.linkedin.com/jobs/view/1");
});

Deno.test("an older row that recorded only an engine rule shows no rule name and claims nothing", () => {
  const [l] = requirementEvidenceLines({ canonical_decision: { hard_evidence: [{
    dimension: "hiring", result: "pass", reason: "hiring is proven by deterministic_verdict", source: "deterministic_verdict",
    method: "deterministic_derivation", status: "proven", confidence: "high", url: null, excerpt: null }] } });
  assertEquals(l.standing, "provider_reported");
  assertEquals(l.providers, []);
  assertFalse(/deterministic_verdict/.test(`${l.headline} ${l.detail}`), `${l.headline} — ${l.detail}`);
  assert(l.headline.includes("provider not recorded"), l.headline);
  assertEquals(providerName("deterministic_verdict"), null);
});

Deno.test("missing and failed requirements are shown as such", () => {
  const lines = requirementEvidenceLines({ canonical_decision: { hard_evidence: [
    ev({ result: "unknown", source: "apify_funding_atomus", reason: "no funding record was retrieved" }),
    ev({ dimension: "hiring", result: "fail", reason: "posting older than 30 days" }),
  ] } });
  assertEquals(lines.map((l) => [l.standing, l.headline]),
    [["missing", "Funding · Evidence missing"], ["not_met", "Hiring · Not met"]]);
});

Deno.test("malformed or absent evidence yields nothing, never a guessed line", () => {
  assertEquals(requirementEvidenceOf(null), []);
  assertEquals(requirementEvidenceOf({ canonical_decision: { hard_evidence: "x" } }), []);
  assertEquals(requirementEvidenceOf({ canonical_decision: { hard_evidence: [{ dimension: 7, result: "pass" }] } }), []);
});

Deno.test("wiring: the canonical Leads view turns requirement evidence into sources with headlines", () => {
  const view = Deno.readTextFileSync(new URL("../../src/lib/leadLibrary/canonicalLeadView.ts", import.meta.url));
  assert(view.includes("requirementEvidenceLines(jsonbOf(lc))"));
  assert(view.includes('discoveryMethod: line.providers.join(", ") || null'), "the source line names providers, never a rule");
  const row = Deno.readTextFileSync(new URL("../../src/lib/leadLibrary/canonicalLeadRow.ts", import.meta.url));
  assert(row.includes("headline: s.headline ?? null"));
});
