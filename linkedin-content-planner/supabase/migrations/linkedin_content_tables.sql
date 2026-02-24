-- Migration: Add LinkedIn Content Planning tables
-- Author: Antigravity

CREATE TABLE IF NOT EXISTS public.linkedin_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  day TEXT NOT NULL,
  content_format TEXT,
  post_caption TEXT,
  image_prompt TEXT,
  video_idea JSONB,
  carousel_script JSONB,
  comic_script JSONB,
  data_visual JSONB,
  hot_take JSONB,
  poll JSONB,
  status TEXT DEFAULT 'Planned' CHECK (status IN ('Planned', 'Posted', 'Scheduled')),
  scheduled_time TEXT DEFAULT '08:00',
  linkedin_post_id TEXT, -- For tracking published post ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
-- ALTER TABLE public.linkedin_posts ENABLE ROW LEVEL SECURITY;
