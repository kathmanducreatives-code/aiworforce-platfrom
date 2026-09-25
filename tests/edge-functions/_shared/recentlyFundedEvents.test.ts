// "RECENTLY FUNDED" ASKS WHEN, NOT WHICH RUNG.
//
// `decideRecentlyFunded` used the STAGE test (`isVerifiedRound`: a rung of the
// Seed/Series ladder) to count a round, so a dated debt facility, grant or
// corporate round was invisible to recency. Canary 11 (2026-09-25): Salvo
// Software's dated 2024-06-06 "Debt Financing" (Pvalyou) could never count, in
// any window — a debt event inside one would have been explained as "older
// than the window".
//
// Now two concepts, two tests:
//   recently_funded — a trustworthy dated funding EVENT inside the window
//   funding_stage   — a trustworthy round AT the asked rung (unchanged)
//
// Pure. No network.

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideFundingStage, decideRecentlyFunded, isVerifiedFundingEvent, isVerifiedRound,
  type FundingRecordFact, type FundingRoundFact,
} from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import {
  fundingRecordEvidenceItem, normalizeAtomusFunding, normalizePvalyouFunding,
} from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import type { VerifierCallOutcome } from "../../../supabase/functions/_shared/claimVerifier.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const NOW = new Date("2026-09-25T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

// ── records in the recorded provider shapes ──
/** Pvalyou: states no completeness, ever. `precision` "unknown" means no date. */
const pvalyou = (rounds: Array<{ type: string; date: string; precision?: string }>): FundingRecordFact =>
  normalizePvalyouFunding({ query: "acme.com", status: "active", domain: "acme.com", record_as_of: "2026-09-25T10:00:00Z",
    record: { funding: { rounds_count: rounds.length, rounds: rounds.map((r, i) => ({
      round_index: i + 1, round_type: r.type, round_title: r.type, round_date: r.date, round_date_precision: r.precision ?? "day",
      round_amount_m_usd: 1, is_non_equity: /debt|grant/i.test(r.type), source_urls: [`https://news.example.com/acme-${i}`], investors: [],
    })) } } }).record!;
/** Atomus: `complete` when its stated round count equals the rounds it returned. */
const atomus = (rounds: Array<{ type: string; date: string }>, complete: boolean): FundingRecordFact =>
  normalizeAtomusFunding({ input: "https://www.linkedin.com/company/acme", status: "success",
    summary: { name: "Acme", linkedin_url: "https://www.linkedin.com/company/acme", domain: "acme.com" },
    company: { financial: { funding: { type: rounds[0]?.type ?? "", num_funding_rounds: complete ? rounds.length : rounds.length + 3,
      rounds: rounds.map((r) => ({ announced_at: r.date, raised_amount: 1_000_000, type: r.type })), date: rounds[0]?.date } } } }).record!;

const recent = (records: FundingRecordFact[], window = 365) => decideRecentlyFunded({ window_days: window, records, now: NOW });

// ══════════════════════════════════════════════ non-stage events count ══

for (const [label, type] of [["DEBT", "Debt Financing"], ["GRANT", "Grant"], ["CORPORATE", "Corporate Round"]] as const) {
  Deno.test(`${label} inside the window → recently_funded PASS (an event with a date, whatever its rung)`, () => {
    const d = recent([pvalyou([{ type, date: daysAgo(40) }])]);
    assertEquals([d.verdict, d.reasons], ["pass", ["round_inside_window"]], d.explanation);
    assertEquals(d.latest_announced_date, daysAgo(40));
    assert(d.explanation.includes(`(${type}) was announced ${daysAgo(40)}, 40 day(s) ago, inside the 365-day window`), d.explanation);
  });
}

Deno.test("ATOMUS SHAPES TOO: DEBT_FINANCING / GRANT / CORPORATE_ROUND inside the window PASS; the same in a complete old history FAIL", () => {
  for (const type of ["DEBT_FINANCING", "GRANT", "CORPORATE_ROUND"]) {
    assertEquals(recent([atomus([{ type, date: daysAgo(10) }], false)]).verdict, "pass", type);
    assertEquals(recent([atomus([{ type, date: daysAgo(900) }], true)]).verdict, "fail", type);
  }
});

// ═════════════════════════════════════════════ stage semantics unchanged ══

