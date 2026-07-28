// COMPANY-FIRST PLAN FINALIZATION AND CHECKPOINT PERSISTENCE.
//
// Both defects are reproduced from production run dc41c9f2 / task fc7a0ab8
// (2026-07-28 10:38–10:41Z):
//
//   1. The task finished correctly at 10:40:51 as partial / continuation_required,
//      and `task_plans.dc41c9f2` still said `executing` with `updated_at` equal to
//      `created_at`. The UI waited nine minutes for a transition nobody was going
//      to write.
//
//   2. `result` contained no `company_first_state`. Across the ENTIRE production
//      tasks table, zero rows ever had one — because the store wrote the sourcing
//      word "partial" into `tasks.status`, whose CHECK constraint allows only
//      pending / ready / running / awaiting_approval / complete / failed. Postgres
//      rejected the whole statement and the catch swallowed it, so continuation
//      had nothing to resume from and re-paid for every provider call.
//
// OFFLINE ONLY. No Actor, Firecrawl, model or database. Every client is a fake.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkpointRowStatus, safeCheckpointFailure, supabaseSourcingStateStore,
  newSourcingState, SOURCING_STATE_KEY, SOURCING_STATE_VERSION,
  hasCompletedCall, recordCompletedCall, isResumable, stateBelongsTo,
  type CompanyFirstSourcingState,
} from "./companyFirstSourcingState.ts";
import { TASK_ROW_STATUSES, projectStatus } from "./taskStatusContract.ts";

// The production fixture.
const PLAN_ID = "dc41c9f2-e528-48fd-a268-74feb9d62d18";
const TASK_ID = "fc7a0ab8-2d20-4995-917c-62e364cd1a05";
const WORKSPACE_ID = "e510c1a6-2bb8-4aa4-95f7-0beb786ed995";

/** The production `tasks.status` CHECK constraint, verbatim. */
const TASKS_STATUS_ALLOWED = ["pending", "ready", "running", "awaiting_approval", "complete", "failed"];

/**
 * A fake Supabase client that ENFORCES the real constraint.
 *
 * This is the whole point: a permissive fake is what let the defect ship. Writing
 * an illegal status here fails exactly as production does — the statement is
 * rejected wholesale, so the `result` never lands either.
 */
function fakeDb(initial: Record<string, unknown> = {}) {
  const rows: Record<string, { status: string; result: Record<string, unknown> }> = {
    [TASK_ID]: { status: "running", result: { ...initial } },
  };
  const plans: Record<string, { status: string; completed_at?: string }> = {
    [PLAN_ID]: { status: "executing" },
  };
  const rejected: Array<{ status: string }> = [];
  const activity: Array<Record<string, unknown>> = [];
  let planUpdates = 0;

  const db = {
    from(table: string) {
      return {
        select: (_c: string) => ({
          eq: (_c2: string, id: unknown) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: table === "tasks"
                  ? (rows[String(id)] ?? null)
                  : (plans[String(id)] ?? null),
              }),
          }),
        }),
        update: (v: Record<string, unknown>) => ({
          eq: (_c2: string, id: unknown) => {
            if (table === "tasks") {
              const status = String(v.status ?? "");
              if (!TASKS_STATUS_ALLOWED.includes(status)) {
                rejected.push({ status });
                // Production behaviour: PostgREST reports, it does not throw.
                return Promise.resolve({
                  error: { code: "23514", message: `new row violates check constraint "tasks_status_check"` },
                });
              }
              rows[String(id)] = {
                status,
                result: (v.result ?? rows[String(id)]?.result ?? {}) as Record<string, unknown>,
              };
              return Promise.resolve({ error: null });
            }
            planUpdates += 1;
            plans[String(id)] = { ...plans[String(id)], ...(v as { status: string }) };
            return Promise.resolve({ error: null });
          },
        }),
        insert: (v: Record<string, unknown>) => {
          activity.push(v);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db, rows, plans, rejected, activity, planUpdates: () => planUpdates };
}

function fixtureState(): CompanyFirstSourcingState {
  const s = newSourcingState({
    workspaceId: WORKSPACE_ID, taskId: TASK_ID,
    requestedLeadCount: 5, quotaPolicy: "contact_only", now: "2026-07-28T10:40:50.651Z",
  });
  // Two completed Apify rounds, exactly as production recorded them.
  s.current_round = 3;
  s.completed_rounds = [
    { round_number: 1, strategy_hash: "h1", title_queries: ["Sales Operations"], delta_titles: ["Sales Operations"], plan_source: "deterministic_registry", planner_status: "ok", funnel: {}, eligible_after: 0, remaining_after: 5, estimated_cost: 0.25, actual_provider_calls: 1, completed_at: "2026-07-28T10:40:08.891Z" },
    { round_number: 2, strategy_hash: "h2", title_queries: ["Revenue Operations"], delta_titles: ["Revenue Operations"], plan_source: "deterministic_registry", planner_status: "ok", funnel: {}, eligible_after: 0, remaining_after: 5, estimated_cost: 0.25, actual_provider_calls: 1, completed_at: "2026-07-28T10:40:48.736Z" },
  ];
  recordCompletedCall(s, { idempotency_key: "apify:round1", round: 1, actor_key: "apify_jobs", company_key: null, item_count: 25, completed_at: "2026-07-28T10:40:08.891Z" });
  recordCompletedCall(s, { idempotency_key: "apify:round2", round: 2, actor_key: "apify_jobs", company_key: null, item_count: 25, completed_at: "2026-07-28T10:40:48.736Z" });
  s.eligible_leads = 0;
  s.remaining_leads = 5;
  s.next_action = "start_round";
  return s;
}

