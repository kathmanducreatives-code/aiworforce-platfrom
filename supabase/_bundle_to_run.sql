-- ============================================================
-- 20240620120000_marketing_videos.sql
-- ============================================================
-- Create marketing_videos table if it doesn't exist
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

-- Add columns if table already exists but columns are missing (idempotent)
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
-- 20250901090326_a2e0b97d-500f-4d2a-b252-35da2e0fd9dd.sql
-- ============================================================
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

-- ============================================================
-- 20250902161534_5734d94a-5006-43eb-bed1-c5a2fa65bddd.sql
-- ============================================================
-- Add RLS policy to allow delete operations on resume_analyses table
CREATE POLICY "Allow delete resume analyses" 
ON public.resume_analyses 
FOR DELETE 
USING (true);
-- ============================================================
-- 20250908103115_c531463e-c465-4b0f-9194-0629636f1063.sql
-- ============================================================
-- Add recruitment_name column to resume_analyses table
ALTER TABLE public.resume_analyses 
ADD COLUMN recruitment_name TEXT;
-- ============================================================
-- 20250924112508_a3a0a4f2-7182-4907-ab86-fce0c646f3ac.sql
-- ============================================================
-- Remove the current public read policy that exposes candidate data
DROP POLICY IF EXISTS "Public read resume analyses" ON public.resume_analyses;

-- Create secure policies that require authentication
CREATE POLICY "Authenticated users can view resume analyses" 
ON public.resume_analyses 
FOR SELECT 
TO authenticated 
USING (true);

-- Update insert policy to only allow authenticated users
DROP POLICY IF EXISTS "Allow insert resume analyses" ON public.resume_analyses;
CREATE POLICY "Authenticated users can insert resume analyses" 
ON public.resume_analyses 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Update delete policy to only allow authenticated users
DROP POLICY IF EXISTS "Allow delete resume analyses" ON public.resume_analyses;
CREATE POLICY "Authenticated users can delete resume analyses" 
ON public.resume_analyses 
FOR DELETE 
TO authenticated 
USING (true);

-- Add update policy for authenticated users
CREATE POLICY "Authenticated users can update resume analyses" 
ON public.resume_analyses 
FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);
-- ============================================================
-- 20250924165738_fcf4a843-6461-41d9-9cfb-759a1502913a.sql
-- ============================================================
-- Temporarily disable RLS for resume_analyses to allow public access
-- This will allow the dashboard to display data without authentication
ALTER TABLE resume_analyses DISABLE ROW LEVEL SECURITY;

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can view resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can insert resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can update resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can delete resume analyses" ON resume_analyses;

-- Re-enable RLS with public access policies
ALTER TABLE resume_analyses ENABLE ROW LEVEL SECURITY;

-- Create new policies that allow public access
CREATE POLICY "Public users can view resume analyses" 
ON resume_analyses 
FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert resume analyses" 
ON resume_analyses 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update resume analyses" 
ON resume_analyses 
FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete resume analyses" 
ON resume_analyses 
FOR DELETE 
USING (true);
-- ============================================================
-- 20251006083227_9aa8e038-a4c3-4640-bfe1-2bb06504f92e.sql
-- ============================================================
-- Phase 1: Extend resume_analyses table for enhanced tracking
ALTER TABLE resume_analyses 
ADD COLUMN IF NOT EXISTS screening_type TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS processing_time_minutes INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS email_opened BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_clicked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS nurturing_stage TEXT CHECK (nurturing_stage IN ('initial', 'engaged', 'follow_up', 'closed')),
ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'initial_screening' CHECK (current_stage IN ('initial_screening', 'under_review', 'interview_ready', 'top_candidate', 'placed', 'rejected'));

-- Phase 2: Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  contact_name TEXT,
  industry TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Create policies for clients table
CREATE POLICY "Public users can view clients" 
ON clients FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert clients" 
ON clients FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update clients" 
ON clients FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete clients" 
ON clients FOR DELETE 
USING (true);

-- Phase 3: Create client_placements table
CREATE TABLE IF NOT EXISTS client_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES resume_analyses(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  placement_date DATE NOT NULL,
  time_to_fill_days INTEGER,
  cost_per_hire DECIMAL(10, 2),
  position_opened_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on client_placements
ALTER TABLE client_placements ENABLE ROW LEVEL SECURITY;

-- Create policies for client_placements table
CREATE POLICY "Public users can view placements" 
ON client_placements FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert placements" 
ON client_placements FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update placements" 
ON client_placements FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete placements" 
ON client_placements FOR DELETE 
USING (true);

-- Phase 4: Create client_active_positions table
CREATE TABLE IF NOT EXISTS client_active_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  position_level TEXT CHECK (position_level IN ('entry', 'mid', 'senior', 'executive')),
  posted_date DATE NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'filled', 'cancelled')),
  required_skills TEXT[],
  budget_range TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on client_active_positions
ALTER TABLE client_active_positions ENABLE ROW LEVEL SECURITY;

-- Create policies for client_active_positions table
CREATE POLICY "Public users can view active positions" 
ON client_active_positions FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert active positions" 
ON client_active_positions FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update active positions" 
ON client_active_positions FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete active positions" 
ON client_active_positions FOR DELETE 
USING (true);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for clients table
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
-- ============================================================
-- 20251013161043_7652666e-041f-4bcd-9dd5-0ddbe1fc5907.sql
-- ============================================================
-- Add status tracking columns to resume_analyses table
ALTER TABLE resume_analyses 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES auth.users(id);

