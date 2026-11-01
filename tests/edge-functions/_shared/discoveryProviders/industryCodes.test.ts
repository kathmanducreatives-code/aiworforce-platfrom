// A CLASSIFICATION CODE IS NEVER AN INDUSTRY LABEL — for every provider, at
// the provider-independent normalizer (Test L: LeadOcean's `naics_sector` "54"
// was read as the industry). Adapters keep codes apart (naicsSector /
// naicsPrimary); this holds the line if one ever hands a code over anyway,
// e.g. a people row's `company_industry`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { industryLabels, mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import type { ProviderCompany } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";

const row = (provider: ProviderCompany["provider"], industry: string[] | null): ProviderCompany =>
  ({ provider, recordId: `${provider}-1`, retrievedAt: "2026-10-31T00:00:00Z", name: "Acme", domain: "acme.example", industry });

Deno.test("industryLabels keeps labels and drops codes (NAICS sector, NAICS primary, dotted/dashed SIC-style codes)", () => {
  assertEquals(industryLabels(["54", "Software Development", "541511", "73.72", "51-1", " "]), ["Software Development"]);
  assertEquals(industryLabels(["3D Printing", "Web3"]), ["3D Printing", "Web3"], "a label containing digits is still a label");
  assertEquals(industryLabels(["54"]), null);
  assertEquals(industryLabels(null), null);
});

for (const p of ["leadocean", "apollo", "apify"] as const) {
  Deno.test(`${p}: a code handed over as an industry never becomes an industry claim`, () => {
    const merged = mergeRecords([row(p, ["54", "Technology, Information and Internet"])], []).companies[0];
    assertEquals(merged.industry.flatMap((c) => c.value), ["Technology, Information and Internet"]);
    const codesOnly = mergeRecords([row(p, ["54"])], []).companies[0];
    assertEquals(codesOnly.industry.length, 0, "no industry claim at all — the industry stays unknown, never matched");
  });
}
