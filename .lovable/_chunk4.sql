-- ============================================================
-- 20260220094029_1d51e44c-50f0-483b-b1a5-8ba5a3c2d02d.sql
-- ============================================================

-- Table 1: Job Distribution Status
CREATE TABLE public.job_distribution_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.screening_jobs(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  external_job_id text,
  posted_at timestamptz,
  last_synced_at timestamptz,
  feed_url text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

ALTER TABLE public.job_distribution_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own distributions"
  ON public.job_distribution_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own distributions"
  ON public.job_distribution_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own distributions"
  ON public.job_distribution_status FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own distributions"
  ON public.job_distribution_status FOR DELETE
  USING (auth.uid() = user_id);

-- Table 2: Growth Signal Companies
CREATE TABLE public.growth_signal_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  industry text,
  funding_round text,
  funding_amount numeric,
  funding_date date,
  investors jsonb DEFAULT '[]'::jsonb,
  open_roles_count integer NOT NULL DEFAULT 0,
  engineering_roles_count integer NOT NULL DEFAULT 0,
  sample_job_titles jsonb DEFAULT '[]'::jsonb,
  growth_score integer NOT NULL DEFAULT 0,
  is_hot_lead boolean NOT NULL DEFAULT false,
  source_url text,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

ALTER TABLE public.growth_signal_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own growth signals"
  ON public.growth_signal_companies FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own growth signals"
  ON public.growth_signal_companies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own growth signals"
  ON public.growth_signal_companies FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own growth signals"
  ON public.growth_signal_companies FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 20260223160000_marketing_tasks.sql
-- ============================================================
-- Migration for Marketing Tasks
-- Creates a table to store AI-generated and manual marketing tasks

CREATE TABLE IF NOT EXISTS public.marketing_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'marketing', -- e.g., 'content', 'research', 'campaign'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' or 'completed'
    scheduled_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.marketing_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.marketing_tasks FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON public.marketing_tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON public.marketing_tasks FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON public.marketing_tasks FOR DELETE USING (true);

-- Triggers
CREATE OR REPLACE FUNCTION update_marketing_tasks_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_marketing_tasks_updated_at
BEFORE UPDATE ON public.marketing_tasks
FOR EACH ROW
EXECUTE FUNCTION update_marketing_tasks_updated_at();

-- Add 'task' as a valid channel type to OutreachActivity for type compatibility in CommandCenter if needed later
-- But wait, CommandCenter parses tasks from different sources. We will keep marketing_tasks completely separate.

-- ============================================================
-- 20260223170000_enable_real_time_linkedin_posts.sql
-- ============================================================
-- Enable Real-Time for linkedin_posts table
-- This allows the ContentPlanner UI to listen to INSERT/UPDATE/DELETE events instantly

BEGIN;

-- Check if the table is already in the publication, and add it if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'linkedin_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.linkedin_posts;
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- 20260225180000_add_scheduled_date_linkedin_posts.sql
-- ============================================================
-- Add scheduled_date column to linkedin_posts for auto-publishing scheduling
-- This allows each post to be assigned a specific calendar date

ALTER TABLE public.linkedin_posts
ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Add an index for efficient date-based queries (N8N cron will query by date)
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_scheduled_date
ON public.linkedin_posts (scheduled_date)
WHERE scheduled_date IS NOT NULL;

-- Backfill: assign sequential dates starting from today for existing posts
DO $$
DECLARE
    post_record RECORD;
    day_offset INT := 0;
BEGIN
    FOR post_record IN
        SELECT id FROM public.linkedin_posts
        WHERE scheduled_date IS NULL
        ORDER BY created_at ASC
    LOOP
        UPDATE public.linkedin_posts
        SET scheduled_date = CURRENT_DATE + day_offset
        WHERE id = post_record.id;
        day_offset := day_offset + 1;
    END LOOP;
END
$$;

-- ============================================================
-- 20260303155822_979d7057-eb2d-4972-9b08-5de82dc59a27.sql
-- ============================================================
-- Allow anonymous uploads to screening-resumes bucket
CREATE POLICY "Allow anonymous uploads to screening-resumes"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'screening-resumes');

-- Allow authenticated users to read screening resumes
CREATE POLICY "Allow authenticated read on screening-resumes"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'screening-resumes');

