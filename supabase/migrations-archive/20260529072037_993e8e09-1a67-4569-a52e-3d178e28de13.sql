CREATE TABLE public.tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  plan_id uuid,
  task_id uuid,
  agent_id uuid,
  tool_name text NOT NULL,
  provider text NOT NULL,
  input_json jsonb,
  output_json jsonb,
  status text NOT NULL DEFAULT 'queued',
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_calls TO authenticated;
GRANT ALL ON public.tool_calls TO service_role;

ALTER TABLE public.tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tool_calls"
  ON public.tool_calls FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Members insert tool_calls"
  ON public.tool_calls FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "Members update tool_calls"
  ON public.tool_calls FOR UPDATE TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

CREATE INDEX idx_tool_calls_workspace ON public.tool_calls(workspace_id);
CREATE INDEX idx_tool_calls_task ON public.tool_calls(task_id);
CREATE INDEX idx_tool_calls_agent ON public.tool_calls(agent_id);
CREATE INDEX idx_tool_calls_status ON public.tool_calls(status);
CREATE INDEX idx_tool_calls_created_at ON public.tool_calls(created_at DESC);