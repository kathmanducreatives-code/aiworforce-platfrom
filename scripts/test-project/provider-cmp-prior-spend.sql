-- Committed provider spend under the live comparison's walk ids (provider-cmp-*), as the
-- JSON provider-live-comparison.ts reads from PROVIDER_CMP_PRIOR_SPEND. Read-only; TEST only.
-- Same rule as the ledger (budget.ts memoryLedger): settled = actual (or reserved),
-- released = 0, reserved / uncertain = reserved (an uncertain charge counts in full).
-- Apify credits are units of $0.00001 (apifyInvoker.ts APIFY_UNIT_USD).
select json_build_object(
  'apifyUsd', round(coalesce(sum(c) filter (where provider = 'apify'), 0) * 0.00001, 6),
  'leadoceanRecords', coalesce(sum(c) filter (where provider = 'leadocean'), 0)
)
from (
  select provider,
         case state when 'settled' then coalesce(credits_actual, credits_reserved) when 'released' then 0 else credits_reserved end as c
  from public.provider_usage_ledger
  where workspace_id = '40e2512f-09b6-433e-97fe-f9999a1f1897'
    and mission_id like '%provider-cmp-%'
) x;
