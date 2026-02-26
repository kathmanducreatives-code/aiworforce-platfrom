-- Add scheduled_date column to linkedin_posts for auto-publishing scheduling
-- This allows each post to be assigned a specific calendar date

ALTER TABLE public.linkedin_posts
ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Add an index for efficient date-based queries (N8N cron will query by date)
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_scheduled_date
ON public.linkedin_posts (scheduled_date)
WHERE scheduled_date IS NOT NULL;

-- Backfill: assign sequential dates starting from today for existing posts
DO $$
DECLARE
    post_record RECORD;
    day_offset INT := 0;
BEGIN
    FOR post_record IN
        SELECT id FROM public.linkedin_posts
        WHERE scheduled_date IS NULL
        ORDER BY created_at ASC
    LOOP
        UPDATE public.linkedin_posts
        SET scheduled_date = CURRENT_DATE + day_offset
        WHERE id = post_record.id;
        day_offset := day_offset + 1;
    END LOOP;
END
$$;
