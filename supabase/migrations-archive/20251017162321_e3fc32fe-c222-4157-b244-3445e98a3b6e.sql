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