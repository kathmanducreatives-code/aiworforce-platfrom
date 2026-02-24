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
