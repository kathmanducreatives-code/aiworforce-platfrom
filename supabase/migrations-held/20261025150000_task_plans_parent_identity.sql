-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Needs explicit approval before it is
-- applied to any hosted project. Companion of 20261025130000 (#179). See
-- supabase/migrations-held/README.md.
--
-- ── THE DEFECT (Codex PLAN-PARENT, independent follow-up on #185) ─────────────
--
-- 20261025130000 authorizes a task where the TASK is written: its plan must be
-- in its workspace. The parent side was open: a service writer created a valid
-- task in workspace A under plan A, then PATCHed task_plans.workspace_id to B
-- (HTTP 200), leaving a committed task {A} under a plan {B}.
--
-- ── THE FIX: a plan's identity is fixed once it exists ────────────────────────
--
-- For the application roles (service_role, authenticated, anon — every
-- PostgREST writer; the same scoping as 20261025130000 and #171):
--   * a plan's `id` and `workspace_id` cannot change (42501). No application
--     code changes them: every writer updates status / completed_at only. A
--     plan is never moved, so its tasks are never silently re-homed or left
--     under a foreign plan, and there is no window to race;
--   * a plan id that existing tasks of ANOTHER workspace still reference
--     (tasks.plan_id has no foreign key, so it can outlive a deleted plan)
--     cannot be (re)created in this one (23503): re-inserting a deleted plan's
--     id elsewhere would otherwise re-parent those tasks.
-- Status and other updates are unaffected. Migrations and administrative SQL
-- (role postgres) are not application writers and are not checked.
--
-- Rollback: rollback/20261025150000_task_plans_parent_identity.down.sql

create or replace function public.task_plans_parent_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), '') not in ('service_role', 'authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id then
      raise exception 'task_plans: a plan''s id and workspace are fixed once it exists' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Only plan_id can outlive its plan (no foreign key; indexed). task_plan_id's
  -- NO ACTION key already keeps its plan from being deleted.
  if exists (select 1 from public.tasks t
              where t.plan_id = new.id and t.workspace_id is distinct from new.workspace_id) then
    raise exception 'task_plans: tasks of another workspace reference this plan id' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.task_plans_parent_identity() from public, anon, authenticated, service_role;

drop trigger if exists task_plans_parent_identity on public.task_plans;
create trigger task_plans_parent_identity
  before insert or update of id, workspace_id on public.task_plans
  for each row execute function public.task_plans_parent_identity();
