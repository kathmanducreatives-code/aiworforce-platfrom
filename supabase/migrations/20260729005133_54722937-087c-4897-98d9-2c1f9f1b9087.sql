do $$
declare
  t text;
  workflow_tables constant text[] := array[
    'task_plans',
    'tasks',
    'activity_feed',
    'approvals',
    'tool_calls'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'publication supabase_realtime does not exist';
  end if;

  foreach t in array workflow_tables loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise exception 'table public.% does not exist', t;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice 'public.% is already published; skipping', t;
    else
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added public.% to supabase_realtime', t;
    end if;
  end loop;
end $$;