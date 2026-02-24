-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 
-- 1. Sequences Table
-- Needs to exist before Leads (for foreign keys)
--
CREATE TABLE IF NOT EXISTS public.outreach_sequences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  steps JSONB NOT NULL DEFAULT '[]',
  leads_enrolled INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 
-- 2. Leads Table
--
CREATE TABLE IF NOT EXISTS public.outreach_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  linkedin_url TEXT,
  industry TEXT,
  company_size TEXT,
  notes TEXT,
  tier TEXT DEFAULT 'unassigned' CHECK (tier IN ('unassigned', 'tier_1', 'tier_2', 'tier_3')),
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_sequence', 'replied', 'meeting_booked', 'closed', 'dead')),
  signals JSONB DEFAULT '[]',
  sequence_id UUID REFERENCES outreach_sequences(id),
  current_sequence_step INT DEFAULT 0,
  last_touch_date TIMESTAMPTZ,
  next_action_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 
-- 3. Activities / Timeline Table
--
CREATE TABLE IF NOT EXISTS public.outreach_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES outreach_leads(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES outreach_sequences(id),
  step_number INT,
  channel TEXT CHECK (channel IN ('email', 'linkedin_dm', 'linkedin_connect', 'linkedin_engage', 'manual')),
  action_type TEXT, 
  subject TEXT,
  body TEXT,
  scheduled_date TIMESTAMPTZ,
  executed_date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  response_received BOOLEAN DEFAULT FALSE,
  response_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 
-- 4. Outreach Settings Table
--
CREATE TABLE IF NOT EXISTS public.outreach_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID, -- Optional: link to existing user table if authenticated
  product_context TEXT, 
  email_signature TEXT,
  default_cta TEXT DEFAULT 'Worth a 15-min look?',
  linkedin_daily_connect_limit INT DEFAULT 20,
  linkedin_daily_dm_limit INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 
-- 5. Dashboard View
--
CREATE OR REPLACE VIEW public.outreach_dashboard AS
SELECT
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE status = 'in_sequence') as in_sequence,
  COUNT(*) FILTER (WHERE status = 'replied') as replied,
  COUNT(*) FILTER (WHERE status = 'meeting_booked') as meetings_booked,
  COUNT(*) FILTER (WHERE status = 'closed') as closed,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week
FROM public.outreach_leads;

-- RLS Policies (Optional but Recommended)
-- ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.outreach_activities ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;
