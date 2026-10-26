// CLIENT PINS IN THE EXECUTION PATH — integration of the held task pins
// (20261025170000, #191), #176's client schema and Brain rule, the pre-effect
// guard and the effect fence (#192). Runs only where that schema exists (the
// combined client tree); elsewhere it is skipped, never faked.
//
//   1. A stored task pinned in COLUMNS, resumed through the real run-agent
//      handler with a clean request and payload, is refused
//      `client_scope_unsupported` before any external request or new task.
//   2. The fence, bound to real pins and Brain's own client_brain_authorization
//      (task intent), lets an operation through, then refuses the next one once
//      the grant is actually revoked, and once the role is actually changed.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";
import { bindEffectPrincipal, createEffectFence, effectScope, type EffectPins, type EffectPrincipalDb }
  from "../../supabase/functions/_shared/effectFence.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const [{ present }] = await sql`select exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'client_grant_id')
  and exists (select 1 from pg_proc where proname = 'client_brain_authorization') as present`;
const ignore = !present;
if (!ignore) {
  await sql`create table if not exists auth.sessions (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz default now(), not_after timestamptz)`;
}
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};

/** An agency, a client, an editor granted it; the editor's pins from Brain's own API. */
async function world() {
  const ws = await seedWorkspace();
  const mk = async (role: string) => {
    const id = uuid(), session = uuid();
    await sql`insert into auth.users (id, email) values (${id}, ${`cp-${id.slice(0, 8)}@contract.test`})`;
    await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
    await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${id}, ${role})`;
    return { id, session };
  };
  const owner = await mk("owner"), editor = await mk("editor");
  const [c] = await sql`select * from public.client_account_create(${ws}, ${owner.id}, ${owner.session}, ${"Client " + uuid().slice(0, 6)})`;
  const [g] = await sql`select * from public.client_access_grant(${ws}, ${c.client_id}, ${editor.id}, ${owner.id}, ${owner.session})`;
  assertEquals(g.outcome, "ok");
  const [p] = await sql`select * from public.client_brain_pin(${ws}, ${c.client_id}, ${editor.id}, ${editor.session}, 'read')`;
  assertEquals(p.outcome, "ok");
  const pins: EffectPins = { clientId: c.client_id, grantId: p.grant_id, generation: p.generation,
    permissionRevision: p.permission_revision, originSessionId: editor.session };
  return { ws, owner, editor, client: c.client_id as string, pins };
}

Deno.test({ name: "pins + guard: a stored task pinned in columns never resumes as agency work — refused before any effect", ignore, ...opts, fn: async () => {
  const w = await world();
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department)
            values (${w.ws}, 'scribe', 'Synthetic Scribe', 'Write a short draft using supplied facts only.', 'content')`;
  // Created through the database's own check (service role, valid pins at commit), with a clean payload.
  const svc = createClient(REST_URL, await mintJwt("service_role"), { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
  const ins = await svc.from("tasks").insert({ workspace_id: w.ws, user_id: w.editor.id, status: "running", agent_slug: "scribe",
    payload: { instruction: "clean" }, client_id: w.client, client_grant_id: w.pins.grantId,
    client_grant_generation: w.pins.generation, permission_revision: w.pins.permissionRevision,
    origin_session_id: w.editor.session }).select("id").single();
  assertEquals(ins.error, null, JSON.stringify(ins.error));
  const pinnedId = (ins.data as { id: string }).id;
  const key = await mintJwt("service_role");
  const env: Record<string, string> = { RUN_AGENT_IMPORT_ONLY: "1", SUPABASE_URL: REST_URL, SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_ANON_KEY: key, OPENAI_API_KEY: "offline", ANTHROPIC_API_KEY: "offline", LOVABLE_API_KEY: "offline" };
  const saved = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let external = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.origin !== new URL(REST_URL).origin) {
      external++;
      return Promise.resolve(new Response("{}", { status: 503 }));
    }
    return original(u.href.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  }) as typeof fetch;
  let status = 0, body: Record<string, unknown> = {};
  try {
    const { handleRunAgent } = await import("../../supabase/functions/run-agent/index.ts");
    const res = await handleRunAgent(new Request(`${REST_URL}/functions/v1/run-agent`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: w.ws, user_id: w.editor.id, agent_slug: "scribe", instruction: "continue",
        resume_task_id: pinnedId }),
    }));
    status = res.status;
    body = await res.json();
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
  assertEquals([status, body.error], [403, "client_scope_unsupported"], JSON.stringify(body));
  assertEquals(external, 0, "no external request");
  assertEquals(Number((await sql`select count(*)::int n from public.tasks where workspace_id = ${w.ws}`)[0].n), 1, "no new task");
}});

Deno.test({ name: "pins + fence: Brain's rule per operation — allowed, then refused after a real revoke and after a real role change", ignore, ...opts, fn: async () => {
  const svc = createClient(REST_URL, await mintJwt("service_role"), { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
  const authorizer = (ws: string, user: string) => async (p: EffectPins) => {
    const { data, error } = await svc.rpc("client_brain_authorization", { p_workspace_id: ws, p_client_id: p.clientId,
      p_actor_id: user, p_session_id: p.originSessionId, p_permission: "read", p_intent: "task",
      p_pin_grant_id: p.grantId, p_pin_generation: p.generation, p_pin_revision: p.permissionRevision });
    if (error) throw new Error(error.message);
    return data as string;
  };
  const run = async (w: Awaited<ReturnType<typeof world>>, change: () => Promise<unknown>) => {
    let sent = 0;
    const fence = createEffectFence(() => { sent++; return Promise.resolve(new Response("{}", { status: 200 })); },
      new URL(REST_URL), () => {});
    return await effectScope.run({ principal: null }, async () => {
      bindEffectPrincipal({ db: svc as unknown as EffectPrincipalDb, workspaceId: w.ws, userId: w.editor.id, pins: w.pins,
        authorizeTask: authorizer(w.ws, w.editor.id) });
      const call = () => fence("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" });
      const before = await call();
      await change();
      const after = await call();
      return { before: before.status, after: after.status, decision: (await after.json()).error?.decision, sent };
    });
  };
  const w1 = await world();
  const revoked = await run(w1, () => sql`select * from public.client_access_revoke(${w1.ws}, ${w1.client}, ${w1.editor.id}, ${w1.owner.id}, ${w1.owner.session})`);
  assertEquals(revoked, { before: 200, after: 409, decision: "client_grant_changed", sent: 1 });
  const w2 = await world();
  const demoted = await run(w2, () => sql`update public.workspace_members set role = 'viewer' where workspace_id = ${w2.ws} and user_id = ${w2.editor.id}`);
  assertEquals(demoted, { before: 200, after: 409, decision: "client_permission_changed", sent: 1 });
  assert(true);
}});
