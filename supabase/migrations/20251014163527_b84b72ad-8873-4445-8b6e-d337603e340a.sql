-- Enable RLS on scheduled_emails table
ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;

-- Add policy to allow anyone to view scheduled emails
CREATE POLICY "Anyone can view scheduled emails"
ON public.scheduled_emails
FOR SELECT
TO public
USING (true);

-- Add policy to allow anyone to insert scheduled emails
CREATE POLICY "Anyone can create scheduled emails"
ON public.scheduled_emails
FOR INSERT
TO public
WITH CHECK (true);

-- Add policy to allow anyone to update scheduled emails
CREATE POLICY "Anyone can update scheduled emails"
ON public.scheduled_emails
FOR UPDATE
TO public
USING (true);

-- Add policy to allow anyone to delete scheduled emails
CREATE POLICY "Anyone can delete scheduled emails"
ON public.scheduled_emails
FOR DELETE
TO public
USING (true);