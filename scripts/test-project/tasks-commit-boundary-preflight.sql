-- TASK COMMIT BOUNDARY PREFLIGHT (read-only). Run before applying
-- supabase/migrations-held/20261025130000_tasks_commit_boundary.sql:
--   psql "$DB_URL" -X -At -F ' ' -f scripts/test-project/tasks-commit-boundary-preflight.sql
-- BLOCK lines must be resolved first; INFO lines are recorded with the approval.
-- Clean project: "OK" as the last line.
--   BLOCK missing <object>          a column or table the trigger reads is absent
--   BLOCK trigger already present   the migration was applied (or a same-named trigger exists)
--   BLOCK recent principal-less <n> tasks written in the last 7 days with a workspace and no
--                                   user_id: such a write is refused once the trigger exists
--   INFO  foreign-plan tasks <n>    existing tasks whose plan is missing or in another workspace
--                                   (EXEC-PLAN residue; untouched unless their plan is changed)
--   INFO  live tasks of non-members <n>  non-terminal tasks whose principal is no longer a member;
--                                   they keep settling (status/result writes do not fire it)
begin transaction read only;
with need(tbl, col) as (values
  ('tasks', 'workspace_id'), ('tasks', 'user_id'), ('tasks', 'plan_id'), ('tasks', 'task_plan_id'),
  ('tasks', 'status'), ('tasks', 'created_at'), ('task_plans', 'id'), ('task_plans', 'workspace_id'),
  ('workspace_members', 'workspace_id'), ('workspace_members', 'user_id')
), missing as (
  select 'BLOCK missing public.' || n.tbl || '.' || n.col as line from need n
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = n.tbl and c.column_name = n.col)
)
select line from missing
union all
select 'BLOCK trigger already present' where exists (
  select 1 from pg_trigger t where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_commit_boundary')
order by 1;

-- The remaining checks need the columns above; run them only when none is missing.
select case when count(*) = 10 then 'columns present' else 'columns missing: stop here' end
  from information_schema.columns
 where table_schema = 'public' and (table_name, column_name) in (
   ('tasks', 'workspace_id'), ('tasks', 'user_id'), ('tasks', 'plan_id'), ('tasks', 'task_plan_id'),
   ('tasks', 'status'), ('tasks', 'created_at'), ('task_plans', 'id'), ('task_plans', 'workspace_id'),
   ('workspace_members', 'workspace_id'), ('workspace_members', 'user_id'));

with recent_null as (
  select count(*) n from public.tasks t
   where t.workspace_id is not null and t.user_id is null and t.created_at > now() - interval '7 days'
), foreign_plan as (
  select count(*) n from public.tasks t
   where exists (select 1 from unnest(array[t.plan_id, t.task_plan_id]) as p(id)
                  where p.id is not null and not exists (
                    select 1 from public.task_plans tp where tp.id = p.id and tp.workspace_id is not distinct from t.workspace_id))
), live_nonmember as (
  select count(*) n from public.tasks t
   where t.workspace_id is not null and t.status not in ('complete', 'completed', 'failed', 'cancelled', 'blocked')
     and not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id)
)
select 'BLOCK recent principal-less ' || n from recent_null where n > 0
union all select 'INFO  foreign-plan tasks ' || n from foreign_plan
union all select 'INFO  live tasks of non-members ' || n from live_nonmember
union all select 'OK' where (select n from recent_null) = 0 and not exists (
  select 1 from pg_trigger t where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_commit_boundary');
rollback;
