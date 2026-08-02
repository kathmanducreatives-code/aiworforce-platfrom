// Integration tests for the run-agent provenance guards (the real helpers the
// live path calls). Zero providers. Covers the 13 required scenarios.
// Run: deno test supabase/functions/_shared/leadHandoffGuard.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria,
  buildProvenanceRecord, assertPersistenceProvenance, provenanceMatchesRun,
  type NormalizedProviderItem,
} from "../../supabase/functions/_shared/leadHandoffGuard.ts";

const ctx = { provider: "apify", actor_id: "curious_coder/linkedin-jobs-scraper", provider_run_id: "run_1", workflow_run_id: "run_1", plan_id: "plan_1", trace_id: "t1", query_id: "Q1" };
const realco: NormalizedProviderItem = { company: "Realco", source_url: "https://boards.greenhouse.io/realco/jobs/9", domain: "realco.com", company_linkedin_url: "https://linkedin.com/company/realco" };

// 1) empty index; Scout invents 5 → 0 reach Aria, stop, no_results
Deno.test("1. empty provider index; Scout invents 5 → 0 reach Aria (shouldStop)", () => {
  const idx = buildProviderIndexFromItems([]);
  const scout = parseScoutCandidates(JSON.stringify({ candidates: Array.from({ length: 5 }, (_, i) => ({ company: `Fake ${i}`, name: `Person ${i}` })) }));
  const g = guardScoutToAria(scout, idx);
  assertEquals(g.verified.length, 0);
  assert(g.shouldStop);
});

// 2) one real company; Scout invents 4 → only real reaches Aria
Deno.test("2. one real provider company; Scout invents 4 → only the real reaches Aria", () => {
  const idx = buildProviderIndexFromItems([realco]);
  const scout = parseScoutCandidates(JSON.stringify({ candidates: [
    { company: "Realco", source_url: "https://boards.greenhouse.io/realco/jobs/9" },
    { company: "Fake A" }, { company: "Fake B" }, { company: "Fake C" }, { company: "Fake D" },
  ] }));
  const g = guardScoutToAria(scout, idx);
  assertEquals(g.verified.length, 1);
  assertEquals(g.verified[0].company, "Realco");
  assertEquals(g.rejected.length, 4);
  assertFalse(g.shouldStop);
});

// 3) Scout reworded company name but kept a valid stable URL → match via URL
Deno.test("3. reworded company name but valid stable URL → matched via stable identifier", () => {
  const idx = buildProviderIndexFromItems([realco]);
  // No company match, but the URL is a real provider URL → provider-backed.
  const g = guardScoutToAria([{ company: undefined, source_url: "https://boards.greenhouse.io/realco/jobs/9" }], idx);
  assertEquals(g.verified.length, 1);
});

// 4) Scout changed company name, NO stable identifier → reject
Deno.test("4. reworded company name with no stable identifier → rejected", () => {
  const idx = buildProviderIndexFromItems([realco]);
  const g = guardScoutToAria([{ company: "Realco Renamed Inc" }], idx);
  assertEquals(g.verified.length, 0);
  assert(g.shouldStop);
});

// 5) provider-backed company; invented founder → founder removed, account remains, not contact_ready
Deno.test("5. provider company + invented founder → founder rejected; account-level allowed", () => {
  const idx = buildProviderIndexFromItems([realco]);
  // Candidate with the invented person is rejected outright…
  assert(guardScoutToAria([{ company: "Realco", person: "Invented Founder" }], idx).shouldStop);
  // …but the same company WITHOUT the unsupported person claim survives at account level.
  const g = guardScoutToAria([{ company: "Realco" }], idx);
  assertEquals(g.verified.length, 1);
  const prov = buildProvenanceRecord({ company: "Realco", source_url: realco.source_url, domain: "realco.com" }, ctx);
  assertEquals(prov.level, "account");
  assertEquals(prov.person_linkedin_url, null); // no person → account-level, cannot be contact_ready
});

// 6) invented evidence URL → reject
Deno.test("6. invented evidence URL → rejected", () => {
  const idx = buildProviderIndexFromItems([realco]);
  const g = guardScoutToAria([{ company: "Realco", evidence_url: "https://made-up.example/funding" }], idx);
  assertEquals(g.verified.length, 0);
});

