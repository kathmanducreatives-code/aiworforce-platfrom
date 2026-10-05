// THE GOLDEN MISSION SUITE — six outcomes, each a whole mission through the
// production engine, verifiers, canonical view, continuation and REAL queue SQL,
// with zero provider calls, zero credits and zero production writes.
//
// Every mission asserts the same eight things: canonical claims, the evidence
// behind them, the provider calls made, no duplicate purchase, the spend, the
// continuation decisions, the queue result, and the final mission outcome.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GOLDEN, li } from "./scenarios.ts";
import { type GoldenRun, runGoldenMission, spendOf } from "../lib/mission.ts";

const ACME = li("acme");
const lead = (r: GoldenRun, key: string) => r.view.leads.find((l) => l.company.key === key)!;
const calls = (r: GoldenRun, actor: string) => r.provider.calls.filter((c) => c.actor === actor);
const evidenceBy = (r: GoldenRun, key: string, dimension: string) =>
  lead(r, key).key_evidence.filter((e) => e.dimension === dimension && e.status === "proven").flatMap((e) => e.sources);

/** No duplicate purchase: every paid reservation and every non-adoption provider call is unique. */
function assertNoDuplicatePurchases(r: GoldenRun) {
  const s = spendOf(r.ledger);
  assertEquals(new Set(s.paid_keys).size, s.paid_keys.length, `duplicate paid reservation: ${s.paid_keys}`);
  const bought = r.provider.calls.filter((c) => !c.adopted).map((c) => c.idempotency_key);
  assertEquals(new Set(bought).size, bought.length, `a call was bought twice: ${bought}`);
  // Every provider call the network would have seen was reserved first.
  for (const c of r.provider.calls.filter((x) => !x.adopted)) {
    assert(r.ledger.reservations.some((x) => x.idempotency_key === c.idempotency_key && x.status !== "refused_budget"),
      `${c.actor} reached the provider without a reservation`);
  }
}

/** Spend: committed is what the paid reservations hold, never over the mission ceiling. */
function assertSpend(r: GoldenRun) {
  const s = spendOf(r.ledger);
  const sum = Math.round(s.paid.reduce((n, x) => n + (x.settled_usd ?? x.provisional_usd ?? x.estimate_usd), 0) * 1e4) / 1e4;
  assertEquals(s.committed_usd, sum);
  assert(s.committed_usd <= r.ledger.ceilings.mission_provider_usd + 1e-9, `${s.committed_usd} > ${r.ledger.ceilings.mission_provider_usd}`);
}

Deno.test("[golden] QUALIFIED: every hard claim proven in one slice → quota_met → completed", async () => {
  const r = await runGoldenMission(GOLDEN.qualified());
  // claims + evidence
  assertEquals(lead(r, ACME).hard_checks, { geography: "pass", company_size: "pass", funding: "pass", hiring: "pass" });
  assert(evidenceBy(r, ACME, "funding").includes("apify_funding_atomus"));
  assert(evidenceBy(r, ACME, "company_size_band").includes("apify_linkedin_company_details"));
  assert(lead(r, ACME).key_evidence.some((e) => e.dimension === "hiring" || e.dimension === "job"), "the open role is cited");
  // provider calls
  assertEquals(calls(r, "apify_funding_atomus").length, 1);
  assertEquals(calls(r, "apify_linkedin_job_search").length, 1);
  assertEquals(calls(r, "apify_funding_pvalyou").length, 0, "Atomus was decisive — no fallback");
  assertNoDuplicatePurchases(r); assertSpend(r);
  // continuation, queue, outcome
  assertEquals(r.slices.map((s) => s.decision), ["quota_met"]);
  assertEquals(r.queue.status, "complete");
  assertEquals([r.terminal, r.qualifiedKeys], ["completed", [ACME]]);
});

Deno.test("[golden] PENDING: hiring answered with no posting stays unproven — never a match; the search ends honestly", async () => {
  const r = await runGoldenMission(GOLDEN.pending());
  assertEquals(lead(r, ACME).bucket, "pending");
  assertEquals(lead(r, ACME).hard_checks, { geography: "pass", company_size: "pass", funding: "pass", hiring: "unknown" });
  assert(evidenceBy(r, ACME, "funding").includes("apify_funding_atomus"));
  assertEquals(calls(r, "apify_linkedin_job_search").length, 1, "asked once — the answer is never re-bought");
  assertNoDuplicatePurchases(r); assertSpend(r);
  assertEquals(r.slices.map((s) => s.decision), ["replenishment_required", "replenishment_required", "no_progress"]);
  assertEquals(r.slices.map((s) => s.queue.attempts), [0, 0, 1], "clean continuations refund their attempt");
  assertEquals(r.queue.status, "complete");
  assertEquals([r.terminal, r.qualifiedKeys.length], ["search_exhausted", 0]);
});

