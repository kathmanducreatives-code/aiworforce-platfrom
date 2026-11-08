// HELD (not applied): one lead_pipeline lead per company, written in one transaction.
// supabase/migrations-held/20261108120000_lead_pipeline_one_lead_per_company.sql, run
// verbatim against real Postgres (PGlite, in-process, nothing reachable).

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));
const NAME = "20261108120000_lead_pipeline_one_lead_per_company";
const UP = read(`supabase/migrations-held/${NAME}.sql`);
const DOWN = read(`supabase/migrations-held/rollback/${NAME}.down.sql`);

// The three tables as the baseline defines them (columns the function touches, the real unique keys).
const PRELUDE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table public.accounts (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, name text not null, domain text,
    website_url text, linkedin_url text, location text, industry text, stage text, employee_count text, description text, source text,
    raw jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint accounts_workspace_name_key unique (workspace_id, name));
  create table public.contacts (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, account_id uuid, full_name text, title text,
    headline text, company text, location text, linkedin_url text, email text, phone text, source text, raw jsonb not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint contacts_workspace_linkedin_key unique (workspace_id, linkedin_url));
  create table public.lead_candidates (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, conversation_id uuid, plan_id uuid,
    account_id uuid, contact_id uuid, signal_id uuid, lead_type text, status text not null default 'new', fit_score numeric, priority text, reason text,
    next_action text, raw jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), evidence_id uuid);
`;
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";

const account = (name: string, domain: string | null, ws = WS) => ({ workspace_id: ws, name, domain, website_url: domain ? `https://${domain}` : null, linkedin_url: null, location: "Austin, US", industry: null, employee_count: null, source: "lead_pipeline:apify", raw: { agentory_pipeline: { run: 1 } } });
const lead = (run: number, ws = WS) => ({ workspace_id: ws, lead_type: "lead_pipeline", status: "qualified", fit_score: 70, priority: null, reason: "Eligible", next_action: null, raw: { agentory_pipeline: { run } } });
const contact = (li: string | null) => ({ workspace_id: WS, full_name: "Nia North", title: "CEO", linkedin_url: li, company: "Northwind", location: null, email: null, phone: null, source: "lead_pipeline:leadocean", raw: { agentory_pipeline: { p: 1 } } });

async function open(pre = "") {
  const db = new PGlite();
  await db.exec(PRELUDE);
  if (pre) await db.exec(pre);
  await db.exec(UP);
  const persist = async (a: unknown, c: unknown, l: unknown, existing: string | null = null) =>
    (await db.query<{ r: { account_id: string; contact_id: string | null; lead_id: string; created: boolean } }>(
      `select public.lead_pipeline_persist_lead($1, $2::jsonb, $3::jsonb, $4::jsonb, $5) as r`, [WS, JSON.stringify(a), JSON.stringify(c), JSON.stringify(l), existing])).rows[0].r;
  const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
  return { db, persist, count };
}

Deno.test("one company, two runs → one account, one lead (updated in place, attribution replaced)", async () => {
  const { db, persist, count } = await open();
  const a = await persist(account("Northwind", "northwind.example"), null, lead(1));
  const b = await persist(account("Northwind", "northwind.example"), null, lead(2));
  assertEquals([a.created, b.created], [true, false]);
  assertEquals([a.account_id, a.lead_id], [b.account_id, b.lead_id]);
  assertEquals([await count("accounts"), await count("lead_candidates")], [1, 1]);
  const raw = (await db.query<{ raw: { agentory_pipeline: { run: number } } }>(`select raw from public.lead_candidates`)).rows[0].raw;
  assertEquals(raw.agentory_pipeline.run, 2);
});

Deno.test("the name is not an identity: a same-named company with another domain gets its own account", async () => {
  const { persist, count, db } = await open();
  const a = await persist(account("Acme", "acme.io"), null, lead(1));
  const b = await persist(account("Acme", "acme-industrial.example"), null, lead(1));
  assert(a.account_id !== b.account_id);
  assertEquals(await count("lead_candidates"), 2);
  const names = (await db.query<{ name: string }>(`select name from public.accounts order by name`)).rows.map((r) => r.name);
  assertEquals(names, ["Acme", "Acme (acme-industrial.example)"]);
  // A same-named account with NO domain is the same company: it gains the domain.
  const { persist: p2, db: d2 } = await open();
  await d2.query(`insert into public.accounts (workspace_id, name) values ($1, 'Harbor')`, [WS]);
  const h = await p2(account("Harbor", "harbor.example"), null, lead(1));
  assertEquals((await d2.query<{ domain: string }>(`select domain from public.accounts where id = $1`, [h.account_id])).rows[0].domain, "harbor.example");
});

