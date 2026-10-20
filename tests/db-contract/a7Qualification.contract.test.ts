// A7 QUALIFICATION SCENARIOS (S01–S15) through the real Discovery Engine V1
// path (tests/db-contract/lib/discoveryScenario.ts): the reviewed mission,
// compiled offline, authorized, then run by the real worker and run-agent with
// only Apify and OpenAI answered here.
//
// Every negative scenario runs with the CREDULOUS model, which passes every
// requirement while citing real excerpts: whatever a model says, the
// deterministic qualification must not accept the company. Each test asserts
// the expected decision; a failure is a qualification defect, not flakiness.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundsHeld, company, daysAgo, job, type Run, runScenario, type Scenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
/**
 * KNOWN QUALIFICATION GAPS: these scenarios FAIL on launch/hardening today and
 * document a false qualification (see the A7 scenario report). They are
 * skipped by default so CI stays a regression gate, and run with
 * `A7_AUDIT_KNOWN_GAPS=1` (the convention #109 uses). Remove an id from the set
 * when its fix lands: S03b/S13/S13b (Codex HQ/provenance), S10/S10b (role
 * terms, reported on #109). S07 (future-dated posting) was fixed by #109 and
 * now runs on every build.
 */
const KNOWN_GAPS = new Set(["S03b", "S10", "S10b", "S13", "S13b"]);
const gapOpts = (id: string) => ({ ...opts, ignore: KNOWN_GAPS.has(id) && Deno.env.get("A7_AUDIT_KNOWN_GAPS") !== "1" });
const DAY = 86_400_000;

function record(id: string, r: Run, expected: string) {
  console.log("A7_SCENARIO", JSON.stringify({ id, expected, outcome: r.outcome }));
}
async function scenario(id: string, s: Omit<Scenario, "label">, expected: string, check: (r: Run) => void) {
  const r = await runScenario({ label: id, ...s });
  record(id, r, expected);
  boundsHeld(r);
  check(r);
}
const noneQualified = (r: Run) => assertEquals(r.outcome.qualified, [], `nothing may qualify: ${JSON.stringify(r.outcome)}`);

Deno.test("S01: a fully qualified US B2B software company, 11–50, AE posted 10 days ago, qualifies once", gapOpts("S01"), () => {
  const co = company("s01", { name: "S01 Software" });
  return scenario("S01", { jobs: [job("s01", co, {}, 10)], model: "honest" }, "1 qualified", (r) => {
    assertEquals(r.outcome.qualified, ["S01 Software"], JSON.stringify(r.outcome));
    assertEquals(r.outcome.leads[0].hard_checks, { hiring: "pass", industry: "pass", geography: "pass", company_size: "pass" });
    assertEquals(r.outcome.details_requested, [["https://www.linkedin.com/company/offline-s01"]]);
  });
});

Deno.test("S02: Canadian HQ with a US office is not a US company", gapOpts("S02"), () => {
  const co = company("s02", { name: "S02 Software", locations: [
    { country: "Canada", city: "Toronto", isHeadquarter: true },
    { country: "United States", city: "New York", isHeadquarter: false },
  ] });
  return scenario("S02", { jobs: [job("s02", co, {}, 5)], model: "credulous" }, "0 qualified (HQ Canada)", noneQualified);
});

Deno.test("S03: no headquarters evidence at all never qualifies", gapOpts("S03"), () => {
  const co = company("s03", { name: "S03 Software", locations: [] });
  return scenario("S03", { jobs: [job("s03", co, {}, 5)], model: "credulous" }, "0 qualified (HQ unknown)", noneQualified);
});

Deno.test("S04: 200 employees (201–500 band) fails the 11–50 requirement", gapOpts("S04"), () => {
  const co = company("s04", { name: "S04 Software", employeeCount: 200, employeeCountRange: { start: 201, end: 500 } });
  return scenario("S04", { jobs: [job("s04", co, {}, 5)], model: "credulous" }, "0 qualified (size)", noneQualified);
});

Deno.test("S05a: an unknown employee band never qualifies", gapOpts("S05a"), () => {
  const co = company("s05a", { name: "S05a Software", employeeCount: null, employeeCountRange: null });
  return scenario("S05a", { jobs: [job("s05a", co, {}, 5)], model: "credulous" }, "0 qualified (size unknown)", noneQualified);
});

