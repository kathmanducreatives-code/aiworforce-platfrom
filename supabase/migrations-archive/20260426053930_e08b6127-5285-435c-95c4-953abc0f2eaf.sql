-- ============================================================
-- linkedin_leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.linkedin_leads (
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
ALTER TABLE public.linkedin_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view linkedin leads" ON public.linkedin_leads;
CREATE POLICY "Anyone can view linkedin leads" ON public.linkedin_leads FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can insert linkedin leads" ON public.linkedin_leads;
CREATE POLICY "Anyone can insert linkedin leads" ON public.linkedin_leads FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update linkedin leads" ON public.linkedin_leads;
CREATE POLICY "Anyone can update linkedin leads" ON public.linkedin_leads FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Anyone can delete linkedin leads" ON public.linkedin_leads;
CREATE POLICY "Anyone can delete linkedin leads" ON public.linkedin_leads FOR DELETE USING (true);
DROP TRIGGER IF EXISTS update_linkedin_leads_updated_at ON public.linkedin_leads;
CREATE TRIGGER update_linkedin_leads_updated_at BEFORE UPDATE ON public.linkedin_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- scraping_sessions + linkedin_leads.session_id
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scraping_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  search_criteria JSONB NOT NULL,
  total_leads INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);
ALTER TABLE public.scraping_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Anyone can view scraping sessions" ON public.scraping_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can insert scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Anyone can insert scraping sessions" ON public.scraping_sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Anyone can update scraping sessions" ON public.scraping_sessions FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Anyone can delete scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Anyone can delete scraping sessions" ON public.scraping_sessions FOR DELETE USING (true);

ALTER TABLE public.linkedin_leads ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.scraping_sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_linkedin_leads_session_id ON public.linkedin_leads(session_id);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_created_at ON public.scraping_sessions(created_at DESC);

-- ============================================================
-- deep_search_results
-- ============================================================
CREATE TABLE IF NOT EXISTS public.deep_search_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id uuid REFERENCES public.linkedin_leads(id) ON DELETE CASCADE,
  candidate_name text NOT NULL,
  linkedin_url text,
  company text,
  fit_score integer,
  ai_summary text,
  strengths text[],
  weaknesses text[],
  ideal_roles text[],
  company_match_notes text,
  ai_confidence_level integer,
  raw_analysis jsonb,
  status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.deep_search_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view deep search results" ON public.deep_search_results;
CREATE POLICY "Anyone can view deep search results" ON public.deep_search_results FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can insert deep search results" ON public.deep_search_results;
CREATE POLICY "Anyone can insert deep search results" ON public.deep_search_results FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update deep search results" ON public.deep_search_results;
CREATE POLICY "Anyone can update deep search results" ON public.deep_search_results FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Anyone can delete deep search results" ON public.deep_search_results;
CREATE POLICY "Anyone can delete deep search results" ON public.deep_search_results FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_deep_search_candidate_id ON public.deep_search_results(candidate_id);
CREATE INDEX IF NOT EXISTS idx_deep_search_status ON public.deep_search_results(status);

-- ============================================================
-- profiles + clients branding + auth trigger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#0EA5E9',
  ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#06B6D4',
  ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#14B8A6',
  ADD COLUMN IF NOT EXISTS company_display_name TEXT;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_user_client_id(user_uuid UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT client_id FROM public.profiles WHERE user_id = user_uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_client_branding(client_uuid UUID)
RETURNS TABLE (id UUID, client_name TEXT, company_display_name TEXT, logo_url TEXT, primary_color TEXT, secondary_color TEXT, accent_color TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, client_name, company_display_name, logo_url, primary_color, secondary_color, accent_color
  FROM public.clients WHERE id = client_uuid;
$$;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view their own client" ON public.clients;
CREATE POLICY "Users can view their own client" ON public.clients FOR SELECT USING (id = public.get_user_client_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, client_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), (NEW.raw_user_meta_data->>'client_id')::UUID);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Collaboration tables
-- ============================================================
DO $$ BEGIN
  CREATE TYPE candidate_source AS ENUM ('resume_screening', 'deep_search', 'linkedin_scraper');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.collaboration_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_archived BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.collaboration_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT array[]::UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_deleted BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_attachments (
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

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  tag TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(attachment_id, tag)
);

CREATE TABLE IF NOT EXISTS public.collaboration_contact_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_source candidate_source NOT NULL,
  candidate_id UUID NOT NULL,
  contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contacted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  contact_method TEXT,
  notes TEXT
);

