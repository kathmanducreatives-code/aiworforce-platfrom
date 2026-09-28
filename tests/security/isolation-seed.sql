-- TWO-WORKSPACE ISOLATION SEED — for the throwaway local stack ONLY
-- (scripts/security/isolation-stack.sh). Never run against a real project.
--
-- For EVERY public table with a workspace_id column, one minimal row for
-- workspace A and one for workspace B, so the suite attacks every table rather
-- than a hand-picked list. Required columns get a type-appropriate value; a
-- text column under a CHECK gets the first literal that CHECK allows. Foreign
-- keys and triggers are disabled for the seed (session_replication_role), which
-- is what lets one generic pass seed 49 tables.
--
-- Psql variables: ws_a, ws_b, user_a, user_b (uuids).

set session_replication_role = replica;
select set_config('iso.ws_a', :'ws_a', false), set_config('iso.ws_b', :'ws_b', false),
       set_config('iso.user_a', :'user_a', false), set_config('iso.user_b', :'user_b', false);

create schema if not exists iso_test;
drop table if exists iso_test.seeded;
create table iso_test.seeded (table_name text, workspace_id uuid, pk_column text, pk_value text, error text);

insert into public.workspaces (id, name) values (:'ws_a', 'Isolation A'), (:'ws_b', 'Isolation B')
  on conflict (id) do nothing;
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws_a', :'user_a', 'owner'), (:'ws_b', :'user_b', 'owner')
  on conflict do nothing;

do $$
declare
  t record; c record; ws uuid; usr uuid; cols text; vals text; lit text; pk text; pkval text;
  pairs uuid[][] := array[[current_setting('iso.ws_a')::uuid, current_setting('iso.user_a')::uuid],
                          [current_setting('iso.ws_b')::uuid, current_setting('iso.user_b')::uuid]];
  i int; attempt int;
begin
  for t in
    select tbl.table_name from information_schema.tables tbl
    where tbl.table_schema = 'public' and tbl.table_type = 'BASE TABLE'
      and tbl.table_name not in ('workspace_members')
      and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = tbl.table_name and x.column_name = 'workspace_id')
    order by 1
  loop
    select a.attname into pk from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ix.indkey[0]
      where ix.indrelid = ('public.' || quote_ident(t.table_name))::regclass and ix.indisprimary limit 1;
    execute format('delete from public.%I where workspace_id in (%L, %L)', t.table_name, pairs[1][1], pairs[2][1]);
    for i in 1..2 loop
      ws := pairs[i][1]; usr := pairs[i][2];
     for attempt in 1..2 loop
      cols := 'workspace_id'; vals := quote_literal(ws);
      -- Attempt 1: required columns only. Attempt 2 (after a CHECK such as "one of
      -- these must be present" refused it): every column without a default too.
      for c in
        select col.column_name, col.data_type, col.udt_name from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = t.table_name and col.column_name <> 'workspace_id'
          and ((col.is_nullable = 'NO' and col.column_default is null) or col.column_name in ('user_id', 'created_by')
               or (attempt = 2 and col.column_default is null))
          and col.is_generated = 'NEVER' and col.is_identity = 'NO'
      loop
        lit := null;
        if c.data_type = 'text' then
          select substring(pg_get_constraintdef(k.oid) from '''([^'']*)''') into lit
          from pg_constraint k where k.conrelid = ('public.' || quote_ident(t.table_name))::regclass and k.contype = 'c'
            and pg_get_constraintdef(k.oid) ~ ('\m' || c.column_name || '\M') limit 1;
        end if;
        cols := cols || ', ' || quote_ident(c.column_name);
        vals := vals || ', ' || case
          when c.column_name in ('user_id', 'created_by') and c.udt_name = 'uuid' then quote_literal(usr)
          when c.column_name = 'id' and c.udt_name = 'uuid' then 'gen_random_uuid()'
          when c.udt_name = 'uuid' then 'gen_random_uuid()'
          when c.data_type = 'text' then quote_literal(coalesce(lit, 'iso-' || i || '-' || t.table_name || '-' || c.column_name))
          when c.data_type in ('integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real') then '1'
          when c.udt_name in ('jsonb', 'json') then quote_literal('{}')
          when c.data_type like 'timestamp%' or c.data_type = 'date' then 'now()'
          when c.data_type = 'boolean' then 'false'
          when c.data_type = 'ARRAY' then quote_literal('{}')
          when c.data_type = 'USER-DEFINED' then quote_literal((select e.enumlabel from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = c.udt_name order by e.enumsortorder limit 1)) || '::' || quote_ident(c.udt_name)
          else 'null' end;
      end loop;
      begin
        execute format('insert into public.%I (%s) values (%s) returning %s::text', t.table_name, cols, vals, coalesce(quote_ident(pk), 'null'))
          into pkval;
        insert into iso_test.seeded values (t.table_name, ws, pk, pkval, null);
        exit;
      exception when others then
        if attempt = 2 then insert into iso_test.seeded values (t.table_name, ws, pk, null, sqlerrm); end if;
      end;
     end loop;
    end loop;
  end loop;

  -- Tables whose CHECKs tie several columns together get an explicit valid row.
  for i in 1..2 loop
    ws := pairs[i][1];
    begin
      insert into public.monitoring_subjects (workspace_id, subject_kind, signals) values (ws, 'icp', '["recent_funding"]'::jsonb) returning id::text into pkval;
      delete from iso_test.seeded where table_name = 'monitoring_subjects' and workspace_id = ws;
      insert into iso_test.seeded values ('monitoring_subjects', ws, 'id', pkval, null);
    exception when others then null; end;
    begin
      insert into public.signal_cluster_relevance (workspace_id, deterministic_priority, adjusted_priority, source, cluster_key, relevance)
        values (ws, 1, 1, 'deterministic', 'iso-cluster', 'low') returning cluster_key into pkval;
      delete from iso_test.seeded where table_name = 'signal_cluster_relevance' and workspace_id = ws;
      insert into iso_test.seeded values ('signal_cluster_relevance', ws, 'cluster_key', pkval, null);
    exception when others then null; end;
    begin
      insert into public.signal_events (workspace_id, dedupe_key, origin, signal_type, signal_category, subject_type, subject_key, occurred_at_basis)
        values (ws, 'iso-signal-' || i, 'manual_scan', 'recent_funding', 'growth', 'company', 'iso-co', 'unknown') returning id::text into pkval;
      delete from iso_test.seeded where table_name = 'signal_events' and workspace_id = ws;
      insert into iso_test.seeded values ('signal_events', ws, 'id', pkval, null);
    exception when others then null; end;
  end loop;
end $$;

set session_replication_role = origin;
select json_agg(s) from iso_test.seeded s;
