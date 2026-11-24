-- TEST ACCEPTANCE, STEP 1: SCHEMA VERIFICATION. Read-only.
--
--   psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -v user_id='<TEST_USER_ID>' \
--     -f scripts/test-project/acceptance/schema-verify.sql
--
-- Run together with scripts/test-project/real-gpt/preflight.sql (P01–P14).
-- One row per check: expected, actual, PASS / FAIL / INFO. Any FAIL: stop.
-- INFO rows record a decision (a held migration installed or not), never a defect.
begin transaction read only;
with
fn(name) as (select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
graph_fk as (
  select c.conrelid::regclass::text as child, array_length(c.conkey, 1) as cols
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and c.confrelid::regclass::text in ('accounts', 'contacts', 'lead_candidates', 'lead_evidence', 'signals')
     and c.conrelid::regclass::text in ('contacts', 'engagement_events', 'lead_candidates', 'lead_enrichments', 'lead_evidence',
                                        'outreach_drafts', 'signal_events', 'signal_reviews', 'signal_event_evidence')
),
checks(id, what, expected, actual) as (
  select 'S01', 'Lead V2 queue + lineage functions (claim, bind, heartbeat, release, cancel, lineage lease)', '9',
         (select count(*) from fn where name in ('claim_next_lead_mission', 'bind_lead_mission_execution', 'heartbeat_lead_mission',
           'release_lead_mission', 'cancel_lead_mission', 'acquire_lineage_lease', 'renew_lineage_lease', 'release_lineage_lease', 'cancel_lineage'))::text
  union all
  select 'S02', 'credit functions (reserve, finalize, release_stale)', '3',
         (select count(*) from fn where name in ('credits_reserve', 'credits_finalize', 'credits_release_stale'))::text
  union all
  -- The pre-effect guard (#179) re-checks the requester: the kickoff's user must be a member.
  select 'S03', 'the requesting user is a member of the test workspace', '1',
         (select count(*) from public.workspace_members where workspace_id = :'workspace_id'::uuid and user_id = :'user_id'::uuid)::text
  union all
  -- Pilot execution is disabled: no pilot-marked task may sit in the test workspace.
  select 'S04', 'no pilot-marked task in the test workspace', '0',
         (select count(*) from public.tasks where workspace_id = :'workspace_id'::uuid
            and (payload->>'execution_mode' = 'pilot_draft_only' or payload ? 'pilot_scope' or payload ? 'pilot_origin_session_id'))::text
  union all
  -- OWN-01 (#177, held): must be 0 before that migration may be applied, whether or not it is.
  select 'S05', 'OWN-01: lead-graph rows whose parent is in another workspace', '0',
         (select (select count(*) from public.contacts c join public.accounts p on p.id = c.account_id where c.workspace_id <> p.workspace_id)
               + (select count(*) from public.lead_candidates c join public.accounts p on p.id = c.account_id where c.workspace_id <> p.workspace_id)
               + (select count(*) from public.lead_candidates c join public.contacts p on p.id = c.contact_id where c.workspace_id <> p.workspace_id))::text
  union all
  select 'S06', 'OWN-01 composite keys installed (26 = held #177 applied; 0 = not applied)', 'decision',
         (select count(*) from graph_fk where cols = 2)::text
  union all
  select 'S07', 'canonical client tables (#176, held) present', 'decision',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('client_accounts', 'client_access_grants', 'client_company_brain'))::text
  union all
  select 'S08', 'execution ledger and credit tables exist', '2',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('lead_execution_calls', 'credit_transactions'))::text
)
select id, what, expected, actual,
       case when expected = 'decision' then 'INFO' when expected = actual then 'PASS' else 'FAIL' end as result
  from checks order by id;
rollback;
