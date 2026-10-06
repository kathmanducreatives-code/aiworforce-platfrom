// RC05 — FUNDING PRESENCE, CALENDAR WINDOWS AND DATE BOUNDS
// (quality run 2026-10-06, Fix Wave 2 step 5).
//
// "Has LlamaIndex raised venture funding?" was refused as unprovable, "AI
// startups that have raised venture funding" compiled funding as a target, and
// "funded this year" / "before 2024" lost their meaning. Presence is now its own
// claim, decided by `decideHasRaised`, separate from recency and stage. Pure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideHasRaised, type FundingRecordFact } from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { calendarWindow, deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const record = (rounds: Array<[string, string | null, string[]?, string?]>, complete = true): FundingRecordFact => ({
  provider: "atomus", actor: "apify_funding_atomus", history_complete: complete, reported_round_count: complete ? rounds.length : null,
  rounds: rounds.map(([round_type, announced_date, source_urls, method]) => ({
    round_type, announced_date, amount_usd: null, investors: [], source_urls: source_urls ?? [], method: method ?? "provider_field",
  })),
}) as unknown as FundingRecordFact;
const verdict = (records: FundingRecordFact[], kind: "any" | "venture", before: string | null = null) =>
  decideHasRaised({ records, kind, before }).verdict;

Deno.test("RC05 presence: non-equity assistance never satisfies funding — any or venture", () => {
  assertEquals(verdict([record([["NON_EQUITY_ASSISTANCE", "2025-10-08"]])], "any"), "fail");
  assertEquals(verdict([record([["NON_EQUITY_ASSISTANCE", "2025-10-08"]])], "venture"), "fail");
  assertEquals(verdict([record([["NON_EQUITY_ASSISTANCE", "2025-10-08"]], false)], "any"), "pending", "absence is never disproof");
  // LlamaIndex's shape: the NEA event is never the carrier; the Series A is.
  const both = decideHasRaised({ records: [record([["NON_EQUITY_ASSISTANCE", "2025-10-08"], ["SERIES_A", "2025-03-04"]])], kind: "venture" });
  assertEquals([both.verdict, both.carrier_rounds.map((r) => r.round_type)], ["pass", ["SERIES_A"]]);
});

Deno.test("RC05 presence: venture means equity — a grant or debt is funding, not venture funding", () => {
  assertEquals(verdict([record([["GRANT", "2024-02-01"]])], "any"), "pass");
  assertEquals(verdict([record([["GRANT", "2024-02-01"]])], "venture"), "fail");
  assertEquals(verdict([record([["DEBT_FINANCING", "2024-02-01"]])], "venture"), "fail");
  assertEquals(verdict([record([["Venture Round", "2023-05-01"]])], "venture"), "pass", "a 'Venture Round' label is venture");
});

Deno.test("RC05 presence: 'before 2024' bounds the round by date; unverifiable rounds stay pending", () => {
  assertEquals(verdict([record([["SERIES_A", "2023-06-01"]])], "any", "2024-01-01"), "pass");
  assertEquals(verdict([record([["SERIES_A", "2024-03-01"]])], "any", "2024-01-01"), "fail");
  assertEquals(verdict([record([["SERIES_A", null, ["https://news.example/a"]]], false)], "any", "2024-01-01"), "pending");
  assertEquals(verdict([record([["SEED", "2024-01-01", [], "model_extraction"]], false)], "any"), "pending");
  assertEquals(verdict([], "any"), "pending");
});

Deno.test("RC05 compile: presence is hard and windowless; recency and hedges are unchanged", () => {
  const funding = (q: string) => deriveMissionCriteria(parseLeadMissionDeterministic(q)).find((c) => c.dimension === "funding")!;
  const presence = (q: string) => {
    const f = funding(q);
    return [f.kind, f.time_window?.days ?? null, (f.value as { presence?: string }).presence ?? null,
      (f.value as { before?: string }).before ?? null];
  };
  assertEquals(presence("Find AI startups that have raised venture funding."), ["hard", null, "venture", null]);
  assertEquals(presence("Find AI startups that raised funding before 2024."), ["hard", null, "any", "2024-01-01"]);
  // A modal makes it hard too — and it must still say WHAT raise: venture, not any.
  assertEquals(presence("Find AI companies that must have raised venture funding."), ["hard", null, "venture", null]);
  assertEquals((funding("Find AI companies that must have raised funding in the last 2 years.").value as { presence?: string }).presence,
    undefined, "a modal with a window is recency, never presence");
  // Not presence: recency, a stated window, a hedge, a raise that has not happened.
  assertEquals([funding("Find AI startups that recently raised funding.").kind, funding("Find AI startups that recently raised funding.").time_window?.days], ["hard", 180]);
  assertEquals((funding("Find AI startups that raised funding in the last 6 months.").value as { presence?: string }).presence, undefined);
  assertEquals(funding("Find AI startups that may have raised venture funding.").kind, "target");
  assertEquals(funding("Find AI startups that are raising funding.").kind, "target");
});

Deno.test("RC05 calendar: 'this year / month / quarter / week' is days since that period began, inclusive", () => {
  const at = new Date("2026-10-06T12:00:00Z");
  assertEquals(calendarWindow("funded this year", at), { days: 279, rule: "this year" });
  assertEquals(calendarWindow("raised a Series A this month", at), { days: 6, rule: "this month" });
  assertEquals(calendarWindow("funded this quarter", at), { days: 6, rule: "this quarter" });
  assertEquals(calendarWindow("funded this week", at), { days: 2, rule: "this week" });
  assertEquals(calendarWindow("raised funding recently", at), null);
});
