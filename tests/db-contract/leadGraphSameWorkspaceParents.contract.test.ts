// OWN-01 against real PostgREST + real Postgres: a lead-graph row can only
// reference a parent in its OWN workspace, whoever writes it.
//
// Before 20261025120000_lead_graph_same_workspace_parents.sql (held), every
// parent reference was an ID-only foreign key and the child's policy checked
// only the child's workspace: a member of A who cannot read account B inserted
// a contact `{workspace_id: A, account_id: B}` and got 201 with the mismatched
// parent stored (#173 native reproduction). tests/db-contract/mutation.sh
// builds the database without the migration and requires the first test to
// fail. Every attack is judged by what landed (direct SQL), not by the status.
//
// Positive controls: an own-workspace parent, an absent parent, an embed
// through the relationship, and the delete behaviour all work as before.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
async function as(role: "authenticated" | "service_role", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: gatewayFetch },
  });
}
/** A workspace with one member and one account. */
async function tenant(name: string): Promise<{ ws: string; member: string; account: string }> {
  const ws = await seedWorkspace();
  const member = uuid();
  await sql`insert into auth.users (id, email) values (${member}, ${`${member.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'owner')`;
  const account = uuid();
  // The same synthetic name/domain in every tenant: identity similarity confers nothing.
  await sql`insert into public.accounts (id, workspace_id, name, domain) values (${account}, ${ws}, ${name}, 'acme.test')`;
  return { ws, member, account };
}
const contactsOf = async (ws: string) =>
  [...await sql`select id, workspace_id, account_id from public.contacts where workspace_id = ${ws} order by created_at`];

Deno.test("OWN-01: a member cannot store a contact under another workspace's account (raw INSERT)", opts, async () => {
  const a = await tenant("Acme"), b = await tenant("Acme");
  const browser = await as("authenticated", a.member);
  // Precondition (#173): A cannot read B's account.
  const seen = await browser.from("accounts").select("id").eq("id", b.account);
  assertEquals(seen.data, [], "A cannot see B's account");
  const r = await browser.from("contacts").insert({ workspace_id: a.ws, account_id: b.account, full_name: "Mallory" }).select("id");
  assert(r.error, `refused: ${JSON.stringify(r)}`);
  assertEquals(r.error.code, "23503");
  assertEquals(await contactsOf(a.ws), [], "no row stored");
});

Deno.test("OWN-01: a member cannot repoint an existing contact at another workspace's account (PATCH)", opts, async () => {
  const a = await tenant("Acme"), b = await tenant("Acme");
  const browser = await as("authenticated", a.member);
  const ins = await browser.from("contacts").insert({ workspace_id: a.ws, account_id: a.account, full_name: "Alice" }).select("id").single();
  assertEquals(ins.error, null);
  const r = await browser.from("contacts").update({ account_id: b.account }).eq("id", ins.data!.id).select("id");
  assert(r.error, `refused: ${JSON.stringify(r)}`);
  assertEquals((await contactsOf(a.ws)).map((c) => c.account_id), [a.account], "unchanged");
});

Deno.test("OWN-01: the service role (worker, edge functions) is refused the same mismatch", opts, async () => {
  // Distinct names: moving A's account into B must hit the parent rule, not (workspace_id, name).
  const a = await tenant("Acme"), b = await tenant("Acme B");
  const svc = await as("service_role");
  const c = await svc.from("contacts").insert({ workspace_id: a.ws, account_id: b.account }).select("id");
  assertEquals(c.error?.code, "23503");
  const l = await svc.from("lead_candidates").insert({ workspace_id: a.ws, account_id: b.account }).select("id");
  assertEquals(l.error?.code, "23503");
  assertEquals(Number((await sql`select count(*)::int n from public.lead_candidates where workspace_id = ${a.ws}`)[0].n), 0);
  // Moving a child to another workspace while it keeps its parent is the same mismatch.
  const [own] = await sql`insert into public.contacts (workspace_id, account_id) values (${a.ws}, ${a.account}) returning id`;
  const mv = await svc.from("contacts").update({ workspace_id: b.ws }).eq("id", own.id).select("id");
  assertEquals(mv.error?.code, "23503");
  // …and so is moving the PARENT away from its children.
  const mp = await svc.from("accounts").update({ workspace_id: b.ws }).eq("id", a.account).select("id");
  assertEquals(mp.error?.code, "23503");
  assertEquals((await sql`select workspace_id from public.accounts where id = ${a.account}`)[0].workspace_id, a.ws);
});

Deno.test("OWN-01: a foreign parent and a non-existent parent are refused alike (no existence oracle)", opts, async () => {
  const a = await tenant("Acme"), b = await tenant("Acme");
  const browser = await as("authenticated", a.member);
  const foreign = await browser.from("contacts").insert({ workspace_id: a.ws, account_id: b.account });
  const missing = await browser.from("contacts").insert({ workspace_id: a.ws, account_id: uuid() });
  assertEquals([foreign.status, foreign.error?.code], [missing.status, missing.error?.code]);
  const shape = (m?: string) => (m ?? "").replace(/[0-9a-f-]{36}/g, "<id>");
  assertEquals(shape(foreign.error?.details), shape(missing.error?.details));
});

Deno.test("positive controls: own parent, no parent, embed, delete behaviour", opts, async () => {
  const a = await tenant("Acme");
  const browser = await as("authenticated", a.member);
  const own = await browser.from("contacts").insert({ workspace_id: a.ws, account_id: a.account, full_name: "Own" }).select("id").single();
  assertEquals(own.error, null);
  const none = await browser.from("contacts").insert({ workspace_id: a.ws, full_name: "No account" }).select("id").single();
  assertEquals(none.error, null, "an optional parent stays optional");
  // Exactly one relationship per pair: embeds keep working (no PGRST201 ambiguity).
  const svc = await as("service_role");
  await svc.from("lead_candidates").insert({ workspace_id: a.ws, account_id: a.account, contact_id: own.data!.id });
  const emb = await svc.from("lead_candidates").select("id, accounts(name), contacts(full_name)").eq("workspace_id", a.ws).single();
  assertEquals(emb.error, null, JSON.stringify(emb.error));
  assertEquals([(emb.data as never as { accounts: { name: string } }).accounts.name,
    (emb.data as never as { contacts: { full_name: string } }).contacts.full_name], ["Acme", "Own"]);
  const inner = await svc.from("lead_candidates").select("id, accounts!inner(name)").eq("workspace_id", a.ws);
  assertEquals([inner.error, inner.data?.length], [null, 1]);
  // Deleting the parent nulls ONLY the parent column; the child stays in its workspace.
  const del = await browser.from("accounts").delete().eq("id", a.account);
  assertEquals(del.error, null, JSON.stringify(del.error));
  assertEquals((await contactsOf(a.ws)).map((c) => [c.workspace_id, c.account_id]), [[a.ws, null], [a.ws, null]]);
  const [lc] = await sql`select workspace_id, account_id, contact_id from public.lead_candidates where workspace_id = ${a.ws}`;
  assertEquals([lc.workspace_id, lc.account_id, lc.contact_id], [a.ws, null, own.data!.id]);
});

Deno.test("CASCADE references still cascade, inside the workspace", opts, async () => {
  const a = await tenant("Acme");
  const [sig] = await sql`insert into public.signals (workspace_id) values (${a.ws}) returning id`;
  await sql`insert into public.signal_reviews (workspace_id, user_id, signal_id) values (${a.ws}, ${a.member}, ${sig.id})`;
  await sql`delete from public.signals where id = ${sig.id}`;
  assertEquals(Number((await sql`select count(*)::int n from public.signal_reviews where signal_id = ${sig.id}`)[0].n), 0);
});

const REFS: Array<[string, string, string, "n" | "c"]> = [
  ["contacts", "account_id", "accounts", "n"], ["engagement_events", "account_id", "accounts", "n"],
  ["lead_candidates", "account_id", "accounts", "n"], ["lead_enrichments", "account_id", "accounts", "n"],
  ["lead_evidence", "account_id", "accounts", "n"], ["outreach_drafts", "account_id", "accounts", "n"],
  ["signal_events", "account_id", "accounts", "n"], ["engagement_events", "contact_id", "contacts", "n"],
  ["lead_candidates", "contact_id", "contacts", "n"], ["lead_enrichments", "contact_id", "contacts", "n"],
  ["lead_evidence", "contact_id", "contacts", "n"], ["outreach_drafts", "contact_id", "contacts", "n"],
  ["signal_events", "contact_id", "contacts", "n"], ["engagement_events", "lead_candidate_id", "lead_candidates", "n"],
  ["lead_enrichments", "lead_candidate_id", "lead_candidates", "n"], ["lead_evidence", "lead_candidate_id", "lead_candidates", "n"],
  ["outreach_drafts", "lead_candidate_id", "lead_candidates", "n"], ["signal_events", "lead_candidate_id", "lead_candidates", "n"],
  ["signal_reviews", "lead_candidate_id", "lead_candidates", "c"], ["lead_candidates", "evidence_id", "lead_evidence", "n"],
  ["engagement_events", "legacy_signal_id", "signals", "n"], ["lead_candidates", "signal_id", "signals", "n"],
  ["lead_evidence", "legacy_signal_id", "signals", "n"], ["signal_event_evidence", "legacy_signal_id", "signals", "n"],
  ["signal_events", "legacy_signal_id", "signals", "n"], ["signal_reviews", "signal_id", "signals", "c"],
];

Deno.test("catalog: all 26 lead-graph references are (workspace_id, col) → parent (workspace_id, id), one per pair", opts, async () => {
  const rows = [...await sql`
    select conrelid::regclass::text as child, confrelid::regclass::text as parent, conname,
           (select array_agg(attname order by k.ord) from unnest(conkey) with ordinality k(n, ord)
              join pg_attribute a on a.attrelid = conrelid and a.attnum = k.n) as cols,
           confdeltype as del, pg_get_constraintdef(oid) as def
      from pg_constraint
     where contype = 'f' and connamespace = 'public'::regnamespace
       and confrelid::regclass::text in ('accounts', 'contacts', 'lead_candidates', 'lead_evidence', 'signals')`];
  for (const [child, col, parent, del] of REFS) {
    const fks = rows.filter((r) => r.child === child && r.parent === parent && (r.cols as string[]).includes(col));
    assertEquals(fks.length, 1, `${child}.${col}: exactly one relationship`);
    const fk = fks[0];
    assertEquals(fk.conname, `${child}_${col}_fkey`, "name kept for PostgREST hints");
    assertEquals(fk.cols, ["workspace_id", col], `${child}.${col}: composite`);
    assertEquals(fk.del, del === "n" ? "n" : "c", `${child}.${col}: delete action`);
    if (del === "n") assertMatch(fk.def as string, new RegExp(`ON DELETE SET NULL \\(${col}\\)$`), `${child}.${col}: nulls only ${col}`);
  }
  // No ID-only reference into the graph remains from a workspace-scoped lead table.
  const idOnly = rows.filter((r) => (r.cols as string[]).length === 1 && REFS.some(([c]) => c === r.child));
  assertEquals(idOnly.map((r) => `${r.child}.${r.conname}`), []);
});

Deno.test("preflight: an existing mismatch aborts the migration and changes nothing", opts, async () => {
  const a = await tenant("Acme"), b = await tenant("Acme");
  const text = await Deno.readTextFile(new URL("../../supabase/migrations-held/20261025120000_lead_graph_same_workspace_parents.sql", import.meta.url));
  let caught = "";
  await sql.begin(async (tx) => {
    // Recreate the pre-migration state for contacts, with one mismatched row.
    await tx`alter table public.contacts drop constraint contacts_account_id_fkey`;
    await tx`alter table public.contacts add constraint contacts_account_id_fkey foreign key (account_id) references public.accounts (id) on delete set null`;
    await tx`insert into public.contacts (workspace_id, account_id, full_name) values (${a.ws}, ${b.account}, 'legacy mismatch')`;
    await tx`savepoint before_migration`;
    try { await tx.unsafe(text); } catch (e) { caught = String((e as Error).message); }
    await tx`rollback to savepoint before_migration`;
    const [def] = await tx`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'contacts_account_id_fkey'`;
    assertEquals(def.d, "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL", "nothing changed");
    const [row] = await tx`select account_id from public.contacts where workspace_id = ${a.ws} and full_name = 'legacy mismatch'`;
    assertEquals(row.account_id, b.account, "the row is not silently reassigned");
    throw new Error("rollback test transaction");
  }).catch((e) => { if (!String(e).includes("rollback test transaction")) throw e; });
  assertMatch(caught, /OWN-01 preflight: rows reference a parent in another workspace: contacts\.account_id→accounts: 1;/);
  // The real schema is back to the composite key.
  const [d] = await sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'contacts_account_id_fkey'`;
  assertMatch(d.d as string, /^FOREIGN KEY \(workspace_id, account_id\)/);
});
