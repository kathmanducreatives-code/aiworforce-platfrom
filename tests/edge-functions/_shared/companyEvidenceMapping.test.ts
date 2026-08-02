// COMPANY EVIDENCE MUST REACH THE COMPANY BRAIN.
//
// Production task 15c31f55 rejected all ten evaluated companies on the identical
// gate set `employee_count, industry, business_model, company_stage`. Gumloop's
// stored provider payload carries `"companyEmployeeCount": 50` against a Brain
// band of 1–150 — arithmetically impossible unless the Brain was handed null.
//
// Two stacked defects caused it, both fixed here:
//   1. `apifyJobsNormalizer` accepted `companyEmployeesCount` (PLURAL) but the
//      crawlworks actor emits `companyEmployeeCount` (SINGULAR).
//   2. `normalizedJobToCompoundJob` never mapped `employeeCount` at all.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeApifyJobRow } from "../../../supabase/functions/_shared/apifyJobsNormalizer.ts";
import { normalizedJobToCompoundJob, compoundJobsFromRawRows } from "../../../supabase/functions/_shared/runAgentCompoundJobAdapter.ts";

/** The real crawlworks row shape, trimmed from production task 15c31f55. */
const gumloop = {
  jobUrl: "https://www.linkedin.com/jobs/view/4411292622",
  jobTitle: "GTM Operations Lead",
  companyName: "Gumloop",
  companyUrl: "https://ca.linkedin.com/company/gumloop",
  companyWebsite: "https://www.gumloop.com",
  companyIndustry: "Software Development",
  companyEmployeeCount: 50,          // SINGULAR — the actual field name
  companyType: "Privately Held",
  companyDescription: "Gumloop is an AI automation platform.",
  location: "San Francisco, CA, US",
  postedDate: "2026-07-28",
};

Deno.test("1. the SINGULAR companyEmployeeCount is normalized (was dropped)", () => {
  assertEquals(normalizeApifyJobRow(gumloop).employeeCount, 50);
});

Deno.test("1b. the plural and other spellings still work — no alias was removed", () => {
  assertEquals(normalizeApifyJobRow({ companyEmployeesCount: 77 }).employeeCount, 77);
  assertEquals(normalizeApifyJobRow({ employeeCount: 88 }).employeeCount, 88);
  assertEquals(normalizeApifyJobRow({ companySize: 99 }).employeeCount, 99);
  // Absent stays absent — never invented.
  assertEquals(normalizeApifyJobRow({ companyName: "X" }).employeeCount, null);
});

Deno.test("1c. the adapter carries employee count into the Brain-facing field", () => {
  const job = normalizedJobToCompoundJob(normalizeApifyJobRow(gumloop))!;
  assertEquals(job.companyEmployeeCount, 50, "the Brain gate reads THIS field");
  // A 50-person company can no longer fail a 1–150 band for lack of evidence.
  assert((job.companyEmployeeCount as number) >= 1 && (job.companyEmployeeCount as number) <= 150);
});

Deno.test("1d. industry, description, website and LinkedIn evidence also survive", () => {
  const job = normalizedJobToCompoundJob(normalizeApifyJobRow(gumloop))!;
  assertEquals(job.industries, ["Software Development"]);
  assertEquals(job.companyDescription, "Gumloop is an AI automation platform.");
  assertEquals(job.companyWebsite, "https://www.gumloop.com");
  assertEquals(job.companyDomain, "gumloop.com");
  assert(job.companyLinkedinUrl?.includes("linkedin.com/company/gumloop"));
});

Deno.test("1e. UNAVAILABLE evidence stays absent — nothing is fabricated", () => {
  const job = normalizedJobToCompoundJob(normalizeApifyJobRow(gumloop))!;
  // The actor supplies `companyType: "Privately Held"`, an ownership type. It is
  // NOT a business model, and must not be laundered into one.
  assertEquals(job.companyBusinessModel, undefined);
  assertEquals(job.companyStage, undefined);
  assertEquals(job.companyFounderLed, undefined);
});

Deno.test("1f. the batch path carries evidence too, not just the single mapper", () => {
  const { jobs, dropped } = compoundJobsFromRawRows([gumloop], 10);
  assertEquals(dropped.length, 0);
  assertEquals(jobs[0].companyEmployeeCount, 50);
});

// ================================= 3. LANCEDB / CONFIDO TRACE REGRESSIONS ====

/** LanceDB-style: employee count present, no explicit industry string. */
const lancedb = {
  jobUrl: "https://www.linkedin.com/jobs/view/4400000001",
  jobTitle: "Revenue Operations Lead",
  companyName: "LanceDB",
  companyWebsite: "https://lancedb.com",
  companyEmployeeCount: 55,
  location: "San Francisco, CA, US",
  postedDate: "2026-07-28",
};

/** Confido-style: employee count + industry present. */
const confido = {
  jobUrl: "https://www.linkedin.com/jobs/view/4400000002",
  jobTitle: "Revenue Operations Lead",
  companyName: "Confido",
  companyWebsite: "https://confido.io",
  companyIndustry: "Software Development",
  companyEmployeeCount: 86,
  location: "New York, NY, US",
  postedDate: "2026-07-27",
};

Deno.test("3. LanceDB and Confido rows survive normalization with their evidence", () => {
  for (const [name, row, count] of [["LanceDB", lancedb, 55], ["Confido", confido, 86]] as const) {
    const n = normalizeApifyJobRow(row);
    assertEquals(n.company, name);
    assertEquals(n.employeeCount, count, `${name} employee count must survive`);
    const job = normalizedJobToCompoundJob(n)!;
    assertEquals(job.companyEmployeeCount, count, `${name} must reach the Brain with evidence`);
    // Both are inside a 1–150 band, so neither can fail employee_count for lack
    // of evidence. This does NOT assert either company qualifies — industry,
    // business model and stage remain the Brain's call.
    assert((job.companyEmployeeCount as number) <= 150);
  }
});

Deno.test("3b. a row reaching the adapter is never dropped for missing evidence alone", () => {
  // No industry, no employee count — still a usable hiring signal.
  const sparse = { jobTitle: "Revenue Operations Lead", companyName: "Sparse Co", jobUrl: "https://x/1" };
  const { jobs, dropped } = compoundJobsFromRawRows([sparse], 10);
  assertEquals(dropped.length, 0);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].companyEmployeeCount, null);
});

Deno.test("3c. rows WITHOUT a usable identity are still dropped, with a reason", () => {
  const { jobs, dropped } = compoundJobsFromRawRows([{ jobTitle: "RevOps" }], 10);
  assertEquals(jobs.length, 0);
  assertEquals(dropped[0].reason, "missing_job_url");
});

Deno.test("1g. a non-LinkedIn companyUrl is NOT mistaken for a LinkedIn identity", () => {
  const n = normalizeApifyJobRow({
    companyName: "Indeed Co", companyUrl: "https://www.indeed.com/cmp/Indeed-Co",
  });
  assertEquals(n.linkedinUrl, null, "only a linkedin.com/company URL may become the LinkedIn identity");
});