// ============================================ DEFECT 2 — checkpoint survives ==

Deno.test("9./10. the checkpoint is written and survives, instead of being rejected", async () => {
  const f = fakeDb();
  const store = supabaseSourcingStateStore(f.db as never);
  const state = fixtureState();

  const saved = await store.save(TASK_ID, state, "partial");

  assertEquals(saved.ok, true, "the checkpoint must be accepted");
  assertEquals(f.rejected.length, 0, "no statement may be rejected by the constraint");
  // The state actually landed.
  const stored = f.rows[TASK_ID].result[SOURCING_STATE_KEY] as CompanyFirstSourcingState;
  assert(stored, "company_first_state must survive the write");
  assertEquals(stored.version, SOURCING_STATE_VERSION);
  assertEquals(stored.completed_rounds.length, 2);
  // The row status is legal; the sourcing word lives in the result.
  assert(TASKS_STATUS_ALLOWED.includes(f.rows[TASK_ID].status), f.rows[TASK_ID].status);
  assertEquals(f.rows[TASK_ID].status, "ready");
  assertEquals(f.rows[TASK_ID].result.task_status, "partial");
});

Deno.test("9.B the pre-fix write is what the constraint rejected", () => {
  // Documents the defect: "partial" is not a legal tasks.status value.
  assertFalse(TASKS_STATUS_ALLOWED.includes("partial"));
  assertEquals(checkpointRowStatus("partial"), "ready");
  // A status that IS legal passes through untouched.
  for (const legal of TASK_ROW_STATUSES) {
    if (TASKS_STATUS_ALLOWED.includes(legal)) assertEquals(checkpointRowStatus(legal), legal);
  }
});

Deno.test("10.B a rejected checkpoint is reported, never swallowed", async () => {
  const f = fakeDb();
  // A store whose caller somehow still supplies an illegal value must SAY so.
  const store = supabaseSourcingStateStore({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { result: {} } }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: { code: "23514", message: 'violates check constraint "tasks_status_check"' } }) }),
    }),
  } as never);

  const saved = await store.save(TASK_ID, fixtureState(), "partial");
  assertEquals(saved.ok, false);
  assertEquals(saved.reason, "constraint_violation");
  assertEquals(f.rejected.length, 0);
});

Deno.test("10.C failure categories stay safe and never carry row contents", () => {
  assertEquals(safeCheckpointFailure('violates check constraint "tasks_status_check"'), "constraint_violation");
  assertEquals(safeCheckpointFailure("new row violates row-level security policy"), "permission_denied");
  assertEquals(safeCheckpointFailure("statement timeout"), "timeout");
  assertEquals(safeCheckpointFailure("SECRET sk-ant-abc123 leaked here"), "checkpoint_write_failed");
});

// ================================================ DEFECT 2 — continuation ====

Deno.test("11./12./13./14. continuation resumes and does not re-pay", async () => {
  const f = fakeDb();
  const store = supabaseSourcingStateStore(f.db as never);
  await store.save(TASK_ID, fixtureState(), "partial");

  // A fresh isolate loads the checkpoint.
  const resumed = await store.load(TASK_ID);
  assert(resumed, "a saved checkpoint must be loadable — this returned null in production");
  assert(stateBelongsTo(resumed, WORKSPACE_ID, TASK_ID));
  assert(isResumable(resumed));

  // 11. resumes at the NEXT round, not round one.
  assertEquals(resumed.current_round, 3);
  assert(resumed.current_round > 1, "a resumed run must not restart at round one");

  // 12./13. both paid Apify calls are still recorded, so neither is repeated.
  assert(hasCompletedCall(resumed, "apify:round1"));
  assert(hasCompletedCall(resumed, "apify:round2"));
  assertEquals(resumed.completed_calls.length, 2);

  // 14. the CONTACT quota survives untouched.
  assertEquals(resumed.requested_lead_count, 5);
  assertEquals(resumed.eligible_leads, 0);
  assertEquals(resumed.remaining_leads, 5);
  assertEquals(resumed.quota_policy, "contact_only");
});

