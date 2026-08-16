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