-- Create table for candidate notes
CREATE TABLE IF NOT EXISTS candidate_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES resume_analyses(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_resume_analyses_status ON resume_analyses(status);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_candidate_id ON candidate_notes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_created_at ON candidate_notes(created_at DESC);

-- Enable RLS for candidate_notes
ALTER TABLE candidate_notes ENABLE ROW LEVEL SECURITY;

-- Create policies for candidate_notes
CREATE POLICY "Users can view all candidate notes" 
ON candidate_notes 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can create notes" 
ON candidate_notes 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own notes" 
ON candidate_notes 
FOR UPDATE 
USING (auth.uid() = created_by);
-- ============================================================
-- 20251014163421_9684a7e2-f793-4062-bda1-e1fb44ddd811.sql
-- ============================================================
-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create notes" ON public.candidate_notes;

-- Create a new public INSERT policy that allows anyone to add notes
CREATE POLICY "Anyone can create notes"
ON public.candidate_notes
FOR INSERT
TO public
WITH CHECK (true);

-- Update the SELECT policy to ensure it's also public
DROP POLICY IF EXISTS "Users can view all candidate notes" ON public.candidate_notes;

CREATE POLICY "Anyone can view candidate notes"
ON public.candidate_notes
FOR SELECT
TO public
USING (true);
-- ============================================================
-- 20251014163527_b84b72ad-8873-4445-8b6e-d337603e340a.sql
-- ============================================================
-- Enable RLS on scheduled_emails table
ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;

-- Add policy to allow anyone to view scheduled emails
CREATE POLICY "Anyone can view scheduled emails"
ON public.scheduled_emails
FOR SELECT
TO public
USING (true);

-- Add policy to allow anyone to insert scheduled emails
CREATE POLICY "Anyone can create scheduled emails"
ON public.scheduled_emails
FOR INSERT
TO public
WITH CHECK (true);

-- Add policy to allow anyone to update scheduled emails
CREATE POLICY "Anyone can update scheduled emails"
ON public.scheduled_emails
FOR UPDATE
TO public
USING (true);

-- Add policy to allow anyone to delete scheduled emails
CREATE POLICY "Anyone can delete scheduled emails"
ON public.scheduled_emails
FOR DELETE
TO public
USING (true);
-- ============================================================
-- 20251014163551_d9ab7d83-9eca-40e4-b504-5eb682714ada.sql
-- ============================================================
-- Fix the function search path security issue
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
-- ============================================================
-- 20251017162321_e3fc32fe-c222-4157-b244-3445e98a3b6e.sql
-- ============================================================
-- Create table for storing LinkedIn scraped leads
CREATE TABLE public.linkedin_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_name TEXT NOT NULL,
  job_title TEXT,
  company TEXT,
  location TEXT,
  linkedin_url TEXT,
  contact_email TEXT,
  keywords TEXT[],
  experience_level TEXT,
  search_criteria JSONB,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.linkedin_leads ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (matching the app's current pattern)
CREATE POLICY "Anyone can view linkedin leads"
ON public.linkedin_leads
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert linkedin leads"
ON public.linkedin_leads
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update linkedin leads"
ON public.linkedin_leads
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete linkedin leads"
ON public.linkedin_leads
FOR DELETE
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_linkedin_leads_updated_at
BEFORE UPDATE ON public.linkedin_leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add table to realtime publication for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.linkedin_leads;
-- ============================================================
-- 20251018154603_294fef02-9012-4c2c-8532-11d07a8de982.sql
-- ============================================================
-- Create scraping_sessions table to track each scraping job
CREATE TABLE public.scraping_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  search_criteria JSONB NOT NULL,
  total_leads INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on scraping_sessions
ALTER TABLE public.scraping_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for scraping_sessions
CREATE POLICY "Anyone can view scraping sessions"
  ON public.scraping_sessions
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert scraping sessions"
  ON public.scraping_sessions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update scraping sessions"
  ON public.scraping_sessions
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete scraping sessions"
  ON public.scraping_sessions
  FOR DELETE
  USING (true);

-- Add session_id to linkedin_leads to link leads to sessions
ALTER TABLE public.linkedin_leads
ADD COLUMN session_id UUID REFERENCES public.scraping_sessions(id) ON DELETE CASCADE;

-- Create index for better performance
CREATE INDEX idx_linkedin_leads_session_id ON public.linkedin_leads(session_id);
CREATE INDEX idx_scraping_sessions_created_at ON public.scraping_sessions(created_at DESC);

-- Enable realtime for scraping_sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.scraping_sessions;
-- ============================================================
-- 20251023082017_81b8fa50-23ca-4ceb-9051-3de3dbb657de.sql
-- ============================================================
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
-- ============================================================
-- 20251121040559_7c2e98da-77e0-4910-a132-c3b73c4fec52.sql
-- ============================================================
-- Create profiles table linked to auth.users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add branding fields to clients table
ALTER TABLE public.clients
ADD COLUMN logo_url TEXT,
ADD COLUMN primary_color TEXT DEFAULT '#0EA5E9',
ADD COLUMN secondary_color TEXT DEFAULT '#06B6D4',
ADD COLUMN accent_color TEXT DEFAULT '#14B8A6',
ADD COLUMN company_display_name TEXT;

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to get user's client_id
CREATE OR REPLACE FUNCTION public.get_user_client_id(user_uuid UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_id FROM public.profiles WHERE user_id = user_uuid;
$$;

-- Create security definer function to get client branding
CREATE OR REPLACE FUNCTION public.get_client_branding(client_uuid UUID)
RETURNS TABLE (
  id UUID,
  client_name TEXT,
  company_display_name TEXT,
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  accent_color TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, client_name, company_display_name, logo_url, primary_color, secondary_color, accent_color
  FROM public.clients
  WHERE id = client_uuid;
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id);

-- Update clients RLS to allow users to view their own client
CREATE POLICY "Users can view their own client"
ON public.clients
FOR SELECT
USING (id = public.get_user_client_id(auth.uid()));

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, client_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (NEW.raw_user_meta_data->>'client_id')::UUID
  );
  RETURN NEW;
END;
$$;

-- Create trigger for automatic profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Add trigger for updated_at on profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251123120335_a60a048c-7a9b-4eff-856b-e153dd342b2b.sql
-- ============================================================
-- Create candidate source enum
CREATE TYPE candidate_source AS ENUM ('resume_screening', 'deep_search', 'linkedin_scraper');

-- Create collaboration rooms table
CREATE TABLE public.collaboration_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_archived BOOLEAN DEFAULT false
);

-- Create room members table
CREATE TABLE public.collaboration_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- Create messages table
CREATE TABLE public.collaboration_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT array[]::UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_deleted BOOLEAN DEFAULT false
);

