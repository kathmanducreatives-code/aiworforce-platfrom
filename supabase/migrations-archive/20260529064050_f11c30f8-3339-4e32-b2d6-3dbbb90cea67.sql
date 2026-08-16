
-- agent_capabilities
CREATE TABLE IF NOT EXISTS public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  capability text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, capability)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_capabilities TO authenticated;
GRANT ALL ON public.agent_capabilities TO service_role;

ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read agent capabilities"
  ON public.agent_capabilities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authed manage agent capabilities"
  ON public.agent_capabilities FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent_id
  ON public.agent_capabilities(agent_id);

-- handoffs
CREATE TABLE IF NOT EXISTS public.handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  plan_id uuid,
  task_id uuid,
  from_agent_slug text,
  to_agent_slug text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoffs TO authenticated;
GRANT ALL ON public.handoffs TO service_role;

ALTER TABLE public.handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view workspace handoffs"
  ON public.handoffs FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Authed insert handoffs"
  ON public.handoffs FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NULL OR public.has_workspace_access(auth.uid(), workspace_id));

CREATE INDEX IF NOT EXISTS idx_handoffs_workspace_id
  ON public.handoffs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_plan_id
  ON public.handoffs(plan_id);
