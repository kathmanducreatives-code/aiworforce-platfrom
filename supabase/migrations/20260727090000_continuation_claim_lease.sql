-- DURABLE CONTINUATION CLAIM — NOT APPLIED. Review before running.
--
-- WHY A MIGRATION IS NECESSARY
--
-- The current claim is a PostgREST conditional update:
--
--     UPDATE public.tasks SET status='running', result=<merged jsonb>
--      WHERE id = :task_id AND status = :observed_status
--   RETURNING id;
--
-- That single statement IS atomic in Postgres — under READ COMMITTED the second
-- writer blocks on the row lock and re-evaluates its WHERE against the new tuple
-- (EvalPlanQual), so it matches zero rows. Two claimants therefore cannot both
-- win *while the predicated column changes between them*.
--
-- It is nevertheless not sufficient, for two reasons that PostgREST cannot fix:
--
--   1. LOST UPDATE ON `result`. The claim, and the checkpoint saver in
--      companyFirstSourcingState.ts, both read `result`, merge in JS, and write
--      the whole document back. PostgREST cannot express `result = result || $1`,
--      so a checkpoint saved between another writer's read and write is silently
--      discarded. The claim predicate does not protect the OTHER writer.
--
--   2. NO DISTINGUISHING VALUE FOR A STALE RECLAIM. When a claimant dies the row
--      is left mid-flight, and the predicate then compares the same value against
--      itself. Two stale reclaimers both match, so both proceed — the documented
--      hole in the current implementation.
--
-- Both are closed by doing the claim inside one transaction with SELECT … FOR
-- UPDATE and merging the jsonb server-side.
--
-- ROLLBACK
--   drop function public.claim_sourcing_continuation(uuid, uuid, uuid, integer);
--   drop function public.release_sourcing_continuation(uuid, uuid, uuid);
--   drop index if exists idx_tasks_continuation_claim;
--   alter table public.tasks
--     drop column if exists continuation_claim_id,
--     drop column if exists continuation_claimed_at,
--     drop column if exists continuation_claim_expires_at,
--     drop column if exists checkpoint_version;
--   All four columns are additive and nullable, so the rollback loses only claim
--   bookkeeping. No sourcing result or checkpoint is stored in them.

-- ---------------------------------------------------------------- columns ----
-- Additive and nullable: existing rows stay valid and existing writers are
-- unaffected. `checkpoint_version` is the optimistic-lock counter for `result`.

alter table public.tasks
  add column if not exists continuation_claim_id uuid,
  add column if not exists continuation_claimed_at timestamptz,
  add column if not exists continuation_claim_expires_at timestamptz,
  add column if not exists checkpoint_version integer not null default 0;

-- Justified: the claim path filters on an unexpired claim for one task. Partial,
-- so it stays tiny — only rows with a live claim are indexed.
create index if not exists idx_tasks_continuation_claim
  on public.tasks (id, continuation_claim_expires_at)
  where continuation_claim_id is not null;

comment on column public.tasks.continuation_claim_id is
  'Identity of the invocation currently executing a sourcing continuation. NULL when unclaimed.';
comment on column public.tasks.checkpoint_version is
  'Optimistic-lock counter for result->company_first_state. Incremented by every claim.';

-- ------------------------------------------------------------------- claim ----
--
-- ONE transaction. `FOR UPDATE` takes the row lock BEFORE any decision is made,
-- so every concurrent caller is serialised and each one sees the previous
-- winner's committed state.
--
-- SECURITY: SECURITY INVOKER (the default) so row-level security still applies,
-- and the workspace is checked explicitly as defence in depth.

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
  -- The lock is taken first. Everything below runs with the row held.
  select * into v_row
    from public.tasks
   where id = p_task_id
     for update;

  if not found then
    return query select false, 'task_not_found'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- TENANT SCOPE. A continuation token from another workspace is refused before
  -- anything is read out of its checkpoint.
  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- A checkpoint must exist.
  if v_row.result -> 'company_first_state' is null then
    return query select false, 'no_checkpoint'::text, p_task_id, null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- TERMINAL TASKS CANNOT BE CLAIMED. Read from the separated result fields,
  -- falling back to the legacy company_first block for rows written before the
  -- status split. Persisted records are read, never rewritten, here.
  v_terminal := coalesce(
    v_row.result ->> 'terminal_status',
    v_row.result -> 'company_first_state' ->> 'terminal_status',
    v_row.result -> 'company_first' ->> 'status'
  );
  if v_terminal is not null and v_terminal <> 'continuation_required' then
    return query select false, 'already_terminal'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
    return;
  end if;

  -- A LIVE claim wins. Because the row is locked, a second caller reaching this
  -- line always sees the first caller's committed claim — including two stale
  -- reclaimers, which is the case the PostgREST version could not separate.
  if v_row.continuation_claim_id is not null
     and v_row.continuation_claim_expires_at is not null
     and v_row.continuation_claim_expires_at > now() then
    return query select false, 'already_claimed'::text, p_task_id,
                        v_row.checkpoint_version, v_row.continuation_claim_id, v_row.continuation_claim_expires_at;
    return;
  end if;

  -- Fresh claim, or an expired lease being reclaimed EXACTLY once.
  update public.tasks
     set continuation_claim_id         = p_claim_id,
         continuation_claimed_at       = now(),
         continuation_claim_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         checkpoint_version            = public.tasks.checkpoint_version + 1,
         status                        = 'running',
         updated_at                    = now()
   where id = p_task_id;

  return query select true, 'claimed'::text, p_task_id,
                      v_row.checkpoint_version + 1, p_claim_id,
                      now() + make_interval(secs => greatest(p_lease_seconds, 30));
end;
$$;

-- ----------------------------------------------------------------- release ----
--
-- Releasing is claim-scoped: a caller may only release the claim it holds, so a
-- late straggler cannot clear the lease of the invocation that superseded it.
-- `p_row_status` carries the DATABASE execution state only; sourcing outcomes
-- live in `result` and are written separately by the caller.

create or replace function public.release_sourcing_continuation(
  p_task_id      uuid,
  p_workspace_id uuid,
  p_claim_id     uuid,
  p_row_status   text default 'complete'
)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_released integer;
begin
  if p_row_status not in ('pending', 'running', 'complete', 'failed', 'skipped') then
    raise exception 'invalid task row status: %', p_row_status;
  end if;

  update public.tasks
     set continuation_claim_id         = null,
         continuation_claimed_at       = null,
         continuation_claim_expires_at = null,
         status                        = p_row_status,
         updated_at                    = now()
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
