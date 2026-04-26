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
