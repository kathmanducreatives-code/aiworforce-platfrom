-- ROLLBACK for 20261022120000_credits_reaper_charges_confirmed_purchase.sql
--
-- Restores `credits_release_stale` VERBATIM from the re-arm migration it
-- depends on (20261015130000_credits_rearm_settled_key.sql; a test asserts the
-- bodies are byte-identical), then restates the lock-down grants. To roll back
-- the re-arm migration as well, run this file first, then its own rollback.
--
-- Rows are not rewritten. A reservation the fix charged stays `charged`: the
-- provider run it names was bought, and refunding it here would repeat the
-- defect this migration fixed.

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
    perform public.credits_finalize(
      v_txn.id, 0, 'released', 'stale reservation released by reaper');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.credits_release_stale(interval) from public, anon, authenticated;
grant execute on function public.credits_release_stale(interval) to service_role;
