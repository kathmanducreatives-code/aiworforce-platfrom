
ALTER TABLE public.screening_applications
ADD COLUMN IF NOT EXISTS recruiter_status text DEFAULT 'new',
ADD COLUMN IF NOT EXISTS recruiter_notes text,
ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
