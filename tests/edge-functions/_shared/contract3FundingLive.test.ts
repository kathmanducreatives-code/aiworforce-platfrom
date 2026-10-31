// CONTRACT 3 APPROVES ATOMUS AND NOT PVALYOU. Can Atomus ALONE settle the
// mission's funding claim ("raised funding within the last six months")?
//
// Read on the REAL Atomus payload preserved from the 2026-09-21 live probe
// (Wordware; `docs/audits/live-validation-2026-09-21/probe_atomus.json`), with
// the clock placed relative to its newest dated round (2024-11-21). STAGE needs
// the pair (`p6FundingPairLive`); RECENCY does not: a dated round decides
// "inside the window", and Atomus's own round count makes the history complete
// enough to FAIL a window nothing falls in. No citation is invented.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAtomusFunding } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { decideRecentlyFunded } from "../../../supabase/functions/_shared/fundingStageClaim.ts";

const probe = JSON.parse(Deno.readTextFileSync(new URL("../../../docs/audits/live-validation-2026-09-21/probe_atomus.json", import.meta.url)));
const ATOMUS = normalizeAtomusFunding(probe[0]).record!;
const decide = (now: string) => decideRecentlyFunded({ window_days: 180, records: [ATOMUS], now });

Deno.test("real Atomus alone: a round 55 days before 'now' PASSES a 180-day window", () => {
  const d = decide("2025-01-15T00:00:00Z");
  assertEquals(d.verdict, "pass", JSON.stringify(d.reasons));
  assertEquals(d.latest_announced_date, "2024-11-21");
});

Deno.test("real Atomus alone: 252 days later, with its complete round count, FAILS — not pending forever", () => {
  const d = decide("2025-07-31T00:00:00Z");
  assertEquals(d.verdict, "fail", JSON.stringify(d.reasons));
});

Deno.test("no record at all is PENDING — absence is never a funding failure", () => {
  assertEquals(decideRecentlyFunded({ window_days: 180, records: [], now: "2025-01-15T00:00:00Z" }).verdict, "pending");
});
