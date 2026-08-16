-- Add recruitment_name column to resume_analyses table
ALTER TABLE public.resume_analyses 
ADD COLUMN recruitment_name TEXT;