// WORKFORCE V2 · PHASE 6 — the live dashboard. Mocked DB rows (fictional);
// real model and handler. Unreadable tables must read "unavailable", not zero.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWorkforceDashboard } from "../../../../supabase/functions/_shared/workforceDashboard.ts";
import { handleDashboard } from "../../../../supabase/functions/workforce-dashboard/handler.ts";

const WS = "aaaaaaaa-0000-4000-8000-00000000d001";
const OTHER = "aaaaaaaa-0000-4000-8000-00000000d999";
const USER = "11111111-0000-4000-8000-00000000d002";
const NOW = new Date("2026-11-10T12:00:00Z");
type Row = Record<string, unknown>;

const TASKS: Row[] = [
  { id: "t1", workspace_id: WS, agent_slug: "scout", status: "running", description: "Find US manufacturers expanding", created_at: "2026-11-10T10:00:00Z", started_at: "2026-11-10T10:00:00Z" },
  { id: "t2", workspace_id: WS, agent_slug: "scribe", status: "completed", description: "Draft LinkedIn post", created_at: "2026-11-09T10:00:00Z", finished_at: "2026-11-09T11:00:00Z", updated_at: "2026-11-09T11:00:00Z" },
  { id: "t3", workspace_id: WS, agent_slug: "aria", status: "failed", description: "Rank leads", error_message: "provider timeout", lineage_id: "L1", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:05:00Z" },
  { id: "t4", workspace_id: WS, agent_slug: "aria", status: "completed", description: "Rank leads (retry)", lineage_id: "L1", created_at: "2026-11-08T11:00:00Z", updated_at: "2026-11-08T11:05:00Z" },
];

Deno.test("dashboard model: departments, tasks, failures with retry status, spend, findings, brief — all from rows", () => {
  const d = buildWorkforceDashboard({
    now: NOW, brainStatus: "ready", tasks: TASKS,
    approvals: [{ id: "a1", status: "pending", title: "Send outreach to Kestrel", type: "send_email", created_at: "2026-11-10T09:00:00Z" },
      { id: "a2", status: "approved", title: "old", type: "x", created_at: "2026-11-01T00:00:00Z" }],
    modelCalls: [{ actual_cost_usd: 0.12, estimated_cost_usd: 0.12, attempt_number: 1, started_at: "2026-11-09T00:00:00Z" },
      { actual_cost_usd: null, estimated_cost_usd: 0.05, attempt_number: 2, started_at: "2026-11-09T01:00:00Z" },
      { actual_cost_usd: null, estimated_cost_usd: null, attempt_number: 1, started_at: "2026-11-09T02:00:00Z" },
      { actual_cost_usd: 9, estimated_cost_usd: 9, attempt_number: 1, started_at: "2026-10-01T00:00:00Z" }],
    handoffs: [{ status: "awaiting_review" }, { status: "running" }, { status: "completed" }],
    signals: [{ observed_at: "2026-11-08T00:00:00Z", normalized_value: { lisa: { verification: { level: "corroborated" } } } },
      { observed_at: "2026-11-08T00:00:00Z", lifecycle_status: "contradicted", normalized_value: {} }],
    proposals: [{ approval_status: "pending" }, { approval_status: "approved" }],
  });
  assertEquals(d.data, "live");
  const atlas = d.departments.find((x) => x.id === "atlas")!;
  assertEquals([atlas.current, atlas.completed_7d, atlas.failed_7d], [1, 1, 1]);
  assertEquals(d.departments.find((x) => x.id === "lyra")!.completed_7d, 1);
  assertEquals(d.failures[0].retry, "retried");
  assertEquals(d.pending_approvals.length, 1);
  assertEquals(d.spend, { actual_usd_7d: 0.12, estimated_usd_7d: 0.05, unpriced_calls_7d: 1, calls_7d: 3, retried_calls_7d: 1 });
  assertEquals(d.findings, { signals_7d: 2, verified_7d: 1, contradicted_7d: 1 });
  assertEquals(d.handoffs, { awaiting_you: 1, in_progress: 1, completed: 1, failed: 0 });
  assertEquals(d.brain.pending_proposals, 1);
  assertStringIncludes(d.orion_brief.join(" "), "1 approval waiting");
});

Deno.test("dashboard model: an unreadable table is unavailable and null — never a reassuring zero", () => {
  const d = buildWorkforceDashboard({ now: NOW, brainStatus: "missing", tasks: null, approvals: null, modelCalls: null, handoffs: null, signals: null, proposals: null });
  assertEquals(d.availability.spend, "unavailable");
  assertEquals(d.spend.actual_usd_7d, null);
  assertEquals(d.departments[0].current, null);
  assertEquals(d.handoffs.awaiting_you, null);
  assertStringIncludes(d.orion_brief.join(" "), "Company Brain is missing");
});

function admin(tables: Record<string, Row[]>, broken: string[] = []) {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])];
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select() { return q; }, order() { return q; }, in() { return q; },
        eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
        limit(n: number) { rows = rows.slice(0, n); return q; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
        then(res: (v: unknown) => unknown) {
          return Promise.resolve(broken.includes(t) ? { data: null, error: { message: "missing" } } : { data: rows, error: null }).then(res);
        },
      };
      return q;
    },
  };
}
const TABLES: Record<string, Row[]> = {
  workspace_members: [{ workspace_id: WS, user_id: USER, role: "viewer" }],
  company_brain: [{ workspace_id: WS, onboarding_completed: true, updated_at: "2026-10-01T00:00:00Z",
    profile: { schema_version: 2, company: { name: "Fictional Co" }, target_customer: { industries: ["Manufacturing"] } } }],
  tasks: [...TASKS, { id: "leak", workspace_id: OTHER, agent_slug: "scout", status: "running", description: "other workspace", created_at: "2026-11-10T10:00:00Z" }],
  approvals: [], lead_model_calls: [], signal_events: [], company_brain_memory: [],
};
const call = (env: Record<string, string>, tables = TABLES, user: string | null = USER, broken: string[] = []) =>
  handleDashboard(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ workspace_id: WS }) }),
    { env: (k) => env[k], admin: admin(tables, broken), userIdFor: () => Promise.resolve(user), now: () => NOW });

Deno.test("dashboard endpoint: off by default; members only; isolated; held tables report unavailable", async () => {
  assertEquals((await call({})).status, 409);
  const on = { WORKFORCE_DASHBOARD_ENABLED: "true" };
  assertEquals((await call(on, TABLES, null)).status, 401);
  assertEquals((await call(on, { ...TABLES, workspace_members: [] })).status, 403);
  const res = await call(on, TABLES, USER, ["agent_handoffs"]);
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.dashboard.current_tasks.every((t: { title: string }) => t.title !== "other workspace"), "another workspace's task is never shown");
  assertEquals(body.dashboard.availability.handoffs, "unavailable");
  assertEquals(body.dashboard.brain.status !== "unavailable", true);
});

Deno.test("dashboard page: routed only behind its flag, and labelled live", async () => {
  const app = await Deno.readTextFile(new URL("../../../../src/App.tsx", import.meta.url));
  assertStringIncludes(app, `import.meta.env.VITE_WORKFORCE_DASHBOARD_ENABLED === "true"`);
  assertStringIncludes(app, `{WorkforceDashboard && (`);
  const page = await Deno.readTextFile(new URL("../../../../src/pages/WorkforceDashboard.tsx", import.meta.url));
  assertStringIncludes(page, "Live from your workspace records");
  assert(!/everestPreview|fictional/i.test(page.replace(/Fictional data lives only at \/dev\/collaboration\./, "")), "no fixture data on the live page");
});
