// THE CONTENT OBJECT, CLIENT SIDE.
//
// Content had no persistence of any kind: every action in the page called
// `sendAgentCommand(<English sentence>)`, so a draft lived in React state and
// a refresh threw it away. This module is the read/write seam for
// `content_item` — the first thing in Content that survives a reload.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// No version arithmetic. `content_item_version` rows are written by database
// triggers in the same transaction as the change, so there is no "insert the
// version too" step a caller can forget and no `max(version) + 1` race here.
// This file reads history; it never writes it.
//
// No generation. Creating an item persists what the user has; asking an agent
// to write one is the next slice.

import { supabase } from '@/integrations/supabase/client';

/**
 * Lifecycle. Matches the CHECK constraint on `content_item.status`.
 *
 * THREE STATES. `in_review` was removed: V1 has no reviewer and no publishing,
 * so a state nothing transitions out of is a promise the product does not keep.
 */
export type ContentStatus = 'draft' | 'approved' | 'archived';

/**
 * The two things Content V1 makes. Matches the CHECK on `content_item.format`.
 *
 * DELIBERATELY NOT `ContentSubtype` from contentDraftModel.ts. That union
 * (founder_post | post_ideas | comment_draft | content) describes what
 * `writeScribeContent` tags a `saved_outputs` row with — a different table, for
 * a different purpose. They were briefly pinned to each other; they are two
 * vocabularies and forcing them to agree would mean `content_item` carrying two
 * legacy names nothing writes and missing the two it needs.
 *
 * Extensible by design: adding a type is a CHECK change and one union member.
 * V1 ships only what it actually supports.
 */
export type ContentFormat = 'linkedin_post' | 'linkedin_comment';

/** How the item came to exist. Matches the CHECK on `content_item.source_type`. */
export type ContentSourceType = 'idea' | 'signal';

/** What produced a given version. Copied onto the version by the trigger. */
export type GenerationSource = 'manual_edit' | 'scribe_generation' | 'scribe_regeneration';

