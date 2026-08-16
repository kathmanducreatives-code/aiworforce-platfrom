-- Enable required extensions for cron jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Add a name column to scraping_sessions for folder organization
ALTER TABLE public.scraping_sessions ADD COLUMN IF NOT EXISTS name text;

-- Backfill orphaned leads
WITH lead_sessions AS (
  SELECT 
    l.id as lead_id,
    (SELECT s.id 
     FROM scraping_sessions s 
     WHERE s.created_at <= l.created_at 
     ORDER BY s.created_at DESC 
     LIMIT 1) as matched_session_id
  FROM linkedin_leads l
  WHERE l.session_id IS NULL
)
UPDATE linkedin_leads
SET session_id = lead_sessions.matched_session_id
FROM lead_sessions
WHERE linkedin_leads.id = lead_sessions.lead_id
  AND lead_sessions.matched_session_id IS NOT NULL;

UPDATE scraping_sessions s
SET total_leads = (
  SELECT COUNT(*) 
  FROM linkedin_leads l 
  WHERE l.session_id = s.id
);

-- Collaboration rooms permissive policies
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON collaboration_rooms;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;

CREATE POLICY "Authenticated users can create rooms"
ON collaboration_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view rooms they are members of or created"
ON collaboration_rooms FOR SELECT TO authenticated
USING (is_room_member(auth.uid(), id) OR auth.uid() = created_by);

-- Enable RLS on deep_search_analysis table
ALTER TABLE deep_search_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view deep search analysis" ON deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can insert deep search analysis" ON deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can update deep search analysis" ON deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can delete deep search analysis" ON deep_search_analysis;

CREATE POLICY "Authenticated users can view deep search analysis" ON deep_search_analysis FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert deep search analysis" ON deep_search_analysis FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update deep search analysis" ON deep_search_analysis FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete deep search analysis" ON deep_search_analysis FOR DELETE TO authenticated USING (true);

-- Create job_postings table
CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  description text,
  required_skills text[],
  experience_level text,
  location text,
  salary_min integer,
  salary_max integer,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view job postings" ON job_postings;
DROP POLICY IF EXISTS "Authenticated users can manage job postings" ON job_postings;
CREATE POLICY "Authenticated users can view job postings" ON job_postings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage job postings" ON job_postings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Adaptive screening tables
CREATE TABLE IF NOT EXISTS public.screening_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  scenario_prompt text NOT NULL,
  follow_up_prompts jsonb DEFAULT '[]'::jsonb,
  difficulty_level text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.adaptive_screening_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid,
  job_id uuid,
  session_status text DEFAULT 'in_progress',
  role_briefing jsonb,
  scenario_config jsonb,
  total_score numeric,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.screening_conversation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  role text,
  content text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.screening_behavioral_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  trait_scores jsonb,
  summary text,
  red_flags jsonb,
  strengths jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.screening_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adaptive_screening_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_conversation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_behavioral_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view scenarios" ON public.screening_scenarios FOR SELECT USING (true);
CREATE POLICY "Anyone can view sessions" ON public.adaptive_screening_sessions FOR SELECT USING (true);
CREATE POLICY "Anyone can manage sessions" ON public.adaptive_screening_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can view conversation logs" ON public.screening_conversation_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert conversation logs" ON public.screening_conversation_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view behavioral analysis" ON public.screening_behavioral_analysis FOR SELECT USING (true);
CREATE POLICY "Anyone can manage behavioral analysis" ON public.screening_behavioral_analysis FOR ALL USING (true) WITH CHECK (true);

-- Screening templates
CREATE TABLE IF NOT EXISTS public.screening_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.screening_template_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.screening_templates(id) ON DELETE CASCADE,
  scenario_id uuid,
  category text,
  scenario_prompt text,
  follow_up_prompts jsonb,
  difficulty_level text,
  display_order integer,
  is_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.screening_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_template_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view templates" ON public.screening_templates FOR SELECT USING (true);
CREATE POLICY "Authed manage templates" ON public.screening_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can view template questions" ON public.screening_template_questions FOR SELECT USING (true);
CREATE POLICY "Authed manage template questions" ON public.screening_template_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Screening jobs and applications
CREATE TABLE IF NOT EXISTS public.screening_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  required_years integer NOT NULL DEFAULT 0,
  required_skills text[] NOT NULL DEFAULT '{}',
  education_requirement text NOT NULL DEFAULT 'None',
  salary_min integer,
  salary_max integer,
  custom_questions jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.screening_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own screening jobs" ON public.screening_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own screening jobs" ON public.screening_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own screening jobs" ON public.screening_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own screening jobs" ON public.screening_jobs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view active screening jobs by slug" ON public.screening_jobs FOR SELECT USING (status = 'active');

CREATE TABLE IF NOT EXISTS public.screening_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.screening_jobs(id) ON DELETE CASCADE,
  access_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'started',
  resume_url text,
  extracted_data jsonb,
  candidate_edits jsonb,
  screening_answers jsonb DEFAULT '[]'::jsonb,
  tab_switches integer NOT NULL DEFAULT 0,
  total_time_seconds integer NOT NULL DEFAULT 0,
  match_score integer,
  match_category text,
  strengths jsonb DEFAULT '[]'::jsonb,
  red_flags jsonb DEFAULT '[]'::jsonb,
  interview_questions jsonb DEFAULT '[]'::jsonb,
  recruiter_status text DEFAULT 'new',
  recruiter_notes text,
  is_archived boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.screening_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can create applications" ON public.screening_applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update applications by token" ON public.screening_applications FOR UPDATE USING (access_token IS NOT NULL);
CREATE POLICY "Anyone can view applications by token" ON public.screening_applications FOR SELECT USING (access_token IS NOT NULL);
CREATE POLICY "Recruiters can view applications for their jobs" ON public.screening_applications FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.screening_jobs WHERE screening_jobs.id = screening_applications.job_id AND screening_jobs.user_id = auth.uid()));

-- Storage bucket for screening resumes
INSERT INTO storage.buckets (id, name, public) VALUES ('screening-resumes', 'screening-resumes', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Anyone can upload resumes" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read screening resumes" ON storage.objects;
CREATE POLICY "Anyone can upload resumes" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'screening-resumes');
CREATE POLICY "Anyone can read screening resumes" ON storage.objects FOR SELECT USING (bucket_id = 'screening-resumes');

-- Add columns referenced by code
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS candidate_name text;
ALTER TABLE public.scheduled_emails ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS logo_url text;
