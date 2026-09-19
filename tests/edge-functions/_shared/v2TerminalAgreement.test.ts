// P5 RELEASE GATE — A SATISFIED LEAD V2 MISSION IS COMPLETE EVERYWHERE.
//
// Canary 9b1b70a2 (commit 383633cd) delivered 1 of the 1 qualified company it
// was asked for, and the canonical decision said so (`quota_met`). The records:
//
//   queue complete · task row complete · lineage terminal
//   plan partial · result round_limit_reached / partial
//
// Three causes, each pinned here:
//   a. the legacy controller's ROUND COUNT (`round_limit_reached`) outlived the
//      canonical stop;
//   b. the task status was computed from the legacy CONTACT quota (0 of 1)
//      although the company is the deliverable;
//   c. a plan checkpointed `partial` by an earlier slice could never be
//      finished, and the worker's reconciliation accepted `partial` beside a
//      completed task.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { settleV2Outcome } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { nextPlanStatus, projectStatus } from "../../../supabase/functions/_shared/taskStatusContract.ts";
import {
  applyTerminalPatch, planTerminalReconciliation, terminalViolations, type TerminalRows,
} from "../../../supabase/functions/_shared/leadMissionTerminal.ts";

/** The baseline canary's inputs, exactly as run-agent held them. */
const CANARY = {
  continuing: false, stopReason: "quota_met", legacyStatus: "round_limit_reached",
  legacyQuota: { eligible_leads: 0, requested_leads: 1 },
  canonicalQualified: 1, requestedCount: 1, companyIsDeliverable: true,
};

/** run-agent's plan mapping (`finalizeCompanyFirstPlan`). */
const planFor = (taskStatus: string) => taskStatus === "completed" ? "complete" : taskStatus === "failed" ? "failed" : "partial";

Deno.test("canary 9b1b70a2: quota_met settles as completed on the task, the plan and the quota", () => {
  const o = settleV2Outcome(CANARY);
  assertEquals(o.terminal, "completed", "the canonical stop, not the legacy round count");
  assertEquals([o.deliverable, o.delivered, o.requested], ["company", 1, 1]);
  const s = projectStatus(o.terminal, null, o.quota);
  assertEquals([s.rowStatus, s.taskStatus, s.terminalStatus], ["complete", "completed", "completed"]);
  assertEquals(planFor(s.taskStatus), "complete");
});

Deno.test("the legacy inputs alone reproduce the canary's disagreement — the fix is what changed it", () => {
  const s = projectStatus(CANARY.legacyStatus, null, { contactReady: 0, requested: 1 });
  assertEquals([s.rowStatus, s.taskStatus, s.terminalStatus], ["complete", "partial", "round_limit_reached"]);
});

Deno.test("a mission asking for CONTACT-ready leads keeps the contact quota", () => {
  const o = settleV2Outcome({ ...CANARY, companyIsDeliverable: false });
  assertEquals([o.deliverable, o.delivered], ["contact", 0]);
  assertEquals(projectStatus(o.terminal, null, o.quota).taskStatus, "partial", "0 of 1 contacts is short, whatever the companies");
});

Deno.test("an unfilled stop is partial, a refused request is failed, a continuing slice is resumable", () => {
  const exhausted = settleV2Outcome({ ...CANARY, stopReason: "frontier_exhausted", canonicalQualified: 0 });
  assertEquals(exhausted.terminal, "search_exhausted");
  assertEquals(projectStatus(exhausted.terminal, null, exhausted.quota).taskStatus, "partial");

  const budget = settleV2Outcome({ ...CANARY, stopReason: "cost_ceiling", canonicalQualified: 0 });
  assertEquals(budget.terminal, "budget_exhausted");

  const refused = settleV2Outcome({ ...CANARY, legacyStatus: "invalid_request" });
  assertEquals(projectStatus(refused.terminal, null, refused.quota).taskStatus, "failed", "a refused request stays failed");

  const going = settleV2Outcome({ ...CANARY, continuing: true, stopReason: "replenishment_required", canonicalQualified: 0 });
  assertEquals(projectStatus(going.terminal, null, going.quota).rowStatus, "ready");
});

Deno.test("a plan checkpointed partial can be finished; a finished plan is never re-opened", () => {
  assertEquals(nextPlanStatus("partial", "complete"), "complete", "slice 1 checkpointed, slice 3 finished");
  assertEquals(nextPlanStatus("partial", "failed"), "failed");
  assertEquals(nextPlanStatus("executing", "partial"), "partial");
  assertEquals(nextPlanStatus(null, "complete"), "complete");
  assertEquals(nextPlanStatus("complete", "partial"), null, "never demoted");
  assertEquals(nextPlanStatus("failed", "complete"), null, "never resurrected");
  assertEquals(nextPlanStatus("complete", "complete"), null, "idempotent");
});

Deno.test("the worker's reconciliation: a completed task never leaves the plan partial", () => {
  const rows: TerminalRows = {
    task: { status: "complete", result: { task_status: "completed", terminal_status: "completed" } },
    lineage: { status: "terminal" },
    plan: { status: "partial" },
  };
  assertEquals(terminalViolations("complete", rows), ["plan.status=partial but the task completed"]);
  const patch = planTerminalReconciliation("complete", "quota_met", rows, "2026-09-19T00:00:00Z");
  assertEquals(patch.plan?.status, "complete");
  assertEquals(terminalViolations("complete", applyTerminalPatch(rows, patch)), []);

  // A mission that stopped SHORT keeps its partial plan: that one is the truth.
  const short: TerminalRows = { ...rows, task: { status: "complete", result: { task_status: "partial", terminal_status: "search_exhausted" } } };
  assertEquals(terminalViolations("complete", short), []);
});

Deno.test("run-agent writes the settled outcome to every surface it owns", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  for (const wired of [
    "effectiveTerminal, cf.writeBoundary.invariantViolation, v2Outcome ? v2Outcome.quota : {",
    "eligible_leads: v2Outcome.delivered,",
    "terminal_status: effectiveTerminal,\n                },",
    "eligible: v2Outcome ? v2Outcome.delivered : cf.quota.eligible_leads,",
    "terminalStatus: effectiveTerminal,",
    "if (nextPlanStatus(currentStatus, planStatus) === null) return;",
    "const effectiveTerminal = v2Outcome\n          ? v2Outcome.terminal",
  ]) assert(src.includes(wired), `run-agent must carry: ${wired}`);
});
