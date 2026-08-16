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
