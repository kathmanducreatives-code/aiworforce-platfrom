// OPS HEALTH: THE RIGHT NUMBERS, THE RIGHT ALARMS, AND NOTHING ABOUT A CUSTOMER.
//
// The launch's monitoring reads a handful of aggregates (supabase/functions/
// _shared/opsHealth.ts) through the `ops-health` endpoint, which a scheduled
// GitHub workflow calls with a shared token. These pin the thresholds, the
// snapshot arithmetic, the endpoint's fail-closed access, and that a response
// can never carry a workspace id. PURE: an in-memory OpsDb.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_OPS_THRESHOLDS, evaluateOpsHealth, opsTokenMatches, readOpsSnapshot, resolveOpsThresholds,
  type OpsDb, type OpsSnapshot,
} from "../../../supabase/functions/_shared/opsHealth.ts";

Deno.env.set("OPS_HEALTH_IMPORT_ONLY", "1");
const { handleOpsHealth } = await import("../../../supabase/functions/ops-health/index.ts");

const NOW = Date.parse("2026-09-29T10:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const WS_A = "aaaaaaaa-0000-4000-8000-00000000000a", WS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TOKEN = "t".repeat(40);

type Row = Record<string, unknown>;
/** A tiny in-memory table store that answers OpsDb's filters. */
function memDb(tables: Record<string, Row[]>, opts: { failOn?: string } = {}): OpsDb {
  const match = (r: Row, [col, op, val]: [string, string, unknown]) => {
    const v = r[col];
    if (op === "eq") return v === val;
    if (op === "in") return (val as unknown[]).includes(v);
    if (op === "lt") return String(v) < String(val);
    if (op === "gte") return String(v) >= String(val);
    throw new Error(op);
  };
  const pick = (t: string, f: Array<[string, string, unknown]>) => {
    if (opts.failOn === t) throw new Error(`${t} unavailable`);
    return (tables[t] ?? []).filter((r) => f.every((x) => match(r, x)));
  };
  return {
    count: (t, f) => Promise.resolve(pick(t, f).length),
    rows: (t, _c, f, limit) => Promise.resolve(pick(t, f).slice(0, limit)),
  };
}

const healthy: OpsSnapshot = {
  version: "ops-health-v1", at: ago(0),
  queue: { stuck_running: 0, unclaimed_waiting: 0, oldest_unclaimed_minutes: null, completed_24h: 4, failed_24h: 0 },
  stale_running_tasks: 0, unsettled_provider_calls: 0,
  spend_24h: { provider_usd: 0.5, model_usd: 0.1, top_workspace_provider_usd: 0.3, truncated: false },
  beta: { pending_requests: 1, oldest_pending_hours: 3 },
};

// ══════════════════════════════════════════════════════════════ alarms ══

Deno.test("A HEALTHY SNAPSHOT RAISES NOTHING", () => {
  assertEquals(evaluateOpsHealth(healthy), []);
});

Deno.test("CRITICAL: a mission stuck on an expired lease, or missions no worker is claiming", () => {
  const a = evaluateOpsHealth({ ...healthy, queue: { ...healthy.queue, stuck_running: 1, unclaimed_waiting: 2, oldest_unclaimed_minutes: 40 } });
  assertEquals(a.map((x) => [x.severity, x.code]), [["critical", "queue_stuck_running"], ["critical", "queue_unclaimed"]]);
  assert(a[1].detail.includes("40+ min") && a[1].detail.includes("Railway worker"));
});

Deno.test("WARN: failures, stale tasks, unsettled paid calls, spend over the line, beta requests left waiting", () => {
  const s: OpsSnapshot = {
    ...healthy,
    queue: { ...healthy.queue, failed_24h: 3 },
    stale_running_tasks: 1, unsettled_provider_calls: 2,
    spend_24h: { provider_usd: 12, model_usd: 6, top_workspace_provider_usd: 7, truncated: false },
    beta: { pending_requests: 2, oldest_pending_hours: 60 },
  };
  const a = evaluateOpsHealth(s);
  assert(a.every((x) => x.severity === "warn"));
  assertEquals(a.map((x) => x.code), ["queue_failures", "tasks_stale_running", "provider_calls_unsettled",
    "provider_spend_high", "model_spend_high", "workspace_spend_high", "beta_requests_waiting"]);
  assert(a.find((x) => x.code === "provider_spend_high")!.detail.includes("$12.00"));
});

Deno.test("THRESHOLDS: defaults for a small beta, each overridable by OPS_ALERT_*; junk values keep the default", () => {
  assertEquals(resolveOpsThresholds(() => undefined), { ...DEFAULT_OPS_THRESHOLDS });
  const t = resolveOpsThresholds((k) => ({ OPS_ALERT_PROVIDER_USD_24H: "25", OPS_ALERT_FAILED_24H: "abc" } as Record<string, string>)[k]);
  assertEquals([t.provider_usd_24h, t.failed_24h], [25, DEFAULT_OPS_THRESHOLDS.failed_24h]);
  assertEquals(evaluateOpsHealth({ ...healthy, spend_24h: { ...healthy.spend_24h, provider_usd: 12 } }, t), []);
});

// ═══════════════════════════════════════════════════════════ snapshot ══

Deno.test("SNAPSHOT: each window and filter counts what it says, and a resumed call is paid once", async () => {
  const db = memDb({
    lead_mission_queue: [
      { status: "running", lease_expires_at: ago(10), updated_at: ago(10) },       // stuck
      { status: "running", lease_expires_at: ago(-5), updated_at: ago(1) },        // healthy, lease live
      { status: "queued", updated_at: ago(40) },                                   // unclaimed 40 min
      { status: "resumable", updated_at: ago(5) },                                 // recent, fine
      { status: "complete", updated_at: ago(60) }, { status: "failed", updated_at: ago(90) },
      { status: "failed", updated_at: ago(60 * 30) },                              // older than 24h
    ],
    tasks: [{ status: "running", updated_at: ago(45) }, { status: "running", updated_at: ago(5) }],
    lead_execution_calls: [
      // `started` is the only in-flight status the database allows (see the live check in the commit).
      { record_kind: "provider_call", status: "started", created_at: ago(90), workspace_id: WS_A, provider_call_id: "p1", estimated_cost_usd: 0.04 },
      { record_kind: "provider_call", status: "succeeded", created_at: ago(80), workspace_id: WS_A, provider_call_id: "p1", settled_usd: 0.04 },
      { record_kind: "provider_call", status: "succeeded", created_at: ago(30), workspace_id: WS_A, provider_call_id: "p2", actual_cost_usd: 0.01 },
      { record_kind: "provider_call", status: "succeeded", created_at: ago(20), workspace_id: WS_B, provider_call_id: "p3", settled_usd: 0.2 },
    ],
    lead_model_calls: [{ started_at: ago(10), actual_cost_usd: 0.003 }, { started_at: ago(10), actual_cost_usd: null, estimated_cost_usd: 0.002 }],
    beta_access_requests: [{ status: "pending", created_at: ago(60 * 50) }, { status: "approved", created_at: ago(60 * 70) }],
  });
  const s = await readOpsSnapshot(db, NOW);
  assertEquals(s.queue, { stuck_running: 1, unclaimed_waiting: 1, oldest_unclaimed_minutes: 40, completed_24h: 1, failed_24h: 1 });
  assertEquals(s.stale_running_tasks, 1);
  assertEquals(s.unsettled_provider_calls, 1);
  assertEquals(s.spend_24h, { provider_usd: 0.25, model_usd: 0.005, top_workspace_provider_usd: 0.2, truncated: false },
    "p1 counted once at $0.04; WS_B's $0.20 is the top workspace");
  assertEquals(s.beta, { pending_requests: 1, oldest_pending_hours: 50 });
});

// ═══════════════════════════════════════════════════════════ endpoint ══

const env = (over: Record<string, string | undefined> = {}) => (k: string) =>
  ({ OPS_HEALTH_TOKEN: TOKEN, ...over } as Record<string, string | undefined>)[k];
const get = (token?: string) => new Request("https://x.supabase.co/functions/v1/ops-health", {
  headers: token ? { "x-ops-token": token } : {},
});

Deno.test("ENDPOINT FAILS CLOSED: no token configured (or a short one) → 503, and nothing is read", async () => {
  const touched: string[] = [];
  const spyDb: OpsDb = { count: (t) => { touched.push(t); return Promise.resolve(0); }, rows: (t) => { touched.push(t); return Promise.resolve([]); } };
  for (const configured of [undefined, "short-token"]) {
    const r = await handleOpsHealth(get(TOKEN), { read: env({ OPS_HEALTH_TOKEN: configured }), db: spyDb, now: NOW });
    assertEquals(r.status, 503);
  }
  assertEquals(touched, []);
});

Deno.test("ENDPOINT: wrong or missing token → 401; not GET → 405; the right token → the snapshot and its alerts", async () => {
  const db = memDb({});
  assertEquals((await handleOpsHealth(get(), { read: env(), db, now: NOW })).status, 401);
  assertEquals((await handleOpsHealth(get("x".repeat(40)), { read: env(), db, now: NOW })).status, 401);
  assertEquals((await handleOpsHealth(new Request("https://x/ops-health", { method: "POST", headers: { "x-ops-token": TOKEN } }), { read: env(), db, now: NOW })).status, 405);
  const ok = await handleOpsHealth(get(TOKEN), { read: env(), db, now: NOW });
  assertEquals(ok.status, 200);
  const body = await ok.json();
  assertEquals([body.status, body.alerts], ["ok", []]);
  assertEquals(ok.headers.get("cache-control"), "no-store");
});

Deno.test("AGGREGATES ONLY: no workspace id reaches the response, however the data looks", async () => {
  const db = memDb({
    lead_execution_calls: [{ record_kind: "provider_call", status: "succeeded", created_at: ago(5), workspace_id: WS_A, provider_call_id: "p", settled_usd: 9 }],
    lead_mission_queue: [{ status: "running", lease_expires_at: ago(30), updated_at: ago(30), workspace_id: WS_B }],
  });
  const text = await (await handleOpsHealth(get(TOKEN), { read: env(), db, now: NOW })).text();
  assertFalse(text.includes(WS_A) || text.includes(WS_B), text);
  assert(text.includes("workspace_spend_high") && text.includes("queue_stuck_running"));
});

Deno.test("A FAILED READ IS CRITICAL, never 'ok'", async () => {
  const r = await handleOpsHealth(get(TOKEN), { read: env(), db: memDb({}, { failOn: "lead_mission_queue" }), now: NOW });
  assertEquals(r.status, 500);
  const body = await r.json();
  assertEquals([body.status, body.alerts[0].code], ["critical", "ops_read_failed"]);
  assertFalse(JSON.stringify(body).includes("unavailable"), "internals are logged, not returned");
});

Deno.test("THE TOKEN CHECK: exact match only, and a short configured token matches nothing", () => {
  assert(opsTokenMatches(TOKEN, TOKEN));
  assertFalse(opsTokenMatches(TOKEN + "x", TOKEN));
  assertFalse(opsTokenMatches(TOKEN.slice(1), TOKEN));
  assertFalse(opsTokenMatches(null, TOKEN));
  assertFalse(opsTokenMatches("abc", "abc"), "a token under 32 characters is not a secret");
});

Deno.test("THE UNSETTLED FILTER uses a status the database allows (the in-memory store cannot enforce the CHECK)", () => {
  const sql = [...Deno.readDirSync(new URL("../../../supabase/migrations/", import.meta.url))]
    .map((e) => Deno.readTextFileSync(new URL(`../../../supabase/migrations/${e.name}`, import.meta.url))).join("\n")
    + Deno.readTextFileSync(new URL("../../../supabase/migrations-held/20260816120000_baseline_schema.sql", import.meta.url));
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/opsHealth.ts", import.meta.url));
  assert(src.includes('["status", "eq", "started"]'));
  assert(/status[^\n]*'started'[^\n]*'succeeded'|'started'::text/.test(sql), "`started` is in the status CHECK");
  assertFalse(src.includes('"running", "pending"'), "statuses the CHECK forbids can never match");
});
