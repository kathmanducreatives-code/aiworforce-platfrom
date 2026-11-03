// ATLAS discovery baseline (offline): the recorded 12-scenario matrix, and failure injection.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { baseline, runScenario, SCENARIOS, type Scenario } from "../../../scripts/dev/discovery-benchmark.ts";
import { DEFAULT_OUT, summaryRow } from "../../../scripts/dev/discovery-benchmark-report.ts";
import { memoryLedger } from "../../../supabase/functions/_shared/discoveryProviders/budget.ts";

const S = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const calls = (r: Awaited<ReturnType<typeof runScenario>>, cap: string) => r.providerCalls.filter((c) => c.capability === cap).length;
const JOBS = "apify_linkedin_job_search", RECORDS = "apify_linkedin_company_details";

Deno.test("baseline: every scenario's verdict and metrics match the recorded baseline (a change is a reviewed re-record)", async () => {
  const recorded = JSON.parse(await Deno.readTextFile(new URL(`../../../${DEFAULT_OUT}/baseline.json`, import.meta.url))).summary;
  assertEquals((await baseline()).map(summaryRow), recorded);
});

Deno.test("baseline: the 12-scenario matrix is complete and every UNSUPPORTED verdict carries evidence", async () => {
  const r = await baseline();
  assertEquals(r.filter((x) => !["X", "F"].includes(x.group)).map((x) => x.id), ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4"]);
  for (const x of r.filter((y) => y.verdict === "UNSUPPORTED")) assert(x.detail.length > 60, `${x.id} states why`);
});

Deno.test("baseline: no qualified company ever lacks provider evidence, and no disproven company qualifies", async () => {
  const all = await baseline();
  for (const x of all) {
    for (const c of x.record?.companies ?? []) if (c.verdict === "qualified") assert(c.evidence.some((e) => e.startsWith("apify_linkedin_company_details")), `${x.id} ${c.domain}: qualified without a company record`);
  }
  // F1/F2 record the OPEN geography defect (an unrecognised or sub-national place is
  // matched by any HQ) as FAIL verdicts in the baseline; every other run must hold.
  for (const x of all.filter((y) => y.group !== "F")) {
    assert(!(x.record?.companies ?? []).some((c) => c.domain === "mapleledger.example" && c.verdict === "qualified"), `${x.id}: a Canadian-HQ company qualified`);
  }
  assertEquals(all.filter((y) => y.group === "F").map((y) => y.verdict), ["FAIL", "FAIL"], "the geography defect is still open: when fixed, re-record and flip these");
});

// ── Failure injection ───────────────────────────────────────────────────────

const A1: Scenario = S("A1");

Deno.test("fault: an empty job search buys no company record and writes nothing", async () => {
  const r = await runScenario(A1, { fault: "empty_jobs" });
  assertEquals([r.candidates, r.qualified, r.dbWrites, calls(r, RECORDS)], [0, 0, 0, 0]);
});

Deno.test("fault: incomplete company records never qualify and never reject on missing data", async () => {
  const r = await runScenario(A1, { fault: "incomplete_records" });
  assertEquals([r.qualified, r.rejected], [0, 0]);
  assert(r.review > 0);
});

Deno.test("fault: duplicate postings collapse to the same companies (one company, one lead)", async () => {
  const [base, dup] = [await runScenario(A1), await runScenario(A1, { fault: "duplicate_postings" })];
  assertEquals(new Set(dup.companies.map((c) => c.domain)).size, dup.uniqueCompanies);
  assert(dup.uniqueCompanies <= base.uniqueCompanies + 0, `duplicates add no company (${dup.uniqueCompanies} vs ${base.uniqueCompanies})`);
});

Deno.test("fault: a job-search timeout is counted at its worst case, marked uncertain, and not retried", async () => {
  const ledger = memoryLedger();
  const r = await runScenario(A1, { fault: "jobs_timeout", ledger });
  assertEquals(calls(r, JOBS), 1, "one attempt, no retry");
  assertEquals(calls(r, RECORDS), 0, "nothing downstream is bought");
  assert(r.errors.length > 0);
  assertEquals(r.ledger.uncertain, 1);
  // A retry of the same approved walk never re-buys the uncertain step.
  const again = await runScenario(A1, { ledger });
  assertEquals(calls(again, JOBS), 0, "the uncertain charge is not bought again");
});

Deno.test("fault: a company-record timeout leaves companies for review, uncertain on the ledger, not retried", async () => {
  const r = await runScenario(A1, { fault: "records_timeout" });
  assertEquals(r.qualified, 0);
  assertEquals(calls(r, RECORDS), 1);
  assert(r.ledger.uncertain >= 1);
});

Deno.test("fault: an interrupted run (charged, never settled) is never bought twice", async () => {
  const inner = memoryLedger();
  let crash = true;
  const ledger = Object.assign(Object.create(inner), {
    entries: inner.entries,
    reserve: (e: Parameters<typeof inner.reserve>[0]) => inner.reserve(e),
    settle: (k: string, a: number, res?: unknown) => crash ? Promise.reject(new Error("isolate terminated")) : inner.settle(k, a, res),
    markUncertain: (k: string) => crash ? Promise.resolve() : inner.markUncertain(k),
    release: (k: string) => inner.release(k),
  });
  const first = await runScenario(A1, { ledger });
  const bought = first.providerCalls.length;
  assert(bought > 0);
  crash = false;
  const second = await runScenario(A1, { ledger });
  assertEquals(calls(second, JOBS), 0, "an in-flight charge is never re-bought");
});

Deno.test("fault: duplicate execution of the same approval buys each step once", async () => {
  const once = await runScenario(A1);
  const twice = await runScenario(A1, { twice: true });
  assertEquals(twice.providerCalls.length, once.providerCalls.length);
});

Deno.test("fault: LeadOcean empty or failing — nothing qualifies, nothing crashes, the error is recorded", async () => {
  const empty = await runScenario(S("A2"), { fault: "lo_empty" });
  assertEquals([empty.uniqueCompanies, empty.leadoceanRecords], [0, 0]);
  const failed = await runScenario(S("A2"), { fault: "lo_error" });
  assertEquals(failed.qualified, 0);
  assert(failed.errors.length > 0, "a provider failure is reported, not swallowed");
});
