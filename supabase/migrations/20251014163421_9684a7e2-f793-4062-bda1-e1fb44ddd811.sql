-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create notes" ON public.candidate_notes;

-- Create a new public INSERT policy that allows anyone to add notes
CREATE POLICY "Anyone can create notes"
ON public.candidate_notes
FOR INSERT
TO public
WITH CHECK (true);

-- Update the SELECT policy to ensure it's also public
DROP POLICY IF EXISTS "Users can view all candidate notes" ON public.candidate_notes;

CREATE POLICY "Anyone can view candidate notes"
ON public.candidate_notes
FOR SELECT
TO public
USING (true);