// WAVE 3 — "RAISED VENTURE FUNDING IN THE LAST 24 MONTHS" KEEPS "VENTURE" (G1).
//
// Funding carries three independent dimensions:
//   PRESENCE  has a qualifying round happened
//   KIND      any funding, or venture (equity) funding only
//   RECENCY   is the qualifying round inside the requested window
//
// Only a windowless PRESENCE claim carried the kind, so a window erased it: the
// windowed criterion's value was plain "funding", `decideRecentlyFunded` had no
// kind, and a grant-only company passed "raised venture funding in the last 24
// months" and qualified (integrated validation G1). The kind now travels on the
// windowed claim (`funding_kind`) into eligibility, the funding verifier (its
// Pvalyou fallback decision) and the funding screen.
//
// Pure deciders, the real compiler, the real eligibility check, and the
// production engine on the golden fixtures (zero network).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideHasRaised, decideRecentlyFunded, type FundingRecordFact, fundingKindOf, ventureKindOf,
} from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { daysAgo, GOLDEN, li } from "../../replay/golden/scenarios.ts";
import { runGoldenMission } from "../../replay/lib/mission.ts";
import type { FixtureProviderResponse } from "../../replay/lib/fixture.ts";
import { compileChain, funding, hiring, request } from "../../lead-v2-quality/lib/chain.ts";
import { fundingScreenPlan } from "../../../supabase/functions/_shared/fundingPoolScreen.ts";
import { parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";

const NOW = new Date("2026-10-07T00:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
const record = (rounds: Array<[string, string | null]>, complete = true): FundingRecordFact => ({
  provider: "atomus", actor: "apify_funding_atomus", history_complete: complete, reported_round_count: complete ? rounds.length : null,
  rounds: rounds.map(([round_type, announced_date]) => ({
    round_type, announced_date, amount_usd: null, investors: [], source_urls: [], method: "provider_field",
  })),
}) as unknown as FundingRecordFact;
const recency = (rounds: Array<[string, string | null]>, kind: "any" | "venture", complete = true) =>
  decideRecentlyFunded({ window_days: 730, records: [record(rounds, complete)], now: NOW, kind }).verdict;

// ── THE DECIDER: KIND × RECENCY ─────────────────────────────────────────────

Deno.test("G1 case 1: venture + no window + Series A → pass (presence, unchanged)", () => {
  assertEquals(decideHasRaised({ records: [record([["SERIES_A", ago(2000)]])], kind: "venture" }).verdict, "pass");
});

Deno.test("G1 cases 2–3: venture + 24 months — a Series A inside passes, outside fails", () => {
  assertEquals(recency([["SERIES_A", ago(200)]], "venture"), "pass");
  assertEquals(recency([["SERIES_A", ago(800)]], "venture"), "fail");
  assertEquals(recency([["SEED", ago(100)]], "venture"), "pass");
  assertEquals(recency([["SERIES_B", ago(400)]], "venture"), "pass");
  assertEquals(recency([["Venture Round", ago(300)]], "venture"), "pass", "a 'Venture Round' label is venture");
});

Deno.test("G1 cases 4–6: venture + 24 months — grant, debt or non-equity assistance alone never passes", () => {
  for (const t of ["GRANT", "DEBT_FINANCING", "NON_EQUITY_ASSISTANCE"]) {
    const d = decideRecentlyFunded({ window_days: 730, records: [record([[t, ago(100)]])], now: NOW, kind: "venture" });
    assertEquals(d.verdict, "fail", `${t}, complete history`);
    assert(/venture funding/.test(d.explanation), d.explanation);
    assertEquals(recency([[t, ago(100)]], "venture", false), "pending", `${t}, incomplete history: absence is never disproof`);
  }
  assertEquals(decideRecentlyFunded({ window_days: 730, records: [record([["GRANT", ago(100)]])], now: NOW, kind: "venture" }).reasons,
    ["only_non_venture_events"]);
});

Deno.test("G1 case 7: plain 'funding in the last 24 months' keeps the product rule — a grant is funding", () => {
  assertEquals(recency([["GRANT", ago(100)]], "any"), "pass");
  assertEquals(recency([["DEBT_FINANCING", ago(100)]], "any"), "pass");
  assertEquals(recency([["NON_EQUITY_ASSISTANCE", ago(100)]], "any"), "fail", "non-equity assistance is never funding");
  // The default is "any", and its explanations are unchanged.
  const d = decideRecentlyFunded({ window_days: 730, records: [record([["GRANT", ago(100)]])], now: NOW });
  assertEquals(d.verdict, "pass");
  assert(d.explanation.startsWith("a verified funding event (GRANT)"), d.explanation);
});

Deno.test("G1 case 8: old grant + recent Series A → venture passes on the Series A", () => {
  const d = decideRecentlyFunded({ window_days: 730, records: [record([["GRANT", ago(1500)], ["SERIES_A", ago(100)]])], now: NOW, kind: "venture" });
  assertEquals([d.verdict, d.carrier_rounds.map((r) => r.round_type)], ["pass", ["SERIES_A"]]);
});

Deno.test("G1 case 9: recent grant + old Series A → venture recency fails (complete) or stays pending (incomplete)", () => {
  assertEquals(recency([["GRANT", ago(100)], ["SERIES_A", ago(900)]], "venture"), "fail");
  assertEquals(recency([["GRANT", ago(100)], ["SERIES_A", ago(900)]], "venture", false), "pending");
  assertEquals(recency([["GRANT", ago(100)], ["SERIES_A", ago(900)]], "any"), "pass", "the grant still answers plain funding");
});

Deno.test("G1 case 10: no complete history yet → pending, never a false fail", () => {
  assertEquals(decideRecentlyFunded({ window_days: 730, records: [], now: NOW, kind: "venture" }).verdict, "pending");
  assertEquals(recency([["SERIES_A", ago(900)]], "venture", false), "pending");
  // A venture round with no date could be the one inside the window.
  assertEquals(recency([["GRANT", ago(100)], ["SERIES_A", null]], "venture"), "pending");
});

// ── ROUND KIND: THE PROVIDER'S TAXONOMY, NEVER THE STAGE RUNG ───────────────

/** Every supported label → its kind. A rung or an instrument never makes a round venture. */
const ROUND_KINDS: Record<string, "venture" | "not_venture" | "unknown"> = {
  // VENTURE
  PRE_SEED: "venture", PRE_SEED_ROUND: "venture", SEED: "venture", SEED_ROUND: "venture", "Seed": "venture",
  SERIES_A: "venture", "Series A": "venture", SERIES_B: "venture", SERIES_C: "venture", SERIES_D: "venture",
  SERIES_E: "venture", SERIES_F: "venture", SERIES_G: "venture", SERIES_H: "venture", "Series H": "venture",
  SERIES_I: "venture", SERIES_J: "venture", "Series A Extension": "venture",
  VENTURE_ROUND: "venture", "Venture Round": "venture", VENTURE: "venture",
  SERIES_UNKNOWN: "venture", "Series Unknown": "venture", "Venture - Series Unknown": "venture",
  // NOT_VENTURE
  PRIVATE_EQUITY: "not_venture", DEBT_FINANCING: "not_venture", "Debt Financing": "not_venture", "Venture Debt": "not_venture",
  GRANT: "not_venture", "Grant": "not_venture", NON_EQUITY_ASSISTANCE: "not_venture",
  EQUITY_CROWDFUNDING: "not_venture", PRODUCT_CROWDFUNDING: "not_venture", INITIAL_COIN_OFFERING: "not_venture",
  POST_IPO_EQUITY: "not_venture", POST_IPO_DEBT: "not_venture", POST_IPO_SECONDARY: "not_venture",
  SECONDARY_MARKET: "not_venture", "Secondary": "not_venture",
  // UNKNOWN
  CORPORATE_ROUND: "unknown", UNDISCLOSED: "unknown", CONVERTIBLE_NOTE: "unknown", SAFE: "unknown",
  "Bridge": "unknown", "Extension": "unknown", ANGEL: "unknown", "Accelerator": "unknown", "Other": "unknown",
  "Pre-IPO": "unknown", "Growth Equity": "unknown",
};

Deno.test("G1 kinds: every supported label has the kind its taxonomy states", () => {
  for (const [t, kind] of Object.entries(ROUND_KINDS)) {
    assertEquals(ventureKindOf({ round_type: t } as never), kind, t);
  }
  assertEquals(ventureKindOf({ round_type: null } as never), "unknown", "unlabelled");
});

Deno.test("G1 kinds: venture → pass, not venture → fail (complete), unknown → pending — never by stage", () => {
  for (const [t, kind] of Object.entries(ROUND_KINDS)) {
    const v = recency([[t, ago(100)]], "venture");
    assertEquals(v, kind === "venture" ? "pass" : kind === "not_venture" ? "fail" : "pending", `${t}, venture @730`);
    const p = decideHasRaised({ records: [record([[t, ago(100)]])], kind: "venture" }).verdict;
    assertEquals(p, v, `${t}, venture presence agrees`);
  }
});

Deno.test("G1 guards 1–7: the mandated classifications", () => {
  assertEquals(recency([["PRIVATE_EQUITY", ago(100)]], "venture"), "fail", "1. Private Equity only fails a venture claim");
  const cn = decideRecentlyFunded({ window_days: 730, records: [record([["CONVERTIBLE_NOTE", ago(100)]])], now: NOW, kind: "venture" });
  assertEquals([cn.verdict, cn.reasons], ["pending", ["round_kind_unknown"]], "2. Convertible Note only is unknown, not a pass");
  assertEquals(recency([["SERIES_A", ago(100)]], "venture"), "pass", "3. Series A");
  assertEquals(recency([["Venture - Series Unknown", ago(100)]], "venture"), "pass", "4. Venture - Series Unknown");
  assertEquals(recency([["CORPORATE_ROUND", ago(100)]], "venture"), "pending", "5. Corporate Round");
  assertEquals(recency([["POST_IPO_EQUITY", ago(100)]], "venture"), "fail", "6. Post-IPO Equity");
  assertEquals(recency([["EQUITY_CROWDFUNDING", ago(100)]], "venture"), "fail", "7. Equity Crowdfunding");
  // Inside the window an unknown kind holds the claim open; outside it, it cannot.
  assertEquals(recency([["SERIES_A", ago(900)], ["CORPORATE_ROUND", ago(100)]], "venture"), "pending");
  assertEquals(recency([["SERIES_A", ago(900)], ["CORPORATE_ROUND", ago(1000)]], "venture"), "fail");
});

Deno.test("G1 kinds: plain funding is unchanged — every raising round counts, whatever its kind", () => {
  for (const t of Object.keys(ROUND_KINDS)) {
    const expected = ["NON_EQUITY_ASSISTANCE", "SECONDARY_MARKET", "Secondary"].includes(t) ? "fail" : "pass";
    assertEquals(recency([[t, ago(100)]], "any"), expected, `${t}, plain funding`);
  }
});

// ── THE CRITERION CARRIES THE KIND ──────────────────────────────────────────

const fundingOf = (q: string, recencyDays: number | null) => {
  const c = compileChain(request(q, { requirements: [funding(q.replace(/^Find companies (that )?/, "").replace(/\.$/, ""), recencyDays)] }), null);
  assert(c.ok);
  return c.criteria.find((x) => x.dimension === "funding")!;
};

Deno.test("G1 compile: a window keeps the venture kind; plain funding and presence are unchanged", () => {
  for (const q of ["Find companies that raised venture funding in the last 24 months.",
    "Find companies that raised venture funding in the last two years."]) {
    for (const cb of [730, null]) {
      const f = fundingOf(q, cb);
      assertEquals([f.kind, f.time_window?.days, fundingKindOf(f.value)], ["hard", 730, "venture"], q);
      assertEquals((f.value as { presence?: string }).presence, undefined, "recency, not presence");
      assert(/venture/.test(f.label), f.label);
    }
  }
  const plain = fundingOf("Find companies that raised funding in the last 24 months.", 730);
  assertEquals([plain.kind, plain.time_window?.days, fundingKindOf(plain.value)], ["hard", 730, "any"]);
  assertEquals(Object.keys(plain.value as object).sort(), ["event", "qualifier", "subject"], "plain funding's value is unchanged");
  const presence = fundingOf("Find companies that have raised venture funding.", null);
  assertEquals([presence.kind, presence.time_window, (presence.value as { presence?: string }).presence], ["hard", undefined, "venture"]);
  // A hedge still makes it a target — and it still ranks on venture rounds.
  const hedged = fundingOf("Find companies that may have raised venture funding in the last 24 months.", 730);
  assertEquals([hedged.kind, fundingKindOf(hedged.value)], ["target", "venture"]);
});

Deno.test("G1 eligibility: a funding item that names no round cannot prove venture funding", () => {
  const f = fundingOf("Find companies that raised venture funding in the last 24 months.", 730);
  const item: EvidenceItem = {
    evidence_id: "ev_f", company_key: "c1", dimension: "funding", value: true, status: "proven",
    source: { provider: "apify", actor: "some_funding_feed", provider_call_id: "pc", url: null, excerpt: null },
    method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
    derived_from: [], mission_id: "m", origin: "lead_mission",
  } as unknown as EvidenceItem;
  const graph = buildCompanyEvidenceGraph("c1", [item], { now: NOW, required: [] });
  assertEquals(checkCriterion(f, graph).result, "unknown");
  const plain = fundingOf("Find companies that raised funding in the last 24 months.", 730);
  assertEquals(checkCriterion(plain, graph).result, "pass", "plain funding is unchanged");
});

Deno.test("G1 screen: the funding screen judges the claim's own kind of round", () => {
  const planFor = (v: string) => {
    const c = compileChain(request(`Find 1 company that raised ${v}funding in the last 24 months.`,
      { count: 1, requirements: [funding(`raised ${v}funding in the last 24 months`, 730)] }), null);
    return fundingScreenPlan({ criteria: c.criteria, runBudget: parseRunBudget({ provider_usd: 0.14, max_candidates: 2 }),
      requestedCount: 1, downstream_verifiers_usd: 0.02 }).plan;
  };
  assertEquals(planFor("venture ")?.funding_kind, "venture");
  assertEquals(planFor("")?.funding_kind, undefined, "plain funding's plan is unchanged");
});

// ── END TO END (G1) ─────────────────────────────────────────────────────────

const ATOMUS = "apify_funding_atomus", PVALYOU = "apify_funding_pvalyou";
const ACME = li("acme");
const ask = (venture: boolean) =>
  `Find 1 US company with 11–50 employees that raised ${venture ? "venture " : ""}funding in the last 24 months and is currently hiring sales.`;
const SPEC = (venture: boolean) => ({
  count: 1,
  filters: [{ field: "geography", op: "eq", value: "United States" }, { field: "employee_count", op: "range", value: { min: 11, max: 50 } }],
  requirements: [funding(`raised ${venture ? "venture " : ""}funding in the last 24 months`, 730), hiring("currently hiring sales", ["sales"])],
});
function atomusRounds(rs: FixtureProviderResponse[], rounds: Array<[string, string]>, complete = true): FixtureProviderResponse[] {
  return rs.map((r) => r.actor !== ATOMUS ? r : {
    ...r, rows: r.rows.map((row) => {
      const y = structuredClone(row) as { company: { financial: { funding: { rounds: unknown[]; num_funding_rounds: number } } } };
      y.company.financial.funding.rounds = rounds.map(([type, at]) => ({ type, announced_at: at, raised_amount: 5_000_000, investors: ["Seedfund"] }));
      y.company.financial.funding.num_funding_rounds = complete ? rounds.length : rounds.length + 2;
      return y as unknown as Record<string, unknown>;
    }),
  });
}
const pvalyou = (rounds: Array<[string, string]>): FixtureProviderResponse => ({
  actor: PVALYOU, provenance: "pvalyou funding record", rows: [{
    query: "acme.com", status: "active", domain: "acme.com", record_as_of: new Date().toISOString(),
    record: { funding: { rounds_count: rounds.length, last_round_date: rounds[0]?.[1] ?? null, rounds: rounds.map(([t, at], i) => ({
      round_index: i + 1, round_type: t, round_title: t, round_date: at, round_date_precision: "day", round_amount_m_usd: 5,
      is_non_equity: false, source_urls: [`https://news.example/acme-${i}`], investors: [{ name: "Seedfund" }],
    })) } },
  }],
});
async function run(name: string, venture: boolean, edit: (rs: FixtureProviderResponse[]) => FixtureProviderResponse[]) {
  const c = compileChain(request(ask(venture), SPEC(venture) as never), null);
  assert(c.ok && c.mission);
  const g = GOLDEN.qualified();
  g.name = `g1-${name}`;
  g.mission = c.mission;
  g.responses = edit(structuredClone(g.responses));
  const r = await runGoldenMission(g);
  return { r, lead: r.view.leads.find((l) => l.company.key === ACME), calls: r.provider.calls.map((x) => x.actor) };
}

Deno.test("G1 E2E: a grant-only company never qualifies for 'venture funding in the last 24 months'", async () => {
  const { r, lead } = await run("grant", true, (rs) => atomusRounds(rs, [["GRANT", daysAgo(100)]]));
  assertEquals(lead?.hard_checks.funding, "fail");
  assertFalse(r.qualifiedKeys.includes(ACME), "the grant-only company qualified");
  assert(r.terminal !== "completed", `terminal ${r.terminal}`);
});

Deno.test("G1 E2E: non-equity assistance alone never qualifies", async () => {
  const { r, lead } = await run("nea", true, (rs) => atomusRounds(rs, [["NON_EQUITY_ASSISTANCE", daysAgo(100)]]));
  assertEquals(lead?.hard_checks.funding, "fail");
  assertFalse(r.qualifiedKeys.includes(ACME));
});

Deno.test("G1 E2E: a Series A inside the window qualifies, even beside an older grant", async () => {
  const { r, lead } = await run("series-a", true, (rs) => atomusRounds(rs, [["GRANT", daysAgo(1500)], ["SERIES_A", daysAgo(100)]]));
  assertEquals(lead?.hard_checks.funding, "pass");
  assert(r.qualifiedKeys.includes(ACME));
  assertEquals(r.terminal, "completed");
});

Deno.test("G1 E2E: a recent grant beside an old Series A fails the venture window", async () => {
  const { r, lead } = await run("grant-recent", true, (rs) => atomusRounds(rs, [["GRANT", daysAgo(100)], ["SERIES_A", daysAgo(900)]]));
  assertEquals(lead?.hard_checks.funding, "fail");
  assertFalse(r.qualifiedKeys.includes(ACME));
});

Deno.test("G1 E2E: plain 'funding in the last 24 months' still counts a grant", async () => {
  const { r, lead } = await run("plain-grant", false, (rs) => atomusRounds(rs, [["GRANT", daysAgo(100)]]));
  assertEquals(lead?.hard_checks.funding, "pass");
  assert(r.qualifiedKeys.includes(ACME));
});

Deno.test("G1 E2E: an incomplete grant-only history leaves venture open, so the verifier asks Pvalyou", async () => {
  const { lead, calls } = await run("fallback", true,
    (rs) => [...atomusRounds(rs, [["GRANT", daysAgo(100)]], false), pvalyou([["Series A", daysAgo(60)]])]);
  assert(calls.includes(PVALYOU), `the fallback was not bought: ${calls}`);
  assertEquals(lead?.hard_checks.funding, "pass", "Pvalyou's Series A inside the window answers the venture claim");
});
