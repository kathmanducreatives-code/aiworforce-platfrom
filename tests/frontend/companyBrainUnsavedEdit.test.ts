// AN INLINE EDIT REFUSED AS STALE IS KEPT AND CAN BE RE-APPLIED — ON TOP OF
// THE OTHER CHANGE, NEVER OVER IT.
//
// The page rolls back to the server's copy after a refused save. The refused
// edit is kept as field-level changes and re-applied through saveFields, which
// rebuilds the patch from the latest copy. Resending the old patch would write
// the stale section over the other tab's change. Browser-checked with the
// preview harness (?run=2&conflict=1): the re-applied removal lands and the
// other tab's new buyer persona survives. Pure.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describeUnsaved, keepUnsaved } from "../../src/lib/companyBrainUnsaved.ts";
import { buildFieldPatch } from "../../src/lib/companyBrainPatch.ts";
import { normalizeCompanyBrain } from "../../src/lib/normalizeCompanyBrain.ts";

Deno.test("U-1 refused edits accumulate per section; a later change to the same field wins", () => {
  let list = keepUnsaved([], { section: "targeting", changes: { industries: ["Logistics"] } });
  list = keepUnsaved(list, { section: "buyers", changes: { buyer_personas: ["CFO"] } });
  list = keepUnsaved(list, { section: "targeting", changes: { industries: ["Retail"], size_min: "50" } });
  assertEquals(list, [
    { section: "targeting", changes: { industries: ["Retail"], size_min: "50" } },
    { section: "buyers", changes: { buyer_personas: ["CFO"] } },
  ]);
  const titles: Record<string, string> = { targeting: "ICP / targeting", buyers: "Buyer personas" };
  assertEquals(describeUnsaved(list, (k) => titles[k]), "ICP / targeting: industries, company size · Buyer personas: buyer personas");
});

Deno.test("U-2 re-applying rebuilds the patch from the latest copy, so the other change survives", () => {
  const loaded = normalizeCompanyBrain({ schema_version: 2, target_customer: { industries: ["Fintech", "SaaS"], geography: ["US"] } });
  const latest = normalizeCompanyBrain({ schema_version: 2, target_customer: { industries: ["Fintech", "SaaS"], geography: ["US", "Canada"] } });
  const edit = { industries: ["SaaS"] };
  const stalePatch = buildFieldPatch("targeting", edit, loaded) as { target_customer: { geography: string[] } };
  const rebuilt = buildFieldPatch("targeting", edit, latest) as { target_customer: { industries: string[]; geography: string[] } };
  assertEquals(stalePatch.target_customer.geography, ["US"], "the old patch would drop Canada");
  assertEquals(rebuilt.target_customer.geography, ["US", "Canada"]);
  assertEquals(rebuilt.target_customer.industries, ["SaaS"]);
});

Deno.test("U-3 the page keeps refused edits only on a conflict and re-applies them through saveFields", async () => {
  const src = await Deno.readTextFile(new URL("../../src/pages/CompanyBrainDashboard.tsx", import.meta.url));
  assert(/lastFailureWasConflict\.current = result\.conflict === true/.test(src), "remembers why the save failed");
  assert(/else if \(lastFailureWasConflict\.current\) setUnsaved\(\(list\) => keepUnsaved\(list, \{ section, changes \}\)\)/.test(src),
    "keeps the field-level changes, not the patch");
  assert(/for \(const e of edits\) await saveFields\(e\.section, e\.changes\)/.test(src), "re-applies through the normal save");
  assertFalse(/writePatch\(e\./.test(src), "never resends a stale patch");
  assert(/disabled=\{isRefreshing\}/.test(src), "waits for the latest copy before re-applying");
});
