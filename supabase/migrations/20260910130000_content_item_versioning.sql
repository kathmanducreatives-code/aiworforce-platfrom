-- VERSIONS ARE WRITTEN BY THE DATABASE, NOT BY THE CALLER.
--
-- ── WHY NOT IN THE CLIENT ───────────────────────────────────────────────────
--
-- A save is two facts: the item now says X, and it said X as of version N. Done
-- from the client that is two round trips with no transaction around them, so a
-- failure between them leaves either a change with no history or a history
-- entry for a change that did not land. Computing N client-side is also racy —
-- two saves read `max(version) = 2` and both write 3.
--
-- Doing it in a trigger puts the version row in the SAME TRANSACTION as the
-- change that caused it. It cannot be forgotten by a new caller, it cannot be
-- skipped by a direct SQL fix, and there is no version arithmetic in TypeScript.
--
-- `content_item_version_unique (content_item_id, version)` remains the guard:
-- under genuine concurrency one save wins and the other fails loudly rather
-- than silently overwriting a sibling's history.

-- ── the version number is assigned here, never supplied ─────────────────────

CREATE OR REPLACE FUNCTION public.content_item_next_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A caller-supplied version is ignored on purpose: version order is a
  -- property of the table, not a claim the client gets to make.
  SELECT COALESCE(MAX(v.version), 0) + 1
    INTO NEW.version
    FROM public.content_item_version v
   WHERE v.content_item_id = NEW.content_item_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_item_version_assign ON public.content_item_version;
CREATE TRIGGER content_item_version_assign
  BEFORE INSERT ON public.content_item_version
  FOR EACH ROW EXECUTE FUNCTION public.content_item_next_version();

-- ── every content_item write records what it said ───────────────────────────

CREATE OR REPLACE FUNCTION public.content_item_record_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.content_item_version
    (content_item_id, workspace_id, title, body, created_by)
  VALUES
    (NEW.id, NEW.workspace_id, NEW.title, NEW.body, NEW.created_by);
  RETURN NEW;
END;
$$;

-- Version 1 is the item as created, so a draft has a history from the moment it
-- exists rather than from its first edit.
DROP TRIGGER IF EXISTS content_item_version_on_insert ON public.content_item;
CREATE TRIGGER content_item_version_on_insert
  AFTER INSERT ON public.content_item
  FOR EACH ROW EXECUTE FUNCTION public.content_item_record_version();

-- ONLY WHEN THE TEXT ACTUALLY CHANGED. A status move (draft -> in_review) or a
-- metadata touch is not a new draft of the copy, and recording one would bury
-- the real edits in noise. `IS DISTINCT FROM` so a NULL title is handled.
DROP TRIGGER IF EXISTS content_item_version_on_update ON public.content_item;
CREATE TRIGGER content_item_version_on_update
  AFTER UPDATE ON public.content_item
  FOR EACH ROW
  WHEN (OLD.body IS DISTINCT FROM NEW.body OR OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION public.content_item_record_version();
