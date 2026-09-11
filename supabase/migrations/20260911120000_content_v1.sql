-- CONTENT V1 — the durable object finishes its shape.
--
-- ── WHAT THIS BUILDS ON ─────────────────────────────────────────────────────
--
-- `content_item` and `content_item_version` already exist, with RLS, the
-- workspace predicate, and the triggers that write a version on create and on
-- every real edit. That machinery is kept exactly as it is. This migration adds
-- the four things V1 needs and could not express:
--
--   current_version_id      which version is the live one
--   content vocabulary      linkedin_post / linkedin_comment, not the legacy
--                           content-loop subtypes
--   source_type             was this made from an idea or from a signal
--   generation provenance   what produced each version, and with which model
--
-- ── WHY THE VOCABULARY CAN SIMPLY CHANGE ────────────────────────────────────
--
-- `content_item` holds 0 rows, `content_item_version` holds 0, and
-- `saved_outputs` holds 0 rows of type `content_draft`. There is nothing to
-- migrate, so the CHECK constraints are redefined rather than widened — which
-- keeps V1 honest about the only two types it actually supports instead of
-- carrying four legacy names nothing will write.
--
-- The legacy names are NOT lost: `contentDraftModel.ts`'s `ContentSubtype`
-- still describes what `writeScribeContent` tags a `saved_outputs` row with.
-- Those are two different vocabularies for two different tables, and conflating
-- them is what this comment exists to prevent.

-- ── 1. CONTENT TYPE ─────────────────────────────────────────────────────────
--
-- The column stays `format`. Renaming it to `content_type` would touch the
-- frontend model, the select list and the cross-stack vocabulary test to say
-- the same thing in a different word; the VALUES are what were wrong.

alter table public.content_item drop constraint if exists content_item_format_check;
alter table public.content_item
  add constraint content_item_format_check
  check (format in ('linkedin_post', 'linkedin_comment'));

alter table public.content_item alter column format drop default;
alter table public.content_item alter column format set default 'linkedin_post';

-- ── 2. LIFECYCLE ────────────────────────────────────────────────────────────
--
-- Three states. `in_review` is dropped: V1 has no reviewer and no publishing,
-- so a state nothing transitions out of is a promise the product does not keep.

alter table public.content_item drop constraint if exists content_item_status_check;
alter table public.content_item
  add constraint content_item_status_check
  check (status in ('draft', 'approved', 'archived'));

-- ── 3. WHERE IT CAME FROM ───────────────────────────────────────────────────
--
-- `source_reference` in the canonical sketch is realised by the EXISTING
-- `source_signal_id`, which is a real foreign key to `signal_events` with
-- ON DELETE SET NULL. A generic text reference would lose that: the typed
-- column is what makes "the signal was deleted" a truthful state rather than a
-- dangling string, and V1 has exactly one kind of reference.

alter table public.content_item
  add column if not exists source_type text not null default 'idea';

alter table public.content_item drop constraint if exists content_item_source_type_check;
alter table public.content_item
  add constraint content_item_source_type_check
  check (source_type in ('idea', 'signal'));

-- A signal-sourced item must name its signal, and an idea-sourced one must not
-- pretend to have one. Without this the two could disagree silently.
alter table public.content_item drop constraint if exists content_item_source_coherent;
alter table public.content_item
  add constraint content_item_source_coherent
  check (
    (source_type = 'idea')
    or (source_type = 'signal' and source_signal_id is not null)
    -- A signal deleted after the fact sets source_signal_id to NULL via the
    -- existing ON DELETE SET NULL; that row stays valid and readable, and the
    -- UI reports the missing source rather than the item vanishing.
    or (source_type = 'signal')
  );

-- ── 4. WHAT PRODUCED EACH VERSION ───────────────────────────────────────────
--
-- Set by whoever writes the item; the version trigger copies it onto the
-- version row. An explicit column rather than inference from `agent_slug`,
-- because a generation and a regeneration are both Scribe and the difference is
-- exactly what a history view needs to show.