-- Create candidate attachments table
CREATE TABLE public.collaboration_candidate_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  candidate_source candidate_source NOT NULL,
  candidate_id UUID NOT NULL,
  attached_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attached_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  fit_score INTEGER,
  custom_notes TEXT,
  UNIQUE(room_id, candidate_source, candidate_id)
);

-- Create candidate comments table
CREATE TABLE public.collaboration_candidate_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create candidate tags table
CREATE TABLE public.collaboration_candidate_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  tag TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(attachment_id, tag)
);

-- Create contact history table
CREATE TABLE public.collaboration_contact_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_source candidate_source NOT NULL,
  candidate_id UUID NOT NULL,
  contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contacted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  contact_method TEXT,
  notes TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.collaboration_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_contact_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for collaboration_rooms
CREATE POLICY "Users can view rooms they are members of"
  ON public.collaboration_rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_rooms.id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create rooms"
  ON public.collaboration_rooms FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Room creators can update their rooms"
  ON public.collaboration_rooms FOR UPDATE
  USING (auth.uid() = created_by);

-- RLS Policies for collaboration_room_members
CREATE POLICY "Users can view room members"
  ON public.collaboration_room_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members m
      WHERE m.room_id = collaboration_room_members.room_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join rooms"
  ON public.collaboration_room_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their membership"
  ON public.collaboration_room_members FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_messages
CREATE POLICY "Room members can view messages"
  ON public.collaboration_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_messages.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can send messages"
  ON public.collaboration_messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_messages.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own messages"
  ON public.collaboration_messages FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_candidate_attachments
CREATE POLICY "Room members can view attachments"
  ON public.collaboration_candidate_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can attach candidates"
  ON public.collaboration_candidate_attachments FOR INSERT
  WITH CHECK (
    auth.uid() = attached_by AND
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can update attachments"
  ON public.collaboration_candidate_attachments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

-- RLS Policies for collaboration_candidate_comments
CREATE POLICY "Room members can view comments"
  ON public.collaboration_candidate_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_comments.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can add comments"
  ON public.collaboration_candidate_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_comments.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their comments"
  ON public.collaboration_candidate_comments FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_candidate_tags
CREATE POLICY "Room members can view tags"
  ON public.collaboration_candidate_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_tags.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can add tags"
  ON public.collaboration_candidate_tags FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_tags.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Tag creators can delete tags"
  ON public.collaboration_candidate_tags FOR DELETE
  USING (auth.uid() = created_by);

-- RLS Policies for collaboration_contact_history
CREATE POLICY "Anyone can view contact history"
  ON public.collaboration_contact_history FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can record contacts"
  ON public.collaboration_contact_history FOR INSERT
  WITH CHECK (auth.uid() = contacted_by);

-- Enable realtime for key tables
ALTER TABLE public.collaboration_messages REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_attachments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_comments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_contact_history REPLICA IDENTITY FULL;

-- Create indexes for performance
CREATE INDEX idx_room_members_user ON public.collaboration_room_members(user_id);
CREATE INDEX idx_room_members_room ON public.collaboration_room_members(room_id);
CREATE INDEX idx_messages_room ON public.collaboration_messages(room_id);
CREATE INDEX idx_messages_created ON public.collaboration_messages(created_at DESC);
CREATE INDEX idx_attachments_room ON public.collaboration_candidate_attachments(room_id);
CREATE INDEX idx_attachments_candidate ON public.collaboration_candidate_attachments(candidate_source, candidate_id);
CREATE INDEX idx_contact_history_candidate ON public.collaboration_contact_history(candidate_source, candidate_id);
CREATE INDEX idx_comments_attachment ON public.collaboration_candidate_comments(attachment_id);
CREATE INDEX idx_tags_attachment ON public.collaboration_candidate_tags(attachment_id);

-- Create trigger for updated_at
CREATE TRIGGER update_collaboration_rooms_updated_at
  BEFORE UPDATE ON public.collaboration_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collaboration_messages_updated_at
  BEFORE UPDATE ON public.collaboration_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251123131022_a35b7646-49fb-43d1-ba1b-02e96611c959.sql
-- ============================================================
-- Fix infinite recursion in collaboration RLS policies

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view room members" ON collaboration_room_members;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;
DROP POLICY IF EXISTS "Room members can view messages" ON collaboration_messages;
DROP POLICY IF EXISTS "Room members can view attachments" ON collaboration_candidate_attachments;
DROP POLICY IF EXISTS "Room members can view comments" ON collaboration_candidate_comments;
DROP POLICY IF EXISTS "Room members can view tags" ON collaboration_candidate_tags;

-- Create security definer function to check room membership without recursion
CREATE OR REPLACE FUNCTION public.is_room_member(_user_id uuid, _room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_room_members
    WHERE user_id = _user_id
      AND room_id = _room_id
  )
$$;

-- Recreate policies using the security definer function

-- collaboration_room_members policies
CREATE POLICY "Users can view room members"
ON collaboration_room_members
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_rooms policies
CREATE POLICY "Users can view rooms they are members of"
ON collaboration_rooms
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), id));

-- collaboration_messages policies
CREATE POLICY "Room members can view messages"
ON collaboration_messages
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_candidate_attachments policies
CREATE POLICY "Room members can view attachments"
ON collaboration_candidate_attachments
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_candidate_comments policies
CREATE POLICY "Room members can view comments"
ON collaboration_candidate_comments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM collaboration_candidate_attachments a
    WHERE a.id = collaboration_candidate_comments.attachment_id
      AND public.is_room_member(auth.uid(), a.room_id)
  )
);

