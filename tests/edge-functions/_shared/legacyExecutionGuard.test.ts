// The legacy pre-effect guard, offline: the decision (legacyExecutionGuard.ts),
// the runner refusing before its handler is called, and — read from source —
// that every entry asks the guard before its first effect.
// Through the real handlers and PostgREST: tests/db-contract/legacyPreEffectGuard.contract.test.ts.
//
// Offline: no database, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type GuardDb, legacyExecutionGuard, referencedPlanId, referencedTaskIds, scopeMarkers,
} from "../../../supabase/functions/_shared/legacyExecutionGuard.ts";
import { createLeadMissionRunner } from "../../../worker/leadMissionRunner.ts";

const WS = "00000000-0000-0000-0000-0000000000a1";
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";

/** A fake service client: `tasks` rows and the member set; records every read. */
function fakeDb(o: { tasks?: Array<Record<string, unknown>>; members?: string[]; failTasks?: boolean; failMembers?: boolean } = {}) {
  const reads: string[] = [];
  const db: GuardDb = {
    from: (table) => ({
      select: () => ({
        in: (_c, ids) => {
          reads.push(`${table}:in`);
          return Promise.resolve(o.failTasks ? { data: null, error: { message: "down" } }
            : { data: (o.tasks ?? []).filter((t) => ids.includes(String(t.id))), error: null });
        },
        eq: (_c1, ws) => ({
          eq: (_c2, user) => ({
            maybeSingle: () => {
              reads.push(`${table}:member`);
              return Promise.resolve(o.failMembers ? { data: null, error: { message: "down" } }
                : { data: ws === WS && (o.members ?? []).includes(user) ? { user_id: user } : null, error: null });
            },
          }),
        }),
      }),
    }),
  };
  return { db, reads };
}
const none = { resume: [], related: [] };

Deno.test("markers: pilot and client markers are found where they can sit, and nowhere deeper", () => {
  assertEquals(scopeMarkers({ execution_mode: "pilot_draft_only" }).pilot, ["execution_mode=pilot_draft_only"]);
  assertEquals(scopeMarkers({ tool_input: { pilot_scope: "x" } }).pilot, ["pilot_scope"]);
  assertEquals(scopeMarkers({ tool_input: { lead_mission: { pilot_origin_session_id: "s" } } }).pilot, ["pilot_origin_session_id"]);
  assertEquals(scopeMarkers({ payload: { execution_mode: "pilot_draft_only" } }).pilot, ["execution_mode=pilot_draft_only"]);
  assertEquals(scopeMarkers({ lead_mission: { client_id: "c" } }).client, ["client_id"]);
  // The client contract's task pins (#174 §8) mark a stored task client-scoped too.
  assertEquals(scopeMarkers({ payload: { client_grant_id: "g", client_grant_generation: 3 } }).client, ["client_grant_id", "client_grant_generation"]);
  // A prospect record that mentions a client is lead data, not scope.
  assertEquals(scopeMarkers({ tool_input: { rows: [{ client_id: "prospect's own field" }] } }), { pilot: [], client: [] });
  assertEquals(scopeMarkers({ execution_mode: "company_first", client_id: null }), { pilot: [], client: [] });
});

Deno.test("references: a resume keeps its principal; a parent is only scope-checked", () => {
  assertEquals(referencedTaskIds({ resume_task_id: "t1", lead_resume_parent_task_id: "p1" }), { resume: ["t1"], related: ["p1"] });
  assertEquals(referencedTaskIds({ continuation_token: "t2", continuation_of_task_id: "t2" }), { resume: ["t2"], related: [] });
  assertEquals(referencedTaskIds({}), none);
});

Deno.test("guard: request markers refuse before any read", async () => {
  const f = fakeDb({ members: [A] });
  const r = await legacyExecutionGuard({ db: f.db, workspaceId: WS, principalUserId: A, body: { tool_input: { execution_mode: "pilot_draft_only" } }, taskIds: none });
  assertEquals(r.ok ? null : r.code, "pilot_execution_disabled");
  assertEquals(f.reads, []);
});

