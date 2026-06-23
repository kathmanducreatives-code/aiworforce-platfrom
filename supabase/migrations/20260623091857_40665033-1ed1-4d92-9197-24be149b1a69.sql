
-- interviews: restrict SELECT/UPDATE to authenticated
DROP POLICY IF EXISTS "Recruiters can view their interviews" ON public.interviews;
CREATE POLICY "Recruiters can view their interviews"
  ON public.interviews FOR SELECT TO authenticated
  USING (auth.uid() = recruiter_id);

DROP POLICY IF EXISTS "Recruiters can update their interviews" ON public.interviews;
CREATE POLICY "Recruiters can update their interviews"
  ON public.interviews FOR UPDATE TO authenticated
  USING (auth.uid() = recruiter_id);

-- screening_applications: restrict SELECT to authenticated
DROP POLICY IF EXISTS "Recruiters can view applications for their jobs" ON public.screening_applications;
CREATE POLICY "Recruiters can view applications for their jobs"
  ON public.screening_applications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.screening_jobs
    WHERE screening_jobs.id = screening_applications.job_id
      AND screening_jobs.user_id = auth.uid()
  ));

-- tasks: enforce workspace membership on insert/update
DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
CREATE POLICY "Users can insert their own tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id))
  );

DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
CREATE POLICY "Users can update their own tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id))
  );
