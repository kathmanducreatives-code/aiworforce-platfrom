// ORION V1 — the read: workspace isolation, bounded queries, partial data,
// failed sources, closed leads, dedupe keys, account lookup scope.
// A fake supabase client that really applies eq/in/gte/order/limit, so a query
// that forgot its workspace filter WOULD return the other tenant's rows.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BRIEF_LIMITS, collectExecutiveContext } from "../../../supabase/functions/_shared/executiveBriefContext.ts";
import { synthesizeExecutiveBrief } from "../../../supabase/functions/_shared/executiveBrief.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-07T08:00:00.000Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type Row = Record<string, unknown>;
interface Call { table: string; filters: string[]; limit: number | null }

function fakeDb(tables: Record<string, Row[]>, opts: { fail?: string[] } = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [], limit: null };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { call.filters.push(`eq:${c}=${v}`); rows = rows.filter((r) => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { call.filters.push(`in:${c}`); rows = rows.filter((r) => vs.includes(r[c])); return q; },
        gte(c: string, v: string) { call.filters.push(`gte:${c}`); rows = rows.filter((r) => String(r[c] ?? "") >= v); return q; },
        order(c: string, o: { ascending: boolean }) {
          rows.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : 1) * (o.ascending ? 1 : -1)); return q;
        },
        limit(n: number) { call.limit = n; rows = rows.slice(0, n); return q; },
        then(res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) {
          const out = opts.fail?.includes(table) ? { data: null, error: { message: "boom" } } : { data: rows, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
  };
  return { db, calls };
}

const brainRow = (ws: string, company: string) => ({
  workspace_id: ws, onboarding_completed: true,
  profile: { company: { name: company, description: "Warehouse robots" }, who_we_sell_to: "Logistics operators", icp: { industries: ["Logistics"] } },
});

function fixture(): Record<string, Row[]> {
  return {
    company_brain: [brainRow(A, "Northwind Robotics"), brainRow(B, "OtherCo")],
    accounts: [
      { id: "acc-a1", workspace_id: A, name: "Fictional Freight", industry: "Logistics" },
      { id: "acc-b1", workspace_id: B, name: "Tenant B Secret Co", industry: "Logistics" },
    ],
    signal_events: [
      { id: "sig-a1", workspace_id: A, account_id: "acc-a1", signal_type: "funding_signal", confidence: "high", lifecycle_status: "active", verification_status: "provider_verified", dedupe_key: "k1", occurred_at: day(1), created_at: day(1), normalized_value: { title: "Raised a Series B" } },
      { id: "sig-a1-dup", workspace_id: A, account_id: "acc-a1", signal_type: "funding_signal", confidence: "high", lifecycle_status: "active", dedupe_key: "k1", occurred_at: day(1), created_at: day(1.5), normalized_value: { title: "Raised a Series B" } },
      { id: "sig-a-old", workspace_id: A, account_id: null, signal_type: "job_signal", confidence: "low", lifecycle_status: "active", dedupe_key: "k2", created_at: day(30), normalized_value: { company_name: "Old Co" } },
      { id: "sig-a-dismissed", workspace_id: A, account_id: null, signal_type: "job_signal", confidence: "high", lifecycle_status: "dismissed", dedupe_key: "k3", created_at: day(1), normalized_value: {} },
      { id: "sig-b1", workspace_id: B, account_id: "acc-b1", signal_type: "funding_signal", confidence: "high", lifecycle_status: "active", dedupe_key: "kb", created_at: day(1), normalized_value: { title: "Tenant B news" } },
    ],
    lead_candidates: [
      { id: "lead-a1", workspace_id: A, account_id: "acc-a1", status: "new", fit_score: 0.86, priority: "high", reason: "Hiring ops leaders", next_action: "Email the COO", signal_id: "sig-a1", created_at: day(2), updated_at: day(1) },
      { id: "lead-a-rejected", workspace_id: A, account_id: "acc-a1", status: "rejected", fit_score: 99, created_at: day(1), updated_at: day(1) },
      { id: "lead-b-foreign", workspace_id: A, account_id: "acc-b1", status: "new", fit_score: 50, created_at: day(1), updated_at: day(1) },
      { id: "lead-b1", workspace_id: B, account_id: "acc-b1", status: "new", fit_score: 99, created_at: day(1), updated_at: day(1) },
    ],
    content_item: [
      { id: "ci-a1", workspace_id: A, title: "Why warehouses automate", status: "draft", created_at: day(3), updated_at: day(3) },
      { id: "ci-a-pub", workspace_id: A, title: "Published", status: "approved", created_at: day(1), updated_at: day(1) },
      { id: "ci-b1", workspace_id: B, title: "Tenant B draft", status: "draft", created_at: day(1), updated_at: day(1) },
    ],
    approvals: [
      { id: "ap-a1", workspace_id: A, title: "Send outreach to Fictional Freight", status: "pending", created_at: day(2) },
      { id: "ap-a-done", workspace_id: A, title: "Old", status: "approved", created_at: day(5) },
      { id: "ap-b1", workspace_id: B, title: "Tenant B approval", status: "pending", created_at: day(9) },
    ],
    task_plans: [
      { id: "plan-a-run", workspace_id: A, goal: "Find logistics leads", status: "running", created_at: day(1) },
      { id: "plan-a-fail", workspace_id: A, goal: "Watch competitors", status: "failed", created_at: day(2), updated_at: day(2) },
      { id: "plan-b-fail", workspace_id: B, goal: "Tenant B plan", status: "failed", created_at: day(1) },
    ],
    tasks: [
      { id: "task-a-fail", workspace_id: A, plan_id: "plan-a-fail", status: "failed", error_message: "Provider returned 403", created_at: day(2) },
      { id: "task-a-orphan", workspace_id: A, plan_id: null, status: "failed", description: "Content step", error_message: "timeout", created_at: day(1) },
      { id: "task-b-fail", workspace_id: B, plan_id: "plan-b-fail", status: "failed", error_message: "B", created_at: day(1) },
    ],
  };
}

