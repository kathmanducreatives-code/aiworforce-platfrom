// ROADMAP 1.4 (#165) — the seller's own facts never become the TARGET.
//
// Written as pending acceptance tests by the Company Brain owner; the fix
// (companyBrainCompiler.ts C1/C2/C4, both normalizers C3) made them pass and
// the `ignore` switch is gone, so they run on every build.
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

const brain = (company: Record<string, unknown>, size: Record<string, unknown> = { min: 50, max: 200, label: "" }) => ({
  schema_version: 2, company: { name: "Northwind", ...company },
  target_customer: { industries: ["Fintech"], geography: ["United States"], company_size: size },
});
const compiled = (p: Record<string, unknown>) => compileCompanyBrainContext({ workspace_id: "ws", profile: p }).icp;

Deno.test({ name: "1.4-1 a structured target range wins over the seller's own team size", fn() {
  for (const team_size of ["11-50", "24", "11–50 employees"]) {
    const icp = compiled(brain({ team_size }));
    assertEquals([icp.company_size_min, icp.company_size_max], [50, 200], `team_size ${team_size}`);
  }
}});

Deno.test({ name: "1.4-2 with no target size at all, lead search has no size filter (never the seller's)", fn() {
  const icp = compiled(brain({ team_size: "11-50" }, {}));
  assertEquals([icp.company_size_min ?? null, icp.company_size_max ?? null], [null, null]);
}});

Deno.test({ name: "1.4-3 the seller's own location is not a target geography", fn() {
  assertEquals(compiled(brain({ location: "London" })).locations, ["United States"]);
}});

Deno.test({ name: "1.4-4 backend and page normalizers agree, and neither reads team_size as the target", fn() {
  const p = brain({ team_size: "24" }, {});
  assertEquals(normalizeCompanyBrain(p).target_customer.company_size.label, "");
  assertEquals(normalizeForPage(p).target_customer.company_size.label, "");
}});

Deno.test({ name: "1.4-5 a legacy icp.company_size is still honoured (it is a TARGET field)", fn() {
  const icp = compiled({ company: { team_size: "11-50" }, icp: { company_size: "200-1000 employees", industries: ["Fintech"] } });
  assertEquals([icp.company_size_min, icp.company_size_max], [200, 1000]);
}});

// C4 (found 2026-10-23 by the Phase 5 page agreement test): onboarding and the
// #147 mirror write `icp.disqualifiers` as ALL five buckets flattened, and the
// compiler reads that legacy list as excluded INDUSTRIES (companyBrainCompiler.ts
// :222). A keyword, title or company-type exclusion therefore also excludes an
// "industry" of that name in lead search and joins its negative terms.
Deno.test({ name: "1.4-6 a keyword or title exclusion is not an excluded industry", fn() {
  const p = {
    schema_version: 2, company: { name: "Northwind" },
    target_customer: { industries: ["Fintech"], disqualifiers: { industries: ["Agencies"], company_types: ["Reseller"], domains: [], keywords: ["crypto"], titles: ["Intern"] } },
    icp: { industries: ["Fintech"], disqualifiers: ["Agencies", "Reseller", "crypto", "Intern"] }, // what the mirror writes
  };
  const ctx = compileCompanyBrainContext({ workspace_id: "ws", profile: p });
  assertEquals(ctx.disqualifiers.industries.map((x: string) => x.toLowerCase()).sort(), ["agencies"]);
}});
