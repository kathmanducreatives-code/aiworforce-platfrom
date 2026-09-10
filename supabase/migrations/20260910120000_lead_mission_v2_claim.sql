-- LEAD MISSION V2 — A QUEUE, AN ATOMIC CLAIM, AND A HEARTBEAT THAT RENEWS WHAT
-- THE RUN ACTUALLY HOLDS.
--
-- ── WHY A QUEUE TABLE AND NOT A `tasks` ROW ─────────────────────────────────
--
-- The V2 worker runs run-agent's own handler in-process. That handler creates
-- its own task on a fresh run and takes its own `claim_sourcing_continuation`
-- on a resume — so a task row pre-claimed by the worker is refused
-- (`already_claimed`), and a fresh mission has no checkpoint for `decideResume`
-- to accept. The unit of work the worker owns is therefore a QUEUE ROW holding
-- orchestrate's exact kickoff body; the task and lineage the handler creates are
-- bound onto it once they exist (`bind_lead_mission_execution`).
--
-- ── NO SECOND OWNERSHIP MODEL OVER THE RUN ITSELF ───────────────────────────
--
-- The queue lease says which WORKER is driving a mission. Who may EXECUTE and
-- SPEND is still decided exactly as in V1: the handler's own continuation claim
-- and its own lineage lease (holder = task id). The heartbeat only KEEPS THOSE
-- ALIVE past the ~150s the edge runtime never outlived:
--   • `tasks.updated_at`, so `tasks_sweep_stuck_runs` (quiet > 5 min) never
--     mistakes a healthy long run for a killed one and hands it to a second
--     executor;
--   • the handler's continuation claim (5 min), when it took one;
--   • the lineage lease (180s), via `renew_lineage_lease` — NOT
--     `acquire_lineage_lease`, which bumps `generation` on every call and would
--     make each heartbeat look like a new, barren generation.
--
-- ── CANCELLATION STAYS WHERE IT WAS ─────────────────────────────────────────
--
-- A cancelled or terminal lineage is never claimed and fails the heartbeat, and
-- a cancelled queue row fails the heartbeat too. The worker reacts by revoking
-- the run's deadline, so the engine's existing reserve logic stops starting
-- paid work and checkpoints. Nothing here decides whether money may be spent.

create table if not exists public.lead_mission_queue (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  -- Orchestrate's kickoff body, verbatim except the canary's forced quota.
  request          jsonb not null,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'resumable', 'complete', 'failed', 'cancelled')),
  claimed_by       uuid,
  lease_expires_at timestamptz,
  -- Bound once the handler has created them; null for a mission not yet started.
  task_id          uuid,
  lineage_id       uuid,
  attempts         integer not null default 0,
  -- Backoff after a resumable release, so a mission whose previous run still
  -- holds its 5-minute resume claim is not re-claimed into an instant 409 loop.
  not_before       timestamptz,
  last_outcome     jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A lease without an expiry is a deadlock waiting to happen.
  constraint lead_mission_queue_lease_is_bounded
    check ((claimed_by is null) = (lease_expires_at is null))
);

create index if not exists idx_lead_mission_queue_claimable
  on public.lead_mission_queue (created_at)
  where status in ('queued', 'resumable', 'running');
create index if not exists idx_lead_mission_queue_task
  on public.lead_mission_queue (task_id)
  where task_id is not null;

-- Service-role only. No client reads the queue, so RLS on with no policy.
alter table public.lead_mission_queue enable row level security;
revoke all on table public.lead_mission_queue from anon;
revoke all on table public.lead_mission_queue from authenticated;

-- ── RENEW A LINEAGE LEASE WITHOUT STARTING A NEW GENERATION ─────────────────
create or replace function public.renew_lineage_lease(
  p_lineage_id uuid,
  p_workspace_id uuid,
  p_holder_task_id uuid,
  p_lease_seconds integer default 180
)
returns table(renewed boolean, reason text, held_until timestamptz)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row  public.lead_lineages%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  if p_lineage_id is null or p_workspace_id is null or p_holder_task_id is null then
    return query select false, 'invalid_arguments'::text, null::timestamptz; return;
  end if;

  select * into v_row from public.lead_lineages where lineage_id = p_lineage_id for update;
  if not found then
    return query select false, 'lineage_not_found'::text, null::timestamptz; return;
  end if;
  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, null::timestamptz; return;
  end if;
  -- The same fence acquire_lineage_lease and claim_sourcing_continuation read.
  if v_row.status in ('terminal', 'cancelled') then
    return query select false, ('lineage_' || v_row.status)::text, null::timestamptz; return;
  end if;
  -- Only the holder may extend. A lease someone else took is theirs.
  if v_row.lease_holder is distinct from p_holder_task_id then
    return query select false, 'not_lease_holder'::text, null::timestamptz; return;
  end if;

  update public.lead_lineages
     set lease_expires_at = now() + make_interval(secs => v_secs),
         updated_at       = now()
   where lineage_id = p_lineage_id;

  return query select true, 'renewed'::text, now() + make_interval(secs => v_secs);
