// lisa-monitor handler: the gates. A fake admin client; a recorded fixture provider. No network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleLisa, parseLisaRequest, permissionFor, type AdminClient } from "../../supabase/functions/lisa-monitor/handler.ts";
import { fixtureSource } from "../../supabase/functions/_shared/lisa/providers.ts";

const WS = "11111111-1111-4111-8111-111111111111";
type Row = Record<string, unknown>;

function fakeAdmin(roles: Record<string, string>, extra: Record<string, Row[]> = {}) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const tables: Record<string, Row[]> = {
    workspace_members: Object.entries(roles).map(([user_id, role]) => ({ workspace_id: WS, user_id, role })),
    monitoring_subjects: [{ workspace_id: WS, subject_kind: "competitor", identifier: "corvane.example", label: "Corvane Systems",
      signals: [{ event: "funding" }], enabled: true, cadence_minutes: 60 }],
    ...extra,
  };
  const claimed = new Set<string>();
  const admin: AdminClient = {
    from(t: string) {
      let rows = [...(tables[t] ?? [])];
      const q = {
        select: () => q, order: () => q, limit: () => q, gte: () => q,
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === undefined || r[c] === v); return q; },
        in: () => q,
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return q;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "lisa_claim_scan_run") {
        const k = String(args.p_run_key);
        const outcome = claimed.has(k) ? "already_done" : "claimed";
        claimed.add(k);
        return Promise.resolve({ data: [{ outcome, run_id: "run-1", attempts: 1 }], error: null });
      }
      if (fn === "credits_reserve") return Promise.resolve({ data: { ok: true, transaction_id: "tx", balance_after: 10 }, error: null });
      if (fn === "lisa_record_signal") return Promise.resolve({ data: { status: "new", event_id: "e1" }, error: null });
      if (fn === "lisa_signal_transition") return Promise.resolve({ data: [{ outcome: "ok", lifecycle_status: "dismissed" }], error: null });
      if (fn === "monitoring_spend_in_period") return Promise.resolve({ data: 0, error: null });
      return Promise.resolve({ data: "ok", error: null });
    },
  };
  return { admin, rpcs };
}

const SID = "22222222-2222-4222-8222-222222222222";
const jwt = (sid: string) => `h.${btoa(JSON.stringify({ session_id: sid })).replace(/=+$/, "")}.s`;
function req(body: unknown, token = jwt(SID)) {
  return new Request("http://local/lisa-monitor", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}
function deps(env: Record<string, string>, roles: Record<string, string>, userId: string | null, extra: Record<string, Row[]> = {}) {
  const a = fakeAdmin(roles, extra);
  const sent: string[] = [];
  return {
    a,
    sent,
    d: {
      env: (k: string) => env[k],
      admin: a.admin,
      userIdFor: () => Promise.resolve(userId),
      source: fixtureSource((q) => { sent.push(q); return { hits: [], error: null, credits: 1 }; }),
      now: () => new Date("2026-11-10T12:00:00Z"),
    },
  };
}
const ON = { LISA_V2_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "svc", LEAD_CREDIT_ENFORCEMENT: "enforce" };

Deno.test("disabled by default: every action answers 409 before any read or provider call", async () => {
  const x = deps({}, { u1: "owner" }, "u1");
  for (const action of ["weekly", "scan_now", "transition", "tick", "signals"]) {
    const res = await handleLisa(req({ action, workspace_id: WS, request_id: "req-00000001" }), x.d);
    assertEquals(res.status, 409, action);
    assertEquals((await res.json()).error, "lisa_v2_disabled");
  }
  assertEquals(x.a.rpcs.length, 0);
  assertEquals(x.sent.length, 0);
});

Deno.test("roles: a viewer may read the weekly digest but may not scan (no credit reserved, no query sent)", async () => {
  const x = deps(ON, { viewer: "viewer" }, "viewer");
  assertEquals((await handleLisa(req({ action: "weekly", workspace_id: WS }), x.d)).status, 200);
  const scan = await handleLisa(req({ action: "scan_now", workspace_id: WS, request_id: "req-00000001" }), x.d);
  assertEquals(scan.status, 403);
  assertEquals((await scan.json()).error, "lisa_role_forbidden");
  const tr = await handleLisa(req({ action: "transition", workspace_id: WS, signal_event_id: WS, transition: "dismiss" }), x.d);
  assertEquals(tr.status, 403);
  assert(!x.a.rpcs.some((r) => r.fn === "credits_reserve" || r.fn === "lisa_signal_transition"));
  assertEquals(x.sent.length, 0);
});

Deno.test("non-members are refused; unauthenticated is 401", async () => {
  const x = deps(ON, { u1: "owner" }, "stranger");
  assertEquals((await handleLisa(req({ action: "weekly", workspace_id: WS }), x.d)).status, 403);
  const y = deps(ON, { u1: "owner" }, null);
  assertEquals((await handleLisa(req({ action: "weekly", workspace_id: WS }), y.d)).status, 401);
});

Deno.test("scan_now (editor): credits reserved per call; a retried request_id spends nothing again", async () => {
  const x = deps(ON, { ed: "editor" }, "ed");
  const first = await handleLisa(req({ action: "scan_now", workspace_id: WS, request_id: "req-00000001" }), x.d);
  assertEquals(first.status, 200);
  const sentAfterFirst = x.sent.length;
  const reserves = x.a.rpcs.filter((r) => r.fn === "credits_reserve").length;
  assert(sentAfterFirst > 0);
  assertEquals(reserves, sentAfterFirst, "one reservation per provider call");
  const again = await (await handleLisa(req({ action: "scan_now", workspace_id: WS, request_id: "req-00000001" }), x.d)).json();
  assertEquals(again.results[0].claim, "already_done");
  assertEquals(x.sent.length, sentAfterFirst, "the retry sent no query");
});

Deno.test("tick: service key only, and only with the schedule flag on", async () => {
  const x = deps(ON, { u1: "owner" }, "u1");
  assertEquals((await handleLisa(req({ action: "tick", workspace_id: WS }), x.d)).status, 403);
  assertEquals((await handleLisa(req({ action: "tick", workspace_id: WS }, "svc"), x.d)).status, 409);
  const y = deps({ ...ON, LISA_V2_SCHEDULE_ENABLED: "true" }, { u1: "owner" }, "u1");
  const ok = await handleLisa(req({ action: "tick", workspace_id: WS }, "svc"), y.d);
  assertEquals(ok.status, 200);
  assert(y.a.rpcs.some((r) => r.fn === "monitoring_spend_in_period"), "scheduled scans read the monitoring period ceiling");
});

Deno.test("transition goes through the RPC with the caller's user and session", async () => {
  const x = deps(ON, { ed: "editor" }, "ed");
  const res = await handleLisa(req({ action: "transition", workspace_id: WS, signal_event_id: WS, transition: "dismiss" }), x.d);
  assertEquals(res.status, 200);
  const call = x.a.rpcs.find((r) => r.fn === "lisa_signal_transition")!;
  assertEquals(call.args.p_actor_id, "ed");
  assertEquals(call.args.p_session_id, SID);
});

Deno.test("request parsing: scan_now needs an idempotency request_id; permissions map", () => {
  assert(!parseLisaRequest({ action: "scan_now", workspace_id: WS }).ok);
  assert(!parseLisaRequest({ action: "weekly", workspace_id: "nope" }).ok);
  assert(!parseLisaRequest({ action: "transition", workspace_id: WS, signal_event_id: WS, transition: "verify" }).ok);
  assertEquals(permissionFor("weekly"), "read");
  assertEquals(permissionFor("scan_now"), "edit");
  assertEquals(permissionFor("transition"), "edit");
});

// ── Signals recovery: plan execution, fixture mode, provider refusal ─────────────────────────
const PLAN = (status: string) => ({ id: "33333333-3333-4333-8333-333333333333", workspace_id: WS, kind: "icp", status, title: "US manufacturing expansion",
  target: { industries: ["Manufacturing", "Distribution"], locations: ["United States"] }, signal_categories: ["expansion", "hiring"] });
function noSource(x: ReturnType<typeof deps>) { const d = { ...x.d } as Record<string, unknown>; delete d.source; return d as typeof x.d; }

Deno.test("no provider and no fixture mode: scan_now and run_plan answer provider_not_configured — nothing reserved", async () => {
  const x = deps(ON, { u1: "owner" }, "u1", { monitoring_plans: [PLAN("approved")] });
  for (const body of [{ action: "scan_now", workspace_id: WS, request_id: "req-00000001" },
                      { action: "run_plan", workspace_id: WS, plan_id: "33333333-3333-4333-8333-333333333333", request_id: "req-00000002" }]) {
    const res = await handleLisa(req(body), noSource(x));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).error, "provider_not_configured");
  }
  assertEquals(x.a.rpcs.filter((r) => r.fn === "credits_reserve" || r.fn === "lisa_claim_scan_run").length, 0);
});

