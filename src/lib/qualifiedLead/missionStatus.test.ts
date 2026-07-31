// CANONICAL MISSION STATUS — every audited surface derives success from the
// CONTACT-ready quota, never from provider or task completion.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { taskQuotaUnmet, isQuotaShortfall, deriveWorkflowUiState } from "../chat/state.ts";
import { buildQuotaProgress } from "./quotaProgress.ts";
import { buildContinuationView } from "./continuation.ts";

/** A persisted company-first result at N of M CONTACT-ready. */
const runResult = (eligible: number, requested = 5) => ({
  company_first: { quota: { requested_leads: requested, eligible_leads: eligible } },
});

/** A plan whose tasks are all terminally succeeded — provider work is DONE. */
const donePlan = (eligible: number, requested = 5) => ({
  plan: { id: 'p1', status: 'complete' as const, created_at: new Date().toISOString() },
  tasks: [{
    id: 't1', status: 'succeeded' as const,
    updated_at: new Date().toISOString(),
    result: runResult(eligible, requested),
  }],
  approvals: [] as unknown[],
});

// =================================== 8,9,10,11. THE THREE OUTCOMES ==========

Deno.test("10/11. zero of five NEVER renders Complete, even with every task succeeded", () => {
  const input = donePlan(0);
  // The provider work is terminal and the plan says complete...
  assertEquals(input.tasks[0].status, 'succeeded');
  assertEquals(input.plan.status, 'complete');
  // ...and the mission is still Partial, because no CONTACT-ready lead exists.
  assertEquals(deriveWorkflowUiState(input as never), 'partial');
  assert(taskQuotaUnmet(runResult(0)));
  assert(isQuotaShortfall(input.tasks as never));
});

Deno.test("9. three of five renders Partial on every audited derivation", () => {
  const input = donePlan(3);
  assertEquals(deriveWorkflowUiState(input as never), 'partial');
  assert(taskQuotaUnmet(runResult(3)));

  // The Workbench progress block agrees.
  const progress = buildQuotaProgress({ requested_leads: 5, eligible_leads: 3 } as never, []);
  assertEquals(progress.eligible, 3);
  assertEquals(progress.remaining, 2);
  assertEquals(progress.headline, '3 of 5 CONTACT-ready leads');

  // And so does the continuation view. NOTE its wire shape is FLAT
  // (`requested_leads` at the top level), not nested under `quota` the way the
  // persisted task result is — the two readers consume different payloads.
  const cont = buildContinuationView({
    requested_leads: 5, eligible_leads: 3, remaining_leads: 2,
    terminal_status: 'round_limit_reached',
  } as never);
  assert(
    cont.lines.some((l) => l.includes('3 of 5 CONTACT-ready')),
    `continuation lines did not carry the CONTACT progress: ${cont.lines.join(' | ')}`,
  );
  assertEquals(cont.status, 'round_limit_reached');
});

Deno.test("8. five of five renders Complete", () => {
  const input = donePlan(5);
  assertEquals(deriveWorkflowUiState(input as never), 'complete');
  assertFalse(taskQuotaUnmet(runResult(5)));
  assertFalse(isQuotaShortfall(input.tasks as never));

  const progress = buildQuotaProgress({ requested_leads: 5, eligible_leads: 5 } as never, []);
  assertEquals(progress.remaining, 0);
  assertEquals(progress.headline, '5 of 5 CONTACT-ready leads');
});

Deno.test("8b. over-delivery is still Complete, never a shortfall", () => {
  assertFalse(taskQuotaUnmet(runResult(6)));
  assertEquals(deriveWorkflowUiState(donePlan(6) as never), 'complete');
});

// ============================ 11. PROVIDER COMPLETION IS NOT SUCCESS =========

Deno.test("11. a terminal task lifecycle cannot by itself produce Complete", () => {
  // Identical task lifecycle; only the CONTACT-ready count differs.
  for (const eligible of [0, 1, 4]) {
    const input = donePlan(eligible);
    assertEquals(
      deriveWorkflowUiState(input as never), 'partial',
      `${eligible} of 5 must be Partial despite succeeded tasks`,
    );
  }
  assertEquals(deriveWorkflowUiState(donePlan(5) as never), 'complete');
});

Deno.test("11b. the quota gate is checked BEFORE the completion branch", () => {
  // If the ordering ever inverted, a shortfall plan marked complete would return
  // 'complete'. This pins the precedence.
  const input = donePlan(0);
  input.plan.status = 'complete';
  assertEquals(deriveWorkflowUiState(input as never), 'partial');
});

// ============================================ the documented fail-open =======

Deno.test("a result with NO quota block is not treated as a shortfall (non-Lead workflows)", () => {
  // Deliberate: `taskQuotaUnmet` returns false when no quota is present so that
  // content/signal workflows are untouched. Recorded here so the fail-open is a
  // decision with a test, not an accident — a qualified-lead run always persists
  // the quota block, and the assertions above cover that path.
  assertFalse(taskQuotaUnmet({}));
  assertFalse(taskQuotaUnmet({ company_first: {} }));
  assertFalse(taskQuotaUnmet(null));
  assertFalse(taskQuotaUnmet({ company_first: { quota: { requested_leads: 0 } } }));
});

Deno.test("the quota reader accepts both persisted shapes", () => {
  // `company_first.quota` (company-first runs) and a top-level `quota`.
  assert(taskQuotaUnmet({ company_first: { quota: { requested_leads: 5, eligible_leads: 0 } } }));
  assert(taskQuotaUnmet({ quota: { requested_leads: 5, eligible_leads: 0 } }));
});

// ================================== only CONTACT-ready counts ================

Deno.test("7. qualified companies and verified people do NOT move the quota", () => {
  // Backend reports plenty of companies, zero CONTACT-ready.
  const progress = buildQuotaProgress({
    requested_leads: 5, eligible_leads: 0,
    counts: { verifiedCompanies: 12, rawJobs: 45 },
  } as never, []);
  assertEquals(progress.eligible, 0);
  assertEquals(progress.remaining, 5);
  assertEquals(progress.qualifiedCompanies, 12);
  // The headline reports the CONTACT number, not the company number.
  assertEquals(progress.headline, '0 of 5 CONTACT-ready leads');
  assert(taskQuotaUnmet({ company_first: { quota: { requested_leads: 5, eligible_leads: 0 } } }));
});

Deno.test("21. funnel stages stay in their own units on the progress block", () => {
  const progress = buildQuotaProgress({
    requested_leads: 5, eligible_leads: 1,
    counts: { verifiedCompanies: 8, rawJobs: 45 },
  } as never, []);
  const keys = progress.metrics.map((m) => m.key);
  // Five distinct stages, no generic "results" number.
  assertEquals(keys, [
    'hiring_signals_reviewed', 'qualified_companies', 'verified_decision_makers',
    'contact_ready_leads', 'remaining_quota',
  ]);
  assertEquals(progress.hiringSignalsReviewed, 45);
  assertEquals(progress.qualifiedCompanies, 8);
  assertEquals(progress.eligible, 1);
  assertFalse(keys.includes('results' as never));
});
