-- Create table to store resume analysis results
CREATE TABLE IF NOT EXISTS public.resume_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume TEXT,
  candidate_name TEXT NOT NULL,
  email TEXT,
  strengths TEXT,
  weaknesses TEXT,
  risk_factor NUMERIC,
  reward_factor NUMERIC,
  fit_score NUMERIC,
  overall_factor NUMERIC,
  justification TEXT
);

-- Enable Row Level Security
ALTER TABLE public.resume_analyses ENABLE ROW LEVEL SECURITY;

-- Public read access (dashboard is public in this app)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'resume_analyses' 
      AND policyname = 'Public read resume analyses'
  ) THEN
    CREATE POLICY "Public read resume analyses"
    ON public.resume_analyses
    FOR SELECT
    USING (true);
  END IF;
END $$;

-- Helpful index for ordering
CREATE INDEX IF NOT EXISTS idx_resume_analyses_created_at 
  ON public.resume_analyses (created_at DESC);
