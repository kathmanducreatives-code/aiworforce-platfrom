
-- ============================================================
-- 1. WORKSPACES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. WORKSPACE MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON public.workspace_members(user_id);

GRANT SELECT, INSERT, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Security-definer access helper (no recursive RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_workspace_access(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE user_id = _user_id AND workspace_id = _workspace_id
  );
$$;

-- ============================================================
-- 4. RLS policies — workspaces & workspace_members
-- ============================================================
DROP POLICY IF EXISTS "Members view workspace" ON public.workspaces;
CREATE POLICY "Members view workspace" ON public.workspaces FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), id));

DROP POLICY IF EXISTS "Owner can create workspace" ON public.workspaces;
CREATE POLICY "Owner can create workspace" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Owner updates workspace" ON public.workspaces;
CREATE POLICY "Owner updates workspace" ON public.workspaces FOR UPDATE TO authenticated
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Members view own memberships" ON public.workspace_members;
CREATE POLICY "Members view own memberships" ON public.workspace_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_workspace_access(auth.uid(), workspace_id));

DROP POLICY IF EXISTS "Self insert membership" ON public.workspace_members;
CREATE POLICY "Self insert membership" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Self delete membership" ON public.workspace_members;
CREATE POLICY "Self delete membership" ON public.workspace_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- 5. COMPANY BRAIN  (1 row per workspace)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_brain (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_brain TO authenticated;
GRANT ALL ON public.company_brain TO service_role;
ALTER TABLE public.company_brain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage company brain" ON public.company_brain;
CREATE POLICY "Members manage company brain" ON public.company_brain FOR ALL TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

-- ============================================================
-- 6. APPROVALS  (matches DBApproval in src/lib/orchestration.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid,
  agent_id uuid,
  task_id uuid,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_workspace_idx ON public.approvals(workspace_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage approvals" ON public.approvals;
CREATE POLICY "Members manage approvals" ON public.approvals FOR ALL TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id))
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

-- ============================================================
-- 7. ACTIVITY FEED  (matches DBActivity in src/lib/orchestration.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid,
  agent_id uuid,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_feed_workspace_idx ON public.activity_feed(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_feed_plan_idx ON public.activity_feed(plan_id, created_at);

GRANT SELECT, INSERT ON public.activity_feed TO authenticated;
GRANT ALL ON public.activity_feed TO service_role;
ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view activity" ON public.activity_feed;
CREATE POLICY "Members view activity" ON public.activity_feed FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));

DROP POLICY IF EXISTS "Members insert activity" ON public.activity_feed;
CREATE POLICY "Members insert activity" ON public.activity_feed FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

-- ============================================================
-- 8. ALTER existing task_plans / tasks / agents to match orchestration runtime
-- ============================================================
ALTER TABLE public.task_plans
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_instruction text,
  ADD COLUMN IF NOT EXISTS plan_summary text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS task_plans_workspace_idx ON public.task_plans(workspace_id, created_at DESC);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id uuid,
  ADD COLUMN IF NOT EXISTS step_index integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS input jsonb,
  ADD COLUMN IF NOT EXISTS output jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS current_task text,
  ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS avatar_color text,
  ADD COLUMN IF NOT EXISTS role_prompt text,
  ADD COLUMN IF NOT EXISTS tools jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'on_demand',
  ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS agents_workspace_slug_idx
  ON public.agents(workspace_id, slug) WHERE slug IS NOT NULL;

-- ============================================================
-- 9. PROVISION RPC — matches getCurrentWorkspaceId() fallback
-- ============================================================
CREATE OR REPLACE FUNCTION public.provision_workspace_for_user(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
  new_id uuid;
  display_name text;
BEGIN
  SELECT workspace_id INTO existing_id
  FROM public.workspace_members
  WHERE user_id = _user_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  SELECT COALESCE(NULLIF(p.full_name, ''), 'My Workspace')
    INTO display_name
  FROM public.profiles p
  WHERE p.user_id = _user_id
  LIMIT 1;

  IF display_name IS NULL THEN
    display_name := 'My Workspace';
  END IF;

  INSERT INTO public.workspaces (name, owner_user_id)
  VALUES (display_name || $q$'s Workspace$q$, _user_id)
  RETURNING id INTO new_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_id, _user_id, 'owner');

  INSERT INTO public.company_brain (workspace_id, profile)
  VALUES (new_id, '{}'::jsonb)
  ON CONFLICT (workspace_id) DO NOTHING;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_workspace_for_user(uuid) TO authenticated, service_role;

-- ============================================================
-- 10. Auto-provision on new auth user
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.provision_workspace_for_user(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_workspace ON auth.users;
CREATE TRIGGER on_auth_user_created_workspace
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_workspace();

-- ============================================================
-- 11. Backfill existing users
-- ============================================================
DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.profiles WHERE user_id IS NOT NULL LOOP
    PERFORM public.provision_workspace_for_user(u.user_id);
  END LOOP;
END $$;
