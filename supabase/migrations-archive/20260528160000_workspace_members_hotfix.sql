-- ============================================================================
-- Hotfix: create workspace_members and link existing founder accounts
-- ============================================================================
-- Day-5 browser smoke test surfaced "No workspace selected" in the chat
-- composer. Root cause: the frontend's getCurrentWorkspaceId() (in
-- src/lib/orchestration.ts) reads `workspace_members.workspace_id where
-- user_id = auth.uid()`, but the workspace_members table did not exist
-- in production despite Lovable's repo migration 20260527113004 defining
-- it. That migration was never applied — likely because applying it
-- whole would have crashed on RLS policies referencing
-- `workspaces.owner_user_id`, a column that doesn't exist on the live
-- (pre-existing) workspaces table.
--
-- This hotfix is deliberately surgical: only create workspace_members
-- and link existing founder + smoke-test accounts to the single
-- workspace that already exists ("My Company", 00000000-...-0001). It
-- skips the broader workspace-rewrite in 20260527113004:
--   - workspaces / approvals / activity_feed CREATE TABLEs (no-ops
--     against existing tables; the new policies would crash on missing
--     columns).
--   - has_workspace_access() security-definer function (nothing on the
--     chat critical path needs it yet).
--   - provision_workspace_for_user() RPC + on_auth_user_created_workspace
--     trigger (the real "auto-provision a workspace per new user" fix is
--     logged as a known follow-up — see WEEK_1_LOG.md).
--
-- After this hotfix, signing in as any of the three linked accounts
-- resolves a workspace_id and chat composes work end-to-end via the
-- already-deployed pilot-chat.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  role         text NOT NULL DEFAULT 'owner',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx
  ON public.workspace_members (user_id);

GRANT SELECT, INSERT, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_self_select" ON public.workspace_members;
CREATE POLICY "members_self_select"
  ON public.workspace_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "members_self_insert" ON public.workspace_members;
CREATE POLICY "members_self_insert"
  ON public.workspace_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Seed: existing founder accounts (kathmanducreatives@gmail.com,
-- prasidhpro@gmail.com) plus the Day-4 smoke-test account
-- (test@example.com), all linked to the existing workspace.
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '3fc29d49-2384-415f-8389-db49e5505235', 'owner'),
  ('00000000-0000-0000-0000-000000000001', '36346c93-8877-4f96-bb30-36e37ae0cf60', 'owner'),
  ('00000000-0000-0000-0000-000000000001', 'b1e500cb-b6a4-4df8-927a-ee48f33dda6a', 'owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
