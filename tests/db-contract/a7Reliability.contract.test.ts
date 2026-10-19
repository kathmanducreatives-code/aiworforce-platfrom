// A7 PROVIDER-RELIABILITY SCENARIOS (S16–S25) through the real Discovery
// Engine V1 path (tests/db-contract/lib/discoveryScenario.ts). Vendor faults
// are injected at the transport; everything else is the production code.
// Concurrency (S23) and ownership loss (S24) are pinned at the gate in
// discoveryReliability.contract.test.ts (#106) and are not repeated here.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundsHeld, company, DETAILS, job, JOBS, PROPOSAL, type Run, runScenario, type Scenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
async function scenario(id: string, s: Omit<Scenario, "label">, expected: string, check: (r: Run) => void | Promise<void>) {
  const r = await runScenario({ label: id, ...s });
  console.log("A7_SCENARIO", JSON.stringify({ id, expected, outcome: r.outcome }));
  boundsHeld(r);
  await check(r);
}
const noLead = (r: Run) => assertEquals(r.leads, [], `nothing persisted: ${JSON.stringify(r.outcome)}`);
const terminal = (r: Run) => {
  assert(r.outcome.terminal.length > 0, "the task ends with a recorded terminal status");
  assert(!r.outcome.terminal.includes("completed") || r.outcome.qualified.length > 0, "never `completed` without a result");
};

for (const status of [402, 403]) {
  Deno.test(`S16: the job-search start is refused (${status}) — nothing else bought, no credit charged, cause recorded`, opts, () =>
    scenario(`S16-${status}`, { jobsStartStatus: status }, "0 leads, 1 refused purchase, credit not charged", (r) => {
      noLead(r); terminal(r);
      assertEquals(r.outcome.provider.map((p: string[]) => [p[0], p[2]]), [[JOBS, null]]);
      assertEquals(r.outcome.polls, 0);
      assertEquals(r.outcome.credits, { apify_linkedin_job_search: "not_charged" });
      assert(r.outcome.attempts.some((a: string) => /apify_(unauthorized|insufficient_credits)/.test(String(a))), JSON.stringify(r.outcome.attempts));
    }));
}

Deno.test("S17: the job search starts but its status can never be read — no dataset read, purchase held, nothing bought twice", opts, () =>
  scenario("S17", { jobsStatus: "unreadable" }, "0 leads, run id kept, reads bounded", (r) => {
    noLead(r); terminal(r);
    assertEquals(r.of("provider").length, 1, "one start, never re-bought");
    assertEquals(r.of("provider")[0].provider_run_id, "run-jobs", "the run id is kept for reconciliation");
    assert(r.outcome.polls <= 3, "the job search's share of the reads");
    assertEquals(r.vendorRequests.filter((v) => v.path.includes("/datasets/")).length, 0, "no dataset read of an unfinished run");
    assertEquals(r.outcome.credits.apify_linkedin_job_search, "charged", "a run that exists keeps its credit");
  }));

Deno.test("S18a: the job-search dataset is malformed JSON — no lead, no further purchase", opts, () =>
  scenario("S18a", { jobsDatasetRaw: "[{\"id\": \"broken\", " }, "0 leads, no company lookup", (r) => {
    noLead(r); terminal(r);
    assertEquals(r.of("provider").map((o) => o.actor), [JOBS]);
  }));

Deno.test("S18b: postings without the employer record (no company field) — no lookup bought, no lead", opts, () => {
  const rows = [job("s18b", company("s18b"))].map((j) => { delete j.company; return j; });
  return scenario("S18b", { jobs: rows }, "0 leads, no company lookup", (r) => {
    noLead(r); terminal(r);
    assertEquals(r.of("provider").map((o) => o.actor), [JOBS]);
  });
});

Deno.test("S18c: the company record comes back empty — nothing qualifies on the posting alone", opts, () =>
  scenario("S18c", { details: () => ({}), model: "credulous" }, "0 qualified", (r) => {
    assertEquals(r.outcome.qualified, [], JSON.stringify(r.outcome));
  }));

Deno.test("S19: an empty job-search dataset — no lookup, recorded as empty", opts, () =>
  scenario("S19", { jobs: [] }, "0 leads, outcome `empty`", (r) => {
    noLead(r); terminal(r);
    assertEquals(r.of("provider").map((o) => o.actor), [JOBS]);
    assertEquals(r.outcome.attempts, ["empty"]);
  }));

Deno.test("S20: the job search never finishes — reads stop at their share, the mission ends, nothing more is bought", opts, () =>
  scenario("S20", { jobsStatus: "running" }, "0 leads, ≤3 status reads, terminal", (r) => {
    noLead(r); terminal(r);
    assertEquals(r.of("provider").length, 1);
    assert(r.outcome.polls <= 3, `reads ${r.outcome.polls}`);
    assertEquals(r.vendorRequests.filter((v) => v.path.includes("/datasets/")).length, 0);
  }));

Deno.test("S21: every runtime model request times out after admission — attempts stay committed, no lead, mission ends", opts, () =>
  scenario("S21", { modelTimeout: true }, "0 leads, ≤4 model attempts, terminal", (r) => {
    noLead(r); terminal(r);
    assert(r.outcome.models >= 1 && r.outcome.models <= 4, `model attempts ${r.outcome.models}`);
    for (const o of r.of("model")) assertEquals(o.committed_microusd, "12480", "a timed-out attempt is never refunded");
    assertEquals(r.of("provider").length, 0, "no provider purchase without an execution plan");
  }));

Deno.test("S22: the model proposes the WRONG geography (Canada) — the compiled mission keeps the user's United States", opts, () =>
  scenario("S22", { proposal: { ...PROPOSAL, geographies: ["Canada"] }, model: "credulous" }, "mission geography = United States", (r) => {
    const m = r.trace.compiled_mission;
    const geo = JSON.stringify(m?.company_profile?.locations ?? m?.hard_constraints ?? null);
    assert(/United States/.test(geo) && !/Canada/.test(geo), `compiled geography: ${geo}`);
  }));

Deno.test("S25: the vendor returns ten postings (more than maxItems) — the pool stays bounded and only one company is looked up", opts, () => {
  const jobs = Array.from({ length: 10 }, (_, i) => job(`s25-${i}`, company(`s25-${i}`, { name: `S25 Co ${i}` }), {}, 1 + i));
  return scenario("S25", { jobs }, "≤1 company lookup, bounded pool", (r) => {
    assert(r.outcome.details_requested.length <= 1, JSON.stringify(r.outcome.details_requested));
    assertEquals(r.of("provider").filter((o) => o.actor === DETAILS).length <= 1, true);
    assert(r.outcome.qualified.length <= 1, "requested count is 1");
  });
});

Deno.test("S25b: three postings from three different in-band employers — one company lookup is bought, and it can qualify", opts, () => {
  const cos = ["s25b-a", "s25b-b", "s25b-c"].map((slug, i) => company(slug, { name: `S25b Co ${i}` }));
  const jobs = cos.map((co, i) => job(`${co.universalName}`, co, {}, 1 + i));
  return scenario("S25b", { jobs, model: "honest" }, "1 lookup (one company), 1 qualified", (r) => {
    assertEquals(r.refused.filter((d: string) => d === "request_limits"), [], `the gate refused our own request: ${JSON.stringify(r.refused)}`);
    assertEquals(r.outcome.details_requested.length, 1, JSON.stringify(r.outcome.details_requested));
    assertEquals(r.outcome.details_requested[0].length, 1, "one company per lookup, as the reviewed catalog allows");
    assertEquals(r.outcome.qualified.length, 1, JSON.stringify(r.outcome));
  });
});