export interface ContentItem {
  id: string;
  workspace_id: string;
  created_by: string | null;
  status: ContentStatus;
  format: ContentFormat;
  title: string | null;
  body: string;
  source: string | null;
  source_type: ContentSourceType;
  source_signal_id: string | null;
  /** The live version. Maintained by the trigger; never written by a client. */
  current_version_id: string | null;
  last_generation_source: GenerationSource;
  agent_slug: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContentItemVersion {
  id: string;
  content_item_id: string;
  version: number;
  title: string | null;
  body: string;
  generation_source: GenerationSource;
  model: string | null;
  task_id: string | null;
  prompt_context: Record<string, unknown>;
  created_at: string;
}

/**
 * Columns, named once. A `select('*')` here would silently widen on migration.
 *
 * ONE LITERAL, NOT A CONCATENATION. supabase-js parses the select string at the
 * TYPE level to shape the row it returns; `'a, b' + 'c'` widens to `string`,
 * which it cannot parse, and every row silently degrades to
 * `GenericStringError`. Keep these on one line however long they get.
 */
const ITEM_COLUMNS = 'id, workspace_id, created_by, status, format, title, body, source, source_type, source_signal_id, current_version_id, last_generation_source, agent_slug, metadata, created_at, updated_at';

const VERSION_COLUMNS = 'id, content_item_id, version, title, body, generation_source, model, task_id, prompt_context, created_at';

const STATUSES: ContentStatus[] = ['draft', 'approved', 'archived'];
const FORMATS: ContentFormat[] = ['linkedin_post', 'linkedin_comment'];
const SOURCE_TYPES: ContentSourceType[] = ['idea', 'signal'];
const GENERATION_SOURCES: GenerationSource[] =
  ['manual_edit', 'scribe_generation', 'scribe_regeneration'];

/**
 * Narrow a database row to `ContentItem`.
 *
 * `status` and `format` are `text` in Postgres and arrive as `string`. The
 * CHECK constraints mean only valid values can be stored, but a client that
 * simply asserted that would be trusting a constraint it cannot see. These fall
 * back instead, so a value added to the constraint before this file knows about
 * it degrades to a sane default rather than rendering as a broken state.
 */
function toItem(row: Record<string, unknown>): ContentItem {
  const status = row.status as ContentStatus;
  const format = row.format as ContentFormat;
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    created_by: (row.created_by as string | null) ?? null,
    status: STATUSES.includes(status) ? status : 'draft',
    format: FORMATS.includes(format) ? format : 'linkedin_post',
    title: (row.title as string | null) ?? null,
    body: (row.body as string | null) ?? '',
    source: (row.source as string | null) ?? null,
    source_type: SOURCE_TYPES.includes(row.source_type as ContentSourceType)
      ? row.source_type as ContentSourceType : 'idea',
    source_signal_id: (row.source_signal_id as string | null) ?? null,
    current_version_id: (row.current_version_id as string | null) ?? null,
    last_generation_source:
      GENERATION_SOURCES.includes(row.last_generation_source as GenerationSource)
        ? row.last_generation_source as GenerationSource : 'manual_edit',
    agent_slug: (row.agent_slug as string | null) ?? null,
    metadata: (row.metadata && typeof row.metadata === 'object')
      ? row.metadata as Record<string, unknown>
      : {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}


export interface CreateContentItemInput {
  workspace_id: string;
  title?: string | null;
  body?: string;
  format?: ContentFormat;
  /** Free-text provenance label, e.g. 'content_surface'. */
  source?: string | null;
  /** Which of the two creation paths this was. */
  source_type?: ContentSourceType;
  /**
   * The signal this was made from. REQUIRED when `source_type` is 'signal' —
   * the database enforces it, so a signal-sourced draft can never lose track of
   * what it was about.
   */
  source_signal_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Create a draft.
 *
 * An empty `body` is allowed and is a real state — the user opened a composer
 * and has not typed yet. Refusing it would put us back where a draft only
 * exists once it is finished, which is the bug.
 */
export async function createContentItem(
  input: CreateContentItemInput,
): Promise<{ item: ContentItem | null; error: string | null }> {
  const { data, error } = await supabase
    .from('content_item')
    .insert({
      workspace_id: input.workspace_id,
      title: input.title ?? null,
      body: input.body ?? '',
      format: input.format ?? 'linkedin_post',
      source: input.source ?? null,
      source_type: input.source_type ?? 'idea',
      source_signal_id: input.source_signal_id ?? null,
      metadata: (input.metadata ?? {}) as never,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) return { item: null, error: error.message };
  return { item: toItem(data as Record<string, unknown>), error: null };
}

/** Newest first, which is the only order any Content view asks for. */
export async function listContentItems(
  workspaceId: string,
  opts?: { status?: ContentStatus; format?: ContentFormat; limit?: number },
): Promise<{ items: ContentItem[]; error: string | null }> {
  let q = supabase
    .from('content_item')
    .select(ITEM_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.format) q = q.eq('format', opts.format);
  const { data, error } = await q;
  if (error) return { items: [], error: error.message };
  return {
    items: (data ?? []).map((r) => toItem(r as Record<string, unknown>)),
    error: null,
  };
}

export async function getContentItem(
  id: string,
): Promise<{ item: ContentItem | null; error: string | null }> {
  const { data, error } = await supabase
    .from('content_item')
    .select(ITEM_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) return { item: null, error: error.message };
  if (!data) return { item: null, error: null };
  return { item: toItem(data as Record<string, unknown>), error: null };
}

/**
 * Save an edit.
 *
 * Editing title or body writes a version; changing only `status` does not —
 * moving a draft to review is not a new draft of the copy. That rule lives in
 * the trigger's WHEN clause, not here, so it holds for every writer.
 */
export async function updateContentItem(
  id: string,
  patch: { title?: string | null; body?: string; status?: ContentStatus },
): Promise<{ item: ContentItem | null; error: string | null }> {
  const { data, error } = await supabase
    .from('content_item')
    .update(patch)
    .eq('id', id)
    .select(ITEM_COLUMNS)
    .single();
  if (error) return { item: null, error: error.message };
  return { item: toItem(data as Record<string, unknown>), error: null };
}

export async function deleteContentItem(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('content_item').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/** Edit history, newest first. Read-only by design — versions have no update policy. */
export async function listContentItemVersions(
  contentItemId: string,
): Promise<{ versions: ContentItemVersion[]; error: string | null }> {
  const { data, error } = await supabase
    .from('content_item_version')
    .select(VERSION_COLUMNS)
    .eq('content_item_id', contentItemId)
    .order('version', { ascending: false });
  if (error) return { versions: [], error: error.message };
  return {
    versions: (data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        content_item_id: String(row.content_item_id),
        version: Number(row.version),
        title: (row.title as string | null) ?? null,
        body: (row.body as string | null) ?? '',
        generation_source:
          GENERATION_SOURCES.includes(row.generation_source as GenerationSource)
            ? row.generation_source as GenerationSource : 'manual_edit',
        model: (row.model as string | null) ?? null,
        task_id: (row.task_id as string | null) ?? null,
        prompt_context: (row.prompt_context && typeof row.prompt_context === 'object')
          ? row.prompt_context as Record<string, unknown> : {},
        created_at: String(row.created_at),
      };
    }),
    error: null,
  };
}