Deno.test("a person seen before is reused, not a unique-violation after the spend", async () => {
  const { persist, count } = await open();
  const li = "https://www.linkedin.com/in/nia-north";
  await persist(account("Northwind", "northwind.example"), contact(li), lead(1));
  const again = await persist(account("Northwind", "northwind.example"), contact(li), lead(2));
  assert(again.contact_id);
  assertEquals([await count("contacts"), await count("lead_candidates")], [1, 1]);
});

Deno.test("an existing Lead keeps its id and status; a cross-workspace row is refused; one failure writes nothing", async () => {
  const { db, persist } = await open();
  const first = await persist(account("Northwind", "northwind.example"), null, lead(1));
  await db.query(`update public.lead_candidates set status = 'contacted' where id = $1`, [first.lead_id]);
  const kept = await persist(account("Northwind", "northwind.example"), null, lead(3), first.lead_id);
  assertEquals(kept.lead_id, first.lead_id);
  assertEquals((await db.query<{ status: string }>(`select status from public.lead_candidates where id = $1`, [first.lead_id])).rows[0].status, "contacted");
  await assertRejects(() => persist(account("Northwind", "northwind.example", OTHER), null, lead(1)), Error, "same workspace");
  // ONE TRANSACTION: a lead row that cannot be written leaves no account behind.
  const before = (await db.query<{ n: number }>(`select count(*)::int as n from public.accounts`)).rows[0].n;
  await assertRejects(() => persist(account("Brand New", "brandnew.example"), null, { ...lead(1), fit_score: "not a number" }));
  assertEquals((await db.query<{ n: number }>(`select count(*)::int as n from public.accounts`)).rows[0].n, before, "the account insert rolled back with the failed lead");
});

Deno.test("the migration refuses — and changes nothing — when duplicates already exist; rollback is clean", async () => {
  const dup = `insert into public.lead_candidates (workspace_id, account_id, lead_type) values
    ('${WS}', '44444444-4444-4444-8444-444444444444', 'lead_pipeline'), ('${WS}', '44444444-4444-4444-8444-444444444444', 'lead_pipeline');`;
  const db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(dup);
  await assertRejects(() => db.exec(UP), Error, "resolve them first");
  const idx = (await db.query<{ n: number }>(`select count(*)::int as n from pg_indexes where indexname = 'lead_candidates_pipeline_account_uniq'`)).rows[0].n;
  assertEquals(idx, 0);
  const { db: ok } = await open();
  await ok.exec(DOWN);
  assertEquals((await ok.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'lead_pipeline_persist_lead'`)).rows[0].n, 0);
});

Deno.test("the read-only preflight names the duplicate pairs the migration would refuse on, and says OK on a clean project", async () => {
  const PRE = read("scripts/test-project/lead-pipeline-one-lead-preflight.sql");
  const rows = async (db: PGlite) => (await db.exec(PRE)).flatMap((r) => r.rows as Record<string, unknown>[]).map((r) => Object.values(r).join(" "));
  const clean = new PGlite();
  await clean.exec(PRELUDE);
  assertEquals((await rows(clean))[0], "OK 0 duplicate pairs");
  const dirty = new PGlite();
  await dirty.exec(PRELUDE);
  await dirty.exec(`insert into public.lead_candidates (workspace_id, account_id, lead_type) values
    ('${WS}', '44444444-4444-4444-8444-444444444444', 'lead_pipeline'), ('${WS}', '44444444-4444-4444-8444-444444444444', 'lead_pipeline'),
    ('${WS}', '55555555-5555-4555-8555-555555555555', 'lead_pipeline'), ('${WS}', '55555555-5555-4555-8555-555555555555', 'other');`);
  const out = await rows(dirty);
  assertEquals(out[0], "DUPLICATES 1 duplicate pairs");
  assert(out.some((l) => l.startsWith("PAIR 2 ") && l.includes("44444444-4444-4444-8444-444444444444")));
  // It is read-only: the data is unchanged and the migration still refuses on it.
  assertEquals((await dirty.query<{ n: number }>(`select count(*)::int as n from public.lead_candidates`)).rows[0].n, 4);
  await assertRejects(() => dirty.exec(UP), Error, "resolve them first");
});
