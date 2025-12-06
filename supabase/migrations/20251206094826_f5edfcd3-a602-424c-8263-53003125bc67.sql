-- Create email tracking table
CREATE TABLE public.email_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scheduled_email_id UUID REFERENCES public.scheduled_emails(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'open' or 'click'
  link_url TEXT, -- only for click events
  tracked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_address TEXT
);

-- Enable RLS
ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert tracking events (from edge function)
CREATE POLICY "Anyone can insert tracking events"
ON public.email_tracking
FOR INSERT
WITH CHECK (true);

-- Allow anyone to view tracking events
CREATE POLICY "Anyone can view tracking events"
ON public.email_tracking
FOR SELECT
USING (true);

-- Add index for faster lookups
CREATE INDEX idx_email_tracking_scheduled_email_id ON public.email_tracking(scheduled_email_id);
CREATE INDEX idx_email_tracking_event_type ON public.email_tracking(event_type);