-- LEAD MISSION V2 — A CONTINUATION IS NOT A RETRY.
--
-- ── THE FAILURE ─────────────────────────────────────────────────────────────
--
-- Canary 53784493 (production, 2026-10-03). Five clean slices: page 1, verify,
-- page 2, verify, adopt. Slice 5 decided `replenishment_required` with
-- discovery open (2 of 20 pages taken). The queue then released it `failed /
-- continuation_attempts_exhausted` and page 3 never ran.
--
-- `attempts` was incremented on EVERY claim and capped at 5. When the queue was
-- written (20260910140000) a claim was a retry: run-agent continued itself over
-- HTTP. Four days later (4bee6cd1, run 4250f181) the queue became the only
-- continuation owner, so every slice became a claim — and the 5-retry cap
-- silently became a 5-SLICE cap, under the lineage's own 10-slice budget
-- (`DEFAULT_MAX_CONTINUATIONS`). Run 4250f181 itself ended "5 of 5 attempts"
-- with no execution fault, as did 1e52d43c.
--
-- The design was always the other way round
-- (docs/lead-v2/LEAD_V2_SIGNAL_FIRST_FINAL_IMPLEMENTATION_PLAN.md, "Continuation
-- / Retry / Adaptation"): a continuation consumes NO retry budget; the queue's
-- `attempts` counts retries only; slices are bounded by the lineage's ceilings.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
--
-- A claim still takes an attempt, because at claim time nobody knows how the
-- run will end — and a worker that dies mid-run never releases, so the attempt
-- it took is exactly what bounds a crash loop. The attempt is REFUNDED at
-- release iff the run was a clean continuation that PROVABLY ran a slice:
--
--   p_status = 'resumable'
--   and p_lineage_slices > continuations     -- the lineage folded a NEW slice
--
-- `p_lineage_slices` is `tasks.result.lead_lineage_progress.continuations_used`
-- as the run left it — run-agent's own per-slice counter, the one its ceiling
-- is enforced against. The worker passes it only for an outcome that is
-- `continuation_required`, without error, and not aborted. A run that folded
-- nothing (a 409 on a still-held resume claim, a refusal) leaves the counter
-- where it was and keeps its attempt: that IS a retry.
--
-- So, after every release:
--   attempts       = execution faults, crashes and lease expiries — retries
--   continuations  = lineage slices the queue has seen complete cleanly
--
-- ── THE BOUNDS ──────────────────────────────────────────────────────────────
--
--   • Retries: `attempts < 5` / `>= 5`, unchanged in value and meaning.
--   • Slices: the LINEAGE decides — run-agent stops at its continuation,
--     cost and barren ceilings and returns a terminal status. Unchanged.
--   • Backstop: should the handler ever keep asking to continue past every
--     ceiling it has, the queue stops at 25 slices (`MAX_CONTINUATIONS_CAP`,
--     the most the lineage budget can be configured to). A refund can only
--     follow a strictly increasing slice count, so refunds alone can never
--     loop: at most 25 refunds per mission, at most 5 unrefunded claims.
--
-- ── COMPATIBILITY ───────────────────────────────────────────────────────────
--
--   • New column, default 0: no existing row is rewritten. Terminal rows
--     (`complete`/`failed`/`cancelled`) are never claimed, before or after.
--   • `release_lead_mission` gains a DEFAULTED fifth parameter. The 4-argument
--     function is dropped so PostgREST never sees two candidates; a worker that
--     still calls with four named arguments resolves to the new one and gets
--     exactly the old behaviour (no slice count ⇒ no refund).
--   • Its result gains `reason`, `attempts`, `continuations` after the two
--     columns callers already read.
--   • `claim_next_lead_mission` keeps its signature; it gains the backstop.
--   • Lead V1 never touches `lead_mission_queue`'s counters.
--
-- Rollback: supabase/migrations-held/rollback/20261003120000_lead_mission_v2_continuations_not_retries.down.sql

alter table public.lead_mission_queue
  add column if not exists continuations integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lead_mission_queue_continuations_nonnegative'
       and conrelid = 'public.lead_mission_queue'::regclass
  ) then
    alter table public.lead_mission_queue
      add constraint lead_mission_queue_continuations_nonnegative check (continuations >= 0);
  end if;
