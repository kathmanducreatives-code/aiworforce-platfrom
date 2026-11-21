// R1.2.1 · CONVERSATION ↔ WORKSPACE BINDING against real Postgres + PostgREST:
// the app's insert under RLS, pilot-chat's atomic first-use binder
// (conversationBinding.ts) through supabase-js, the legacy-history rule, a real
// concurrent first use, and the held trigger 20261121120000_conversation_workspace_guard.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, join, opts, sql, team } from "./lib/brainMemory.ts";
import { bindConversationWorkspace } from "../../supabase/functions/_shared/conversationBinding.ts";

async function twoWorkspaces() {
  const a = await team({ company: { name: "Alpha (fictional)" } });
  const b = await team({ company: { name: "Beta (fictional)" } });
  await join(b.ws, a.owner, "owner"); // the same person belongs to both
  return { A: a.ws, B: b.ws, user: a.owner, outsider: b.editor };
}
const conversation = async (user: string, ws: string | null) => {
  const [c] = await sql`insert into public.conversations (user_id, workspace_id, agent_slug, title, status)
    values (${user}, ${ws}, 'pilot', 'contract', 'active') returning id`;
  return c.id as string;
};
const wsOf = async (id: string) => (await sql`select workspace_id from public.conversations where id = ${id}`)[0].workspace_id;

Deno.test({ name: "R1.2.1 (real DB): the app's New chat insert stores the workspace under RLS", ...opts, fn: async () => {
  const { A, user } = await twoWorkspaces();
  const client = await as("authenticated", user.id);
  const { data, error } = await client.from("conversations")
    .insert({ user_id: user.id, workspace_id: A, agent_slug: "pilot", title: "New chat", status: "active" })
    .select("id, workspace_id").single();
  assertEquals(error, null);
  assertEquals(data!.workspace_id, A);
}});

Deno.test({ name: "R1.2.1 (real DB): an unbound chat is bound on first use, then refused elsewhere", ...opts, fn: async () => {
  const { A, B, user } = await twoWorkspaces();
  const id = await conversation(user.id, null);
  const svc = await as("service_role");
  assertEquals(await bindConversationWorkspace(svc as never, { conversationId: id, userId: user.id, workspaceId: A }), { ok: true, bound_now: true });
  assertEquals(await wsOf(id), A);
  assertEquals(await bindConversationWorkspace(svc as never, { conversationId: id, userId: user.id, workspaceId: B }), { ok: false, reason: "bound_to_other_workspace" });
  assertEquals(await wsOf(id), A, "never rebound");
  assertEquals(await bindConversationWorkspace(svc as never, { conversationId: id, userId: user.id, workspaceId: A }), { ok: true, bound_now: false });
}});

Deno.test({ name: "R1.2.1 (real DB): legacy history logged in B cannot continue in A", ...opts, fn: async () => {
  const { A, B, user } = await twoWorkspaces();
  const id = await conversation(user.id, null);
  await sql`insert into public.messages (conversation_id, role, content) values (${id}, 'user', 'an old turn in B')`;
  await sql`insert into public.request_understanding_log (workspace_id, conversation_id, source, utterance_hash, utterance_redacted)
    values (${B}, ${id}, 'chat_brain_shadow', 'h', 'r')`;
  const svc = await as("service_role");
  assertEquals(await bindConversationWorkspace(svc as never, { conversationId: id, userId: user.id, workspaceId: A }), { ok: false, reason: "history_from_other_workspace" });
  assertEquals(await wsOf(id), null);
  // Unattributed history for a two-workspace user is refused too.
  const id2 = await conversation(user.id, null);
  await sql`insert into public.messages (conversation_id, role, content) values (${id2}, 'user', 'no evidence')`;
  assertEquals(await bindConversationWorkspace(svc as never, { conversationId: id2, userId: user.id, workspaceId: A }), { ok: false, reason: "legacy_history_unattributed" });
}});

Deno.test({ name: "R1.2.1 (real DB): concurrent first use in two workspaces — exactly one wins", ...opts, fn: async () => {
  const { A, B, user } = await twoWorkspaces();
  for (let round = 0; round < 5; round++) {
    const id = await conversation(user.id, null);
    const [s1, s2] = [await as("service_role"), await as("service_role")];
    const [ra, rb] = await Promise.all([
      bindConversationWorkspace(s1 as never, { conversationId: id, userId: user.id, workspaceId: A }),
      bindConversationWorkspace(s2 as never, { conversationId: id, userId: user.id, workspaceId: B }),
    ]);
    assertEquals([ra.ok, rb.ok].filter(Boolean).length, 1, JSON.stringify({ ra, rb }));
    assertEquals(await wsOf(id), ra.ok ? A : B);
  }
}});

Deno.test({ name: "R1.2.1 (real DB, held trigger): the browser cannot move a bound chat or bind to a foreign workspace", ...opts, fn: async () => {
  const { A, B, user, outsider } = await twoWorkspaces();
  const client = await as("authenticated", user.id);
  const id = await conversation(user.id, A);
  const moved = await client.from("conversations").update({ workspace_id: B }).eq("id", id).select("id");
  assert(moved.error, "moving a bound conversation must fail");
  assertEquals(await wsOf(id), A);
  const cleared = await client.from("conversations").update({ workspace_id: null }).eq("id", id).select("id");
  assert(cleared.error, "clearing a bound conversation must fail");
  // A workspace the user is not a member of: refused on insert…
  const foreign = (await team({ company: { name: "Foreign (fictional)" } })).ws;
  const ins = await client.from("conversations").insert({ user_id: user.id, workspace_id: foreign, agent_slug: "pilot", title: "x", status: "active" }).select("id");
  assert(ins.error, "binding to a non-member workspace must fail");
  // …and when binding an unbound row.
  const free = await conversation(user.id, null);
  const bind = await client.from("conversations").update({ workspace_id: foreign }).eq("id", free).select("id");
  assert(bind.error);
  assertEquals(await wsOf(free), null);
  // Other edits (rename) still work, and another user still sees nothing.
  const rename = await client.from("conversations").update({ title: "renamed" }).eq("id", id).select("id");
  assertEquals(rename.error, null);
  const peek = await (await as("authenticated", outsider.id)).from("conversations").select("id").eq("id", id);
  assertEquals(peek.data, []);
  // Deleting the workspace still clears the FK (ON DELETE SET NULL).
  const gone = await team({ company: { name: "Doomed (fictional)" } });
  await join(gone.ws, user, "owner");
  const doomed = await conversation(user.id, gone.ws);
  await sql`delete from public.workspaces where id = ${gone.ws}`;
  assertEquals(await wsOf(doomed), null);
}});
