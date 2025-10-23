-- Create deep_search_results table
CREATE TABLE IF NOT EXISTS public.deep_search_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id uuid REFERENCES public.linkedin_leads(id) ON DELETE CASCADE,
  candidate_name text NOT NULL,
  linkedin_url text,
  company text,
  fit_score integer CHECK (fit_score >= 0 AND fit_score <= 100),
  ai_summary text,
  strengths text[],
  weaknesses text[],
  ideal_roles text[],
  company_match_notes text,
  ai_confidence_level integer CHECK (ai_confidence_level >= 0 AND ai_confidence_level <= 100),
  raw_analysis jsonb,
  status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.deep_search_results ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view deep search results"
  ON public.deep_search_results
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert deep search results"
  ON public.deep_search_results
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update deep search results"
  ON public.deep_search_results
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete deep search results"
  ON public.deep_search_results
  FOR DELETE
  USING (true);

-- Create index for faster queries
CREATE INDEX idx_deep_search_candidate_id ON public.deep_search_results(candidate_id);
CREATE INDEX idx_deep_search_status ON public.deep_search_results(status);