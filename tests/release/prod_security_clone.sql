-- PRODUCTION-SHAPED CLONE of the surface the two security migrations touch.
-- Extracted read-only from the production catalog (ohsdatpvfdjdemstoiuj) on
-- 2026-11-12: exact columns, RLS flags, every policy and every grant on
-- approvals, signal_events, signal_event_evidence, monitoring_subjects,
-- lead_execution_calls, workspace_members, workspaces; the lead_model_calls
-- view definition and options; has_workspace_access(). No production rows.
-- Localhost only (tests/release/rehearse-prod-security.sh).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
-- Supabase ships pgcrypto in the `extensions` schema (production: verified 2026-11-12).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.workspaces (id uuid not null primary key, name text not null, company_brain text, plan text, daily_run_limit integer, tokens_used_today integer, created_at timestamptz, slug text, created_by uuid, updated_at timestamptz);
create table public.workspace_members (id uuid not null default gen_random_uuid() primary key, workspace_id uuid not null, user_id uuid not null, role text not null, created_at timestamptz not null default now());
create table public.approvals (id uuid not null default gen_random_uuid() primary key, workspace_id uuid, task_id uuid, task_plan_id uuid, agent_id uuid, title text, summary text, payload jsonb, status text, resolved_at timestamptz, created_at timestamptz, user_id uuid, plan_id uuid, agent_slug text, type text, description text, body text, metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.signal_events (id uuid not null default gen_random_uuid() primary key, workspace_id uuid not null, contact_id uuid, account_id uuid, lead_candidate_id uuid, signal_type text not null, signal_category text not null, evidence_category text, occurred_at timestamptz, observed_at timestamptz not null default now(), expires_at timestamptz, freshness text, confidence text, verification_status text not null, listing_status text, normalized_value jsonb not null default '{}', dedupe_key text not null, lifecycle_status text not null, sanitized boolean not null default false, provider text, actor_key text, actor_id text, source_url text, legacy_signal_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), origin text not null, subject_type text, subject_key text, occurred_at_basis text not null);
create table public.signal_event_evidence (id uuid not null default gen_random_uuid() primary key, workspace_id uuid not null, signal_event_id uuid not null, provider text, actor_key text, actor_id text, source_url text, source_record_id text, evidence_fingerprint text not null, observed_at timestamptz not null default now(), verification_status text not null, confidence text, normalized_value jsonb not null default '{}', sanitized boolean not null default false, legacy_signal_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.monitoring_subjects (id uuid not null default gen_random_uuid() primary key, workspace_id uuid not null, subject_kind text not null, identifier text, label text, signals jsonb not null default '[]', timeframe_days integer, enabled boolean not null default true, cadence_minutes integer, last_run_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), claimed_at timestamptz);
create table public.lead_execution_calls (id uuid not null default gen_random_uuid() primary key, workspace_id uuid not null, task_id uuid, plan_id uuid, execution_owner text, planner_owner text, stage text not null, capability text, reason text not null, provider_id text not null, actor_id text, provider_run_id text, dataset_id text, request_input jsonb, logical_call_key text not null, attempt_number integer not null, status text not null, failure_code text, failure_message text, started_at timestamptz not null default now(), finished_at timestamptz, duration_ms integer, raw_count integer, normalized_count integer, unique_count integer, accepted_count integer, rejected_count integer, actual_cost_usd numeric(12,6), estimated_cost_usd numeric(12,6), cost_source text not null, next_decision text, metadata jsonb, created_at timestamptz not null default now(), planner_adapter text, planner_outcome text, planner_fallback_reason text, record_kind text not null, provider_call_id text, idempotency_key text, plan_version integer, route_id text, settled_usd numeric, settlement_source text, variance_usd numeric);

