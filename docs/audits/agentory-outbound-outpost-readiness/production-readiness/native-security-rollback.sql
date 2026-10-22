-- HELD rollback; only empty unused identity metadata, after stopping pilot entry points.
-- Never apply to hosted data without approval. Tested only in disposable databases.
begin;
set local lock_timeout='2s';
lock table public.tasks in access exclusive mode;
lock table outpost_private.clients, outpost_private.task_bindings in access exclusive mode;
do $$ begin
  if exists(select 1 from outpost_private.clients) or exists(select 1 from outpost_private.task_bindings)
  then raise exception 'nonempty pilot identity; reconcile and retain audit data' using errcode='42501'; end if;
end $$;
drop trigger outpost_bound_task_owner on public.tasks;
drop table outpost_private.task_bindings;
drop table outpost_private.clients;
drop function outpost_private.keep_bound_task_owner();
drop function outpost_private.capture_task_parent();
drop function outpost_private.refuse_identity_mutation();
drop function outpost_private.task_is_current(uuid,uuid,uuid,uuid,uuid,jsonb);
drop function outpost_private.current_member_session(uuid,uuid,uuid);
drop schema outpost_private;
commit;