Deno.test("a draft plan never runs; a viewer cannot run an approved one", async () => {
  const env = { ...ON, LISA_FIXTURE_MODE: "true", LISA_FIXTURE_WORKSPACES: WS };
  const draft = deps(env, { u1: "owner" }, "u1", { monitoring_plans: [PLAN("draft")] });
  const r1 = await handleLisa(req({ action: "run_plan", workspace_id: WS, plan_id: "33333333-3333-4333-8333-333333333333", request_id: "req-00000003" }), noSource(draft));
  assertEquals(r1.status, 409); assertEquals((await r1.json()).error, "plan_not_approved");
  const viewer = deps(env, { u2: "viewer" }, "u2", { monitoring_plans: [PLAN("approved")] });
  const r2 = await handleLisa(req({ action: "run_plan", workspace_id: WS, plan_id: "33333333-3333-4333-8333-333333333333", request_id: "req-00000004" }), noSource(viewer));
  assertEquals(r2.status, 403);
  assertEquals(viewer.a.rpcs.length, 0);
});

Deno.test("fixture mode is workspace-scoped: another workspace in the same project is refused", async () => {
  const env = { ...ON, LISA_FIXTURE_MODE: "true", LISA_FIXTURE_WORKSPACES: "99999999-9999-4999-8999-999999999999" };
  const x = deps(env, { u1: "owner" }, "u1", { monitoring_plans: [PLAN("approved")] });
  const res = await handleLisa(req({ action: "run_plan", workspace_id: WS, plan_id: "33333333-3333-4333-8333-333333333333", request_id: "req-00000005" }), noSource(x));
  assertEquals((await res.json()).error, "provider_not_configured");
});

Deno.test("an approved plan runs once in fixture mode and records signals through the canonical RPC", async () => {
  const env = { ...ON, LISA_FIXTURE_MODE: "true", LISA_FIXTURE_WORKSPACES: WS };
  const x = deps(env, { u1: "editor" }, "u1", { monitoring_plans: [PLAN("approved")] });
  const res = await handleLisa(req({ action: "run_plan", workspace_id: WS, plan_id: "33333333-3333-4333-8333-333333333333", request_id: "req-00000006" }), noSource(x));
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.mode, "fixture");
  assert(x.a.rpcs.some((r) => r.fn === "lisa_claim_scan_run" && String(r.args.p_run_key).startsWith("plan:33333333-3333-4333-8333-333333333333:")));
  assert(x.a.rpcs.some((r) => r.fn === "lisa_record_signal"), "the fixture expansion event reached the store");
});
