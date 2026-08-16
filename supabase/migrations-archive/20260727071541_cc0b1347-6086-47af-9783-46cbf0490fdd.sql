alter table public.tasks
  add column if not exists continuation_claim_id uuid,
  add column if not exists continuation_claimed_at timestamptz,
  add column if not exists continuation_claim_expires_at timestamptz,
  add column if not exists checkpoint_version integer not null default 0;

create index if not exists idx_tasks_continuation_claim
  on public.tasks (id, continuation_claim_expires_at)
  where continuation_claim_id is not null;

comment on column public.tasks.continuation_claim_id is
  'Identity of the invocation currently executing a sourcing continuation. NULL when unclaimed.';
comment on column public.tasks.checkpoint_version is
  'Optimistic-lock counter for result->company_first_state. Incremented by every claim.';

create or replace function public.claim_sourcing_continuation(
  p_task_id       uuid,
  p_workspace_id  uuid,
  p_claim_id      uuid,
  p_lease_seconds integer default 300
)
returns table (
  claimed            boolean,
  reason             text,
  task_id            uuid,
  checkpoint_version integer,
  held_by            uuid,
  held_until         timestamptz
)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_row public.tasks%rowtype;
  v_terminal text;
begin
  select * into v_row
    from public.tasks
   where id = p_task_id
     for update;

  if not found then
    return query select false, 'task_not_found'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.result -> 'company_first_state' is null then
    return query select false, 'no_checkpoint'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  v_terminal := coalesce(
    v_row.result ->> 'terminal_status',
    v_row.result -> 'company_first_state' ->> 'terminal_status',
    v_row.result -> 'company_first' ->> 'status'
  );
  if v_terminal is not null and v_terminal <> 'continuation_required' then
    return query select false, 'already_terminal'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.status in ('complete', 'failed', 'skipped') and v_terminal is distinct from 'continuation_required' then
    return query select false, 'already_terminal'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.status is distinct from 'ready'
     and v_row.status not in ('partial', 'running', 'complete') then
    return query select false, 'not_resumable_state'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.continuation_claim_id is not null
     and v_row.continuation_claim_expires_at is not null
     and v_row.continuation_claim_expires_at > now() then
    return query select false, 'already_claimed'::text, p_task_id,
                        v_row.checkpoint_version, v_row.continuation_claim_id, v_row.continuation_claim_expires_at;
    return;
  end if;

  update public.tasks
     set continuation_claim_id         = p_claim_id,
         continuation_claimed_at       = now(),
         continuation_claim_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         checkpoint_version            = public.tasks.checkpoint_version + 1,
         status                        = 'running',
         updated_at                    = now(),
         result                        = coalesce(public.tasks.result, '{}'::jsonb) || jsonb_build_object(
                                           'continuation_claim',
                                           jsonb_build_object(
                                             'claim_id', p_claim_id,
                                             'claimed_at', now(),
                                             'expires_at', now() + make_interval(secs => greatest(p_lease_seconds, 30))
                                           )
                                         )
   where id = p_task_id;

  return query select true, 'claimed'::text, p_task_id,
                      v_row.checkpoint_version + 1, p_claim_id,
                      now() + make_interval(secs => greatest(p_lease_seconds, 30));
end;
$$;

create or replace function public.release_sourcing_continuation(
  p_task_id      uuid,
  p_workspace_id uuid,
  p_claim_id     uuid,
  p_row_status   text default 'ready'
)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_released integer;
begin
  if p_row_status not in ('pending', 'running', 'ready', 'awaiting_approval', 'complete', 'failed', 'skipped') then
    raise exception 'invalid task row status: %', p_row_status;
  end if;

  update public.tasks
     set continuation_claim_id         = null,
         continuation_claimed_at       = null,
         continuation_claim_expires_at = null,
         status                        = p_row_status,
         updated_at                    = now(),
         result                        = coalesce(public.tasks.result, '{}'::jsonb) - 'continuation_claim'
   where id = p_task_id
     and workspace_id = p_workspace_id
     and continuation_claim_id = p_claim_id;

  get diagnostics v_released = row_count;
  return v_released > 0;
end;
$$;

revoke all on function public.claim_sourcing_continuation(uuid, uuid, uuid, integer) from public;
revoke all on function public.release_sourcing_continuation(uuid, uuid, uuid, text) from public;
grant execute on function public.claim_sourcing_continuation(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.release_sourcing_continuation(uuid, uuid, uuid, text) to service_role;