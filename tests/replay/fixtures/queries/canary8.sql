-- READ-ONLY extraction for fixtures/canary8.hiring-affordability.json (production, task c01d28d8).
-- Run each statement inside `set transaction read only;`. Nothing here writes.

-- 1. The compiled mission (planner_runtime dropped).
select (result->'lead_mission') - 'planner_runtime' as mission
from tasks where id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169';

-- 2. Ceilings, and every reservation timed by its execution-call row.
with l as (select result->'capability_execution_state'->'spend_ledger' sl from tasks where id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169'),
r as (select x, ord, c.created_at t
      from l, jsonb_array_elements(sl->'reservations') with ordinality as t(x, ord)
      left join lead_execution_calls c on c.idempotency_key = x->>'idempotency_key' and c.task_id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169')
select (select sl->'ceilings' from l) as ceilings,
       json_agg(json_build_object('at', to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                  'r', x - 'provider_run_id' - 'receipt_reads' - 'settlement_stable') order by ord) as reservations
from r where t < '2026-10-04 15:44:19.618+00';

-- 3. The company records, free text stripped server-side.
select regexp_replace(regexp_replace(regexp_replace(x::text,
         '"(excerpt|description|tagline|about|text|summary|snippet)": "([^"\\]|\\.)*"', '"\1": null', 'g'),
         '"reasons": \[[^\]]*\]', '"reasons": []', 'g'),
         '"(logo|logo_url|image|cover_image|background_image)[a-z_]*": "[^"]*"', '"\1": null', 'g') as record
from tasks, jsonb_array_elements(result->'lead_resume_checkpoint'->'companies') x
where id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169'
  and x->>'company_key' in ('https://www.linkedin.com/company/llamaindex', 'https://www.linkedin.com/company/solanalabs');

-- 4. Anchor: per-company evidence spend at each decision instant (must equal the logged 0.0098 / 0.0236).
-- (see the "spent_final" query in the Replay Lab README)

-- 5. Settlement instants (`settled_at` on each reservation): the first call_settled event per key.
--    A reservation settled after a checkpoint instant counts at its provisional figure there
--    (Delta Lake / Actioneer: Atomus $0.0211 at the decision, settled $0.0176 seconds later).
with c as (select idempotency_key, min(created_at) t from lead_execution_calls
           where task_id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169' group by 1),
     s as (select idempotency_key, min(occurred_at) filter (where event_type = 'call_settled') settled_at
           from lead_mission_events where lineage_id = 'c01d28d8-0e6c-47c5-9ffd-fc146296d169' group by 1)
select c.idempotency_key, c.t as reserved_at, s.settled_at from c left join s using (idempotency_key) order by c.t;
