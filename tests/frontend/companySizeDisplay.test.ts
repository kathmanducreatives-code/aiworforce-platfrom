// THE WORKBENCH NEVER PRESENTS A LINKEDIN MEMBER COUNT AS EMPLOYEES.
//
// A LinkedIn company record carries the company's DECLARED size band and a
// count of LinkedIn members who list it (freelancers, students, alumni) — two
// different facts. The Workbench shows the band as the company's size and the
// members as members, and a pre-2026-09-24 row's single `employee_count` as a
// reported, unverified figure (src/lib/workbench/companySize.ts).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  companySizeText, declaredBandWithin, linkedinMembersText, parseDeclaredBand, readCompanySizeFacts,
} from "../../src/lib/workbench/companySize.ts";

Deno.test("the declared band is the company's size; members are only ever members", () => {
  const f = readCompanySizeFacts({ company_size_band: "11-50", linkedin_associated_members: 490 });
  assertEquals(f.declared_band, { min: 11, max: 50 });
  assertEquals(f.linkedin_members, 490);
  assertEquals(companySizeText(f), "11–50 employees (declared)");
  assertEquals(linkedinMembersText(f.linkedin_members), "490 LinkedIn members");
  assertFalse(/490 employees/.test(`${companySizeText(f)} ${linkedinMembersText(f.linkedin_members)}`));
});

Deno.test("a member count with no declared band is no company size at all", () => {
  const f = readCompanySizeFacts({ company_size_band: null, linkedin_associated_members: 2135 });
  assertEquals(companySizeText(f), null);
  assertEquals(linkedinMembersText(f.linkedin_members), "2,135 LinkedIn members");
});

Deno.test("a persisted candidate's enrichment evidence is read in the new shape", () => {
  const f = readCompanySizeFacts({ enrichment_evidence: {
    company_size_band: { min: 51, max: 200, source: "linkedin_declared" }, linkedin_associated_member_count: 77,
  } });
  assertEquals([f.declared_band, f.linkedin_members, f.legacy_reported_count], [{ min: 51, max: 200 }, 77, null]);
});

Deno.test("a legacy row's employee_count is shown as reported and unverified — never as a declared size", () => {
  const f = readCompanySizeFacts({ employee_count: 390 });
  assertEquals([f.declared_band, f.linkedin_members, f.legacy_reported_count], [null, null, 390]);
  assertEquals(companySizeText(f), "390 reported (unverified)");
  // A row already carrying the split never falls back to a stray legacy field.
  assertEquals(readCompanySizeFacts({ company_size_band: "11-50", employee_count: 390 }).legacy_reported_count, null);
});

Deno.test("bands parse from every stored shape, and filter only when wholly inside", () => {
  assertEquals(parseDeclaredBand({ start: 11, end: 50 }), { min: 11, max: 50 });
  assertEquals(parseDeclaredBand("10001+"), { min: 10001, max: null });
  assertEquals(parseDeclaredBand("50-11"), null);
  assert(declaredBandWithin({ min: 51, max: 200 }, 51, 200));
  assertFalse(declaredBandWithin({ min: 11, max: 50 }, 20, 200), "a straddling band is not a match");
  assert(declaredBandWithin({ min: 10001, max: null }, 1001, Number.MAX_SAFE_INTEGER));
});

Deno.test("no Workbench component renders `employee_count` or labels a column Employees", async () => {
  const offenders: string[] = [];
  const walk = async (dir: URL) => {
    for await (const e of Deno.readDir(dir)) {
      const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) { await walk(u); continue; }
      if (!/\.(tsx|ts)$/.test(e.name)) continue;
      const src = await Deno.readTextFile(u);
      if (/employee_count/.test(src) || />\s*Employees\s*</.test(src) || /k="Employees"/.test(src)) offenders.push(e.name);
    }
  };
  await walk(new URL("../../src/components/chat/workspace/workbench/", import.meta.url));
  assertEquals(offenders, []);
});
