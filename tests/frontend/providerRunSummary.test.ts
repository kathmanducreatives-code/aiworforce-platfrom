// The dashboard's provider summary is the BACKEND's: the view only checks the shape and
// formats. Fixture: the summary strategy_run produced for the offline comparison
// (docs/benchmarks/provider-comparison/comparison.json, written by the real executor).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { conflictsLine, contributionRows, PROVIDER_RUN_SUMMARY_VERSION, readProviderRunSummary, spendLine, totalsLine, usd } from "../../src/lib/providerRunSummary.ts";
import { PROVIDER_RUN_SUMMARY_VERSION as BACKEND_VERSION } from "../../supabase/functions/_shared/leadPipeline/providerRunSummary.ts";

const report = JSON.parse(await Deno.readTextFile(new URL("../../docs/benchmarks/provider-comparison/comparison.json", import.meta.url)));
const backend = report.v3.find((r: { mode: string }) => r.mode === "Concurrent").summary;
const response = { status: "completed", providerSummary: backend };

Deno.test("contract: the view reads exactly the backend's summary version", () => {
  assertEquals(PROVIDER_RUN_SUMMARY_VERSION, BACKEND_VERSION);
});

Deno.test("every figure shown is the backend's, unchanged (nothing re-counted on the client)", () => {
  const s = readProviderRunSummary(response)!;
  assert(s);
  assertEquals(s.totals, backend.totals);
  const rows = contributionRows(s);
  assertEquals(rows.map((r) => r.provider), backend.providers.map((p: { provider: string }) => p.provider));
  for (const [i, r] of rows.entries()) {
    const p = backend.providers[i];
    assertEquals([r.discovered, r.unique, r.qualified, r.pending, r.rejected], [p.discovered, p.unique, p.qualified, p.pending, p.rejected]);
    assertEquals(r.spend, spendLine(p.spend));
  }
  const t = backend.totals;
  assertEquals(totalsLine(s), `${t.companies} companies · ${t.qualified} qualified · ${t.pending} pending · ${t.rejected} rejected · ${t.foundByMultiple} found by more than one provider`);
  assertEquals(conflictsLine(s), "Providers disagree on industry ×1 (both values kept)");
});

Deno.test("no valid summary → nothing shown (never a guessed or zero-filled one)", () => {
  assertEquals(readProviderRunSummary({}), null);
  assertEquals(readProviderRunSummary(null), null);
  assertEquals(readProviderRunSummary({ providerSummary: { ...backend, version: "provider-run-summary-v0" } }), null);
  assertEquals(readProviderRunSummary({ providerSummary: { ...backend, totals: { ...backend.totals, qualified: -1 } } }), null);
  assertEquals(readProviderRunSummary({ providerSummary: { ...backend, providers: [{ ...backend.providers[0], spend: { apifyUsd: "0.1" } }] } }), null);
});

Deno.test("formatting: spend in both units; failures and partial steps surfaced per provider", () => {
  assertEquals(usd(0.03105), "$0.0311");
  assertEquals(usd(2.5), "$2.50");
  assertEquals(spendLine({ apifyUsd: 0, leadoceanRecords: 0 }), "no spend");
  assertEquals(spendLine({ apifyUsd: 0, leadoceanRecords: 1 }), "1 LeadOcean record");
  const failed = { ...backend, providers: [{ ...backend.providers[0], failed: true, steps: [
    { capability: "leadocean.people_search", status: "failed", reason: "upstream failure; not retried" },
    { capability: "x", status: "skipped", reason: "budget" },
  ] }] };
  const [row] = contributionRows(readProviderRunSummary({ providerSummary: failed })!);
  assertEquals(row.failures, ["leadocean.people_search: upstream failure; not retried"]);
  assertEquals(row.partial, ["x: budget"]);
  assertEquals(conflictsLine(readProviderRunSummary({ providerSummary: { ...backend, conflicts: {} } })!), null);
});
