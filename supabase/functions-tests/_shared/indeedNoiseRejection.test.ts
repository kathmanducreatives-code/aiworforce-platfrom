// PROVIDER NOISE MUST NOT REACH THE QUALIFIED-LEAD FUNNEL.
//
// Production plan 43fb7313 sent Indeed a correct semantic query —
// "Sales Operations OR Revenue Operations OR GTM Operations" — with no
// Founder/CEO contamination and no generic operations terms. Indeed's own OR
// full-text matching returned rows like "Onsite Store Consultant" and "Retail
// Warehouse Associate" anyway.
//
// The title-family gate already rejects all of them, which is why the round
// reported 1 title-family pass out of 18 rather than 18. These tests lock that
// behaviour so a future broadening change cannot quietly admit the noise, and so
// the distinction between "the query was wrong" and "the provider is loose" stays
// documented.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyJobFamily } from "../../functions/_shared/jobFamily.ts";

/** The families a Sales/Revenue/GTM Operations mission accepts. */
const REQUESTED = ["sales_ops", "rev_ops", "gtm_ops"];

const accepts = (title: string) => REQUESTED.includes(classifyJobFamily(title, null).family);

// ============================================ 15. the noise is rejected =====

Deno.test("15. unrelated Indeed rows fail title-family qualification", () => {
  // Verbatim from the production result set.
  for (const noise of [
    "Onsite Store Consultant",
    "Retail Warehouse Associate",
    "Production Associate",
    "Strategy and Operations Principal",
  ]) {
    assertFalse(accepts(noise), `"${noise}" reached the qualified-lead funnel`);
  }
});

Deno.test("15b. operations families that are not revenue operations are rejected", () => {
  for (const other of [
    "warehouse operations",
    "store operations",
    "manufacturing operations",
    "Warehouse Operations Manager",
    "Plant Operations Lead",
  ]) {
    assertFalse(accepts(other), `"${other}" was accepted as a revenue-operations role`);
  }
});

Deno.test("generic Strategy and Operations never passes the requested family", () => {
  // The phrase matches no operations family at all, so it is rejected outright —
  // stricter than "rejected without evidence", and deliberately left that way.
  // Admitting it on description evidence alone would re-open the door the
  // `Growth Operations` fix closed: "Central Strategy and Operations Analyst,
  // YouTube" and "Head of User Growth Strategy & Operations" both appeared in
  // production job sets and neither is a revenue-operations role.
  for (const generic of [
    "Strategy and Operations",
    "Strategy and Operations Principal",
    "Central Strategy and Operations Analyst",
    "Head of User Growth Strategy & Operations",
    "Customer Strategy and Operations",
  ]) {
    assertFalse(accepts(generic), `"${generic}" passed the requested family`);
  }
  // The qualifying forms are the ones that NAME the function, and they pass.
  assert(accepts("Sales Strategy and Operations"));
  assert(accepts("Revenue Strategy and Operations"));
});

// -------------------------------------------- 16. the real roles still pass --

Deno.test("16. exact Sales/Revenue/GTM Operations titles pass", () => {
  for (const [title, family] of [
    ["Sales Operations", "sales_ops"],
    ["Sales Operations Manager", "sales_ops"],
    ["Manager, Sales Operations", "sales_ops"],
    ["Revenue Operations", "rev_ops"],
    ["Revenue Operations Manager", "rev_ops"],
    ["RevOps Lead", "rev_ops"],
    ["GTM Operations", "gtm_ops"],
    ["GTM Operations Manager", "gtm_ops"],
    ["Go-to-Market Operations Lead", "gtm_ops"],
  ] as [string, string][]) {
    assertEquals(classifyJobFamily(title, null).family, family, title);
  }
});

Deno.test("hiring titles and decision-maker roles never cross", () => {
  // A decision-maker title is not a hiring-family match: Founder/CEO must never
  // be searchable as a job title, and the gate must not admit them either.
  for (const dm of ["Founder", "Co-Founder", "CEO", "Chief Executive Officer", "President"]) {
    assertFalse(accepts(dm), `"${dm}" was treated as a hiring-family role`);
  }
});

Deno.test("the production noise ratio is reproducible", () => {
  // 18 deduplicated rows reached the gate and 1 passed. A representative slice of
  // that set, proving the gate is what produced the ratio.
  const sample = [
    "Sales Operations Manager",          // the one that passed
    "Onsite Store Consultant",
    "Retail Warehouse Associate",
    "Production Associate",
    "Strategy and Operations Principal",
  ];
  assertEquals(sample.filter(accepts).length, 1);
});
