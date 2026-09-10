-- LEAD MISSION V2 — ATOMIC CLAIM + HEARTBEAT for the long-running worker.
--
-- WHY A NEW RPC RATHER THAN claim_sourcing_continuation. That function claims a
-- KNOWN task id and REQUIRES an existing `company_first_state` checkpoint — it is
-- the RESUME path the sweeper uses. The worker needs to (a) SELECT the next
-- eligible mission itself, and (b) claim a FRESH queued mission that has no
-- checkpoint yet. It must do both atomically so two workers never take the same
-- mission.
--
-- IT DOES NOT INTRODUCE A SECOND OWNERSHIP MODEL. Ownership is the SAME columns
-- claim_sourcing_continuation writes — `continuation_claim_id` (the holder) and
-- `continuation_claim_expires_at` (the lease) — and the authority is the SAME
-- `lead_lineages.status` fence. A V2 mission is identified solely by the
-- `result ? 'lead_mission_v2'` marker the enqueue function stamps, so the worker
-- can never pick up a V1/edge task or a non-lead task.
--
-- SELECT ... FOR UPDATE SKIP LOCKED is the concurrency guarantee: two workers
-- lock different rows (or one finds none); neither ever receives the same id.

-- ── CLAIM THE NEXT ELIGIBLE MISSION ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_next_lead_mission(
  p_worker_id uuid,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(
  claimed boolean, reason text, task_id uuid, workspace_id uuid,
  lineage_id uuid, checkpoint_version integer, held_until timestamptz, is_resume boolean
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.tasks%rowtype;
  v_lineage uuid;
  v_is_resume boolean;
begin
  -- Pick ONE eligible V2 lead mission and lock it. SKIP LOCKED so concurrent
  -- workers never contend for the same row.
  select t.* into v_row
    from public.tasks t
   where t.result ? 'lead_mission_v2'
     and (
           -- Fresh mission: queued, never run, no checkpoint yet.
           t.status = 'queued'
           or
           -- Resumable mission: has a checkpoint, lease absent or expired, not
           -- yet terminal. Mirrors claim_sourcing_continuation's resumable set.
           (
             t.status in ('partial', 'running', 'ready')
             and t.result -> 'company_first_state' is not null
             and coalesce(
                   t.result ->> 'terminal_status',
                   t.result -> 'company_first_state' ->> 'terminal_status'
                 ) is distinct from 'complete'
             and (t.continuation_claim_expires_at is null
                  or t.continuation_claim_expires_at <= now())
           )
         )
     -- The lineage row is the authority. A cancelled or terminal lineage is
     -- never claimable — the same fence claim_sourcing_continuation applies.
     and not exists (
           select 1 from public.lead_lineages l
            where l.lineage_id = coalesce(t.lineage_id, t.id)
              and l.workspace_id = t.workspace_id
              and l.status in ('cancelled', 'terminal')
         )
   order by t.created_at
   for update skip locked
   limit 1;

  if not found then
    return query select false, 'no_eligible_mission'::text,
      null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz, false;
    return;
  end if;

  v_lineage := coalesce(v_row.lineage_id, v_row.id);
  v_is_resume := (v_row.result -> 'company_first_state') is not null;

  update public.tasks
     set continuation_claim_id         = p_worker_id,
         continuation_claimed_at       = now(),
         continuation_claim_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         checkpoint_version            = public.tasks.checkpoint_version + 1,
         status                        = 'running',
         started_at                    = coalesce(public.tasks.started_at, now()),
         updated_at                    = now(),
         result                        = coalesce(public.tasks.result, '{}'::jsonb) || jsonb_build_object(
                                           'continuation_claim',
                                           jsonb_build_object(
                                             'claim_id', p_worker_id,
                                             'claimed_at', now(),
                                             'expires_at', now() + make_interval(secs => greatest(p_lease_seconds, 30)),
                                             'engine', 'v2_worker'
                                           ))
   where id = v_row.id;

  return query select true, 'claimed'::text, v_row.id, v_row.workspace_id,
    v_lineage, v_row.checkpoint_version + 1,
    now() + make_interval(secs => greatest(p_lease_seconds, 30)), v_is_resume;
end;
$function$;

-- ── HEARTBEAT: RENEW THE LEASE WHILE WORK IS IN FLIGHT ───────────────────────
-- Renews ONLY if this worker still holds the claim AND the lineage is alive.
-- A worker whose heartbeat returns ok=false must stop starting paid work,
-- checkpoint and exit — the lineage is the cancellation authority, not the
-- worker's own clock.
CREATE OR REPLACE FUNCTION public.heartbeat_lead_mission(
  p_task_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(ok boolean, reason text, held_until timestamptz)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.tasks%rowtype;
  v_lineage_status text;
begin
  select * into v_row from public.tasks where id = p_task_id for update;
  if not found then
    return query select false, 'task_not_found'::text, null::timestamptz; return;
  end if;
  if v_row.continuation_claim_id is distinct from p_worker_id then
    return query select false, 'ownership_lost'::text, null::timestamptz; return;
  end if;

  select l.status into v_lineage_status
    from public.lead_lineages l
   where l.lineage_id = coalesce(v_row.lineage_id, v_row.id)
     and l.workspace_id = v_row.workspace_id;
  if v_lineage_status in ('cancelled', 'terminal') then
    return query select false, ('lineage_' || v_lineage_status)::text, null::timestamptz; return;
  end if;

  update public.tasks
     set continuation_claim_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         updated_at = now()
   where id = p_task_id;

  return query select true, 'renewed'::text,
    now() + make_interval(secs => greatest(p_lease_seconds, 30));
end;
$function$;

-- Claim query support: eligible V2 missions, oldest first.
CREATE INDEX IF NOT EXISTS idx_tasks_lead_mission_v2_claimable
  ON public.tasks (created_at)
  WHERE result ? 'lead_mission_v2';

REVOKE ALL ON FUNCTION public.claim_next_lead_mission(uuid, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_lead_mission(uuid, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_lead_mission(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_lead_mission(uuid, uuid, integer) TO service_role;
