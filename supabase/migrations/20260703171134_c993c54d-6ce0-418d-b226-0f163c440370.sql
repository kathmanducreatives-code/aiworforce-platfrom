
-- Fix 1: candidate_notes cross-user read for workspace collaborators
DROP POLICY IF EXISTS "Authors view own notes" ON public.candidate_notes;
CREATE POLICY "Workspace members view candidate notes"
ON public.candidate_notes
FOR SELECT
TO authenticated
USING (
  auth.uid() = created_by
  OR EXISTS (
    SELECT 1
    FROM public.workspace_members wm1
    JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = auth.uid()
      AND wm2.user_id = public.candidate_notes.created_by
  )
);

-- Fix 2: prevent authenticated clients from reading screening_applications.access_token
REVOKE SELECT ON public.screening_applications FROM authenticated;
GRANT SELECT (
  id, job_id, status, resume_url, extracted_data, candidate_edits,
  screening_answers, tab_switches, total_time_seconds, match_score,
  match_category, strengths, red_flags, interview_questions,
  recruiter_status, recruiter_notes, is_archived, created_at, completed_at
) ON public.screening_applications TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.screening_applications TO authenticated;
-- Preserve anon INSERT permission for public application submissions
GRANT INSERT ON public.screening_applications TO anon;
