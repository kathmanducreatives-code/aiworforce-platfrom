-- REVIEW ONLY. NOT APPLIED. Only for an approved, empty, unused scaffold.
-- If any record exists, fail and use the approved backup/reconciliation procedure.
begin;
lock table outpost_private.artifact_events, outpost_private.operations,
  outpost_private.briefs, outpost_private.snapshots, outpost_private.task_bindings,
  outpost_private.clients in access exclusive mode;
do $$
begin
  if exists(select 1 from outpost_private.artifact_events)
    or exists(select 1 from outpost_private.operations)
    or exists(select 1 from outpost_private.briefs)
    or exists(select 1 from outpost_private.snapshots)
    or exists(select 1 from outpost_private.task_bindings)
    or exists(select 1 from outpost_private.clients)
  then raise exception 'refuse rollback of nonempty pilot history'; end if;
end;
$$;
drop table outpost_private.artifact_events;
drop table outpost_private.operations;
drop table outpost_private.briefs;
drop table outpost_private.snapshots;
drop table outpost_private.task_bindings;
drop table outpost_private.clients;
drop function outpost_private.deny_mutation();
drop schema outpost_private; -- No CASCADE: unexpected dependencies must refuse.
commit;
