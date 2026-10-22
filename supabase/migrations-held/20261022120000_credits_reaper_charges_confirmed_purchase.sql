-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Billing change: needs explicit approval
-- before it is applied to any hosted project. See supabase/migrations-held/README.md.
--
-- DEPENDS ON 20261015130000_credits_rearm_settled_key.sql (held): the reaper
-- window below runs from `rearmed_at`, the column that migration adds.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `credits_release_stale` refunds EVERY reservation still `reserved` after 30
-- minutes. A worker that dies after the provider started a paid run, but before
-- `runTool` settled the reservation, leaves exactly that row: the provider run
-- exists and is billed, and its run id is already in the execution ledger
-- (`onRunStarted` writes `lead_execution_calls.provider_run_id` the instant the
-- start answers). The reaper released it anyway, so a confirmed purchase was
-- refunded to the customer.
--
-- A later slice that ADOPTS that run (it reads the dataset, it never buys
-- again) does not settle the original reservation either: adoption reserves
-- nothing new. So the release was final, not a race.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- The reaper asks the execution ledger before it refunds. A stale reservation
-- is CONFIRMED when a provider-call row of the same workspace, the same task
-- and the same logical call (`logical_call_key` = the credit's
-- `idempotency_key`) names a provider run id. That row is written only by the
-- service role (members can SELECT it, nothing else), only from the provider's
-- own start response.
--
--   * CONFIRMED: settled `charged`, exactly as `settleProviderCall` would have
--     settled it had the worker lived (`creditSettlementFor`: a run id means
--     started). The charge is the live path's: CREDITS_PER_PROVIDER_CALL (1),
--     capped at what was reserved; the rest is refunded by `credits_finalize`.
--   * UNCERTAIN (a ledger row with no run id: the start answer was lost) and
--     UNUSED (no ledger row): released, exactly as before. Uncertain starts keep
--     the approved policy (#88, discovery-smoke-admission.md item 7): held until
--     the reaper, then released; the USD liability stays open in the smoke
--     ledger. If such a key is later really bought, the re-arm fix charges it.
--
-- Settlement goes through `credits_finalize`, which is row-locked and replays
-- any row that is no longer `reserved`. A live settle after the reaper, a second
-- reaper pass, or a later worker that reuses the key cannot charge twice.
--
-- Unchanged: `credits_reserve`, `credits_finalize`, `credits_grant`, the
-- 30-minute window (from the re-arm when there was one), the return value
-- (reservations settled), grants and admission.
--
-- Rollback: rollback/20261022120000_credits_reaper_charges_confirmed_purchase.down.sql
-- restores the re-arm migration's reaper verbatim.

create or replace function public.credits_release_stale(
  p_older_than interval default '00:30:00'::interval
) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_txn public.credit_transactions%rowtype;
  v_n   integer := 0;
begin
  for v_txn in
    select * from public.credit_transactions
     where status = 'reserved'
       and coalesce(rearmed_at, created_at) < now() - p_older_than
     for update skip locked
  loop
    if v_txn.kind in ('provider_call', 'monitoring_call') and exists (
         select 1 from public.lead_execution_calls e
          where e.workspace_id = v_txn.workspace_id
            and e.logical_call_key = v_txn.idempotency_key
            and e.task_id is not distinct from v_txn.task_id
            and e.record_kind = 'provider_call'
            and length(btrim(coalesce(e.provider_run_id, ''))) > 0) then
      -- CONFIRMED: the provider named the run. Charged as the live settle would.
      perform public.credits_finalize(
        v_txn.id, least(v_txn.reserved_credits, 1), 'charged',
        'stale reservation charged by reaper: provider run confirmed');
    else
      perform public.credits_finalize(
        v_txn.id, 0, 'released', 'stale reservation released by reaper');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- `create or replace` keeps existing grants; restated so this file alone
-- leaves the lock-down (20260929120000) in force.
revoke execute on function public.credits_release_stale(interval) from public, anon, authenticated;
grant execute on function public.credits_release_stale(interval) to service_role;
