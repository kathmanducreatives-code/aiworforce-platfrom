-- READ-ONLY preflight for 20261113120000_workforce_v2_security.sql.
-- Prints one line per check: "OK <check>" or "BLOCK <check>". Writes nothing.
select case when to_regclass('public.' || t) is null then 'BLOCK table_missing_' || t else 'OK table_' || t end
  from unnest(array['approvals','signal_events','signal_event_evidence','monitoring_subjects']) t;
select case when to_regprocedure('public.has_workspace_access(uuid,uuid)') is null
  then 'BLOCK has_workspace_access_missing' else 'OK has_workspace_access' end;
-- Informational: what the migration will remove (policy names as live today).
select 'INFO write_policy ' || tablename || ' ' || policyname || ' ' || cmd
  from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
  and tablename in ('approvals','signal_events','signal_event_evidence','monitoring_subjects') order by 1;
-- Informational: the model-spend view (fixed by 20261114120000).
select 'INFO lead_model_calls security_invoker=' || (coalesce(array_to_string(reloptions, ','), '') like '%security_invoker=true%')
  || ' browser_grants=' || (select count(*) from information_schema.role_table_grants where table_schema = 'public'
     and table_name = 'lead_model_calls' and grantee in ('anon', 'authenticated'))
  from pg_class where oid = 'public.lead_model_calls'::regclass;
