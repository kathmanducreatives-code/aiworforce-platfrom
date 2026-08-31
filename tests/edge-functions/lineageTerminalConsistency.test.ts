// WHEN A LINEAGE IS OVER, EVERY FIELD MUST SAY SO.
//
// ── THE ROW THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task fd4ed70a ended after seven generations with every candidate
// investigated and nothing qualified. It recorded:
//
//     auto_continuation  { decision: "frontier_exhausted", continuing: false }
//     terminal_record    { reason: "execution_deadline_reached",
//                          status: "partial", resumable: true }
//     result.resumable   true
//     lead_lineages.status  "active"
//
// One field was right. `terminal_record` and `resumable` were generation SIX's
// answer: the guard skips its write once the row is terminal — deliberately, so
// a cleanup-time decision cannot overrule the handler's — so the last record to
// land belonged to an earlier, still-resumable slice. And the lineage row went
// back to `active` because nothing ever passed `p_terminal_reason`, though
// `release_lineage_lease` has always supported it.
//
// The run was finished and its own state said it could be continued.
//
// ZERO network, ZERO DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  sealTerminalRecord, endingReasonFor, decideTerminalRecord,
  type TerminalRecord,
} from "../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import {
  lineageIsFinished, LINEAGE_FINISHING_REASONS, decideAutoContinuation,
} from "../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  isTerminalOutcome, isContinuable,
} from "../../supabase/functions/_shared/taskStatusContract.ts";

// deno-lint-ignore no-explicit-any
const any = (o: unknown): any => o;

/** Generation 6: ran out of wall clock with candidates left. Resumable. */
const GEN6: TerminalRecord = decideTerminalRecord({
  completed_capabilities: ["general_company_discovery", "company_enrichment"],
  pending_capabilities: ["hiring_verification"],
  failed_capabilities: [],
  provider_attempts: [1, 2, 3],
  pending_runs: [],
  accumulated_cost_units: 15,
  terminal_reason: null,
  qualified_company_keys: [],
}, { elapsedMs: 120_000, deadlineReached: true });

Deno.test("0. the fixture is the real generation-6 shape", () => {
  assertEquals(GEN6.reason, "execution_deadline_reached");
  assertEquals(GEN6.status, "partial");
  assertEquals(GEN6.resumable, true);
});

// ═══ 1. WHICH ENDINGS SEAL A LINEAGE ═══════════════════════════════════════

Deno.test("1. only the three endings that leave nothing to resume", () => {
  assertEquals([...LINEAGE_FINISHING_REASONS].sort(),
    ["cancelled", "frontier_exhausted", "quota_met"]);

  for (const reason of ["frontier_exhausted", "quota_met", "cancelled"]) {
    assert(lineageIsFinished({ continue: false, reason }), `${reason} ends the lineage`);
  }
  // PROTECTIONS AND FAULTS, NOT FINDINGS. `terminal` makes
  // `acquire_lineage_lease` refuse outright, so sealing on any of these would
  // make a bounded run — or a bug in our own handoff — permanently
  // unrecoverable, and would break the sweeper.
  for (const reason of [
    "continuation_ceiling", "cost_ceiling", "no_progress",
    "provider_failure", "dispatch_failed",
  ]) {
    assert(!lineageIsFinished({ continue: false, reason }),
      `${reason} must stay resumable`);
  }
});

Deno.test("1b. a run that is still continuing never seals", () => {
  assert(!lineageIsFinished({ continue: true, reason: "quota_unmet_frontier_remains" }));
  // Even if a continue reason ever collided with a finishing name.
  assert(!lineageIsFinished({ continue: true, reason: "frontier_exhausted" }));
  assert(!lineageIsFinished(null));
  assert(!lineageIsFinished(undefined));
});

Deno.test("1c. endingReasonFor maps only those three", () => {
  assertEquals(endingReasonFor("frontier_exhausted"), "frontier_exhausted");
  assertEquals(endingReasonFor("quota_met"), "quota_met");
  assertEquals(endingReasonFor("cancelled"), "run_cancelled");
  for (const r of ["cost_ceiling", "continuation_ceiling", "no_progress",
    "provider_failure", "dispatch_failed", "quota_unmet_frontier_remains"]) {
    assertEquals(endingReasonFor(r), null, `${r} must not seal`);
  }
});

// ═══ 2. THE EXACT TWO-GENERATION SHAPE ═════════════════════════════════════

Deno.test("2. earlier gen deadline/resumable + later gen frontier_exhausted → sealed", () => {
  // The later generation's own decision, from the real numbers.
  const decision = decideAutoContinuation({
    qualified: 0, requestedCount: 5,
    frontierRemaining: 0,          // every candidate investigated
    continuationsUsed: 5, maxContinuations: 10,
    costUnitsUsed: 23, maxCostUnits: 120,
    barrenSlices: 2, providerFailed: false, pendingRuns: 0,
  });
  assertEquals(decision.continue, false);
  assertEquals(decision.reason, "frontier_exhausted");
  assert(lineageIsFinished(decision));

  // Sealing generation 6's stale record with generation 7's ending.
  const sealed = sealTerminalRecord(GEN6, {
    reason: endingReasonFor(decision.reason)!, detail: decision.detail,
  });

  // ── THE REQUIRED INVARIANT ────────────────────────────────────────────
  assertEquals(sealed.reason, "frontier_exhausted");
  assertEquals(sealed.status, "completed");
  assertEquals(sealed.resumable, false);
  assert(sealed.detail && sealed.detail.includes("every discovered candidate"));
});

