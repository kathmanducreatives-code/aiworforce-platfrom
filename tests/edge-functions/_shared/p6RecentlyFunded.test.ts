// LEAD V2 P6 — "RECENTLY FUNDED" IS A DATE, AND IT IS ALREADY PAID FOR.
//
// The funding signal passed on the PRESENCE of a funding item, whatever its
// date: a 2019 round satisfied "companies that raised in the last 90 days", and
// the window the card printed decided nothing.
//
// It is now answered from the dated rounds the mission already holds — funding
// discovery's records and the pair's corroborated one — with the same asymmetry
// the stage claim uses: a verified round inside the window PASSES, a complete
// history with nothing inside it FAILS, and anything partial stays PENDING.
// Nothing is bought to answer it for a company whose rounds we already have.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideRecentlyFunded, type FundingRecordFact } from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { fundingRecordEvidenceItem, fundingRecordFromDiscoveredRound } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const record = (over: Partial<FundingRecordFact> & { rounds: FundingRecordFact["rounds"] }): FundingRecordFact => ({
  provider: "apify", actor: "apify_funding_rounds_datahyena",
  reported_round_count: null, history_complete: false,
  observed_at: NOW.toISOString(), source_url: null, ...over,
});
const round = (date: string | null, over: Partial<FundingRecordFact["rounds"][number]> = {}) => ({
  round_type: "seed", announced_date: date, amount_usd: 3_000_000,
  investors: ["Seedfund"], source_urls: ["https://news.example/round"], method: "provider_field" as const, ...over,
});

// ── the decision ────────────────────────────────────────────────────────────

Deno.test("a verified round inside the window PASSES, and says how old it is", () => {
  const d = decideRecentlyFunded({ window_days: 180, records: [record({ rounds: [round(daysAgo(30))] })], now: NOW });
  assertEquals([d.verdict, d.reasons], ["pass", ["round_inside_window"]]);
  // The round is dated (midnight); the age is reported in whole days from it.
  assert(/3[01] day\(s\) ago, inside the 180-day window/.test(d.explanation), d.explanation);
  assertEquals(d.carrier_rounds.length, 1);
});

Deno.test("nothing inside the window FAILS only against a COMPLETE history", () => {
  const rounds = [round(daysAgo(900))];
  const partial = decideRecentlyFunded({ window_days: 180, records: [record({ rounds })], now: NOW });
  assertEquals([partial.verdict, partial.reasons], ["pending", ["history_incomplete"]],
    "an old round we cannot bound is not proof there is no newer one");

  const complete = decideRecentlyFunded({
    window_days: 180, records: [record({ rounds, reported_round_count: 1 })], now: NOW,
  });
  assertEquals([complete.verdict, complete.reasons], ["fail", ["no_round_inside_window"]]);
  assert(/complete history/.test(complete.explanation), complete.explanation);
  assertEquals(complete.latest_announced_date, daysAgo(900));
});

Deno.test("absence, undated rounds and no window are all PENDING — never a pass, never a fail", () => {
  assertEquals(decideRecentlyFunded({ window_days: 90, records: [], now: NOW }).reasons, ["no_funding_record"]);
  assertEquals(
    decideRecentlyFunded({ window_days: 90, records: [record({ rounds: [round(null)] })], now: NOW }).reasons,
    ["no_dated_rounds"]);
  const noWindow = decideRecentlyFunded({ window_days: null, records: [record({ rounds: [round(daysAgo(5))] })], now: NOW });
  assertEquals([noWindow.verdict, noWindow.reasons], ["pending", ["no_window_requested"]]);
  for (const d of [
    decideRecentlyFunded({ window_days: 90, records: [], now: NOW }),
    decideRecentlyFunded({ window_days: 90, records: [record({ rounds: [round(null)] })], now: NOW }),
  ]) assertEquals(d.verdict, "pending");
});

Deno.test("a round dated inside the window but UNVERIFIABLE does not pass", () => {
  // `model_extraction` is corroboration, never proof (fundingStageClaim).
  const d = decideRecentlyFunded({
    window_days: 180,
    records: [record({ rounds: [round(daysAgo(10), { method: "model_extraction", source_urls: [] })] })],
    now: NOW,
  });
  assertEquals(d.verdict, "pending");
});

// ── eligibility reads it from evidence the mission already holds ────────────