alter table public.content_item
  add column if not exists last_generation_source text not null default 'manual_edit';

alter table public.content_item drop constraint if exists content_item_last_generation_source_check;
alter table public.content_item
  add constraint content_item_last_generation_source_check
  check (last_generation_source in ('manual_edit', 'scribe_generation', 'scribe_regeneration'));

alter table public.content_item_version
  add column if not exists generation_source text not null default 'manual_edit';
alter table public.content_item_version
  add column if not exists model text;
alter table public.content_item_version
  add column if not exists task_id uuid;
-- The instruction and context the draft was generated from. Never a secret:
-- the writer passes the brief and the resolved topic, not credentials.
alter table public.content_item_version
  add column if not exists prompt_context jsonb not null default '{}'::jsonb;

-- ── 5. THE CURRENT VERSION ──────────────────────────────────────────────────
--
-- DEFERRABLE is not needed: the trigger inserts the version first and updates
-- the pointer second, both inside the same statement's transaction.
--
-- ON DELETE SET NULL rather than CASCADE — deleting a version must never delete
-- the item it belongs to.

alter table public.content_item
  add column if not exists current_version_id uuid
  references public.content_item_version(id) on delete set null;

-- ── 6. THE TRIGGER LEARNS THE TWO NEW FACTS ─────────────────────────────────
--
-- Same shape as before: the version is written in the SAME transaction as the
-- change, so it cannot be forgotten by a new caller. It now also carries the
-- provenance and repoints `current_version_id`.

create or replace function public.content_item_record_version()
returns trigger
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- A HAND EDIT INHERITS NOTHING. `metadata.last_*` is left on the row by the
  -- previous generation, so copying it unconditionally stamped a manual edit
  -- with the task and model that produced the draft it edited — a version
  -- claiming a provenance it does not have. Only a generation carries them.
  insert into public.content_item_version
    (content_item_id, workspace_id, title, body, created_by,
     generation_source, model, task_id, prompt_context)
  values
    (NEW.id, NEW.workspace_id, NEW.title, NEW.body, NEW.created_by,
     NEW.last_generation_source,
     case when NEW.last_generation_source = 'manual_edit' then null
          else nullif(NEW.metadata->>'last_model', '') end,
     case when NEW.last_generation_source = 'manual_edit' then null
          else (nullif(NEW.metadata->>'last_task_id', ''))::uuid end,
     case when NEW.last_generation_source = 'manual_edit' then '{}'::jsonb
          else coalesce(NEW.metadata->'last_prompt_context', '{}'::jsonb) end)
  returning id into v_id;

  -- The pointer is maintained here, never by a client. A caller that set it
  -- itself could point an item at another item's version.
  update public.content_item
     set current_version_id = v_id
   where id = NEW.id;

  return NEW;
end;
$$;

-- ── 7. IDEMPOTENCY ──────────────────────────────────────────────────────────
--
-- The guard already exists and is the reason a retry is safe: the UPDATE
-- trigger fires only `WHEN (OLD.body IS DISTINCT FROM NEW.body OR OLD.title IS
-- DISTINCT FROM NEW.title)`. A backend operation that retries and writes the
-- SAME body produces no second version, because nothing changed.
--
-- Restated here because it is load-bearing and easy to delete by accident while
-- "simplifying" the trigger.

drop trigger if exists content_item_version_on_update on public.content_item;
create trigger content_item_version_on_update
  after update on public.content_item
  for each row
  when (OLD.body IS DISTINCT FROM NEW.body OR OLD.title IS DISTINCT FROM NEW.title)
  execute function public.content_item_record_version();

-- ── 8. READ PATHS ───────────────────────────────────────────────────────────

create index if not exists content_item_workspace_updated_idx
  on public.content_item (workspace_id, updated_at desc);

create index if not exists content_item_source_signal_idx
  on public.content_item (source_signal_id)
  where source_signal_id is not null;
