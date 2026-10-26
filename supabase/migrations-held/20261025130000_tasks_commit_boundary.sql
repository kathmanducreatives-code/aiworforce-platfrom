-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Security change to `tasks`: needs explicit
-- approval before it is applied to any hosted project. See
-- supabase/migrations-held/README.md.
--
-- ── THE DEFECTS (Codex, independent integration audit on #179) ─────────────
--
-- EXEC-PLAN   A member of workspace A sent `plan_id` = workspace B's plan and
--             run-agent committed a task {workspace_id: A, plan_id: B}.
--             `tasks.plan_id` has no foreign key at all, and `task_plan_id` an
--             ID-only one: nothing tied a task's plan to its workspace.
-- EXEC-REVOKE The pre-effect guard checked membership at entry; a membership
--             DELETE committed after that check and before the task INSERT,
--             and the task still committed. An entry snapshot is not a
--             commit-time authorization.
--
-- ── THE FIX: the task row is authorized where it is written ─────────────────
--
-- A trigger on `tasks`, for the application roles (service_role,
-- authenticated, anon: every PostgREST writer — run-agent, run-lead-action,
-- orchestrate, continue-workflow, the worker), in the writing transaction:
--   * a task's plan (`plan_id` and `task_plan_id`) must exist IN THE TASK'S
--     WORKSPACE (a missing and a foreign plan are refused alike, 23503);
--   * a new task's principal (`user_id`) must be a CURRENT member of its
--     workspace (42501). The membership row is locked FOR KEY SHARE, so a
--     concurrent membership DELETE either commits first (the task is refused)
--     or waits until the task's transaction ends (the task was authorized at
--     its own commit). The same holds on UPDATE of user_id / workspace_id.
-- Status, result and checkpoint updates do not fire it: work already
-- authorized keeps settling. Migrations and administrative SQL (role
-- postgres) are not application writers and are not checked, the same scoping
-- as #171's lifecycle trigger. A task with no workspace is not checked for a
-- principal (it belongs to no workspace's data).
--
-- Rollback: rollback/20261025130000_tasks_commit_boundary.down.sql

create or replace function public.tasks_commit_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_ws uuid;
  v_plan uuid;
begin
  if coalesce(current_setting('role', true), '') not in ('service_role', 'authenticated', 'anon') then
    return new;
  end if;

  -- 1. Plan parents: both plan columns, on insert or when they (or the workspace) change.
  foreach v_plan in array array[new.plan_id, new.task_plan_id] loop
    continue when v_plan is null;
    continue when tg_op = 'UPDATE'
      and new.workspace_id is not distinct from old.workspace_id
      and v_plan in (old.plan_id, old.task_plan_id);
    select p.workspace_id into v_plan_ws from public.task_plans p where p.id = v_plan for key share;
    if not found or v_plan_ws is distinct from new.workspace_id then
      raise exception 'task plan is not in the task''s workspace' using errcode = '23503';
    end if;
  end loop;

  -- 2. The principal is a current member, checked under the membership row's lock.
  if new.workspace_id is not null and (
       tg_op = 'INSERT'
       or new.user_id is distinct from old.user_id
       or new.workspace_id is distinct from old.workspace_id) then
    if new.user_id is null then
      raise exception 'a task needs a principal' using errcode = '42501';
    end if;
    perform 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = new.user_id
      for key share;
    if not found then
      raise exception 'task principal is not a member of the workspace' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tasks_commit_boundary() from public, anon, authenticated, service_role;

drop trigger if exists tasks_commit_boundary on public.tasks;
create trigger tasks_commit_boundary
  before insert or update of workspace_id, user_id, plan_id, task_plan_id on public.tasks
  for each row execute function public.tasks_commit_boundary();
