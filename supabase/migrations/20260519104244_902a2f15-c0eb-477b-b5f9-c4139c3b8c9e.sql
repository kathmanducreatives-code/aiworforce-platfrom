CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES public.task_plans(id) ON DELETE CASCADE,
  agent_slug text NOT NULL,
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  depends_on uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','running','awaiting_approval','complete','failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_tasks_plan_id    ON public.tasks(plan_id);
CREATE INDEX idx_tasks_status     ON public.tasks(status);
CREATE INDEX idx_tasks_agent_slug ON public.tasks(agent_slug);
CREATE INDEX idx_tasks_user_id    ON public.tasks(user_id);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to tasks"
  ON public.tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();