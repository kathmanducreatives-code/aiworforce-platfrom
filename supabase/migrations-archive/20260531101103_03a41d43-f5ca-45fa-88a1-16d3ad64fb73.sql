
ALTER TABLE public.company_brain
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_type text NOT NULL,
  url text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'pending',
  extracted_summary text,
  last_checked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_sources TO authenticated;
GRANT ALL ON public.workspace_sources TO service_role;

ALTER TABLE public.workspace_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage workspace sources" ON public.workspace_sources;
CREATE POLICY "Members manage workspace sources"
  ON public.workspace_sources FOR ALL TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

CREATE INDEX IF NOT EXISTS idx_workspace_sources_workspace ON public.workspace_sources(workspace_id);