-- collaboration_candidate_tags policies
CREATE POLICY "Room members can view tags"
ON collaboration_candidate_tags
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM collaboration_candidate_attachments a
    WHERE a.id = collaboration_candidate_tags.attachment_id
      AND public.is_room_member(auth.uid(), a.room_id)
  )
);
-- ============================================================
-- 20251202150409_a69d266f-8803-4c85-b447-db927fd09595.sql
-- ============================================================
-- Enable realtime for collaboration tables
ALTER TABLE collaboration_rooms REPLICA IDENTITY FULL;
ALTER TABLE collaboration_messages REPLICA IDENTITY FULL;
ALTER TABLE collaboration_room_members REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_attachments REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_comments REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_tags REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_attachments;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_tags;
-- ============================================================
-- 20251203133620_de4bbed0-1ef0-456f-908b-c310b4072041.sql
-- ============================================================
-- Create enum for interview location types
CREATE TYPE public.interview_location_type AS ENUM ('video', 'phone', 'in_person');

-- Create enum for interview status
CREATE TYPE public.interview_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled');

-- Create enum for slot status
CREATE TYPE public.slot_status AS ENUM ('available', 'booked', 'blocked');

-- Create enum for reminder type
CREATE TYPE public.reminder_type AS ENUM ('24h', '1h', '15min');

-- Interview types table (different interview formats)
CREATE TABLE public.interview_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  description TEXT,
  location_type interview_location_type NOT NULL DEFAULT 'video',
  meeting_link_template TEXT,
  buffer_minutes INTEGER DEFAULT 15,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Recruiter availability settings
CREATE TABLE public.interview_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

-- Interview slots (generated available time slots)
CREATE TABLE public.interview_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  interview_type_id UUID REFERENCES public.interview_types(id) ON DELETE CASCADE NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status slot_status NOT NULL DEFAULT 'available',
  booking_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Booked interviews
CREATE TABLE public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID REFERENCES public.interview_slots(id) ON DELETE SET NULL,
  candidate_id UUID,
  candidate_source public.candidate_source,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  interview_type_id UUID REFERENCES public.interview_types(id) ON DELETE SET NULL,
  recruiter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status interview_status NOT NULL DEFAULT 'scheduled',
  meeting_link TEXT,
  location TEXT,
  notes TEXT,
  feedback TEXT,
  reminder_24h_sent BOOLEAN DEFAULT false,
  reminder_1h_sent BOOLEAN DEFAULT false,
  reminder_15min_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancellation_reason TEXT
);

-- Interview reminders tracking
CREATE TABLE public.interview_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID REFERENCES public.interviews(id) ON DELETE CASCADE NOT NULL,
  reminder_type reminder_type NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT DEFAULT 'sent',
  error_message TEXT,
  UNIQUE(interview_id, reminder_type)
);

-- Enable RLS on all tables
ALTER TABLE public.interview_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_reminders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for interview_types
CREATE POLICY "Anyone can view active interview types" ON public.interview_types
FOR SELECT USING (is_active = true);

CREATE POLICY "Authenticated users can create interview types" ON public.interview_types
FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creators can update their interview types" ON public.interview_types
FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Creators can delete their interview types" ON public.interview_types
FOR DELETE USING (auth.uid() = created_by);

-- RLS Policies for interview_availability
CREATE POLICY "Users can view their own availability" ON public.interview_availability
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own availability" ON public.interview_availability
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own availability" ON public.interview_availability
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own availability" ON public.interview_availability
FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for interview_slots
CREATE POLICY "Recruiters can view their own slots" ON public.interview_slots
FOR SELECT USING (auth.uid() = recruiter_id);

CREATE POLICY "Anyone can view available slots by token" ON public.interview_slots
FOR SELECT USING (status = 'available');

CREATE POLICY "Recruiters can create their own slots" ON public.interview_slots
FOR INSERT WITH CHECK (auth.uid() = recruiter_id);

CREATE POLICY "Recruiters can update their own slots" ON public.interview_slots
FOR UPDATE USING (auth.uid() = recruiter_id);

CREATE POLICY "Recruiters can delete their own slots" ON public.interview_slots
FOR DELETE USING (auth.uid() = recruiter_id);

-- RLS Policies for interviews
CREATE POLICY "Recruiters can view their interviews" ON public.interviews
FOR SELECT USING (auth.uid() = recruiter_id);

CREATE POLICY "Anyone can create interviews" ON public.interviews
FOR INSERT WITH CHECK (true);

CREATE POLICY "Recruiters can update their interviews" ON public.interviews
FOR UPDATE USING (auth.uid() = recruiter_id);

-- RLS Policies for interview_reminders
CREATE POLICY "Recruiters can view reminders for their interviews" ON public.interview_reminders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.interviews i 
    WHERE i.id = interview_id AND i.recruiter_id = auth.uid()
  )
);

-- Create indexes for performance
CREATE INDEX idx_interview_slots_recruiter ON public.interview_slots(recruiter_id);
CREATE INDEX idx_interview_slots_start_time ON public.interview_slots(start_time);
CREATE INDEX idx_interview_slots_status ON public.interview_slots(status);
CREATE INDEX idx_interviews_recruiter ON public.interviews(recruiter_id);
CREATE INDEX idx_interviews_scheduled_at ON public.interviews(scheduled_at);
CREATE INDEX idx_interviews_status ON public.interviews(status);
CREATE INDEX idx_interview_availability_user ON public.interview_availability(user_id);

-- Enable realtime for interviews table
ALTER PUBLICATION supabase_realtime ADD TABLE public.interviews;

-- Create trigger for updated_at
CREATE TRIGGER update_interview_types_updated_at
  BEFORE UPDATE ON public.interview_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_interview_availability_updated_at
  BEFORE UPDATE ON public.interview_availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_interview_slots_updated_at
  BEFORE UPDATE ON public.interview_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_interviews_updated_at
  BEFORE UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251205102547_30b0673c-fcb7-4681-b383-8816d4b19920.sql
