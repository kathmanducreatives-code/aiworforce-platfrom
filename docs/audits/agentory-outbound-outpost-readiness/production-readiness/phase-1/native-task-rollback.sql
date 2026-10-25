-- HELD. Disable entry points first. Empty-unused pilot only; no hosted approval.
begin;
set local lock_timeout='2s';
lock table public.tasks in access exclusive mode;
lock table outpost_private.clients,outpost_private.task_bindings in access exclusive mode;
do $$ begin
  if exists(select 1 from outpost_private.clients) or exists(select 1 from outpost_private.task_bindings)
    then raise exception 'nonempty pilot: retain lifecycle guards and original identity' using errcode='42501'; end if;
end $$;
drop trigger outpost_task_lifecycle on public.tasks;
drop trigger outpost_task_no_truncate on public.tasks;
drop function outpost_private.protect_task_lifecycle();
drop function outpost_private.prevent_task_truncate();
drop function outpost_private.register_verified_task(uuid,uuid,integer,uuid,jsonb);
drop function outpost_private.cancel_verified_task(uuid,uuid,integer,uuid,jsonb);
drop function outpost_private.bind_prepared_task(uuid,uuid,integer,uuid,jsonb,jsonb);
drop function outpost_private.lock_task_security(uuid,uuid,integer,uuid);
commit;
