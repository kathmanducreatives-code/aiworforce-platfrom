// THE WORKBENCH MUST NAME EVERY NUMBER.
//
// The audited run showed "0 qualified" for seven companies the Company Brain had
// never evaluated, and "No results for this workflow yet" beside real evaluated
// rows. Both are claims about the run that the run had not earned.
//
// Pure and structural — no DOM, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brainActuallyEvaluated, readPortfolio, workbenchIsEmpty,
} from "../../src/lib/workbench/portfolioView.ts";

const RESULT = {
  workbench_portfolio: {
    version: "opportunity-portfolio-v1",
    targets: { requested_opportunity_count: 100, requested_contact_ready_count: null },
    counts: { delivered: 10, tier_a: 6, tier_b: 4, tier_c: 0,
      qualified: 4, review: 3, watch: 3, contact_ready: 0, rejected_by_floor: 0 },
    shortfall: { opportunities: 90, opportunity_reason: "sources exhausted",
      contact_ready: 0, contact_ready_reason: null },
    entries: [
      { rank: 1, company_key: "snapmagic.com", company_name: "SnapMagic", domain: "snapmagic.com",
        tier: "A", state: "qualified", actionable: true, reason: "Passed the Company Brain.",
        source_url: "https://yc/snapmagic", round: 2 },
      { rank: 5, company_key: "bitmovin.com", company_name: "Bitmovin", domain: "bitmovin.com",
        tier: "B", state: "review", actionable: false, reason: "one fact uncertain",
        source_url: null, round: 3 },
    ],
  },
};

Deno.test("17. the Workbench reads every portfolio count separately", () => {
  const p = readPortfolio(RESULT)!;
  assert(p, "the portfolio must parse");
  assertEquals(p.requested_opportunities, 100);
  assertEquals(p.counts.delivered, 10);
  assertEquals(p.counts.tier_a, 6);
  assertEquals(p.counts.tier_b, 4);
  assertEquals(p.counts.tier_c, 0);
  assertEquals(p.counts.qualified, 4);
  assertEquals(p.counts.review, 3);
  assertEquals(p.counts.watch, 3);
  assertEquals(p.counts.contact_ready, 0);
  assertEquals(p.opportunity_shortfall, 90);

  // DELIVERED IS NOT QUALIFIED. The two must never be the same number by accident.
  assertFalse(p.counts.delivered === p.counts.qualified);
  assertEquals(p.counts.tier_a + p.counts.tier_b + p.counts.tier_c, p.counts.delivered);
});

Deno.test("18. the empty state is hidden when any rows exist", () => {
  const p = readPortfolio(RESULT)!;
  assertFalse(workbenchIsEmpty(0, 0, p), "portfolio entries are results");
  assertFalse(workbenchIsEmpty(0, 3, null), "evaluation rows are results");
  assertFalse(workbenchIsEmpty(2, 0, null), "lead rows are results");
  assert(workbenchIsEmpty(0, 0, null), "…and only a genuinely empty run is empty");
});

Deno.test("the UI may not claim a Brain rejection the Brain never made", () => {
  assert(brainActuallyEvaluated(readPortfolio(RESULT)));
  // The audited run: nothing qualified AND nothing reviewed — the Brain never ran.
  const neverRan = readPortfolio({ workbench_portfolio: {
    ...RESULT.workbench_portfolio,
    counts: { ...RESULT.workbench_portfolio.counts, qualified: 0, review: 0, watch: 7 },
  }});
  assertFalse(brainActuallyEvaluated(neverRan),
    "0 qualified AND 0 review means it was never evaluated, not that it failed");
  assertFalse(brainActuallyEvaluated(null));
});

Deno.test("a malformed or absent portfolio reads as null, never as zeroes", () => {
  assertEquals(readPortfolio(null), null);
  assertEquals(readPortfolio({}), null);
  assertEquals(readPortfolio({ workbench_portfolio: {} }), null, "no counts is not a portfolio");
});

Deno.test("the portfolio reaches the UI, and the engine writes it", async () => {
  // ── THIS ASSERTION MOVED WITH THE SECTION IT PROTECTS ────────────────────
  //
  // It used to require `<PortfolioSummary portfolio={portfolio} />` in the
  // panel, and that the summary contain the words "passed the Company Brain".
  //
  // Both encoded the OLD information architecture. PortfolioSummary rendered as
  // one of three counter systems stacked ABOVE the leads — 24 numbers between
  // them, "Qualified" appearing three times — which is what left the qualified
  // leads roughly 180px of an 800px panel. It now lives inside `RunDetails`,
  // under the table, reached by the view rather than the panel.
  //
  // What the test protects is unchanged: the portfolio must not be silently
  // dropped, and delivered must never be mistaken for qualified.
  const panel = await Deno.readTextFile(new URL(
    "../../src/components/chat/workspace/workbench/WorkbenchPanel.tsx", import.meta.url));
  assert(panel.includes("readPortfolio(taskResult)"), "the panel still reads it");
  assert(/portfolio=\{portfolio\}/.test(panel),
    "…and hands it to the view rather than rendering a competing counter block");

  const details = await Deno.readTextFile(new URL(
    "../../src/components/chat/workspace/workbench/RunDetails.tsx", import.meta.url));
  for (const field of ["counts.qualified", "counts.review", "counts.watch",
    "counts.tier_a", "counts.tier_b", "counts.tier_c"]) {
    assert(details.includes(field), `Run details must still show ${field}`);
  }
  // The internal subsystem name is gone from the user-facing copy — the point of
  // the wording pass — but the DISTINCTION it existed to make is now structural
  // and stronger: `buildRunSummary` keeps `qualified` and `reviewed` as separate
  // numbers from separate authorities, and `workbenchRunSummary.test.ts` pins
  // that they never collapse into each other.
  assert(!/Company Brain/.test(details),
    "internal subsystem names do not belong in the user-facing surface");

  const summaryLib = await Deno.readTextFile(new URL(
    "../../src/lib/workbench/runSummary.ts", import.meta.url));
  assert(summaryLib.includes("qualified:") && summaryLib.includes("reviewed:"),
    "delivered and qualified must remain separately sourced numbers");

  const runAgent = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(runAgent.includes("workbench_portfolio:"), "the engine must persist the portfolio");
  assert(runAgent.includes("toPortfolioCandidates(capabilityRun.companies)"),
    "…built from the run that actually happened");
  assert(runAgent.includes("interpretTargets("), "…against the interpreted targets");
});
