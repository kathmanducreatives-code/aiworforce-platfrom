
-- adaptive_screening_sessions
DROP POLICY IF EXISTS "Authed view screening sessions" ON public.adaptive_screening_sessions;
DROP POLICY IF EXISTS "Authed delete screening sessions" ON public.adaptive_screening_sessions;
DROP POLICY IF EXISTS "Anyone update screening session" ON public.adaptive_screening_sessions;

CREATE POLICY "Recruiters view own screening sessions"
ON public.adaptive_screening_sessions FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = adaptive_screening_sessions.job_id AND j.user_id = auth.uid()));

CREATE POLICY "Recruiters delete own screening sessions"
ON public.adaptive_screening_sessions FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = adaptive_screening_sessions.job_id AND j.user_id = auth.uid()));

-- Candidate (anon) updates still allowed for the live screening flow
CREATE POLICY "Anon update active screening session"
ON public.adaptive_screening_sessions FOR UPDATE
TO anon
USING (session_status = 'in_progress')
WITH CHECK (true);

-- candidate_notes
DROP POLICY IF EXISTS "Authed view candidate notes" ON public.candidate_notes;
CREATE POLICY "Authors view own notes"
ON public.candidate_notes FOR SELECT
TO authenticated
USING (auth.uid() = created_by);

-- collaboration_contact_history
DROP POLICY IF EXISTS "Authed view contact history" ON public.collaboration_contact_history;
CREATE POLICY "Contactors view own contact history"
ON public.collaboration_contact_history FOR SELECT
TO authenticated
USING (auth.uid() = contacted_by);

-- deep_search_results -- no owner column; remove cross-tenant access
DROP POLICY IF EXISTS "Authed manage deep search results" ON public.deep_search_results;

-- email_tracking
DROP POLICY IF EXISTS "Authed view email tracking" ON public.email_tracking;
CREATE POLICY "Users view own email tracking"
ON public.email_tracking FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.scheduled_emails se WHERE se.id = email_tracking.scheduled_email_id AND se.user_id = auth.uid()));

-- interview_slots -- remove public enumeration
DROP POLICY IF EXISTS "Anyone can view available slots by token" ON public.interview_slots;

-- linkedin_leads
DROP POLICY IF EXISTS "Authed manage linkedin leads" ON public.linkedin_leads;
CREATE POLICY "Users view own linkedin leads"
ON public.linkedin_leads FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.scraping_sessions s WHERE s.id = linkedin_leads.session_id AND s.user_id = auth.uid()));
CREATE POLICY "Users insert own linkedin leads"
ON public.linkedin_leads FOR INSERT
TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.scraping_sessions s WHERE s.id = linkedin_leads.session_id AND s.user_id = auth.uid()));
CREATE POLICY "Users update own linkedin leads"
ON public.linkedin_leads FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.scraping_sessions s WHERE s.id = linkedin_leads.session_id AND s.user_id = auth.uid()));
CREATE POLICY "Users delete own linkedin leads"
ON public.linkedin_leads FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.scraping_sessions s WHERE s.id = linkedin_leads.session_id AND s.user_id = auth.uid()));

-- resume_analyses -- no owner column; remove cross-tenant access
DROP POLICY IF EXISTS "Authed manage resume analyses" ON public.resume_analyses;

-- screening_behavioral_analysis
DROP POLICY IF EXISTS "Authed view behavioral analysis" ON public.screening_behavioral_analysis;
DROP POLICY IF EXISTS "Authed update behavioral analysis" ON public.screening_behavioral_analysis;
DROP POLICY IF EXISTS "Authed delete behavioral analysis" ON public.screening_behavioral_analysis;

CREATE POLICY "Recruiters view own behavioral analysis"
ON public.screening_behavioral_analysis FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.adaptive_screening_sessions s
  JOIN public.screening_jobs j ON j.id = s.job_id
  WHERE s.id = screening_behavioral_analysis.session_id AND j.user_id = auth.uid()
));
CREATE POLICY "Recruiters update own behavioral analysis"
ON public.screening_behavioral_analysis FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.adaptive_screening_sessions s
  JOIN public.screening_jobs j ON j.id = s.job_id
  WHERE s.id = screening_behavioral_analysis.session_id AND j.user_id = auth.uid()
));
CREATE POLICY "Recruiters delete own behavioral analysis"
ON public.screening_behavioral_analysis FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.adaptive_screening_sessions s
  JOIN public.screening_jobs j ON j.id = s.job_id
  WHERE s.id = screening_behavioral_analysis.session_id AND j.user_id = auth.uid()
));

-- screening_conversation_logs
DROP POLICY IF EXISTS "Authed view conversation logs" ON public.screening_conversation_logs;
CREATE POLICY "Recruiters view own conversation logs"
ON public.screening_conversation_logs FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.adaptive_screening_sessions s
  JOIN public.screening_jobs j ON j.id = s.job_id
  WHERE s.id = screening_conversation_logs.session_id AND j.user_id = auth.uid()
));

-- task_plans -- remove the broad "Authed manage" policy
DROP POLICY IF EXISTS "Authed manage task_plans" ON public.task_plans;

-- storage.objects screening-resumes -- replace broad read with ownership-scoped read
DROP POLICY IF EXISTS "Authed read screening resumes" ON storage.objects;
CREATE POLICY "Recruiters read own screening resumes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'screening-resumes'
  AND EXISTS (
    SELECT 1 FROM public.screening_applications a
    JOIN public.screening_jobs j ON j.id = a.job_id
    WHERE j.user_id = auth.uid()
      AND a.resume_url LIKE '%' || storage.objects.name
  )
);
