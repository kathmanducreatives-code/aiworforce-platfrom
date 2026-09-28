-- LAUNCH HARDENING — DEFENCE IN DEPTH BEHIND RLS.
--
-- Supabase grants `anon` and `authenticated` ALL privileges on public tables by
-- default and relies on row-level security to refuse what they may not do. RLS
-- does refuse every anon write today (verified by scripts/security/verify-rls.sh
-- and the two-workspace suite): every policy that names `public` is conditioned
-- on auth.uid() or membership, which is null/false for an anonymous caller.
--
-- One regressed policy would change that silently. An anonymous caller has no
-- legitimate write to any WORKSPACE-SCOPED table, so the table grant goes too:
-- then a policy mistake alone cannot open a workspace table to the public key.
--
-- TRUNCATE is not subject to RLS at all. PostgREST cannot issue it, but neither
-- browser role has any use for it, so it is revoked on every public table.

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'workspace_id')
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t.relname);
  end loop;
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
