
-- ICP candidate profiles + lookalike sessions
CREATE TABLE IF NOT EXISTS public.icp_lookalike_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  profile_name text,
  user_id uuid,
  target_industry jsonb,
  industry_names jsonb,
  company_size text,
  company_location jsonb,
  hiring_intensity text,
  status text DEFAULT 'pending',
  scrape_status text,
  results_count integer DEFAULT 0,
  strong_matches_count integer DEFAULT 0,
  config jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  profile_name text,
  full_name text,
  headline text,
  linkedin_url text,
  current_company text,
  current_title text,
  location text,
  similarity_score integer,
  raw_data jsonb,
  enriched_data jsonb,
  inserted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.icp_lookalike_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed view icp sessions" ON public.icp_lookalike_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed manage icp sessions" ON public.icp_lookalike_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed view candidate profiles" ON public.candidate_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed manage candidate profiles" ON public.candidate_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Outreach engine tables
DO $$ BEGIN
  CREATE TYPE lead_tier AS ENUM ('unassigned', 'tier_1', 'tier_2', 'tier_3');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('not_started', 'in_sequence', 'replied', 'meeting_booked', 'closed', 'dead');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE sequence_status AS ENUM ('draft', 'active', 'paused');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE activity_status AS ENUM ('pending', 'sent', 'skipped', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.outreach_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status sequence_status DEFAULT 'draft',
    steps JSONB DEFAULT '[]'::jsonb,
    leads_enrolled INTEGER DEFAULT 0,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

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
    last_touch_date TIMESTAMPTZ,
    next_action_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.outreach_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.outreach_leads(id) ON DELETE CASCADE,
    sequence_id UUID REFERENCES public.outreach_sequences(id) ON DELETE SET NULL,
    step_number INTEGER,
    channel TEXT NOT NULL,
    action_type TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    scheduled_date TIMESTAMPTZ,
    executed_date TIMESTAMPTZ,
    status activity_status DEFAULT 'pending',
    response_received BOOLEAN DEFAULT false,
    response_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.outreach_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    product_context TEXT,
    email_signature TEXT,
    default_cta TEXT,
    linkedin_daily_connect_limit INTEGER DEFAULT 20,
    linkedin_daily_dm_limit INTEGER DEFAULT 40,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage outreach sequences" ON public.outreach_sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed manage outreach leads" ON public.outreach_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed manage outreach activities" ON public.outreach_activities FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed manage outreach settings" ON public.outreach_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Marketing tasks
CREATE TABLE IF NOT EXISTS public.marketing_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  description text,
  status text DEFAULT 'pending',
  priority text DEFAULT 'medium',
  due_date timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.marketing_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage marketing tasks" ON public.marketing_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Growth signal companies
CREATE TABLE IF NOT EXISTS public.growth_signal_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  website text,
  industry text,
  growth_score integer,
  signals jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.growth_signal_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage growth signals" ON public.growth_signal_companies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Job distribution
CREATE TABLE IF NOT EXISTS public.job_distribution_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  platform text NOT NULL,
  status text DEFAULT 'pending',
  external_url text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_distribution_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage job distribution" ON public.job_distribution_status FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.job_distribution_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  platform text,
  posted_at timestamptz,
  url text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_distribution_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage job postings dist" ON public.job_distribution_postings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Competitor intelligence
CREATE TABLE IF NOT EXISTS public.competitor_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  industry text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.competitor_companies(id) ON DELETE CASCADE,
  profile_data jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.competitor_job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  title text,
  url text,
  posted_at timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.competitor_intel_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  signal_type text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pricing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  price_data jsonb,
  observed_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.talent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  signal_type text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.firecrawl_scrape_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text,
  status text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.job_market_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.competitor_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_intel_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firecrawl_scrape_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_market_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed all competitor_companies" ON public.competitor_companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all competitor_profiles" ON public.competitor_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all competitor_job_postings" ON public.competitor_job_postings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all competitor_intel_signals" ON public.competitor_intel_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all pricing_history" ON public.pricing_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all talent_signals" ON public.talent_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all firecrawl_scrape_logs" ON public.firecrawl_scrape_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed all job_market_intelligence" ON public.job_market_intelligence FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Agent orchestration layer
CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  model text NOT NULL DEFAULT 'gpt-4o',
  system_prompt text,
  capabilities jsonb DEFAULT '[]'::jsonb,
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  goal text NOT NULL,
  steps jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  task_plan_id uuid REFERENCES public.task_plans(id) ON DELETE CASCADE,
  input jsonb,
  output jsonb,
  status text DEFAULT 'pending',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authed manage agents" ON public.agents;
DROP POLICY IF EXISTS "Authed manage task_plans" ON public.task_plans;
DROP POLICY IF EXISTS "Authed manage agent_runs" ON public.agent_runs;
CREATE POLICY "Authed manage agents" ON public.agents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed manage task_plans" ON public.task_plans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed manage agent_runs" ON public.agent_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Get_room_member_profiles function
CREATE OR REPLACE FUNCTION public.get_room_member_profiles(room_uuid uuid)
RETURNS TABLE (user_id uuid, full_name text, logo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.logo_url
  FROM profiles p
  INNER JOIN collaboration_room_members m ON m.user_id = p.user_id
  WHERE m.room_id = room_uuid;
$$;

-- Add missing columns referenced by codebase
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS sequence_name text;
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS folder_name text;
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS sequence_created_at timestamptz;
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS candidate_email text;
ALTER TABLE public.scraping_sessions ADD COLUMN IF NOT EXISTS scrape_run_id text;
ALTER TABLE public.adaptive_screening_sessions ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.adaptive_screening_sessions ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE public.adaptive_screening_sessions ADD COLUMN IF NOT EXISTS profile_name text;
