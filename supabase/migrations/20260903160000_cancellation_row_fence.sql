-- CANCELLATION MUST OUTLIVE THE SLICE THAT WAS ALREADY RUNNING.
--
-- ── THE INVARIANT ───────────────────────────────────────────────────────────
--
--   cancellation commits
--     -> lineage status becomes `cancelled`
--     -> no future acquire can succeed
--     -> an already-running holder may finish its current slice
--     -> its release must preserve `cancelled`
--     -> it cannot reactivate the lineage
--     -> no future paid work can start
--
-- ── WHY NOT AN EPOCH COLUMN ─────────────────────────────────────────────────
--
-- Both functions read the lineage row with SELECT ... FOR UPDATE in the same
-- transaction that writes it, and they are the only two writers of
-- `lead_lineages.status`. So the status column already behaves as the fence an
-- epoch would provide: a stale release reads `cancelled` under the row lock and
-- cannot regress it. A separate epoch would add a column and a comparison to
-- buy a guarantee the row lock already gives.
--
-- If a third writer of `status` is ever introduced outside these functions,
-- this reasoning breaks and the epoch becomes necessary.

-- ── THE STATUS VOCABULARY HAS TO ALLOW THE NEW STATE ────────────────────────
--
-- `lead_lineages_status_check` permitted only active | running | terminal, so
-- `cancel_lineage` failed at runtime with a constraint violation the first time
-- it ran. The static tests could not have caught it — they read this migration,
-- not the table it writes to — which is why the live canary exists.
--
-- Additive: no existing row becomes invalid, and `cancelled` is kept DISTINCT
-- from `terminal` on purpose. Both are fenced identically, but "an operator
-- stopped this" and "this finished on its own" are different facts, and
-- collapsing them would lose the only signal that says a run was cut short.
alter table public.lead_lineages
  drop constraint if exists lead_lineages_status_check;

alter table public.lead_lineages
  add constraint lead_lineages_status_check
  check (status = any (array['active'::text, 'running'::text, 'terminal'::text, 'cancelled'::text]));