ALTER TABLE public.collaboration_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_contact_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_room_member(_user_id uuid, _room_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM collaboration_room_members WHERE user_id = _user_id AND room_id = _room_id)
$$;

DROP POLICY IF EXISTS "Users can view rooms they are members of" ON public.collaboration_rooms;
CREATE POLICY "Users can view rooms they are members of" ON public.collaboration_rooms FOR SELECT TO authenticated USING (public.is_room_member(auth.uid(), id));
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON public.collaboration_rooms;
CREATE POLICY "Authenticated users can create rooms" ON public.collaboration_rooms FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "Room creators can update their rooms" ON public.collaboration_rooms;
CREATE POLICY "Room creators can update their rooms" ON public.collaboration_rooms FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can view room members" ON public.collaboration_room_members;
CREATE POLICY "Users can view room members" ON public.collaboration_room_members FOR SELECT TO authenticated USING (public.is_room_member(auth.uid(), room_id));
DROP POLICY IF EXISTS "Users can join rooms" ON public.collaboration_room_members;
CREATE POLICY "Users can join rooms" ON public.collaboration_room_members FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their membership" ON public.collaboration_room_members;
CREATE POLICY "Users can update their membership" ON public.collaboration_room_members FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Room members can view messages" ON public.collaboration_messages;
CREATE POLICY "Room members can view messages" ON public.collaboration_messages FOR SELECT TO authenticated USING (public.is_room_member(auth.uid(), room_id));
DROP POLICY IF EXISTS "Room members can send messages" ON public.collaboration_messages;
CREATE POLICY "Room members can send messages" ON public.collaboration_messages FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_room_member(auth.uid(), room_id));
DROP POLICY IF EXISTS "Users can update their own messages" ON public.collaboration_messages;
CREATE POLICY "Users can update their own messages" ON public.collaboration_messages FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Room members can view attachments" ON public.collaboration_candidate_attachments;
CREATE POLICY "Room members can view attachments" ON public.collaboration_candidate_attachments FOR SELECT TO authenticated USING (public.is_room_member(auth.uid(), room_id));
DROP POLICY IF EXISTS "Room members can attach candidates" ON public.collaboration_candidate_attachments;
CREATE POLICY "Room members can attach candidates" ON public.collaboration_candidate_attachments FOR INSERT WITH CHECK (auth.uid() = attached_by AND public.is_room_member(auth.uid(), room_id));
DROP POLICY IF EXISTS "Room members can update attachments" ON public.collaboration_candidate_attachments;
CREATE POLICY "Room members can update attachments" ON public.collaboration_candidate_attachments FOR UPDATE USING (public.is_room_member(auth.uid(), room_id));

DROP POLICY IF EXISTS "Room members can view comments" ON public.collaboration_candidate_comments;
CREATE POLICY "Room members can view comments" ON public.collaboration_candidate_comments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.collaboration_candidate_attachments a WHERE a.id = collaboration_candidate_comments.attachment_id AND public.is_room_member(auth.uid(), a.room_id))
);
DROP POLICY IF EXISTS "Room members can add comments" ON public.collaboration_candidate_comments;
CREATE POLICY "Room members can add comments" ON public.collaboration_candidate_comments FOR INSERT WITH CHECK (
  auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.collaboration_candidate_attachments a WHERE a.id = attachment_id AND public.is_room_member(auth.uid(), a.room_id))
);
DROP POLICY IF EXISTS "Users can update their comments" ON public.collaboration_candidate_comments;
CREATE POLICY "Users can update their comments" ON public.collaboration_candidate_comments FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Room members can view tags" ON public.collaboration_candidate_tags;
CREATE POLICY "Room members can view tags" ON public.collaboration_candidate_tags FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.collaboration_candidate_attachments a WHERE a.id = collaboration_candidate_tags.attachment_id AND public.is_room_member(auth.uid(), a.room_id))
);
DROP POLICY IF EXISTS "Room members can add tags" ON public.collaboration_candidate_tags;
CREATE POLICY "Room members can add tags" ON public.collaboration_candidate_tags FOR INSERT WITH CHECK (
  auth.uid() = created_by AND EXISTS (SELECT 1 FROM public.collaboration_candidate_attachments a WHERE a.id = attachment_id AND public.is_room_member(auth.uid(), a.room_id))
);
DROP POLICY IF EXISTS "Tag creators can delete tags" ON public.collaboration_candidate_tags;
CREATE POLICY "Tag creators can delete tags" ON public.collaboration_candidate_tags FOR DELETE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Anyone can view contact history" ON public.collaboration_contact_history;
CREATE POLICY "Anyone can view contact history" ON public.collaboration_contact_history FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can record contacts" ON public.collaboration_contact_history;
CREATE POLICY "Authenticated users can record contacts" ON public.collaboration_contact_history FOR INSERT WITH CHECK (auth.uid() = contacted_by);