-- Allow anonymous users to also read (for parse-resume to work via client)
CREATE POLICY "Allow anon read on screening-resumes"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'screening-resumes');

-- Also ensure screening_applications allows anonymous inserts (for public candidate flow)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous insert for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous insert for candidates" ON public.screening_applications FOR INSERT TO anon WITH CHECK (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous update for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous update for candidates" ON public.screening_applications FOR UPDATE TO anon USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous select for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous select for candidates" ON public.screening_applications FOR SELECT TO anon USING (true)';
  END IF;
END $$;
-- ============================================================
-- 20260310235000_firecrawl_integration.sql
-- ============================================================
-- 1. Track every platform a job is posted to
CREATE TABLE job_distribution_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES screening_jobs(id) ON DELETE CASCADE,
  platform_name TEXT NOT NULL,         -- 'LinkedIn', 'Indeed', 'Wellfound', etc.
  platform_url TEXT NOT NULL,           -- live URL of the posted job
  posted_at TIMESTAMPTZ,
  last_scraped_at TIMESTAMPTZ,
  scrape_status TEXT DEFAULT 'pending', -- pending | active | expired | removed
  scraped_title TEXT,
  scraped_description TEXT,
  scraped_salary TEXT,
  scraped_applicant_count TEXT,
  scraped_raw_data JSONB,
  drift_detected BOOLEAN DEFAULT FALSE, -- true if content differs from original
  drift_summary TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Competitor career page monitoring
CREATE TABLE competitor_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  company_name TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ,
  crawl_status TEXT DEFAULT 'pending',
  total_jobs_found INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE competitor_job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID REFERENCES competitor_companies(id) ON DELETE CASCADE,
  job_title TEXT,
  job_url TEXT,
  department TEXT,
  location TEXT,
  employment_type TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_new BOOLEAN DEFAULT TRUE,
  is_removed BOOLEAN DEFAULT FALSE,
  raw_data JSONB
);

-- 3. Firecrawl audit log
CREATE TABLE firecrawl_scrape_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  feature TEXT NOT NULL, -- 'job_importer' | 'distribution_sync' | 'competitor_monitor' | 'market_intel'
  url TEXT NOT NULL,
  status TEXT,           -- 'success' | 'failed' | 'partial'
  credits_used INTEGER,
  response_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Job market intelligence snapshots
CREATE TABLE job_market_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  job_id UUID REFERENCES screening_jobs(id),
  query_keyword TEXT,
  source_url TEXT,
  avg_salary_min INTEGER,
  avg_salary_max INTEGER,
  top_required_skills JSONB,
  common_titles JSONB,
  remote_percentage INTEGER,
  total_postings_found INTEGER,
  snapshot_date DATE DEFAULT CURRENT_DATE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 20260319033525_605407c3-e28b-40b9-9a01-c33105e64fe8.sql
-- ============================================================

-- COMPETITOR COMPANIES TABLE (referenced by existing code but missing)
CREATE TABLE public.competitor_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  company_name TEXT NOT NULL,
  website_url TEXT,
  careers_url TEXT,
  crawl_status TEXT DEFAULT 'pending',
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.competitor_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own competitor companies"
  ON public.competitor_companies FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- COMPETITOR JOB POSTINGS TABLE (referenced by existing code)
CREATE TABLE public.competitor_job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID REFERENCES public.competitor_companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  job_title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  job_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.competitor_job_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own competitor job postings"
  ON public.competitor_job_postings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- TALENT SIGNALS TABLE
CREATE TABLE public.talent_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  candidate_name TEXT,
  candidate_linkedin_url TEXT,
  candidate_email TEXT,
  candidate_title TEXT,
  candidate_company TEXT,
  candidate_location TEXT,
  candidate_photo_url TEXT,
  signal_type TEXT NOT NULL,
  signal_title TEXT NOT NULL,
  signal_summary TEXT,
  signal_source_url TEXT,
  signal_detected_at TIMESTAMPTZ DEFAULT NOW(),
  signal_score INTEGER DEFAULT 0,
  tier TEXT,
  is_actioned BOOLEAN DEFAULT FALSE,
  action_type TEXT,
  actioned_at TIMESTAMPTZ,
  is_dismissed BOOLEAN DEFAULT FALSE,
  matched_job_id UUID REFERENCES public.screening_jobs(id),
  role_match_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.talent_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own talent signals"
  ON public.talent_signals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- COMPETITOR INTEL SIGNALS TABLE
