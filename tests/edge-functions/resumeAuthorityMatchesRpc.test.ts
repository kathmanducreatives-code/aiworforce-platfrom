// TWO GATES MUST AGREE ABOUT WHETHER A RUN HAS FINISHED.
//
// ── THE DEADLOCK THIS EXISTS FOR ───────────────────────────────────────────
//
// Task 2f3d9c5c froze at generation 4 with a live frontier. The sweeper tried
// every three minutes for 45 minutes and got the same answer every time:
//
//     409 continuation_refused  reason: "already_terminal"
//
// 15 rejections, 3 dispatches. The row it was refusing looked like this:
//
//     result.terminal_status                "continuation_required"
//     company_first_state.terminal_status   "round_limit_reached"
//     company_first_state.next_action       "stopped"
//     status                                "ready"
//
// `claim_sourcing_continuation` reads the ROW first and would have granted the
// claim. `decideResume` read the CHECKPOINT first and refused. It runs first,
// so the run enforced a verdict it had already been overruled on.
//
// The stale verdict is not exotic: the legacy quota controller stamps a
// terminal status whenever it thinks the run is over, and with `maxRounds: 0`
// (the capability engine owns sourcing) `rounds.length >= maxRounds` is
// `0 >= 0` — so a loop that never ran stamps `round_limit_reached`. Its own
// recorded reason says "the legacy sourcing loop is disabled for this run".
//
// These tests pin the precedence to the RPC's `coalesce` order. If the two ever
// drift apart again, the first test fails.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideResume, type ResumableTaskRow,
} from "../../supabase/functions/_shared/sourcingContinuation.ts";
import { SOURCING_STATE_VERSION } from "../../supabase/functions/_shared/companyFirstSourcingState.ts";

const WS = "ws-1";
const TASK = "task-1";

function row(o: {
  rowTerminal?: string | null;
  innerTerminal?: string | null;
  status?: string;
  nextAction?: string;
}): ResumableTaskRow {
  const result: Record<string, unknown> = {
    company_first_state: {
      version: SOURCING_STATE_VERSION,
      current_round: 3,
      next_action: o.nextAction ?? "start_round",
      ...(o.innerTerminal !== undefined ? { terminal_status: o.innerTerminal } : {}),
    },
  };
  if (o.rowTerminal !== undefined) result.terminal_status = o.rowTerminal;
  return {
    id: TASK, workspace_id: WS, status: o.status ?? "ready",
    result, payload: { instruction: "Find me 5 B2B SaaS companies in the UK" },
  };
}

/**
 * The RPC's own rule, transcribed from `claim_sourcing_continuation`:
 *
 *   v_terminal := coalesce(result->>'terminal_status',
 *                          company_first_state->>'terminal_status', …)
 *   if v_terminal is not null and v_terminal <> 'continuation_required'
 *      → already_terminal
 */
function rpcWouldClaim(r: ResumableTaskRow): boolean {
  const res = (r.result ?? {}) as Record<string, unknown>;
  const inner = (res.company_first_state ?? {}) as Record<string, unknown>;
  const terminal = (typeof res.terminal_status === "string" ? res.terminal_status : null) ??
    (typeof inner.terminal_status === "string" ? inner.terminal_status : null);
  if (terminal !== null && terminal !== "continuation_required") return false;
  if (["complete", "failed", "skipped"].includes(String(r.status)) &&
      terminal !== "continuation_required") return false;
  return ["ready", "partial", "running", "complete"].includes(String(r.status));
}

// ─────────────────────────────── the deadlock ───────────────────────────────

Deno.test("THE DEADLOCK: 2f3d9c5c's exact row is resumable again", () => {
  const stuck = row({
    rowTerminal: "continuation_required",
    innerTerminal: "round_limit_reached",
    nextAction: "stopped",
    status: "ready",
  });
  const d = decideResume(stuck, WS, TASK);
  assert(d.ok, `must resume, got: ${d.ok ? "" : d.reason}`);
  assertEquals(rpcWouldClaim(stuck), true, "the RPC always would have");
});

Deno.test("the two gates agree on every combination", () => {
  const values = [undefined, null, "continuation_required", "round_limit_reached", "completed"];
  let checked = 0;
  for (const rowTerminal of values) {
    for (const innerTerminal of values) {
      const r = row({
        rowTerminal: rowTerminal as string | null | undefined,
        innerTerminal: innerTerminal as string | null | undefined,
      });
      const gate = decideResume(r, WS, TASK).ok;
      const rpc = rpcWouldClaim(r);
      assertEquals(
        gate, rpc,
        `disagreement: row=${String(rowTerminal)} inner=${String(innerTerminal)} ` +
        `— decideResume=${gate} rpc=${rpc}`,
      );
      checked++;
    }
  }
  assertEquals(checked, 25);
});

// ─────────────────────── a finished run still refuses ───────────────────────

Deno.test("a genuinely finished run is still refused", () => {
  for (const terminal of ["round_limit_reached", "completed", "search_exhausted", "budget_exhausted"]) {
    const d = decideResume(row({ rowTerminal: terminal }), WS, TASK);
    assert(!d.ok, `${terminal} must not resume`);
    assertEquals(d.reason, "already_terminal");
  }
});

Deno.test("the checkpoint still decides when the row says nothing", () => {
  // `coalesce` semantics: the inner value is consulted only in the row's silence.
  const d = decideResume(row({ innerTerminal: "round_limit_reached" }), WS, TASK);
  assert(!d.ok);
  assertEquals(d.reason, "already_terminal");
});

Deno.test("a clean checkpoint with no terminal status anywhere resumes", () => {
  const d = decideResume(row({}), WS, TASK);
  assert(d.ok);
  if (d.ok) assertEquals(d.nextRound, 3, "the checkpoint's own round pointer");
});

// ───────────────────────── unrelated guards still hold ──────────────────────

Deno.test("the other refusals are untouched", () => {
  assertEquals(decideResume(null, WS, TASK).ok, false);
  assertEquals(
    (decideResume({ id: TASK, workspace_id: "other", result: {} }, WS, TASK) as { reason: string }).reason,
    "workspace_mismatch",
  );
  assertEquals(
    (decideResume({ id: TASK, workspace_id: WS, result: {} }, WS, TASK) as { reason: string }).reason,
    "no_checkpoint",
  );
  assertEquals(
    (decideResume({
      id: TASK, workspace_id: WS, status: "ready",
      result: { company_first_state: { version: "ancient" } },
    }, WS, TASK) as { reason: string }).reason,
    "checkpoint_version_mismatch",
  );
  assertEquals(
    (decideResume(row({ status: "cancelled" }), WS, TASK) as { reason: string }).reason,
    "not_resumable_state",
  );
});

Deno.test("a disabled legacy loop's stamp does not end a live run", () => {
  // `maxRounds: 0` makes `0 >= 0` true, so a loop that never ran reports a round
  // limit. That must not outrank the row that says the engine has work left.
  const r = row({
    rowTerminal: "continuation_required",
    innerTerminal: "round_limit_reached",
    nextAction: "stopped",
  });
  assert(decideResume(r, WS, TASK).ok);
});
