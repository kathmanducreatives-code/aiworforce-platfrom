
-- =========================================================
-- 1. clients + client_active_positions + client_placements
-- =========================================================
DROP POLICY IF EXISTS "Public users can delete clients" ON public.clients;
DROP POLICY IF EXISTS "Public users can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Public users can update clients" ON public.clients;
DROP POLICY IF EXISTS "Public users can view clients" ON public.clients;
DROP POLICY IF EXISTS "Users can view their own client" ON public.clients;

CREATE POLICY "Users view own client" ON public.clients
  FOR SELECT TO authenticated USING (id = public.get_user_client_id(auth.uid()));
CREATE POLICY "Users update own client" ON public.clients
  FOR UPDATE TO authenticated USING (id = public.get_user_client_id(auth.uid()))
  WITH CHECK (id = public.get_user_client_id(auth.uid()));
CREATE POLICY "Users insert own client" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (id = public.get_user_client_id(auth.uid()));

DROP POLICY IF EXISTS "Public users can delete active positions" ON public.client_active_positions;
DROP POLICY IF EXISTS "Public users can insert active positions" ON public.client_active_positions;
DROP POLICY IF EXISTS "Public users can update active positions" ON public.client_active_positions;
DROP POLICY IF EXISTS "Public users can view active positions" ON public.client_active_positions;

