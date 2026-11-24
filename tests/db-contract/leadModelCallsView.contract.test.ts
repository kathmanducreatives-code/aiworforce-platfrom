// THE MODEL-SPEND VIEW (held 20261114120000) against real Postgres + PostgREST.
//
// Without the fix, public.lead_model_calls is an owner-rights view granted to
// browser roles: anon reads every workspace's model rows and can DELETE them
// through the view (bypassing the base table's RLS), which erases the ledger the
// spend ceiling sums. With it: anon and members get nothing through the view;
// the service role (the only real reader) still reads everything.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
async function as(role: "service_role" | "authenticated" | "anon", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  const f: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  };
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: f } });
}
async function modelRow(ws: string): Promise<string> {
  const [r] = await sql`insert into public.lead_execution_calls (workspace_id, stage, reason, provider_id, logical_call_key, status,
      record_kind, estimated_cost_usd, cost_source, metadata)
    values (${ws}, 'chat', 'model', 'openai', ${`m:${uuid()}`}, 'succeeded', 'model_call', 0.0123, 'event_priced',
      ${sql.json({ role: "pilot-chat:pilot_chat", model: "claude-haiku-4-5-20251001" } as never)}) returning id`;
  return r.id as string;
}

Deno.test({ name: "lead_model_calls: anon and other members cannot read or delete spend rows; the service role still reads", ...opts, fn: async () => {
  const ws = await seedWorkspace();
  const id = await modelRow(ws);
  const anon = await as("anon");
  const read = await anon.from("lead_model_calls").select("id").eq("id", id);
  assert(read.error || (read.data ?? []).length === 0, "anon must not read model spend");
  const del = await anon.from("lead_model_calls").delete().eq("id", id).select();
  assert(del.error || (del.data ?? []).length === 0, "anon must not delete through the view");
  // A signed-in user of ANOTHER workspace gets nothing either.
  const stranger = uuid();
  await sql`insert into auth.users (id, email) values (${stranger}, ${`lmc-${stranger.slice(0, 8)}@contract.test`})`;
  const s = await (await as("authenticated", stranger)).from("lead_model_calls").select("id").eq("id", id);
  assert(s.error || (s.data ?? []).length === 0, "a non-member must not read another workspace's spend");
  // The row survived, and the server-side reader still sees it.
  assertEquals(Number((await sql`select count(*)::int n from public.lead_execution_calls where id = ${id}`)[0].n), 1);
  const svc = await (await as("service_role")).from("lead_model_calls").select("id, estimated_cost_usd").eq("id", id);
  assertEquals(svc.error, null);
  assertEquals(svc.data?.length, 1);
}});

Deno.test({ name: "lead_model_calls: the view runs with the caller's rights; browser roles hold no privilege on it", ...opts, fn: async () => {
  const [v] = await sql`select coalesce(array_to_string(reloptions, ','), '') o from pg_class where oid = 'public.lead_model_calls'::regclass`;
  assert(String(v.o).includes("security_invoker=true"), String(v.o));
  const grants = await sql`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'lead_model_calls' and grantee in ('anon', 'authenticated')`;
  assertEquals(grants.length, 0, JSON.stringify(grants));
}});
