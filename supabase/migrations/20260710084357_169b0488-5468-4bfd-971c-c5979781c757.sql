BEGIN;

CREATE TABLE IF NOT EXISTS public.company_brain_research_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type   text NOT NULL CHECK (source_type IN ('founder_linkedin','company_website','company_linkedin','ai_draft')),
  provider      text NOT NULL CHECK (provider    IN ('apify','firecrawl','claude','manual')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  source_url    text,
  input         jsonb NOT NULL DEFAULT '{}'::jsonb,
  output        jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_brain_research_runs TO authenticated;
GRANT ALL    ON public.company_brain_research_runs TO service_role;

CREATE INDEX IF NOT EXISTS company_brain_research_runs_ws_created_idx
  ON public.company_brain_research_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS company_brain_research_runs_ws_source_idx
  ON public.company_brain_research_runs (workspace_id, source_type);

ALTER TABLE public.company_brain_research_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_brain_research_runs_member_select ON public.company_brain_research_runs;
CREATE POLICY company_brain_research_runs_member_select
  ON public.company_brain_research_runs FOR SELECT
  TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));

COMMIT;