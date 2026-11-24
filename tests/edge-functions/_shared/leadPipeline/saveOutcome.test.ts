// A run is only as successful as what it SAVED. Found with the ATLAS simulator
// (`npm run dev:atlas -- database-write-failure`): every insert failed, yet the run said
// "completed" and "1 qualified". Both run paths now report failed/partial and the outcome
// says what did not reach Leads.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { missionOutcome } from "../../../../supabase/functions/_shared/leadPipeline/outcome.ts";
import { saveOutcome } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";

const rows = (failed: number, written: number) => ({ written, updated: 0, failed, rows: [] }) as never;

Deno.test("saveOutcome: nothing failed → the run's own status, written = inserted + updated", () => {
  assertEquals(saveOutcome("completed", null, rows(0, 4), 4), { status: "completed", reason: null, written: 4, failed: 0 });
  assertEquals(saveOutcome("completed", null, undefined, 3).status, "completed", "a store that reports nothing keeps the old behaviour");
});

Deno.test("saveOutcome: ALL rows failed → failed, never completed", () => {
  const s = saveOutcome("completed", null, rows(4, 0), 4);
  assertEquals(s.status, "failed");
  assertEquals(s.written, 0);
  assert(s.reason!.includes("none of the 4"));
});

Deno.test("saveOutcome: SOME rows failed → partial, reason keeps the run's own", () => {
  const s = saveOutcome("completed", null, rows(2, 2), 4);
  assertEquals([s.status, s.written, s.failed], ["partial", 2, 2]);
  assertEquals(saveOutcome("partial", "page budget reached", rows(1, 3), 4).reason, "1 of 4 result(s) could not be saved; page budget reached");
});

Deno.test("missionOutcome: found-but-unsaved is a FAILED request with an honest summary", () => {
  const o = missionOutcome({ requested: 5, qualified: 1, pending: 3, rejected: 1, runStatus: "completed", saved: { failed: 4, attempted: 4 } });
  assertEquals(o.status, "failed");
  assertEquals(o.notSaved, 4);
  assert(o.summary.startsWith("None of the 4 results could be saved"), o.summary);
  assert(o.nextStep!.includes("Nothing is retried automatically"));
});

Deno.test("missionOutcome: a partial save keeps the status and says what was lost", () => {
  const o = missionOutcome({ requested: 5, qualified: 1, pending: 3, rejected: 1, runStatus: "partial", saved: { failed: 2, attempted: 4 } });
  assertEquals(o.status, "completed_with_shortfall");
  assertEquals(o.notSaved, 2);
  assert(o.summary.endsWith("2 of 4 results could not be saved to Leads."), o.summary);
});

Deno.test("missionOutcome: no save report, or zero failures → exactly as before", () => {
  const a = missionOutcome({ requested: 5, qualified: 1, pending: 3, rejected: 1, runStatus: "completed" });
  const b = missionOutcome({ requested: 5, qualified: 1, pending: 3, rejected: 1, runStatus: "completed", saved: { failed: 0, attempted: 4 } });
  assertEquals(a, b);
  assertEquals("notSaved" in a, false);
});

Deno.test("missionOutcome: a blocked plan is still blocked (nothing was saved because nothing ran)", () => {
  const o = missionOutcome({ requested: 5, qualified: 0, pending: 0, rejected: 0, runStatus: "blocked", saved: { failed: 0, attempted: 0 } });
  assertEquals(o.status, "blocked");
});
