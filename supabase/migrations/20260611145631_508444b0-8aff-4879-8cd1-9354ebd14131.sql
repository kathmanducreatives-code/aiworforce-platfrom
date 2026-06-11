
-- 1. Lock down NULL-workspace global agents: only service_role can write; authed can read
DROP POLICY IF EXISTS "Members manage workspace agents" ON public.agents;
CREATE POLICY "Members read agents"
  ON public.agents FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "Members write workspace agents"
  ON public.agents FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "Members update workspace agents"
  ON public.agents FOR UPDATE
  TO authenticated
  USING (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "Members delete workspace agents"
  ON public.agents FOR DELETE
  TO authenticated
  USING (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id));

-- 2. agent_capabilities: same shape — read NULL-workspace allowed, writes only for workspace-scoped agents
DROP POLICY IF EXISTS "Members manage agent capabilities" ON public.agent_capabilities;
CREATE POLICY "Members read agent capabilities"
  ON public.agent_capabilities FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND (a.workspace_id IS NULL OR has_workspace_access(auth.uid(), a.workspace_id))
  ));
CREATE POLICY "Members write agent capabilities"
  ON public.agent_capabilities FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND a.workspace_id IS NOT NULL
      AND has_workspace_access(auth.uid(), a.workspace_id)
  ));
CREATE POLICY "Members update agent capabilities"
  ON public.agent_capabilities FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND a.workspace_id IS NOT NULL
      AND has_workspace_access(auth.uid(), a.workspace_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND a.workspace_id IS NOT NULL
      AND has_workspace_access(auth.uid(), a.workspace_id)
  ));
CREATE POLICY "Members delete agent capabilities"
  ON public.agent_capabilities FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND a.workspace_id IS NOT NULL
      AND has_workspace_access(auth.uid(), a.workspace_id)
  ));

-- 3. handoffs: require explicit workspace binding
DROP POLICY IF EXISTS "Authed insert handoffs" ON public.handoffs;
DROP POLICY IF EXISTS "Members view workspace handoffs" ON public.handoffs;
CREATE POLICY "Members view workspace handoffs"
  ON public.handoffs FOR SELECT
  TO authenticated
  USING (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "Members insert workspace handoffs"
  ON public.handoffs FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND has_workspace_access(auth.uid(), workspace_id));

-- 4. interview_types: scope SELECT to creator
DROP POLICY IF EXISTS "Authenticated view active interview types" ON public.interview_types;
CREATE POLICY "Creators view own interview types"
  ON public.interview_types FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

-- 5. screening_templates + questions: scope SELECT to creator
DROP POLICY IF EXISTS "Authenticated view templates" ON public.screening_templates;
CREATE POLICY "Creators view own templates"
  ON public.screening_templates FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Authenticated view template questions" ON public.screening_template_questions;
CREATE POLICY "Creators view own template questions"
  ON public.screening_template_questions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.screening_templates t
    WHERE t.id = screening_template_questions.template_id
      AND t.created_by = auth.uid()
  ));

-- 6. screening-resumes storage: require first folder to be an existing screening_jobs.id
DROP POLICY IF EXISTS "Anyone can upload resumes" ON storage.objects;
CREATE POLICY "Public upload resumes scoped to job"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'screening-resumes'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.screening_jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
    )
  );
