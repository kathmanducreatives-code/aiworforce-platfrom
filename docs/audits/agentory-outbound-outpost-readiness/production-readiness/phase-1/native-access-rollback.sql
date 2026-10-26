-- HELD. Empty-unused pilot only; disable API entry points first. No hosted approval.
begin;
set local lock_timeout='2s';
lock table public.tasks, public.company_brain in access exclusive mode;
lock table outpost_private.clients,outpost_private.task_bindings in access exclusive mode;
do $$ begin
  if exists(select 1 from outpost_private.clients) or exists(select 1 from outpost_private.task_bindings)
    then raise exception 'nonempty pilot: keep security guards and audit history' using errcode='42501'; end if;
end $$;
drop trigger outpost_enrolled_brain_frozen on public.company_brain;
drop policy outpost_enrolled_brain_read on public.company_brain;
drop policy outpost_bound_task_read on public.tasks;
drop policy outpost_bound_task_insert on public.tasks;
drop policy outpost_bound_task_update on public.tasks;
drop policy outpost_bound_task_delete on public.tasks;
drop function public.outpost_pilot_access(uuid,uuid,integer,uuid);
drop function outpost_private.public_task_read(uuid);
drop function outpost_private.public_task_write(uuid,jsonb);
drop function outpost_private.public_brain_read(uuid);
drop function outpost_private.freeze_enrolled_brain();
drop function outpost_private.api_access(uuid,uuid,integer,uuid);
commit;