Deno.test("THE SAME EVENTS DO NOT SATISFY A STAGE: debt, grant and corporate never prove Seed or Series A", () => {
  for (const type of ["Debt Financing", "Grant", "Corporate Round", "DEBT_FINANCING", "GRANT", "CORPORATE_ROUND"]) {
    const record = pvalyou([{ type, date: daysAgo(40) }]);
    for (const stage of ["seed", "series-a"]) {
      const s = decideFundingStage({ required_stage: stage, record, pass_requires_source_url: true });
      assertNotEquals(s.verdict, "pass", `${type} must not satisfy ${stage}: ${JSON.stringify(s.reasons)}`);
      assertNotEquals(s.verdict, "fail", `${type} names no rung, so it cannot contradict ${stage} either`);
    }
    assert(!isVerifiedRound(record.rounds[0]), `${type} is still not a verified STAGE round`);
    assert(isVerifiedFundingEvent(record.rounds[0]), `${type} IS a verified funding event`);
  }
});

Deno.test("STAGE ROUNDS STILL COUNT FOR RECENCY: a Seed inside the window PASSES, as before", () => {
  const d = recent([pvalyou([{ type: "Seed", date: daysAgo(30) }])], 180);
  assertEquals(d.verdict, "pass");
  assert(/30 day\(s\) ago, inside the 180-day window/.test(d.explanation), d.explanation);
});

// ══════════════════════════════════════════ absence is not disproof ══

Deno.test("OLD EVENT + INCOMPLETE HISTORY → PENDING, naming the real date and the window", () => {
  const d = recent([pvalyou([{ type: "Debt Financing", date: "2024-06-06" }])], 365);
  assertEquals([d.verdict, d.reasons], ["pending", ["history_incomplete"]]);
  assertEquals(d.explanation, "the latest funding event we hold (Debt Financing) was announced 2024-06-06, 841 day(s) ago, " +
    "outside the 365-day window, and no provider states this is the full history");
});

Deno.test("OLD EVENT + COMPLETE HISTORY → FAIL, naming the latest event", () => {
  const d = recent([atomus([{ type: "SERIES_A", date: "2023-03-01" }, { type: "DEBT_FINANCING", date: "2024-06-06" }], true)], 365);
  assertEquals([d.verdict, d.reasons], ["fail", ["no_round_inside_window"]]);
  assertEquals(d.latest_announced_date, "2024-06-06");
  assert(d.explanation.includes("complete history (DEBT_FINANCING) was announced 2024-06-06, 841 day(s) ago, outside the 365-day window"), d.explanation);
});

Deno.test("THE WINDOW DECIDES, AND THE WORDING SAYS WHICH: one debt event 476 days old is inside 730 (PASS) and outside 365 (PENDING)", () => {
  const rec = [pvalyou([{ type: "Debt Financing", date: "2025-06-06" }])];
  const wide = recent(rec, 730), narrow = recent(rec, 365);
  assertEquals([wide.verdict, narrow.verdict], ["pass", "pending"]);
  assert(wide.explanation.includes("was announced 2025-06-06, 476 day(s) ago, inside the 730-day window"), wide.explanation);
  assert(narrow.explanation.includes("was announced 2025-06-06, 476 day(s) ago, outside the 365-day window"), narrow.explanation);
  // The old wording claimed every held round was older than the window — false for the 730-day window.
  assert(!/older than/.test(wide.explanation + narrow.explanation));
});

Deno.test("SALVO'S REAL EVENT (2024-06-06) is 841 days old: outside BOTH 365 and 730 — PENDING, never forced to PASS", () => {
  const rec = [pvalyou([{ type: "Debt Financing", date: "2024-06-06" }])];
  for (const w of [365, 730]) {
    const d = recent(rec, w);
    assertEquals([d.verdict, d.reasons], ["pending", ["history_incomplete"]], d.explanation);
    assert(d.explanation.includes(`841 day(s) ago, outside the ${w}-day window`), d.explanation);
  }
});

Deno.test("THE WINDOW EDGE: an event exactly at the window's first day is inside; a day earlier is not", () => {
  assertEquals(recent([pvalyou([{ type: "Grant", date: daysAgo(365) }])], 365).verdict, "pass");
  assertEquals(recent([pvalyou([{ type: "Grant", date: daysAgo(366) }])], 365).verdict, "pending");
});

