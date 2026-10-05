// HISTORICAL E — NON_EQUITY_ASSISTANCE IS NOT FUNDING (PR #20).
//
// Canary 5 qualified LlamaIndex's funding claim on one Atomus event,
// NON_EQUITY_ASSISTANCE (2025-10-08, AWS programme support). Replayed on the
// REAL record production holds for LlamaIndex, through the production
// `decideRecentlyFunded` and eligibility check.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { decideRecentlyFunded, type FundingRecordFact } from "../../../supabase/functions/_shared/fundingStageClaim.ts";

const fx = loadFixture("llamaindex.funding-non-equity") as ReturnType<typeof loadFixture> & {
  now: string; window_days: number; record: FundingRecordFact; evidence_item: { value: { round_type: string; announced_date: string } };
};
const decide = (record: FundingRecordFact) => decideRecentlyFunded({ window_days: fx.window_days, records: [record], now: fx.now });
const onlyNea = (complete: boolean): FundingRecordFact => ({
  ...fx.record, rounds: fx.record.rounds.filter((r) => r.round_type === "NON_EQUITY_ASSISTANCE"),
  history_complete: complete ? true : null, reported_round_count: complete ? 1 : null,
});

Deno.test("[historical] E anchors: the production record carries the NEA event and four raising rounds", () => {
  assertEquals(fx.record.rounds.length, 5);
  assert(fx.record.rounds.some((r) => r.round_type === "NON_EQUITY_ASSISTANCE" && r.announced_date === "2025-10-08"));
});

Deno.test("[claims] E LlamaIndex's full history PASSES on its venture round — never on the NEA event", () => {
  const d = decide(fx.record);
  assertEquals(d.verdict, "pass");
  assertEquals(d.latest_announced_date, "2025-05-01");
  assert(d.carrier_rounds.every((r) => r.round_type !== "NON_EQUITY_ASSISTANCE"), JSON.stringify(d.carrier_rounds));
});

Deno.test("[claims] E a history of ONLY non-equity assistance: complete → FAIL, incomplete → PENDING, reason only_non_funding_events", () => {
  const complete = decide(onlyNea(true));
  assertEquals([complete.verdict, complete.reasons], ["fail", ["only_non_funding_events"]]);
  const open = decide(onlyNea(false));
  assertEquals([open.verdict, open.reasons], ["pending", ["only_non_funding_events"]]);
});

Deno.test({
  name: "[known-gap] E the funding evidence headline still names the NEA event (display only; the claim is decided correctly)",
  ignore: true,
  fn: () => {
    assert(fx.evidence_item.value.round_type !== "non-equity-assistance", "headline should be the latest RAISING round");
  },
});
