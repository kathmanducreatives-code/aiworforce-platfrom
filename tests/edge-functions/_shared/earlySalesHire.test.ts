import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assessEarlySalesHire } from "../../../supabase/functions/_shared/earlySalesHire.ts";

Deno.test("explicit first-hire language → confirmed", () => {
  const r = assessEarlySalesHire({ jobDescription: "This is our first sales hire; you will build out the sales function from scratch." });
  assertEquals(r.confidence, "confirmed");
  assert(r.explicit);
});

Deno.test("replacement role is NOT confirmed", () => {
  const r = assessEarlySalesHire({ jobDescription: "Replacing our departing AE on an established sales team.", hasVpSalesOrCro: true });
  assertFalse(r.confidence === "confirmed");
});

Deno.test("small company / low employee count alone is insufficient", () => {
  const r = assessEarlySalesHire({ employeeCount: 20, jobDescription: "Sales role." });
  assertEquals(r.confidence, "insufficient_evidence");
});

Deno.test("reporting to the founder alone is a signal but NOT confirmed", () => {
  const r = assessEarlySalesHire({ reportsTo: "Founder & CEO", jobDescription: "Sell our product." });
  assertFalse(r.confidence === "confirmed");
  assert(r.evidence.includes("reports_to_founder"));
});

Deno.test("an established VP Sales conflicts with a confirmed first-hire inference", () => {
  const r = assessEarlySalesHire({ jobDescription: "first sales hire to build the sales function", hasVpSalesOrCro: true });
  assertFalse(r.confidence === "confirmed"); // explicit + conflict → downgraded, never confirmed
  assert(r.evidence.includes("conflict_existing_vp_sales_or_cro"));
});

Deno.test("multiple contributing signals without explicit language → high, not confirmed", () => {
  const r = assessEarlySalesHire({ reportsTo: "Founder", jobDescription: "own the full-cycle sales process and build the pipeline from scratch", hasVpSalesOrCro: false, founderLed: true });
  assert(["high", "medium"].includes(r.confidence));
  assertFalse(r.confidence === "confirmed");
});
