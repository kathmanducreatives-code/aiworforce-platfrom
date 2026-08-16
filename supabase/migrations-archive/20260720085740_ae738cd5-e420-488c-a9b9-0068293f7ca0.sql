
ALTER TABLE public.candidate_notes ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE public.candidate_notes cn
SET workspace_id = wm.workspace_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, workspace_id
  FROM public.workspace_members
  ORDER BY user_id, created_at ASC
) wm
WHERE cn.workspace_id IS NULL
  AND cn.created_by IS NOT NULL
  AND wm.user_id = cn.created_by;

DELETE FROM public.candidate_notes WHERE workspace_id IS NULL;

ALTER TABLE public.candidate_notes ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.candidate_notes DROP CONSTRAINT IF EXISTS candidate_notes_workspace_id_fkey;
ALTER TABLE public.candidate_notes
  ADD CONSTRAINT candidate_notes_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_candidate_notes_workspace_id ON public.candidate_notes(workspace_id);

DROP POLICY IF EXISTS "Workspace members view candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Authors view own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Authed view candidate notes" ON public.candidate_notes;

CREATE POLICY "Workspace members view candidate notes"
ON public.candidate_notes FOR SELECT TO authenticated
USING (public.has_workspace_access(auth.uid(), workspace_id));

DROP POLICY IF EXISTS "Authed insert candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Authenticated users can create notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can create notes" ON public.candidate_notes;

CREATE POLICY "Workspace members insert candidate notes"
ON public.candidate_notes FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND public.has_workspace_access(auth.uid(), workspace_id)
);

DROP POLICY IF EXISTS "Authors update own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Authors delete own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON public.candidate_notes;

CREATE POLICY "Authors update own notes"
ON public.candidate_notes FOR UPDATE TO authenticated
USING (auth.uid() = created_by AND public.has_workspace_access(auth.uid(), workspace_id))
WITH CHECK (auth.uid() = created_by AND public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Authors delete own notes"
ON public.candidate_notes FOR DELETE TO authenticated
USING (auth.uid() = created_by AND public.has_workspace_access(auth.uid(), workspace_id));
