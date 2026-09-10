-- CONTENT GETS AN OBJECT.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
--
-- Content is a headline navigation item — 834 lines and twelve components —
-- that has never produced a durable artifact. Every action in it calls
-- `sendAgentCommand(<English sentence>)`. There is not one `functions.invoke`
-- and not one `.insert()` in the entire section, so:
--
--     saved_outputs        273 rows, 273 of them `workflow_summary`
--     content_draft        0, and no writer has ever run
--     outreach_drafts      0
--     linkedin_posts       0
--     marketing_videos     0
--     scribe tasks         0 — the content agent has never executed
--
-- A user can spend twenty minutes in Content and have nothing to return to.
-- The drafts list, the approval queue and every counter read from tables that
-- are empty and have no writer, so the page renders a confident "0" that means
-- "this cannot work", not "no work yet".
--
-- ── WHY A TABLE AND NOT ANOTHER `saved_outputs` TYPE ────────────────────────
--
-- `saved_outputs` is an append-only record of things a run produced: it has no
-- status, no updated_at, and no version child. Content needs all three, because
-- a draft is EDITED — the whole point is that it can be reopened, changed and
-- kept. Bolting a lifecycle onto an append-only log would mean either mutating
-- rows that other features read as immutable history, or inventing a status
-- convention inside `raw` that nothing can constrain.
--
-- `saved_outputs` keeps its job. This table owns the editable object.
--
-- ── THE VOCABULARY IS THE ONE THE UI ALREADY USES ───────────────────────────
--
-- `format` mirrors `ContentSubtype` in src/lib/contentDraftModel.ts
-- (founder_post | post_ideas | comment_draft | content) so the existing
-- bucketing and labels apply unchanged. Inventing a second vocabulary here is
-- exactly how `credits.ts` came to compare a frontend field against a backend
-- name, a comparison that could never be true.

-- ── content_item ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.content_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Who made it. NULL for rows an agent writes with the service role, which is
  -- why this is nullable and `agent_slug` exists beside it.
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- LIFECYCLE, constrained. The approval queue needs a state it can filter on,
  -- and a free-text status would drift the moment a second writer appears.
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),

  -- Mirrors ContentSubtype in src/lib/contentDraftModel.ts.
  format           text NOT NULL DEFAULT 'content'
                     CHECK (format IN ('founder_post', 'post_ideas', 'comment_draft', 'content')),

  title            text,
  -- NOT NULL with a default: an empty draft is a real state (a user opened a
  -- composer and has not typed yet) and it must still be a row, or "save" has
  -- nothing to save and the refresh-loses-everything bug returns.
  body             text NOT NULL DEFAULT '',

  -- PROVENANCE. `source` is how it was created ('manual', 'signal',
  -- 'content_engagement_loop'); `source_signal_id` is the signal it came from,
  -- when it came from one. ON DELETE SET NULL, never CASCADE: a draft outlives
  -- the signal that prompted it — deleting the signal must not delete the work.
  source           text,
  source_signal_id uuid REFERENCES public.signal_events(id) ON DELETE SET NULL,

  -- The agent that authored it. `scribe` owns content generation; the column
  -- exists now so the generation slice has somewhere to record itself without
  -- a second migration.
  agent_slug       text,

  -- Display metadata the UI already reads: topic / audience / angle /
  -- competitor_related / engagement_queries.
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The list view is always "this workspace, newest first".
CREATE INDEX IF NOT EXISTS content_item_workspace_created_idx
  ON public.content_item (workspace_id, created_at DESC);

-- The drafts/approval views filter by status within a workspace.
CREATE INDEX IF NOT EXISTS content_item_workspace_status_idx
  ON public.content_item (workspace_id, status);

DROP TRIGGER IF EXISTS content_item_set_updated_at ON public.content_item;
CREATE TRIGGER content_item_set_updated_at
  BEFORE UPDATE ON public.content_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── content_item_version ────────────────────────────────────────────────────
--
-- An edit history, written on change. Carries `workspace_id` of its own rather
-- than joining to the parent for RLS: a policy that has to traverse a foreign
-- key to decide access is one subquery away from being wrong, and this table is
-- read on every draft open.

CREATE TABLE IF NOT EXISTS public.content_item_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_item(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Monotonic per item, starting at 1. UNIQUE so a concurrent double-save
  -- cannot silently produce two "version 3"s.
  version         integer NOT NULL,

  title           text,
  body            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT content_item_version_unique UNIQUE (content_item_id, version),
  CONSTRAINT content_item_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS content_item_version_item_idx
  ON public.content_item_version (content_item_id, version DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- `has_workspace_access(auth.uid(), workspace_id)` is the house predicate, and
-- it is SECURITY DEFINER so it is not itself subject to RLS recursion.
--
-- UPDATE CARRIES A WITH CHECK, which the older tables do not. `saved_outputs`
-- has USING only, so a member of workspace A can UPDATE a row and set
-- `workspace_id` to workspace B — the read is checked, the write is not. Adding
-- the check here costs nothing and closes that on the new tables.

ALTER TABLE public.content_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_item_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_item members read"   ON public.content_item;
DROP POLICY IF EXISTS "content_item members insert" ON public.content_item;
DROP POLICY IF EXISTS "content_item members update" ON public.content_item;
DROP POLICY IF EXISTS "content_item members delete" ON public.content_item;

CREATE POLICY "content_item members read" ON public.content_item
  FOR SELECT USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "content_item members insert" ON public.content_item
  FOR INSERT WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "content_item members update" ON public.content_item
  FOR UPDATE USING (public.has_workspace_access(auth.uid(), workspace_id))
          WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "content_item members delete" ON public.content_item
  FOR DELETE USING (public.has_workspace_access(auth.uid(), workspace_id));

DROP POLICY IF EXISTS "content_item_version members read"   ON public.content_item_version;
DROP POLICY IF EXISTS "content_item_version members insert" ON public.content_item_version;

CREATE POLICY "content_item_version members read" ON public.content_item_version
  FOR SELECT USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE POLICY "content_item_version members insert" ON public.content_item_version
  FOR INSERT WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));

-- NO UPDATE OR DELETE POLICY ON VERSIONS, deliberately. A version is a record
-- of what the draft said at a point in time; an editable history is not a
-- history. Clients get deny-by-default on both, and cascade from the parent is
-- what removes them.
