// TWO-WORKSPACE ISOLATION — REAL POSTGRES, REAL RLS, REAL USER JWTS.
//
// Runs only against the throwaway local stack (scripts/security/isolation-stack.sh):
//
//   scripts/security/run-isolation-suite.sh
//
// Workspace A / user A and workspace B / user B. For EVERY public table with a
// workspace_id (seeded generically by isolation-seed.sql), each user attacks the
// other's rows through PostgREST exactly as a browser could: read by workspace,
// read by guessed id, update (including moving the row into their own
// workspace), delete, and insert into the victim workspace. Then the RPCs that
// move money or missions. Every attack is checked for its EFFECT with the
// service role, not only for its HTTP status.
//
// Positive control: each user must still read their OWN rows wherever a policy
// grants it, so "nothing came back" cannot pass by the whole API being broken.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ENABLED = Deno.env.get("ISOLATION_STACK") === "1";
const API = Deno.env.get("ISO_API_URL") ?? "";
const ANON = Deno.env.get("ISO_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("ISO_SERVICE_ROLE_KEY") ?? "";
const DB_CONTAINER = Deno.env.get("ISO_DB_CONTAINER") ?? "supabase_db_agentory-isolation";

const WS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const WS_B = "bbbbbbbb-0000-4000-8000-00000000000b";

type Seed = { table_name: string; workspace_id: string; pk_column: string | null; pk_value: string | null; error: string | null };

async function jsonFetch(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", init.token === SERVICE ? SERVICE : ANON);
  headers.set("Authorization", `Bearer ${init.token ?? ANON}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body, headers: res.headers };
}

async function ensureUser(email: string): Promise<{ id: string; token: string }> {
  const password = "Isolation-Test-Pw-1!";
  const created = await jsonFetch("/auth/v1/admin/users", {
    method: "POST", token: SERVICE, body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (created.status >= 300 && created.status !== 422) throw new Error(`create ${email}: ${created.status} ${JSON.stringify(created.body)}`);
  const signIn = await jsonFetch("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const b = signIn.body as { access_token?: string; user?: { id: string } };
  if (!b.access_token || !b.user) throw new Error(`sign-in ${email}: ${signIn.status}`);
  return { id: b.user.id, token: b.access_token };
}

async function seed(userA: string, userB: string): Promise<Seed[]> {
  const sql = await Deno.readTextFile(new URL("./isolation-seed.sql", import.meta.url));
  const cmd = new Deno.Command("docker", {
    args: ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1",
      "-v", `ws_a=${WS_A}`, "-v", `ws_b=${WS_B}`, "-v", `user_a=${userA}`, "-v", `user_b=${userB}`],
    stdin: "piped", stdout: "piped", stderr: "piped",
  });
  const p = cmd.spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const out = await p.output();
  const text = new TextDecoder().decode(out.stdout);
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(text.slice(text.indexOf("[{")));
}

const svcRows = async (table: string, ws: string) =>
  (await jsonFetch(`/rest/v1/${table}?workspace_id=eq.${ws}&select=*`, { token: SERVICE })).body as Array<Record<string, unknown>>;

const KEYISH = /(^id$|_key$|^key$|dedupe|idempotency|url$|^slug$|^name$|cluster_key|lead_id|version|seq)/;

if (!ENABLED) {
  Deno.test({ name: "workspace isolation (skipped: set ISOLATION_STACK=1 via scripts/security/run-isolation-suite.sh)", ignore: true, fn() {} });
} else {
  const A = await ensureUser("iso-a@agentory.test");
  const B = await ensureUser("iso-b@agentory.test");
  const seeded = await seed(A.id, B.id);
  const tables = [...new Set(seeded.map((s) => s.table_name))].sort();
  const who: Record<string, { id: string; token: string }> = { [WS_A]: A, [WS_B]: B };
  const other = (ws: string) => (ws === WS_A ? WS_B : WS_A);
  const report: Record<string, string> = {};

  Deno.test("seed: every workspace-scoped table holds one row for A and one for B", () => {
    const failed = seeded.filter((s) => s.error);
    assertEquals(failed, [], JSON.stringify(failed));
    assert(tables.length >= 45, `${tables.length} tables`);
  });

  for (const attackerWs of [WS_A, WS_B]) {
    const attacker = who[attackerWs];
    const victimWs = other(attackerWs);
    const dir = attackerWs === WS_A ? "A→B" : "B→A";

    for (const table of tables) {
      Deno.test(`${dir} ${table}: cannot read, guess, update, move, delete or insert the other workspace's rows`, async () => {
        const before = await svcRows(table, victimWs);
        assert(before.length >= 1, `${table}: victim row seeded`);

        // READ by workspace.
        const read = await jsonFetch(`/rest/v1/${table}?workspace_id=eq.${victimWs}&select=*`, { token: attacker.token });
        assert(read.status >= 400 || (Array.isArray(read.body) && read.body.length === 0), `${table} READ leaked: ${JSON.stringify(read.body).slice(0, 200)}`);

        // READ by guessed id.
        const s = seeded.find((x) => x.table_name === table && x.workspace_id === victimWs)!;
        if (s.pk_column && s.pk_value && s.pk_column !== "workspace_id") {
          const guess = await jsonFetch(`/rest/v1/${table}?${s.pk_column}=eq.${encodeURIComponent(s.pk_value)}&select=*`, { token: attacker.token });
          // A key that is only unique WITHIN a workspace may match the attacker's own
          // row; what must never come back is a row of the victim's.
          assert(guess.status >= 400 || (Array.isArray(guess.body) && guess.body.every((r) => (r as Record<string, unknown>).workspace_id !== victimWs)),
            `${table} GUESSED-ID leaked`);
        }

        // UPDATE — including moving the row into the attacker's workspace.
        const move = await jsonFetch(`/rest/v1/${table}?workspace_id=eq.${victimWs}`, {
          method: "PATCH", token: attacker.token, headers: { Prefer: "return=representation" },
          body: JSON.stringify({ workspace_id: attackerWs }),
        });
        assert(move.status >= 400 || (Array.isArray(move.body) && move.body.length === 0), `${table} UPDATE succeeded: ${JSON.stringify(move.body).slice(0, 200)}`);

        // DELETE.
        const del = await jsonFetch(`/rest/v1/${table}?workspace_id=eq.${victimWs}`, {
          method: "DELETE", token: attacker.token, headers: { Prefer: "return=representation" },
        });
        assert(del.status >= 400 || (Array.isArray(del.body) && del.body.length === 0), `${table} DELETE succeeded`);

        // The EFFECT: the victim's rows are all still there, still the victim's.
        const after = await svcRows(table, victimWs);
        assertEquals(after.length, before.length, `${table}: victim rows changed`);

        // INSERT into the victim workspace, with a row that would otherwise be valid.
        const template = { ...before[0] };
        for (const k of Object.keys(template)) {
          if (KEYISH.test(k) && typeof template[k] === "string") template[k] = k === "id" ? crypto.randomUUID() : `${template[k]}-x${crypto.randomUUID().slice(0, 6)}`;
          if (k === "id" && typeof template[k] !== "string") delete template[k];
        }
        template.workspace_id = victimWs;
        const ins = await jsonFetch(`/rest/v1/${table}`, { method: "POST", token: attacker.token, headers: { Prefer: "return=representation" }, body: JSON.stringify(template) });
        const code = (ins.body as { code?: string })?.code ?? "";
        assert(ins.status >= 400, `${table} INSERT into victim workspace succeeded`);
        const final = await svcRows(table, victimWs);
        assertEquals(final.length, before.length, `${table}: a row was inserted into the victim workspace`);
        report[`${dir} ${table}`] = code === "42501" ? "insert refused by RLS" : `insert refused (${ins.status} ${code})`;
      });
    }

    Deno.test(`${dir} positive control: the attacker still reads its OWN rows where a policy allows`, async () => {
      let readable = 0;
      for (const table of tables) {
        const own = await jsonFetch(`/rest/v1/${table}?workspace_id=eq.${attackerWs}&select=*`, { token: attacker.token });
        if (Array.isArray(own.body) && own.body.length > 0) readable++;
      }
      // Core tables a member must see: if these fail, the whole API is broken, not isolated.
      for (const t of ["tasks", "task_plans", "approvals", "company_brain", "activity_feed"]) {
        const own = await jsonFetch(`/rest/v1/${t}?workspace_id=eq.${attackerWs}&select=*`, { token: attacker.token });
        assert(Array.isArray(own.body) && own.body.length >= 1, `${t}: a member cannot read their own workspace — the suite would be vacuous`);
      }
      assert(readable >= 10, `only ${readable} tables readable by their own member`);
    });

    // ── RPCs that move money or missions ─────────────────────────────────────
    Deno.test(`${dir} RPC: cannot mint, reserve, settle or read another workspace's credits`, async () => {
      const balBefore = await svcRows("workspace_credit_balances", victimWs);
      for (const [fn, args] of [
        ["credits_grant", { p_workspace: attackerWs, p_amount: 1000000, p_idempotency_key: `iso-${crypto.randomUUID()}` }],
        ["credits_grant", { p_workspace: victimWs, p_amount: 1000000, p_idempotency_key: `iso-${crypto.randomUUID()}` }],
        ["credits_reserve", { p_workspace: victimWs, p_amount: 1, p_idempotency_key: `iso-${crypto.randomUUID()}`, p_kind: "provider_call" }],
        ["credits_release_stale", { p_older_than: "0 seconds" }],
        ["monitoring_spend_in_period", { p_workspace: victimWs, p_period_days: 30 }],
        ["seed_agents_for_workspace", { _workspace_id: victimWs }],
        ["dev_table_counts", {}],
      ] as const) {
        for (const token of [attacker.token, ANON]) {
          const r = await jsonFetch(`/rest/v1/rpc/${fn}`, { method: "POST", token, body: JSON.stringify(args) });
          assert(r.status >= 400, `${fn} is callable by ${token === ANON ? "anon" : "a member of another workspace"}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
        }
      }
      const attackerBal = await svcRows("workspace_credit_balances", attackerWs);
      assert(attackerBal.every((r) => Number(r.balance_credits ?? 0) < 1000000), "credits were minted");
      assertEquals(await svcRows("workspace_credit_balances", victimWs), balBefore);
    });

    Deno.test(`${dir} RPC: cannot provision for, or learn the workspace of, another user; room profiles need membership`, async () => {
      const victim = who[victimWs];
      const r = await jsonFetch(`/rest/v1/rpc/provision_workspace_for_user`, { method: "POST", token: attacker.token, body: JSON.stringify({ _user_id: victim.id }) });
      assert(r.status >= 400, `provision_workspace_for_user for another user: ${r.status} ${JSON.stringify(r.body)}`);
      const anon = await jsonFetch(`/rest/v1/rpc/provision_workspace_for_user`, { method: "POST", body: JSON.stringify({ _user_id: victim.id }) });
      assert(anon.status >= 400, "anon provisioning");
      const own = await jsonFetch(`/rest/v1/rpc/provision_workspace_for_user`, { method: "POST", token: attacker.token, body: JSON.stringify({ _user_id: attacker.id }) });
      assertEquals(own.status, 200, "a user can still provision their own workspace");
      const room = await jsonFetch(`/rest/v1/rpc/get_room_member_profiles`, { method: "POST", token: attacker.token, body: JSON.stringify({ room_uuid: crypto.randomUUID() }) });
      assert(room.status >= 400 || (Array.isArray(room.body) && room.body.length === 0));
    });

    Deno.test(`${dir} RPC: cannot cancel, claim or release the other workspace's lineage or continuation`, async () => {
      const lineages = await svcRows("lead_lineages", victimWs);
      const tasks = await svcRows("tasks", victimWs);
      const lineageId = String(lineages[0]?.lineage_id ?? lineages[0]?.id);
      for (const [fn, args] of [
        ["cancel_lineage", { p_lineage_id: lineageId, p_workspace_id: victimWs, p_reason: "iso" }],
        ["acquire_lineage_lease", { p_lineage_id: lineageId, p_workspace_id: victimWs, p_holder_task_id: tasks[0]?.id, p_mission_hash: "x", p_lease_seconds: 60 }],
        ["claim_sourcing_continuation", { p_task_id: tasks[0]?.id, p_workspace_id: victimWs, p_claim_id: crypto.randomUUID(), p_lease_seconds: 60 }],
        ["cancel_lead_mission", { p_queue_id: crypto.randomUUID(), p_workspace_id: victimWs }],
        ["claim_next_lead_mission", { p_worker_id: crypto.randomUUID(), p_lease_seconds: 60 }],
        ["increment_tokens", { workspace_id_input: victimWs, amount: 5 }],
      ] as const) {
        await jsonFetch(`/rest/v1/rpc/${fn}`, { method: "POST", token: attacker.token, body: JSON.stringify(args) });
      }
      // Judged by EFFECT: nothing of the victim's changed.
      assertEquals(await svcRows("lead_lineages", victimWs), lineages);
      assertEquals(await svcRows("tasks", victimWs), tasks);
      const ws = (await jsonFetch(`/rest/v1/workspaces?id=eq.${victimWs}&select=tokens_used_today`, { token: SERVICE })).body as Array<{ tokens_used_today: number }>;
      assertEquals(ws[0].tokens_used_today ?? 0, 0, "increment_tokens changed another workspace");
    });
  }

  Deno.test("report", () => {
    console.log(JSON.stringify({ tables: tables.length, attacks: Object.keys(report).length }, null, 0));
  });
}
