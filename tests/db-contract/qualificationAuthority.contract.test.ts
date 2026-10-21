// Q1 — ONE QUALIFICATION AUTHORITY, through the real engine, worker, handler,
// SQL admission gate and PostgREST (tests/db-contract/lib/discoveryScenario.ts).
//
// Audit G09: an evaluator whose OVERALL answer is FAIL or REVIEW while every
// per-criterion row says PASS used to produce a qualified canonical company, a
// persisted lead, a quota count and a reported result. The evaluator's own
// answer now reaches the canonical decision as a hold: nothing is persisted as
// qualified, nothing is reported or counted, and nothing more is bought.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundsHeld, company, job, type Run, runScenario, type Scenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
async function scenario(id: string, s: Omit<Scenario, "label">, check: (r: Run) => void) {
  const r = await runScenario({ label: id, ...s });
  boundsHeld(r);
  check(r);
}
/** The purchases a one-company mission makes: one job search, one company-details lookup. */
const ONE_COMPANY_PURCHASES = ["apify:harvestapi~linkedin-job-search", "apify:harvestapi~linkedin-company"];

Deno.test("Q1-01 (control): every row PASS and the evaluator qualifies — one lead, reported and counted", opts, () => {
  const co = company("q1-01", { name: "Q1 Control Software" });
  return scenario("Q1-01", { jobs: [job("q1-01", co, {}, 10)], model: "honest" }, (r) => {
    assertEquals(r.outcome.qualified, ["Q1 Control Software"], JSON.stringify(r.outcome));
    assertEquals(r.trace.handler.body.eligible_leads, 1);
    assertEquals(r.trace.handler.body.ui_panel.lead_count, 1);
  });
});

for (const aggregate of ["fail", "review"] as const) {
  Deno.test(`Q1-02 (G09): every row PASS but the evaluator answers ${aggregate.toUpperCase()} — held, nothing persisted, reported or bought`, opts, () => {
    const co = company(`q1-02-${aggregate}`, { name: `Q1 ${aggregate} Software` });
    return scenario(`Q1-02-${aggregate}`, { jobs: [job(`q1-02-${aggregate}`, co, {}, 10)], model: "honest", aggregate }, (r) => {
      assertEquals(r.outcome.qualified, [], `nothing may qualify: ${JSON.stringify(r.outcome)}`);
      assertEquals(r.leads.filter((l) => l.raw?.quota_eligible === true).length, 0, "no row claims quota credit");
      assertEquals(r.trace.handler.body.eligible_leads, 0, "the handler reports none");
      assertEquals(r.trace.handler.body.ui_panel.lead_count, 0, "the Workbench panel shows none");
      // The hold is blocked: no further purchase is made for a company the evaluator did not qualify.
      assertEquals(r.outcome.provider.map((p: unknown[]) => p[0]), ONE_COMPANY_PURCHASES);
    });
  });
}
