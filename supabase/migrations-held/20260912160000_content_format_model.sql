-- CONTENT FORMAT MODEL — platform and format, separated from post-vs-reply.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
--
-- `content_item.format` was the only shape Content could express: a
-- `linkedin_post` or a `linkedin_comment`. Scribe now DECIDES the shape of a
-- post — text, framework, single image, quote graphic, carousel, infographic,
-- meme, comic — and returns a structured strategy and artifact
-- (`_shared/contentFormats.ts`). Two things need a home:
--
--   platform         where it goes          'linkedin' today
--   content_format   what shape it takes    text | carousel | meme | …
--
-- `format` KEEPS its meaning — post or reply, the surface — so every existing
-- reader, constraint and the version trigger are untouched.
--
-- ── WHY GENERATED COLUMNS ───────────────────────────────────────────────────
--
-- The writer records Scribe's decision in `metadata` (`content_format`,
-- `platform`, `content_strategy`, `content_artifact`) — the same object the
-- version trigger snapshots through `last_prompt_context`. These columns are
-- DERIVED from it, never written directly, which gives two properties:
--
--   · no deploy-order hazard: the writer works before and after this migration
--     is applied, because it never names these columns
--   · one source of truth: the column cannot disagree with the metadata the
--     Studio renders, and a bad value is refused by the CHECK at write time
--
-- A row written before Scribe chose formats derives its format from the
-- surface: a reply is a `comment`, anything else a `text` post. That is what
-- those rows are.
--
-- ADDITIVE ONLY. No data is rewritten, no existing constraint is dropped.

alter table public.content_item
  add column if not exists platform text
    generated always as (coalesce(nullif(metadata->>'platform', ''), 'linkedin')) stored;

alter table public.content_item
  add column if not exists content_format text
    generated always as (
      coalesce(
        nullif(metadata->>'content_format', ''),
        case when format = 'linkedin_comment' then 'comment' else 'text' end
      )
    ) stored;

alter table public.content_item drop constraint if exists content_item_platform_check;
alter table public.content_item
  add constraint content_item_platform_check
  check (platform in ('linkedin'));

alter table public.content_item drop constraint if exists content_item_content_format_check;
alter table public.content_item
  add constraint content_item_content_format_check
  check (content_format in (
    'text', 'framework', 'single_image', 'quote', 'carousel',
    'infographic', 'meme', 'comic', 'comment'
  ));

-- A reply is a comment and a comment is a reply. A post cannot become a comment
-- and a reply cannot become a carousel — the same rule `formatsForSurface`
-- enforces before the write, held by the database as well.
alter table public.content_item drop constraint if exists content_item_format_surface_coherent;
alter table public.content_item
  add constraint content_item_format_surface_coherent
  check ((content_format = 'comment') = (format = 'linkedin_comment'));

create index if not exists content_item_workspace_content_format_idx
  on public.content_item (workspace_id, content_format);

comment on column public.content_item.platform is
  'Where the content goes. Derived from metadata.platform; never written directly.';
comment on column public.content_item.content_format is
  'The shape Scribe chose (text, carousel, meme, …). Derived from metadata.content_format, '
  'falling back to the surface for rows written before formats existed. Never written directly.';
