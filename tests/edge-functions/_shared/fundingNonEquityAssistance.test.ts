// NON-EQUITY ASSISTANCE IS NOT FUNDING (product decision, 2026-10-04).
//
// Canary 5 (task 154541e8) qualified LlamaIndex on its funding claim with one
// Atomus event: `NON_EQUITY_ASSISTANCE`, announced 2025-10-08 — accelerator or
// programme support, no equity sold. The mission asked for funding. It
// normalized to "unknown", and an "unknown" dated event counted as funding.
//
// It now normalizes to its own type and sits beside `secondary` in
// NON_RAISING_ROUND_TYPES: never a recency event, never a pass. Debt, grants,
// corporate and unlabelled rounds are untouched.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideRecentlyFunded, isVerifiedFundingEvent, normalizeRoundType, type FundingRecordFact,
} from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { fundingRecordEvidenceItem, fundingRecordFromDiscoveredRound } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

/** Canary 5 ran on 2026-10-04; the event was 361 days old. */
const NOW = new Date("2026-10-04T08:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const record = (rounds: FundingRecordFact["rounds"], complete = false): FundingRecordFact => ({
  provider: "apify", actor: "apify_funding_atomus",
  reported_round_count: complete ? rounds.length : null, history_complete: complete,
  observed_at: NOW.toISOString(), source_url: "https://www.linkedin.com/company/llamaindex", rounds,
});
const round = (type: string, date: string) => ({
  round_type: type, announced_date: date, amount_usd: null, investors: [],
  source_urls: ["https://www.linkedin.com/company/llamaindex"], method: "provider_field" as const,
});
const NEA = round("NON_EQUITY_ASSISTANCE", "2025-10-08");

Deno.test("every spelling of non-equity assistance normalizes to one type, and is not a funding event", () => {
  for (const t of ["NON_EQUITY_ASSISTANCE", "Non-equity Assistance", "non_equity_assistance", "Non-Equity"]) {
    assertEquals(normalizeRoundType(t), "non-equity-assistance", t);
    assertEquals(isVerifiedFundingEvent(round(t, "2025-10-08")), false, t);
  }
});

Deno.test("CANARY 5 REPLAY: LlamaIndex's only in-window event no longer passes the funding claim", () => {
  // Atomus did not state the history complete: PENDING, said plainly.
  const partial = decideRecentlyFunded({ window_days: 730, records: [record([NEA])], now: NOW });
  assertEquals([partial.verdict, partial.reasons], ["pending", ["only_non_funding_events"]]);
  assert(/NON_EQUITY_ASSISTANCE.*do not count as funding/.test(partial.explanation), partial.explanation);
  assertEquals(partial.carrier_rounds, []);

  // A complete history holding nothing but it: no funding at all — FAIL.
  const complete = decideRecentlyFunded({ window_days: 730, records: [record([NEA], true)], now: NOW });
  assertEquals([complete.verdict, complete.reasons], ["fail", ["only_non_funding_events"]]);
  assert(/complete history holds no funding round/.test(complete.explanation), complete.explanation);
});

Deno.test("a real round still passes beside it — and is what the claim cites", () => {
  const seriesA = round("SERIES_A", daysAgo(560));
  const d = decideRecentlyFunded({ window_days: 730, records: [record([NEA, seriesA])], now: NOW });
  assertEquals(d.verdict, "pass");
  assertEquals(d.carrier_rounds.map((r) => r.round_type), ["SERIES_A"]);
  assert(/SERIES_A/.test(d.explanation), d.explanation);
});

Deno.test("an old real round with a recent non-equity event: judged on the real round alone", () => {
  const oldSeed = round("SEED_ROUND", daysAgo(900));
  const complete = decideRecentlyFunded({ window_days: 730, records: [record([NEA, oldSeed], true)], now: NOW });
  assertEquals([complete.verdict, complete.reasons], ["fail", ["no_round_inside_window"]],
    "it used to PASS on the non-equity event");
  const partial = decideRecentlyFunded({ window_days: 730, records: [record([NEA, oldSeed])], now: NOW });
  assertEquals([partial.verdict, partial.reasons], ["pending", ["history_incomplete"]]);
});

Deno.test("unchanged: debt, grants, corporate and unlabelled dated rounds still count as funding events", () => {
  for (const t of ["DEBT_FINANCING", "GRANT", "CORPORATE_ROUND", "CONVERTIBLE_NOTE", "UNDISCLOSED"]) {
    const d = decideRecentlyFunded({ window_days: 730, records: [record([round(t, daysAgo(100))])], now: NOW });
    assertEquals(d.verdict, "pass", t);
  }
});

Deno.test("a secondary sale alone is now said for what it is (and FAILS only on a complete history)", () => {
  const sec = round("SECONDARY_MARKET", daysAgo(100));
  assertEquals(decideRecentlyFunded({ window_days: 730, records: [record([sec])], now: NOW }).reasons,
    ["only_non_funding_events"]);
  assertEquals(decideRecentlyFunded({ window_days: 730, records: [record([sec], true)], now: NOW }).verdict, "fail");
  // Undated rounds keep their own answer.
  const undated = decideRecentlyFunded({
    window_days: 730, records: [record([{ ...round("SEED_ROUND", "x"), announced_date: null }])], now: NOW,
  });
  assertEquals(undated.reasons, ["no_dated_rounds"]);
});

Deno.test("ELIGIBILITY: the hard funding criterion no longer passes on non-equity assistance", () => {
  const criterion = {
    id: "funding:_event_funding_subject_company_qualifier_", kind: "hard", dimension: "funding",
    value: { event: "funding", subject: "company", qualifier: {} }, label: "Funding",
    source: "user_explicit", user_phrase: "funding", rationale: "stated in the request", status: "ok",
    time_window: { days: 730, basis: "announced", source: "user_explicit" },
  } as MissionCriterion;
  const graph = (stage: string) => buildCompanyEvidenceGraph("llamaindex", [fundingRecordEvidenceItem({
    company_key: "llamaindex",
    record: fundingRecordFromDiscoveredRound(
      { company_name: "LlamaIndex", canonical_domain: "llamaindex.ai", linkedin_company_url: "https://www.linkedin.com/company/llamaindex",
        round_stage: stage, announced_date: "2025-10-08", amount_usd: null, investors: [],
        source_articles: ["https://www.linkedin.com/company/llamaindex"] },
      { actor: "apify_funding_atomus", provider_call_id: "pc_c5", observed_at: NOW.toISOString() },
    ),
    mission_id: "m", observed_at: NOW.toISOString(),
  })], { now: NOW });
  const nea = checkCriterion(criterion, graph("NON_EQUITY_ASSISTANCE"));
  assert(nea.result !== "pass", `non-equity assistance must not pass funding: ${nea.result} — ${nea.reason}`);
  // The same record with a real round passes, so the criterion itself is live.
  assertEquals(checkCriterion(criterion, graph("SEED_ROUND")).result, "pass");
});
