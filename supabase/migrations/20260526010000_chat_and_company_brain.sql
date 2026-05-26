-- ============================================================================
-- Day 2: conversations + messages + structured company_brain
-- ============================================================================
-- Why this migration:
--   * chat-respond/index.ts reads/writes conversations and messages tables
--     that DO NOT exist in production. Every call to chat-respond currently
--     500s on "create conversation: relation does not exist". This unblocks
--     the dashboard chat surface.
--   * workspaces.company_brain (text) already exists but is a single blob.
--     We need structured fields (what_we_do, who_we_sell_to, voice_and_tone,
--     do_not_say, examples) to inject into agent role_prompts. Adding a
--     proper table supersedes the text column without removing it (keeping
--     the column for backward compat).
--
-- Schemas chosen to match exactly what supabase/functions/chat-respond/
-- index.ts already expects, so no edge-function change is needed.
-- ============================================================================

-- ─── conversations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  agent_slug    text,                                          -- 'scout' / 'aria' / 'penn' / 'hawk' / 'scribe' / null for multi-agent
  channel       text,                                          -- 'dashboard' / 'sidebar' / etc., free-form
  title         text,
  status        text NOT NULL DEFAULT 'active',                -- 'active' | 'archived'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_updated_idx
  ON public.conversations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversations_workspace_idx
  ON public.conversations (workspace_id)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_owner_select
  ON public.conversations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY conversations_owner_insert
  ON public.conversations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY conversations_owner_update
  ON public.conversations FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY conversations_owner_delete
  ON public.conversations FOR DELETE
  USING (user_id = auth.uid());

-- ─── messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  agent_slug      text,
  model_used      text,
  tokens_used     integer,
  is_error        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON public.messages (conversation_id, created_at ASC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Scope messages via the parent conversation's owner.
CREATE POLICY messages_via_conversation_select
  ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
  ));

CREATE POLICY messages_via_conversation_insert
  ON public.messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
  ));

CREATE POLICY messages_via_conversation_delete
  ON public.messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
  ));

-- ─── company_brain ──────────────────────────────────────────────────────────
-- Structured workspace context, injectable into agent prompts.
-- One row per workspace.
CREATE TABLE IF NOT EXISTS public.company_brain (
  workspace_id    uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_name    text,
  what_we_do      text,
  who_we_sell_to  text,
  voice_and_tone  text,
  do_not_say      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of strings/phrases to avoid
  examples        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of {label, sample} pairs
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.company_brain ENABLE ROW LEVEL SECURITY;

-- Scope: caller must be a member of the workspace.
-- The existing `users` table (workspace_id) plus organization_members give
-- two membership concepts. We use `users.workspace_id` here because that's
-- what the existing orchestrate/run-agent code paths use today.
CREATE POLICY company_brain_member_select
  ON public.company_brain FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.workspace_id = company_brain.workspace_id
  ));

CREATE POLICY company_brain_member_upsert
  ON public.company_brain FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.workspace_id = company_brain.workspace_id
  ));

CREATE POLICY company_brain_member_update
  ON public.company_brain FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.workspace_id = company_brain.workspace_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.workspace_id = company_brain.workspace_id
  ));

-- ─── Seed: one empty company_brain row per existing workspace ──────────────
INSERT INTO public.company_brain (workspace_id)
SELECT w.id FROM public.workspaces w
WHERE NOT EXISTS (SELECT 1 FROM public.company_brain cb WHERE cb.workspace_id = w.id)
ON CONFLICT (workspace_id) DO NOTHING;

-- ─── updated_at trigger for company_brain ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_brain_set_updated_at ON public.company_brain;
CREATE TRIGGER company_brain_set_updated_at
  BEFORE UPDATE ON public.company_brain
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
