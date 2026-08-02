// Shared job-family classifier — the single source of truth for runtime + benchmark.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyJobFamily } from "../../supabase/functions/_shared/jobFamily.ts";

const fam = (t: string, d = "") => classifyJobFamily(t, d);

Deno.test("16. Sales/Revenue/GTM Operations qualify as the Sales-Ops family", () => {
  assert(fam("Sales Operations Manager").qualifiesAsSalesOps);
  assertEquals(fam("Sales Strategy and Operations Lead").family, "sales_ops");
  assert(fam("Revenue Operations Manager").qualifiesAsSalesOps);
  assertEquals(fam("Revenue Operations Manager").family, "rev_ops");
  assert(fam("GTM Operations Lead").qualifiesAsSalesOps);
});

Deno.test("15. generic sales roles do NOT satisfy Sales Operations", () => {
  for (const t of ["Account Executive", "Account Manager", "Sales Representative", "SDR", "BDR", "Inside Sales Manager"]) {
    assertFalse(fam(t).qualifiesAsSalesOps, `${t} must not qualify`);
  }
  assertEquals(fam("Account Executive").family, "sales_generic");
});

Deno.test("commercial/business ops qualify ONLY with explicit revenue scope", () => {
  assertFalse(fam("Business Operations Manager", "office logistics and facilities").qualifiesAsSalesOps);
  assert(fam("Commercial Operations Manager", "own revenue forecasting, quota, and pipeline").qualifiesAsSalesOps);
  assert(fam("Business Operations Manager", "own the CRM, sales process, and revenue reporting").qualifiesAsSalesOps);
});

Deno.test("marketing ops without sales/revenue scope does not qualify", () => {
  assertFalse(fam("Marketing Operations Manager", "email campaigns, brand, content calendar").qualifiesAsSalesOps);
  assert(fam("Marketing Operations Manager", "own pipeline, revenue attribution, and GTM reporting").qualifiesAsSalesOps);
});

Deno.test("other operations families never qualify", () => {
  for (const t of ["Manufacturing Operations Manager", "Finance Operations Analyst", "People Operations Lead", "Customer Support Specialist"]) {
    assertFalse(fam(t).qualifiesAsSalesOps, `${t} must not qualify`);
  }
});

Deno.test("classification is deterministic + carries confidence + matched phrase", () => {
  const a = fam("Sales Operations Manager");
  const b = fam("Sales Operations Manager");
  assertEquals(a, b);
  assert(a.confidence > 0.9);
  assertEquals(a.matchedPhrase?.toLowerCase(), "sales operations");
});