Deno.test("guard: the STORED task decides when the request's markers were stripped", async () => {
  const f = fakeDb({ members: [A], tasks: [{ id: "t1", workspace_id: WS, user_id: A, payload: { execution_mode: "pilot_draft_only", pilot_scope: "sig" } }] });
  const r = await legacyExecutionGuard({ db: f.db, workspaceId: WS, principalUserId: A, body: { resume_task_id: "t1" }, taskIds: { resume: ["t1"], related: [] } });
  assertEquals(r.ok ? null : [r.status, r.code], [403, "pilot_execution_disabled"]);
  const c = fakeDb({ members: [A], tasks: [{ id: "p1", workspace_id: WS, user_id: B, payload: { client_id: "c1" } }] });
  const rc = await legacyExecutionGuard({ db: c.db, workspaceId: WS, principalUserId: A, body: {}, taskIds: { resume: [], related: ["p1"] } });
  assertEquals(rc.ok ? null : rc.code, "client_scope_unsupported", "a client-scoped parent is refused too");
});

Deno.test("guard: principal — still a member, and a resume keeps its original principal", async () => {
  const gone = await legacyExecutionGuard({ db: fakeDb({ members: [] }).db, workspaceId: WS, principalUserId: A, body: {}, taskIds: none });
  assertEquals(gone.ok ? null : [gone.status, gone.code], [403, "principal_not_member"]);
  const tasks = [{ id: "t1", workspace_id: WS, user_id: A, payload: {} }];
  const swap = await legacyExecutionGuard({ db: fakeDb({ members: [A, B], tasks }).db, workspaceId: WS, principalUserId: B, body: {}, taskIds: { resume: ["t1"], related: [] } });
  assertEquals(swap.ok ? null : swap.code, "principal_mismatch");
  const child = await legacyExecutionGuard({ db: fakeDb({ members: [A, B], tasks }).db, workspaceId: WS, principalUserId: B, body: {}, taskIds: { resume: [], related: ["t1"] } });
  assertEquals(child, { ok: true }, "a teammate may continue the work as a new child");
  const missing = await legacyExecutionGuard({ db: fakeDb({ members: [A] }).db, workspaceId: WS, principalUserId: null, body: {}, taskIds: none });
  assertEquals(missing.ok ? null : [missing.status, missing.code], [401, "principal_missing"]);
});

Deno.test("guard: another workspace's task is refused; read failures fail closed", async () => {
  const foreign = await legacyExecutionGuard({ db: fakeDb({ members: [A], tasks: [{ id: "t9", workspace_id: "other", user_id: A, payload: {} }] }).db,
    workspaceId: WS, principalUserId: A, body: {}, taskIds: { resume: ["t9"], related: [] } });
  assertEquals(foreign.ok ? null : [foreign.status, foreign.code], [409, "referenced_task_foreign"]);
  const t = await legacyExecutionGuard({ db: fakeDb({ members: [A], failTasks: true }).db, workspaceId: WS, principalUserId: A, body: {}, taskIds: { resume: ["t1"], related: [] } });
  assertEquals(t.ok ? null : [t.status, t.code], [503, "guard_read_failed"]);
  const m = await legacyExecutionGuard({ db: fakeDb({ failMembers: true }).db, workspaceId: WS, principalUserId: A, body: {}, taskIds: none });
  assertEquals(m.ok ? null : [m.status, m.code], [503, "guard_read_failed"]);
});

Deno.test("guard: the plan must exist in this workspace (EXEC-PLAN); missing and foreign answer alike", async () => {
  const plans = [{ id: "p-own", workspace_id: WS }, { id: "p-foreign", workspace_id: "other" }];
  const f = fakeDb({ members: [A], tasks: plans });
  const own = await legacyExecutionGuard({ db: f.db, workspaceId: WS, principalUserId: A, body: {}, taskIds: none, planId: "p-own" });
  assertEquals(own, { ok: true });
  for (const planId of ["p-foreign", "p-missing"]) {
    const r = await legacyExecutionGuard({ db: f.db, workspaceId: WS, principalUserId: A, body: {}, taskIds: none, planId });
    assertEquals(r.ok ? null : [r.status, r.code], [409, "referenced_plan_foreign"], planId);
  }
  assertEquals(referencedPlanId({ task_plan_id: "p1" }), "p1");
  assertEquals(referencedPlanId({ plan_id: "" }), null);
});