end $$;

comment on column public.lead_mission_queue.attempts is
  'Unrefunded claims: execution faults, crashes, lease expiries and no-op runs. A clean continuation slice refunds its claim. Capped at 5.';
comment on column public.lead_mission_queue.continuations is
  'Lineage slices (lead_lineage_progress.continuations_used) the queue has seen end cleanly and ask to continue. Never counts against attempts. Backstop at 25.';

-- ── CLAIM: unchanged except the slice backstop ──────────────────────────────
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
   -- RETRIES: claims a clean continuation did not refund.
   where q.attempts < 5
     -- SLICES: a backstop only; the lineage's own ceilings end a mission first.
     and q.continuations < 25
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

  -- Taken now, refunded at release if the run turns out to be a clean
  -- continuation. A worker that dies never releases, so its attempt stands.
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

-- ── RELEASE: a clean continuation refunds its claim ─────────────────────────
drop function if exists public.release_lead_mission(uuid, uuid, text, jsonb);

create or replace function public.release_lead_mission(
  p_queue_id uuid,
  p_worker_id uuid,
  p_status text,
  p_outcome jsonb default null,
  -- `lead_lineage_progress.continuations_used` after a CLEAN continuation;
  -- null for anything else. See the header.
  p_lineage_slices integer default null
)
returns table(
  released boolean, final_status text, reason text, attempts integer, continuations integer
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q        public.lead_mission_queue%rowtype;
  v_final    text;
  v_reason   text := null;
  v_slice    boolean;
  v_attempts integer;
  v_cont     integer;
begin
  if p_status not in ('complete', 'resumable', 'failed', 'cancelled') then
    raise exception 'invalid lead mission release status: %', p_status;
  end if;

  select * into v_q from public.lead_mission_queue where id = p_queue_id for update;
  if not found or v_q.claimed_by is distinct from p_worker_id then
    return query select false, null::text, null::text, null::integer, null::integer; return;
  end if;

  -- A NEW slice, provably: the lineage's own counter moved past what the queue
  -- has already seen. Equal or lower — a no-op run — refunds nothing.
  v_slice := p_status = 'resumable'
             and p_lineage_slices is not null
             and p_lineage_slices > v_q.continuations;
  v_attempts := case when v_slice then greatest(v_q.attempts - 1, 0) else v_q.attempts end;
  v_cont     := case when v_slice then p_lineage_slices else v_q.continuations end;

  v_final := case
    -- A cancellation that landed mid-run is never overwritten.
    when v_q.status = 'cancelled' then 'cancelled'
    -- Every ceiling the lineage has should have ended it before this.
    when p_status = 'resumable' and v_cont >= 25 then 'failed'
    -- Out of retries: stop, visibly, rather than retry for ever.
    when p_status = 'resumable' and v_attempts >= 5 then 'failed'
    else p_status
  end;
  if v_final = 'failed' and p_status = 'resumable' and v_q.status <> 'cancelled' then
    v_reason := case when v_cont >= 25 then 'slices_exhausted' else 'attempts_exhausted' end;
  end if;

  update public.lead_mission_queue
     set status           = v_final,
         claimed_by       = null,
         lease_expires_at = null,
         attempts         = v_attempts,
         continuations    = v_cont,
         not_before       = case when v_final = 'resumable' then now() + interval '2 minutes' else null end,
         last_outcome     = p_outcome,
         updated_at       = now()
   where id = p_queue_id;

  return query select true, v_final, v_reason, v_attempts, v_cont;
end;
$function$;

revoke all on function public.claim_next_lead_mission(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_lead_mission(uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_next_lead_mission(uuid, integer) to service_role;
grant execute on function public.release_lead_mission(uuid, uuid, text, jsonb, integer) to service_role;