end;
$function$;

-- ── CLAIM THE NEXT ELIGIBLE MISSION ─────────────────────────────────────────
-- SELECT ... FOR UPDATE SKIP LOCKED: two workers lock different rows (or one
-- finds none); neither ever receives the same mission.
create or replace function public.claim_next_lead_mission(
  p_worker_id uuid,
  p_lease_seconds integer default 180
)
returns table(
  claimed boolean, reason text, queue_id uuid, workspace_id uuid, request jsonb,
  task_id uuid, lineage_id uuid, attempts integer, held_until timestamptz
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q    public.lead_mission_queue%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  select q.* into v_q
    from public.lead_mission_queue q
   where q.attempts < 5
     and coalesce(q.not_before, '-infinity'::timestamptz) <= now()
     and (
           q.status in ('queued', 'resumable')
           -- A worker died holding it: its lease has lapsed.
           or (q.status = 'running' and q.lease_expires_at is not null and q.lease_expires_at <= now())
         )
     -- The lineage row is the authority, once one exists.
     and not exists (
           select 1 from public.lead_lineages l
            where q.lineage_id is not null
              and l.lineage_id = q.lineage_id
              and l.status in ('cancelled', 'terminal')
         )
   order by q.created_at
   for update skip locked
   limit 1;

  if not found then
    return query select false, 'no_eligible_mission'::text,
      null::uuid, null::uuid, null::jsonb, null::uuid, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  update public.lead_mission_queue
     set status           = 'running',
         claimed_by       = p_worker_id,
         lease_expires_at = now() + make_interval(secs => v_secs),
         attempts         = public.lead_mission_queue.attempts + 1,
         not_before       = null,
         updated_at       = now()
   where id = v_q.id;

  return query select true, 'claimed'::text, v_q.id, v_q.workspace_id, v_q.request,
    v_q.task_id, v_q.lineage_id, v_q.attempts + 1, now() + make_interval(secs => v_secs);
end;
$function$;

-- ── BIND THE TASK + LINEAGE THE HANDLER CREATED ─────────────────────────────
create or replace function public.bind_lead_mission_execution(
  p_queue_id uuid,
  p_worker_id uuid,
  p_task_id uuid,
  p_lineage_id uuid
)
returns table(bound boolean, reason text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.lead_mission_queue%rowtype;
begin
  select * into v_q from public.lead_mission_queue where id = p_queue_id for update;
  if not found then
    return query select false, 'queue_not_found'::text; return;
  end if;
  if v_q.claimed_by is distinct from p_worker_id then
    return query select false, 'ownership_lost'::text; return;
  end if;
  -- A mission executes on ONE task. A different id means a second task was
  -- created for the same mission — refuse rather than follow it.
  if v_q.task_id is not null and v_q.task_id <> p_task_id then
    return query select false, 'task_mismatch'::text; return;
  end if;

  update public.lead_mission_queue
     set task_id = p_task_id, lineage_id = p_lineage_id, updated_at = now()
   where id = p_queue_id;

  return query select true, 'bound'::text;
end;
$function$;

-- ── HEARTBEAT: KEEP WHAT THE RUN HOLDS ALIVE ────────────────────────────────
-- ok=false ⇒ the worker must stop starting paid work. Only ownership loss and
-- cancellation are fatal; a lineage lease this run never held (shadow mode)
-- is reported, not fatal.
create or replace function public.heartbeat_lead_mission(
  p_queue_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer default 180
)
returns table(ok boolean, reason text, held_until timestamptz)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q        public.lead_mission_queue%rowtype;
  v_secs     integer := greatest(coalesce(p_lease_seconds, 180), 30);
  v_lstatus  text;
  v_renewed  boolean := null;
  v_rreason  text := null;
begin
  select * into v_q from public.lead_mission_queue where id = p_queue_id for update;
  if not found then
    return query select false, 'queue_not_found'::text, null::timestamptz; return;
  end if;
  if v_q.claimed_by is distinct from p_worker_id then
    return query select false, 'ownership_lost'::text, null::timestamptz; return;
  end if;
  if v_q.status = 'cancelled' then
    return query select false, 'mission_cancelled'::text, null::timestamptz; return;
  end if;
  if v_q.lineage_id is not null then
    select l.status into v_lstatus
      from public.lead_lineages l
     where l.lineage_id = v_q.lineage_id and l.workspace_id = v_q.workspace_id;
    if v_lstatus in ('cancelled', 'terminal') then
      return query select false, ('lineage_' || v_lstatus)::text, null::timestamptz; return;
    end if;
  end if;

  update public.lead_mission_queue
     set lease_expires_at = now() + make_interval(secs => v_secs), updated_at = now()
   where id = p_queue_id;

  if v_q.task_id is not null then
    -- Fresh, so `tasks_sweep_stuck_runs` never flips a live run to `ready`.
    update public.tasks set updated_at = now()
     where id = v_q.task_id and status = 'running';
    -- The handler's own resume claim, kept at its 5-minute semantics.
    update public.tasks
       set continuation_claim_expires_at = now() + make_interval(secs => greatest(v_secs, 300))
     where id = v_q.task_id and continuation_claim_id is not null;
    if v_q.lineage_id is not null then
      select r.renewed, r.reason into v_renewed, v_rreason
        from public.renew_lineage_lease(v_q.lineage_id, v_q.workspace_id, v_q.task_id, v_secs) r;
    end if;
  end if;

  return query select true,
    (case when v_renewed is false then 'renewed_queue_only:' || coalesce(v_rreason, 'unknown')
          else 'renewed' end)::text,
    now() + make_interval(secs => v_secs);
end;
$function$;

-- ── RELEASE ─────────────────────────────────────────────────────────────────
create or replace function public.release_lead_mission(
  p_queue_id uuid,
  p_worker_id uuid,
  p_status text,
  p_outcome jsonb default null
)
returns table(released boolean, final_status text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q     public.lead_mission_queue%rowtype;
  v_final text;
begin
  if p_status not in ('complete', 'resumable', 'failed', 'cancelled') then
    raise exception 'invalid lead mission release status: %', p_status;
  end if;

  select * into v_q from public.lead_mission_queue where id = p_queue_id for update;
  if not found or v_q.claimed_by is distinct from p_worker_id then
    return query select false, null::text; return;
  end if;

  v_final := case
    -- A cancellation that landed mid-run is never overwritten.
    when v_q.status = 'cancelled' then 'cancelled'
    -- Out of attempts: stop, visibly, rather than retry for ever.
    when p_status = 'resumable' and v_q.attempts >= 5 then 'failed'
    else p_status
  end;

  update public.lead_mission_queue
     set status           = v_final,
         claimed_by       = null,
         lease_expires_at = null,
         not_before       = case when v_final = 'resumable' then now() + interval '2 minutes' else null end,
         last_outcome     = p_outcome,
         updated_at       = now()
   where id = p_queue_id;

  return query select true, v_final;
end;
$function$;

-- ── CANCEL A MISSION ────────────────────────────────────────────────────────
-- A queued mission is simply never claimed. A running one fails its next
-- heartbeat, and the worker stops paid work through the revoked deadline.
create or replace function public.cancel_lead_mission(
  p_queue_id uuid,
  p_workspace_id uuid
)
returns table(cancelled boolean, reason text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.lead_mission_queue
     set status = 'cancelled', updated_at = now()
   where id = p_queue_id
     and workspace_id = p_workspace_id
     and status in ('queued', 'resumable', 'running');
  if not found then
    return query select false, 'not_cancellable'::text; return;
  end if;
  return query select true, 'cancelled'::text;
end;
$function$;

revoke all on function public.renew_lineage_lease(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_next_lead_mission(uuid, integer) from public, anon, authenticated;
revoke all on function public.bind_lead_mission_execution(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_lead_mission(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_lead_mission(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_lead_mission(uuid, uuid) from public, anon, authenticated;

grant execute on function public.renew_lineage_lease(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.claim_next_lead_mission(uuid, integer) to service_role;
grant execute on function public.bind_lead_mission_execution(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.heartbeat_lead_mission(uuid, uuid, integer) to service_role;
grant execute on function public.release_lead_mission(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.cancel_lead_mission(uuid, uuid) to service_role;
