
-- =========================================================
-- Phase 2: Persistent Signal Memory — additive memory tables
-- =========================================================

-- helper: updated_at trigger function already exists (public.update_updated_at_column)
-- helper: public.has_workspace_access(_user_id, _workspace_id) already exists

-- ---------- signals ----------
CREATE TABLE public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  plan_id uuid,
  task_id uuid,
  tool_call_id uuid,
  source text,
  signal_type text,
  signal_label text,
  title text,
  description text,
  source_url text,
  confidence numeric,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signals members read"   ON public.signals FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signals members insert" ON public.signals FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signals members update" ON public.signals FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signals members delete" ON public.signals FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX signals_workspace_created_idx ON public.signals (workspace_id, created_at DESC);
CREATE INDEX signals_conversation_idx ON public.signals (conversation_id);
CREATE INDEX signals_plan_idx ON public.signals (plan_id);
CREATE INDEX signals_tool_call_idx ON public.signals (tool_call_id);

-- ---------- accounts ----------
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  website_url text,
  linkedin_url text,
  location text,
  industry text,
  stage text,
  employee_count text,
  description text,
  source text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accounts members read"   ON public.accounts FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "accounts members insert" ON public.accounts FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "accounts members update" ON public.accounts FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "accounts members delete" ON public.accounts FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX accounts_workspace_created_idx ON public.accounts (workspace_id, created_at DESC);
CREATE UNIQUE INDEX accounts_workspace_domain_uniq ON public.accounts (workspace_id, lower(domain)) WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX accounts_workspace_name_uniq   ON public.accounts (workspace_id, lower(name))   WHERE domain IS NULL;
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- contacts ----------
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  full_name text,
  title text,
  headline text,
  company text,
  location text,
  linkedin_url text,
  email text,
  phone text,
  source text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts members read"   ON public.contacts FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "contacts members insert" ON public.contacts FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "contacts members update" ON public.contacts FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "contacts members delete" ON public.contacts FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX contacts_workspace_created_idx ON public.contacts (workspace_id, created_at DESC);
CREATE INDEX contacts_account_idx ON public.contacts (account_id);
CREATE UNIQUE INDEX contacts_workspace_linkedin_uniq ON public.contacts (workspace_id, lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- lead_candidates ----------
CREATE TABLE public.lead_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  plan_id uuid,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  signal_id  uuid REFERENCES public.signals(id)  ON DELETE SET NULL,
  lead_type text,
  status text NOT NULL DEFAULT 'new',
  fit_score numeric,
  priority text,
  reason text,
  next_action text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_candidates TO authenticated;
GRANT ALL ON public.lead_candidates TO service_role;
ALTER TABLE public.lead_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lc members read"   ON public.lead_candidates FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lc members insert" ON public.lead_candidates FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lc members update" ON public.lead_candidates FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lc members delete" ON public.lead_candidates FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX lc_workspace_created_idx ON public.lead_candidates (workspace_id, created_at DESC);
CREATE INDEX lc_conversation_idx ON public.lead_candidates (conversation_id);
CREATE INDEX lc_plan_idx ON public.lead_candidates (plan_id);
CREATE UNIQUE INDEX lc_dedupe_uniq ON public.lead_candidates (
  workspace_id,
  coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(signal_id,  '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE TRIGGER lc_set_updated_at BEFORE UPDATE ON public.lead_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- lead_enrichments ----------
CREATE TABLE public.lead_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  source_url text,
  summary text,
  pain_hypothesis text,
  trigger text,
  outreach_angle text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_enrichments TO authenticated;
GRANT ALL ON public.lead_enrichments TO service_role;
ALTER TABLE public.lead_enrichments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "le members read"   ON public.lead_enrichments FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "le members insert" ON public.lead_enrichments FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "le members update" ON public.lead_enrichments FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "le members delete" ON public.lead_enrichments FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX le_workspace_created_idx ON public.lead_enrichments (workspace_id, created_at DESC);
CREATE INDEX le_lead_idx ON public.lead_enrichments (lead_candidate_id);

-- ---------- outreach_drafts ----------
CREATE TABLE public.outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  approval_id uuid,
  channel text,
  subject text,
  body text NOT NULL,
  personalization_notes text,
  status text NOT NULL DEFAULT 'draft',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_drafts TO authenticated;
GRANT ALL ON public.outreach_drafts TO service_role;
ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "od members read"   ON public.outreach_drafts FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "od members insert" ON public.outreach_drafts FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "od members update" ON public.outreach_drafts FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "od members delete" ON public.outreach_drafts FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX od_workspace_created_idx ON public.outreach_drafts (workspace_id, created_at DESC);
CREATE INDEX od_lead_idx ON public.outreach_drafts (lead_candidate_id);
CREATE TRIGGER od_set_updated_at BEFORE UPDATE ON public.outreach_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- saved_outputs ----------
CREATE TABLE public.saved_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  plan_id uuid,
  task_id uuid,
  type text,
  title text,
  body text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_outputs TO authenticated;
GRANT ALL ON public.saved_outputs TO service_role;
ALTER TABLE public.saved_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so members read"   ON public.saved_outputs FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "so members insert" ON public.saved_outputs FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "so members update" ON public.saved_outputs FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "so members delete" ON public.saved_outputs FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE INDEX so_workspace_created_idx ON public.saved_outputs (workspace_id, created_at DESC);
CREATE INDEX so_conversation_idx ON public.saved_outputs (conversation_id);
CREATE INDEX so_plan_idx ON public.saved_outputs (plan_id);
