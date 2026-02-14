
-- Create screening_jobs table
CREATE TABLE public.screening_jobs (
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

CREATE POLICY "Users can view their own screening jobs"
  ON public.screening_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own screening jobs"
  ON public.screening_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own screening jobs"
  ON public.screening_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own screening jobs"
  ON public.screening_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Public read policy for candidates accessing via slug
CREATE POLICY "Anyone can view active screening jobs by slug"
  ON public.screening_jobs FOR SELECT
  USING (status = 'active');

-- Create screening_applications table
CREATE TABLE public.screening_applications (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.screening_applications ENABLE ROW LEVEL SECURITY;

-- Candidates can insert (start an application)
CREATE POLICY "Anyone can create applications"
  ON public.screening_applications FOR INSERT
  WITH CHECK (true);

-- Candidates can update their own application by token
CREATE POLICY "Anyone can update applications by token"
  ON public.screening_applications FOR UPDATE
  USING (access_token IS NOT NULL);

-- Candidates can view their own application by token
CREATE POLICY "Anyone can view applications by token"
  ON public.screening_applications FOR SELECT
  USING (access_token IS NOT NULL);

-- Recruiters can view applications for their jobs
CREATE POLICY "Recruiters can view applications for their jobs"
  ON public.screening_applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.screening_jobs
    WHERE screening_jobs.id = screening_applications.job_id
    AND screening_jobs.user_id = auth.uid()
  ));

-- Create screening-resumes storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('screening-resumes', 'screening-resumes', false);

-- Anyone can upload resumes
CREATE POLICY "Anyone can upload resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'screening-resumes');

-- Anyone can read their uploaded resume
CREATE POLICY "Anyone can read screening resumes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'screening-resumes');
