-- Optional READ-ONLY owner receipt. No customer rows, tokens or secrets.
-- NOT executed against any hosted project by this PR. Catalog evidence alone
-- does not replace local attack/provisioning tests or prove application deployment.
begin read only;
select schemaname,tablename,policyname,cmd,roles,qual,with_check
from pg_policies where schemaname='public'
  and tablename in ('workspaces','workspace_members') order by tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('workspaces','workspace_members')
  and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('workspaces','workspace_members');
select p.proname,p.prosecdef,r.rolname owner,md5(p.prosrc) source_md5,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('provision_workspace_for_user','increment_tokens');
select tgname,tgenabled from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;
rollback;
