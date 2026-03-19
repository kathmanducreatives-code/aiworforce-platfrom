
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
