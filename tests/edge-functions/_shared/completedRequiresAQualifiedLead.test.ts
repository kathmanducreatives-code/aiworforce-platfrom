// "COMPLETED" MEANS THE USER GOT WHAT THEY ASKED FOR.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 4ef85feb, 2026-09-05. Three log lines, all within one second:
//
//   [multi-round][complete] { requested: 5, delivered: 5, qualified: 0,
//                             review: 10, shortfall: 0 }
//   [multi-round] round_loop_stop { terminal_reason: "completed",
//                                   detail: "delivered 5 of 5 requested" }
//   [trace] outcome: 0 of 5 qualified — execution_deadline_checkpoint
//
// Two subsystems reached opposite conclusions about the same run in the same
// second. `eligibleForDelivery` admits `review` rows deliberately — an
// undecided company is still an opportunity worth showing — so ten reviews
// filled a five-row delivery window, `remaining_shortfall` fell to zero, and
// the ending was recorded as success on a run that qualified nobody.
//
// `multiRoundState.ts` already states the rule this enforces: "`completed`
// means the requested number was actually reached... so a shortfall is never
// dressed up as success."
//
// ZERO network, ZERO models, ZERO database.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  finalTerminalReason,
  type MultiRoundState,
} from "../../../supabase/functions/_shared/multiRoundState.ts";

/** The state as lineage 4ef85feb ended: window full, nothing decided. */
const state = (over: Partial<MultiRoundState> = {}): MultiRoundState =>
  ({
    requested_opportunity_count: 5,
    delivered_opportunity_count: 5,
    qualified_count: 0,
    review_count: 10,
    watch_count: 0,
    remaining_shortfall: 0,
    round_number: 1,
    round_history: [],
    discovered_company_count: 99,
    unique_company_count: 99,
    eligible_company_count: 70,
    evaluated_company_count: 12,
    provider_cost_units_used: 0,
    model_cost_units_used: 0,
    terminal_reason: null,
    ...over,
  }) as unknown as MultiRoundState;

const stopped = { start: false as const, terminal_reason: null, detail: "" };

Deno.test("THE RUN: a full window of review rows is NOT completed", () => {
  assertEquals(
    finalTerminalReason(state(), stopped),
    "quota_not_met",
    "5 delivered / 0 qualified was reported as `completed` on lineage 4ef85feb; " +
      "a window filled entirely with undecided companies is not the request met",
  );
});

Deno.test("one real lead plus review rows IS completed", () => {
  // Deliberately the zero case only. A run that decided something and filled
  // the rest of the window with review has produced leads, and calling that
  // `quota_not_met` would be its own dishonesty.
  assertEquals(
    finalTerminalReason(state({ qualified_count: 1, review_count: 9 }), stopped),
    "completed",
  );
});

Deno.test("a fully qualified window is still completed", () => {
  assertEquals(
    finalTerminalReason(
      state({ qualified_count: 5, review_count: 0 }),
      stopped,
    ),
    "completed",
  );
});

Deno.test("a genuine shortfall still reports its own reason", () => {
  // The pre-existing behaviour must survive: when the window is not full, the
  // specific stopping reason wins over the generic one.
  assertEquals(
    finalTerminalReason(
      state({ delivered_opportunity_count: 2, qualified_count: 2 }),
      { start: false, terminal_reason: "budget_exhausted", detail: "" },
    ),
    "budget_exhausted",
  );
  assertEquals(
    finalTerminalReason(
      state({ delivered_opportunity_count: 2, qualified_count: 2 }),
      stopped,
    ),
    "quota_not_met",
  );
});

Deno.test("zero qualified never returns completed, whatever the decision says", () => {
  // A decision object claiming `completed` must not smuggle it past the gate.
  assertEquals(
    finalTerminalReason(
      state(),
      { start: false, terminal_reason: "completed", detail: "" },
    ),
    "quota_not_met",
  );
});

Deno.test("over-delivery with nothing qualified is still not completed", () => {
  assertEquals(
    finalTerminalReason(
      state({ delivered_opportunity_count: 12, review_count: 12 }),
      stopped,
    ),
    "quota_not_met",
  );
});
