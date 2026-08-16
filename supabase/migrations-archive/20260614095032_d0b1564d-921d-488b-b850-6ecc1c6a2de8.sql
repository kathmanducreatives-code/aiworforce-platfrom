DROP POLICY IF EXISTS "Anyone insert screening session" ON public.adaptive_screening_sessions;

CREATE POLICY "Anyone insert screening session for active job"
ON public.adaptive_screening_sessions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.screening_jobs j
    WHERE j.id = adaptive_screening_sessions.job_id
      AND j.status = 'active'
  )
);