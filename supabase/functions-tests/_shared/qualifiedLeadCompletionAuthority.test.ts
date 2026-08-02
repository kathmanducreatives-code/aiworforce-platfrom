// CONTACT-READY IS THE COMPLETION AUTHORITY.
//
// Production plan 43fb7313-138e-4496-83de-92c3e0b7392f (2026-07-29 09:08Z) asked
// for 5 qualified leads, fetched 25 raw Indeed rows (18 after dedup), matched 1
// on title family, verified 0 companies, attempted 0 people searches and
// delivered 0 CONTACT-ready leads — and the UI reported "Complete".
//
// `projectStatus` mapped every non-continuation terminal outcome to
// `taskStatus: "completed"`, on the reading that it meant "no further rounds".
// Nothing downstream reads it that way: `tasks.status: complete` plus
// `task_status: completed` renders as a finished, successful run.
//
// OFFLINE ONLY. No provider, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectStatus, quotaMet, isContinuable } from "../../functions/_shared/taskStatusContract.ts";

const REQUESTED = 5;

// ============================================== 1./2. raw rows are not leads ==

Deno.test("2. 25 raw jobs and 0 CONTACT-ready leads cannot complete the plan", () => {
  const p = projectStatus("search_exhausted", null, { contactReady: 0, requested: REQUESTED });
  assertEquals(p.taskStatus, "partial");
  assertFalse(p.taskStatus === "completed");
  // The lifecycle really is over — search exhaustion is not resumable — but the
  // WORKFLOW is partial, and that is what the plan projection shows.
  assertEquals(p.rowStatus, "complete");
  assertEquals(p.terminalStatus, "search_exhausted");
});

Deno.test("1. no raw-volume threshold can substitute for CONTACT-ready leads", () => {
  // Every number the run actually produced, none of which is a lead.
  for (const rawVolume of [5, 18, 25, 100]) {
    assertFalse(quotaMet({ contactReady: 0, requested: REQUESTED }), `raw=${rawVolume}`);
  }
  // Nor do companies, WATCH or NEEDS_REVIEW candidates — none of them reach
  // `contactReady`, which is the only input this authority accepts.
  assertFalse(quotaMet({ contactReady: 4, requested: 5 }));
  assert(quotaMet({ contactReady: 5, requested: 5 }));
  assert(quotaMet({ contactReady: 6, requested: 5 }));
});

Deno.test("3. 5 CONTACT-ready leads complete the plan", () => {
  const p = projectStatus("completed", null, { contactReady: 5, requested: REQUESTED });
  assertEquals(p.taskStatus, "completed");
  assertEquals(p.rowStatus, "complete");
});

Deno.test("a quota met under any terminal reason still reads completed", () => {
  // Exhausting the search AFTER delivering the quota is a success.
  for (const terminal of ["search_exhausted", "budget_exhausted", "round_limit_reached", "completed"]) {
    assertEquals(
      projectStatus(terminal, null, { contactReady: 5, requested: 5 }).taskStatus,
      "completed",
      terminal,
    );
  }
});

Deno.test("every non-resumable terminal reason with an unmet quota is partial", () => {
  for (const terminal of ["search_exhausted", "budget_exhausted", "round_limit_reached", "quota_not_met"]) {
    const p = projectStatus(terminal, null, { contactReady: 0, requested: 5 });
    assertEquals(p.taskStatus, "partial", terminal);
    assertEquals(p.terminalStatus, terminal);
  }
});

// ================================================ 16. nothing else regresses ==

Deno.test("16. continuation, failure and approval projections are unchanged", () => {
  // A checkpoint is still resumable and still partial.
  const cont = projectStatus("continuation_required", null, { contactReady: 0, requested: 5 });
  assertEquals(cont, { rowStatus: "ready", taskStatus: "partial", terminalStatus: "continuation_required" });
  assert(isContinuable(cont.terminalStatus));

  // A real failure still fails, quota or not.
  assertEquals(
    projectStatus("provider_failure", null, { contactReady: 0, requested: 5 }).taskStatus,
    "failed",
  );
  // An invariant violation outranks a met quota.
  assertEquals(
    projectStatus("completed", "write_boundary_violation", { contactReady: 5, requested: 5 }).taskStatus,
    "failed",
  );
  // Search exhaustion is still not continuable — this fix does not offer a
  // Continue where none is safe.
  assertFalse(isContinuable("search_exhausted"));
});

Deno.test("omitting the quota preserves the previous behaviour exactly", () => {
  // Callers that cannot supply a quota must be unaffected.
  assertEquals(projectStatus("search_exhausted").taskStatus, "completed");
  assertEquals(projectStatus("search_exhausted", null, null).taskStatus, "completed");
  // A zero or malformed request is not evidence of delivery either way.
  assertFalse(quotaMet({ contactReady: 0, requested: 0 }));
  assertFalse(quotaMet(null));
});

// ------------------------------------------------------ 12. quota stops work --

Deno.test("12. a met quota is terminal, so no further source may run", () => {
  const met = projectStatus("completed", null, { contactReady: 5, requested: 5 });
  assertFalse(isContinuable(met.terminalStatus), "a satisfied run must not invite more sourcing");
  assertEquals(met.rowStatus, "complete");
});