// ════════════════════════════════════════════ what is not an event ══

Deno.test("A SECONDARY SALE raises nothing for the company: inside the window it is not a PASS", () => {
  const d = recent([pvalyou([{ type: "Secondary Market", date: daysAgo(20) }])]);
  assertNotEquals(d.verdict, "pass", d.explanation);
});

Deno.test("AN UNDATED EVENT is no event: a date of unknown precision stays PENDING (no_dated_rounds)", () => {
  const d = recent([pvalyou([{ type: "Debt Financing", date: daysAgo(20), precision: "unknown" }])]);
  assertEquals([d.verdict, d.reasons], ["pending", ["no_dated_rounds"]]);
});

Deno.test("A MODEL-EXTRACTED event inside the window cannot PASS — and, with a complete old history beside it, cannot FAIL either", () => {
  const extracted: FundingRoundFact = { round_type: "Debt Financing", announced_date: daysAgo(15), amount_usd: null, investors: [],
    source_urls: ["https://blog.example.com/x"], method: "model_extraction" };
  const withExtraction: FundingRecordFact = { ...pvalyou([{ type: "Grant", date: "2020-01-01" }]) };
  withExtraction.rounds = [...withExtraction.rounds, extracted];
  const d = recent([withExtraction, atomus([{ type: "SEED", date: "2020-01-01" }], true)]);
  assertEquals([d.verdict, d.reasons], ["pending", ["unverified_round_inside_window"]], d.explanation);
  assert(d.explanation.includes(`announced ${daysAgo(15)}, 15 day(s) ago, inside the 365-day window`), d.explanation);
});

// ═════════════════════════════════════════════ through the whole chain ══

Deno.test("END TO END: a debt event in the graph → the eligibility check PASSES with the event's date in its reason", () => {
  const key = "https://www.linkedin.com/company/salvosoftware";
  const item = fundingRecordEvidenceItem({ company_key: key, record: pvalyou([{ type: "Debt Financing", date: daysAgo(100) }]),
    mission_id: "m", observed_at: NOW.toISOString() });
  const check = evaluateEligibility([{ id: "funding:recent", kind: "hard", dimension: "funding",
    value: { event: "funding", subject: "company", qualifier: {} }, label: "Funding", source: "user_explicit", user_phrase: "",
    rationale: "", status: "ok", time_window: { days: 365, basis: "announced", source: "user_explicit", enforced: false } } as never],
    buildCompanyEvidenceGraph(key, [item], { now: NOW })).checks[0];
  assertEquals(check.result, "pass", check.reason);
  assert(check.reason.includes(daysAgo(100)), check.reason);
});

Deno.test("ATOMUS DECIDES A DEBT EVENT: inside the window it is decisive, so the Pvalyou fallback is NOT bought", async () => {
  const calls: string[] = [];
  const res = await fundingStageVerifier().verify([{
    company_key: "https://www.linkedin.com/company/acme", name: "acme", domain: "acme.com", linkedin_url: "https://www.linkedin.com/company/acme",
    criterion: { criterion_id: "funding:recent", dimension: "funding", value: { event: "funding", subject: "company", qualifier: {} }, window_days: 365 },
    graph: buildCompanyEvidenceGraph("https://www.linkedin.com/company/acme", [], { now: NOW }),
  }], {
    call: (c) => {
      calls.push(c.actor_key);
      const row = { input: "https://www.linkedin.com/company/acme", status: "success",
        summary: { name: "acme", linkedin_url: "https://www.linkedin.com/company/acme", domain: "acme.com" },
        company: { financial: { funding: { type: "DEBT_FINANCING", num_funding_rounds: 4,
          rounds: [{ announced_at: daysAgo(60), raised_amount: 5e6, type: "DEBT_FINANCING" }], date: daysAgo(60) } } } };
      return Promise.resolve({ status: "ok", rows: [row], provider_call_id: `pc_${calls.length}` } as VerifierCallOutcome);
    },
    ready: () => true, now: () => NOW.toISOString(), log: () => {},
  }, { mission_id: "m", pending: [] });
  assertEquals(calls, ["apify_funding_atomus"]);
  assertEquals(res.findings[0].detail.verdict_after, "pass");
});
