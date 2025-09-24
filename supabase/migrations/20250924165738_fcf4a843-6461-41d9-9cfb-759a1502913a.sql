-- Temporarily disable RLS for resume_analyses to allow public access
-- This will allow the dashboard to display data without authentication
ALTER TABLE resume_analyses DISABLE ROW LEVEL SECURITY;

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can view resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can insert resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can update resume analyses" ON resume_analyses;
DROP POLICY IF EXISTS "Authenticated users can delete resume analyses" ON resume_analyses;

-- Re-enable RLS with public access policies
ALTER TABLE resume_analyses ENABLE ROW LEVEL SECURITY;

-- Create new policies that allow public access
CREATE POLICY "Public users can view resume analyses" 
ON resume_analyses 
FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert resume analyses" 
ON resume_analyses 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update resume analyses" 
ON resume_analyses 
FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete resume analyses" 
ON resume_analyses 
FOR DELETE 
USING (true);