-- CONTENT ASSETS — the generated visual, kept like a version.
--
-- ── WHY A NEW TABLE ─────────────────────────────────────────────────────────
--
-- Audited first: `public` has no asset, media, image or attachment table that
-- fits. The only matches were `collaboration_candidate_attachments` and the
-- `*_profiles` tables, all recruiting leftovers. Storage has three buckets —
-- `candidatespfp`, `cleintlogos`, `screening-resumes` — every one of them from
-- the deleted recruiting product. So there is nothing to reuse.
--
-- ── THE SHAPE IS content_item_version's ─────────────────────────────────────
--
-- An asset is to an image what a version is to text: an immutable record of
-- what was produced, by which model, from which prompt. Regenerating an image
-- writes a NEW row and moves a pointer; it never overwrites a URL. That is the
-- same rule the text versions already follow, and the reason a user can later
-- ask "which text, which image, which model, which prompt produced the approved
-- post?" and get an answer.
--
-- ── BINARIES LIVE IN STORAGE, NOT IN POSTGRES ───────────────────────────────
--
-- The row holds a `storage_path` into a private bucket. It deliberately does
-- NOT hold the provider's URL as the source of truth: OpenAI's image URLs
-- expire, so a table that pointed at one would quietly become a table of dead
-- links. The provider URL is kept in `metadata` as provenance only.

-- ── the bucket ──────────────────────────────────────────────────────────────
--
-- PRIVATE. Content drafts are unpublished work; a public bucket would make
-- every generated image world-readable by URL, which is the `ops_stuck_run_
-- archive` mistake in a different costume. The frontend reads through signed
-- URLs, which RLS on the objects still gates.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-assets', 'content-assets', false,
  20971520,  -- 20 MB: an image model's PNG, with room, and far below any DoS
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ── the table ───────────────────────────────────────────────────────────────

create table if not exists public.content_asset (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  content_item_id    uuid not null references public.content_item(id) on delete cascade,
  -- WHICH TEXT THIS WAS DRAWN FOR. Null is legal: an asset can outlive the
  -- version that prompted it, and ON DELETE SET NULL keeps the image rather
  -- than destroying it because its text was superseded.
  content_version_id uuid references public.content_item_version(id) on delete set null,

  asset_type         text not null default 'image'
                     check (asset_type in ('image')),
  -- A generation is not instant. `pending` exists so a row is written BEFORE
  -- the provider is called: a crash mid-generation leaves a visible failed
  -- attempt instead of silence, which is how an image that cost money but never
  -- arrived becomes findable.
  status             text not null default 'pending'
                     check (status in ('pending', 'ready', 'failed')),

  -- Path inside the `content-assets` bucket. Null while pending or failed.
  storage_path       text,

  -- PROVENANCE, the same contract the text versions carry. Never inherited by
  -- a human action: an asset a person uploaded records no model.
  provider           text,
  model              text,
  generation_prompt  text,
  generation_source  text not null default 'scribe_visual'
                     check (generation_source in ('scribe_visual', 'manual_upload')),
  task_id            uuid,

  width              integer,
  height             integer,
  failure_reason     text,
  metadata           jsonb not null default '{}'::jsonb,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),

  -- A ready asset must have a file; a pending or failed one must not claim to.
  constraint content_asset_ready_has_file
    check ((status = 'ready') = (storage_path is not null))
);

create index if not exists content_asset_item_created_idx
  on public.content_asset (content_item_id, created_at desc);
create index if not exists content_asset_workspace_idx
  on public.content_asset (workspace_id, created_at desc);

-- ── the current asset ───────────────────────────────────────────────────────
--
-- Same pattern as `current_version_id`: history is kept, a pointer says which
-- one is live. "Use image" and "Remove image" move this pointer; they never
-- delete a row.

alter table public.content_item
  add column if not exists current_asset_id uuid
  references public.content_asset(id) on delete set null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- The house predicate, and UPDATE carries a WITH CHECK — `saved_outputs` has
-- USING only, which lets a member move a row to another workspace.
--
-- No UPDATE or DELETE policy for clients on the asset itself: like a version,
-- an asset is a record of what was produced. The server writes it; the pointer
-- on `content_item` is what a user changes.

alter table public.content_asset enable row level security;
revoke all on table public.content_asset from anon;

drop policy if exists "content_asset members read" on public.content_asset;
create policy "content_asset members read" on public.content_asset
  for select using (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "content_asset members insert" on public.content_asset;
create policy "content_asset members insert" on public.content_asset
  for insert with check (public.has_workspace_access(auth.uid(), workspace_id));

-- ── STORAGE OBJECT POLICIES ─────────────────────────────────────────────────
--
-- Objects are keyed `<workspace_id>/<content_item_id>/<asset_id>.png`, so the
-- first path segment is the tenant and membership is checkable without a join
-- back to the asset row.

drop policy if exists "content assets are workspace readable" on storage.objects;
create policy "content assets are workspace readable" on storage.objects
  for select using (
    bucket_id = 'content-assets'
    and public.has_workspace_access(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

-- Writes come from the server with the service role, which bypasses RLS. No
-- client insert policy: a browser that could write here could put anything in
-- a tenant's folder.

-- ── PROVIDER PROVENANCE ON A TEXT VERSION ───────────────────────────────────
--
-- `content_item_version.model` was null on every row: run-agent knew the model
-- and never passed it, so provenance stopped at the task id. The writer now
-- records both, and the trigger copies them — under the same rule as the rest:
-- a MANUAL EDIT inherits neither.

alter table public.content_item_version
  add column if not exists provider text;

create or replace function public.content_item_record_version()
returns trigger
language plpgsql
as $$
declare
  v_id uuid;
  v_manual boolean := (NEW.last_generation_source = 'manual_edit');
begin
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