create or replace function public.has_workspace_access(_user_id uuid, _workspace_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as
$$ select exists (select 1 from public.workspace_members where user_id = _user_id and workspace_id = _workspace_id); $$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.approvals enable row level security;
alter table public.signal_events enable row level security;
alter table public.signal_event_evidence enable row level security;
alter table public.monitoring_subjects enable row level security;
alter table public.lead_execution_calls enable row level security;

create policy approvals_workspace_member_access on public.approvals as permissive for all to authenticated using (has_workspace_access(auth.uid(), workspace_id)) with check (has_workspace_access(auth.uid(), workspace_id));
create policy "Members view lead_execution_calls" on public.lead_execution_calls as permissive for select to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "ms members update" on public.monitoring_subjects as permissive for update to authenticated using (has_workspace_access(auth.uid(), workspace_id)) with check (has_workspace_access(auth.uid(), workspace_id));
create policy "ms members delete" on public.monitoring_subjects as permissive for delete to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "ms members insert" on public.monitoring_subjects as permissive for insert to authenticated with check (has_workspace_access(auth.uid(), workspace_id));
create policy "ms members read" on public.monitoring_subjects as permissive for select to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_event_evidence members update" on public.signal_event_evidence as permissive for update to authenticated using (has_workspace_access(auth.uid(), workspace_id)) with check (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_event_evidence members read" on public.signal_event_evidence as permissive for select to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_event_evidence members insert" on public.signal_event_evidence as permissive for insert to authenticated with check (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_event_evidence members delete" on public.signal_event_evidence as permissive for delete to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_events members delete" on public.signal_events as permissive for delete to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_events members update" on public.signal_events as permissive for update to authenticated using (has_workspace_access(auth.uid(), workspace_id)) with check (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_events members read" on public.signal_events as permissive for select to authenticated using (has_workspace_access(auth.uid(), workspace_id));
create policy "signal_events members insert" on public.signal_events as permissive for insert to authenticated with check (has_workspace_access(auth.uid(), workspace_id));
create policy members_self_select on public.workspace_members as permissive for select to authenticated using ((user_id = auth.uid()));
create policy workspaces_member_select on public.workspaces as permissive for select to authenticated using (has_workspace_access(auth.uid(), id));

-- Grants exactly as production holds them.
revoke all on all tables in schema public from anon, authenticated, service_role;
grant references, select, trigger on public.approvals, public.signal_events, public.signal_event_evidence, public.monitoring_subjects, public.lead_execution_calls, public.workspace_members, public.workspaces to anon;
grant delete, insert, references, select, trigger, update on public.approvals, public.signal_events, public.signal_event_evidence, public.monitoring_subjects, public.lead_execution_calls to authenticated;
grant references, select, trigger on public.workspace_members, public.workspaces to authenticated;
grant all on public.approvals, public.signal_events, public.signal_event_evidence, public.monitoring_subjects, public.lead_execution_calls, public.workspace_members, public.workspaces to service_role;

create view public.lead_model_calls as
 select id, workspace_id, task_id, plan_id, logical_call_key, attempt_number, status,
    metadata ->> 'role' as role, metadata ->> 'model' as model, metadata ->> 'reasoning_effort' as reasoning_effort,
    (metadata ->> 'input_tokens')::bigint as input_tokens, (metadata ->> 'cached_input_tokens')::bigint as cached_input_tokens,
    (metadata ->> 'output_tokens')::bigint as output_tokens, duration_ms as latency_ms, estimated_cost_usd, actual_cost_usd,
    cost_source, metadata ->> 'fallback_reason' as fallback_reason, failure_code, failure_message, started_at, finished_at
   from lead_execution_calls where record_kind = 'model_call';
grant all on public.lead_model_calls to anon, authenticated, service_role;

-- Fictional seed: two workspaces, one member each.
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000000a1','A'),('00000000-0000-4000-8000-0000000000b1','B');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000a001','owner'),
  ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000b001','owner');
insert into public.approvals (workspace_id, title) values ('00000000-0000-4000-8000-0000000000a1','a'),('00000000-0000-4000-8000-0000000000b1','b');
insert into public.signal_events (workspace_id, signal_type, signal_category, verification_status, dedupe_key, lifecycle_status, origin, occurred_at_basis) values
  ('00000000-0000-4000-8000-0000000000a1','x','growth','unverified','k1','active','manual_scan','source_reported'),
  ('00000000-0000-4000-8000-0000000000b1','x','growth','unverified','k2','active','manual_scan','source_reported');
insert into public.lead_execution_calls (workspace_id, stage, reason, provider_id, logical_call_key, attempt_number, status, cost_source, record_kind, estimated_cost_usd) values
  ('00000000-0000-4000-8000-0000000000a1','s','r','openai','c1',1,'succeeded','estimated','model_call',0.01),
  ('00000000-0000-4000-8000-0000000000b1','s','r','openai','c2',1,'succeeded','estimated','model_call',0.02);