CREATE POLICY "Users manage own client positions" ON public.client_active_positions
  FOR ALL TO authenticated
  USING (client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (client_id = public.get_user_client_id(auth.uid()));

DROP POLICY IF EXISTS "Public users can delete placements" ON public.client_placements;
DROP POLICY IF EXISTS "Public users can insert placements" ON public.client_placements;
DROP POLICY IF EXISTS "Public users can update placements" ON public.client_placements;
DROP POLICY IF EXISTS "Public users can view placements" ON public.client_placements;

CREATE POLICY "Users manage own client placements" ON public.client_placements
  FOR ALL TO authenticated
  USING (client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (client_id = public.get_user_client_id(auth.uid()));

-- =========================================================
-- 2. candidate_notes
-- =========================================================
DROP POLICY IF EXISTS "Anyone can create notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Anyone can view candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON public.candidate_notes;

CREATE POLICY "Authed view candidate notes" ON public.candidate_notes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed insert candidate notes" ON public.candidate_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authors update own notes" ON public.candidate_notes
  FOR UPDATE TO authenticated USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authors delete own notes" ON public.candidate_notes
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- =========================================================
-- 3. deep_search_results (no user_id column — lock to authed)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can delete deep search results" ON public.deep_search_results;
DROP POLICY IF EXISTS "Anyone can insert deep search results" ON public.deep_search_results;
DROP POLICY IF EXISTS "Anyone can update deep search results" ON public.deep_search_results;
DROP POLICY IF EXISTS "Anyone can view deep search results" ON public.deep_search_results;

CREATE POLICY "Authed manage deep search results" ON public.deep_search_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 4. deep_search_analysis (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can delete deep search analysis" ON public.deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can insert deep search analysis" ON public.deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can update deep search analysis" ON public.deep_search_analysis;
DROP POLICY IF EXISTS "Authenticated users can view deep search analysis" ON public.deep_search_analysis;

CREATE POLICY "Users view own deep search analysis" ON public.deep_search_analysis
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own deep search analysis" ON public.deep_search_analysis
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own deep search analysis" ON public.deep_search_analysis
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own deep search analysis" ON public.deep_search_analysis
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- 5. icp_lookalike_sessions (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Authed manage icp sessions" ON public.icp_lookalike_sessions;
DROP POLICY IF EXISTS "Authed view icp sessions" ON public.icp_lookalike_sessions;

CREATE POLICY "Users manage own icp sessions" ON public.icp_lookalike_sessions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 6. marketing_tasks (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Authed manage marketing tasks" ON public.marketing_tasks;

CREATE POLICY "Users manage own marketing tasks" ON public.marketing_tasks
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 7. outreach_settings (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Authed manage outreach settings" ON public.outreach_settings;

CREATE POLICY "Users manage own outreach settings" ON public.outreach_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 8. scheduled_emails (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can create scheduled emails" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Anyone can delete scheduled emails" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Anyone can update scheduled emails" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Anyone can view scheduled emails" ON public.scheduled_emails;

CREATE POLICY "Users manage own scheduled emails" ON public.scheduled_emails
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 9. scraping_sessions (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can delete scraping sessions" ON public.scraping_sessions;
DROP POLICY IF EXISTS "Anyone can insert scraping sessions" ON public.scraping_sessions;
DROP POLICY IF EXISTS "Anyone can update scraping sessions" ON public.scraping_sessions;
DROP POLICY IF EXISTS "Anyone can view scraping sessions" ON public.scraping_sessions;

CREATE POLICY "Users manage own scraping sessions" ON public.scraping_sessions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 10. task_plans (scope by user_id)
-- =========================================================
DROP POLICY IF EXISTS "Authed manage task plans" ON public.task_plans;
DROP POLICY IF EXISTS "Authenticated users can manage task plans" ON public.task_plans;

CREATE POLICY "Users manage own task plans" ON public.task_plans
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 11. linkedin_leads
-- =========================================================
DROP POLICY IF EXISTS "Anyone can delete linkedin leads" ON public.linkedin_leads;
DROP POLICY IF EXISTS "Anyone can insert linkedin leads" ON public.linkedin_leads;
DROP POLICY IF EXISTS "Anyone can update linkedin leads" ON public.linkedin_leads;
DROP POLICY IF EXISTS "Anyone can view linkedin leads" ON public.linkedin_leads;

CREATE POLICY "Authed manage linkedin leads" ON public.linkedin_leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 12. resume_analyses
-- =========================================================
DROP POLICY IF EXISTS "Public users can delete resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Public users can insert resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Public users can update resume analyses" ON public.resume_analyses;
DROP POLICY IF EXISTS "Public users can view resume analyses" ON public.resume_analyses;

CREATE POLICY "Authed manage resume analyses" ON public.resume_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 13. collaboration_contact_history (SELECT to authenticated)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can view contact history" ON public.collaboration_contact_history;

CREATE POLICY "Authed view contact history" ON public.collaboration_contact_history
  FOR SELECT TO authenticated USING (true);

-- =========================================================
-- 14. email_tracking (lock SELECT to authed; keep anon INSERT for pixel)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can view tracking events" ON public.email_tracking;

CREATE POLICY "Authed view email tracking" ON public.email_tracking
  FOR SELECT TO authenticated USING (true);
-- existing "Anyone can insert tracking events" INSERT policy remains for pixel beacon

-- =========================================================
-- 15. adaptive_screening_sessions
-- Lock SELECT and full management to authenticated; allow anon INSERT/UPDATE
-- so the public candidate apply flow keeps working.
-- =========================================================
DROP POLICY IF EXISTS "Anyone can manage sessions" ON public.adaptive_screening_sessions;
DROP POLICY IF EXISTS "Anyone can view sessions" ON public.adaptive_screening_sessions;

CREATE POLICY "Authed view screening sessions" ON public.adaptive_screening_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone insert screening session" ON public.adaptive_screening_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone update screening session" ON public.adaptive_screening_sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed delete screening sessions" ON public.adaptive_screening_sessions
  FOR DELETE TO authenticated USING (true);

-- =========================================================
-- 16. screening_behavioral_analysis
-- =========================================================
DROP POLICY IF EXISTS "Anyone can manage behavioral analysis" ON public.screening_behavioral_analysis;
DROP POLICY IF EXISTS "Anyone can view behavioral analysis" ON public.screening_behavioral_analysis;

CREATE POLICY "Authed view behavioral analysis" ON public.screening_behavioral_analysis
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed manage behavioral analysis" ON public.screening_behavioral_analysis
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authed update behavioral analysis" ON public.screening_behavioral_analysis
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authed delete behavioral analysis" ON public.screening_behavioral_analysis
  FOR DELETE TO authenticated USING (true);

-- =========================================================
-- 17. screening_conversation_logs (lock SELECT; keep anon INSERT)
-- =========================================================
DROP POLICY IF EXISTS "Anyone can view conversation logs" ON public.screening_conversation_logs;

CREATE POLICY "Authed view conversation logs" ON public.screening_conversation_logs
  FOR SELECT TO authenticated USING (true);
-- existing "Anyone can insert conversation logs" INSERT policy remains for candidate flow

-- =========================================================
-- 18. screening_applications — fix broken token-based policies
-- =========================================================
DROP POLICY IF EXISTS "Anyone can view applications by token" ON public.screening_applications;
DROP POLICY IF EXISTS "Anyone can update applications by token" ON public.screening_applications;
-- "Recruiters can view applications for their jobs" SELECT policy remains
-- "Anyone can create applications" INSERT policy remains for public apply

CREATE POLICY "Recruiters update their job applications" ON public.screening_applications
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = screening_applications.job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = screening_applications.job_id AND j.user_id = auth.uid()));

-- =========================================================
-- 19. screening-resumes storage bucket
-- =========================================================
DROP POLICY IF EXISTS "Anyone can read screening resumes" ON storage.objects;

CREATE POLICY "Authed read screening resumes" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'screening-resumes');
-- existing "Anyone can upload resumes" INSERT policy remains for public apply flow

-- =========================================================
-- 20. realtime.messages — deny-by-default policy
-- App uses postgres_changes (governed by underlying RLS), not broadcast/presence.
-- Add explicit deny so anon/authenticated cannot subscribe to private channels.
-- =========================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'realtime' AND c.relname = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Deny all realtime messages" ON realtime.messages';
    EXECUTE 'CREATE POLICY "Deny all realtime messages" ON realtime.messages FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
END$$;
