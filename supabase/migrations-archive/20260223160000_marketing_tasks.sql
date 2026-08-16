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