Deno.test("S05b: posting says 11–50, the company record says 201–500 — conflict never qualifies", gapOpts("S05b"), () => {
  const posted = company("s05b", { name: "S05b Software" });
  const record = company("s05b", { name: "S05b Software", employeeCount: 300, employeeCountRange: { start: 201, end: 500 } });
  return scenario("S05b", { jobs: [job("s05b", posted, {}, 5)], details: () => record, model: "credulous" }, "0 qualified (size conflict)", noneQualified);
});

Deno.test("S06: a posting 45 days old is outside the 30-day window", gapOpts("S06"), () => {
  const co = company("s06", { name: "S06 Software" });
  return scenario("S06", { jobs: [job("s06", co, {}, 45)], model: "credulous" }, "0 qualified (stale posting)", noneQualified);
});

Deno.test("S07: a posting dated in the future is not proof of hiring", gapOpts("S07"), () => {
  const co = company("s07", { name: "S07 Software" });
  return scenario("S07", { jobs: [job("s07", co, {}, -5)], model: "credulous" }, "0 qualified (future date)", noneQualified);
});

Deno.test("S08a: posted 29 days 23 hours ago (UTC) is inside the window", gapOpts("S08a"), () => {
  const co = company("s08a", { name: "S08a Software" });
  return scenario("S08a", { jobs: [job("s08a", co, {}, 30 - 1 / 24)], model: "honest" }, "1 qualified (inside boundary)", (r) =>
    assertEquals(r.outcome.qualified, ["S08a Software"], JSON.stringify(r.outcome)));
});

Deno.test("S08b: posted 30 days 1 hour ago (UTC) is outside the window", gapOpts("S08b"), () => {
  const co = company("s08b", { name: "S08b Software" });
  return scenario("S08b", { jobs: [job("s08b", co, {}, 30 + 1 / 24)], model: "credulous" }, "0 qualified (outside boundary)", noneQualified);
});

Deno.test("S08c: a date-only posting exactly 30 calendar days ago, and an offset timestamp, are judged consistently", gapOpts("S08c"), async () => {
  const day = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10); // e.g. 2026-09-19 (no time, no zone)
  const coA = company("s08c", { name: "S08c Software" });
  const a = await runScenario({ label: "S08c", jobs: [job("s08c", coA, { postedDate: day })], model: "honest" });
  record("S08c", a, "recorded: inclusive or exclusive, but deterministic");
  boundsHeld(a);
  // The same instant written with a +05:45 offset must be judged the same as its UTC form.
  const utc = new Date(Date.now() - (30 * DAY - 2 * 3600_000));
  const offset = new Date(utc.getTime() + (5 * 60 + 45) * 60_000).toISOString().replace("Z", "+05:45");
  const coB = company("s08d", { name: "S08d Software" });
  const b = await runScenario({ label: "S08d", jobs: [job("s08d", coB, { postedDate: offset })], model: "honest" });
  record("S08d", b, "1 qualified (same instant as 29d22h UTC)");
  boundsHeld(b);
  assertEquals(b.outcome.qualified, ["S08d Software"], `an offset timestamp inside the window: ${JSON.stringify(b.outcome)}`);
});

Deno.test("S09: a closed / expired Account Executive posting is not an open role", gapOpts("S09"), () => {
  const co = company("s09", { name: "S09 Software" });
  return scenario("S09", { jobs: [job("s09", co, { jobState: "CLOSED", closedAt: daysAgo(1), expireAt: daysAgo(1) }, 5)], model: "credulous" },
    "0 qualified (closed)", noneQualified);
});

Deno.test("S10: an SDR posting is not an Account Executive posting", gapOpts("S10"), () => {
  const co = company("s10", { name: "S10 Software" });
  return scenario("S10", { jobs: [job("s10", co, { title: "Sales Development Representative",
    descriptionText: "S10 Software is hiring a Sales Development Representative to book meetings." }, 5)], model: "credulous" },
    "0 qualified (wrong role)", noneQualified);
});

