-- Rollback of 20261025150000_task_plans_parent_identity.sql.
drop trigger if exists task_plans_parent_identity on public.task_plans;
drop function if exists public.task_plans_parent_identity();
