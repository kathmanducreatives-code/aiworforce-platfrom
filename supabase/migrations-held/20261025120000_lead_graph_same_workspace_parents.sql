-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Security change to shared lead tables:
-- needs explicit approval before it is applied to any hosted project, and the
-- read-only preflight (scripts/test-project/own01-parent-preflight.sql) must
-- list zero mismatched rows first. See supabase/migrations-held/README.md.
--
-- Requires PostgreSQL 15+ (`ON DELETE SET NULL (column)`); hosted is 17.
--
-- ── THE DEFECT (OWN-01) ─────────────────────────────────────────────────────
--
-- Every parent reference in the lead graph was an ID-only foreign key, e.g.
-- `contacts.account_id → accounts.id`, and the child's INSERT/UPDATE policy
-- checks only the CHILD's workspace. A member of workspace A who cannot read
-- account B (RLS answers 200 []) could still INSERT a contact
-- `{workspace_id: A, account_id: B}`: 201, and the mismatched parent was
-- stored (native reproduction: #173, OWN-01). The service role and any other
-- writer could store the same mismatch: nothing in the database refused it.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- Each reference becomes a COMPOSITE foreign key on (workspace_id, <col>) →
-- parent (workspace_id, id). A child can only point at a parent in its own
-- workspace, whoever writes it (browser, service role, worker, SQL), on
-- INSERT and on UPDATE of either column. A foreign and a non-existent parent
-- are refused with the same error (23503), so the refusal discloses nothing.
--
-- Preserved, exactly:
--   * an optional parent stays optional (MATCH SIMPLE: a NULL <col> is not
--     checked);
--   * delete behaviour: `SET NULL` references null ONLY the parent column
--     (`SET NULL (<col>)`; nulling `workspace_id` would violate NOT NULL), and
--     `CASCADE` references still cascade;
--   * the constraint NAME, so PostgREST still sees exactly one relationship
--     per pair and existing embeds (`accounts(...)`, `accounts!inner`) and
--     hints keep working.
-- A parent row can no longer move to another workspace while children point
-- at it (ON UPDATE NO ACTION), which is the same invariant from the other side.
--
-- NOT repaired silently: the migration first counts mismatched rows for every
-- reference and ABORTS (rolling back everything) if any exist. Resolve them
-- by hand, from the preflight's listing, before applying.
--
-- Scope: the Lead Discovery graph (accounts, contacts, lead_candidates,
-- lead_evidence, signals and their descendants). Client ownership is added
-- the same way once the canonical client contract (#174) lands: client_id on
-- these rows referencing client_accounts (workspace_id, id).
--
-- Rollback: rollback/20261025120000_lead_graph_same_workspace_parents.down.sql

do $own01$
declare
  r record;
  v_refs jsonb;
  v_bad bigint;
  v_report text := '';
  v_name text;
  v_child_att smallint;
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'OWN-01 needs PostgreSQL 15+ for ON DELETE SET NULL (column)';
  end if;

  -- The 26 references, as data: no table is created (a temporary table would
  -- be one more relation for RLS audits to explain).
  v_refs := '[
    ["contacts",              "account_id",         "accounts",         "set null"],
    ["engagement_events",     "account_id",         "accounts",         "set null"],
    ["lead_candidates",       "account_id",         "accounts",         "set null"],
    ["lead_enrichments",      "account_id",         "accounts",         "set null"],
    ["lead_evidence",         "account_id",         "accounts",         "set null"],
    ["outreach_drafts",       "account_id",         "accounts",         "set null"],
    ["signal_events",         "account_id",         "accounts",         "set null"],
    ["engagement_events",     "contact_id",         "contacts",         "set null"],
    ["lead_candidates",       "contact_id",         "contacts",         "set null"],
    ["lead_enrichments",      "contact_id",         "contacts",         "set null"],
    ["lead_evidence",         "contact_id",         "contacts",         "set null"],
    ["outreach_drafts",       "contact_id",         "contacts",         "set null"],
    ["signal_events",         "contact_id",         "contacts",         "set null"],
    ["engagement_events",     "lead_candidate_id",  "lead_candidates",  "set null"],
    ["lead_enrichments",      "lead_candidate_id",  "lead_candidates",  "set null"],
    ["lead_evidence",         "lead_candidate_id",  "lead_candidates",  "set null"],
    ["outreach_drafts",       "lead_candidate_id",  "lead_candidates",  "set null"],
    ["signal_events",         "lead_candidate_id",  "lead_candidates",  "set null"],
    ["signal_reviews",        "lead_candidate_id",  "lead_candidates",  "cascade"],
    ["lead_candidates",       "evidence_id",        "lead_evidence",    "set null"],
    ["engagement_events",     "legacy_signal_id",   "signals",          "set null"],
    ["lead_candidates",       "signal_id",          "signals",          "set null"],
    ["lead_evidence",         "legacy_signal_id",   "signals",          "set null"],
    ["signal_event_evidence", "legacy_signal_id",   "signals",          "set null"],
    ["signal_events",         "legacy_signal_id",   "signals",          "set null"],
    ["signal_reviews",        "signal_id",          "signals",          "cascade"]
  ]'::jsonb;

  -- 1. PREFLIGHT. Abort on any existing mismatch: never reassign a parent.
  for r in select x->>0 as child, x->>1 as col, x->>2 as parent, x->>3 as on_delete from jsonb_array_elements(v_refs) x loop
    execute format(
      'select count(*) from public.%I c join public.%I p on p.id = c.%I where c.workspace_id is distinct from p.workspace_id',
      r.child, r.parent, r.col) into v_bad;
    if v_bad > 0 then
      v_report := v_report || format(' %s.%s→%s: %s;', r.child, r.col, r.parent, v_bad);
    end if;
  end loop;
  if v_report <> '' then
    raise exception 'OWN-01 preflight: rows reference a parent in another workspace:%  Resolve them (scripts/test-project/own01-parent-preflight.sql); nothing was changed.', v_report;
  end if;

  -- 2. Every parent is addressable by (workspace_id, id).
  for r in select distinct x->>2 as parent from jsonb_array_elements(v_refs) x loop
    if not exists (select 1 from pg_constraint
                   where conrelid = format('public.%I', r.parent)::regclass
                     and conname = r.parent || '_workspace_id_id_key') then
      execute format('alter table public.%I add constraint %I unique (workspace_id, id)',
        r.parent, r.parent || '_workspace_id_id_key');
    end if;
  end loop;

  -- 3. Replace each ID-only reference with the composite one, under its own name.
  for r in select x->>0 as child, x->>1 as col, x->>2 as parent, x->>3 as on_delete from jsonb_array_elements(v_refs) x loop
    select attnum into v_child_att from pg_attribute
      where attrelid = format('public.%I', r.child)::regclass and attname = r.col and not attisdropped;
    select conname into v_name from pg_constraint
      where conrelid = format('public.%I', r.child)::regclass
        and confrelid = format('public.%I', r.parent)::regclass
        and contype = 'f' and conkey = array[v_child_att];
    if v_name is null then
      raise exception 'OWN-01: no ID-only foreign key %.% → % (schema drift; nothing was changed)', r.child, r.col, r.parent;
    end if;
    execute format('alter table public.%I drop constraint %I', r.child, v_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (workspace_id, %I) references public.%I (workspace_id, id) on delete %s',
      r.child, v_name, r.col, r.parent,
      case r.on_delete when 'set null' then format('set null (%I)', r.col) else 'cascade' end);
    v_name := null;
  end loop;
end
$own01$;

-- PostgREST: the relationship set changed shape (same names, composite columns).
notify pgrst, 'reload schema';
