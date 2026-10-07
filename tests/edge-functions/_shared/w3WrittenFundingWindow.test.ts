// WAVE 3 — A FUNDING WINDOW WRITTEN IN WORDS IS THE SAME REQUIREMENT AS ONE IN DIGITS.
//
// "…raised funding in the last two years" read as no window at all: the
// window parser took digits only, so the stated window was never recognised,
// funding compiled as a soft TARGET (on the 180-day default when Chat Brain
// carried no recency), and an unfunded company qualified and completed the
// mission (integrated validation E9). "…in the last 2 years" was a hard
// requirement on 730 days.
//
// Also guarded here, because reading more windows must not hand them to the
// wrong claim: funding's own window decides its hardness, not the sentence's
// first (a hiring window written before it), and a window on the company's age
// ("founded in the last 3 years") belongs to no signal.
//
// Compiler cases go through the real projection + compiler + criteria, with and
// without a Chat Brain recency; the end-to-end cases run the production engine
// on the golden fixtures (zero network).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { daysAgo, GOLDEN, li } from "../../replay/golden/scenarios.ts";
import { runGoldenMission } from "../../replay/lib/mission.ts";
import type { FixtureProviderResponse } from "../../replay/lib/fixture.ts";
import { compileChain, fromMission, funding, hiring, request } from "../../lead-v2-quality/lib/chain.ts";
import { companyAgeWindowDays, explicitWindowDays } from "../../../supabase/functions/_shared/signalKinds.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import type { RequestRequirement } from "../../../supabase/functions/_shared/requestV1.ts";

type Reqs = (chatBrainRecency: boolean) => RequestRequirement[];

/** The compiled criterion of one dimension, as [kind, window days, window source] — with and without a Chat Brain recency. */
function compiled(query: string, reqs: Reqs, dim: "funding" | "hiring") {
  return [true, false].map((cb) => {
    const c = compileChain(request(query, { requirements: reqs(cb) }), null);
    assert(c.ok, `${query}: ${c.refusal?.reason}`);
    const x = c.criteria.filter((k) => k.dimension === dim && k.status === "ok");
    assertEquals(x.length, 1, `${query}: one ${dim} criterion`);
    return x[0];
  });
}
const shape = (c: MissionCriterion) => [c.kind, c.time_window?.days ?? null, c.time_window?.source ?? null];
const fundingOnly = (phrase: string, days: number): Reqs => (cb) => [funding(phrase, cb ? days : null)];

// ── THE PARSER ──────────────────────────────────────────────────────────────

Deno.test("W3: a written count is the same window as its digits", () => {
  for (const [written, digits] of [
    ["in the last two years", "in the last 2 years"], ["in the past six months", "in the past 6 months"],
    ["in the last eighteen months", "in the last 18 months"], ["within the last twelve months", "within the last 12 months"],
    ["within the past twenty-four months", "within the past 24 months"], ["over the last twenty four months", "over the last 24 months"],
    ["in the last two weeks", "in the last 2 weeks"], ["in the last ninety days", "in the last 90 days"],
  ]) {
    assertEquals(explicitWindowDays(written), explicitWindowDays(digits), written);
    assert(explicitWindowDays(written)! > 0, written);
  }
  assertEquals(explicitWindowDays("in the last two years"), 730);
  assertEquals(explicitWindowDays("in the past six months"), 180);
  assertEquals(explicitWindowDays("in the last eighteen months"), 540);
  assertEquals(explicitWindowDays("in the last year"), 365, "unchanged: a bare unit is one");
});

Deno.test("W3: words that name no number are still no window", () => {
  for (const t of ["in the past few months", "over the last several years", "in the last couple of years", "recently"]) {
    assertEquals(explicitWindowDays(t), null, t);
  }
});

Deno.test("W3: a window on the company's age is not a signal's window", () => {
  assertEquals(explicitWindowDays("SaaS companies founded in the last 3 years that raised funding"), null);
  assertEquals(companyAgeWindowDays("SaaS companies founded in the last three years that raised funding"), 1095);
  // A later window is still the signal's.
  assertEquals(explicitWindowDays("companies founded in the last two years that raised funding in the last six months"), 180);
  assertEquals(companyAgeWindowDays("companies that raised funding in the last 2 years"), null);
});

// ── 1–5: NUMERIC AND WRITTEN COMPILE TO THE SAME HARD REQUIREMENT ──────────