Deno.test("[golden] INELIGIBLE: a failed hard claim stops every purchase for that company", async () => {
  const r = await runGoldenMission(GOLDEN.ineligible());
  const big = li("bigco");
  assertEquals(lead(r, big).bucket, "ineligible");
  assertEquals(lead(r, big).hard_checks.company_size, "fail");
  assert(evidenceBy(r, big, "company_size_band").includes("apify_linkedin_company_details"), "the failing size is cited");
  assertEquals(calls(r, "apify_funding_atomus").length + calls(r, "apify_linkedin_job_search").length, 0,
    "no verifier buys for a company a hard claim already failed");
  assertNoDuplicatePurchases(r); assertSpend(r);
  assertEquals(r.slices.at(-1)!.decision, "no_progress");
  assertEquals(r.queue.status, "complete");
  assertEquals([r.terminal, r.qualifiedKeys.length], ["search_exhausted", 0]);
});

Deno.test("[golden] DISCOVERY REPLENISHMENT: a pool that cannot qualify widens to page 2, which delivers", async () => {
  const r = await runGoldenMission(GOLDEN.replenishment());
  assertEquals(r.slices.map((s) => s.decision), ["replenishment_required", "quota_met"]);
  const pages = calls(r, "apify_linkedin_company_search").map((c) => Number(c.input.startPage));
  assertEquals(pages.filter((p) => p === 1).length, 1, "page 1 is never re-bought");
  assert(pages.includes(2), "page 2 bought");
  assertEquals(r.view.leads.filter((l) => l.bucket === "ineligible").length, 10);
  assertEquals(lead(r, ACME).hard_checks, { geography: "pass", company_size: "pass", funding: "pass", hiring: "pass" });
  assert(calls(r, "apify_funding_atomus").every((c) => c.candidate_keys.every((k) => k === ACME)), "verifiers buy only for the viable company");
  assertNoDuplicatePurchases(r); assertSpend(r);
  assertEquals(r.slices[0].queue, { status: "resumable", attempts: 0, continuations: 1 });
  assertEquals([r.terminal, r.qualifiedKeys], ["completed", [ACME]]);
});

Deno.test("[golden] PROVIDER ADOPTION: a run still executing at slice end is adopted next slice — paid once, never re-bought", async () => {
  const r = await runGoldenMission(GOLDEN.adoption());
  assertEquals(r.slices.map((s) => s.decision), ["awaiting_provider_run", "quota_met"]);
  assertEquals(r.slices[0].pendingRuns, 1);
  const pv = calls(r, "apify_funding_pvalyou");
  assertEquals(pv.map((c) => [!!c.pending, !!c.adopted]), [[true, false], [false, true]], "started once, adopted once");
  assertEquals(pv[0].idempotency_key, pv[1].idempotency_key, "the adoption is the same purchase");
  assertEquals(r.ledger.reservations.filter((x) => x.purpose === "funding_evidence" && x.candidate_keys.length === 1 &&
    r.provider.calls.some((c) => c.actor === "apify_funding_pvalyou" && c.idempotency_key === x.idempotency_key)).length, 1);
  assertEquals(lead(r, ACME).hard_checks.funding, "pass");
  assert(evidenceBy(r, ACME, "funding").includes("apify_funding_pvalyou"), "the adopted rows are the evidence");
  assertNoDuplicatePurchases(r); assertSpend(r);
  assertEquals(r.slices[0].queue, { status: "resumable", attempts: 0, continuations: 1 }, "waiting on a provider is not a retry");
  assertEquals([r.terminal, r.qualifiedKeys], ["completed", [ACME]]);
});

Deno.test("[golden] BUDGET EXHAUSTION: under a $0.05 cap the job search is never bought and the mission stops cost_ceiling", async () => {
  const r = await runGoldenMission(GOLDEN.budget());
  assertEquals(calls(r, "apify_linkedin_job_search").length, 0, "refused before the provider");
  assert(r.slices[0].verification.unaffordable?.some((u) => u.company_key === ACME), "closed on budget, with the reason recorded");
  assert(r.ledger.reservations.some((x) => x.status === "refused_budget" && x.refused_ceiling === "mission"), "the mission ceiling refused a purchase");
  assertEquals(lead(r, ACME).hard_checks.hiring, "unknown");
  assertNoDuplicatePurchases(r); assertSpend(r);
  assert(spendOf(r.ledger).committed_usd <= 0.05);
  assertEquals(r.slices.at(-1)!.decision, "cost_ceiling");
  assertEquals(r.queue.status, "complete");
  assertEquals([r.terminal, r.qualifiedKeys.length], ["budget_exhausted", 0]);
});
