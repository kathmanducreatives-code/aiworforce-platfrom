// `lead_enrichments` IS READ AS IT ACTUALLY IS.
//
// Local readiness audit, 2026-10-01: useLeadResults.ts selected the nonexistent
// `status` and `personalization_angles`, DashboardChecklist.tsx filtered on
// `status = 'enriched'`; both answered HTTP 400 (42703) and were swallowed —
// 416 production research rows never shown, "Enrich companies" pinned at 0.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LEAD_ENRICHMENT_COLUMNS, countEnrichedLeads, enrichmentForLead, enrichmentLookupFilter,
  indexLeadEnrichments, personalizationAnglesOf, type LeadEnrichmentRow,
} from "../../src/lib/leads/leadEnrichments.ts";

/** Production `information_schema.columns` for public.lead_enrichments, 2026-10-01. */
const PRODUCTION_COLUMNS = new Set([
  "id", "workspace_id", "lead_candidate_id", "account_id", "source_url", "summary",
  "pain_hypothesis", "trigger", "outreach_angle", "raw", "created_at",
]);
const selected = LEAD_ENRICHMENT_COLUMNS.split(",").map((c) => c.trim());

/** The Row block of `lead_enrichments` in the generated types. */
async function typedColumns(): Promise<Set<string>> {
  const src = await Deno.readTextFile(new URL("../../src/integrations/supabase/types.ts", import.meta.url));
  const start = src.indexOf("      lead_enrichments: {");
  assert(start > 0, "types.ts must declare lead_enrichments");
  const row = src.slice(src.indexOf("Row: {", start), src.indexOf("Insert: {", start));
  return new Set([...row.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]));
}

Deno.test("1. every column the UI selects exists in production and in the generated types", async () => {
  const typed = await typedColumns();
  for (const c of selected) {
    assert(PRODUCTION_COLUMNS.has(c), `${c} is not a production column`);
    assert(typed.has(c), `${c} is not in types.ts lead_enrichments.Row`);
  }
  assert(!selected.includes("status") && !selected.includes("personalization_angles"));
});

Deno.test("2. neither reader asks for a column the table does not have", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(`../../src/${p}`, import.meta.url));
  for (const p of ["hooks/useLeadResults.ts", "components/dashboard/DashboardChecklist.tsx"]) {
    const src = await read(p);
    const at = src.indexOf(".from('lead_enrichments'");
    assert(at > 0, `${p} still reads lead_enrichments`);
    const query = src.slice(at, src.indexOf(";", at));
    assert(query.includes(".select(LEAD_ENRICHMENT_COLUMNS)"), `${p} must select the shared production columns`);
    assert(!/status|personalization_angles/.test(query), `${p}: ${query}`);
  }
});

const row = (o: Partial<LeadEnrichmentRow>): LeadEnrichmentRow => ({
  id: crypto.randomUUID(), lead_candidate_id: null, account_id: null,
  summary: null, outreach_angle: null, created_at: "2026-09-01T00:00:00Z", ...o,
});

Deno.test("3. a lead is matched by its own row first, else by its account (how rows are written)", () => {
  const own = row({ lead_candidate_id: "L1", account_id: "A1", summary: "own" });
  const acct = row({ account_id: "A2", summary: "account" });
  const idx = indexLeadEnrichments([own, acct]);
  assertEquals(enrichmentForLead(idx, { id: "L1", account_id: "A1" })?.summary, "own");
  assertEquals(enrichmentForLead(idx, { id: "L2", account_id: "A2" })?.summary, "account");
  assertEquals(enrichmentForLead(idx, { id: "L3", account_id: null }), null);
});

Deno.test("4. the newest row wins, so re-research replaces the older summary", () => {
  const idx = indexLeadEnrichments([
    row({ account_id: "A", summary: "old", created_at: "2026-09-01T00:00:00Z" }),
    row({ account_id: "A", summary: "new", created_at: "2026-09-20T00:00:00Z" }),
    row({ account_id: "A", summary: "mid", created_at: "2026-09-10T00:00:00Z" }),
  ]);
  assertEquals(enrichmentForLead(idx, { id: "x", account_id: "A" })?.summary, "new");
});

Deno.test("5. the checklist counts LEADS with research, not rows", () => {
  const leads = [{ id: "L1", account_id: "A1" }, { id: "L2", account_id: "A2" }, { id: "L3", account_id: null }];
  const rows = [
    row({ lead_candidate_id: "L1", account_id: "A1" }),
    row({ account_id: "A1" }), // a second row for the same company is not a second lead
    row({ account_id: "A2" }), // matched through its account
  ];
  assertEquals(countEnrichedLeads(leads, rows), 2);
  assertEquals(countEnrichedLeads(leads, []), 0);
  assertEquals(countEnrichedLeads(leads, null), 0);
});

Deno.test("6. angles come from the real outreach_angle column, never invented", () => {
  assertEquals(personalizationAnglesOf(row({ outreach_angle: "Hiring a VP Sales" })), ["Hiring a VP Sales"]);
  assertEquals(personalizationAnglesOf(row({ outreach_angle: "   " })), []);
  assertEquals(personalizationAnglesOf(null), []);
});

Deno.test("7. the lookup filter covers both keys, and nothing when there is nothing to look up", () => {
  assertEquals(enrichmentLookupFilter(["L1", "L2"], ["A1"]), "lead_candidate_id.in.(L1,L2),account_id.in.(A1)");
  assertEquals(enrichmentLookupFilter(["L1"], []), "lead_candidate_id.in.(L1)");
  assertEquals(enrichmentLookupFilter([], ["A1"]), "account_id.in.(A1)");
  assertEquals(enrichmentLookupFilter([], []), null);
});