for (const [label, numeric, written, days, cbDays] of [
  ["2 years / two years", "raised funding in the last 2 years", "raised funding in the last two years", 730, 730],
  ["6 months / six months", "raised funding in the past 6 months", "raised funding in the past six months", 180, 182],
  ["18 months / eighteen months", "raised funding in the last 18 months", "raised funding in the last eighteen months", 540, 548],
  ["12 months / twelve months", "raised funding within the last 12 months", "raised funding within the last twelve months", 365, 365],
] as const) {
  Deno.test(`W3 ${label}: numeric and written are the same hard funding requirement`, () => {
    const n = compiled(`Find companies that ${numeric}.`, fundingOnly(numeric, cbDays), "funding");
    const w = compiled(`Find companies that ${written}.`, fundingOnly(written, cbDays), "funding");
    for (const [i, cb] of [[0, "with"], [1, "without"]] as const) {
      assertEquals(shape(n[i]), ["hard", days, "user_explicit"], `numeric, ${cb} a Chat Brain recency`);
      assertEquals(shape(w[i]), shape(n[i]), `written, ${cb} a Chat Brain recency`);
    }
  });
}

// ── 9: FUNDING'S OWN WINDOW, BESIDE AN UNRELATED HIRING ONE (RC06 kept) ──────

Deno.test("W3: a hiring window written first does not decide funding's hardness", () => {
  for (const n of [["2", "2"], ["two", "two"]]) {
    const q = `Find companies that are hiring sales in the last ${n[0]} weeks and raised funding in the last ${n[1]} years.`;
    const reqs: Reqs = (cb) => [hiring(`hiring sales in the last ${n[0]} weeks`, ["sales"], undefined, cb ? 14 : null),
      funding(`raised funding in the last ${n[1]} years`, cb ? 730 : null)];
    for (const f of compiled(q, reqs, "funding")) assertEquals(shape(f), ["hard", 730, "user_explicit"], q);
    for (const h of compiled(q, reqs, "hiring")) assertEquals([h.kind, h.time_window?.days], ["hard", 14], q);
  }
});

Deno.test("W3: a written funding window never becomes hiring's window", () => {
  const q = "Find companies that raised funding in the last two years and are hiring sales.";
  const reqs: Reqs = (cb) => [funding("raised funding in the last two years", cb ? 730 : null), hiring("hiring sales", ["sales"])];
  for (const f of compiled(q, reqs, "funding")) assertEquals(shape(f), ["hard", 730, "user_explicit"]);
  for (const h of compiled(q, reqs, "hiring")) assertEquals([h.kind, h.time_window?.days], ["hard", 30]);
});

// ── 10: HEDGED STAYS A PREFERENCE ───────────────────────────────────────────

Deno.test("W3: a hedged written funding window stays a target", () => {
  for (const q of ["Find companies that ideally raised funding in the last two years.",
    "Find companies, bonus if they raised funding in the last two years."]) {
    for (const f of compiled(q, fundingOnly("raised funding in the last two years", 730), "funding")) {
      assertEquals(f.kind, "target", q);
    }
  }
});

// ── FOUNDING-DATE WINDOWS ATTACH TO NOTHING ─────────────────────────────────

Deno.test("W3: 'founded in the last N years that raised funding' is a raise, not a funding window", () => {
  for (const n of ["3", "three"]) {
    const q = `SaaS companies founded in the last ${n} years that raised funding`;
    for (const f of compiled(q, fundingOnly("raised funding", 1095), "funding")) {
      assertEquals(f.kind, "hard", q);
      assertEquals(f.time_window, undefined, `${q}: the company's age is not funding's window`);
      assertEquals((f.value as { presence?: string }).presence, "any", q);
    }
  }
});

Deno.test("W3: 'founded in the last N years that are hiring' keeps hiring's own window", () => {
  for (const n of ["5", "five"]) {
    const q = `Find companies founded in the last ${n} years that are hiring sales`;
    const reqs: Reqs = (cb) => [hiring("hiring sales", ["sales"], undefined, cb ? 1825 : null)];
    for (const h of compiled(q, reqs, "hiring")) assertEquals([h.kind, h.time_window?.days], ["hard", 30], q);
  }
});

