-- ============================================================================
-- ONBOARDING PREREQUISITES — two objects the application has always needed and
-- never had.
-- ============================================================================
--
-- Both were found by a live onboarding attempt failing at "Founder analysis
-- failed", and NEITHER is a migration regression: both are absent from the old
-- project too. Migrations defining them were written, committed, and never
-- applied anywhere.
--
-- ── 1. company_brain_research_runs ──────────────────────────────────────────
--
-- `generate-company-brain-draft` calls `recordRun()` after every research step.
-- With no table the insert throws, the edge function returns 500, and the
-- browser's `catch` shows "Founder analysis failed" — a message that describes
-- the LinkedIn scrape failing when the scrape had in fact succeeded and the
-- audit write was what broke. The actor is fine: `apimaestro/linkedin-profile-
-- detail`, 18378 users, 4.64 from 64 ratings, no cookies required.
--
-- Taken from the unapplied 20260710120000, unchanged.
--
-- ── 2. provision_workspace_for_user ─────────────────────────────────────────
--
-- `handle_new_user` creates a PROFILE and nothing else — no workspace, no
-- membership. `orchestration.ts` calls this RPC to finish the job, and the RPC
-- does not exist, so every signed-up user has a profile and no workspace access
-- at all. RLS then hides everything from them, correctly, because they are a
-- member of nothing.
--
-- The archived version could never have worked: it inserts
-- `workspaces.owner_user_id`, a column this schema has never had — the real
-- column is `created_by`. That is very likely why it was never applied. It is
-- corrected here against the live schema rather than copied forward.

-- ── 1. RESEARCH RUN AUDIT ───────────────────────────────────────────────────

create table if not exists public.company_brain_research_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  source_type   text not null,
  provider      text not null,
  source_url    text,
  status        text not null,
  input         jsonb not null default '{}'::jsonb,
  output        jsonb not null default '{}'::jsonb,
  evidence      jsonb not null default '{}'::jsonb,
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists company_brain_research_runs_workspace_idx
  on public.company_brain_research_runs (workspace_id, created_at desc);
create index if not exists company_brain_research_runs_source_idx
  on public.company_brain_research_runs (workspace_id, source_type);

alter table public.company_brain_research_runs enable row level security;

drop policy if exists company_brain_research_runs_member_select
  on public.company_brain_research_runs;

-- READ-ONLY FOR MEMBERS. Writes come from the edge function under the service
-- role, so no INSERT/UPDATE/DELETE policy is granted to `authenticated` — a
-- client that could forge a research run could forge the evidence behind a
-- Company Brain.
create policy company_brain_research_runs_member_select
  on public.company_brain_research_runs
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = company_brain_research_runs.workspace_id
      and m.user_id = auth.uid()
  ));

-- ── 2. WORKSPACE PROVISIONING ───────────────────────────────────────────────

create or replace function public.provision_workspace_for_user(_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  new_id uuid;
  display_name text;
begin
  -- IDEMPOTENT BY DESIGN. The frontend calls this on load, so it runs on every
  -- session; returning the existing workspace is the common path, not the edge
  -- case.
  select workspace_id into existing_id
  from public.workspace_members
  where user_id = _user_id
  order by created_at asc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  select coalesce(nullif(p.full_name, ''), 'My Workspace')
    into display_name
  from public.profiles p
  where p.user_id = _user_id
  limit 1;

  if display_name is null then
    display_name := 'My Workspace';
  end if;

  -- `created_by`, not `owner_user_id`. The archived version named a column this
  -- schema has never had, which is why it could not be applied.
  insert into public.workspaces (name, created_by)
  values (display_name || '''s Workspace', _user_id)
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, _user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  -- An empty Brain so onboarding has a row to write into. `workspace_id` is the
  -- primary key here, so the conflict target is the table's own identity.
  insert into public.company_brain (workspace_id, profile)
  values (new_id, '{}'::jsonb)
  on conflict (workspace_id) do nothing;

  return new_id;
end;
$$;

grant execute on function public.provision_workspace_for_user(uuid) to authenticated;

-- ── 3. BACKFILL ─────────────────────────────────────────────────────────────
--
-- Anyone who signed up while the RPC was missing has a profile and no
-- workspace. Without this they would stay locked out until they happened to
-- reload after the fix.
do $$
declare u record;
begin
  for u in
    select p.user_id from public.profiles p
    where not exists (
      select 1 from public.workspace_members m where m.user_id = p.user_id
    )
  loop
    perform public.provision_workspace_for_user(u.user_id);
  end loop;
end $$;