Deno.test("2b. sealing keeps the facts and replaces only the claim", () => {
  const sealed = sealTerminalRecord(GEN6, { reason: "frontier_exhausted" });
  // FACTS belong to the slice that produced them and are carried through.
  assertEquals(sealed.accumulated_cost_units, GEN6.accumulated_cost_units);
  assertEquals(sealed.provider_attempts, GEN6.provider_attempts);
  assertEquals(sealed.pending_capabilities, GEN6.pending_capabilities);
  assertEquals(sealed.last_completed_capability, GEN6.last_completed_capability);
  assertEquals(sealed.elapsed_ms, GEN6.elapsed_ms);
  assertEquals(sealed.version, GEN6.version);
  // And the input is untouched — no mutation.
  assertEquals(GEN6.reason, "execution_deadline_reached");
  assertEquals(GEN6.resumable, true);
});

Deno.test("2c. quota_met and cancellation seal the same way", () => {
  const met = decideAutoContinuation({
    qualified: 5, requestedCount: 5, frontierRemaining: 12,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 9, maxCostUnits: 120, barrenSlices: 0,
  });
  assertEquals(met.reason, "quota_met");
  assert(lineageIsFinished(met));
  assertEquals(sealTerminalRecord(GEN6, { reason: "quota_met" }).resumable, false);

  const stopped = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 40,
    continuationsUsed: 0, maxContinuations: 10,
    costUnitsUsed: 0, maxCostUnits: 120, barrenSlices: 0, cancelled: true,
  });
  assertEquals(stopped.reason, "cancelled");
  assert(lineageIsFinished(stopped));
  assertEquals(sealTerminalRecord(GEN6, { reason: "run_cancelled" }).reason, "run_cancelled");
});

// ═══ 3. WHAT MUST NOT BE SEALED ════════════════════════════════════════════

Deno.test("3. a ceiling stops the slice and leaves the lineage claimable", () => {
  const cost = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 30,
    continuationsUsed: 2, maxContinuations: 10,
    costUnitsUsed: 200, maxCostUnits: 120, barrenSlices: 0,
  });
  assertEquals(cost.continue, false);
  assertEquals(cost.reason, "cost_ceiling");
  assert(!lineageIsFinished(cost), "a spend guard is not a finding about the work");
  assertEquals(endingReasonFor(cost.reason), null);

  const cont = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 30,
    continuationsUsed: 10, maxContinuations: 10,
    costUnitsUsed: 5, maxCostUnits: 120, barrenSlices: 0,
  });
  assertEquals(cont.continue, false);
  assert(!lineageIsFinished(cont));
});

Deno.test("3b. a barren streak and a provider failure stay resumable", () => {
  const barren = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 8,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 5, maxCostUnits: 120, barrenSlices: 2,
  });
  assertEquals(barren.continue, false);
  assert(!lineageIsFinished(barren),
    "the frontier may still hold candidates a later slice resolves");

  const provider = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 8,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 5, maxCostUnits: 120, barrenSlices: 0, providerFailed: true,
  });
  assertEquals(provider.reason, "provider_failure");
  assert(!lineageIsFinished(provider), "the frontier is preserved on purpose");
});

Deno.test("3c. an in-flight paid run is never sealed away", () => {
  const awaiting = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 0,
    continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 5, maxCostUnits: 120, barrenSlices: 2, pendingRuns: 1,
  });
  // A zero frontier must NOT read as exhausted while a paid call may still
  // return rows — the 783fa163 scar.
  assert(!lineageIsFinished(awaiting) || awaiting.continue,
    "a pending run must not seal the lineage");
});

// ═══ 4. THE FIELDS AGREE WITH EACH OTHER ═══════════════════════════════════

Deno.test("4. the sealed end state satisfies the whole invariant", () => {
  const decision = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 0,
    continuationsUsed: 5, maxContinuations: 10,
    costUnitsUsed: 23, maxCostUnits: 120, barrenSlices: 2,
  });
  const sealed = sealTerminalRecord(GEN6, {
    reason: endingReasonFor(decision.reason)!, detail: decision.detail,
  });

  const end = {
    lineage_status: lineageIsFinished(decision) ? "terminal" : "active",
    lease_expires_at: null,
    terminal_record: sealed,
    resumable: sealed.resumable,
    continuation_required: decision.continue,
  };

  assertEquals(end.lineage_status, "terminal");
  assertEquals(end.terminal_record.reason, "frontier_exhausted");
  assertEquals(end.resumable, false);
  assertEquals(end.continuation_required, false);
  assertEquals(end.lease_expires_at, null);
  // Nothing anywhere still claims the run can be continued.
  assert(!end.resumable && !end.continuation_required);
});

Deno.test("4b. `round_limit_reached` is still the terminal_status vocabulary", () => {
  // `frontier_exhausted` is NOT a `TERMINAL_STATUS`, and writing a finalizer
  // reason into that field is the fafd9912 defect — `claim_sourcing_continuation`
  // refuses anything that is not `continuation_required`. The ending lives in
  // the RECORD; `terminal_status` keeps its own vocabulary.
  assert(isTerminalOutcome("round_limit_reached"));
  assert(!isTerminalOutcome("continuation_required"));
  assert(isContinuable("continuation_required"));
  assert(!isContinuable("round_limit_reached"));
});

// ═══ 5. THE SWEEPER IS UNAFFECTED ══════════════════════════════════════════

Deno.test("5. a resumable ending still produces no seal, so nothing is blocked", () => {
  for (const reason of ["cost_ceiling", "dispatch_failed", "provider_failure", "no_progress"]) {
    const d = { continue: false, reason };
    assertEquals(lineageIsFinished(d), false);
    assertEquals(endingReasonFor(reason), null);
    // No seal → the handler writes no `resumable: false`, no terminal record
    // override, and passes no `terminalReason`, so the lineage row stays
    // `active` and `acquire_lineage_lease` keeps accepting it.
  }
});
