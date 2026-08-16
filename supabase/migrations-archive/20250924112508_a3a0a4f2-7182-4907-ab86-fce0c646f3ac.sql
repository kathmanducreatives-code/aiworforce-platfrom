-- Remove the current public read policy that exposes candidate data
DROP POLICY IF EXISTS "Public read resume analyses" ON public.resume_analyses;

-- Create secure policies that require authentication
CREATE POLICY "Authenticated users can view resume analyses" 
ON public.resume_analyses 
FOR SELECT 
TO authenticated 
USING (true);

-- Update insert policy to only allow authenticated users
DROP POLICY IF EXISTS "Allow insert resume analyses" ON public.resume_analyses;
CREATE POLICY "Authenticated users can insert resume analyses" 
ON public.resume_analyses 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Update delete policy to only allow authenticated users
DROP POLICY IF EXISTS "Allow delete resume analyses" ON public.resume_analyses;
CREATE POLICY "Authenticated users can delete resume analyses" 
ON public.resume_analyses 
FOR DELETE 
TO authenticated 
USING (true);

-- Add update policy for authenticated users
CREATE POLICY "Authenticated users can update resume analyses" 
ON public.resume_analyses 
FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);