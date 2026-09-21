-- LOCAL DEVELOPMENT SEED — the minimum a Lead V2 session needs, and nothing
-- copied from production.
--
-- One workspace, one dev login, a Company Brain with an ICP the mission
-- compiler reads, the five agents `orchestrate` knows by slug, and a credit
-- balance so the credit gate has something to reserve against. Every id is
-- fixed, so a rebuild produces the same ids and a bookmarked URL keeps working.
--
-- The password below is a LOCAL DEV CREDENTIAL for a database that exists only
-- on this machine. It is not a production secret and must never become one.
--
--   email    dev@agentory.local
--   password localdev123
--
-- Idempotent: every insert is `on conflict do nothing`, so it can be re-run.

\set ws_id       '00000000-0000-4000-a000-000000000001'
\set user_id     '00000000-0000-4000-b000-000000000001'

-- ── THE DEV LOGIN ────────────────────────────────────────────────────────────
-- GoTrue reads these rows; a locally-created user is a normal row with a
-- bcrypt password and a confirmed email (local config disables confirmations).
-- GoTrue scans the token columns as strings: they must be '' and never NULL,
-- or every sign-in fails with "Database error querying schema".
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', :'user_id', 'authenticated', 'authenticated',
  'dev@agentory.local', extensions.crypt('localdev123', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Local Dev"}'::jsonb, false, false,
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  :'user_id', :'user_id',
  format('{"sub":"%s","email":"dev@agentory.local","email_verified":true}', :'user_id')::jsonb,
  'email', now(), now(), now()
) on conflict (provider, provider_id) do nothing;

insert into public.profiles (user_id, full_name, email, role)
values (:'user_id', 'Local Dev', 'dev@agentory.local', 'user')
on conflict do nothing;

-- ── THE WORKSPACE ────────────────────────────────────────────────────────────
insert into public.workspaces (id, name, slug, plan, created_by)
values (:'ws_id', 'Local Dev Workspace', 'local-dev', 'pro', :'user_id')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
values (:'ws_id', :'user_id', 'owner')
on conflict do nothing;

-- Credits: the gate reserves before a paid call, so a local run needs a balance
-- to reach the point where the provider would be called (and refused).
insert into public.workspace_credit_balances (workspace_id, balance_credits, reserved_credits, plan_id)
values (:'ws_id', 5000, 0, 'local-dev')
on conflict (workspace_id) do nothing;

-- ── COMPANY BRAIN ────────────────────────────────────────────────────────────
-- What the mission compiler and the ICP reader actually consult. Fictional.
insert into public.company_brain (
  workspace_id, company_name, what_we_do, who_we_sell_to, voice_and_tone,
  profile, onboarding_completed
) values (
  :'ws_id', 'Agentory (local dev)',
  'An AI workforce that researches companies, finds leads and drafts outreach.',
  'B2B SaaS revenue teams at seed to Series A companies.',
  'Direct, concrete, no hype.',
  jsonb_build_object(
    'icp', jsonb_build_object(
      'industries', jsonb_build_array('B2B SaaS', 'fintech'),
      'company_stage', jsonb_build_array('seed', 'series_a'),
      'geography', jsonb_build_array('United States'),
      'company_size_min', 1, 'company_size_max', 150,
      'decision_maker_roles', jsonb_build_array('Head of Growth', 'VP Marketing')
    ),
    'positioning', 'Local development fixture — not production data.'
  ),
  true
) on conflict do nothing;

-- ── THE AGENTS `orchestrate` KNOWS BY SLUG ───────────────────────────────────
insert into public.agents (workspace_id, name, slug, role_prompt, department, model, is_default, is_active)
values
  (:'ws_id', 'Scout',  'scout',  'Finds and qualifies companies.',      'growth',  'claude-haiku-4-5', true, true),
  (:'ws_id', 'Aria',   'aria',   'Researches accounts and contacts.',   'growth',  'claude-haiku-4-5', true, true),
  (:'ws_id', 'Penn',   'penn',   'Drafts and exports outreach.',        'growth',  'claude-haiku-4-5', true, true),
  (:'ws_id', 'Hawk',   'hawk',   'Audits websites for evidence.',       'growth',  'claude-haiku-4-5', true, true),
  (:'ws_id', 'Scribe', 'scribe', 'Writes content.',                     'content', 'claude-haiku-4-5', true, true)
on conflict do nothing;

-- ── ONE FINISHED PLAN + TASK, so the Workbench has something to render ───────
-- A small, honest Lead V2 result: the shape `workbench_mission_view` readers
-- expect, with one qualified company. No provider was called to produce it.
insert into public.task_plans (id, workspace_id, user_id, user_instruction, plan_summary, status, created_at)
values (
  '00000000-0000-4000-c000-000000000001', :'ws_id', :'user_id',
  'Find 1 B2B SaaS company hiring growth marketers.',
  'Local development fixture plan.', 'complete', now() - interval '1 hour'
) on conflict (id) do nothing;

insert into public.tasks (
  id, plan_id, workspace_id, user_id, agent_slug, step_index, description,
  status, created_at, started_at, finished_at, result
) values (
  '00000000-0000-4000-d000-000000000001',
  '00000000-0000-4000-c000-000000000001', :'ws_id', :'user_id', 'scout', 0,
  'Execute the approved mission',
  'complete', now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes',
  jsonb_build_object(
    'task_status', 'completed',
    'terminal_status', 'quota_met',
    'quota', jsonb_build_object('requested_leads', 1, 'eligible_leads', 1),
    'company_first', jsonb_build_object('status', 'complete', 'quota',
      jsonb_build_object('requested_leads', 1, 'eligible_leads', 1)),
    'workbench_progress', jsonb_build_object('stage', 'complete', 'discovered', 1, 'qualified', 1),
    'workbench_mission_view', jsonb_build_object(
      'version', 'workbench-mission-view-v1',
      'stage', 'complete',
      'counts', jsonb_build_object('discovered', 1, 'screened_out', 0, 'investigating', 0,
        'identity_unresolved', 0, 'pending', 0, 'exact_match', 1, 'strong_opportunity', 0,
        'worth_considering', 0, 'low_priority', 0, 'ineligible', 0),
      'leads', jsonb_build_array(jsonb_build_object(
        'company', jsonb_build_object('key', 'local-dev-co', 'name', 'Localdev Labs',
          'domain', 'localdev.test', 'linkedin_url', null),
        'label', 'exact_match', 'bucket', 'exact_match',
        'hard_checks', jsonb_build_object('industry', 'pass', 'hiring', 'pass'),
        'why_surfaced', jsonb_build_array('B2B SaaS, stated on its own pricing page'),
        'evidence_coverage', 1, 'signal_strength', 1, 'evidence_gaps', jsonb_build_array()
      )),
      'cost', jsonb_build_object('model_usd', 0, 'provider_usd', 0)
    )
  )
) on conflict (id) do nothing;

select 'seeded: workspace ' || :'ws_id' || ', login dev@agentory.local / localdev123' as seed;
