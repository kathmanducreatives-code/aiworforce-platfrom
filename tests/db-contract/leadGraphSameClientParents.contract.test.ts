// SAME-CLIENT DESCENDANTS (held 20261025180000; #174 §9.5 + Codex's parent-
// client rule) against real PostgREST + Postgres, as the service role (the
// worker and edge functions write the lead graph as service).
//
// Codex (#174): (workspace_id, client_id) → client_accounts on every row, plus
// #177's (workspace_id, parent) keys, does NOT bind parent and child to the
// same client. Over ALL 27 lead-graph references this proves that it now does:
// same client and agency→agency commit; client A → client B, agency → client
// and client → agency are refused; stripping a referencing child's client and
// moving a referenced parent to another client are refused. Every refusal is
// judged by what landed. mutation.sh removes the binding.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const SENTINEL = "00000000-0000-0000-0000-000000000000";
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
let svcClient: SupabaseClient | null = null;
async function svc(): Promise<SupabaseClient> {
  if (svcClient) return svcClient;
  const jwt = await mintJwt("service_role");
  svcClient = createClient(REST_URL, jwt, { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
  return svcClient;
}

const EDGES: Array<[string, string, string]> = [
  ["contacts", "account_id", "accounts"], ["engagement_events", "account_id", "accounts"],
  ["lead_candidates", "account_id", "accounts"], ["lead_enrichments", "account_id", "accounts"],
  ["lead_evidence", "account_id", "accounts"], ["outreach_drafts", "account_id", "accounts"],
  ["signal_events", "account_id", "accounts"], ["engagement_events", "contact_id", "contacts"],
  ["lead_candidates", "contact_id", "contacts"], ["lead_enrichments", "contact_id", "contacts"],
  ["lead_evidence", "contact_id", "contacts"], ["outreach_drafts", "contact_id", "contacts"],
  ["signal_events", "contact_id", "contacts"], ["engagement_events", "lead_candidate_id", "lead_candidates"],
  ["lead_enrichments", "lead_candidate_id", "lead_candidates"], ["lead_evidence", "lead_candidate_id", "lead_candidates"],
  ["outreach_drafts", "lead_candidate_id", "lead_candidates"], ["signal_events", "lead_candidate_id", "lead_candidates"],
  ["signal_reviews", "lead_candidate_id", "lead_candidates"], ["lead_candidates", "evidence_id", "lead_evidence"],
  ["engagement_events", "legacy_signal_id", "signals"], ["lead_candidates", "signal_id", "signals"],
  ["lead_evidence", "legacy_signal_id", "signals"], ["signal_event_evidence", "legacy_signal_id", "signals"],
  ["signal_events", "legacy_signal_id", "signals"], ["signal_reviews", "signal_id", "signals"],
  ["signal_event_evidence", "signal_event_id", "signal_events"],
];
const ENTITY = new Set(["account_id", "contact_id", "lead_candidate_id"]);

/** A workspace with two clients (A, B) and, per scope, an anchor account for rows that must name an entity. */
async function world() {
  const ws = await seedWorkspace(), owner = uuid();
  await sql`insert into auth.users (id, email) values (${owner}, ${`sc-${owner.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${owner}, 'owner')`;
  const client = async (name: string) =>
    (await sql`insert into public.client_accounts (workspace_id, name, created_by) values (${ws}, ${name}, ${owner}) returning id`)[0].id as string;
  const A = await client("Client A"), B = await client("Client B");
  const anchor: Record<string, string> = {};
  for (const [k, c] of [["A", A], ["B", B], ["N", null]] as const) {
    anchor[k] = (await sql`insert into public.accounts (workspace_id, client_id, name) values (${ws}, ${c}, ${"anchor " + k + " " + uuid()}) returning id`)[0].id;
  }
  return { ws, owner, A, B, anchor };
}
type W = Awaited<ReturnType<typeof world>>;
const scopeKey = (w: W, c: string | null) => c === w.A ? "A" : c === w.B ? "B" : "N";

/** The smallest valid row of `table` in scope `c`, naming `extra` (the reference under test). */
async function row(w: W, table: string, c: string | null, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const r: Record<string, unknown> = { workspace_id: w.ws, client_id: c, ...extra };
  const anchor = w.anchor[scopeKey(w, c)];
  const hasEntity = Object.keys(extra).some((k) => ENTITY.has(k));
  switch (table) {
    case "accounts": return { ...r, name: `acct ${uuid()}` };
    case "lead_evidence": return { ...r, evidence_kind: "company_identity", dedupe_key: uuid(), ...(hasEntity ? {} : { account_id: anchor }) };
    case "engagement_events": return { ...r, channel: "other", event_type: "linkedin_post_like", occurred_at: new Date().toISOString(),
      dedupe_key: uuid(), ...(hasEntity ? {} : { account_id: anchor }) };
    case "outreach_drafts": return { ...r, body: "synthetic draft" };
    case "signal_events": return { ...r, signal_type: "recent_funding", signal_category: "growth", dedupe_key: uuid(), origin: "lead_mission",
      occurred_at_basis: "unknown",
      ...(hasEntity ? {} : { subject_type: "market", subject_key: "synthetic-market" }) };
    case "signal_reviews": return { ...r, user_id: w.owner };
    case "signal_event_evidence": {
      const event = "signal_event_id" in extra ? {} : { signal_event_id: await insertRow(w, "signal_events", c) };
      return { ...r, evidence_fingerprint: uuid(), source_url: "https://example.test/evidence", ...event };
    }
    default: return r;
  }
}
async function insertRow(w: W, table: string, c: string | null, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await (await svc()).from(table).insert(await row(w, table, c, extra)).select("id").single();
  if (error) throw new Error(`${table} fixture: ${error.message}`);
  return (data as { id: string }).id;
}
const tryInsert = async (w: W, table: string, c: string | null, extra: Record<string, unknown>) =>
  (await (await svc()).from(table).insert(await row(w, table, c, extra)).select("id")).error?.code ?? "ok";

Deno.test("same client across ALL 27 references: A→A and agency→agency commit; A→B, agency→client, client→agency refused", opts, async () => {
  const w = await world();
  const outcomes: string[] = [];
  for (const [child, col, parent] of EDGES) {
    // A fresh parent per case: several references are unique (e.g. legacy_signal_id), which would answer 23505 first.
    const pA = await insertRow(w, parent, w.A), pB = await insertRow(w, parent, w.B), pN = await insertRow(w, parent, null);
    const pN2 = await insertRow(w, parent, null);
    const got = [
      await tryInsert(w, child, w.A, { [col]: pA }),
      await tryInsert(w, child, null, { [col]: pN }),
      await tryInsert(w, child, w.A, { [col]: pB }),
      await tryInsert(w, child, null, { [col]: pB }),
      await tryInsert(w, child, w.A, { [col]: pN2 }),
    ];
    if (JSON.stringify(got) !== JSON.stringify(["ok", "ok", "23503", "23503", "23503"])) outcomes.push(`${child}.${col}→${parent}: ${got.join(",")}`);
  }
  assertEquals(outcomes, [], "every reference binds the parent's client");
});

Deno.test("same client across ALL 27 references: a referencing child cannot drop its client, a referenced parent cannot change client", opts, async () => {
  const w = await world();
  const s = await svc();
  const outcomes: string[] = [];
  for (const [child, col, parent] of EDGES) {
    const pA = await insertRow(w, parent, w.A);
    const c = await insertRow(w, child, w.A, { [col]: pA });
    const strip = (await s.from(child).update({ client_id: null }).eq("id", c).select("id")).error?.code ?? "ok";
    const move = (await s.from(parent).update({ client_id: w.B }).eq("id", pA).select("id")).error?.code ?? "ok";
    const [still] = await sql.unsafe(`select client_id from public.${child} where id = $1`, [c]);
    if (strip !== "23503" || move !== "23503" || still.client_id !== w.A) outcomes.push(`${child}.${col}→${parent}: strip ${strip}, move ${move}`);
  }
  assertEquals(outcomes, [], "no silent re-homing across clients");
});

Deno.test("client scope: derived from client_id (a writer cannot lie about it), and a client of another workspace is refused", opts, async () => {
  const w = await world(), other = await world();
  const s = await svc();
  const lie = await s.from("accounts").insert({ workspace_id: w.ws, client_id: w.A, client_scope: SENTINEL, name: `lie ${uuid()}` })
    .select("client_scope").single();
  assertEquals([lie.error, (lie.data as { client_scope?: string } | null)?.client_scope], [null, w.A], "the trigger derives it");
  const agency = await s.from("contacts").insert({ workspace_id: w.ws }).select("client_scope").single();
  assertEquals((agency.data as { client_scope: string }).client_scope, SENTINEL);
  const foreign = await s.from("accounts").insert({ workspace_id: w.ws, client_id: other.A, name: `foreign ${uuid()}` }).select("id");
  assertEquals(foreign.error?.code, "23503", "a client of another workspace");
});

Deno.test("positive controls: delete behaviour and PostgREST embeds are unchanged inside a client", opts, async () => {
  const w = await world();
  const s = await svc();
  const acct = await insertRow(w, "accounts", w.A);
  const contact = await insertRow(w, "contacts", w.A, { account_id: acct });
  const lead = await insertRow(w, "lead_candidates", w.A, { account_id: acct, contact_id: contact });
  const emb = await s.from("lead_candidates").select("id, accounts(name), contacts(id)").eq("id", lead).single();
  assertEquals(emb.error, null, JSON.stringify(emb.error));
  const review = await insertRow(w, "signal_reviews", w.A, { lead_candidate_id: lead });
  // SET NULL (account_id) inside the client: the child stays, in its client.
  assertEquals((await s.from("accounts").delete().eq("id", acct)).error, null);
  const [c] = await sql`select client_id, account_id from public.contacts where id = ${contact}`;
  assertEquals([c.client_id, c.account_id], [w.A, null]);
  // CASCADE inside the client.
  assertEquals((await s.from("lead_candidates").delete().eq("id", lead)).error, null);
  assertEquals((await sql`select count(*)::int n from public.signal_reviews where id = ${review}`)[0].n, 0);
  assert(true);
});
