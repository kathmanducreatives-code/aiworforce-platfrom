
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
