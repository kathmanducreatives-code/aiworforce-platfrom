-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Needs explicit approval, after #176 (client
-- accounts), #177 (OWN-01) and the #174 contract, before it is applied to any
-- hosted project. Client-scoped execution stays refused at every entry until the
-- owner enables client Brains; no client-scoped lead row is written before then.
-- See supabase/migrations-held/README.md.
--
-- ── SAME-CLIENT DESCENDANTS (contract #174 §9.5 + Codex's parent-client rule) ─
--
-- #177 made every lead-graph parent reference (workspace_id, <col>) → parent
-- (workspace_id, id). Codex (#174): adding (workspace_id, client_id) →
-- client_accounts to each row independently does NOT bind parent and child to
-- the same client — contact(client A) → account(client B) in one workspace
-- passes both. This migration binds the parent's CLIENT identity too, with an
-- explicit null policy:
--
--   * every lead-graph row gets `client_id` (null = the agency's own work) with
--     a composite key (workspace_id, client_id) → client_accounts (workspace_id,
--     id), and `client_scope`, which is client_id or, for agency rows, a fixed
--     sentinel — kept equal by a check and filled by a trigger, so writers never
--     set it. A PLAIN column on purpose: PostgreSQL refuses ON DELETE SET NULL
--     (col) on a key containing a generated column.
--   * every parent is addressable by (workspace_id, client_scope, id);
--   * each of #177's 26 references, and signal_event_evidence → signal_events,
--     becomes (workspace_id, client_scope, <col>) → parent (workspace_id,
--     client_scope, id) under its own name, with its delete behaviour kept
--     (SET NULL (<col>) / CASCADE).
--
-- Result, for every writer: a child references only a parent of the SAME client
-- in the same workspace; an agency row only an agency parent (null never
-- matches a client, and a client never matches null); stripping or changing a
-- referencing child's client, or changing a referenced parent's client, is
-- refused (23503). Nothing is reassigned: existing rows are all agency rows
-- (client_id is new), so they already satisfy the rule.
--
-- NOT in this migration (decisions/changes still open, recorded on #174):
--   * client-scoped uniqueness and dedup keys (accounts (workspace_id, name),
--     contacts linkedin_url, *_dedupe_key, lead_candidates company scope). The
--     current writers upsert on those exact keys (on_conflict); changing them
--     must ship together with those writers, before client Brains are enabled.
--   * browser read isolation of client-scoped lead rows (a permission decision).
--
-- Rollback: rollback/20261025180000_lead_graph_same_client_parents.down.sql

create or replace function public.lead_graph_client_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.client_scope := coalesce(new.client_id, '00000000-0000-0000-0000-000000000000'::uuid);
  return new;
end;
$$;
revoke all on function public.lead_graph_client_scope() from public, anon, authenticated, service_role;

do $own02$
declare
  t text;
  r record;
  v_name text;
  v_on_delete text;
  v_tables text[] := array['accounts', 'contacts', 'lead_candidates', 'lead_evidence', 'signals', 'engagement_events',
    'lead_enrichments', 'outreach_drafts', 'signal_events', 'signal_reviews', 'signal_event_evidence'];
  v_refs jsonb := '[
    ["contacts",              "account_id",         "accounts"],
    ["engagement_events",     "account_id",         "accounts"],
    ["lead_candidates",       "account_id",         "accounts"],
    ["lead_enrichments",      "account_id",         "accounts"],
    ["lead_evidence",         "account_id",         "accounts"],
    ["outreach_drafts",       "account_id",         "accounts"],
    ["signal_events",         "account_id",         "accounts"],
    ["engagement_events",     "contact_id",         "contacts"],
    ["lead_candidates",       "contact_id",         "contacts"],
    ["lead_enrichments",      "contact_id",         "contacts"],
    ["lead_evidence",         "contact_id",         "contacts"],
    ["outreach_drafts",       "contact_id",         "contacts"],
    ["signal_events",         "contact_id",         "contacts"],
    ["engagement_events",     "lead_candidate_id",  "lead_candidates"],
    ["lead_enrichments",      "lead_candidate_id",  "lead_candidates"],
    ["lead_evidence",         "lead_candidate_id",  "lead_candidates"],
    ["outreach_drafts",       "lead_candidate_id",  "lead_candidates"],
    ["signal_events",         "lead_candidate_id",  "lead_candidates"],
    ["signal_reviews",        "lead_candidate_id",  "lead_candidates"],
    ["lead_candidates",       "evidence_id",        "lead_evidence"],
    ["engagement_events",     "legacy_signal_id",   "signals"],
    ["lead_candidates",       "signal_id",          "signals"],
    ["lead_evidence",         "legacy_signal_id",   "signals"],
    ["signal_event_evidence", "legacy_signal_id",   "signals"],
    ["signal_events",         "legacy_signal_id",   "signals"],
    ["signal_reviews",        "signal_id",          "signals"],
    ["signal_event_evidence", "signal_event_id",    "signal_events"]
  ]'::jsonb;
begin
  -- 1. Client identity on every lead-graph row (agency by default).
  foreach t in array v_tables loop
    execute format('alter table public.%I add column client_id uuid, '
      'add column client_scope uuid not null default ''00000000-0000-0000-0000-000000000000''', t);
    execute format('alter table public.%I add constraint %I check (client_scope = coalesce(client_id, '
      '''00000000-0000-0000-0000-000000000000''::uuid))', t, t || '_client_scope_matches');
    execute format('alter table public.%I add constraint %I foreign key (workspace_id, client_id) '
      'references public.client_accounts (workspace_id, id)', t, t || '_client_in_workspace');
    execute format('create trigger %I before insert or update of client_id, client_scope on public.%I '
      'for each row execute function public.lead_graph_client_scope()', t || '_client_scope', t);
  end loop;

  -- 2. Every parent is addressable by (workspace_id, client_scope, id).
  for r in select distinct x->>2 as parent from jsonb_array_elements(v_refs) x loop
    execute format('alter table public.%I add constraint %I unique (workspace_id, client_scope, id)',
      r.parent, r.parent || '_workspace_client_id_key');
  end loop;

  -- 3. Each existing composite reference becomes client-bound, under its own name.
  for r in select x->>0 as child, x->>1 as col, x->>2 as parent from jsonb_array_elements(v_refs) x loop
    -- The delete action exactly as #177 left it (SET NULL (<col>) or CASCADE).
    select c.conname, case c.confdeltype
             when 'n' then case when c.confdelsetcols is null then 'set null' else format('set null (%I)', r.col) end
             when 'c' then 'cascade' end
      into v_name, v_on_delete
      from pg_constraint c
     where c.conrelid = format('public.%I', r.child)::regclass
       and c.confrelid = format('public.%I', r.parent)::regclass
       and c.contype = 'f'
       and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = (select array_agg(x order by x) from unnest(array['workspace_id', r.col]) x);
    if v_name is null or v_on_delete is null then
      raise exception 'same-client parents: no (workspace_id, %) key %.% → % (apply #177 first; nothing was changed)', r.col, r.child, r.col, r.parent;
    end if;
    execute format('alter table public.%I drop constraint %I', r.child, v_name);
    execute format('alter table public.%I add constraint %I foreign key (workspace_id, client_scope, %I) '
      'references public.%I (workspace_id, client_scope, id) on delete %s', r.child, v_name, r.col, r.parent, v_on_delete);
    v_name := null;
    v_on_delete := null;
  end loop;
end
$own02$;

-- PostgREST: the relationship set changed shape (same names, one more column).
notify pgrst, 'reload schema';
