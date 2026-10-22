// PENDING (roadmap 1.4) — the seller's own facts must not become the TARGET.
//
// Handoff to the qualification / lead-search owner: these tests describe the
// proposed semantics and FAIL on the current compiler and normalizer. They are
// ignored by default so CI stays green; run them with
//
//   RUN_PENDING_1_4=1 deno test --allow-read --allow-env tests/edge-functions/_shared/leadSearchSellerFallbacks.pending.test.ts
//
// When the owner agrees the semantics and lands the fix, delete the `ignore`.
// Nothing in the compiler, the normalizer or Q1–Q4 is changed by this file.
//
// Evidence (2026-10-22, launch/hardening 8b0e2b6b), compileCompanyBrainContext with a
// structured target range of 50–200 and an empty label:
//   company.team_size "11-50"  → target size 11–50   (the seller's band replaces the target)
//   company.team_size "24"     → target size none    (the target range is dropped)
//   company.team_size ""       → target size 50–200  (correct)
// and company.location "London" is appended to target geographies ["United States"].
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { normalizeCompanyBrain } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as normalizeForPage } from "../../../src/lib/normalizeCompanyBrain.ts";

const ignore = Deno.env.get("RUN_PENDING_1_4") !== "1";
const brain = (company: Record<string, unknown>, size: Record<string, unknown> = { min: 50, max: 200, label: "" }) => ({
  schema_version: 2, company: { name: "Northwind", ...company },
  target_customer: { industries: ["Fintech"], geography: ["United States"], company_size: size },
});
const compiled = (p: Record<string, unknown>) => compileCompanyBrainContext({ workspace_id: "ws", profile: p }).icp;

Deno.test({ name: "1.4-1 a structured target range wins over the seller's own team size", ignore, fn() {
  for (const team_size of ["11-50", "24", "11–50 employees"]) {
    const icp = compiled(brain({ team_size }));
    assertEquals([icp.company_size_min, icp.company_size_max], [50, 200], `team_size ${team_size}`);
  }
}});

Deno.test({ name: "1.4-2 with no target size at all, lead search has no size filter (never the seller's)", ignore, fn() {
  const icp = compiled(brain({ team_size: "11-50" }, {}));
  assertEquals([icp.company_size_min ?? null, icp.company_size_max ?? null], [null, null]);
}});

Deno.test({ name: "1.4-3 the seller's own location is not a target geography", ignore, fn() {
  assertEquals(compiled(brain({ location: "London" })).locations, ["United States"]);
}});

Deno.test({ name: "1.4-4 backend and page normalizers agree, and neither reads team_size as the target", ignore, fn() {
  const p = brain({ team_size: "24" }, {});
  assertEquals(normalizeCompanyBrain(p).target_customer.company_size.label, "");
  assertEquals(normalizeForPage(p).target_customer.company_size.label, "");
}});

Deno.test({ name: "1.4-5 a legacy icp.company_size is still honoured (it is a TARGET field)", ignore, fn() {
  const icp = compiled({ company: { team_size: "11-50" }, icp: { company_size: "200-1000 employees", industries: ["Fintech"] } });
  assertEquals([icp.company_size_min, icp.company_size_max], [200, 1000]);
}});