CREATE TABLE public.competitor_intel_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  competitor_id UUID REFERENCES public.competitor_companies(id),
  competitor_name TEXT,
  signal_type TEXT NOT NULL,
  signal_title TEXT NOT NULL,
  signal_summary TEXT,
  signal_data JSONB,
  signal_source_url TEXT,
  signal_date TIMESTAMPTZ,
  importance TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.competitor_intel_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own competitor intel signals"
  ON public.competitor_intel_signals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- COMPETITOR PROFILES TABLE
CREATE TABLE public.competitor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  competitor_id UUID REFERENCES public.competitor_companies(id),
  tagline TEXT,
  value_proposition TEXT,
  target_market TEXT,
  key_differentiators JSONB,
  pricing_model TEXT,
  pricing_tiers JSONB,
  last_pricing_change_at TIMESTAMPTZ,
  pricing_change_summary TEXT,
  key_features JSONB,
  recent_launches JSONB,
  total_employees_estimate INTEGER,
  engineering_headcount_estimate INTEGER,
  recent_executive_changes JSONB,
  g2_rating DECIMAL,
  g2_review_count INTEGER,
  top_praise JSONB,
  top_complaints JSONB,
  last_full_scan_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.competitor_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own competitor profiles"
  ON public.competitor_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- PRICING HISTORY TABLE
CREATE TABLE public.pricing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  competitor_id UUID REFERENCES public.competitor_companies(id),
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  pricing_data JSONB,
  change_detected BOOLEAN DEFAULT FALSE,
  change_summary TEXT,
  previous_entry_id UUID
);

ALTER TABLE public.pricing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pricing history"
  ON public.pricing_history FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 20260425110000_orchestration_layer.sql
-- ============================================================
-- ============================================================
-- Orchestration Layer
-- ============================================================

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Workspace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists workspace_members_ws_idx on public.workspace_members(workspace_id);

create or replace function public.is_workspace_member(_user_id uuid, _workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
    where user_id = _user_id and workspace_id = _workspace_id);
$$;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  name text not null,
  department text not null check (department in ('talent','growth','intelligence','content')),
  model text not null default 'gpt-4o',
  status text not null default 'idle' check (status in ('idle','running','awaiting_approval','error')),
  current_task text,
  progress int not null default 0,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index if not exists agents_ws_idx on public.agents(workspace_id);

create table if not exists public.agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  capability text not null,
  tool text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.task_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_instruction text not null,
  plan_summary text,
  status text not null default 'planning' check (status in ('planning','executing','awaiting_approval','complete','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists task_plans_ws_idx on public.task_plans(workspace_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  step_index int not null default 0,
  description text not null,
  status text not null default 'pending' check (status in ('pending','running','complete','failed','skipped')),
  input jsonb,
  output jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_plan_idx on public.tasks(plan_id);

create table if not exists public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  event_type text not null check (event_type in (
    'plan_created','agent_started','handoff','awaiting_approval',
    'approved','rejected','plan_complete')),
  title text not null,
  body text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_feed_ws_created_idx on public.activity_feed(workspace_id, created_at desc);

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.task_plans(id) on delete cascade,
  from_agent_id uuid references public.agents(id) on delete set null,
  to_agent_id uuid references public.agents(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.task_plans(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_ws_status_idx on public.approvals(workspace_id, status);

alter table public.workspaces           enable row level security;
alter table public.workspace_members    enable row level security;
alter table public.agents               enable row level security;
alter table public.agent_capabilities   enable row level security;
alter table public.task_plans           enable row level security;
alter table public.tasks                enable row level security;
alter table public.activity_feed        enable row level security;
alter table public.handoffs             enable row level security;
alter table public.approvals            enable row level security;

drop policy if exists "ws_select_own" on public.workspaces;
create policy "ws_select_own" on public.workspaces for select to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(auth.uid(), id));
drop policy if exists "ws_insert_own" on public.workspaces;
create policy "ws_insert_own" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "ws_update_owner" on public.workspaces;
create policy "ws_update_owner" on public.workspaces for update to authenticated using (owner_id = auth.uid());

drop policy if exists "wm_select_self_or_member" on public.workspace_members;
create policy "wm_select_self_or_member" on public.workspace_members for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "wm_insert_self" on public.workspace_members;
create policy "wm_insert_self" on public.workspace_members for insert to authenticated
  with check (user_id = auth.uid());

-- agents
drop policy if exists "agents_select_member" on public.agents;
create policy "agents_select_member" on public.agents for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "agents_write_member" on public.agents;
create policy "agents_write_member" on public.agents for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- task_plans
drop policy if exists "tp_select_member" on public.task_plans;
create policy "tp_select_member" on public.task_plans for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "tp_write_member" on public.task_plans;
create policy "tp_write_member" on public.task_plans for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- tasks (via plan)
drop policy if exists "tasks_select_member" on public.tasks;
create policy "tasks_select_member" on public.tasks for select to authenticated
  using (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));
drop policy if exists "tasks_write_member" on public.tasks;
create policy "tasks_write_member" on public.tasks for all to authenticated
  using (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)))
  with check (exists (select 1 from public.task_plans p where p.id = tasks.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));