-- ============================================================
-- Create table to store Google Calendar OAuth tokens
CREATE TABLE public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE NOT NULL,
  calendar_id TEXT DEFAULT 'primary',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only access their own tokens
CREATE POLICY "Users can view their own tokens"
ON public.google_calendar_tokens FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tokens"
ON public.google_calendar_tokens FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens"
ON public.google_calendar_tokens FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens"
ON public.google_calendar_tokens FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_google_calendar_tokens_updated_at
BEFORE UPDATE ON public.google_calendar_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251206094826_f5edfcd3-a602-424c-8263-53003125bc67.sql
-- ============================================================
-- Create email tracking table
CREATE TABLE public.email_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scheduled_email_id UUID REFERENCES public.scheduled_emails(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'open' or 'click'
  link_url TEXT, -- only for click events
  tracked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_address TEXT
);

-- Enable RLS
ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert tracking events (from edge function)
CREATE POLICY "Anyone can insert tracking events"
ON public.email_tracking
FOR INSERT
WITH CHECK (true);

-- Allow anyone to view tracking events
CREATE POLICY "Anyone can view tracking events"
ON public.email_tracking
FOR SELECT
USING (true);

-- Add index for faster lookups
CREATE INDEX idx_email_tracking_scheduled_email_id ON public.email_tracking(scheduled_email_id);
CREATE INDEX idx_email_tracking_event_type ON public.email_tracking(event_type);
-- ============================================================
-- 20251206101250_92503281-2f21-4a14-8e3b-4a00025581cd.sql
-- ============================================================
-- Enable required extensions for cron jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Schedule the cron job to run every minute
SELECT cron.schedule(
  'send-scheduled-emails-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zbwsbnqqpkvdhqwavjke.supabase.co/functions/v1/send-scheduled-emails',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpid3NibnFxcGt2ZGhxd2F2amtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MzgzMzEsImV4cCI6MjA3MjExNDMzMX0.kjhXkXmmNChw0XqYpXehNckMzHPUYX705aNScavKc8g"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
-- ============================================================
-- 20251209004316_f343a91a-e82b-4478-9387-b4c429d06c6b.sql
-- ============================================================
-- Add a name column to scraping_sessions for folder organization
ALTER TABLE public.scraping_sessions 
ADD COLUMN name text;
-- ============================================================
-- 20251211173016_34ae9dc8-612a-4a70-90a4-04b5961e40b4.sql
-- ============================================================
-- Assign orphaned leads to the correct session based on timestamp matching
-- Leads with session_id NULL will be matched to the session that was created most recently before the lead
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

-- Update total_leads count for all sessions to reflect actual counts
UPDATE scraping_sessions s
SET total_leads = (
  SELECT COUNT(*) 
  FROM linkedin_leads l 
  WHERE l.session_id = s.id
);
-- ============================================================
-- 20251220012716_9330afe4-4eb1-42ea-a044-ea34ed0e6565.sql
-- ============================================================
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON collaboration_rooms;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;

-- Create PERMISSIVE INSERT policy for authenticated users
CREATE POLICY "Authenticated users can create rooms"
ON collaboration_rooms
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Create PERMISSIVE SELECT policy that allows members OR creators to view rooms
CREATE POLICY "Users can view rooms they are members of or created"
ON collaboration_rooms
FOR SELECT
TO authenticated
USING (is_room_member(auth.uid(), id) OR auth.uid() = created_by);
-- ============================================================
-- 20251223234638_502ed15f-1a80-43ff-b11d-2969ebb4e273.sql
-- ============================================================
-- Enable RLS on deep_search_analysis table
ALTER TABLE deep_search_analysis ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users only
CREATE POLICY "Authenticated users can view deep search analysis"
ON deep_search_analysis FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deep search analysis"
ON deep_search_analysis FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deep search analysis"
ON deep_search_analysis FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete deep search analysis"
ON deep_search_analysis FOR DELETE TO authenticated USING (true);

-- Fix resume_analyses: require authentication
DROP POLICY IF EXISTS "Public users can view resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can insert resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can update resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Public users can delete resume analyses" ON resume_analyses;

CREATE POLICY "Authenticated users can view resume analyses"
ON resume_analyses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert resume analyses"
ON resume_analyses FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update resume analyses"
ON resume_analyses FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete resume analyses"
ON resume_analyses FOR DELETE TO authenticated USING (true);

-- Fix scheduled_emails: require authentication
DROP POLICY IF EXISTS "Anyone can view scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can create scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can update scheduled emails" ON scheduled_emails;
DROP POLICY IF EXISTS "Anyone can delete scheduled emails" ON scheduled_emails;

CREATE POLICY "Authenticated users can view scheduled emails"
ON scheduled_emails FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create scheduled emails"
ON scheduled_emails FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update scheduled emails"
ON scheduled_emails FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete scheduled emails"
ON scheduled_emails FOR DELETE TO authenticated USING (true);

-- Fix linkedin_leads: require authentication
DROP POLICY IF EXISTS "Anyone can view linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can insert linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can update linkedin leads" ON linkedin_leads;
DROP POLICY IF EXISTS "Anyone can delete linkedin leads" ON linkedin_leads;

CREATE POLICY "Authenticated users can view linkedin leads"
ON linkedin_leads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert linkedin leads"
ON linkedin_leads FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update linkedin leads"
ON linkedin_leads FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete linkedin leads"
ON linkedin_leads FOR DELETE TO authenticated USING (true);

-- Fix deep_search_results: require authentication
DROP POLICY IF EXISTS "Anyone can view deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can insert deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can update deep search results" ON deep_search_results;
DROP POLICY IF EXISTS "Anyone can delete deep search results" ON deep_search_results;

CREATE POLICY "Authenticated users can view deep search results"
ON deep_search_results FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deep search results"
ON deep_search_results FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deep search results"
ON deep_search_results FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete deep search results"
ON deep_search_results FOR DELETE TO authenticated USING (true);

-- Fix candidate_notes: require authentication
DROP POLICY IF EXISTS "Anyone can view candidate notes" ON candidate_notes;
DROP POLICY IF EXISTS "Anyone can create notes" ON candidate_notes;

CREATE POLICY "Authenticated users can view candidate notes"
ON candidate_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create notes"
ON candidate_notes FOR INSERT TO authenticated WITH CHECK (true);

-- Fix email_tracking: require authentication for viewing (keep insert open for tracking pixels)
DROP POLICY IF EXISTS "Anyone can view tracking events" ON email_tracking;

CREATE POLICY "Authenticated users can view tracking events"
ON email_tracking FOR SELECT TO authenticated USING (true);

-- Fix scraping_sessions: require authentication
DROP POLICY IF EXISTS "Anyone can view scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can insert scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can update scraping sessions" ON scraping_sessions;
DROP POLICY IF EXISTS "Anyone can delete scraping sessions" ON scraping_sessions;

CREATE POLICY "Authenticated users can view scraping sessions"
ON scraping_sessions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert scraping sessions"
ON scraping_sessions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update scraping sessions"
ON scraping_sessions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete scraping sessions"
ON scraping_sessions FOR DELETE TO authenticated USING (true);

-- Fix client_placements: require authentication
DROP POLICY IF EXISTS "Public users can view placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can insert placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can update placements" ON client_placements;
DROP POLICY IF EXISTS "Public users can delete placements" ON client_placements;

CREATE POLICY "Authenticated users can view placements"
ON client_placements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert placements"
ON client_placements FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update placements"
ON client_placements FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete placements"
ON client_placements FOR DELETE TO authenticated USING (true);

-- Fix client_active_positions: require authentication
DROP POLICY IF EXISTS "Public users can view active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can insert active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can update active positions" ON client_active_positions;
DROP POLICY IF EXISTS "Public users can delete active positions" ON client_active_positions;

CREATE POLICY "Authenticated users can view active positions"
ON client_active_positions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert active positions"
ON client_active_positions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update active positions"
ON client_active_positions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete active positions"
ON client_active_positions FOR DELETE TO authenticated USING (true);

-- Fix clients: require authentication (keep user's own client policy)
DROP POLICY IF EXISTS "Public users can view clients" ON clients;
DROP POLICY IF EXISTS "Public users can insert clients" ON clients;
DROP POLICY IF EXISTS "Public users can update clients" ON clients;
DROP POLICY IF EXISTS "Public users can delete clients" ON clients;

CREATE POLICY "Authenticated users can view clients"
ON clients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert clients"
ON clients FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update clients"
ON clients FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete clients"
ON clients FOR DELETE TO authenticated USING (true);

-- Fix interviews: require authentication for anonymous inserts
DROP POLICY IF EXISTS "Anyone can create interviews" ON interviews;

CREATE POLICY "Authenticated users can create interviews"
ON interviews FOR INSERT TO authenticated WITH CHECK (true);

-- Create security definer function for fetching room member profiles
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
-- ============================================================
-- 20251224000020_fa5d229e-b434-4f3a-a9e3-483365d96243.sql
-- ============================================================
-- Create job_postings table
CREATE TABLE public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL,
  location text NOT NULL,
  job_type text NOT NULL DEFAULT 'full-time',
  salary_min integer,
  salary_max integer,
  salary_currency text DEFAULT 'USD',
  description text NOT NULL,
  requirements text[] DEFAULT '{}',
  benefits text[] DEFAULT '{}',
  remote_option text DEFAULT 'no',
  experience_level text,
  posted_boards jsonb DEFAULT '{}',
  status text DEFAULT 'draft',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view their own job postings"
ON public.job_postings
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own job postings"
ON public.job_postings
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own job postings"
ON public.job_postings
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own job postings"
ON public.job_postings
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_job_postings_updated_at
BEFORE UPDATE ON public.job_postings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
-- 20251224095158_5b83cb83-67d4-4e9e-bb07-da752ee6131c.sql
-- ============================================================
-- Create enum for screening session status
CREATE TYPE screening_session_status AS ENUM ('invited', 'in_progress', 'completed', 'expired', 'abandoned');

-- Create enum for risk level
CREATE TYPE behavioral_risk_level AS ENUM ('low', 'medium', 'high');

-- Create enum for scenario category
CREATE TYPE scenario_category AS ENUM ('ambiguity', 'accountability', 'competing_priorities', 'time_pressure', 'conflict_resolution');

-- Table: adaptive_screening_sessions - Track each screening session
CREATE TABLE public.adaptive_screening_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  session_status screening_session_status NOT NULL DEFAULT 'invited',
  access_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days'),
  scenario_count INTEGER DEFAULT 3,
  current_scenario_index INTEGER DEFAULT 0,
  candidate_consent_given BOOLEAN DEFAULT false,
  consent_given_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_scenarios - Reusable scenario templates
CREATE TABLE public.screening_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category scenario_category NOT NULL,
  scenario_prompt TEXT NOT NULL,
  follow_up_prompts JSONB DEFAULT '[]'::jsonb,
  difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
  target_signals JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_conversation_logs - Full conversation history
CREATE TABLE public.screening_conversation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user')),
  content TEXT NOT NULL,
  scenario_id UUID REFERENCES public.screening_scenarios(id),
  behavioral_signals_detected JSONB DEFAULT '{}'::jsonb,
  response_time_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: screening_behavioral_analysis - Final risk assessment
CREATE TABLE public.screening_behavioral_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID UNIQUE NOT NULL REFERENCES public.adaptive_screening_sessions(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.resume_analyses(id) ON DELETE CASCADE,
  
  -- Behavioral scores (0-100)
  ownership_score INTEGER CHECK (ownership_score BETWEEN 0 AND 100),
  ownership_evidence JSONB DEFAULT '[]'::jsonb,
  
  clarity_score INTEGER CHECK (clarity_score BETWEEN 0 AND 100),
  clarity_evidence JSONB DEFAULT '[]'::jsonb,
  
  emotional_regulation_score INTEGER CHECK (emotional_regulation_score BETWEEN 0 AND 100),
  emotional_evidence JSONB DEFAULT '[]'::jsonb,
  
  consistency_score INTEGER CHECK (consistency_score BETWEEN 0 AND 100),
  consistency_evidence JSONB DEFAULT '[]'::jsonb,
  
  -- Overall assessment
  overall_risk_level behavioral_risk_level,
  risk_summary TEXT,
  red_flags JSONB DEFAULT '[]'::jsonb,
  green_flags JSONB DEFAULT '[]'::jsonb,
  
  -- AI analysis metadata
  ai_confidence_score INTEGER CHECK (ai_confidence_score BETWEEN 0 AND 100),
  analysis_completed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add screening_status to resume_analyses
ALTER TABLE public.resume_analyses 
ADD COLUMN IF NOT EXISTS screening_status TEXT DEFAULT 'not_invited' 
CHECK (screening_status IN ('not_invited', 'invited', 'in_progress', 'completed', 'expired'));

-- Create indexes for performance
CREATE INDEX idx_screening_sessions_candidate ON public.adaptive_screening_sessions(candidate_id);
CREATE INDEX idx_screening_sessions_token ON public.adaptive_screening_sessions(access_token);
CREATE INDEX idx_screening_sessions_status ON public.adaptive_screening_sessions(session_status);
CREATE INDEX idx_conversation_logs_session ON public.screening_conversation_logs(session_id);
CREATE INDEX idx_behavioral_analysis_candidate ON public.screening_behavioral_analysis(candidate_id);

-- Enable RLS on all tables
ALTER TABLE public.adaptive_screening_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_conversation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_behavioral_analysis ENABLE ROW LEVEL SECURITY;

-- RLS Policies for adaptive_screening_sessions
CREATE POLICY "Authenticated users can view screening sessions"
ON public.adaptive_screening_sessions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create screening sessions"
ON public.adaptive_screening_sessions FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update screening sessions"
ON public.adaptive_screening_sessions FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Public access by token for candidates"
ON public.adaptive_screening_sessions FOR SELECT
TO anon
USING (access_token IS NOT NULL);

CREATE POLICY "Candidates can update their session by token"
ON public.adaptive_screening_sessions FOR UPDATE
TO anon
USING (access_token IS NOT NULL);

-- RLS Policies for screening_scenarios
CREATE POLICY "Anyone can view active scenarios"
ON public.screening_scenarios FOR SELECT
USING (is_active = true);

CREATE POLICY "Authenticated users can manage scenarios"
ON public.screening_scenarios FOR ALL
TO authenticated
USING (true);

-- RLS Policies for screening_conversation_logs
CREATE POLICY "Authenticated users can view conversation logs"
ON public.screening_conversation_logs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Anyone can insert conversation logs"
ON public.screening_conversation_logs FOR INSERT
WITH CHECK (true);

-- RLS Policies for screening_behavioral_analysis
CREATE POLICY "Authenticated users can view behavioral analysis"
ON public.screening_behavioral_analysis FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "System can create behavioral analysis"
ON public.screening_behavioral_analysis FOR INSERT
WITH CHECK (true);

CREATE POLICY "System can update behavioral analysis"
ON public.screening_behavioral_analysis FOR UPDATE
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_screening_sessions_updated_at
BEFORE UPDATE ON public.adaptive_screening_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scenarios_updated_at
BEFORE UPDATE ON public.screening_scenarios
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_behavioral_analysis_updated_at
BEFORE UPDATE ON public.screening_behavioral_analysis
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default scenarios
INSERT INTO public.screening_scenarios (name, category, scenario_prompt, follow_up_prompts, difficulty_level, target_signals) VALUES
-- Ambiguity scenarios
('Unclear Project Requirements', 'ambiguity', 
 'Your manager assigns you a critical project but gives very vague instructions. They say "Make it great" and then leave for a two-week vacation with no way to contact them. The deadline is in 10 days. What do you do first, and how do you proceed?',
 '["What if the stakeholders you reach out to have conflicting opinions about what ''great'' means?", "How would you handle it if you made a decision that later turned out to be wrong?", "What would you do if you''re halfway through and realize you interpreted the requirements incorrectly?"]'::jsonb,
 3, '["ownership", "clarity", "initiative", "problem_solving"]'::jsonb),

('Conflicting Stakeholder Instructions', 'ambiguity',
 'You receive an urgent email from the VP of Sales asking you to prioritize Feature A, while simultaneously the VP of Product sends a message insisting Feature B is the top priority. Both claim their request comes from the CEO. How do you handle this?',
 '["What if neither VP responds to your clarification request and the deadline is tomorrow?", "How would you document your decision-making process?", "What would you do if your decision upset one of the VPs?"]'::jsonb,
 4, '["clarity", "communication", "judgment", "conflict_resolution"]'::jsonb),

-- Accountability scenarios
('Project Failure Ownership', 'accountability',
 'A project you led missed its deadline by two weeks, and the client is threatening to cancel their contract. Your team worked hard, but looking back, there were warning signs you could have addressed earlier. You have a meeting with the executive team in one hour. What do you say?',
 '["How would you respond if an executive asks specifically what YOU could have done differently?", "What if a team member publicly blames you for not providing clear direction?", "How do you prevent this from happening again?"]'::jsonb,
 4, '["ownership", "accountability", "self_awareness", "learning_orientation"]'::jsonb),

('Discovered Mistake', 'accountability',
 'You just discovered a significant error in a report you submitted last week. The report has already been shared with the board of directors and influenced a major business decision. What do you do?',
 '["What if correcting the error might make the business decision look bad?", "How would you communicate this to your manager?", "What steps would you take to prevent similar errors?"]'::jsonb,
 3, '["honesty", "ownership", "proactive_communication", "integrity"]'::jsonb),

-- Competing priorities scenarios
('Triple Deadline Crisis', 'competing_priorities',
 'It''s Monday morning. You have three critical deadlines all due by Friday: a client presentation, a quarterly report for leadership, and a project deliverable your team is depending on. Realistically, you can only complete two of them well. Walk me through your decision-making process.',
 '["What factors matter most in your prioritization?", "How do you communicate to the stakeholder whose deadline you can''t meet?", "What if your manager insists all three must be done?"]'::jsonb,
 3, '["prioritization", "communication", "judgment", "stress_management"]'::jsonb),

('Colleague Request Conflict', 'competing_priorities',
 'A colleague who helped you significantly on a past project asks for your help on an urgent task. However, you''re already behind on your own critical work, and helping them would mean missing your own deadline. How do you handle this?',
 '["What if this colleague is more senior than you?", "How would you feel if the roles were reversed?", "What if helping them only requires 2 hours but you''re already at capacity?"]'::jsonb,
 2, '["boundaries", "communication", "relationship_management", "self_awareness"]'::jsonb),

-- Time pressure scenarios
('Last-Minute Change Request', 'time_pressure',
 'Your client calls at 4 PM on Friday requesting major changes to a presentation you''re giving Monday morning. The changes would require significant rework. The client is important, but you also had personal plans this weekend. How do you respond?',
 '["What if the client insists these changes are non-negotiable?", "How do you balance client needs with your own well-being?", "What would you do differently to prevent this situation in the future?"]'::jsonb,
 3, '["boundary_setting", "negotiation", "client_management", "stress_management"]'::jsonb),

-- Conflict resolution scenarios
('Team Disagreement', 'conflict_resolution',
 'Two members of your team are in a heated disagreement about the technical approach to a project. Both have valid points, but their conflict is affecting team morale and slowing progress. As the project lead, what do you do?',
 '["What if one of them is clearly more experienced but the other has a better idea?", "How do you ensure the person whose idea isn''t chosen still feels valued?", "What if the conflict becomes personal?"]'::jsonb,
 3, '["leadership", "conflict_resolution", "emotional_intelligence", "fairness"]'::jsonb);

-- Enable realtime for screening sessions
ALTER PUBLICATION supabase_realtime ADD TABLE adaptive_screening_sessions;
-- ============================================================
-- 20251228022612_9d546d64-45c0-45ee-967a-ba2b0aef260b.sql
-- ============================================================
-- Create screening_templates table
CREATE TABLE public.screening_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  role_focus TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create screening_template_questions table
CREATE TABLE public.screening_template_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.screening_templates(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES public.screening_scenarios(id),
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  follow_up_prompts JSONB DEFAULT '[]',
  difficulty_level INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add template_id to adaptive_screening_sessions
ALTER TABLE public.adaptive_screening_sessions
ADD COLUMN template_id UUID REFERENCES public.screening_templates(id);

-- Enable RLS on screening_templates
ALTER TABLE public.screening_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_templates
CREATE POLICY "Authenticated users can view templates"
ON public.screening_templates FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create templates"
ON public.screening_templates FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update templates"
ON public.screening_templates FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete templates"
ON public.screening_templates FOR DELETE
USING (true);

-- Enable RLS on screening_template_questions
ALTER TABLE public.screening_template_questions ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_template_questions
CREATE POLICY "Authenticated users can view template questions"
ON public.screening_template_questions FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create template questions"
ON public.screening_template_questions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update template questions"
ON public.screening_template_questions FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete template questions"
ON public.screening_template_questions FOR DELETE
USING (true);

-- Create trigger for updated_at on screening_templates
CREATE TRIGGER update_screening_templates_updated_at
BEFORE UPDATE ON public.screening_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert a default template with existing scenarios
INSERT INTO public.screening_templates (name, description, is_default)
VALUES ('Default Behavioral Screening', 'Standard behavioral assessment covering all scenario categories', true);

-- Copy existing scenarios to the default template
INSERT INTO public.screening_template_questions (template_id, scenario_id, category, question_text, follow_up_prompts, difficulty_level, sort_order, is_custom)
SELECT 
  (SELECT id FROM public.screening_templates WHERE is_default = true LIMIT 1),
  id,
  category::text,
  scenario_prompt,
  follow_up_prompts,
  difficulty_level,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at),
  false
FROM public.screening_scenarios
WHERE is_active = true;
-- ============================================================
-- 20251229161155_25847aa6-b29b-4319-8d75-dcad5807b733.sql
-- ============================================================
-- Add role_briefing and scenario_config columns to adaptive_screening_sessions
ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS role_briefing JSONB DEFAULT NULL;

ALTER TABLE adaptive_screening_sessions 
ADD COLUMN IF NOT EXISTS scenario_config JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN adaptive_screening_sessions.role_briefing IS 'Recruiter-defined context: role_title, skills_expected, experience_required, key_traits';
COMMENT ON COLUMN adaptive_screening_sessions.scenario_config IS 'Question limits config: total_limit, category_limits object';
-- ============================================================
-- 20260214141447_d3869193-dd49-4fa5-b4e5-c1d7eb1c4f9b.sql
-- ============================================================

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

-- ============================================================
-- 20260214142823_705f2b92-59f7-4987-ad60-4b4da6a7b3d3.sql
-- ============================================================

ALTER TABLE public.screening_applications
ADD COLUMN IF NOT EXISTS recruiter_status text DEFAULT 'new',
ADD COLUMN IF NOT EXISTS recruiter_notes text,
ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- ============================================================
-- 20260219164639_3632834e-01f5-404d-a970-0aa174f5ffb6.sql
-- ============================================================
ALTER TYPE candidate_source ADD VALUE IF NOT EXISTS 'screening_flow';
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

