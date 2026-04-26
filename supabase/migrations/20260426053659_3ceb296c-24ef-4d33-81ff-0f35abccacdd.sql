-- Stub tables that the migrations reference but never create
-- (they existed in the old project but were created via Supabase Studio)
CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'pending',
  send_time_utc TIMESTAMPTZ,
  scheduled_send_time TIMESTAMPTZ,
  candidate_id UUID,
  sequence_id UUID,
  step_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deep_search_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  query TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.linkedin_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  content TEXT,
  status TEXT DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 20240620120000_marketing_videos.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_name TEXT NOT NULL,
    script JSONB,
    background_video_url TEXT,
    final_video_url TEXT,
    thumbnail_url TEXT,
    duration INTEGER,
    has_motion_graphics BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_videos' AND column_name = 'background_video_url') THEN
        ALTER TABLE marketing_videos ADD COLUMN background_video_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_videos' AND column_name = 'has_motion_graphics') THEN
        ALTER TABLE marketing_videos ADD COLUMN has_motion_graphics BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ============================================================
-- 20250901090326 — resume_analyses
-- ============================================================
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
ALTER TABLE public.resume_analyses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 20250908103115 — recruitment_name
-- ============================================================
ALTER TABLE public.resume_analyses ADD COLUMN IF NOT EXISTS recruitment_name TEXT;

-- ============================================================
-- 20250924165738 — public access policies (final state)
-- ============================================================
DROP POLICY IF EXISTS "Public read resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Allow insert resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Allow delete resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can view resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can insert resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can update resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can delete resume analyses" ON public.resume_analyses;

CREATE POLICY "Public users can view resume analyses" ON public.resume_analyses FOR SELECT USING (true);
CREATE POLICY "Public users can insert resume analyses" ON public.resume_analyses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public users can update resume analyses" ON public.resume_analyses FOR UPDATE USING (true);
CREATE POLICY "Public users can delete resume analyses" ON public.resume_analyses FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_resume_analyses_created_at ON public.resume_analyses (created_at DESC);

-- ============================================================
-- 20251006083227 — extend resume_analyses + clients
-- ============================================================
ALTER TABLE public.resume_analyses
ADD COLUMN IF NOT EXISTS screening_type TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS processing_time_minutes INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS email_opened BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_clicked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS nurturing_stage TEXT,
ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'initial_screening';

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  contact_name TEXT,
  industry TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public users can view clients" ON public.clients;
CREATE POLICY "Public users can view clients" ON public.clients FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public users can insert clients" ON public.clients;
CREATE POLICY "Public users can insert clients" ON public.clients FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Public users can update clients" ON public.clients;
CREATE POLICY "Public users can update clients" ON public.clients FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Public users can delete clients" ON public.clients;
CREATE POLICY "Public users can delete clients" ON public.clients FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.client_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  placement_date DATE NOT NULL,
  time_to_fill_days INTEGER,
  cost_per_hire DECIMAL(10, 2),
  position_opened_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.client_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public users can view placements" ON public.client_placements;
CREATE POLICY "Public users can view placements" ON public.client_placements FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public users can insert placements" ON public.client_placements;
CREATE POLICY "Public users can insert placements" ON public.client_placements FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Public users can update placements" ON public.client_placements;
CREATE POLICY "Public users can update placements" ON public.client_placements FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Public users can delete placements" ON public.client_placements;
CREATE POLICY "Public users can delete placements" ON public.client_placements FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.client_active_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  position_level TEXT,
  posted_date DATE NOT NULL,
  status TEXT DEFAULT 'open',
  required_skills TEXT[],
  budget_range TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.client_active_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public users can view active positions" ON public.client_active_positions;
CREATE POLICY "Public users can view active positions" ON public.client_active_positions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public users can insert active positions" ON public.client_active_positions;
CREATE POLICY "Public users can insert active positions" ON public.client_active_positions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Public users can update active positions" ON public.client_active_positions;
CREATE POLICY "Public users can update active positions" ON public.client_active_positions FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Public users can delete active positions" ON public.client_active_positions;
CREATE POLICY "Public users can delete active positions" ON public.client_active_positions FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 20251013161043 — candidate notes + status
-- ============================================================
ALTER TABLE public.resume_analyses
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.candidate_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resume_analyses_status ON public.resume_analyses(status);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_candidate_id ON public.candidate_notes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_created_at ON public.candidate_notes(created_at DESC);

ALTER TABLE public.candidate_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view candidate notes" ON public.candidate_notes;
CREATE POLICY "Anyone can view candidate notes" ON public.candidate_notes FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Anyone can create notes" ON public.candidate_notes;
CREATE POLICY "Anyone can create notes" ON public.candidate_notes FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "Users can update their own notes" ON public.candidate_notes;
CREATE POLICY "Users can update their own notes" ON public.candidate_notes FOR UPDATE USING (auth.uid() = created_by);

-- ============================================================
-- 20251014163527 — scheduled_emails RLS (table now exists)
-- ============================================================
ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view scheduled emails" ON public.scheduled_emails;
CREATE POLICY "Anyone can view scheduled emails" ON public.scheduled_emails FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Anyone can create scheduled emails" ON public.scheduled_emails;
CREATE POLICY "Anyone can create scheduled emails" ON public.scheduled_emails FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update scheduled emails" ON public.scheduled_emails;
CREATE POLICY "Anyone can update scheduled emails" ON public.scheduled_emails FOR UPDATE TO public USING (true);
DROP POLICY IF EXISTS "Anyone can delete scheduled emails" ON public.scheduled_emails;
CREATE POLICY "Anyone can delete scheduled emails" ON public.scheduled_emails FOR DELETE TO public USING (true);