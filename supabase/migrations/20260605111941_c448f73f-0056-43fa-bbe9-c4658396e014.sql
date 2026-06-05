
-- 1. adaptive_screening_sessions: remove unsafe anon UPDATE
DROP POLICY IF EXISTS "Anon update active screening session" ON public.adaptive_screening_sessions;

-- 2. interviews: tighten INSERT to validate slot
DROP POLICY IF EXISTS "Anyone can create interviews" ON public.interviews;
CREATE POLICY "Anyone can create interviews against available slot"
ON public.interviews
FOR INSERT
TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.interview_slots s
    WHERE s.id = interviews.slot_id
      AND s.recruiter_id = interviews.recruiter_id
      AND s.status = 'available'
  )
);

-- 3. screening_scenarios: authenticated-only SELECT
DROP POLICY IF EXISTS "Anyone can view scenarios" ON public.screening_scenarios;
CREATE POLICY "Authenticated view scenarios"
ON public.screening_scenarios
FOR SELECT
TO authenticated
USING (true);

-- 4. screening_templates: authenticated-only SELECT
DROP POLICY IF EXISTS "Anyone can view templates" ON public.screening_templates;
CREATE POLICY "Authenticated view templates"
ON public.screening_templates
FOR SELECT
TO authenticated
USING (true);

-- 5. screening_template_questions: authenticated-only SELECT
DROP POLICY IF EXISTS "Anyone can view template questions" ON public.screening_template_questions;
CREATE POLICY "Authenticated view template questions"
ON public.screening_template_questions
FOR SELECT
TO authenticated
USING (true);

-- 6. workspace_members: restrict INSERT to workspace owners (prevent self-join privilege escalation)
DROP POLICY IF EXISTS "Self insert membership" ON public.workspace_members;
CREATE POLICY "Owners add workspace members"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_members.workspace_id
      AND w.owner_user_id = auth.uid()
  )
);

-- 7. resume_analyses: explicit deny-all SELECT policy to document intent
--    (no user/job linkage column exists; recruiter access happens via service role in edge functions)
DROP POLICY IF EXISTS "Deny direct select on resume_analyses" ON public.resume_analyses;
CREATE POLICY "Deny direct select on resume_analyses"
ON public.resume_analyses
FOR SELECT
TO authenticated, anon
USING (false);

-- 8. deep_search_results: explicit deny-all SELECT policy to document intent
DROP POLICY IF EXISTS "Deny direct select on deep_search_results" ON public.deep_search_results;
CREATE POLICY "Deny direct select on deep_search_results"
ON public.deep_search_results
FOR SELECT
TO authenticated, anon
USING (false);
