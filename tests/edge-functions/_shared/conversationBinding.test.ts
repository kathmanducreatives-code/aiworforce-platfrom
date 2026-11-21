// R1.2.1 · conversation ↔ workspace binding (supabase/functions/_shared/conversationBinding.ts).
// Production smoke test 2026-11-21: an app-created chat (workspace_id NULL) was
// never bound, so R1.2's cross-workspace refusal did not apply to it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindConversationWorkspace, decideConversationBinding,
} from "../../../supabase/functions/_shared/conversationBinding.ts";

const WS_A = "aaaaaaaa-0000-4000-8000-000000000001";
const WS_B = "bbbbbbbb-0000-4000-8000-000000000002";
const USER = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";
const CONV = "cccccccc-0000-4000-8000-0000000000c1";

type Row = Record<string, unknown>;
interface Tables { conversations: Row[]; request_understanding_log: Row[]; messages: Row[]; workspace_members: Row[] }

/** Minimal PostgREST-shaped builder over arrays: eq / is / limit / maybeSingle / update…select. */
function mockDb(t: Tables, hooks: { beforeUpdate?: () => void; failTable?: string } = {}) {
  const writes: Array<{ table: string; set: Row; matched: number }> = [];
  const from = (table: keyof Tables) => {
    const filters: Array<(r: Row) => boolean> = [];
    let lim = Infinity;
    let patch: Row | null = null;
    const rows = () => t[table].filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (hooks.failTable === table) return { data: null, error: { message: "boom" } };
      if (patch) {
        hooks.beforeUpdate?.();
        const hit = rows();
        hit.forEach((r) => Object.assign(r, patch));
        writes.push({ table, set: patch, matched: hit.length });
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows().slice(0, lim), error: null };
    };
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b; },
      limit: (n: number) => { lim = n; return b; },
      update: (p: Row) => { patch = p; return b; },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }); },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { db: { from }, writes };
}
const base = (conv: Partial<Row> = {}): Tables => ({
  conversations: [{ id: CONV, user_id: USER, workspace_id: null, ...conv }],
  request_understanding_log: [], messages: [], workspace_members: [{ user_id: USER, workspace_id: WS_A }],
});

// ── the pure decision table ────────────────────────────────────────────────
Deno.test("decision table", () => {
  const d = (o: Partial<Parameters<typeof decideConversationBinding>[0]>) => decideConversationBinding({
    conversationWorkspace: null, requestWorkspace: WS_A, evidenceWorkspaces: [], hasMessages: false, userWorkspaceCount: 1, ...o,
  });
  assertEquals(d({ conversationWorkspace: WS_A }), { ok: true, bind: false });
  assertEquals(d({ conversationWorkspace: WS_B }), { ok: false, reason: "bound_to_other_workspace" });
  assertEquals(d({}), { ok: true, bind: true }, "empty app-created chat binds");
  assertEquals(d({ evidenceWorkspaces: [WS_A, WS_A], hasMessages: true }), { ok: true, bind: true });
  assertEquals(d({ evidenceWorkspaces: [WS_B], hasMessages: true }), { ok: false, reason: "history_from_other_workspace" });
  assertEquals(d({ evidenceWorkspaces: [WS_A, WS_B], hasMessages: true }), { ok: false, reason: "history_from_other_workspace" });
  assertEquals(d({ hasMessages: true, userWorkspaceCount: 1 }), { ok: true, bind: true }, "single-workspace user: nowhere else to leak from");
  assertEquals(d({ hasMessages: true, userWorkspaceCount: 2 }), { ok: false, reason: "legacy_history_unattributed" });
  assertEquals(d({ hasMessages: true, userWorkspaceCount: 0 }), { ok: false, reason: "legacy_history_unattributed" });
});

// ── the binder against a database ──────────────────────────────────────────
Deno.test("an app-created (unbound, empty) chat is bound on first use, with one conditional write", async () => {
  const t = base();
  const { db, writes } = mockDb(t);
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: true, bound_now: true });
  assertEquals(t.conversations[0].workspace_id, WS_A);
  assertEquals(writes, [{ table: "conversations", set: { workspace_id: WS_A }, matched: 1 }]);
  // …and is then refused in another workspace, and accepted again in its own, with no further write.
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_B }), { ok: false, reason: "bound_to_other_workspace" });
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: true, bound_now: false });
  assertEquals(writes.length, 1);
});

Deno.test("someone else's conversation is not found, and nothing is written", async () => {
  const t = base({ user_id: OTHER });
  const { db, writes } = mockDb(t);
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: false, reason: "not_found" });
  assertEquals(writes.length, 0);
  assertEquals(t.conversations[0].workspace_id, null);
});

Deno.test("legacy history logged in workspace B cannot be continued in workspace A — and stays unbound", async () => {
  const t = base();
  t.messages.push({ id: "m1", conversation_id: CONV });
  t.request_understanding_log.push({ conversation_id: CONV, workspace_id: WS_B });
  t.workspace_members.push({ user_id: USER, workspace_id: WS_B });
  const { db, writes } = mockDb(t);
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: false, reason: "history_from_other_workspace" });
  assertEquals(writes.length, 0);
  // In its own workspace it binds.
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_B }), { ok: true, bound_now: true });
  assertEquals(t.conversations[0].workspace_id, WS_B);
});

Deno.test("unattributed legacy history: binds for a single-workspace user, refused for a multi-workspace user", async () => {
  const one = base(); one.messages.push({ id: "m1", conversation_id: CONV });
  assertEquals(await bindConversationWorkspace(mockDb(one).db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: true, bound_now: true });
  const two = base(); two.messages.push({ id: "m1", conversation_id: CONV });
  two.workspace_members.push({ user_id: USER, workspace_id: WS_B });
  const m = mockDb(two);
  assertEquals(await bindConversationWorkspace(m.db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: false, reason: "legacy_history_unattributed" });
  assertEquals(m.writes.length, 0);
});

Deno.test("concurrent first use: the loser is refused unless the winner bound the same workspace", async () => {
  // Another request binds the row to B between our checks and our conditional UPDATE.
  const t = base();
  const { db } = mockDb(t, { beforeUpdate: () => { t.conversations[0].workspace_id = WS_B; } });
  assertEquals(await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: false, reason: "bound_concurrently_elsewhere" });
  assertEquals(t.conversations[0].workspace_id, WS_B, "the winner's binding is never overwritten");
  // Same workspace won the race → accepted.
  const t2 = base();
  const m2 = mockDb(t2, { beforeUpdate: () => { t2.conversations[0].workspace_id = WS_A; } });
  assertEquals(await bindConversationWorkspace(m2.db, { conversationId: CONV, userId: USER, workspaceId: WS_A }), { ok: true, bound_now: false });
});

Deno.test("fails closed: an evidence read error refuses and writes nothing", async () => {
  const t = base(); t.messages.push({ id: "m1", conversation_id: CONV });
  const { db, writes } = mockDb(t, { failTable: "request_understanding_log" });
  const r = await bindConversationWorkspace(db, { conversationId: CONV, userId: USER, workspaceId: WS_A });
  assert(!r.ok);
  assertEquals(writes.length, 0);
});
