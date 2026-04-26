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
