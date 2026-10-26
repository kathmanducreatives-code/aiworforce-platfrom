-- Rollback of 20261025180000_lead_graph_same_client_parents.sql: back to #177's
-- (workspace_id, <col>) keys under the same names. Refuses while any lead-graph
-- row belongs to a client — dropping client_id would silently make it agency data.
do $own02_down$
declare
  t text;
  r record;
  v_name text;
  v_on_delete text;
  v_bad bigint;
  v_tables text[] := array['accounts', 'contacts', 'lead_candidates', 'lead_evidence', 'signals', 'engagement_events',
    'lead_enrichments', 'outreach_drafts', 'signal_events', 'signal_reviews', 'signal_event_evidence'];
begin
  foreach t in array v_tables loop
    execute format('select count(*) from public.%I where client_id is not null', t) into v_bad;
    if v_bad > 0 then
      raise exception 'same-client rollback: % has % client-scoped rows; resolve them first (nothing was changed)', t, v_bad;
    end if;
  end loop;
  -- Every client-bound key back to its #177 shape (signal_event_evidence → signal_events
  -- to its original (signal_event_id, workspace_id) → (id, workspace_id) shape).
  for r in
    select c.conrelid::regclass::text as child, c.conname, c.confrelid::regclass::text as parent, c.confdeltype,
           (select a.attname::text from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[3]) as col
      from pg_constraint c
     where c.contype = 'f' and c.conrelid::regclass::text = any(v_tables)
       and array_length(c.conkey, 1) = 3
       and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[2]) = 'client_scope'
  loop
    v_on_delete := case r.confdeltype when 'n' then format('set null (%I)', r.col) else 'cascade' end;
    execute format('alter table public.%I drop constraint %I', r.child, r.conname);
    if r.child = 'signal_event_evidence' and r.col = 'signal_event_id' then
      execute format('alter table public.signal_event_evidence add constraint %I foreign key (signal_event_id, workspace_id) '
        'references public.signal_events (id, workspace_id) on delete cascade', r.conname);
    else
      execute format('alter table public.%I add constraint %I foreign key (workspace_id, %I) references public.%I (workspace_id, id) on delete %s',
        r.child, r.conname, r.col, r.parent, v_on_delete);
    end if;
  end loop;
  foreach t in array array['accounts', 'contacts', 'lead_candidates', 'lead_evidence', 'signals', 'signal_events'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_workspace_client_id_key');
  end loop;
  foreach t in array v_tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_client_scope', t);
    execute format('alter table public.%I drop constraint if exists %I, drop constraint if exists %I, drop column if exists client_scope, drop column if exists client_id',
      t, t || '_client_in_workspace', t || '_client_scope_matches');
  end loop;
end
$own02_down$;
drop function if exists public.lead_graph_client_scope();
notify pgrst, 'reload schema';
