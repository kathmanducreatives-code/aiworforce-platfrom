
-- Helper: add restrictive deny policies for write ops on service-role-only tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agent_runs','candidate_profiles','competitor_companies','competitor_profiles',
    'competitor_intel_signals','competitor_job_postings','pricing_history','talent_signals',
    'deep_search_results','firecrawl_scrape_logs','growth_signal_companies',
    'job_distribution_postings','job_distribution_status','job_market_intelligence',
    'outreach_activities','outreach_leads','outreach_sequences','resume_analyses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Deny writes %1$s" ON public.%1$I;', t);
    EXECUTE format($p$CREATE POLICY "Deny writes %1$s" ON public.%1$I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);$p$, t);
  END LOOP;
END $$;

-- screening_behavioral_analysis: restrict INSERT to job owner
DROP POLICY IF EXISTS "Authed manage behavioral analysis" ON public.screening_behavioral_analysis;
CREATE POLICY "Recruiters insert own behavioral analysis"
ON public.screening_behavioral_analysis
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM adaptive_screening_sessions s
  JOIN screening_jobs j ON j.id = s.job_id
  WHERE s.id = screening_behavioral_analysis.session_id
    AND j.user_id = auth.uid()
));

-- screening_templates: restrict ALL to creator
DROP POLICY IF EXISTS "Authed manage templates" ON public.screening_templates;
CREATE POLICY "Creators manage own templates"
ON public.screening_templates
FOR ALL TO authenticated
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

-- screening_template_questions: restrict ALL to template creator
DROP POLICY IF EXISTS "Authed manage template questions" ON public.screening_template_questions;
CREATE POLICY "Creators manage own template questions"
ON public.screening_template_questions
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.screening_templates t
  WHERE t.id = screening_template_questions.template_id
    AND t.created_by = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.screening_templates t
  WHERE t.id = screening_template_questions.template_id
    AND t.created_by = auth.uid()
));

-- task_plans: add workspace membership check
DROP POLICY IF EXISTS "Users manage own task plans" ON public.task_plans;
CREATE POLICY "Users manage own task plans"
ON public.task_plans
FOR ALL TO authenticated
USING (
  auth.uid() = user_id
  AND (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id))
)
WITH CHECK (
  auth.uid() = user_id
  AND (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id))
);

-- interview_types: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "Anyone can view active interview types" ON public.interview_types;
CREATE POLICY "Authenticated view active interview types"
ON public.interview_types
FOR SELECT TO authenticated
USING (is_active = true);
