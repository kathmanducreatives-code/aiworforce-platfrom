// PART 10 — the "first salesperson" taxonomy gap, and the blast radius of closing it.
//
// `\bsales\b` does not reach inside "salesperson"/"salespeople", so every
// first-revenue-hire phrasing resolved to NO family at all: no aliases, no
// registry titles, no safe broadening.
//
// These phrases are COMMERCIAL sales — a company's first quota-carrying hire.
// They must never acquire Sales-Operations titles.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyRoleFamily, roleFamilyAliases } from "../../functions/_shared/roleFamilies.ts";
import { inferFamilyKey, getJobFamily } from "../../functions/_shared/jobFamilyRegistry.ts";

const EARLY_SALES_PHRASES = [
  "first salesperson",
  "first sales hire",
  "founding salesperson",
  "first sales representative",
  "first business development hire",
];

Deno.test("PART 10: every early-sales phrase resolves to the commercial sales family", () => {
  for (const p of EARLY_SALES_PHRASES) {
    assertEquals(classifyRoleFamily(p), "gtm_sales", `"${p}" did not resolve`);
    assertEquals(
      classifyRoleFamily(`Find small manufacturers hiring their ${p} in Ohio`),
      "gtm_sales",
      `"${p}" did not resolve inside a full request`,
    );
  }
});

Deno.test("PART 10: no early-sales phrase is mapped to sales_operations", () => {
  for (const p of EARLY_SALES_PHRASES) {
    assertFalse(classifyRoleFamily(p) === "sales_operations", `"${p}" leaked into Sales Operations`);
    const aliases = roleFamilyAliases(classifyRoleFamily(p)).join(" ").toLowerCase();
    for (const bad of ["sales operations", "revenue operations", "gtm operations"]) {
      assertFalse(aliases.includes(bad), `"${p}" acquired the Sales-Operations title "${bad}"`);
    }
  }
});

Deno.test("PART 10: existing classifications are preserved exactly", () => {
  assertEquals(classifyRoleFamily("SDR"), "gtm_sales");
  assertEquals(classifyRoleFamily("BDR"), "gtm_sales");
  assertEquals(classifyRoleFamily("Account Executive"), "gtm_sales");
  assertEquals(classifyRoleFamily("Sales Development Representative"), "gtm_sales");
  // Sales Operations still wins over the widened gtm_sales pattern.
  for (const t of ["Sales Operations", "Revenue Operations", "RevOps", "GTM Operations", "Sales Ops"]) {
    assertEquals(classifyRoleFamily(t), "sales_operations", `${t} regressed`);
  }
});

Deno.test("PART 10: the backend registry routes early sales to manufacturing_sales", () => {
  // The registry's early/commercial sales family. Its excluded list already
  // blocks Sales-Operations titles from being proposed for it.
  for (const p of ["first salesperson", "founding salesperson", "first sales hire"]) {
    assertEquals(inferFamilyKey([], [p]), "manufacturing_sales", `"${p}" has no registry family`);
  }
  const fam = getJobFamily("manufacturing_sales")!;
  assert(fam.exact.includes("Sales Representative"));
  assert(fam.excluded.includes("Sales Operations"), "the family must exclude Sales Operations");
});

Deno.test("PART 10: sales_operations requests still reach the sales_operations registry family", () => {
  assertEquals(inferFamilyKey(["sales_ops"], ["Sales Operations"]), "sales_operations");
  assertEquals(getJobFamily("sales_operations")!.exact, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
});

Deno.test("PART 10: the widened pattern does not capture unrelated roles", () => {
  assertEquals(classifyRoleFamily("Find companies hiring software engineers"), "engineering");
  assertEquals(classifyRoleFamily("Find companies expanding FP&A teams"), "finance");
  assertEquals(classifyRoleFamily("Customer Success Manager"), "customer_success");
});