-- activity_feed
drop policy if exists "af_select_member" on public.activity_feed;
create policy "af_select_member" on public.activity_feed for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "af_write_member" on public.activity_feed;
create policy "af_write_member" on public.activity_feed for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- handoffs (via plan)
drop policy if exists "hf_select_member" on public.handoffs;
create policy "hf_select_member" on public.handoffs for select to authenticated
  using (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));
drop policy if exists "hf_write_member" on public.handoffs;
create policy "hf_write_member" on public.handoffs for all to authenticated
  using (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)))
  with check (exists (select 1 from public.task_plans p where p.id = handoffs.plan_id
    and public.is_workspace_member(auth.uid(), p.workspace_id)));

-- approvals
drop policy if exists "appr_select_member" on public.approvals;
create policy "appr_select_member" on public.approvals for select to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id));
drop policy if exists "appr_write_member" on public.approvals;
create policy "appr_write_member" on public.approvals for all to authenticated
  using (public.is_workspace_member(auth.uid(), workspace_id))
  with check (public.is_workspace_member(auth.uid(), workspace_id));

-- agent_capabilities
drop policy if exists "ac_select_member" on public.agent_capabilities;
create policy "ac_select_member" on public.agent_capabilities for select to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)));
drop policy if exists "ac_write_member" on public.agent_capabilities;
create policy "ac_write_member" on public.agent_capabilities for all to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)))
  with check (exists (select 1 from public.agents a where a.id = agent_capabilities.agent_id
    and public.is_workspace_member(auth.uid(), a.workspace_id)));

-- realtime
alter table public.agents         replica identity full;
alter table public.activity_feed  replica identity full;
alter table public.approvals      replica identity full;
alter table public.task_plans     replica identity full;

do $$ begin
  begin alter publication supabase_realtime add table public.agents;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activity_feed; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.approvals;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_plans;    exception when duplicate_object then null; end;
end $$;

-- provisioning function
create or replace function public.provision_workspace_for_user(_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  select workspace_id into ws_id from public.workspace_members where user_id = _user_id limit 1;
  if ws_id is not null then return ws_id; end if;
  insert into public.workspaces (name, owner_id) values ('My Workspace', _user_id) returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, _user_id, 'owner');
  insert into public.agents (workspace_id, slug, name, department, model, status, current_task, progress) values
    (ws_id, 'aria',   'Aria',   'talent',       'gpt-4o',        'idle', 'Ready for tasks', 0),
    (ws_id, 'scout',  'Scout',  'talent',       'claude-sonnet', 'idle', 'Ready for tasks', 0),
    (ws_id, 'penn',   'Penn',   'growth',       'claude-sonnet', 'idle', 'Ready for tasks', 0),
    (ws_id, 'hawk',   'Hawk',   'intelligence', 'gemini-pro',    'idle', 'Ready for tasks', 0),
    (ws_id, 'scribe', 'Scribe', 'content',      'claude-haiku',  'idle', 'Ready for tasks', 0);
  return ws_id;