Deno.test("guard positive control: a current member's non-pilot work passes; a JWT caller is not re-read", async () => {
  const f = fakeDb({ members: [A], tasks: [{ id: "t1", workspace_id: WS, user_id: A, payload: { instruction: "x" } }] });
  assertEquals(await legacyExecutionGuard({ db: f.db, workspaceId: WS, principalUserId: A, body: { execution_mode: "company_first" }, taskIds: { resume: ["t1"], related: [] } }), { ok: true });
  const j = fakeDb({ members: [] });
  assertEquals(await legacyExecutionGuard({ db: j.db, workspaceId: WS, principalUserId: A, principalMembershipVerified: true, body: {}, taskIds: none }), { ok: true });
  assertEquals(j.reads, []);
});

Deno.test("runner: a refused claim never reaches the handler, the deadline or the bind", async () => {
  let handlerCalls = 0, binds = 0, deadlines = 0;
  const runner = createLeadMissionRunner({
    handler: () => { handlerCalls++; return Promise.resolve(new Response("{}")); },
    serviceRoleKey: "k", functionsBaseUrl: "http://local",
    createDeadline: () => { deadlines++; throw new Error("no deadline should be created"); },
    bind: () => { binds++; return Promise.resolve(true); },
    readTaskOutcome: () => Promise.resolve(null),
    guard: () => Promise.resolve({ ok: false, status: 403, code: "pilot_execution_disabled", detail: "stored task carries pilot_scope" }),
  });
  const out = await runner.run({ queueId: "q", workspaceId: WS, request: { user_id: A }, taskId: "t1", lineageId: null, attempts: 1, isResume: true, heldUntil: null },
    { executionBudgetMs: 1000, signal: new AbortController().signal });
  assertEquals(out, { status: "failed", terminal: true, taskId: "t1", error: "pre_effect_guard:pilot_execution_disabled" });
  assertEquals([handlerCalls, binds, deadlines], [0, 0, 0]);
});

const src = (p: string) => Deno.readTextFileSync(new URL(`../../../${p}`, import.meta.url));

Deno.test("source: every entry asks the guard BEFORE its first effect", () => {
  const ra = src("supabase/functions/run-agent/index.ts");
  const handler = ra.slice(ra.indexOf("async function handleRunAgent("));
  const g = handler.indexOf("await legacyExecutionGuard(");
  assert(g > 0, "run-agent asks the guard");
  for (const effect of ["authorizeModelSpend(", 'from("agents")', 'from("tasks").insert', "terminalGuard.bind(", "runTool(", "createCapabilityEngine("]) {
    const at = handler.indexOf(effect);
    if (at >= 0) assert(g < at, `run-agent: the guard precedes ${effect}`);
  }
  const orch = src("supabase/functions/orchestrate/index.ts");
  const og = orch.indexOf("await legacyExecutionGuard(");
  assert(og > 0, "orchestrate asks the guard");
  for (const effect of ["findStartedPlan(admin", 'from("task_plans")', 'from("messages")', "readCompanyBrain", "functionUrl("]) {
    const at = orch.indexOf(effect, orch.indexOf("async function handleOrchestrate("));
    if (at >= 0) assert(og < at, `orchestrate: the guard precedes ${effect}`);
  }
  const enq = src("supabase/functions/enqueue-lead-mission/index.ts");
  assert(enq.indexOf("await legacyExecutionGuard(") > 0 && enq.indexOf("await legacyExecutionGuard(") < enq.indexOf('from("lead_mission_queue")'),
    "enqueue: the guard precedes the queue insert");
  const rla = src("supabase/functions/run-lead-action/index.ts");
  const rg = rla.indexOf("await legacyExecutionGuard(");
  assert(rg > 0, "run-lead-action asks the guard");
  for (const effect of ['from("agents")', 'from("tasks").insert', "runTool("]) {
    const at = rla.indexOf(effect);
    if (at >= 0) assert(rg < at, `run-lead-action: the guard precedes ${effect}`);
  }
  const main = src("worker/main.ts");
  assert(/guard: \(m\) => legacyExecutionGuard\(/.test(main), "worker/main.ts wires the runner's guard");
});
