-- Add RLS policy to allow delete operations on resume_analyses table
CREATE POLICY "Allow delete resume analyses" 
ON public.resume_analyses 
FOR DELETE 
USING (true);