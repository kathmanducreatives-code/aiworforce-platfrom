-- Add a name column to scraping_sessions for folder organization
ALTER TABLE public.scraping_sessions 
ADD COLUMN name text;