Deno.test("ISOLATION: every query filters by the requested workspace; no tenant-B row or name leaks", async () => {
  const { db, calls } = fakeDb(fixture());
  const ctx = await collectExecutiveContext(db, A, { now: NOW });
  for (const c of calls) assert(c.filters.includes(`eq:workspace_id=${A}`), `${c.table} query is not workspace-scoped`);
  const all = JSON.stringify(ctx);
  for (const leak of ["sig-b1", "lead-b1", "ci-b1", "ap-b1", "plan-b-fail", "task-b-fail", "Tenant B", "OtherCo"]) {
    assertFalse(all.includes(leak), `leaked ${leak}`);
  }
  // A lead in A pointing at B's account id gets no name: the account lookup is scoped too.
  const foreign = ctx.leads.find((l) => l.id === "lead-b-foreign");
  assert(foreign);
  assertEquals(foreign!.account_name, null);
  assertEquals(ctx.brain.company, "Northwind Robotics");
});

Deno.test("BOUNDED: every query has a limit no larger than BRIEF_LIMITS, growing tables have a window", async () => {
  const { db, calls } = fakeDb(fixture());
  await collectExecutiveContext(db, A, { now: NOW });
  const max = Math.max(...Object.values(BRIEF_LIMITS));
  for (const c of calls) {
    assert(c.limit !== null && c.limit <= max, `${c.table} unbounded`);
  }
  for (const t of ["signal_events", "lead_candidates", "task_plans", "tasks"]) {
    assert(calls.find((c) => c.table === t)!.filters.some((f) => f.startsWith("gte:")), `${t} has no time window`);
  }
});

Deno.test("NORMALIZATION: window, lifecycle, dedupe keys, closed leads, drafts, pending approvals, failures by plan", async () => {
  const { db } = fakeDb(fixture());
  const ctx = await collectExecutiveContext(db, A, { now: NOW });
  assertEquals(ctx.signals.map((s) => s.id), ["sig-a1"], "old, dismissed and duplicate-key signals are excluded");
  assertEquals(ctx.signals[0].account_name, "Fictional Freight");
  assert(ctx.signals[0].reasons.includes("verified by the data provider"));
  assert(ctx.signals[0].reasons.includes("in an industry you target"), "Brain industries shape relevance");
  assertEquals(ctx.leads.map((l) => l.id).sort(), ["lead-a1", "lead-b-foreign"]);
  const l = ctx.leads.find((x) => x.id === "lead-a1")!;
  assertEquals(l.route, "/leads?lead=acc-a1");
  assert(l.reasons.includes("fit 86/100"));
  assertEquals(ctx.content.map((c) => c.id), ["ci-a1"]);
  assertEquals(ctx.content[0].route, "/content?item=ci-a1");
  assertEquals(ctx.approvals.map((a) => a.id), ["ap-a1"]);
  assertEquals(ctx.plans_in_flight.map((p) => p.id), ["plan-a-run"]);
  const failed = ctx.failed_work.map((f) => f.id).sort();
  assertEquals(failed, ["plan-a-fail", "task-a-orphan"], "a plan's failed task folds into the plan");
  assertEquals(ctx.failed_work.find((f) => f.id === "plan-a-fail")!.detail, "Provider returned 403");
  assertEquals(ctx.unavailable_sources, []);
});

Deno.test("EMPTY workspace: everything empty, Brain unusable, no errors", async () => {
  const { db } = fakeDb({});
  const ctx = await collectExecutiveContext(db, A, { now: NOW });
  assertEquals([ctx.signals, ctx.leads, ctx.content, ctx.approvals, ctx.failed_work].flat().length, 0);
  assertFalse(ctx.brain.usable);
  assertEquals(ctx.unavailable_sources, []);
  const brief = synthesizeExecutiveBrief(ctx);
  assertEquals(brief.priorities.map((p) => p.category), ["setup"]);
});

Deno.test("PARTIAL failure: a failing table is reported, the rest still briefs", async () => {
  const { db } = fakeDb(fixture(), { fail: ["signal_events", "approvals"] });
  const ctx = await collectExecutiveContext(db, A, { now: NOW });
  assertEquals(ctx.unavailable_sources.sort(), ["approvals", "signal_events"]);
  assertEquals(ctx.signals, []);
  assert(ctx.leads.length > 0);
  const brief = synthesizeExecutiveBrief(ctx);
  assertEquals(brief.confidence.overall, "low");
  assert(brief.priorities.length > 0);
});

Deno.test("END TO END (fixtures): the brief for A cites only A's rows and links each to its screen", async () => {
  const { db } = fakeDb(fixture());
  const brief = synthesizeExecutiveBrief(await collectExecutiveContext(db, A, { now: NOW }));
  assert(brief.priorities.length > 0 && brief.priorities.length <= 3);
  const ids = new Set(Object.values(fixture()).flat().filter((r) => r.workspace_id === A).map((r) => String(r.id)));
  ids.add(A); // the Brain is cited by workspace id
  for (const s of brief.sources) assert(ids.has(s.id), `cites ${s.table}:${s.id}`);
  const routes = brief.sources.map((s) => s.route);
  assert(routes.includes("/awaiting-you") && routes.includes("/leads?lead=acc-a1") && routes.includes("/signals"));
});

Deno.test("refuses to run without a workspace", async () => {
  const { db } = fakeDb({});
  let threw = false;
  try { await collectExecutiveContext(db, ""); } catch { threw = true; }
  assert(threw);
});
