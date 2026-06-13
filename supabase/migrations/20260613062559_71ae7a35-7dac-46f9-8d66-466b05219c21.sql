
-- Fix 1: email_tracking — replace open INSERT policy with one that requires a real scheduled_email_id
DROP POLICY IF EXISTS "Anyone can insert tracking events" ON public.email_tracking;
CREATE POLICY "Tracking events require valid scheduled email"
  ON public.email_tracking
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    scheduled_email_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.scheduled_emails se
      WHERE se.id = email_tracking.scheduled_email_id
    )
  );

-- Fix 2: screening_conversation_logs — require session to exist and still be in progress
DROP POLICY IF EXISTS "Anyone can insert conversation logs" ON public.screening_conversation_logs;
CREATE POLICY "Conversation logs require active session"
  ON public.screening_conversation_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.adaptive_screening_sessions s
      WHERE s.id = screening_conversation_logs.session_id
        AND COALESCE(s.session_status, 'in_progress') = 'in_progress'
    )
  );

-- Fix 3: screening-resumes bucket — let recruiters delete/update resumes for jobs they own
CREATE POLICY "Recruiters delete own screening resumes"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'screening-resumes'
    AND EXISTS (
      SELECT 1
      FROM public.screening_applications a
      JOIN public.screening_jobs j ON j.id = a.job_id
      WHERE j.user_id = auth.uid()
        AND a.resume_url LIKE '%' || objects.name
    )
  );

CREATE POLICY "Recruiters update own screening resumes"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'screening-resumes'
    AND EXISTS (
      SELECT 1
      FROM public.screening_applications a
      JOIN public.screening_jobs j ON j.id = a.job_id
      WHERE j.user_id = auth.uid()
        AND a.resume_url LIKE '%' || objects.name
    )
  );
