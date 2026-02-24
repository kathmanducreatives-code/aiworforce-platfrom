-- Enable Real-Time for linkedin_posts table
-- This allows the ContentPlanner UI to listen to INSERT/UPDATE/DELETE events instantly

BEGIN;

-- Check if the table is already in the publication, and add it if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'linkedin_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.linkedin_posts;
  END IF;
END
$$;

COMMIT;