const fundingCriterion = (days: number | null): MissionCriterion => ({
  id: "funding:recent", kind: "hard", dimension: "funding",
  value: { event: "funding", subject: "company" }, label: "Funding: recent",
  source: "user_explicit", user_phrase: "recently raised", rationale: "stated in the request",
  status: "ok", ...(days ? { time_window: { days, basis: "announced", source: "user_explicit" } } : {}),
} as MissionCriterion);

const graphWith = (dates: Array<string | null>, complete = false) => {
  const items = dates.map((date, i) => fundingRecordEvidenceItem({
    company_key: "acme",
    record: fundingRecordFromDiscoveredRound(
      { company_name: "Acme", canonical_domain: "acme.io", linkedin_company_url: null,
        round_stage: "seed", announced_date: date, amount_usd: 2_000_000,
        investors: ["Seedfund"], source_articles: [`https://news.example/acme-${i}`] },
      { actor: "apify_funding_rounds_datahyena", provider_call_id: "pc_1", observed_at: NOW.toISOString() },
    ),
    mission_id: "m", observed_at: NOW.toISOString(),
  }));
  if (complete) {
    const v = items[0].value as { record: FundingRecordFact };
    v.record = { ...v.record, reported_round_count: dates.length, history_complete: true };
  }
  return buildCompanyEvidenceGraph("acme", items, { now: NOW });
};

Deno.test("ELIGIBILITY: the window decides, against rounds discovery already bought", () => {
  const recent = checkCriterion(fundingCriterion(180), graphWith([daysAgo(20)]));
  assertEquals(recent.result, "pass", recent.reason);
  assert(/inside the 180-day window/.test(recent.reason), recent.reason);

  const stale = checkCriterion(fundingCriterion(180), graphWith([daysAgo(800)], true));
  assertEquals(stale.result, "fail", stale.reason);

  const unbounded = checkCriterion(fundingCriterion(180), graphWith([daysAgo(800)]));
  assertEquals(unbounded.result, "unknown", "an old round in a partial history is not a refusal");
});

Deno.test("ELIGIBILITY: without a window the old presence rule is untouched", () => {
  const c = checkCriterion(fundingCriterion(null), graphWith([daysAgo(800)]));
  assertEquals(c.result, "pass", "a bare funding criterion still passes on a proven round");
});

// ── and it is never bought twice ────────────────────────────────────────────

const unknownFunding = { criterion_id: "funding:recent", dimension: "funding", result: "unknown", reason: "no rounds" };
const PAIR_ALLOWED = readinessPolicy({
  allow_experimental: ["apify_funding_atomus|funding_verification", "apify_funding_pvalyou|funding_verification"],
});

Deno.test("NO REPURCHASE: a company whose rounds we hold is answered, not routed", () => {
  // Answered from evidence → no unknown check → no gap → nothing to buy.
  const answered = checkCriterion(fundingCriterion(180), graphWith([daysAgo(20)]));
  assertEquals(answered.result, "pass");
  assertEquals(evidenceGapsFor([{ ...unknownFunding, result: answered.result }], graphWith([daysAgo(20)]), undefined, undefined, PAIR_ALLOWED),
    [], "a decided claim raises no gap at all");
});

Deno.test("ROUTED ONLY WHEN NOTHING IS KNOWN: the gap goes to the funding pair", () => {
  const empty = buildCompanyEvidenceGraph("acme", [], { now: NOW });
  // A NOT-READY pair (its state before 2026-09-22) is refused…
  const notReady = readinessPolicy({ overrides: {
    "apify_funding_atomus|funding_verification": "EXPERIMENTAL",
    "apify_funding_pvalyou|funding_verification": "EXPERIMENTAL",
  } });
  const [blocked] = evidenceGapsFor([unknownFunding], empty, undefined, undefined, notReady);
  assertEquals(blocked.claim, "recently_funded");
  assertEquals(blocked.next, "blocked", "a not-ready pair: no ordinary mission may take it");
  // …and production, where the pair is READY, routes the same gap to it.
  const [prod] = evidenceGapsFor([unknownFunding], empty);
  assertEquals([prod.next, prod.route?.actor], ["verify", "apify_funding_atomus"]);

  const [open] = evidenceGapsFor([unknownFunding], empty, undefined, undefined, PAIR_ALLOWED);
  assertEquals([open.next, open.route?.actor], ["verify", "apify_funding_atomus"]);
  assert(open.route?.purpose.includes("cited"), open.route?.purpose);
  // The company that already has rounds does not reach this route: its check
  // is decided above, and only an `unknown` check becomes a gap.
  assertFalse(checkCriterion(fundingCriterion(180), graphWith([daysAgo(20)])).result === "unknown");
});
