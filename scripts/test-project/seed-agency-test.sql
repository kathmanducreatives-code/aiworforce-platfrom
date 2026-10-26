-- SEED THE AGENCY-ONLY TEST WORKSPACE. Writes; needs explicit approval. One
-- transaction; refuses rather than overwrites anything that is not test setup.
--
--   psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -v workspace_id='<TEST_WORKSPACE_ID>' -v user_id='<auth user id>' -f scripts/test-project/seed-agency-test.sql
--
-- The user must already exist in auth.users (create it through Supabase Auth,
-- never by SQL on a hosted project). Then, idempotently:
--   * the workspace (created if absent, named as synthetic test data);
--   * the user as its owner (an existing membership is left as it is);
--   * the `scout` agent;
--   * the credit balance at EXACTLY 10, 0 reserved (preflight P09; the judge's R3).
-- Refuses (and writes nothing) when: the user is missing; a Company Brain row
-- exists for the workspace (it is never deleted here: use another synthetic
-- workspace); credits are reserved; an authorization is live; or a mission is
-- claimable. Prints the resulting state.
select set_config('seed.workspace_id', :'workspace_id', true), set_config('seed.user_id', :'user_id', true);
do $seed$
declare
  ws uuid := current_setting('seed.workspace_id')::uuid;
  usr uuid := current_setting('seed.user_id')::uuid;
begin
  if not exists (select 1 from auth.users where id = usr) then
    raise exception 'seed: user % is not in auth.users; create it through Supabase Auth first', usr;
  end if;
  if exists (select 1 from public.company_brain where workspace_id = ws) then
    raise exception 'seed: workspace % has a Company Brain row; it is never deleted here, use another synthetic workspace', ws;
  end if;
  if exists (select 1 from public.workspace_credit_balances where workspace_id = ws and reserved_credits <> 0) then
    raise exception 'seed: workspace % has reserved credits; settle them first', ws;
  end if;
  if exists (select 1 from public.discovery_smoke_authorizations a join public.lead_mission_queue q on q.id = a.queue_id
              where q.workspace_id = ws and a.status = 'active' and a.deadline_at > now()) then
    raise exception 'seed: a smoke authorization is live for workspace %; stop it first', ws;
  end if;
  if exists (select 1 from public.lead_mission_queue where workspace_id = ws and status in ('queued', 'running', 'resumable')) then
    raise exception 'seed: workspace % has a claimable mission', ws;
  end if;

  insert into public.workspaces (id, name) values (ws, 'Agentory TEST (synthetic, agency-only)') on conflict (id) do nothing;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner')
    on conflict do nothing;
  insert into public.agents (workspace_id, slug, name, role_prompt, department)
  select ws, 'scout', 'Scout', 'Find and verify the requested company using source evidence.', 'research'
   where not exists (select 1 from public.agents where workspace_id = ws and slug = 'scout');
  insert into public.workspace_credit_balances (workspace_id, balance_credits) values (ws, 10)
    on conflict (workspace_id) do update set balance_credits = 10, updated_at = now();
end
$seed$;
select 'workspace' as item, (select name from public.workspaces where id = :'workspace_id'::uuid) as state
union all select 'member role', (select role from public.workspace_members where workspace_id = :'workspace_id'::uuid and user_id = :'user_id'::uuid)
union all select 'scout agent', (select count(*)::text from public.agents where workspace_id = :'workspace_id'::uuid and slug = 'scout')
union all select 'credits', (select format('balance=%s, reserved=%s', balance_credits, reserved_credits)
                               from public.workspace_credit_balances where workspace_id = :'workspace_id'::uuid);
