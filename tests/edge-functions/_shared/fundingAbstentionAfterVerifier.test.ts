// A DATED ROUND IS NOT LOWERED BY THE EVALUATOR'S EARLIER ABSTENTION.
//
// On the job-first route the funding verifier (Atomus) runs AFTER the mission
// evaluator. The evaluator, seeing no round yet, answers the funding criterion
// "unknown" and cites nothing; Atomus then records a Series A inside the
// window. Under #113's "verdicts only lower" that stale abstention held the
// company pending, so the first-canary rehearsal bought the funding data and
// qualified nobody (tests/db-contract/canaryFundingRehearsal.contract.test.ts).
//
// Pinned here, at the rule's edges: only an abstention citing NOTHING yields,
// only on a funding window decided from dated round records. A `fail`, an
// `unknown` with receipts, a round outside the window and every other
// dimension keep the #113 behaviour.
//
// Pure. No network.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fundingRecordEvidenceItem, normalizeAtomusFunding } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import type { CriterionVerdict } from "../../../supabase/functions/_shared/missionEvaluation.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const KEY = "https://www.linkedin.com/company/fundly";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const FUNDING = {
  id: "funding:recent", kind: "hard", dimension: "funding", value: { event: "funding", subject: "company", qualifier: {} },
  label: "Funding", source: "user_explicit", user_phrase: "raised funding within the last six months", rationale: "", status: "ok",
  time_window: { days: 180, basis: "announced", source: "user_explicit", enforced: true },
} as never;

function graphWith(daysOld: number | null) {
  if (daysOld === null) return buildCompanyEvidenceGraph(KEY, [], {});
  const record = normalizeAtomusFunding({ input: KEY, status: "success",
    summary: { name: "Fundly", linkedin_url: KEY, domain: "fundly.example" },
    company: { financial: { funding: { type: "SERIES_A", num_funding_rounds: 1,
      rounds: [{ announced_at: daysAgo(daysOld), raised_amount: 5_000_000, type: "SERIES_A" }], date: daysAgo(daysOld) } } } }).record!;
  const item = fundingRecordEvidenceItem({ company_key: KEY, record, mission_id: "m", observed_at: new Date().toISOString() });
  return buildCompanyEvidenceGraph(KEY, [item], {});
}
const verdict = (result: CriterionVerdict["result"], cited = false): CriterionVerdict => ({
  criterion_id: "funding:recent", result, reason: `the evaluator answered ${result}`,
  evidence: cited ? [{ evidence_id: "ev_desc", excerpt: "we have not raised" }] : [],
});
const check = (daysOld: number | null, v?: CriterionVerdict) =>
  evaluateEligibility([FUNDING], graphWith(daysOld), v ? [v] : undefined).checks[0];

Deno.test("Atomus's Series A 60 days ago PASSES the 180-day window, with no evaluator verdict", () => {
  assertEquals(check(60).result, "pass", check(60).reason);
});

Deno.test("THE CANARY CASE: the evaluator's earlier abstention, citing nothing, does not lower the dated round", () => {
  const c = check(60, verdict("unknown"));
  assertEquals(c.result, "pass", c.reason);
});

Deno.test("#113 KEPT: an evaluator FAIL still lowers the dated round", () => {
  assertEquals(check(60, verdict("fail")).result, "fail");
  assertEquals(check(60, verdict("fail", true)).result, "fail");
});

Deno.test("#113 KEPT: an abstention WITH receipts still lowers it to unknown", () => {
  assertEquals(check(60, verdict("unknown", true)).result, "unknown");
});

Deno.test("never upgrades: a round outside the window fails, and no round stays unknown, whatever the evaluator said", () => {
  assertEquals(check(300, verdict("unknown")).result, "fail");
  assertEquals(check(300, verdict("pass", true)).result, "fail");
  assertEquals(check(null, verdict("unknown")).result, "unknown");
  assertEquals(check(null, verdict("pass", true)).result, "unknown");
});