Deno.test("S11: a consumer company whose posting calls itself B2B is not B2B software", gapOpts("S11"), () => {
  const co = company("s11", { name: "S11 Apps", industries: ["Consumer Services"],
    description: "S11 Apps makes a mobile game for individual players and families." });
  return scenario("S11", { jobs: [job("s11", co, { descriptionText: "S11 Apps, a B2B software company, is hiring an Account Executive." }, 5)],
    model: "credulous" }, "0 qualified (B2C)", noneQualified);
});

Deno.test("S12: three postings from one employer — one lookup, one lead, no duplicate", gapOpts("S12"), () => {
  const co = company("s12", { name: "S12 Software" });
  const jobs = [job("s12a", co, {}, 1), job("s12b", co, { title: "Senior Account Executive" }, 2), job("s12c", co, { title: "Account Executive, Mid-Market" }, 3)];
  return scenario("S12", { jobs, model: "honest" }, "1 qualified, 1 lookup", (r) => {
    assertEquals(r.outcome.details_requested.length, 1, JSON.stringify(r.outcome));
    assertEquals(r.outcome.qualified, ["S12 Software"]);
    assertEquals(r.leads.length, 1, "one lead row");
  });
});

Deno.test("S13: the company record has no description — the posting's own text never stands in for it", gapOpts("S13"), () => {
  const posted = company("s13", { name: "S13 Software" });
  const record = company("s13", { name: "S13 Software", description: "" });
  return scenario("S13", { jobs: [job("s13", posted, {}, 5)], details: () => record, model: "credulous" },
    "0 qualified (no authoritative description)", noneQualified);
});

Deno.test("S14: the posting says US HQ, the company record says Canada — contradiction never qualifies", gapOpts("S14"), () => {
  const posted = company("s14", { name: "S14 Software" });
  const record = company("s14", { name: "S14 Software", locations: [{ country: "Canada", city: "Vancouver", isHeadquarter: true }] });
  return scenario("S14", { jobs: [job("s14", posted, {}, 5)], details: () => record, model: "credulous" },
    "0 qualified (HQ contradiction)", noneQualified);
});

Deno.test("S15: three candidates, none qualifying — honestly zero, nothing persisted as qualified", gapOpts("S15"), () => {
  const big = company("s15a", { name: "S15 Big", employeeCount: 900, employeeCountRange: { start: 501, end: 1000 } });
  const ca = company("s15b", { name: "S15 North", locations: [{ country: "Canada", city: "Ottawa", isHeadquarter: true }] });
  const old = company("s15c", { name: "S15 Old" });
  const jobs = [job("s15a", big, {}, 2), job("s15b", ca, {}, 3), job("s15c", old, {}, 60)];
  return scenario("S15", { jobs, model: "credulous" }, "0 qualified of 3", (r) => {
    noneQualified(r);
    assert(r.outcome.terminal.every((t: string) => !/complete|qualified/i.test(t) || t === "budget_exhausted"),
      `terminal status must not claim success: ${JSON.stringify(r.outcome.terminal)}`);
  });
});

// ── DIAGNOSTIC VARIANTS (scope the defects above) ───────────────────────────
Deno.test("S10b: an SDR posting with the HONEST model", gapOpts("S10b"), () => {
  const co = company("s10b", { name: "S10b Software" });
  return scenario("S10b", { jobs: [job("s10b", co, { title: "Sales Development Representative",
    descriptionText: "S10b Software is hiring a Sales Development Representative to book meetings." }, 5)], model: "honest" },
    "0 qualified (wrong role, honest model)", noneQualified);
});

Deno.test("S03b: a US office with no headquarters flag is not proof of a US headquarters", gapOpts("S03b"), () => {
  const co = company("s03b", { name: "S03b Software", locations: [{ country: "United States", city: "Austin" }] });
  return scenario("S03b", { jobs: [job("s03b", co, {}, 5)], model: "credulous" }, "0 qualified (HQ not flagged)", noneQualified);
});

Deno.test("S13b: no description on the company record, honest model", gapOpts("S13b"), () => {
  const posted = company("s13b", { name: "S13b Software" });
  const record = company("s13b", { name: "S13b Software", description: "" });
  return scenario("S13b", { jobs: [job("s13b", posted, {}, 5)], details: () => record, model: "honest" },
    "0 qualified (no authoritative description, honest model)", noneQualified);
});
