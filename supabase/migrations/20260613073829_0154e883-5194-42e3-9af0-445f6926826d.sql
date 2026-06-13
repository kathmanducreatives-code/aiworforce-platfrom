CREATE TABLE IF NOT EXISTS public.signal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.signals(id) ON DELETE CASCADE,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'new',
  note text,
  reviewed_at timestamptz,
  ignored_at timestamptz,
  saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_reviews_target_present CHECK (signal_id IS NOT NULL OR lead_candidate_id IS NOT NULL),
  CONSTRAINT signal_reviews_status_valid CHECK (status IN ('new','reviewed','ignored','saved','actioned'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_reviews TO authenticated;
GRANT ALL ON public.signal_reviews TO service_role;

ALTER TABLE public.signal_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_reviews members read"   ON public.signal_reviews;
DROP POLICY IF EXISTS "signal_reviews members insert" ON public.signal_reviews;
DROP POLICY IF EXISTS "signal_reviews members update" ON public.signal_reviews;
DROP POLICY IF EXISTS "signal_reviews members delete" ON public.signal_reviews;

CREATE POLICY "signal_reviews members read"   ON public.signal_reviews FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_reviews members insert" ON public.signal_reviews FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id) AND user_id = auth.uid());
CREATE POLICY "signal_reviews members update" ON public.signal_reviews FOR UPDATE TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id) AND user_id = auth.uid())
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id) AND user_id = auth.uid());
CREATE POLICY "signal_reviews members delete" ON public.signal_reviews FOR DELETE TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id) AND user_id = auth.uid());

CREATE UNIQUE INDEX IF NOT EXISTS signal_reviews_user_signal_uniq
  ON public.signal_reviews (workspace_id, user_id, signal_id)
  WHERE signal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS signal_reviews_user_lead_uniq
  ON public.signal_reviews (workspace_id, user_id, lead_candidate_id)
  WHERE lead_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_reviews_workspace_user_idx ON public.signal_reviews (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS signal_reviews_signal_idx ON public.signal_reviews (signal_id);
CREATE INDEX IF NOT EXISTS signal_reviews_lead_idx ON public.signal_reviews (lead_candidate_id);
CREATE INDEX IF NOT EXISTS signal_reviews_status_idx ON public.signal_reviews (workspace_id, status);

DROP TRIGGER IF EXISTS signal_reviews_set_updated_at ON public.signal_reviews;
CREATE TRIGGER signal_reviews_set_updated_at
  BEFORE UPDATE ON public.signal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();