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