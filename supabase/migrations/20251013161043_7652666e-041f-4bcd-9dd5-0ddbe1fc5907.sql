-- Add status tracking columns to resume_analyses table
ALTER TABLE resume_analyses 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES auth.users(id);

-- Create table for candidate notes
CREATE TABLE IF NOT EXISTS candidate_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES resume_analyses(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_resume_analyses_status ON resume_analyses(status);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_candidate_id ON candidate_notes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_created_at ON candidate_notes(created_at DESC);

-- Enable RLS for candidate_notes
ALTER TABLE candidate_notes ENABLE ROW LEVEL SECURITY;

-- Create policies for candidate_notes
CREATE POLICY "Users can view all candidate notes" 
ON candidate_notes 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can create notes" 
ON candidate_notes 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own notes" 
ON candidate_notes 
FOR UPDATE 
USING (auth.uid() = created_by);