ALTER TABLE public.collaboration_messages REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_attachments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_comments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_contact_history REPLICA IDENTITY FULL;

CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.collaboration_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.collaboration_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON public.collaboration_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.collaboration_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_room ON public.collaboration_candidate_attachments(room_id);
CREATE INDEX IF NOT EXISTS idx_attachments_candidate ON public.collaboration_candidate_attachments(candidate_source, candidate_id);
CREATE INDEX IF NOT EXISTS idx_contact_history_candidate ON public.collaboration_contact_history(candidate_source, candidate_id);
CREATE INDEX IF NOT EXISTS idx_comments_attachment ON public.collaboration_candidate_comments(attachment_id);
CREATE INDEX IF NOT EXISTS idx_tags_attachment ON public.collaboration_candidate_tags(attachment_id);

DROP TRIGGER IF EXISTS update_collaboration_rooms_updated_at ON public.collaboration_rooms;
CREATE TRIGGER update_collaboration_rooms_updated_at BEFORE UPDATE ON public.collaboration_rooms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_collaboration_messages_updated_at ON public.collaboration_messages;
CREATE TRIGGER update_collaboration_messages_updated_at BEFORE UPDATE ON public.collaboration_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Interview scheduling
-- ============================================================
DO $$ BEGIN CREATE TYPE public.interview_location_type AS ENUM ('video','phone','in_person'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.interview_status AS ENUM ('scheduled','completed','cancelled','no_show','rescheduled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.slot_status AS ENUM ('available','booked','blocked'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.reminder_type AS ENUM ('24h','1h','15min'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.interview_types (
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
CREATE TABLE IF NOT EXISTS public.interview_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);
CREATE TABLE IF NOT EXISTS public.interview_slots (
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
CREATE TABLE IF NOT EXISTS public.interviews (
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
CREATE TABLE IF NOT EXISTS public.interview_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID REFERENCES public.interviews(id) ON DELETE CASCADE NOT NULL,
  reminder_type reminder_type NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT DEFAULT 'sent',
  error_message TEXT,
  UNIQUE(interview_id, reminder_type)
);

ALTER TABLE public.interview_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active interview types" ON public.interview_types;
CREATE POLICY "Anyone can view active interview types" ON public.interview_types FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Authenticated users can create interview types" ON public.interview_types;
CREATE POLICY "Authenticated users can create interview types" ON public.interview_types FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "Creators can update their interview types" ON public.interview_types;
CREATE POLICY "Creators can update their interview types" ON public.interview_types FOR UPDATE USING (auth.uid() = created_by);
DROP POLICY IF EXISTS "Creators can delete their interview types" ON public.interview_types;
CREATE POLICY "Creators can delete their interview types" ON public.interview_types FOR DELETE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can view their own availability" ON public.interview_availability;
CREATE POLICY "Users can view their own availability" ON public.interview_availability FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own availability" ON public.interview_availability;
CREATE POLICY "Users can create their own availability" ON public.interview_availability FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own availability" ON public.interview_availability;
CREATE POLICY "Users can update their own availability" ON public.interview_availability FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own availability" ON public.interview_availability;
CREATE POLICY "Users can delete their own availability" ON public.interview_availability FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Recruiters can view their own slots" ON public.interview_slots;
CREATE POLICY "Recruiters can view their own slots" ON public.interview_slots FOR SELECT USING (auth.uid() = recruiter_id);
DROP POLICY IF EXISTS "Anyone can view available slots by token" ON public.interview_slots;
CREATE POLICY "Anyone can view available slots by token" ON public.interview_slots FOR SELECT USING (status = 'available');
DROP POLICY IF EXISTS "Recruiters can create their own slots" ON public.interview_slots;
CREATE POLICY "Recruiters can create their own slots" ON public.interview_slots FOR INSERT WITH CHECK (auth.uid() = recruiter_id);
DROP POLICY IF EXISTS "Recruiters can update their own slots" ON public.interview_slots;
CREATE POLICY "Recruiters can update their own slots" ON public.interview_slots FOR UPDATE USING (auth.uid() = recruiter_id);
DROP POLICY IF EXISTS "Recruiters can delete their own slots" ON public.interview_slots;
CREATE POLICY "Recruiters can delete their own slots" ON public.interview_slots FOR DELETE USING (auth.uid() = recruiter_id);

DROP POLICY IF EXISTS "Recruiters can view their interviews" ON public.interviews;
CREATE POLICY "Recruiters can view their interviews" ON public.interviews FOR SELECT USING (auth.uid() = recruiter_id);
DROP POLICY IF EXISTS "Anyone can create interviews" ON public.interviews;
CREATE POLICY "Anyone can create interviews" ON public.interviews FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Recruiters can update their interviews" ON public.interviews;
CREATE POLICY "Recruiters can update their interviews" ON public.interviews FOR UPDATE USING (auth.uid() = recruiter_id);

DROP POLICY IF EXISTS "Recruiters can view reminders for their interviews" ON public.interview_reminders;
CREATE POLICY "Recruiters can view reminders for their interviews" ON public.interview_reminders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.interviews i WHERE i.id = interview_id AND i.recruiter_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_interview_slots_recruiter ON public.interview_slots(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_interview_slots_start_time ON public.interview_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_interview_slots_status ON public.interview_slots(status);
CREATE INDEX IF NOT EXISTS idx_interviews_recruiter ON public.interviews(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_at ON public.interviews(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON public.interviews(status);
CREATE INDEX IF NOT EXISTS idx_interview_availability_user ON public.interview_availability(user_id);

DROP TRIGGER IF EXISTS update_interview_types_updated_at ON public.interview_types;
CREATE TRIGGER update_interview_types_updated_at BEFORE UPDATE ON public.interview_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_interview_availability_updated_at ON public.interview_availability;
CREATE TRIGGER update_interview_availability_updated_at BEFORE UPDATE ON public.interview_availability FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_interview_slots_updated_at ON public.interview_slots;
CREATE TRIGGER update_interview_slots_updated_at BEFORE UPDATE ON public.interview_slots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_interviews_updated_at ON public.interviews;
CREATE TRIGGER update_interviews_updated_at BEFORE UPDATE ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- google_calendar_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE NOT NULL,
  calendar_id TEXT DEFAULT 'primary',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Users can view their own tokens" ON public.google_calendar_tokens FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Users can insert their own tokens" ON public.google_calendar_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Users can update their own tokens" ON public.google_calendar_tokens FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Users can delete their own tokens" ON public.google_calendar_tokens FOR DELETE USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_google_calendar_tokens_updated_at ON public.google_calendar_tokens;
CREATE TRIGGER update_google_calendar_tokens_updated_at BEFORE UPDATE ON public.google_calendar_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- email_tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scheduled_email_id UUID REFERENCES public.scheduled_emails(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  link_url TEXT,
  tracked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_address TEXT
);
ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert tracking events" ON public.email_tracking;
CREATE POLICY "Anyone can insert tracking events" ON public.email_tracking FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can view tracking events" ON public.email_tracking;
CREATE POLICY "Anyone can view tracking events" ON public.email_tracking FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_email_tracking_scheduled_email_id ON public.email_tracking(scheduled_email_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_event_type ON public.email_tracking(event_type);

-- Note: pg_cron job for sending scheduled emails was skipped — the original
-- migration referenced the OLD project URL and an old anon key. Re-enable later
-- via the Supabase dashboard against the new project URL when needed.