end $$;

create or replace function public.handle_new_user_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.provision_workspace_for_user(new.id);
  return new;
exception when others then return new;
end $$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace
  after insert on auth.users for each row execute function public.handle_new_user_workspace();

-- backfill
do $$ declare u record; begin
  for u in select id from auth.users loop
    perform public.provision_workspace_for_user(u.id);
  end loop;
end $$;

-- ============================================================
-- 20260425130000_agent_builder_fields.sql
-- ============================================================
-- Agent Builder: extend agents + agent_capabilities
alter table public.agents
  add column if not exists role_prompt   text,
  add column if not exists tools         text[] not null default '{}',
  add column if not exists trigger_type  text not null default 'on_demand',
  add column if not exists avatar_color  text not null default 'emerald',
  add column if not exists is_default    boolean not null default false;

alter table public.agents drop constraint if exists agents_department_check;
alter table public.agents
  add constraint agents_department_check
  check (department in ('talent','growth','intelligence','content','operations'));

alter table public.agent_capabilities
  add column if not exists input_type  text,
  add column if not exists output_type text,
  add column if not exists priority    int not null default 1;

update public.agents
set is_default = true
where slug in ('aria','scout','penn','hawk','scribe');

-- ============================================================
-- outreach.sql
-- ============================================================
-- Outreach Engine Tables

-- Drop existing types if they exist to allow re-running
DROP TYPE IF EXISTS lead_tier CASCADE;
DROP TYPE IF EXISTS lead_status CASCADE;
DROP TYPE IF EXISTS sequence_status CASCADE;
DROP TYPE IF EXISTS activity_status CASCADE;

-- Create Enums
CREATE TYPE lead_tier AS ENUM ('unassigned', 'tier_1', 'tier_2', 'tier_3');
CREATE TYPE lead_status AS ENUM ('not_started', 'in_sequence', 'replied', 'meeting_booked', 'closed', 'dead');
CREATE TYPE sequence_status AS ENUM ('draft', 'active', 'paused');
CREATE TYPE activity_status AS ENUM ('pending', 'sent', 'skipped', 'failed');

-- Outreach Sequences
CREATE TABLE IF NOT EXISTS public.outreach_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status sequence_status DEFAULT 'draft',
    steps JSONB DEFAULT '[]'::jsonb,
    leads_enrolled INTEGER DEFAULT 0,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Outreach Leads
CREATE TABLE IF NOT EXISTS public.outreach_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    linkedin_url TEXT,
    industry TEXT,
    company_size TEXT,
    notes TEXT,
    tier lead_tier DEFAULT 'unassigned',
    status lead_status DEFAULT 'not_started',
    signals JSONB DEFAULT '[]'::jsonb,
    sequence_id UUID REFERENCES public.outreach_sequences(id) ON DELETE SET NULL,
    current_sequence_step INTEGER DEFAULT 0,
    last_touch_date TIMESTAMP WITH TIME ZONE,
    next_action_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Outreach Activities
CREATE TABLE IF NOT EXISTS public.outreach_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.outreach_leads(id) ON DELETE CASCADE,
    sequence_id UUID REFERENCES public.outreach_sequences(id) ON DELETE SET NULL,
    step_number INTEGER,
    channel TEXT NOT NULL,
    action_type TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    scheduled_date TIMESTAMP WITH TIME ZONE,
    executed_date TIMESTAMP WITH TIME ZONE,
    status activity_status DEFAULT 'pending',
    response_received BOOLEAN DEFAULT false,
    response_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Outreach Settings
CREATE TABLE IF NOT EXISTS public.outreach_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID, -- If using Supabase Auth
    product_context TEXT,
    email_signature TEXT,
    default_cta TEXT,
    linkedin_daily_connect_limit INTEGER DEFAULT 20,
    linkedin_daily_dm_limit INTEGER DEFAULT 40,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

CREATE TRIGGER update_outreach_leads_modtime
    BEFORE UPDATE ON public.outreach_leads
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();

CREATE TRIGGER update_outreach_sequences_modtime
    BEFORE UPDATE ON public.outreach_sequences
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();

CREATE TRIGGER update_outreach_settings_modtime
    BEFORE UPDATE ON public.outreach_settings
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();

