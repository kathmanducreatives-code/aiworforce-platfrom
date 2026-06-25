
-- 1. screening_applications: allow anon to update in-progress applications for active jobs
CREATE POLICY "Candidates update in-progress applications"
ON public.screening_applications
FOR UPDATE
TO anon, authenticated
USING (
  status IS DISTINCT FROM 'completed'
  AND EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = screening_applications.job_id AND j.status = 'active')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = screening_applications.job_id AND j.status = 'active')
);

-- 2. adaptive_screening_sessions: allow anon to update in-progress sessions for active jobs
CREATE POLICY "Candidates update in-progress sessions"
ON public.adaptive_screening_sessions
FOR UPDATE
TO anon, authenticated
USING (
  session_status = 'in_progress'
  AND EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = adaptive_screening_sessions.job_id AND j.status = 'active')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.screening_jobs j WHERE j.id = adaptive_screening_sessions.job_id AND j.status = 'active')
);

-- 3. agent_capabilities: restrict SELECT to workspace-scoped agents only
DROP POLICY IF EXISTS "Members read agent capabilities" ON public.agent_capabilities;
CREATE POLICY "Members read agent capabilities"
ON public.agent_capabilities
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = agent_capabilities.agent_id
      AND a.workspace_id IS NOT NULL
      AND public.has_workspace_access(auth.uid(), a.workspace_id)
  )
);

-- 4. collaboration_room_members: allow members to leave a room
CREATE POLICY "Members can leave a room"
ON public.collaboration_room_members
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
