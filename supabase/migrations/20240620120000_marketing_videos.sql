-- Create marketing_videos table if it doesn't exist
CREATE TABLE IF NOT EXISTS marketing_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_name TEXT NOT NULL,
    script JSONB,
    background_video_url TEXT,
    final_video_url TEXT,
    thumbnail_url TEXT,
    duration INTEGER,
    has_motion_graphics BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns if table already exists but columns are missing (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_videos' AND column_name = 'background_video_url') THEN
        ALTER TABLE marketing_videos ADD COLUMN background_video_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_videos' AND column_name = 'has_motion_graphics') THEN
        ALTER TABLE marketing_videos ADD COLUMN has_motion_graphics BOOLEAN DEFAULT false;
    END IF;
END $$;
