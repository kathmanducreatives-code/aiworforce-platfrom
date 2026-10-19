-- HELD: apply deliberately after the held V2 queue chain. No tables, columns,
-- cron jobs, credentials or billing policies change. Never auto-apply hosted.
-- A hard crash on claim five cannot release itself, and claim six is forbidden.
-- Close that mission atomically before claiming ordinary work. Nothing here
-- admits execution, refunds credits, stops/reprices authorization or reconciles
-- vendor liability. The claim RPC signature/attempt and slice caps are unchanged.

create or replace function public.recover_exhausted_lead_missions(p_limit integer default 10)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q public.lead_mission_queue%rowtype;
  v_t public.tasks%rowtype;
  v_l public.lead_lineages%rowtype;
  v_result jsonb;
  v_auto jsonb;
  v_terminal text;
  v_outcome text;
  v_status text;
  v_plan uuid;
  v_owns_lineage boolean;
  v_now timestamptz;
  v_count integer := 0;
begin
  -- Same lock order as heartbeat/admission: queue -> task -> lineage -> plan.
  -- Never lock financial records (admission locks authorization BEFORE queue).
  -- SKIP LOCKED lets competing workers make progress without sharing a cleanup.
  for v_q in
    select q.* from public.lead_mission_queue q
     where q.status = 'running' and q.attempts >= 5
       and q.lease_expires_at <= clock_timestamp()
     order by q.created_at, q.id
     limit least(greatest(coalesce(p_limit, 10), 0), 100)
     for update skip locked
  loop
    -- Missing bindings are legitimate when the worker died before bind.
    -- Scope every related-row write to this workspace; never follow a foreign ID.
    select t.* into v_t from public.tasks t
     where t.id = v_q.task_id and t.workspace_id = v_q.workspace_id for update;
    select l.* into v_l from public.lead_lineages l
     where l.lineage_id = coalesce(v_t.lineage_id, v_q.lineage_id)
       and l.workspace_id = v_q.workspace_id for update;
    -- A different holder belongs to another execution, not this crashed task.
    v_owns_lineage := v_l.lineage_id is not null
      and (v_l.lease_holder is null or v_l.lease_holder = v_q.task_id);
    v_now := clock_timestamp();
    v_result := case when jsonb_typeof(v_t.result) = 'object' then v_t.result else '{}'::jsonb end;
    v_auto := case when jsonb_typeof(v_result->'auto_continuation') = 'object'
      then v_result->'auto_continuation' else '{}'::jsonb end;
    v_terminal := nullif(v_result->>'terminal_status', '');

    -- Respect a terminal result persisted BEFORE the crash. This is the worker's
    -- mapTaskOutcome/queueStatusFor precedence: own terminal -> lineage -> fault.
    v_outcome := null;
    if v_terminal is distinct from 'continuation_required' then
      if v_t.status = 'failed' then
        v_outcome := case when v_terminal is null then 'failed' else 'failed:' || v_terminal end;
      elsif v_terminal is not null then v_outcome := v_terminal;
      elsif v_t.status in ('complete', 'skipped') then v_outcome := v_t.status;
      end if;
    end if;
    if v_outcome is null and v_owns_lineage then
      if v_l.status = 'cancelled' then v_outcome := 'cancelled';
      elsif v_l.status = 'terminal' then
        v_outcome := coalesce(nullif(nullif(v_l.current_state->>'terminal_status', 'continuation_required'), ''),
          nullif(v_l.terminal_reason, ''), 'lineage_terminal');
      end if;
    end if;
    if v_outcome is null then
      v_outcome := 'continuation_attempts_exhausted'; v_status := 'failed';
    elsif v_outcome ~* 'cancel' then v_status := 'cancelled';
    elsif v_outcome ~* 'fail|refused|error' then v_status := 'failed';
    else v_status := 'complete';
    end if;

    if v_t.id is not null then
      -- Bump generation AND close the open-result fence. A delayed handler can
      -- neither overwrite this outcome nor reclaim the old continuation lease.
      v_result := v_result || jsonb_build_object(
        'terminal_status', case when v_terminal is null or v_terminal = 'continuation_required' then v_outcome else v_terminal end,
        'task_status', case when v_status = 'complete' then coalesce(v_result->>'task_status', 'completed') else 'failed' end,
        'auto_continuation', v_auto || jsonb_build_object('continuing', false, 'decision', v_outcome),
        'v2_terminal', jsonb_build_object('queue_status', v_status, 'reason', v_outcome, 'reconciled_at', v_now));
      update public.tasks set
        status = case when v_status = 'complete' then
          case when v_t.status in ('ready','running','pending','partial') then 'completed' else v_t.status end
          else 'failed' end,
        checkpoint_version = checkpoint_version + 1,
        continuation_claim_id = null, continuation_claimed_at = null, continuation_claim_expires_at = null,
        result = v_result,
        updated_at = v_now
      where id = v_t.id and workspace_id = v_q.workspace_id;
    end if;
    if v_owns_lineage then
      update public.lead_lineages set
        status = case when v_l.status in ('terminal','cancelled') then v_l.status
          when v_status = 'cancelled' then 'cancelled' else 'terminal' end,
        terminal_reason = case when v_l.status in ('terminal','cancelled')
          then coalesce(v_l.terminal_reason, v_outcome) else v_outcome end,
        lease_holder = null, lease_expires_at = null,
        state_version = state_version + 1,
        current_state = case when jsonb_typeof(current_state) = 'object' then current_state else '{}'::jsonb end
          || jsonb_build_object('terminal_status', case when v_l.status in ('terminal','cancelled')
            then coalesce(nullif(nullif(current_state->>'terminal_status', 'continuation_required'), ''), v_outcome)
            else v_outcome end),
        updated_at = v_now
      where lineage_id = v_l.lineage_id and workspace_id = v_q.workspace_id;
    end if;

    -- Prefer the task's persisted plan binding. A malformed unbound kickoff is
    -- not a reason to strand the queue (and must never be cast blindly to UUID).
    v_plan := coalesce(v_t.plan_id, v_t.task_plan_id);
    if v_plan is null and (v_q.request->>'plan_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_plan := (v_q.request->>'plan_id')::uuid;
    end if;
    update public.task_plans set status = case when v_status <> 'complete' then 'failed'
        when coalesce(v_result->>'task_status', v_t.status) in ('completed','complete') then 'complete'
        else 'partial' end,
      completed_at = coalesce(completed_at, v_now), updated_at = v_now
     where id = v_plan and workspace_id = v_q.workspace_id;

    update public.lead_mission_queue set status = v_status,
      claimed_by = null, lease_expires_at = null, not_before = null,
      last_outcome = coalesce(last_outcome, '{}'::jsonb) || jsonb_build_object(
        'status', v_outcome, 'terminal', true, 'recovery', 'exhausted_claim', 'reconciled_at', v_now),
      updated_at = v_now
     where id = v_q.id;
    v_count := v_count + 1;
  end loop;
  -- All rows and the queue change in ONE transaction. Any write failure rolls
  -- them all back; the expired row remains eligible for the next bounded pass.
  return v_count;
end;
$$;

revoke all on function public.recover_exhausted_lead_missions(integer) from public, anon, authenticated;
grant execute on function public.recover_exhausted_lead_missions(integer) to service_role;

-- Same claim as 20261003120000, with only the bounded recovery pass added.
create or replace function public.claim_next_lead_mission(p_worker_id uuid, p_lease_seconds integer default 180)
returns table(claimed boolean, reason text, queue_id uuid, workspace_id uuid, request jsonb,
  task_id uuid, lineage_id uuid, attempts integer, held_until timestamptz)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.lead_mission_queue%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  perform public.recover_exhausted_lead_missions(10);
  select q.* into v_q from public.lead_mission_queue q
   where q.attempts < 5 and q.continuations < 25
     and coalesce(q.not_before, '-infinity'::timestamptz) <= now()
     and (q.status in ('queued','resumable')
       or (q.status = 'running' and q.lease_expires_at is not null and q.lease_expires_at <= now()))
     and not exists (select 1 from public.lead_lineages l where q.lineage_id is not null
       and l.lineage_id = q.lineage_id and l.status in ('cancelled','terminal'))
   order by q.created_at for update skip locked limit 1;
  if not found then
    return query select false, 'no_eligible_mission'::text,
      null::uuid, null::uuid, null::jsonb, null::uuid, null::uuid, null::integer, null::timestamptz;
    return;
  end if;
  update public.lead_mission_queue set status='running', claimed_by=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>v_secs), attempts=public.lead_mission_queue.attempts+1,
    not_before=null, updated_at=now() where id=v_q.id;
  return query select true, 'claimed'::text, v_q.id, v_q.workspace_id, v_q.request,
    v_q.task_id, v_q.lineage_id, v_q.attempts+1, now()+make_interval(secs=>v_secs);
end;
$function$;

-- CREATE OR REPLACE retains the existing claim grants. Pin them explicitly.
revoke all on function public.claim_next_lead_mission(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_lead_mission(uuid, integer) to service_role;
