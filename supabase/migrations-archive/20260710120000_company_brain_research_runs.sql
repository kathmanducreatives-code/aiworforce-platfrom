-- Company Brain Onboarding v3 — research run audit trail.
--
-- NOT APPLIED. Review before running via the migration tool.
--
-- Why this table: company_brain.profile stores the *result*. This stores how we
-- got there — which provider ran, on which URL, what it returned, and what
-- evidence backed each claim. That lets us show source proof in the review UI,
-- re-run a single research step, and debug a bad Brain without guessing.
--
-- Shared table, workspace-scoped, RLS-gated. No per-user tables.

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

CREATE INDEX IF NOT EXISTS company_brain_research_runs_ws_created_idx
  ON public.company_brain_research_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS company_brain_research_runs_ws_source_idx
  ON public.company_brain_research_runs (workspace_id, source_type);

ALTER TABLE public.company_brain_research_runs ENABLE ROW LEVEL SECURITY;

-- Members of the workspace may READ their own workspace's research runs.
-- Reuses the existing SECURITY DEFINER helper (avoids recursive RLS on members).
DROP POLICY IF EXISTS company_brain_research_runs_member_select ON public.company_brain_research_runs;
CREATE POLICY company_brain_research_runs_member_select
  ON public.company_brain_research_runs FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(auth.uid(), workspace_id));

-- Writes happen ONLY inside edge functions (service_role bypasses RLS).
-- No INSERT/UPDATE/DELETE policy is granted to `authenticated` on purpose:
-- the frontend must never write research runs directly.

COMMIT;
