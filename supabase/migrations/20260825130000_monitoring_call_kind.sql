-- PHASE 6 — UNATTENDED SPEND NEEDS ITS OWN NAME IN THE LEDGER.
--
-- ── WHY THE CEILING COULD NOT SEE WHAT IT WAS MEASURING ─────────────────────
--
-- The monitoring ceiling bounds spend that happens while nobody is watching.
-- Every provider charge was recorded as `provider_call`, so a period total
-- could not tell an unattended pass from a person clicking Scan — and a
-- workspace doing a lot of manual scanning would have paused its own schedule,
-- for a reason no diagnostic could state.
--
-- Filtering on `task_id IS NULL` does not separate them either: a Radar scan
-- has no task, so it is taskless too. The distinction is not "has a task", it
-- is WHO DECIDED TO SPEND, and the system already records that as the
-- persistence authority the call runs under.
--
-- So the ledger gets the word. `monitoring_call` is charged exactly when the
-- capability engine runs under `monitoring_engine`, which is the authority a
-- scheduled pass — and only a scheduled pass — spends under.
--
-- Nothing is migrated backwards. Existing rows stay `provider_call`, because
-- re-labelling a charge after the fact would rewrite what the workspace was
-- told it was charged for.

alter table public.credit_transactions
  drop constraint if exists credit_transactions_kind_check;

alter table public.credit_transactions
  add constraint credit_transactions_kind_check
  check (kind = any (array[
    'founder_unlock', 'contact_unlock', 'grant', 'adjustment',
    'provider_call',
    -- A provider call made by unattended monitoring. Same money, different
    -- decision-maker, and only one of the two has a ceiling.
    'monitoring_call'
  ]));

-- ── THE PERIOD TOTAL NOW COUNTS ONLY UNATTENDED SPEND ───────────────────────
--
-- `charged` only: a reservation that was refunded took no money, and counting
-- it would refuse a pass over credits the workspace still has.
create or replace function public.monitoring_spend_in_period(
  p_workspace uuid,
  p_period_days integer default 7
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(actual_credits), 0)::integer
  from public.credit_transactions
  where workspace_id = p_workspace
    and status = 'charged'
    and kind = 'monitoring_call'
    and created_at >= now() - make_interval(days => greatest(1, p_period_days));
$$;

revoke all on function public.monitoring_spend_in_period(uuid, integer) from public;
grant execute on function public.monitoring_spend_in_period(uuid, integer) to service_role;
