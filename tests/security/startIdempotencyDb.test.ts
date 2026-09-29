// DUPLICATE START, AT THE DATABASE: the unique index the server's idempotency
// rests on, on real Postgres (the throwaway isolation stack). A second plan with
// the same Start key in the same workspace must be impossible, whoever inserts
// it and however they race; the same key in another workspace, or a different
// card's key, must still work.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ENABLED = Deno.env.get("ISOLATION_STACK") === "1";
const API = Deno.env.get("ISO_API_URL") ?? "";
const SERVICE = Deno.env.get("ISO_SERVICE_ROLE_KEY") ?? "";
const WS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const WS_B = "bbbbbbbb-0000-4000-8000-00000000000b";

async function insertPlan(ws: string, key: string) {
  const res = await fetch(`${API}/rest/v1/task_plans`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ workspace_id: ws, user_instruction: "iso start", idempotency_key: key }),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * THIS FILE OWNS ITS FIXTURES. It runs before workspaceIsolation.test.ts
 * (alphabetical), which is what seeds these two workspaces — so on a FRESH
 * stack every insert here hit the workspace foreign key (409) and the burst
 * saw zero successes. It passed only on a reused stack that still held the
 * rows from an earlier run (found 2026-09-29 once stale stacks were refused).
 */
async function ensureWorkspace(id: string) {
  const res = await fetch(`${API}/rest/v1/workspaces?on_conflict=id`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ id, name: `iso ${id.slice(0, 8)}` }),
  });
  assert(res.ok, `workspace ${id} could not be ensured (HTTP ${res.status})`);
}

Deno.test({
  name: "task_plans_idempotency_uniq: one plan per (workspace, Start key), even under a concurrent burst",
  ignore: !ENABLED,
  async fn() {
    await ensureWorkspace(WS_A);
    await ensureWorkspace(WS_B);
    const key = `start:${crypto.randomUUID()}`;
    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => insertPlan(WS_A, key)));
    assertEquals(burst.filter((r) => r.status === 201).length, 1, JSON.stringify(burst.map((r) => r.status)));
    for (const r of burst.filter((x) => x.status !== 201)) {
      assertEquals(r.status, 409);
      assertEquals((r.body as { code?: string }).code, "23505");
    }
    assertEquals((await insertPlan(WS_B, key)).status, 201, "the same key in another workspace is a different Start");
    assertEquals((await insertPlan(WS_A, `start:${crypto.randomUUID()}`)).status, 201, "another card is another mission");
    const rows = await (await fetch(`${API}/rest/v1/task_plans?idempotency_key=eq.${encodeURIComponent(key)}&select=workspace_id`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })).json() as Array<{ workspace_id: string }>;
    assert(rows.length === 2 && new Set(rows.map((r) => r.workspace_id)).size === 2);
  },
});