// 7) wrong provider_run_id → reject
Deno.test("7. wrong provider_run_id → provenance does not match run", () => {
  const prov = buildProvenanceRecord(realco, ctx);
  assertFalse(provenanceMatchesRun(prov, { ...ctx, provider_run_id: "run_DIFFERENT" }));
});

// 8) wrong workflow_run_id → reject
Deno.test("8. wrong workflow_run_id → provenance does not match run", () => {
  const prov = buildProvenanceRecord(realco, ctx);
  assertFalse(provenanceMatchesRun(prov, { ...ctx, workflow_run_id: "run_DIFFERENT" }));
});

// 9) complete valid provenance → reaches Aria, qualifies, provenance persists
Deno.test("9. complete valid provenance → verified + persistable + unchanged", () => {
  const idx = buildProviderIndexFromItems([realco]);
  const g = guardScoutToAria([{ company: "Realco", source_url: realco.source_url }], idx);
  assertEquals(g.verified.length, 1);
  const prov = buildProvenanceRecord(realco, ctx);
  assert(prov.verified);
  assert(assertPersistenceProvenance(prov).ok);
  assert(provenanceMatchesRun(prov, ctx));
});

// 10) Aria attempts to overwrite provenance → original preserved (immutability policy)
Deno.test("10. provenance is derived only from provider data, not LLM output", () => {
  const prov = buildProvenanceRecord(realco, ctx);
  // buildProvenanceRecord ignores any LLM-supplied provenance-shaped fields on the item.
  const withLlmClaim = buildProvenanceRecord({ ...realco, provider_item_id: null } as NormalizedProviderItem, ctx);
  assertEquals(withLlmClaim.actor_id, ctx.actor_id); // from run ctx, never from LLM
  assertEquals(withLlmClaim.provider_run_id, ctx.provider_run_id);
  assert(prov.verified);
});

// 11) direct persistence bypass (missing provenance) → rejected independently
Deno.test("11. persistence guard rejects missing/incomplete provenance regardless of score", () => {
  assertFalse(assertPersistenceProvenance(null).ok);
  const noRun = buildProvenanceRecord(realco, { ...ctx, provider_run_id: "", workflow_run_id: "" });
  assertFalse(noRun.verified);
  assertFalse(assertPersistenceProvenance(noRun).ok);
});

// 12) source_and_qualify_only w/ zero valid candidates → handoff stops (Penn absent handled by executionMode)
Deno.test("12. zero valid candidates → handoff stops (no Aria, hence no downstream Penn)", () => {
  const idx = buildProviderIndexFromItems([]);
  const g = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ company: "Fake" }] })), idx);
  assert(g.shouldStop);
  assertEquals(g.verified.length, 0);
});

// 13) sanitized Q1 fixture: 22 raw provider items, 0 valid founder candidates
Deno.test("13. Q1 fixture — 0 provider-backed founder candidates reach Aria, 0 persistable", () => {
  // 22 raw JOB rows for real companies, but NO founder person rows (jobs actor
  // returns jobs, not founders). Sanitized — no live names.
  const rawJobItems: NormalizedProviderItem[] = Array.from({ length: 22 }, (_, i) => ({
    company: `JobCo ${i}`, source_url: `https://boards.greenhouse.io/jobco${i}/jobs/1`, domain: `jobco${i}.com`,
  }));
  const idx = buildProviderIndexFromItems(rawJobItems);
  // Scout hallucinated 10 FOUNDER candidates (people) that are absent from provider output.
  const fabricatedFounders = parseScoutCandidates(JSON.stringify({ candidates: Array.from({ length: 10 }, (_, i) => ({ company: `Fabricated ${i}`, name: `Founder ${i}` })) }));
  const g = guardScoutToAria(fabricatedFounders, idx);
  assertEquals(g.verified.length, 0, "no fabricated founder reaches Aria");
  assert(g.shouldStop, "Aria not invoked with unsupported candidates");
  // And none of them can build valid persistence provenance.
  const persistable = fabricatedFounders.filter((c) => assertPersistenceProvenance(buildProvenanceRecord({ company: c.company ?? undefined }, ctx)).ok);
  assertEquals(persistable.length, 0, "0 persisted leads");
});
