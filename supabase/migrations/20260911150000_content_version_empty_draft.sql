-- AN EMPTY DRAFT IS NOT A VERSION.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `content_item_version_on_insert` fires unconditionally, and `content_item`
-- defaults `body` to '' and `last_generation_source` to 'manual_edit'. The
-- Content service deliberately writes the row BEFORE calling the model, so a
-- failed generation leaves the user a draft to retry rather than a toast. The
-- consequence was that every single item opened its history with:
--
--   v1  manual_edit  (0 chars)
--   v2  scribe_generation  claude-haiku-4-5-20251001  (1329 chars)
--
-- Measured on the production canary. The empty row is not a thing a person
-- wrote, and labelling it `manual_edit` claims they did. It also pushes the
-- real first draft to v2, so "the original version" is never v1.
--
-- ── WHY THE GUARD IS ON INSERT ONLY ─────────────────────────────────────────
--
-- `TG_OP = 'INSERT'` matters. Clearing the body of an existing draft IS a real
-- edit and must still be recorded — a guard on `body = ''` alone would make
-- deleting all your copy the one change history forgets, which is the version
-- anyone would most want back.
--
-- Existing rows are left alone. Their empty v1 is a true record of what this
-- trigger did, and rewriting history to hide a fixed bug is worse than the
-- stray row.

create or replace function public.content_item_record_version()
returns trigger
language plpgsql
as $$
declare
  v_id uuid;
  v_manual boolean := (NEW.last_generation_source = 'manual_edit');
begin
  -- Nothing has been written yet. The generation that follows is v1.
  if TG_OP = 'INSERT' and coalesce(NEW.body, '') = '' then
    return NEW;
  end if;

  insert into public.content_item_version
    (content_item_id, workspace_id, title, body, created_by,
     generation_source, model, provider, task_id, prompt_context)
  values
    (NEW.id, NEW.workspace_id, NEW.title, NEW.body, NEW.created_by,
     NEW.last_generation_source,
     case when v_manual then null else nullif(NEW.metadata->>'last_model', '') end,
     case when v_manual then null else nullif(NEW.metadata->>'last_provider', '') end,
     case when v_manual then null else (nullif(NEW.metadata->>'last_task_id', ''))::uuid end,
     case when v_manual then '{}'::jsonb
          else coalesce(NEW.metadata->'last_prompt_context', '{}'::jsonb) end)
  returning id into v_id;

  update public.content_item
     set current_version_id = v_id
   where id = NEW.id;

  return NEW;
end;
$$;
