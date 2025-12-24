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