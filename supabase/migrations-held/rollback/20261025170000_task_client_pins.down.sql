-- Rollback of 20261025170000_task_client_pins.sql. Refuses if any task is pinned:
-- dropping the columns would silently turn a client task into an agency task.
do $$ begin
  if exists (select 1 from public.tasks where client_id is not null) then
    raise exception 'task_client_pins rollback: pinned tasks exist; resolve them first' using errcode = '55000';
  end if;
end $$;
drop trigger if exists tasks_pins_at_commit on public.tasks;
drop function if exists public.tasks_client_pins();
alter table public.tasks
  drop constraint if exists tasks_client_grant_of_task_user,
  drop constraint if exists tasks_client_in_workspace,
  drop constraint if exists tasks_client_pins_all_or_none,
  drop column if exists origin_session_id,
  drop column if exists permission_revision,
  drop column if exists client_grant_generation,
  drop column if exists client_grant_id,
  drop column if exists client_id;
