// READ-ONLY RECONCILE ASSESSMENT (roadmap 1.5): which stored Brains would the
// next save still rewrite? Pure; reuses the write paths' own reconcile.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assessBrainRow, assessBrains } from "../../../supabase/functions/_shared/companyBrainReconcile.ts";
import { applyBrainSave } from "../../../supabase/functions/_shared/companyBrainV2Save.ts";

type Raw = Record<string, unknown>;
const saved = (): Raw => applyBrainSave({}, {
  company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS" },
  target_customer: { industries: ["Fintech"], geography: [], business_models: [], funding_stage: [], must_have: [], nice_to_have: [],
    company_size: { label: "" }, disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: [], titles: [] } },
  buyer_personas: ["CFO"], pain_points: ["Slow reporting"], triggers: ["New funding"],
} as never, { activate: true }).profile;

/** What the pre-#147 Company Brain page left behind: v2 edited, legacy + radar copies stale. */
function oldPageEdit(): Raw {
  const p = saved();
  return { ...p, target_customer: { ...(p.target_customer as Raw), industries: ["Logistics"] } };
}

Deno.test("1.5-1 a row saved by the current write paths is consistent", () => {
  assertEquals(assessBrainRow("ws-ok", saved()).would_change, []);
});

Deno.test("1.5-2 a row the old page left divergent is found, with the copies that would change", () => {
  const a = assessBrainRow("ws-old", oldPageEdit());
  assert(a.would_change.includes("icp.industries"), a.would_change.join(","));
  assert(a.would_change.includes("signal_preferences.industries"), a.would_change.join(","));
});

Deno.test("1.5-3 a legacy-only row is not divergent: its legacy copy is the only truth", () => {
  const a = assessBrainRow("ws-legacy", { icp: { industries: ["Healthcare"], geography: "UK" }, signal_preferences: { industries: ["Healthcare"] } });
  assertFalse(a.structured);
  assertEquals(a.would_change, []);
});

Deno.test("1.5-4 the report carries counts, paths and ids — never a profile value", () => {
  const report = assessBrains([
    { workspace_id: "ws-ok", profile: saved() },
    { workspace_id: "ws-old", profile: oldPageEdit() },
    { workspace_id: "ws-empty", profile: null },
  ]);
  assertEquals([report.rows, report.divergent_rows], [3, 1]);
  assertEquals(report.divergent_workspace_ids, ["ws-old"]);
  assertEquals(report.by_path["icp.industries"], 1);
  const text = JSON.stringify(report);
  for (const v of ["Fintech", "Logistics", "Northwind", "CFO", "Agencies"]) assertFalse(text.includes(v), `${v} leaked into the report`);
});

Deno.test("1.5-5 dry run: the input rows are not modified", () => {
  const p = oldPageEdit();
  const before = JSON.stringify(p);
  assessBrains([{ workspace_id: "ws-old", profile: p }]);
  assertEquals(JSON.stringify(p), before);
});

Deno.test("1.5-6 the CLI is file-in, report-out: no network, no database, no write", async () => {
  const src = await Deno.readTextFile(new URL("../../../scripts/company-brain/reconcile-dry-run.ts", import.meta.url));
  for (const banned of ["createClient", "fetch(", "writeTextFile", "SUPABASE", ".update(", ".upsert("]) {
    assertFalse(src.includes(banned), `the dry run must not use ${banned}`);
  }
});