Deno.test("W3: a mission compiled with the company's age as funding's window is re-read without it", () => {
  // As the previous compiler left it: funding@1095, the window labelled the user's.
  const c = compileChain(request("SaaS companies founded in the last 3 years that raised funding",
    { requirements: [funding("raised funding", 1095)] }), null);
  assert(c.ok && c.mission);
  const m = structuredClone(c.mission) as unknown as {
    required_signals: Array<{ event?: string; type?: string; timeframe_days?: number }>;
    mission_semantics: { window_sources?: Record<string, { source: string }> };
  };
  for (const s of m.required_signals) if ((s.event ?? s.type) === "funding") s.timeframe_days = 1095;
  m.mission_semantics.window_sources = { ...(m.mission_semantics.window_sources ?? {}), funding: { source: "user_explicit" } };
  const f = fromMission(m as never).criteria.find((x) => x.dimension === "funding")!;
  assertEquals(f.kind, "hard", "never softened mid-lineage");
  assertEquals(f.time_window, undefined);
  assertEquals((f.value as { presence?: string }).presence, "any");
});

Deno.test("W3: a founding window beside a written funding window leaves funding its own", () => {
  const q = "Find companies founded in the last two years that raised funding in the last six months.";
  for (const f of compiled(q, fundingOnly("raised funding in the last six months", 182), "funding")) {
    assertEquals(shape(f), ["hard", 180, "user_explicit"]);
  }
});

// ── 6–8: END TO END — THE UNFUNDED COMPANY IS REJECTED ─────────────────────

const ATOMUS = "apify_funding_atomus";
const ACME = li("acme");
const WRITTEN = "Find 1 US company with 11–50 employees that raised funding in the last two years and is currently hiring sales.";
const SPEC = {
  count: 1,
  filters: [{ field: "geography", op: "eq", value: "United States" }, { field: "employee_count", op: "range", value: { min: 11, max: 50 } }],
  requirements: [funding("raised funding in the last two years", null), hiring("currently hiring sales", ["sales"])],
};
function withRounds(rs: FixtureProviderResponse[], rounds: Array<[string, string]>): FixtureProviderResponse[] {
  return rs.map((r) => r.actor !== ATOMUS ? r : {
    ...r, rows: r.rows.map((row) => {
      const y = structuredClone(row) as { company: { financial: { funding: { rounds: unknown[]; num_funding_rounds: number } } } };
      y.company.financial.funding.rounds = rounds.map(([type, at]) => ({ type, announced_at: at, raised_amount: 5_000_000, investors: ["Seedfund"] }));
      y.company.financial.funding.num_funding_rounds = rounds.length;
      return y as unknown as Record<string, unknown>;
    }),
  });
}
async function runWritten(name: string, rounds: Array<[string, string]>) {
  const c = compileChain(request(WRITTEN, SPEC as never), null);
  assert(c.ok && c.mission);
  const f = c.criteria.find((x) => x.dimension === "funding")!;
  assertEquals(shape(f), ["hard", 730, "user_explicit"], "the written window compiles hard");
  const g = GOLDEN.qualified();
  g.name = `w3-${name}`;
  g.mission = c.mission;
  g.responses = withRounds(structuredClone(g.responses), rounds);
  const r = await runGoldenMission(g);
  const lead = r.view.leads.find((l) => l.company.key === ACME);
  return { r, lead };
}

Deno.test("W3 E9: an unfunded company never qualifies for a written funding window", async () => {
  const { r, lead } = await runWritten("no-funding", []);
  assert(lead?.hard_checks.funding !== "pass", `funding ${lead?.hard_checks.funding}`);
  assertFalse(r.qualifiedKeys.includes(ACME), "the unfunded company qualified");
  assert(r.terminal !== "completed", `terminal ${r.terminal}`);
});

Deno.test("W3: a round outside the written window fails funding", async () => {
  const { r, lead } = await runWritten("outside", [["SERIES_A", daysAgo(800)]]);
  assertEquals(lead?.hard_checks.funding, "fail");
  assertFalse(r.qualifiedKeys.includes(ACME));
});

Deno.test("W3: a round inside the written window passes and the company qualifies", async () => {
  const { r, lead } = await runWritten("inside", [["SERIES_A", daysAgo(200)]]);
  assertEquals(lead?.hard_checks.funding, "pass");
  assert(r.qualifiedKeys.includes(ACME));
  assertEquals(r.terminal, "completed");
});