CREATE OR REPLACE FUNCTION public.acquire_lineage_lease(p_lineage_id uuid, p_workspace_id uuid, p_holder_task_id uuid, p_mission_hash text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 180)
 RETURNS TABLE(acquired boolean, reason text, state_version integer, current_state jsonb, generation integer, held_by uuid, held_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row  public.lead_lineages%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  if p_lineage_id is null or p_workspace_id is null or p_holder_task_id is null then
    return query select false, 'invalid_arguments'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- FIRST START CREATES THE LINEAGE. Idempotent: a racing second insert loses
  -- harmlessly and falls through to the locked read below.
  insert into public.lead_lineages (lineage_id, workspace_id, mission_hash, status)
  values (p_lineage_id, p_workspace_id, p_mission_hash, 'active')
  on conflict (lineage_id) do nothing;

  select * into v_row from public.lead_lineages
   where lineage_id = p_lineage_id
     for update;

  if not found then
    return query select false, 'lineage_not_found'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, null::integer, null::jsonb,
                        null::integer, null::uuid, null::timestamptz;
    return;
  end if;

  -- A FINISHED LINEAGE IS FINISHED. Re-running it would re-buy its provider work.
  -- A CANCELLED LINEAGE IS AS FINISHED AS A TERMINAL ONE.
  --
  -- Read under the FOR UPDATE above, so a cancellation that commits before this
  -- transaction takes the row lock is seen here, and one that commits after it
  -- waits. That ordering is the whole fence: no epoch column is needed because
  -- the status IS the epoch, and both writers of it hold this same row lock.
  if v_row.status in ('terminal', 'cancelled') then
    return query select false, 'already_terminal'::text, v_row.state_version,
                        null::jsonb, v_row.generation, null::uuid, null::timestamptz;
    return;
  end if;

  -- THE REFUSAL THAT MATTERS: a live lease held by somebody else. This is the
  -- exact condition missing on 2026-08-29 at 11:13:10 and again at 11:13:19.
  -- Re-entrant for the SAME holder, so a task cannot deadlock against itself.
  if v_row.lease_holder is not null
     and v_row.lease_expires_at is not null
     and v_row.lease_expires_at > now()
     and v_row.lease_holder <> p_holder_task_id then
    return query select false, 'already_leased'::text, v_row.state_version,
                        null::jsonb, v_row.generation,
                        v_row.lease_holder, v_row.lease_expires_at;
    return;
  end if;

  -- MISSION HASH IS CHECKED, NOT OVERWRITTEN. A different mission is a different
  -- question and must not inherit this lineage's paid state.
  if p_mission_hash is not null
     and v_row.mission_hash is not null
     and v_row.mission_hash <> p_mission_hash then
    return query select false, 'mission_mismatch'::text, v_row.state_version,
                        null::jsonb, v_row.generation, null::uuid, null::timestamptz;
    return;
  end if;

  update public.lead_lineages
     set lease_holder     = p_holder_task_id,
         lease_expires_at = now() + make_interval(secs => v_secs),
         generation       = public.lead_lineages.generation + 1,
         status           = 'running',
         mission_hash     = coalesce(public.lead_lineages.mission_hash, p_mission_hash),
         updated_at       = now()
   where lineage_id = p_lineage_id;

  return query select true, 'acquired'::text, v_row.state_version, v_row.current_state,
                      v_row.generation + 1, p_holder_task_id,
                      now() + make_interval(secs => v_secs);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_lineage_lease(p_lineage_id uuid, p_workspace_id uuid, p_holder_task_id uuid, p_expected_version integer, p_next_state jsonb DEFAULT NULL::jsonb, p_terminal_reason text DEFAULT NULL::text, p_made_progress boolean DEFAULT false)
 RETURNS TABLE(released boolean, reason text, state_version integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.lead_lineages%rowtype;
begin
  select * into v_row from public.lead_lineages
   where lineage_id = p_lineage_id
     for update;

  if not found then
    return query select false, 'lineage_not_found'::text, null::integer;
    return;
  end if;
  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, v_row.state_version;
    return;
  end if;

  -- NOT THE HOLDER, NOT THE WRITER. A generation whose lease expired and was
  -- reclaimed must not write its stale state over the live one. This is the guard
  -- that makes lease expiry safe.
  if v_row.lease_holder is distinct from p_holder_task_id then
    return query select false, 'not_lease_holder'::text, v_row.state_version;
    return;
  end if;

  -- THE COMPARE-AND-SWAP, checked only when there is state to write: a generation
  -- that produced nothing may still release its lease.
  if p_next_state is not null and v_row.state_version is distinct from p_expected_version then
    return query select false, 'version_conflict'::text, v_row.state_version;
    return;
  end if;

  update public.lead_lineages
     set current_state     = coalesce(p_next_state, public.lead_lineages.current_state),
         state_version     = case when p_next_state is not null
                                  then public.lead_lineages.state_version + 1
                                  else public.lead_lineages.state_version end,
         lease_holder      = null,
         lease_expires_at  = null,
         -- ── A RELEASE MAY END A LINEAGE. IT MAY NEVER REVIVE ONE. ────────
         --
         -- This was unconditional, so ANY in-flight generation's release reset
         -- the lineage to `active` — including one that started before a
         -- cancellation and finished after it.
         --
         -- Proven on 2f3d9c5c (2026-09-03). The lineage was marked terminal at
         -- 10:49 while a slice held the lease. That slice finished, released,
         -- reset the status to `active`, and the sweeper resumed it normally:
         -- 40 further Apify calls and 22 Firecrawl calls over the next 46
         -- minutes, on a run an operator had already stopped.
         --
         -- The other three guards all passed and could not have caught it. The
         -- slice WAS the legitimate `lease_holder`, and `state_version` was
         -- untouched because the cancellation wrote to `tasks`, so the CAS saw
         -- no conflict. Serialising writers is not the same as ordering
         -- decisions: the stale writer was correctly serialised and still wrong.
         --
         -- The holder is still allowed to finish and to persist what it learned
         -- — `current_state` is written above — because work already paid for
         -- should not be thrown away. It simply cannot reopen the lineage.
         status            = case
                               when public.lead_lineages.status in ('cancelled', 'terminal')
                                 then public.lead_lineages.status
                               when p_terminal_reason is not null then 'terminal'
                               else 'active'
                             end,
         terminal_reason   = coalesce(p_terminal_reason, public.lead_lineages.terminal_reason),
         last_progress_at  = case when p_made_progress then now()
                                  else public.lead_lineages.last_progress_at end,
         updated_at        = now()
   where lineage_id = p_lineage_id;

  return query select true, 'released'::text,
                      v_row.state_version + (case when p_next_state is not null then 1 else 0 end);
end;
$function$
;

-- ── CANCELLATION AS ONE STATEMENT ───────────────────────────────────────────
--
-- Writing `terminal_status` onto the task is what was tried on 2f3d9c5c, and it
-- lost the race: the field is last-writer-wins and the in-flight slice always
-- writes last. Cancellation has to take the lineage row's lock and settle every
-- part of the decision inside it — status, lease and continuation claim —
-- so there is no window in which a resumer can observe a half-cancelled run.
--
-- The lease is cleared rather than waited on. The holder is allowed to finish
-- its current slice and persist what it learned; the fence in
-- `release_lineage_lease` is what stops that release reopening the lineage.
create or replace function public.cancel_lineage(
  p_lineage_id uuid,
  p_workspace_id uuid,
  p_reason text default 'cancelled_by_operator'
)
returns table(cancelled boolean, reason text, prior_status text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.lead_lineages%rowtype;
begin
  select * into v_row from public.lead_lineages
   where lineage_id = p_lineage_id
     for update;

  if not found then
    return query select false, 'lineage_not_found'::text, null::text;
    return;
  end if;
  if v_row.workspace_id is distinct from p_workspace_id then
    return query select false, 'workspace_mismatch'::text, v_row.status;
    return;
  end if;

  -- ALREADY FINISHED IS NOT AN ERROR, and it is not a re-cancellation either.
  -- Reporting the prior status lets a caller tell "I stopped it" from "it had
  -- already stopped", which are different facts about the same outcome.
  if v_row.status in ('cancelled', 'terminal') then
    return query select false, 'already_finished'::text, v_row.status;
    return;
  end if;

  update public.lead_lineages
     set status           = 'cancelled',
         terminal_reason  = p_reason,
         lease_holder     = null,
         lease_expires_at = null,
         updated_at       = now()
   where lineage_id = p_lineage_id;

  -- The task's claim goes in the SAME transaction. Left behind, a live claim
  -- would keep the sweeper's own eligibility check believing a continuation was
  -- already in flight, which is a different kind of stuck.
  update public.tasks
     set continuation_claim_id         = null,
         continuation_claim_expires_at = null,
         updated_at                    = now()
   where lineage_id = p_lineage_id;

  return query select true, 'cancelled'::text, v_row.status;
end;
$function$;
