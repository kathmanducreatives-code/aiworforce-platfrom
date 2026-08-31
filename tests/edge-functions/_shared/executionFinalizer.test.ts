// A RUN ALWAYS ENDS SOMEWHERE.
//
// TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec sat in `running` with
// `updated_at == created_at`: created, then never touched again, because the
// edge function was killed mid-Actor-call. The plan showed Running indefinitely.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_BUDGET_MS, EDGE_WALL_CLOCK_MS, SAFETY_MARGIN_MS, createExecutionDeadline,
  decideTerminalRecord, withGuaranteedTerminalState, type TerminalRecord,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";

/** A clock the test drives by hand. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const DONE = {
  completed_capabilities: ["startup_company_discovery", "persistence"],
  pending_capabilities: [],
  qualified_company_keys: ["domain:snapmagic.com"],
};

// ══════════════════════════════ 1. every run gets a terminal record ══

Deno.test("1. a thrown body still writes a terminal record", async () => {
  const written: TerminalRecord[] = [];
  const r = await withGuaranteedTerminalState(
    () => { throw new Error("edge function exploded"); },
    { write: (rec) => { written.push(rec); }, readState: () => ({ completed_capabilities: ["a"] }) },
  );
  assertEquals(r, undefined);
  assertEquals(written.length, 1, "the finalizer must run in `finally`");
  assertEquals(written[0].status, "failed");
  assertEquals(written[0].reason, "unhandled_exception");
  assert(written[0].detail?.includes("edge function exploded"));
  assert(written[0].resumable, "progress was made, so a resume can pick it up");
});

Deno.test("2. an early return still writes a terminal record", async () => {
  const written: TerminalRecord[] = [];
  await withGuaranteedTerminalState(
    () => Promise.resolve("done"),
    { write: (rec) => { written.push(rec); }, readState: () => DONE },
  );
  assertEquals(written.length, 1);
  assertEquals(written[0].status, "completed");
});

Deno.test("3. a successful completion is NEVER demoted by the finalizer", async () => {
  const written: TerminalRecord[] = [];
  await withGuaranteedTerminalState(
    () => Promise.resolve("ok"),
    { write: (rec) => { written.push(rec); }, readState: () => DONE },
  );
  assertEquals(written[0].status, "completed");
  assertEquals(written[0].reason, "capability_plan_complete");
  assertFalse(written[0].resumable);
});

Deno.test("4. a write failure cannot mask the run's outcome", async () => {
  const errs: unknown[] = [];
  const r = await withGuaranteedTerminalState(
    () => Promise.resolve(42),
    {
      write: () => { throw new Error("db down"); },
      readState: () => DONE,
      onWriteError: (e) => errs.push(e),
    },
  );
  assertEquals(r, 42, "the body's result survives a finalizer write failure");
  assertEquals(errs.length, 1);
});

// ══════════════════════════════════ 5/6. the deadline stops new work ══

Deno.test("5. the deadline expires while there is still time to write state", () => {
  const c = clock();
  const d = createExecutionDeadline({ budgetMs: 100_000, now: c.now, assumedCallMs: 12_000 });

  assertFalse(d.expired(), "fresh");
  c.advance(80_000);
  assertFalse(d.expired(), "20s left, a 12s call still fits");
  c.advance(9_000);
  assert(d.expired(), "11s left is not enough for a 12s call — stop now");
  assertEquals(d.elapsedMs(), 89_000);
  assert(d.remainingMs() > 0, "expired still leaves room to persist state");
});

Deno.test("5b. the budget reserves a real safety margin under the edge limit", () => {
  assertEquals(DEFAULT_BUDGET_MS, EDGE_WALL_CLOCK_MS - SAFETY_MARGIN_MS);
  assert(SAFETY_MARGIN_MS >= 20_000, "writing state needs headroom");
  assert(DEFAULT_BUDGET_MS < EDGE_WALL_CLOCK_MS);
});

Deno.test("6. the deadline learns from slow calls", () => {
  const c = clock();
  const d = createExecutionDeadline({ budgetMs: 100_000, now: c.now, assumedCallMs: 5_000 });
  c.advance(90_000);
  assertFalse(d.expired(), "10s left, 5s assumed");
  d.observeCall(24_300);          // the real memo23 start on task c8a6e53d
  assert(d.expired(), "a 24s call no longer fits in 10s");
});

Deno.test("7. hitting the deadline persists state as partial and resumable", async () => {
  const c = clock();
  const d = createExecutionDeadline({ budgetMs: 10_000, now: c.now, assumedCallMs: 12_000 });
  const written: TerminalRecord[] = [];
  await withGuaranteedTerminalState(
    () => Promise.resolve(null),
    {
      deadline: d,
      write: (rec) => { written.push(rec); },
      readState: () => ({
        completed_capabilities: ["startup_company_discovery"],
        pending_capabilities: ["company_identity_resolution", "company_enrichment"],
        provider_attempts: [1, 2, 3],
        accumulated_cost_units: 4,
      }),
    },
  );
  const rec = written[0];
  assertEquals(rec.status, "partial");
  assertEquals(rec.reason, "execution_deadline_reached");
  assert(rec.resumable);
  assertEquals(rec.last_completed_capability, "startup_company_discovery");
  assertEquals(rec.pending_capabilities.length, 2);
  assertEquals(rec.provider_attempts, 3);
  assertEquals(rec.accumulated_cost_units, 4, "cost is never reported as zero");
});

// ═════════════════════════════ 8. every outcome maps to a status ══

Deno.test("8. the decision is total — no input yields an unknown outcome", () => {
  const at = (o: Parameters<typeof decideTerminalRecord>[0], c: Parameters<typeof decideTerminalRecord>[1]) =>
    decideTerminalRecord(o, c);

  // A paid run in flight outranks everything — it must be adopted, not restarted.
  assertEquals(at({
    pending_runs: [{ run_id: "3Hv80atfVioMT9e4y", dataset_id: "kXRsrxikjrEiWNdBe", provider: "apify_yc_companies_memo23" }],
    pending_capabilities: ["company_enrichment"],
  }, { elapsedMs: 1 }).status, "pending_external_run");

  assertEquals(at({ terminal_reason: "provider_input_validation_failed" }, { elapsedMs: 1 }).reason,
    "provider_input_validation_failed");
  assertEquals(at({ terminal_reason: "provider_failure" }, { elapsedMs: 1 }).status, "failed");
  assertEquals(at({ pending_capabilities: ["x"] }, { elapsedMs: 1 }).reason, "partial_capability_progress");

  // Completed but found nothing is an honest completion, not a failure.
  const empty = at({ completed_capabilities: ["a"], pending_capabilities: [], qualified_company_keys: [] }, { elapsedMs: 1 });
  assertEquals(empty.status, "completed");
  assertEquals(empty.reason, "no_qualified_companies");

  // ── NULL STATE MUST STILL PRODUCE A RECORD RATHER THAN THROWING ────────
  //
  // Which it does, and that was always this assertion's point. What it used to
  // pin was the VALUE — `completed / no_qualified_companies` — and that value
  // was the bug: a null state means this invocation never called `observe()`,
  // so it never reached the engine and learned nothing. Reporting that as a
  // finished run with no results wrote `tasks.status = "complete"` over a live
  // checkpoint, and the sweeper only selects `ready`. Task fd4ed70a lost 23
  // companies to it.
  //
  // Totality is unchanged; the answer is now the truthful one.
  for (const st of [null, undefined]) {
    const rec = at(st, { elapsedMs: 0 });
    assertEquals(rec.status, "partial");
    assertEquals(rec.reason, "no_execution_state_observed");
    assertEquals(rec.resumable, true);
  }
});

Deno.test("9. an in-flight run is reported even when the deadline also passed", () => {
  const rec = decideTerminalRecord(
    { pending_runs: [{ run_id: "R1", dataset_id: "D1", provider: "apify_yc_companies_memo23" }] },
    { elapsedMs: 200_000, deadlineReached: true },
  );
  assertEquals(rec.status, "pending_external_run",
    "abandoning a billed run to report a timeout is what wasted rWikfnKgnp5DazDYr");
  assert(rec.resumable);
  assertEquals(rec.pending_runs[0].dataset_id, "D1");
});

Deno.test("10. the finalizer never touches the network", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadExecutionFinalizer.ts", import.meta.url));
  for (const forbidden of ["fetch(", "createClient", "supabase", "apifyFetch"]) {
    assertFalse(src.includes(forbidden), `${forbidden} must not appear — the writer is injected`);
  }
});
