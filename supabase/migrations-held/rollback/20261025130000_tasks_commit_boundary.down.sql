-- ROLLBACK for 20261025130000_tasks_commit_boundary.sql (held). Removes the
-- trigger and its function; no data is touched. EXEC-PLAN and EXEC-REVOKE are
-- open again at the database (the pre-effect guard still checks at entry).
drop trigger if exists tasks_commit_boundary on public.tasks;
drop function if exists public.tasks_commit_boundary();
