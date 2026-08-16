-- ============================================================================
-- Dev-only RPC: dev_table_counts()
-- ============================================================================
-- VerificationPanel.tsx queries `select count(*)` on 8 tables in the
-- browser as the authenticated user. Post-Lovable RLS migrations made
-- some of those tables return 0 rows for ordinary users (data exists,
-- but the user's policy hides it). The panel then renders "0 rows" and
-- looks like the DB is empty.
--
-- This RPC runs as SECURITY DEFINER and returns true row counts. It's
-- intended for the dev-only verify panel; it does not expose any actual
-- table data, only counts. Grant is restricted to authenticated users.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dev_table_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'workspaces',         (SELECT count(*) FROM public.workspaces),
    'agents',             (SELECT count(*) FROM public.agents),
    'agent_capabilities', (SELECT count(*) FROM public.agent_capabilities),
    'task_plans',         (SELECT count(*) FROM public.task_plans),
    'tasks',              (SELECT count(*) FROM public.tasks),
    'activity_feed',      (SELECT count(*) FROM public.activity_feed),
    'handoffs',           (SELECT count(*) FROM public.handoffs),
    'approvals',          (SELECT count(*) FROM public.approvals)
  );
$$;

REVOKE ALL ON FUNCTION public.dev_table_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dev_table_counts() TO authenticated, service_role;
