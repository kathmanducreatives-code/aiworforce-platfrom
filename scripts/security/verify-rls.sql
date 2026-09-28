-- READ-ONLY RLS / GRANT VERIFICATION. Safe to run against production:
-- it opens a READ ONLY transaction and only reads the catalog.
--
--   scripts/security/verify-rls.sh <database-url>
--
-- Output: one JSON document of checks, each { check, ok, findings[] }.

begin transaction read only;
set local statement_timeout = '30s';

with
-- Functions RLS policies call, and the two the browser calls on purpose. Every
-- other SECURITY DEFINER function must be unreachable for anon/authenticated.
definer_allowlist(name) as (values
  ('has_workspace_access'), ('is_org_member'), ('has_org_role'), ('is_room_member'),
  ('get_user_client_id'), ('get_client_branding'), ('get_room_member_profiles'),
  ('provision_workspace_for_user'), ('handle_new_user')
),
service_only_rpcs(name) as (values
  ('credits_grant'), ('credits_reserve'), ('credits_finalize'), ('credits_release_stale'),
  ('monitoring_spend_in_period'), ('seed_agents_for_workspace'), ('dev_table_counts'),
  ('claim_next_lead_mission'), ('cancel_lead_mission'), ('bind_lead_mission_execution'),
  ('heartbeat_lead_mission'), ('release_lead_mission'), ('renew_lineage_lease'), ('tasks_sweep_stuck_runs')
),
pub_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
ws_tables as (
  select t.relname from pub_tables t
  where exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = t.relname and col.column_name = 'workspace_id')
),
pol as (
  select tablename, policyname, cmd, roles::text[] as roles, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies where schemaname = 'public'
),
fns as (
  select p.oid, p.proname, p.prosecdef,
         has_function_privilege('anon', p.oid, 'execute') as anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),
checks as (
  select 'rls_enabled_on_every_public_table' as check_name,
         coalesce(json_agg(relname order by relname) filter (where not relrowsecurity), '[]'::json) as findings
  from pub_tables
  union all
  select 'no_policy_grants_anon_or_public_unconditional_access',
         coalesce(json_agg(json_build_object('table', tablename, 'policy', policyname, 'cmd', cmd, 'roles', roles)
                  order by tablename, policyname), '[]'::json)
  from pol
  where (roles && array['anon', 'public']::text[])
    and (btrim(qual) in ('true', '(true)') or btrim(with_check) in ('true', '(true)'))
  union all
  select 'no_authenticated_write_policy_with_true_check',
         coalesce(json_agg(json_build_object('table', tablename, 'policy', policyname, 'cmd', cmd)
                  order by tablename, policyname), '[]'::json)
  from pol
  where roles && array['authenticated']::text[] and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (btrim(with_check) in ('true', '(true)') or (cmd <> 'INSERT' and btrim(qual) in ('true', '(true)')))
  union all
  select 'security_definer_functions_not_callable_outside_allowlist',
         coalesce(json_agg(json_build_object('function', proname, 'anon', anon_x, 'authenticated', auth_x) order by proname), '[]'::json)
  from fns
  where prosecdef and (anon_x or auth_x) and proname not in (select name from definer_allowlist)
  union all
  select 'service_only_rpcs_not_callable_by_anon_or_authenticated',
         coalesce(json_agg(json_build_object('function', proname, 'anon', anon_x, 'authenticated', auth_x) order by proname), '[]'::json)
  from fns
  where proname in (select name from service_only_rpcs) and (anon_x or auth_x)
  union all
  select 'workspace_tables_policies_are_membership_scoped',
         coalesce(json_agg(json_build_object('table', tablename, 'policy', policyname, 'cmd', cmd) order by tablename, policyname), '[]'::json)
  from pol
  where tablename in (select relname from ws_tables)
    and roles && array['authenticated', 'anon', 'public']::text[]
    and not (qual || ' ' || with_check ~* '(has_workspace_access|workspace_members|is_org_member|auth\.uid\(\)|auth\.role\(\)|service_role)')
  union all
  select 'anon_has_no_write_grants_on_workspace_tables',
         coalesce(json_agg(json_build_object('table', table_name, 'privilege', privilege_type) order by table_name, privilege_type), '[]'::json)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    and table_name in (select relname from ws_tables)
)
select json_build_object(
  'database', current_database(),
  'checked_at', now(),
  'checks', json_agg(json_build_object('check', check_name, 'ok', json_array_length(findings) = 0, 'findings', findings))
)
from checks;

rollback;