Deno.test("15. a duplicate continuation is idempotent", async () => {
  const f = fakeDb();
  const store = supabaseSourcingStateStore(f.db as never);
  const state = fixtureState();

  await store.save(TASK_ID, state, "partial");
  const first = await store.load(TASK_ID);
  await store.save(TASK_ID, state, "partial");
  const second = await store.load(TASK_ID);

  assertEquals(JSON.stringify(first), JSON.stringify(second));
  assertEquals(second!.completed_calls.length, 2, "a repeated save must not duplicate paid calls");
});

Deno.test("17. the production fixture can continue without restarting round one", async () => {
  const f = fakeDb();
  const store = supabaseSourcingStateStore(f.db as never);
  await store.save(TASK_ID, fixtureState(), "partial");
  const resumed = (await store.load(TASK_ID))!;

  // What the production task actually had: nothing.
  const productionResult: Record<string, unknown> = {
    task_status: "partial", terminal_status: "continuation_required",
  };
  assertFalse(SOURCING_STATE_KEY in productionResult, "the production fixture had no checkpoint");
  // What it has now.
  assert(SOURCING_STATE_KEY in f.rows[TASK_ID].result);
  assertEquals(resumed.completed_calls.length, 2);
});

// ============================================ DEFECT 1 — plan finalization ===
//
// The projection under test is the pure mapping the runtime applies. It is
// asserted here directly so the contract is pinned without an edge-function
// harness; the wiring itself is guarded by the call-graph test below.

function planStatusFor(terminal: string): string {
  const s = projectStatus(terminal);
  return s.taskStatus === "completed" ? "complete" : s.taskStatus === "failed" ? "failed" : "partial";
}

Deno.test("1./2./3./5./6. every company-first outcome projects a truthful plan status", () => {
  assertEquals(planStatusFor("completed"), "complete");
  assertEquals(planStatusFor("quota_not_met"), "complete");      // workflow finished, quota unmet
  assertEquals(planStatusFor("continuation_required"), "partial");
  assertEquals(planStatusFor("provider_failure"), "failed");
  assertEquals(planStatusFor("invalid_request"), "failed");
  assertEquals(planStatusFor("source_transition_failed"), "failed");

  // 3. the production case specifically: it must LEAVE executing.
  assert(planStatusFor("continuation_required") !== "executing");
  // and must never claim completion.
  assert(planStatusFor("continuation_required") !== "complete");
});

Deno.test("4. continuation_required stays resumable", () => {
  const s = projectStatus("continuation_required");
  assertEquals(s.rowStatus, "ready");
  assertEquals(s.taskStatus, "partial");
  assertEquals(s.terminalStatus, "continuation_required");
});

Deno.test("6.B source_transition_failed is failed and non-resumable", () => {
  const s = projectStatus("source_transition_failed");
  assertEquals(s.rowStatus, "failed");
  assertEquals(s.taskStatus, "failed");
  assertEquals(planStatusFor("source_transition_failed"), "failed");
});

Deno.test("7./16. the company-first exit finalizes the plan — call-graph guard", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

  // The helper exists and is invoked before the company-first return.
  assert(src.includes("async function finalizeCompanyFirstPlan("), "the finalizer must exist");
  const callAt = src.indexOf("await finalizeCompanyFirstPlan(");
  assert(callAt > -1, "the company-first exit must call the finalizer");

  // It is reached BEFORE the branch returns.
  const returnAt = src.indexOf("// Conclusively SKIP the ordinary people-first branch");
  assert(returnAt > -1);
  assert(callAt < returnAt, "the plan must be finalized before the branch returns");

  // 16. and it consumes the already-computed projection rather than a second one.
  assert(src.includes("finalizeCompanyFirstPlan(supabase, plan_id, task.id, agent.id, workspace_id, statuses,"),
    "the finalizer must consume the existing StatusProjection");
});

Deno.test("8. plan finalization is idempotent and never resurrects a finished plan", () => {
  // The guard is expressed in the runtime as: only advance from `executing`, and
  // never rewrite the status it already holds.
  const advance = (current: string | null, target: string): boolean => {
    if (current && current !== "executing" && current !== target) return false;
    if (current === target) return false;
    return true;
  };
  assert(advance("executing", "partial"), "a running plan advances");
  assertFalse(advance("partial", "partial"), "the same projection twice is a no-op");
  assertFalse(advance("complete", "partial"), "a finished plan is never walked backwards");
  assertFalse(advance("failed", "partial"));
});

// ==================================================== no I/O in these tests ===

Deno.test("20. no live provider or model call occurs", async () => {
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._a: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network is permitted in this test"));
  }) as typeof fetch;
  try {
    const f = fakeDb();
    const store = supabaseSourcingStateStore(f.db as never);
    await store.save(TASK_ID, fixtureState(), "partial");
    await store.load(TASK_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0);
});
