-- THE CLAIM GATE READS THE SAME AUTHORITY THE SPEND GATE READS.
--
-- ── WHAT WAS OBSERVED ──────────────────────────────────────────────────────
--
-- Lineage 8cfdfd10 was cancelled at 10:45 on 2026-09-04. At 12:03 — seventy
-- eight minutes later — the sweeper claimed it again, for the twenty-sixth
-- time: `checkpoint_version` had climbed to 26 while the lineage row said
-- `cancelled` the whole way.
--
-- `claim_sourcing_continuation` reads `public.tasks` and nothing else. The
-- fence added in 20260903160000 put cancellation on the LINEAGE row —
-- deliberately, because a `terminal_status` written onto the task is a
-- last-writer-wins field that an in-flight slice overwrites, which is exactly
-- how 2f3d9c5c escaped. So the task keeps `continuation_required`, stays
-- claimable, and the claim gate has no idea the lineage is dead.
--
-- ── WHAT WAS NOT AT RISK ───────────────────────────────────────────────────
--
-- Money. `acquire_lineage_lease` refuses a cancelled lineage, and the ledger
-- confirms zero provider calls on 8cfdfd10 after cancellation. The claim
-- itself buys nothing. What it costs is a sweeper slot every tick, a
-- `checkpoint_version` that climbs for no reason, and a task flipping
-- ready/running until it ages out of the two-hour resume window.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--
-- The claim gate now asks the lineage row, under the same lock, the question
-- the lease gate already asks. Both gates agree on what a dead lineage is;
-- neither depends on a field a racing slice can overwrite.
--
-- A cancelled lineage returns its own reason rather than being folded into
-- `already_terminal`, because "someone stopped this" and "this finished" are
-- different facts and the sweeper's logs should not conflate them.

CREATE OR REPLACE FUNCTION public.claim_sourcing_continuation(p_task_id uuid, p_workspace_id uuid, p_claim_id uuid, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(claimed boolean, reason text, task_id uuid, checkpoint_version integer, held_by uuid, held_until timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.tasks%rowtype;
  v_terminal text;
  v_lineage_status text;
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

  -- ── THE LINEAGE ROW IS THE AUTHORITY ────────────────────────────────────
  --
  -- Read under the task's lock and BEFORE any checkpoint or status reasoning,
  -- because none of those questions is worth asking about a lineage somebody
  -- has already stopped. `coalesce` covers a task whose `lineage_id` is unset:
  -- a root task is its own lineage.
  --
  -- Absent lineage row => no opinion. Lineages predate none of this, but rows
  -- can be pruned, and a missing row must not silently block a live run.
  select l.status into v_lineage_status
    from public.lead_lineages l
   where l.lineage_id = coalesce(v_row.lineage_id, p_task_id)
     and l.workspace_id = p_workspace_id;

  if v_lineage_status = 'cancelled' then
    return query select false, 'lineage_cancelled'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
    return;
  end if;

  if v_lineage_status = 'terminal' then
    return query select false, 'already_terminal'::text, p_task_id, v_row.checkpoint_version, null::uuid, null::timestamptz;
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
$function$;
